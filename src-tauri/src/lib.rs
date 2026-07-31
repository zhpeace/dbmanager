pub mod db;
mod license;
mod secrets;

use db::AppState;
use db::DbConnection;
use db::types::{CheckpointState, CompareResult, DatabaseInfo, QueryResult, SchemaCache, TableData, TableInfo, TransferOptions, TransferResult};
use db::scheduler::{ScheduledTask, TaskConfig};
use tauri::Emitter;
use tauri::Manager;
use mongodb::Client as MongoClient;
use std::sync::{Arc, Mutex};
use std::path::PathBuf;
use chrono::Utc;

fn scheduler_file_path() -> PathBuf {
    let mut path = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("dbmanager");
    std::fs::create_dir_all(&path).ok();
    path.push("scheduled_tasks.json");
    path
}

fn load_scheduled_tasks() -> Vec<ScheduledTask> {
    let path = scheduler_file_path();
    if let Ok(data) = std::fs::read_to_string(&path) {
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        Vec::new()
    }
}

fn save_scheduled_tasks(tasks: &[ScheduledTask]) {
    let path = scheduler_file_path();
    if let Ok(data) = serde_json::to_string_pretty(tasks) {
        std::fs::write(path, data).ok();
    }
}

#[tauri::command]
async fn create_scheduled_task(
    state: tauri::State<'_, AppState>,
    name: String,
    cron_expr: String,
    config: TaskConfig,
) -> Result<ScheduledTask, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let mut task = ScheduledTask {
        id,
        name,
        cron_expr,
        enabled: true,
        config,
        created_at: Utc::now().to_rfc3339(),
        last_run: None,
        next_run: None,
        last_result: None,
    };
    task.compute_next_run();

    let mut tasks = state.scheduler.tasks.lock().await;
    tasks.push(task.clone());
    save_scheduled_tasks(&tasks);
    Ok(task)
}

#[tauri::command]
async fn list_scheduled_tasks(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ScheduledTask>, String> {
    let tasks = state.scheduler.tasks.lock().await;
    Ok(tasks.clone())
}

#[tauri::command]
async fn update_scheduled_task(
    state: tauri::State<'_, AppState>,
    id: String,
    name: String,
    cron_expr: String,
    config: TaskConfig,
    enabled: bool,
) -> Result<ScheduledTask, String> {
    let mut tasks = state.scheduler.tasks.lock().await;
    let task = tasks.iter_mut().find(|t| t.id == id).ok_or("Task not found")?;
    task.name = name;
    task.cron_expr = cron_expr;
    task.config = config;
    task.enabled = enabled;
    task.compute_next_run();
    let result = task.clone();
    save_scheduled_tasks(&tasks);
    Ok(result)
}

#[tauri::command]
async fn delete_scheduled_task(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let mut tasks = state.scheduler.tasks.lock().await;
    tasks.retain(|t| t.id != id);
    save_scheduled_tasks(&tasks);
    Ok(())
}

#[tauri::command]
async fn toggle_scheduled_task(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<ScheduledTask, String> {
    let mut tasks = state.scheduler.tasks.lock().await;
    let task = tasks.iter_mut().find(|t| t.id == id).ok_or("Task not found")?;
    task.enabled = !task.enabled;
    let result = task.clone();
    save_scheduled_tasks(&tasks);
    Ok(result)
}

#[tauri::command]
async fn connect_mysql(
    state: tauri::State<'_, AppState>,
    id: String,
    host: String,
    port: u16,
    user: String,
    password: String,
    database: Option<String>,
) -> Result<(), String> {
    fn url_encode(s: &str) -> String {
        s.bytes().map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            b' ' => "%20".to_string(),
            _ => format!("%{:02X}", b),
        }).collect()
    }
    let enc_user = url_encode(&user);
    let enc_pass = url_encode(&password);
    let conn_str = match database {
        Some(ref db) => format!("mysql://{}:{}@{}:{}/{}", enc_user, enc_pass, host, port, db),
        None => format!("mysql://{}:{}@{}:{}", enc_user, enc_pass, host, port),
    };
    let pool = sqlx::mysql::MySqlPoolOptions::new()
        .max_connections(5)
        .connect(&conn_str)
        .await
        .map_err(|e| format!("MySQL connection failed: {}", e))?;

    let mut connections = state.connections.lock().await;
    connections.insert(id, DbConnection::MySql(pool));
    Ok(())
}

#[tauri::command]
async fn connect_postgres(
    state: tauri::State<'_, AppState>,
    id: String,
    host: String,
    port: u16,
    user: String,
    password: String,
    database: Option<String>,
) -> Result<(), String> {
    let db = database.as_deref().unwrap_or("postgres");
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .connect_with(
            sqlx::postgres::PgConnectOptions::new()
                .host(&host)
                .port(port)
                .username(&user)
                .password(&password)
                .database(db)
        )
        .await
        .map_err(|e| format!("PostgreSQL connection failed: {}", e))?;

    let mut connections = state.connections.lock().await;
    connections.insert(id, DbConnection::Pg(pool));
    Ok(())
}

#[tauri::command]
async fn connect_sqlite(
    state: tauri::State<'_, AppState>,
    id: String,
    file_path: String,
) -> Result<(), String> {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&file_path)
        .await
        .map_err(|e| format!("SQLite connection failed: {}", e))?;

    let mut connections = state.connections.lock().await;
    connections.insert(id, DbConnection::Sqlite(pool));
    Ok(())
}

