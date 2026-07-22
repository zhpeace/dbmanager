pub mod db;
mod license;
mod secrets;

use db::AppState;
use db::DbConnection;
use db::types::{CheckpointState, CompareResult, DatabaseInfo, QueryResult, SchemaCache, TableData, TableInfo, TransferOptions, TransferResult};
use tauri::Emitter;
use mongodb::Client as MongoClient;
use std::sync::{Arc, Mutex};

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
    tauri::Builder::default()
        .manage(AppState::new())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
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
            get_tables,
            get_table_data,
            get_table_ddl,
            execute_query,
            execute_update,
            get_schema_cache,
            transfer_data,
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
                ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