#[tauri::command]
async fn disconnect(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let mut connections = state.connections.lock().await;
    connections.remove(&id);
    Ok(())
}

#[tauri::command]
async fn switch_database(
    state: tauri::State<'_, AppState>,
    id: String,
    host: String,
    port: u16,
    user: String,
    password: String,
    database: String,
) -> Result<(), String> {
    let conn_str = format!("mysql://{}:{}@{}:{}/{}", user, password, host, port, database);
    let pool = sqlx::mysql::MySqlPoolOptions::new()
        .max_connections(5)
        .connect(&conn_str)
        .await
        .map_err(|e| format!("MySQL connection failed: {}", e))?;

    let mut connections = state.connections.lock().await;
    connections.insert(id, DbConnection::MySql(pool));
    Ok(())
}

#[tauri::command]
async fn get_databases(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<Vec<DatabaseInfo>, String> {
    let conn = {
        let connections = state.connections.lock().await;
        connections.get(&id).ok_or("Connection not found").map(|c| match c {
            DbConnection::MySql(p) => DbConnection::MySql(p.clone()),
            DbConnection::Pg(p) => DbConnection::Pg(p.clone()),
            DbConnection::Sqlite(p) => DbConnection::Sqlite(p.clone()),
            DbConnection::Mongo(c, db) => DbConnection::Mongo(c.clone(), db.clone()),
            DbConnection::Oracle(c) => DbConnection::Oracle(c.clone()),
            DbConnection::Redis(c) => DbConnection::Redis(c.clone()),
        })?
    };
    conn.get_databases().await
}

#[tauri::command]
async fn create_database(
    state: tauri::State<'_, AppState>,
    id: String,
    db_name: String,
) -> Result<(), String> {
    let conn = {
        let connections = state.connections.lock().await;
        connections.get(&id).ok_or("Connection not found").map(|c| match c {
            DbConnection::MySql(p) => DbConnection::MySql(p.clone()),
            DbConnection::Pg(p) => DbConnection::Pg(p.clone()),
            DbConnection::Sqlite(p) => DbConnection::Sqlite(p.clone()),
            DbConnection::Mongo(c, db) => DbConnection::Mongo(c.clone(), db.clone()),
            DbConnection::Oracle(c) => DbConnection::Oracle(c.clone()),
            DbConnection::Redis(c) => DbConnection::Redis(c.clone()),
        })?
    };
    conn.create_database(&db_name).await
}

#[tauri::command]
async fn drop_database(
    state: tauri::State<'_, AppState>,
    id: String,
    db_name: String,
) -> Result<(), String> {
    let conn = {
        let connections = state.connections.lock().await;
        connections.get(&id).ok_or("Connection not found").map(|c| match c {
            DbConnection::MySql(p) => DbConnection::MySql(p.clone()),
            DbConnection::Pg(p) => DbConnection::Pg(p.clone()),
            DbConnection::Sqlite(p) => DbConnection::Sqlite(p.clone()),
            DbConnection::Mongo(c, db) => DbConnection::Mongo(c.clone(), db.clone()),
            DbConnection::Oracle(c) => DbConnection::Oracle(c.clone()),
            DbConnection::Redis(c) => DbConnection::Redis(c.clone()),
        })?
    };
    conn.drop_database(&db_name).await
}

#[tauri::command]
async fn get_tables(
    state: tauri::State<'_, AppState>,
    id: String,
    database: String,
) -> Result<Vec<TableInfo>, String> {
    let conn = {
        let connections = state.connections.lock().await;
        connections.get(&id).ok_or("Connection not found").map(|c| match c {
            DbConnection::MySql(p) => DbConnection::MySql(p.clone()),
            DbConnection::Pg(p) => DbConnection::Pg(p.clone()),
            DbConnection::Sqlite(p) => DbConnection::Sqlite(p.clone()),
            DbConnection::Mongo(c, db) => DbConnection::Mongo(c.clone(), db.clone()),
            DbConnection::Oracle(c) => DbConnection::Oracle(c.clone()),
            DbConnection::Redis(c) => DbConnection::Redis(c.clone()),
        })?
    };
    conn.get_tables(&database).await
}

#[tauri::command]
async fn get_table_data(
    state: tauri::State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    page: i64,
    page_size: i64,
    sort_column: Option<String>,
    sort_order: Option<String>,
    where_clause: Option<String>,
    row_limit: Option<i64>,
) -> Result<TableData, String> {
    let conn = {
        let connections = state.connections.lock().await;
        connections.get(&id).ok_or("Connection not found").map(|c| match c {
            DbConnection::MySql(p) => DbConnection::MySql(p.clone()),
            DbConnection::Pg(p) => DbConnection::Pg(p.clone()),
            DbConnection::Sqlite(p) => DbConnection::Sqlite(p.clone()),
            DbConnection::Mongo(c, db) => DbConnection::Mongo(c.clone(), db.clone()),
            DbConnection::Oracle(c) => DbConnection::Oracle(c.clone()),
            DbConnection::Redis(c) => DbConnection::Redis(c.clone()),
        })?
    };
    conn.get_table_data(&database, &table, page, page_size, sort_column.as_deref(), sort_order.as_deref(), where_clause.as_deref(), row_limit).await
}

#[tauri::command]
async fn get_table_ddl(
    state: tauri::State<'_, AppState>,
    id: String,
    database: String,
    table: String,
) -> Result<String, String> {
    let conn = {
        let connections = state.connections.lock().await;
        connections.get(&id).ok_or("Connection not found").map(|c| match c {
            DbConnection::MySql(p) => DbConnection::MySql(p.clone()),
            DbConnection::Pg(p) => DbConnection::Pg(p.clone()),
            DbConnection::Sqlite(p) => DbConnection::Sqlite(p.clone()),
            DbConnection::Mongo(c, db) => DbConnection::Mongo(c.clone(), db.clone()),
            DbConnection::Oracle(c) => DbConnection::Oracle(c.clone()),
            DbConnection::Redis(c) => DbConnection::Redis(c.clone()),
        })?
    };
    conn.get_table_ddl(&database, &table).await
}

#[tauri::command]
async fn connect_mongo(
    state: tauri::State<'_, AppState>,
    id: String,
    host: String,
    port: u16,
    user: String,
    password: String,
    database: Option<String>,
) -> Result<(), String> {
    let conn_str = match database {
        Some(ref db) => format!("mongodb://{}:{}@{}:{}/{}", user, password, host, port, db),
        None => format!("mongodb://{}:{}@{}:{}", user, password, host, port),
    };
    let client = MongoClient::with_uri_str(&conn_str)
        .await
        .map_err(|e| format!("MongoDB connection failed: {}", e))?;
    let db_name = database.unwrap_or_else(|| "admin".to_string());
    let mut connections = state.connections.lock().await;
    connections.insert(id, DbConnection::Mongo(client, db_name));
    Ok(())
}

#[tauri::command]
async fn connect_redis(
    state: tauri::State<'_, AppState>,
    id: String,
    host: String,
    port: u16,
    password: Option<String>,
    database: Option<String>,
) -> Result<(), String> {
    fn url_encode(s: &str) -> String {
        s.bytes().map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            b' ' => "%20".to_string(),
            _ => format!("%{:02X}", b),
        }).collect()
    }
    let db_index = database.as_deref().unwrap_or("0");
    let url = match &password {
        Some(p) if !p.is_empty() => format!("redis://:{}@{}:{}/{}", url_encode(p), host, port, db_index),
        _ => format!("redis://{}:{}/{}", host, port, db_index),
    };
    let client = redis::Client::open(url.as_str()).map_err(|e| format!("Redis connection failed: {}", e))?;
    let conn = client.get_connection_manager()
        .await
        .map_err(|e| format!("Redis connection failed: {}", e))?;
    let mut connections = state.connections.lock().await;
    connections.insert(id, DbConnection::Redis(conn));
    Ok(())
}

#[tauri::command]
async fn connect_oracle(
    state: tauri::State<'_, AppState>,
    id: String,
    host: String,
    port: u16,
    user: String,
    password: String,
    database: String,
) -> Result<(), String> {
    let service = if database.is_empty() { "ORCL" } else { &database };
    let conn_str = format!("//{}:{}/{}", host, port, service);
    let conn = tokio::task::spawn_blocking(move || {
        oracle::Connection::connect(&user, &password, &conn_str)
    }).await.map_err(|e| format!("Oracle connection failed: {}", e))?
      .map_err(|e| format!("Oracle connection failed: {}", e))?;
    let mut connections = state.connections.lock().await;
    connections.insert(id, DbConnection::Oracle(Arc::new(Mutex::new(conn))));
    Ok(())
}

#[tauri::command]
async fn test_connection(
    type_: String,
    host: String,
    port: u16,
    user: String,
    password: String,
    database: Option<String>,
) -> Result<String, String> {
    match type_.as_str() {
        "mysql" => {
            fn url_encode(s: &str) -> String {
                s.bytes().map(|b| match b {
                    b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
                    b' ' => "%20".to_string(),
                    _ => format!("%{:02X}", b),
                }).collect()
            }
            let enc_user = url_encode(&user);
            let enc_pass = url_encode(&password);
            let conn_str = match database {
                Some(ref db) => format!("mysql://{}:{}@{}:{}/{}", enc_user, enc_pass, host, port, db),
                None => format!("mysql://{}:{}@{}:{}", enc_user, enc_pass, host, port),
            };
            sqlx::mysql::MySqlPoolOptions::new()
                .max_connections(1)
                .connect(&conn_str)
                .await
                .map_err(|e| format!("Test failed: {}", e))?;
            Ok("Connection successful".to_string())
        }
        "postgresql" => {
            let db = database.as_deref().unwrap_or("postgres");
            sqlx::postgres::PgPoolOptions::new()
                .max_connections(1)
                .acquire_timeout(std::time::Duration::from_secs(10))
                .connect_with(
                    sqlx::postgres::PgConnectOptions::new()
                        .host(&host)
                        .port(port)
                        .username(&user)
                        .password(&password)
                        .database(db)
                )
                .await
                .map_err(|e| format!("Test failed: {}", e))?;
            Ok("Connection successful".to_string())
        }
        "oracle" => {
            let db = database.as_deref().unwrap_or("ORCL");
            let service = if db.is_empty() { "ORCL" } else { db };
            let conn_str = format!("//{}:{}/{}", host, port, service);
            tokio::task::spawn_blocking(move || {
                oracle::Connection::connect(&user, &password, &conn_str)
            }).await.map_err(|e| format!("Test failed: {}", e))?
              .map_err(|e| format!("Test failed: {}", e))?;
            Ok("Connection successful".to_string())
        }
        "redis" => {
            let db_index = database.as_deref().unwrap_or("0");
            let url = if password.is_empty() {
                format!("redis://{}:{}/{}", host, port, db_index)
            } else {
                format!("redis://:{}@{}:{}/{}", &password, host, port, db_index)
            };
            let client = redis::Client::open(url.as_str()).map_err(|e| format!("Test failed: {}", e))?;
            let mut conn = client.get_connection_manager()
                .await
                .map_err(|e| format!("Test failed: {}", e))?;
            let _: String = redis::cmd("PING").query_async(&mut conn)
                .await
                .map_err(|e| format!("Test failed: {}", e))?;
            Ok("Connection successful".to_string())
        }
        _ => Err(format!("Unsupported database type: {}", type_)),
    }
}

#[tauri::command]
async fn execute_update(
    state: tauri::State<'_, AppState>,
    id: String,
    query: String,
) -> Result<QueryResult, String> {
    let conn = {
        let connections = state.connections.lock().await;
        connections.get(&id).ok_or("Connection not found").map(|c| match c {
            DbConnection::MySql(p) => DbConnection::MySql(p.clone()),
            DbConnection::Pg(p) => DbConnection::Pg(p.clone()),
            DbConnection::Sqlite(p) => DbConnection::Sqlite(p.clone()),
            DbConnection::Mongo(c, db) => DbConnection::Mongo(c.clone(), db.clone()),
            DbConnection::Oracle(c) => DbConnection::Oracle(c.clone()),
            DbConnection::Redis(c) => DbConnection::Redis(c.clone()),
        })?
    };
    conn.execute_update(&query).await
}

#[tauri::command]
async fn get_schema_cache(
    state: tauri::State<'_, AppState>,
    id: String,
    database: String,
) -> Result<SchemaCache, String> {
    let conn = {
        let connections = state.connections.lock().await;
        connections.get(&id).ok_or("Connection not found").map(|c| match c {
            DbConnection::MySql(p) => DbConnection::MySql(p.clone()),
            DbConnection::Pg(p) => DbConnection::Pg(p.clone()),
            DbConnection::Sqlite(p) => DbConnection::Sqlite(p.clone()),
            DbConnection::Mongo(c, db) => DbConnection::Mongo(c.clone(), db.clone()),
            DbConnection::Oracle(c) => DbConnection::Oracle(c.clone()),
            DbConnection::Redis(c) => DbConnection::Redis(c.clone()),
        })?
    };
    conn.get_schema_cache(&database).await
}

#[tauri::command]
async fn transfer_data(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    opts: TransferOptions,
) -> Result<TransferResult, String> {
    let (source_conn, target_conn) = {
        let connections = state.connections.lock().await;
        let src = connections.get(&opts.source_id).ok_or("Source connection not found")?;
        let tgt = connections.get(&opts.target_id).ok_or("Target connection not found")?;
        let s = match src {
            DbConnection::MySql(p) => DbConnection::MySql(p.clone()),
            DbConnection::Pg(p) => DbConnection::Pg(p.clone()),
            DbConnection::Sqlite(p) => DbConnection::Sqlite(p.clone()),
            DbConnection::Mongo(c, db) => DbConnection::Mongo(c.clone(), db.clone()),
            DbConnection::Oracle(c) => DbConnection::Oracle(c.clone()),
            DbConnection::Redis(c) => DbConnection::Redis(c.clone()),
        };
        let t = match tgt {
            DbConnection::MySql(p) => DbConnection::MySql(p.clone()),
            DbConnection::Pg(p) => DbConnection::Pg(p.clone()),
            DbConnection::Sqlite(p) => DbConnection::Sqlite(p.clone()),
            DbConnection::Mongo(c, db) => DbConnection::Mongo(c.clone(), db.clone()),
            DbConnection::Oracle(c) => DbConnection::Oracle(c.clone()),
            DbConnection::Redis(c) => DbConnection::Redis(c.clone()),
        };
        (s, t)
    };

    let (log_tx, mut log_rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    let app_clone = app.clone();
    tokio::spawn(async move {
        while let Some(msg) = log_rx.recv().await {
            let _ = app_clone.emit("migration-log", msg);
        }
    });

    db::transfer_data(&source_conn, &target_conn, &opts, Some(log_tx)).await
}

#[tauri::command]
async fn duplicate_database(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    id: String,
    source_db: String,
    target_db: String,
) -> Result<TransferResult, String> {
    let conn = {
        let connections = state.connections.lock().await;
        let c = connections.get(&id).ok_or("Connection not found")?;
        match c {
            DbConnection::Sqlite(_) => return Err("SQLite does not support duplicate database".to_string()),
            DbConnection::Redis(_) => return Err("Redis does not support duplicate database".to_string()),
            _ => c.clone(),
        }
    };

    conn.create_database(&target_db).await?;

    let all_objects = conn.get_tables(&source_db).await?;
    let table_names: Vec<String> = all_objects.iter().filter(|t| {
        matches!(t.object_type.as_str(), "TABLE" | "BASE TABLE")
    }).map(|t| t.name.clone()).collect();

    let opts = TransferOptions {
        source_id: id.clone(),
        source_database: source_db,
        target_id: id,
        target_database: target_db,
        tables: table_names,
        mode: db::types::TransferMode::StructureAndData,
        transfer_indexes: true,
        transfer_foreign_keys: true,
        transfer_views: true,
        transfer_routines: true,
        transfer_triggers: true,
        ..Default::default()
    };

    let source_conn = conn.clone();
    let target_conn = conn;

    let (log_tx, mut log_rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    let app_clone = app.clone();
    tokio::spawn(async move {
        while let Some(msg) = log_rx.recv().await {
            let _ = app_clone.emit("migration-log", msg);
        }
    });

    db::transfer_data(&source_conn, &target_conn, &opts, Some(log_tx)).await
}

#[tauri::command]
async fn execute_query(
    state: tauri::State<'_, AppState>,
    id: String,
    query: String,
) -> Result<QueryResult, String> {
    let conn = {
        let connections = state.connections.lock().await;
        connections.get(&id).ok_or("Connection not found").map(|c| match c {
            DbConnection::MySql(p) => DbConnection::MySql(p.clone()),
            DbConnection::Pg(p) => DbConnection::Pg(p.clone()),
            DbConnection::Sqlite(p) => DbConnection::Sqlite(p.clone()),
            DbConnection::Mongo(c, db) => DbConnection::Mongo(c.clone(), db.clone()),
            DbConnection::Oracle(c) => DbConnection::Oracle(c.clone()),
            DbConnection::Redis(c) => DbConnection::Redis(c.clone()),
        })?
    };
    conn.execute_query(&query).await
}

#[tauri::command]
async fn create_table(
    state: tauri::State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    columns: Vec<db::types::ColumnDef>,
) -> Result<QueryResult, String> {
    let conn = get_conn(&state, &id).await?;
    let kind = db::ddl::db_kind(&conn)?;
    let schema = if database.is_empty() { None } else { Some(database.as_str()) };
    let sql = db::ddl::create_table_sql(&kind, schema, &table, &columns);
    conn.execute_update(&sql).await
}

#[tauri::command]
async fn drop_table(
    state: tauri::State<'_, AppState>,
    id: String,
    database: String,
    table: String,
) -> Result<QueryResult, String> {
    let conn = get_conn(&state, &id).await?;
    let kind = db::ddl::db_kind(&conn)?;
    let schema = if database.is_empty() { None } else { Some(database.as_str()) };
    let sql = db::ddl::drop_table_sql(&kind, schema, &table);
    conn.execute_update(&sql).await
}

#[tauri::command]
async fn truncate_table(
    state: tauri::State<'_, AppState>,
    id: String,
    database: String,
    table: String,
) -> Result<QueryResult, String> {
    let conn = get_conn(&state, &id).await?;
    let kind = db::ddl::db_kind(&conn)?;
    let schema = if database.is_empty() { None } else { Some(database.as_str()) };
    let sql = db::ddl::truncate_table_sql(&kind, schema, &table);
    conn.execute_update(&sql).await
}

#[tauri::command]
async fn rename_table(
    state: tauri::State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    new_name: String,
) -> Result<QueryResult, String> {
    let conn = get_conn(&state, &id).await?;
    let kind = db::ddl::db_kind(&conn)?;
    let schema = if database.is_empty() { None } else { Some(database.as_str()) };
    let sql = db::ddl::rename_table_sql(&kind, schema, &table, &new_name);
    conn.execute_update(&sql).await
}

#[tauri::command]
async fn alter_table_add_column(
    state: tauri::State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    column: db::types::ColumnDef,
) -> Result<QueryResult, String> {
    let conn = get_conn(&state, &id).await?;
    let kind = db::ddl::db_kind(&conn)?;
    let schema = if database.is_empty() { None } else { Some(database.as_str()) };
    let sql = db::ddl::add_column_sql(&kind, schema, &table, &column);
    conn.execute_update(&sql).await
}

#[tauri::command]
async fn alter_table_drop_column(
    state: tauri::State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    column: String,
) -> Result<QueryResult, String> {
    let conn = get_conn(&state, &id).await?;
    let kind = db::ddl::db_kind(&conn)?;
    let schema = if database.is_empty() { None } else { Some(database.as_str()) };
    let sql = db::ddl::drop_column_sql(&kind, schema, &table, &column);
    conn.execute_update(&sql).await
}

#[tauri::command]
async fn alter_table_modify_column(
    state: tauri::State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    column: db::types::ColumnDef,
) -> Result<QueryResult, String> {
    let conn = get_conn(&state, &id).await?;
    let kind = db::ddl::db_kind(&conn)?;
    let schema = if database.is_empty() { None } else { Some(database.as_str()) };
    let sql = db::ddl::modify_column_sql(&kind, schema, &table, &column);
    conn.execute_update(&sql).await
}

#[tauri::command]
async fn alter_table_rename_column(
    state: tauri::State<'_, AppState>,
    id: String,
    database: String,
    table: String,
    column: String,
    new_name: String,
) -> Result<QueryResult, String> {
    let conn = get_conn(&state, &id).await?;
    let kind = db::ddl::db_kind(&conn)?;
    let schema = if database.is_empty() { None } else { Some(database.as_str()) };
    let sql = db::ddl::rename_column_sql(&kind, schema, &table, &column, &new_name);
    conn.execute_update(&sql).await
}

#[tauri::command]
async fn drop_view(
    state: tauri::State<'_, AppState>,
    id: String,
    database: String,
    view: String,
) -> Result<QueryResult, String> {
    let conn = get_conn(&state, &id).await?;
    let kind = db::ddl::db_kind(&conn)?;
    let schema = if database.is_empty() { None } else { Some(database.as_str()) };
    let sql = db::ddl::drop_view_sql(&kind, schema, &view);
    conn.execute_update(&sql).await
}

#[tauri::command]
async fn drop_routine(
    state: tauri::State<'_, AppState>,
    id: String,
    database: String,
    routine: String,
    routine_type: String,
) -> Result<QueryResult, String> {
    let conn = get_conn(&state, &id).await?;
    let kind = db::ddl::db_kind(&conn)?;
    let schema = if database.is_empty() { None } else { Some(database.as_str()) };
    let sql = db::ddl::drop_routine_sql(&kind, schema, &routine, &routine_type);
    conn.execute_update(&sql).await
}

#[tauri::command]
async fn drop_trigger(
    state: tauri::State<'_, AppState>,
    id: String,
    database: String,
    trigger: String,
) -> Result<QueryResult, String> {
    let conn = get_conn(&state, &id).await?;
    let kind = db::ddl::db_kind(&conn)?;
    let schema = if database.is_empty() { None } else { Some(database.as_str()) };
    let sql = db::ddl::drop_trigger_sql(&kind, schema, &trigger);
    conn.execute_update(&sql).await
}

async fn get_conn(state: &tauri::State<'_, AppState>, id: &str) -> Result<DbConnection, String> {
    let connections = state.connections.lock().await;
    connections.get(id).ok_or("Connection not found".to_string()).map(|c| match c {
        DbConnection::MySql(p) => DbConnection::MySql(p.clone()),
        DbConnection::Pg(p) => DbConnection::Pg(p.clone()),
        DbConnection::Sqlite(p) => DbConnection::Sqlite(p.clone()),
        DbConnection::Mongo(c, db) => DbConnection::Mongo(c.clone(), db.clone()),
        DbConnection::Oracle(c) => DbConnection::Oracle(c.clone()),
        DbConnection::Redis(c) => DbConnection::Redis(c.clone()),
    })
}

fn checkpoint_key(source_id: &str, source_db: &str, target_id: &str, target_db: &str) -> String {
    format!("{}|{}|{}|{}", source_id, source_db, target_id, target_db)
}

#[tauri::command]
async fn save_checkpoint(
    state: tauri::State<'_, AppState>,
    source_id: String,
    source_database: String,
    target_id: String,
    target_database: String,
    completed_tables: Vec<String>,
    rows_transferred: i64,
) -> Result<(), String> {
    let key = checkpoint_key(&source_id, &source_database, &target_id, &target_database);
    let mut cps = state.checkpoints.lock().await;
    cps.insert(key, CheckpointState {
        completed_tables,
        failed_tables: vec![],
        rows_transferred,
    });
    Ok(())
}

#[tauri::command]
async fn get_checkpoint(
    state: tauri::State<'_, AppState>,
    source_id: String,
    source_database: String,
    target_id: String,
    target_database: String,
) -> Result<Option<CheckpointState>, String> {
    let key = checkpoint_key(&source_id, &source_database, &target_id, &target_database);
    let cps = state.checkpoints.lock().await;
    Ok(cps.get(&key).cloned())
}

#[tauri::command]
async fn clear_checkpoint(
    state: tauri::State<'_, AppState>,
    source_id: String,
    source_database: String,
    target_id: String,
    target_database: String,
) -> Result<(), String> {
    let key = checkpoint_key(&source_id, &source_database, &target_id, &target_database);
    let mut cps = state.checkpoints.lock().await;
    cps.remove(&key);
    Ok(())
}

#[tauri::command]
async fn compare_schemas(
    state: tauri::State<'_, AppState>,
    source_id: String,
    source_database: String,
    target_id: String,
    target_database: String,
) -> Result<CompareResult, String> {
    let (source_conn, target_conn) = {
        let connections = state.connections.lock().await;
        let src = connections.get(&source_id).ok_or("Source connection not found")?;
        let tgt = connections.get(&target_id).ok_or("Target connection not found")?;
        let s = match src {
            DbConnection::MySql(p) => DbConnection::MySql(p.clone()),
            DbConnection::Pg(p) => DbConnection::Pg(p.clone()),
            DbConnection::Sqlite(p) => DbConnection::Sqlite(p.clone()),
            DbConnection::Mongo(c, db) => DbConnection::Mongo(c.clone(), db.clone()),
            DbConnection::Oracle(c) => DbConnection::Oracle(c.clone()),
            DbConnection::Redis(c) => DbConnection::Redis(c.clone()),
        };
        let t = match tgt {
            DbConnection::MySql(p) => DbConnection::MySql(p.clone()),
            DbConnection::Pg(p) => DbConnection::Pg(p.clone()),
            DbConnection::Sqlite(p) => DbConnection::Sqlite(p.clone()),
            DbConnection::Mongo(c, db) => DbConnection::Mongo(c.clone(), db.clone()),
            DbConnection::Oracle(c) => DbConnection::Oracle(c.clone()),
            DbConnection::Redis(c) => DbConnection::Redis(c.clone()),
        };
        (s, t)
    };
    db::compare_schemas(&source_conn, &target_conn, &source_database, &target_database).await
}

#[tauri::command]
async fn backup_database(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    source_id: String,
    database: String,
    tables: Vec<String>,
    output_path: String,
) -> Result<(i32, String), String> {
    let conn = {
        let connections = state.connections.lock().await;
        let c = connections.get(&source_id).ok_or("Connection not found")?;
        match c {
            DbConnection::MySql(p) => DbConnection::MySql(p.clone()),
            DbConnection::Pg(p) => DbConnection::Pg(p.clone()),
            DbConnection::Sqlite(p) => DbConnection::Sqlite(p.clone()),
            DbConnection::Mongo(c, db) => DbConnection::Mongo(c.clone(), db.clone()),
            DbConnection::Oracle(c) => DbConnection::Oracle(c.clone()),
            DbConnection::Redis(c) => DbConnection::Redis(c.clone()),
        }
    };

    let (log_tx, mut log_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let app_clone = app.clone();
    tokio::spawn(async move {
        while let Some(msg) = log_rx.recv().await {
            let _ = app_clone.emit("migration-log", msg);
        }
    });

    db::backup_database(&conn, &database, &tables, &output_path, Some(log_tx)).await
}

#[tauri::command]
async fn restore_database(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    target_id: String,
    database: String,
    input_path: String,
) -> Result<(i32, Vec<String>), String> {
    let conn = {
        let connections = state.connections.lock().await;
        let c = connections.get(&target_id).ok_or("Connection not found")?;
        match c {
            DbConnection::MySql(p) => DbConnection::MySql(p.clone()),
            DbConnection::Pg(p) => DbConnection::Pg(p.clone()),
            DbConnection::Sqlite(p) => DbConnection::Sqlite(p.clone()),
            DbConnection::Mongo(c, db) => DbConnection::Mongo(c.clone(), db.clone()),
            DbConnection::Oracle(c) => DbConnection::Oracle(c.clone()),
            DbConnection::Redis(c) => DbConnection::Redis(c.clone()),
        }
    };

    let (log_tx, mut log_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let app_clone = app.clone();
    tokio::spawn(async move {
        while let Some(msg) = log_rx.recv().await {
            let _ = app_clone.emit("migration-log", msg);
        }
    });

    db::restore_database(&conn, &database, &input_path, Some(log_tx)).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_tasks = load_scheduled_tasks();
    let app_state = AppState {
        connections: tokio::sync::Mutex::new(std::collections::HashMap::new()),
        checkpoints: tokio::sync::Mutex::new(std::collections::HashMap::new()),
        scheduler: db::scheduler::SchedulerManager::new(initial_tasks),
    };

    tauri::Builder::default()
        .manage(app_state)
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let handle = app.handle().clone();
            let cancel_rx = app.state::<AppState>().scheduler.cancel_tx.subscribe();

            tauri::async_runtime::spawn(async move {
                scheduler_loop(handle, cancel_rx).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connect_mysql,
            connect_postgres,
            connect_sqlite,
            connect_mongo,
            connect_oracle,
            connect_redis,
            test_connection,
            disconnect,
            switch_database,
            get_databases,
            create_database,
            drop_database,
            get_tables,
            get_table_data,
            get_table_ddl,
            execute_query,
            execute_update,
            get_schema_cache,
            transfer_data,
            duplicate_database,
            create_table,
            drop_table,
            truncate_table,
            rename_table,
            alter_table_add_column,
            alter_table_drop_column,
            alter_table_modify_column,
                    alter_table_rename_column,
                    drop_view,
                    drop_routine,
                    drop_trigger,
                    license::activate_license,
                    license::get_license_status,
                    secrets::save_connection_secret,
                    secrets::get_connection_secret,
                    secrets::delete_connection_secret,
                    save_checkpoint,
                    get_checkpoint,
                    clear_checkpoint,
                    compare_schemas,
                    backup_database,
                    restore_database,
                    create_scheduled_task,
                    list_scheduled_tasks,
                    update_scheduled_task,
                    delete_scheduled_task,
                    toggle_scheduled_task,
                ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

async fn scheduler_loop(app_handle: tauri::AppHandle, mut cancel_rx: tokio::sync::watch::Receiver<bool>) {
    use chrono::{DateTime, Utc};
    use cron::Schedule;
    use std::str::FromStr;

    let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));

    loop {
        tokio::select! {
            _ = interval.tick() => {},
            _ = cancel_rx.changed() => {
                if *cancel_rx.borrow() {
                    break;
                }
            }
        }

        let state: tauri::State<'_, AppState> = app_handle.state();
        let mut tasks = state.scheduler.tasks.lock().await;
        let now = Utc::now();

        for task in tasks.iter_mut() {
            if !task.enabled { continue; }
            let Some(ref next_str) = task.next_run.clone() else { continue };
            let Ok(next_time) = next_str.parse::<DateTime<Utc>>() else { continue };
            if now < next_time { continue; }

            let config = task.config.clone();
            let task_id = task.id.clone();
            let task_name = task.name.clone();

            let result = match config {
                db::scheduler::TaskConfig::Backup {
                    source_id,
                    database,
                    tables,
                    output_path,
                } => {
                    run_backup_task(&app_handle, &source_id, &database, &tables, &output_path).await
                }
                db::scheduler::TaskConfig::Transfer {
                    source_id,
                    source_database,
                    target_id,
                    target_database,
                    tables,
                    mode,
                    conflict_strategy,
                    drop_target,
                    truncate_target,
                    where_clause,
                    row_limit,
                    page_size,
                    parallelism,
                    transfer_indexes,
                    transfer_foreign_keys,
                    transfer_views,
                    transfer_routines,
                    transfer_triggers,
                    foreign_key_action,
                    column_mappings,
                    error_mode,
                } => {
                    run_transfer_task(
                        &app_handle,
                        &source_id,
                        &source_database,
                        &target_id,
                        &target_database,
                        &tables,
                        mode,
                        conflict_strategy,
                        drop_target,
                        truncate_target,
                        where_clause.as_deref(),
                        row_limit,
                        page_size,
                        parallelism,
                        transfer_indexes,
                        transfer_foreign_keys,
                        transfer_views,
                        transfer_routines,
                        transfer_triggers,
                        foreign_key_action,
                        column_mappings,
                        error_mode,
                    ).await
                }
            };

            task.last_run = Some(now.to_rfc3339());
            task.last_result = Some(match &result {
                Ok(msg) => format!("OK: {}", msg),
                Err(e) => format!("FAIL: {}", e),
            });

            match Schedule::from_str(&task.cron_expr) {
                Ok(sched) => {
                    let next = sched.after(&now);
                    task.next_run = next.into_iter().next().map(|t| t.to_rfc3339());
                }
                Err(_) => task.next_run = None,
            }

            let _ = app_handle.emit("scheduler-task-result", serde_json::json!({
                "task_id": task_id,
                "task_name": task_name,
                "result": match &result {
                    Ok(msg) => format!("OK: {}", msg),
                    Err(e) => format!("FAIL: {}", e),
                },
                "time": now.to_rfc3339(),
            }));
        }

        save_scheduled_tasks(&tasks);
    }
}

async fn run_backup_task(
    app_handle: &tauri::AppHandle,
    source_id: &str,
    database: &str,
    tables: &[String],
    output_path: &str,
) -> Result<String, String> {
    let state: tauri::State<'_, AppState> = app_handle.state();
    let conn = {
        let connections = state.connections.lock().await;
        let c = connections.get(source_id).ok_or("Connection not found")?;
        match c {
            DbConnection::MySql(p) => DbConnection::MySql(p.clone()),
            DbConnection::Pg(p) => DbConnection::Pg(p.clone()),
            DbConnection::Sqlite(p) => DbConnection::Sqlite(p.clone()),
            DbConnection::Mongo(c, db) => DbConnection::Mongo(c.clone(), db.clone()),
            DbConnection::Oracle(c) => DbConnection::Oracle(c.clone()),
            DbConnection::Redis(c) => DbConnection::Redis(c.clone()),
        }
    };

    let (log_tx, mut log_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let app_clone = app_handle.clone();
    tokio::spawn(async move {
        while let Some(msg) = log_rx.recv().await {
            let _ = app_clone.emit("migration-log", msg);
        }
    });

    let (count, _) = db::backup_database(&conn, database, tables, output_path, Some(log_tx)).await?;
    Ok(format!("Backup completed: {} tables", count))
}

async fn run_transfer_task(
    app_handle: &tauri::AppHandle,
    source_id: &str,
    source_database: &str,
    target_id: &str,
    target_database: &str,
    tables: &[String],
    mode: db::types::TransferMode,
    conflict_strategy: db::types::ConflictStrategy,
    drop_target: bool,
    truncate_target: bool,
    where_clause: Option<&str>,
    row_limit: Option<i64>,
    page_size: u32,
    parallelism: u32,
    transfer_indexes: bool,
    transfer_foreign_keys: bool,
    transfer_views: bool,
    transfer_routines: bool,
    transfer_triggers: bool,
    foreign_key_action: db::types::ForeignKeyAction,
    column_mappings: Vec<db::types::ColumnMapping>,
    error_mode: db::types::ErrorMode,
) -> Result<String, String> {
    let state: tauri::State<'_, AppState> = app_handle.state();
    let (source_conn, target_conn) = {
        let connections = state.connections.lock().await;
        let src = connections.get(source_id).ok_or("Source connection not found")?;
        let tgt = connections.get(target_id).ok_or("Target connection not found")?;
        let s = match src {
            DbConnection::MySql(p) => DbConnection::MySql(p.clone()),
            DbConnection::Pg(p) => DbConnection::Pg(p.clone()),
            DbConnection::Sqlite(p) => DbConnection::Sqlite(p.clone()),
            DbConnection::Mongo(c, db) => DbConnection::Mongo(c.clone(), db.clone()),
            DbConnection::Oracle(c) => DbConnection::Oracle(c.clone()),
            DbConnection::Redis(c) => DbConnection::Redis(c.clone()),
        };
        let t = match tgt {
            DbConnection::MySql(p) => DbConnection::MySql(p.clone()),
            DbConnection::Pg(p) => DbConnection::Pg(p.clone()),
            DbConnection::Sqlite(p) => DbConnection::Sqlite(p.clone()),
            DbConnection::Mongo(c, db) => DbConnection::Mongo(c.clone(), db.clone()),
            DbConnection::Oracle(c) => DbConnection::Oracle(c.clone()),
            DbConnection::Redis(c) => DbConnection::Redis(c.clone()),
        };
        (s, t)
    };

    let opts = TransferOptions {
        source_id: source_id.to_string(),
        source_database: source_database.to_string(),
        target_id: target_id.to_string(),
        target_database: target_database.to_string(),
        tables: tables.to_vec(),
        mode,
        conflict_strategy,
        drop_target,
        truncate_target,
        where_clause: where_clause.map(|s| s.to_string()),
        row_limit,
        page_size,
        parallelism,
        transfer_indexes,
        transfer_foreign_keys,
        transfer_views,
        transfer_routines,
        transfer_triggers,
        foreign_key_action,
        column_mappings,
        checkpoint_id: None,
        error_mode,
    };

    let (log_tx, mut log_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let app_clone = app_handle.clone();
    tokio::spawn(async move {
        while let Some(msg) = log_rx.recv().await {
            let _ = app_clone.emit("migration-log", msg);
        }
    });

    let result = db::transfer_data(&source_conn, &target_conn, &opts, Some(log_tx)).await?;
    Ok(format!("Transfer completed: {} tables, {} rows", result.tables_transferred.len(), result.rows_transferred))
}
