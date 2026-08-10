pub mod types;
pub mod ddl;
pub mod scheduler;

use std::collections::HashMap;
use sqlx::{Row, Column};
use mongodb::Client as MongoClient;
use std::sync::Arc;
use types::{ColumnInfo, DatabaseInfo, FindMatch, ForeignKeyInfo, IndexInfo, QueryResult, SchemaCache, TableData, TableInfo, TableSchemaInfo, ViewInfo, RoutineInfo, TriggerInfo};

#[derive(Clone)]
pub enum DbConnection {
    MySql(sqlx::MySqlPool),
    Pg(sqlx::PgPool),
    Sqlite(sqlx::SqlitePool),
    Oracle(Arc<std::sync::Mutex<oracle::Connection>>),
    Mongo(MongoClient, String),
    Redis(redis::aio::ConnectionManager),
}

pub enum DbTransaction {
    MySql(sqlx::Transaction<'static, sqlx::MySql>),
    Pg(sqlx::Transaction<'static, sqlx::Postgres>),
    Sqlite(sqlx::Transaction<'static, sqlx::Sqlite>),
    Oracle(Arc<std::sync::Mutex<oracle::Connection>>),
}

pub struct AppState {
    pub connections: tokio::sync::Mutex<HashMap<String, DbConnection>>,
    pub checkpoints: tokio::sync::Mutex<HashMap<String, types::CheckpointState>>,
    pub active_queries: tokio::sync::Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>>,
    pub transactions: tokio::sync::Mutex<HashMap<String, DbTransaction>>,
    pub scheduler: scheduler::SchedulerManager,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            connections: tokio::sync::Mutex::new(HashMap::new()),
            checkpoints: tokio::sync::Mutex::new(HashMap::new()),
            active_queries: tokio::sync::Mutex::new(HashMap::new()),
            transactions: tokio::sync::Mutex::new(HashMap::new()),
            scheduler: scheduler::SchedulerManager::new(Vec::new()),
        }
    }
}

impl DbTransaction {
    pub fn is_supported(&self) -> bool {
        matches!(self, DbTransaction::MySql(_) | DbTransaction::Pg(_) | DbTransaction::Sqlite(_) | DbTransaction::Oracle(_))
    }

    pub async fn execute_query(&mut self, query: &str) -> Result<QueryResult, String> {
        let start = std::time::Instant::now();
        match self {
            DbTransaction::MySql(tx) => {
                use futures_util::TryStreamExt;
                let mut stream = sqlx::raw_sql(query).fetch(&mut **tx);
                let mut rows = Vec::new();
                while let Some(row) = stream.try_next().await.map_err(|e| e.to_string())? {
                    rows.push(row);
                }
                Ok(mysql_rows_to_result(rows, &start))
            }
            DbTransaction::Pg(tx) => {
                use futures_util::TryStreamExt;
                let mut stream = sqlx::raw_sql(query).fetch(&mut **tx);
                let mut rows = Vec::new();
                while let Some(row) = stream.try_next().await.map_err(|e| e.to_string())? {
                    rows.push(row);
                }
                Ok(pg_rows_to_result(rows, &start))
            }
            DbTransaction::Sqlite(tx) => {
                use futures_util::TryStreamExt;
                let mut stream = sqlx::raw_sql(query).fetch(&mut **tx);
                let mut rows = Vec::new();
                while let Some(row) = stream.try_next().await.map_err(|e| e.to_string())? {
                    rows.push(row);
                }
                Ok(sqlite_rows_to_result(rows, &start))
            }
            DbTransaction::Oracle(conn) => {
                let query = query.to_string();
                let conn = conn.clone();
                let result = tokio::task::spawn_blocking(move || {
                    let conn = conn.lock().map_err(|e| e.to_string())?;
                    let trimmed = query.trim_start();
                    let is_select = trimmed.to_uppercase().starts_with("SELECT")
                        || trimmed.to_uppercase().starts_with("WITH")
                        || trimmed.to_uppercase().starts_with("SHOW")
                        || trimmed.to_uppercase().starts_with("DESCRIBE");
                    if is_select {
                        let mut stmt = conn.query(&query, &[]).map_err(|e| e.to_string())?;
                        let cols: Vec<String> = stmt.column_info().iter()
                            .map(|c| c.name().to_string()).collect();
                        let mut rows = Vec::new();
                        while let Some(row) = stmt.next() {
                            let row = row.map_err(|e| e.to_string())?;
                            let mut map = serde_json::Map::new();
                            for (i, col) in cols.iter().enumerate() {
                                let json_val = oracle_decode_value(&row, i);
                                map.insert(col.clone(), json_val);
                            }
                            rows.push(serde_json::Value::Object(map));
                        }
                        let elapsed = format!("{:.2}ms", start.elapsed().as_secs_f64() * 1000.0);
                        let row_count = rows.len();
                        Ok(QueryResult { columns: cols, rows, row_count, duration: elapsed, error: None })
                    } else {
                        let stmt = conn.execute(&query, &[]).map_err(|e| e.to_string())?;
                        let count = stmt.row_count().unwrap_or(0) as usize;
                        let elapsed = format!("{:.2}ms", start.elapsed().as_secs_f64() * 1000.0);
                        Ok(QueryResult { columns: vec![], rows: vec![], row_count: count, duration: elapsed, error: None })
                    }
                })
                .await
                .map_err(|e| e.to_string())?;
                result
            }
        }
    }

    pub async fn execute_update(&mut self, query: &str) -> Result<QueryResult, String> {
        self.execute_query(query).await
    }

    pub async fn execute_batch(&mut self, queries: &[String]) -> Result<u64, String> {
        match self {
            DbTransaction::MySql(tx) => {
                let mut count = 0u64;
                for q in queries {
                    let r = sqlx::query(q.as_str()).execute(&mut **tx).await.map_err(|e| e.to_string())?;
                    count += r.rows_affected();
                }
                Ok(count)
            }
            DbTransaction::Pg(tx) => {
                let mut count = 0u64;
                for q in queries {
                    let r = sqlx::query(q.as_str()).execute(&mut **tx).await.map_err(|e| e.to_string())?;
                    count += r.rows_affected();
                }
                Ok(count)
            }
            DbTransaction::Sqlite(tx) => {
                let mut count = 0u64;
                for q in queries {
                    let r = sqlx::query(q.as_str()).execute(&mut **tx).await.map_err(|e| e.to_string())?;
                    count += r.rows_affected();
                }
                Ok(count)
            }
            DbTransaction::Oracle(conn) => {
                let queries = queries.to_vec();
                let conn = conn.clone();
                let result = tokio::task::spawn_blocking(move || {
                    let conn = conn.lock().map_err(|e| e.to_string())?;
                    let mut count = 0u64;
                    for q in &queries {
                        let r = conn.execute(q, &[]).map_err(|e| e.to_string())?;
                        count += r.row_count().unwrap_or(0) as u64;
                    }
                    Ok(count)
                })
                .await
                .map_err(|e| e.to_string())?;
                result
            }
        }
    }

    pub async fn commit(self) -> Result<(), String> {
        match self {
            DbTransaction::MySql(tx) => tx.commit().await.map_err(|e| e.to_string()),
            DbTransaction::Pg(tx) => tx.commit().await.map_err(|e| e.to_string()),
            DbTransaction::Sqlite(tx) => tx.commit().await.map_err(|e| e.to_string()),
            DbTransaction::Oracle(conn) => {
                tokio::task::spawn_blocking(move || {
                    conn.lock().map_err(|e| e.to_string())?.commit().map_err(|e| e.to_string())
                })
                .await
                .map_err(|e| e.to_string())?
            }
        }
    }

    pub async fn rollback(self) -> Result<(), String> {
        match self {
            DbTransaction::MySql(tx) => tx.rollback().await.map_err(|e| e.to_string()),
            DbTransaction::Pg(tx) => tx.rollback().await.map_err(|e| e.to_string()),
            DbTransaction::Sqlite(tx) => tx.rollback().await.map_err(|e| e.to_string()),
            DbTransaction::Oracle(conn) => {
                tokio::task::spawn_blocking(move || {
                    conn.lock().map_err(|e| e.to_string())?.rollback().map_err(|e| e.to_string())
                })
                .await
                .map_err(|e| e.to_string())?
            }
        }
    }
}

fn mysql_column_info_free(col: &sqlx::mysql::MySqlColumn) -> ColumnInfo {
    ColumnInfo {
        name: col.name().to_string(),
        data_type: col.type_info().to_string(),
        nullable: true,
        key: String::new(),
        default_value: None,
        extra: String::new(),
    }
}

fn mysql_decode_value_free(row: &sqlx::mysql::MySqlRow, col: &ColumnInfo) -> serde_json::Value {
    let name = col.name.as_str();
    let t = col.data_type.to_lowercase();
    let opt: Option<serde_json::Value> = if t.contains("tinyint(1)") || t == "boolean" || t == "bool" {
        row.try_get::<Option<bool>, _>(name).ok().map(|v| serde_json::Value::Bool(v.unwrap_or(false)))
    } else if t.contains("int") || t.contains("year") {
        if let Ok(v) = row.try_get::<Option<i64>, _>(name) {
            v.map(|x| serde_json::Value::from(x))
        } else if let Ok(v) = row.try_get::<Option<u64>, _>(name) {
            v.map(|x| serde_json::Value::from(x))
        } else {
            row.try_get::<Option<String>, _>(name).ok().flatten().map(serde_json::Value::String)
        }
    } else if t.contains("decimal") || t.contains("float") || t.contains("double") || t.contains("numeric") || t.contains("real") {
        if let Ok(v) = row.try_get::<Option<f64>, _>(name) {
            v.map(|x| serde_json::Value::from(x))
        } else {
            row.try_get::<Option<String>, _>(name).ok().flatten().map(serde_json::Value::String)
        }
    } else if t.contains("datetime") || t.contains("timestamp") || t.contains("date") || t.contains("time") {
        match row.try_get::<Option<chrono::NaiveDateTime>, _>(name) {
            Ok(v) => v.map(|x| serde_json::Value::String(x.to_string())),
            Err(_) => row.try_get::<Option<String>, _>(name).ok().flatten().map(serde_json::Value::String),
        }
    } else if t.contains("json") {
        row.try_get::<Option<serde_json::Value>, _>(name).ok().flatten()
    } else if t.contains("blob") || t.contains("binary") || t.contains("varbinary") {
        match row.try_get::<Option<Vec<u8>>, _>(name) {
            Ok(v) => v.map(|b| {
                if b.iter().all(|&c| c == 0 || (c >= 32 && c < 127)) {
                    serde_json::Value::String(String::from_utf8_lossy(&b).to_string())
                } else {
                    serde_json::Value::String(format!("0x{}", b.iter().map(|c| format!("{:02x}", c)).collect::<String>()))
                }
            }),
            Err(_) => None,
        }
    } else {
        row.try_get::<Option<String>, _>(name).ok().flatten().map(serde_json::Value::String)
    };
    opt.unwrap_or(serde_json::Value::Null)
}

fn pg_column_info_free(col: &sqlx::postgres::PgColumn) -> ColumnInfo {
    ColumnInfo {
        name: col.name().to_string(),
        data_type: col.type_info().to_string(),
        nullable: true,
        key: String::new(),
        default_value: None,
        extra: String::new(),
    }
}

fn pg_decode_value_free(row: &sqlx::postgres::PgRow, col: &ColumnInfo) -> serde_json::Value {
    let name = col.name.as_str();
    let t = col.data_type.to_lowercase();
    let opt: Option<serde_json::Value> = if t.contains("bool") {
        row.try_get::<Option<bool>, _>(name).ok().map(|v| serde_json::Value::Bool(v.unwrap_or(false)))
    } else if t.contains("int") || t.contains("oid") {
        if let Ok(v) = row.try_get::<Option<i32>, _>(name) {
            v.map(serde_json::Value::from)
        } else {
            row.try_get::<Option<i64>, _>(name).ok().flatten().map(serde_json::Value::from)
        }
    } else if t.contains("float") || t.contains("double") || t.contains("numeric") || t.contains("real") || t.contains("money") {
        if let Ok(v) = row.try_get::<Option<f32>, _>(name) {
            v.map(serde_json::Value::from)
        } else {
            row.try_get::<Option<f64>, _>(name).ok().flatten().map(serde_json::Value::from)
        }
    } else if t.contains("timestamp") || t.contains("date") || t.contains("time") {
        if let Ok(v) = row.try_get::<Option<chrono::NaiveDateTime>, _>(name) {
            v.map(|x| serde_json::Value::String(x.to_string()))
        } else if let Ok(v) = row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>(name) {
            v.map(|x| serde_json::Value::String(x.to_string()))
        } else {
            row.try_get::<Option<String>, _>(name).ok().flatten().map(serde_json::Value::String)
        }
    } else if t.contains("json") {
        row.try_get::<Option<serde_json::Value>, _>(name).ok().flatten()
    } else if t.contains("uuid") {
        row.try_get::<Option<uuid::Uuid>, _>(name).ok().flatten().map(|x| serde_json::Value::String(x.to_string()))
    } else if t.contains("bytea") || t.contains("bytes") {
        row.try_get::<Option<Vec<u8>>, _>(name).ok().flatten().map(|b| {
            serde_json::Value::String(if b.iter().all(|&c| c == 0 || (c >= 32 && c < 127)) {
                String::from_utf8_lossy(&b).to_string()
            } else {
                format!("0x{}", b.iter().map(|c| format!("{:02x}", c)).collect::<String>())
            })
        })
    } else {
        row.try_get::<Option<String>, _>(name).ok().flatten().map(serde_json::Value::String)
    };
    opt.unwrap_or(serde_json::Value::Null)
}

fn sqlite_column_info_free(col: &sqlx::sqlite::SqliteColumn) -> ColumnInfo {
    ColumnInfo {
        name: col.name().to_string(),
        data_type: col.type_info().to_string(),
        nullable: true,
        key: String::new(),
        default_value: None,
        extra: String::new(),
    }
}

fn sqlite_decode_value_free(row: &sqlx::sqlite::SqliteRow, col: &ColumnInfo) -> serde_json::Value {
    let name = col.name.as_str();
    let t = col.data_type.to_lowercase();
    if t.contains("blob") || t.contains("binary") || t.contains("bytea") || t.contains("bytes") {
        return match row.try_get::<Option<Vec<u8>>, _>(name) {
            Ok(Some(b)) => {
                serde_json::Value::String(if b.iter().all(|&c| c == 0 || (c >= 32 && c < 127)) {
                    String::from_utf8_lossy(&b).to_string()
                } else {
                    format!("0x{}", b.iter().map(|c| format!("{:02x}", c)).collect::<String>())
                })
            }
            _ => serde_json::Value::Null,
        };
    }
    let opt: Option<serde_json::Value> = row.try_get::<Option<String>, _>(name).ok().flatten().map(serde_json::Value::String)
        .or_else(|| row.try_get::<Option<i64>, _>(name).ok().flatten().map(serde_json::Value::from))
        .or_else(|| row.try_get::<Option<f64>, _>(name).ok().flatten().map(serde_json::Value::from))
        .or_else(|| row.try_get::<Option<bool>, _>(name).ok().flatten().map(serde_json::Value::Bool));
    opt.unwrap_or(serde_json::Value::Null)
}

fn oracle_decode_value(row: &oracle::Row, idx: usize) -> serde_json::Value {
    if let Ok(v) = row.get::<usize, i64>(idx) {
        return serde_json::Value::from(v);
    }
    if let Ok(v) = row.get::<usize, f64>(idx) {
        return serde_json::Value::from(v);
    }
    if let Ok(v) = row.get::<usize, bool>(idx) {
        return serde_json::Value::Bool(v);
    }
    if let Ok(v) = row.get::<usize, chrono::NaiveDateTime>(idx) {
        return serde_json::Value::String(v.to_string());
    }
    if let Ok(v) = row.get::<usize, Vec<u8>>(idx) {
        let b = v;
        if b.iter().all(|&c| c == 0 || (c >= 32 && c < 127)) {
            return serde_json::Value::String(String::from_utf8_lossy(&b).to_string());
        }
        return serde_json::Value::String(format!("0x{}", b.iter().map(|c| format!("{:02x}", c)).collect::<String>()));
    }
    if let Ok(v) = row.get::<usize, String>(idx) {
        return serde_json::Value::String(v);
    }
    serde_json::Value::Null
}

fn mysql_rows_to_result(rows: Vec<sqlx::mysql::MySqlRow>, start: &std::time::Instant) -> QueryResult {
    let elapsed = format!("{:.2}ms", start.elapsed().as_secs_f64() * 1000.0);
    if rows.is_empty() {
        return QueryResult { columns: vec![], rows: vec![], row_count: 0, duration: elapsed, error: None };
    }
    let columns: Vec<ColumnInfo> = rows[0].columns().iter().map(|c| mysql_column_info_free(c)).collect();
    let col_names: Vec<String> = columns.iter().map(|c| c.name.clone()).collect();
    let json_rows: Vec<serde_json::Value> = rows.iter().map(|row| {
        let mut map = serde_json::Map::new();
        for col in &columns {
            let val = mysql_decode_value_free(row, col);
            map.insert(col.name.clone(), val);
        }
        serde_json::Value::Object(map)
    }).collect();
    QueryResult { columns: col_names, row_count: json_rows.len(), rows: json_rows, duration: elapsed, error: None }
}

fn pg_rows_to_result(rows: Vec<sqlx::postgres::PgRow>, start: &std::time::Instant) -> QueryResult {
    let elapsed = format!("{:.2}ms", start.elapsed().as_secs_f64() * 1000.0);
    if rows.is_empty() {
        return QueryResult { columns: vec![], rows: vec![], row_count: 0, duration: elapsed, error: None };
    }
    let columns: Vec<ColumnInfo> = rows[0].columns().iter().map(|c| pg_column_info_free(c)).collect();
    let col_names: Vec<String> = columns.iter().map(|c| c.name.clone()).collect();
    let json_rows: Vec<serde_json::Value> = rows.iter().map(|row| {
        let mut map = serde_json::Map::new();
        for col in &columns {
            let val = pg_decode_value_free(row, col);
            map.insert(col.name.clone(), val);
        }
        serde_json::Value::Object(map)
    }).collect();
    QueryResult { columns: col_names, row_count: json_rows.len(), rows: json_rows, duration: elapsed, error: None }
}

fn sqlite_rows_to_result(rows: Vec<sqlx::sqlite::SqliteRow>, start: &std::time::Instant) -> QueryResult {
    let elapsed = format!("{:.2}ms", start.elapsed().as_secs_f64() * 1000.0);
    if rows.is_empty() {
        return QueryResult { columns: vec![], rows: vec![], row_count: 0, duration: elapsed, error: None };
    }
    let columns: Vec<ColumnInfo> = rows[0].columns().iter().map(|c| sqlite_column_info_free(c)).collect();
    let col_names: Vec<String> = columns.iter().map(|c| c.name.clone()).collect();
    let json_rows: Vec<serde_json::Value> = rows.iter().map(|row| {
        let mut map = serde_json::Map::new();
        for col in &columns {
            let val = sqlite_decode_value_free(row, col);
            map.insert(col.name.clone(), val);
        }
        serde_json::Value::Object(map)
    }).collect();
    QueryResult { columns: col_names, row_count: json_rows.len(), rows: json_rows, duration: elapsed, error: None }
}

fn extract_primary_keys(cache: &crate::db::types::SchemaCache, table: &str) -> Vec<String> {
    cache
        .tables
        .iter()
        .find(|t| t.table.eq_ignore_ascii_case(table))
        .map(|t| {
            t.columns
                .iter()
                .filter(|c| c.key == "PRI" || c.key == "PK" || c.key.to_uppercase() == "PRIMARY KEY")
                .map(|c| c.name.clone())
                .collect()
        })
        .unwrap_or_default()
}

fn build_row_handles(
    rows: &[serde_json::Value],
    primary_keys: &[String],
) -> Vec<serde_json::Value> {
    rows.iter()
        .map(|row| {
            let obj = row.as_object().cloned().unwrap_or_default();
            let handle: serde_json::Map<String, serde_json::Value> = if !primary_keys.is_empty() {
                primary_keys
                    .iter()
                    .map(|pk| (pk.clone(), obj.get(pk).cloned().unwrap_or(serde_json::Value::Null)))
                    .collect()
            } else {
                obj.into_iter()
                    .filter(|(k, _)| k == "__rowid__" || k == "ROWID2")
                    .collect()
            };
            serde_json::Value::Object(handle)
        })
        .collect()
}

impl DbConnection {
    pub async fn get_databases(&self) -> Result<Vec<DatabaseInfo>, String> {
        match self {
            DbConnection::MySql(pool) => {
                let rows = sqlx::raw_sql("SHOW DATABASES")
                    .fetch_all(pool)
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(rows
                    .into_iter()
                    .map(|r| DatabaseInfo {
                        name: r.get::<String, _>(0),
                    })
                    .collect())
            }
            DbConnection::Pg(pool) => {
                let rows = sqlx::query(
                    "SELECT datname FROM pg_database WHERE datistemplate = false",
                )
                .fetch_all(pool)
                .await
                .map_err(|e| e.to_string())?;
                Ok(rows
                    .into_iter()
                    .map(|r| DatabaseInfo {
                        name: r.get::<String, _>(0),
                    })
                    .collect())
            }
            DbConnection::Sqlite(_pool) => {
                Ok(vec![DatabaseInfo {
                    name: "main".to_string(),
                }])
            }
            DbConnection::Mongo(client, _db_name) => {
                let names = client
                    .list_database_names()
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(names.into_iter().map(|n| DatabaseInfo { name: n }).collect())
            }
            DbConnection::Oracle(conn) => {
                let conn = conn.clone();
                let result = tokio::time::timeout(
                    std::time::Duration::from_secs(5),
                    tokio::task::spawn_blocking(move || -> Result<Vec<String>, String> {
                        let conn = conn.lock().map_err(|e| format!("Oracle lock failed: {}", e))?;
                        let mut stmt = conn.query("SELECT username FROM all_users ORDER BY username", &[])
                            .map_err(|e| format!("Oracle query failed: {}", e))?;
                        let mut names = Vec::new();
                        while let Some(row) = stmt.next() {
                            let row = row.map_err(|e| format!("Oracle row failed: {}", e))?;
                            if let Ok(name) = row.get::<usize, String>(0) {
                                names.push(name);
                            }
                        }
                        Ok(names)
                    })
                ).await;
                let names = match result {
                    Ok(Ok(Ok(names))) => names,
                    Ok(Ok(Err(e))) => return Err(e),
                    Ok(Err(join_err)) => return Err(format!("Oracle thread failed: {}", join_err)),
                    Err(_) => vec!["ORCL".to_string()],
                };
                Ok(names.into_iter().map(|n| DatabaseInfo { name: n }).collect())
            }
            DbConnection::Redis(conn) => {
                let mut conn = conn.clone();
                let result: Vec<String> = redis::cmd("CONFIG")
                    .arg("GET")
                    .arg("databases")
                    .query_async(&mut conn)
                    .await
                    .map_err(|e| e.to_string())?;
                let count: i64 = result.get(1).and_then(|s| s.parse().ok()).unwrap_or(16);
                Ok((0..count).map(|i| DatabaseInfo { name: format!("db{}", i) }).collect())
            }
        }
    }

    pub async fn get_schemas(&self) -> Result<Vec<DatabaseInfo>, String> {
        match self {
            DbConnection::Pg(pool) => {
                let rows = sqlx::query(
                    "SELECT nspname FROM pg_catalog.pg_namespace \
                     WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' \
                     AND nspname NOT IN ('blockchain','cstore','db4ai','dbe_perf','dbe_pldebugger','dbe_pldeveloper','dbe_sql_util','pkg_service','snapshot','sqladvisor') \
                     ORDER BY nspname",
                )
                .fetch_all(pool)
                .await
                .map_err(|e| e.to_string())?;
                Ok(rows
                    .into_iter()
                    .map(|r| DatabaseInfo { name: r.get::<String, _>(0) })
                    .collect())
            }
            _ => Ok(vec![]),
        }
    }

    pub async fn create_database(&self, db_name: &str) -> Result<(), String> {
        match self {
            DbConnection::MySql(pool) => {
                let sql = format!("CREATE DATABASE `{}`", db_name);
                sqlx::raw_sql(&sql)
                    .execute(pool)
                    .await
                    .map_err(|e| format!("Failed to create database: {}", e))?;
                Ok(())
            }
            DbConnection::Pg(pool) => {
                let sql = format!("CREATE DATABASE \"{}\"", db_name);
                sqlx::raw_sql(&sql)
                    .execute(pool)
                    .await
                    .map_err(|e| format!("Failed to create database: {}", e))?;
                Ok(())
            }
            DbConnection::Sqlite(_) => Err("SQLite does not support creating databases".to_string()),
            DbConnection::Mongo(client, _) => {
                let db = client.database(db_name);
                let _ = db
                    .run_command(mongodb::bson::doc! { "ping": 1 })
                    .await
                    .map_err(|e| format!("Failed to create MongoDB database: {}", e))?;
                Ok(())
            }
            DbConnection::Oracle(_) => {
                let sql = format!("CREATE DATABASE {}", db_name);
                self.execute_update(&sql).await?;
                Ok(())
            }
            DbConnection::Redis(_) => Err("Redis does not support creating databases".to_string()),
        }
    }

    pub async fn drop_database(&self, db_name: &str) -> Result<(), String> {
        match self {
            DbConnection::MySql(pool) => {
                let sql = format!("DROP DATABASE `{}`", db_name);
                sqlx::raw_sql(&sql)
                    .execute(pool)
                    .await
                    .map_err(|e| format!("Failed to drop database: {}", e))?;
                Ok(())
            }
            DbConnection::Pg(pool) => {
                let sql = format!("DROP DATABASE \"{}\"", db_name);
                sqlx::raw_sql(&sql)
                    .execute(pool)
                    .await
                    .map_err(|e| format!("Failed to drop database: {}", e))?;
                Ok(())
            }
            DbConnection::Sqlite(_) => Err("SQLite does not support dropping databases".to_string()),
            DbConnection::Mongo(client, _) => {
                let db = client.database(db_name);
                db.drop()
                    .await
                    .map_err(|e| format!("Failed to drop MongoDB database: {}", e))?;
                Ok(())
            }
            DbConnection::Oracle(_) => {
                let sql = format!("DROP DATABASE {}", db_name);
                self.execute_update(&sql).await?;
                Ok(())
            }
            DbConnection::Redis(_) => Err("Redis does not support dropping databases".to_string()),
        }
    }

    pub async fn get_tables(&self, database: &str) -> Result<Vec<TableInfo>, String> {
        let res = match self {
            DbConnection::MySql(pool) => {
                let mut result: Vec<TableInfo> = Vec::new();
                let tbl_sql = format!(
                    "SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES \
                     WHERE TABLE_SCHEMA = '{}' ORDER BY TABLE_TYPE, TABLE_NAME",
                    database.replace('\'', "\\'")
                );
                let rows = sqlx::raw_sql(&tbl_sql)
                    .fetch_all(pool)
                    .await
                    .map_err(|e| e.to_string())?;
                for r in rows {
                    let raw_name: Vec<u8> = r.get::<Vec<u8>, _>(0);
                    let raw: Vec<u8> = r.get::<Vec<u8>, _>(1);
                    let type_str = String::from_utf8_lossy(&raw).to_string();
                    result.push(TableInfo {
                        name: String::from_utf8_lossy(&raw_name).to_string(),
                        object_type: type_str.trim_start_matches("SYSTEM ").to_string(),
                        schema: Some(database.to_string()),
                    });
                }
                let routine_sql = format!(
                    "SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES \
                     WHERE ROUTINE_SCHEMA = '{}' ORDER BY ROUTINE_TYPE, ROUTINE_NAME",
                    database.replace('\'', "\\'")
                );
                match sqlx::raw_sql(&routine_sql).fetch_all(pool).await {
                Ok(rrows) => {
                    for r in rrows {
                        let raw: Vec<u8> = r.get::<Vec<u8>, _>(1);
                        let t = String::from_utf8_lossy(&raw).to_string().to_uppercase();
                        let obj_type = if t.contains("PROCEDURE") { "PROCEDURE" } else { "FUNCTION" };
                        result.push(TableInfo {
                            name: r.get::<String, _>(0),
                            object_type: obj_type.to_string(),
                            schema: Some(database.to_string()),
                        });
                    }
                }
                Err(_) => {}
                }
                let trig_sql = format!(
                    "SELECT TRIGGER_NAME FROM information_schema.TRIGGERS \
                     WHERE TRIGGER_SCHEMA = '{}' ORDER BY TRIGGER_NAME",
                    database.replace('\'', "\\'")
                );
                match sqlx::raw_sql(&trig_sql).fetch_all(pool).await {
                Ok(trows) => {
                    for r in trows {
                        result.push(TableInfo {
                            name: r.get::<String, _>(0),
                            object_type: "TRIGGER".to_string(),
                            schema: Some(database.to_string()),
                        });
                    }
                }
                Err(_) => {}
                }
                Ok(result)
            }
            DbConnection::Pg(pool) => {
                let mut result: Vec<TableInfo> = Vec::new();
                let rows = sqlx::query(
                    "SELECT schemaname, tablename, 'TABLE' FROM pg_catalog.pg_tables \
                     WHERE schemaname NOT LIKE 'pg_%' AND schemaname <> 'information_schema' \
                     AND schemaname NOT IN ('blockchain','cstore','db4ai','dbe_perf','dbe_pldebugger','dbe_pldeveloper','dbe_sql_util','pkg_service','snapshot','sqladvisor') \
                     UNION ALL \
                     SELECT schemaname, viewname, 'VIEW' FROM pg_catalog.pg_views \
                     WHERE schemaname NOT LIKE 'pg_%' AND schemaname <> 'information_schema' \
                     AND schemaname NOT IN ('blockchain','cstore','db4ai','dbe_perf','dbe_pldebugger','dbe_pldeveloper','dbe_sql_util','pkg_service','snapshot','sqladvisor') \
                     ORDER BY 2, 1",
                )
                .fetch_all(pool)
                .await
                .map_err(|e| e.to_string())?;
                for r in rows {
                    result.push(TableInfo {
                        name: r.get::<String, _>(1),
                        object_type: r.get::<String, _>(2),
                        schema: Some(r.get::<String, _>(0)),
                    });
                }
                let func_rows = sqlx::query(
                    "SELECT n.nspname, p.proname, CASE WHEN p.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END \
                     FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace \
                     WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' \
                     AND n.nspname NOT IN ('blockchain','cstore','db4ai','dbe_perf','dbe_pldebugger','dbe_pldeveloper','dbe_sql_util','pkg_service','snapshot','sqladvisor') ORDER BY 2, 1",
                )
                .fetch_all(pool)
                .await;
                if let Ok(frows) = func_rows {
                    for r in frows {
                        result.push(TableInfo {
                            name: r.get::<String, _>(1),
                            object_type: r.get::<String, _>(2),
                            schema: Some(r.get::<String, _>(0)),
                        });
                    }
                }
                let trig_rows = sqlx::query(
                    "SELECT n.nspname, t.tgname FROM pg_catalog.pg_trigger t \
                     JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid \
                     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
                     WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' \
                     AND n.nspname NOT IN ('blockchain','cstore','db4ai','dbe_perf','dbe_pldebugger','dbe_pldeveloper','dbe_sql_util','pkg_service','snapshot','sqladvisor') \
                     AND NOT t.tgisinternal ORDER BY t.tgname",
                )
                .fetch_all(pool)
                .await;
                if let Ok(trows) = trig_rows {
                    for r in trows {
                        result.push(TableInfo {
                            name: r.get::<String, _>(1),
                            object_type: "TRIGGER".to_string(),
                            schema: Some(r.get::<String, _>(0)),
                        });
                    }
                }
                Ok(result)
            }
            DbConnection::Sqlite(pool) => {
                let rows = sqlx::query(
                    "SELECT name, type FROM sqlite_master WHERE type IN ('table','view','trigger') ORDER BY type, name",
                )
                .fetch_all(pool)
                .await
                .map_err(|e| e.to_string())?;
                Ok(rows
                    .into_iter()
                    .map(|r| TableInfo {
                        name: r.get::<String, _>(0),
                        object_type: r.get::<String, _>(1).to_uppercase(),
                        schema: None,
                    })
                    .collect())
            }
            DbConnection::Mongo(client, db_name) => {
                let db = client.database(db_name);
                let names = db
                    .list_collection_names()
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(names.into_iter().map(|n| TableInfo {
                    name: n,
                    object_type: "COLLECTION".to_string(),
                    schema: Some(db_name.clone()),
                }).collect())
            }
            DbConnection::Oracle(conn) => {
                let conn = conn.clone();
                let database = database.to_string();
                let tables = tokio::task::spawn_blocking(move || {
                    let conn = conn.lock().map_err(|e| e.to_string())?;
                    let owner = database.to_uppercase();
                    let sql = format!(
                        "SELECT table_name, 'TABLE' FROM all_tables WHERE owner = '{}' \
                         UNION ALL \
                         SELECT view_name, 'VIEW' FROM all_views WHERE owner = '{}' \
                         UNION ALL \
                         SELECT object_name, object_type FROM all_procedures WHERE owner = '{}' AND object_type IN ('FUNCTION','PROCEDURE') \
                         UNION ALL \
                         SELECT trigger_name, 'TRIGGER' FROM all_triggers WHERE owner = '{}' \
                         ORDER BY 2, 1",
                        owner.replace('\'', "''"),
                        owner.replace('\'', "''"),
                        owner.replace('\'', "''"),
                        owner.replace('\'', "''"),
                    );
                    let mut stmt = conn.query(&sql, &[]).map_err(|e| e.to_string())?;
                    let mut result = Vec::new();
                    while let Some(row) = stmt.next() {
                        let row = row.map_err(|e| e.to_string())?;
                        result.push(TableInfo {
                            name: row.get::<usize, String>(0).unwrap_or_default(),
                            object_type: row.get::<usize, String>(1).unwrap_or_default(),
                            schema: Some(database.clone()),
                        });
                    }
                    Ok(result)
                }).await.map_err(|e| e.to_string())?;
                tables
            }
            DbConnection::Redis(conn) => {
                let mut conn = conn.clone();
                let db_index: i64 = database.trim_start_matches("db").parse().unwrap_or(0);
                let _ = redis::cmd("SELECT").arg(db_index).query_async::<()>(&mut conn).await;
                let mut cursor = 0i64;
                let mut keys = Vec::new();
                loop {
                    let result: (i64, Vec<String>) = redis::cmd("SCAN")
                        .arg(cursor).arg("COUNT").arg(100)
                        .query_async(&mut conn).await.map_err(|e| e.to_string())?;
                    cursor = result.0;
                    for key in result.1 {
                        keys.push(TableInfo {
                            name: key,
                            object_type: "KEY".to_string(),
                            schema: Some(database.to_string()),
                        });
                    }
                    if cursor == 0 { break; }
                }
                Ok(keys)
            }
        };
        let _ = &res.as_ref().map(|list| {
            let mut counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
            for ti in list { *counts.entry(ti.object_type.clone()).or_insert(0) += 1; }
        });
        res
    }

    pub async fn execute_query(&self, query: &str) -> Result<QueryResult, String> {
        self.execute_query_with_cancel(query, None).await
    }

    pub async fn execute_query_with_cancel(
        &self,
        query: &str,
        cancel: Option<Arc<std::sync::atomic::AtomicBool>>,
    ) -> Result<QueryResult, String> {
        let start = std::time::Instant::now();
        let query = query.to_owned();
        let is_cancelled = || {
            cancel
                .as_ref()
                .is_some_and(|f| f.load(std::sync::atomic::Ordering::Relaxed))
        };

        match self {
            DbConnection::MySql(pool) => {
                use futures_util::TryStreamExt;
                let mut stream = sqlx::raw_sql(&query).fetch(pool);
                let mut rows = Vec::new();
                while let Some(row) = stream.try_next().await.map_err(|e| e.to_string())? {
                    if is_cancelled() {
                        return Err("Query cancelled".to_string());
                    }
                    rows.push(row);
                }
                Ok(mysql_rows_to_result(rows, &start))
            }
            DbConnection::Pg(pool) => {
                use futures_util::TryStreamExt;
                let mut stream = sqlx::raw_sql(&query).fetch(pool);
                let mut rows = Vec::new();
                while let Some(row) = stream.try_next().await.map_err(|e| e.to_string())? {
                    if is_cancelled() {
                        return Err("Query cancelled".to_string());
                    }
                    rows.push(row);
                }
                Ok(pg_rows_to_result(rows, &start))
            }
            DbConnection::Sqlite(pool) => {
                use futures_util::TryStreamExt;
                let mut stream = sqlx::raw_sql(&query).fetch(pool);
                let mut rows = Vec::new();
                while let Some(row) = stream.try_next().await.map_err(|e| e.to_string())? {
                    if is_cancelled() {
                        return Err("Query cancelled".to_string());
                    }
                    rows.push(row);
                }
                Ok(sqlite_rows_to_result(rows, &start))
            }
            DbConnection::Mongo(_client, _db) => {
                Err("SQL queries are not supported for MongoDB connections".to_string())
            }
            DbConnection::Oracle(conn) => {
                let query = query.clone();
                let conn = conn.clone();
                let cancel_flag = cancel.clone();
                let result = tokio::task::spawn_blocking(move || {
                    let conn = conn.lock().map_err(|e| e.to_string())?;
                    let trimmed = query.trim_start();
                    let is_select = trimmed.to_uppercase().starts_with("SELECT")
                        || trimmed.to_uppercase().starts_with("WITH")
                        || trimmed.to_uppercase().starts_with("SHOW")
                        || trimmed.to_uppercase().starts_with("DESCRIBE");
                    if is_select {
                        let mut stmt = conn.query(&query, &[]).map_err(|e| e.to_string())?;
                        let cols: Vec<String> = stmt.column_info().iter()
                            .map(|c| c.name().to_string()).collect();
                        let mut rows = Vec::new();
                        while let Some(row) = stmt.next() {
                            if cancel_flag.as_ref().is_some_and(|f| f.load(std::sync::atomic::Ordering::Relaxed)) {
                                return Err::<QueryResult, String>("Query cancelled".to_string());
                            }
                            let row = row.map_err(|e| e.to_string())?;
                            let mut map = serde_json::Map::new();
                            for (i, col) in cols.iter().enumerate() {
                                let json_val = oracle_decode_value(&row, i);
                                map.insert(col.clone(), json_val);
                            }
                            rows.push(serde_json::Value::Object(map));
                        }
                        Ok::<QueryResult, String>(QueryResult {
                            columns: cols,
                            row_count: rows.len(),
                            rows,
                            duration: format!("{:.2}ms", start.elapsed().as_secs_f64() * 1000.0),
                            error: None,
                        })
                    } else {
                        let stmt = conn.execute(&query, &[]).map_err(|e| e.to_string())?;
                        let count = stmt.row_count().unwrap_or(0) as usize;
                        Ok::<QueryResult, String>(QueryResult {
                            columns: vec![],
                            rows: vec![],
                            row_count: count,
                            duration: format!("{:.2}ms", start.elapsed().as_secs_f64() * 1000.0),
                            error: None,
                        })
                    }
                }).await.map_err(|e| e.to_string())?;
                result
            }
            DbConnection::Redis(conn) => {
                let mut conn = conn.clone();
                let parts: Vec<&str> = query.split_whitespace().collect();
                if parts.is_empty() {
                    return Err("Empty command".to_string());
                }
                let cmd = parts[0].to_uppercase();
                let args: Vec<&str> = parts[1..].to_vec();
                let mut redis_cmd = redis::Cmd::new();
                redis_cmd.arg(cmd.as_str());
                for arg in &args {
                    redis_cmd.arg(arg);
                }
                let result: Result<String, redis::RedisError> = redis_cmd.query_async(&mut conn).await;
                match result {
                    Ok(val) => Ok(QueryResult {
                        columns: vec!["result".to_string()],
                        rows: vec![serde_json::json!({"result": val})],
                        row_count: 1,
                        duration: format!("{:.2}ms", start.elapsed().as_secs_f64() * 1000.0),
                        error: None,
                    }),
                    Err(e) => Err(format!("Redis error: {}", e)),
                }
            }
        }
    }

    fn mysql_column_info(col: &sqlx::mysql::MySqlColumn) -> ColumnInfo {
        ColumnInfo {
            name: col.name().to_string(),
            data_type: col.type_info().to_string(),
            nullable: true,
            key: String::new(),
            default_value: None,
            extra: String::new(),
        }
    }

    fn mysql_decode_value(
        row: &sqlx::mysql::MySqlRow,
        col: &ColumnInfo,
    ) -> serde_json::Value {
        let name = col.name.as_str();
        let t = col.data_type.to_lowercase();
        let opt: Option<serde_json::Value> = if t.contains("tinyint(1)") || t == "boolean" || t == "bool" {
            row.try_get::<Option<bool>, _>(name).ok().map(|v| serde_json::Value::Bool(v.unwrap_or(false)))
        } else if t.contains("int") || t.contains("year") {
            if let Ok(v) = row.try_get::<Option<i64>, _>(name) {
                v.map(|x| serde_json::Value::from(x))
            } else if let Ok(v) = row.try_get::<Option<u64>, _>(name) {
                v.map(|x| serde_json::Value::from(x))
            } else {
                row.try_get::<Option<String>, _>(name).ok().flatten().map(serde_json::Value::String)
            }
        } else if t.contains("decimal") || t.contains("float") || t.contains("double") || t.contains("numeric") || t.contains("real") {
            if let Ok(v) = row.try_get::<Option<f64>, _>(name) {
                v.map(|x| serde_json::Value::from(x))
            } else {
                row.try_get::<Option<String>, _>(name).ok().flatten().map(serde_json::Value::String)
            }
        } else if t.contains("datetime") || t.contains("timestamp") || t.contains("date") || t.contains("time") {
            match row.try_get::<Option<chrono::NaiveDateTime>, _>(name) {
                Ok(v) => v.map(|x| serde_json::Value::String(x.to_string())),
                Err(_) => row.try_get::<Option<String>, _>(name).ok().flatten().map(serde_json::Value::String),
            }
        } else if t.contains("json") {
            row.try_get::<Option<serde_json::Value>, _>(name).ok().flatten()
        } else if t.contains("blob") || t.contains("binary") || t.contains("varbinary") {
            match row.try_get::<Option<Vec<u8>>, _>(name) {
                Ok(v) => v.map(|b| {
                    if b.iter().all(|&c| c == 0 || (c >= 32 && c < 127)) {
                        serde_json::Value::String(String::from_utf8_lossy(&b).to_string())
                    } else {
                        serde_json::Value::String(format!("0x{}", b.iter().map(|c| format!("{:02x}", c)).collect::<String>()))
                    }
                }),
                Err(_) => None,
            }
        } else {
            // varchar, char, text, enum, set, etc -> string
            row.try_get::<Option<String>, _>(name).ok().flatten().map(serde_json::Value::String)
        };
        opt.unwrap_or(serde_json::Value::Null)
    }

    fn pg_column_info(col: &sqlx::postgres::PgColumn) -> ColumnInfo {
        ColumnInfo {
            name: col.name().to_string(),
            data_type: col.type_info().to_string(),
            nullable: true,
            key: String::new(),
            default_value: None,
            extra: String::new(),
        }
    }

    fn pg_decode_value(
        row: &sqlx::postgres::PgRow,
        col: &ColumnInfo,
    ) -> serde_json::Value {
        let name = col.name.as_str();
        let t = col.data_type.to_lowercase();
        let opt: Option<serde_json::Value> = if t.contains("bool") {
            row.try_get::<Option<bool>, _>(name).ok().map(|v| serde_json::Value::Bool(v.unwrap_or(false)))
        } else if t.contains("int") || t.contains("oid") {
            if let Ok(v) = row.try_get::<Option<i32>, _>(name) {
                v.map(serde_json::Value::from)
            } else {
                row.try_get::<Option<i64>, _>(name).ok().flatten().map(serde_json::Value::from)
            }
        } else if t.contains("float") || t.contains("double") || t.contains("numeric") || t.contains("real") || t.contains("money") {
            if let Ok(v) = row.try_get::<Option<f32>, _>(name) {
                v.map(serde_json::Value::from)
            } else if let Ok(v) = row.try_get::<Option<f64>, _>(name) {
                v.map(serde_json::Value::from)
            } else {
                row.try_get::<Option<String>, _>(name).ok().flatten().map(serde_json::Value::String)
            }
        } else if t.contains("timestamp") || t.contains("date") || t.contains("time") {
            match row.try_get::<Option<chrono::NaiveDateTime>, _>(name) {
                Ok(v) => v.map(|x| serde_json::Value::String(x.to_string())),
                Err(_) => match row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>(name) {
                    Ok(v) => v.map(|x| serde_json::Value::String(x.to_string())),
                    Err(_) => row.try_get::<Option<String>, _>(name).ok().flatten().map(serde_json::Value::String),
                },
            }
        } else if t.contains("json") {
            row.try_get::<Option<serde_json::Value>, _>(name).ok().flatten()
        } else if t.contains("uuid") {
            row.try_get::<Option<uuid::Uuid>, _>(name).ok().map(|v| serde_json::Value::String(v.map(|u| u.to_string()).unwrap_or_default()))
        } else if t.contains("bytea") {
            match row.try_get::<Option<Vec<u8>>, _>(name) {
                Ok(v) => v.map(|b| serde_json::Value::String(format!("0x{}", b.iter().map(|c| format!("{:02x}", c)).collect::<String>()))),
                Err(_) => None,
            }
        } else {
            row.try_get::<Option<String>, _>(name).ok().flatten().map(serde_json::Value::String)
        };
        opt.unwrap_or(serde_json::Value::Null)
    }

    fn sqlite_decode_value(
        row: &sqlx::sqlite::SqliteRow,
        col: &ColumnInfo,
    ) -> serde_json::Value {
        let name = col.name.as_str();
        let t = col.data_type.to_lowercase();
        let opt: Option<serde_json::Value> = if t.contains("integer") || t == "int" || t.contains("bool") {
            if let Ok(v) = row.try_get::<Option<i64>, _>(name) {
                v.map(serde_json::Value::from)
            } else {
                row.try_get::<Option<String>, _>(name).ok().flatten().map(serde_json::Value::String)
            }
        } else if t.contains("real") || t.contains("float") || t.contains("double") || t.contains("decimal") || t.contains("numeric") {
            if let Ok(v) = row.try_get::<Option<f64>, _>(name) {
                v.map(serde_json::Value::from)
            } else {
                row.try_get::<Option<String>, _>(name).ok().flatten().map(serde_json::Value::String)
            }
        } else if t.contains("blob") {
            match row.try_get::<Option<Vec<u8>>, _>(name) {
                Ok(v) => v.map(|b| serde_json::Value::String(format!("0x{}", b.iter().map(|c| format!("{:02x}", c)).collect::<String>()))),
                Err(_) => None,
            }
        } else {
            // text, datetime stored as text, etc
            row.try_get::<Option<String>, _>(name).ok().flatten().map(serde_json::Value::String)
        };
        opt.unwrap_or(serde_json::Value::Null)
    }

    pub async fn get_table_data(
        &self,
        database: &str,
        table: &str,
        page: i64,
        page_size: i64,
        sort_column: Option<&str>,
        sort_order: Option<&str>,
        where_clause: Option<&str>,
        row_limit: Option<i64>,
    ) -> Result<TableData, String> {
        let offset = (page - 1) * page_size;
        let order_clause = match sort_column {
            Some(col) => {
                let dir = if sort_order == Some(&"desc".to_string()) { "DESC" } else { "ASC" };
                format!(" ORDER BY \"{}\" {}", col.replace('"', "\"\""), dir)
            }
            None => String::new(),
        };
        let limit = row_limit.unwrap_or(page_size);

        let start = std::time::Instant::now();

        match self {
            DbConnection::MySql(pool) => {
                let qualified = format!("`{}`.`{}`", database.replace('`', "``"), table.replace('`', "``"));
                let where_str = where_clause.map(|w| format!(" WHERE {}", w)).unwrap_or_default();
                let count_sql = format!("SELECT COUNT(*) AS cnt FROM {}{}", &qualified, where_str);
                let count_row = sqlx::raw_sql(&count_sql)
                    .fetch_one(pool)
                    .await
                    .map_err(|e| e.to_string())?;
                let total: i64 = count_row.get(0);

                let data_sql = format!("SELECT * FROM {}{}{} LIMIT {} OFFSET {}", 
                    qualified, where_str, order_clause.replace('"', "`"), limit, offset);
                let rows = sqlx::raw_sql(&data_sql)
                    .fetch_all(pool)
                    .await
                    .map_err(|e| e.to_string())?;

                let columns: Vec<ColumnInfo> = if rows.is_empty() {
                    let col_sql = format!(
                        "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA \
                         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}'",
                        database.replace('\'', "\\'"),
                        table.replace('\'', "\\'")
                    );
                    let col_rows = sqlx::raw_sql(&col_sql)
                        .fetch_all(pool)
                        .await
                        .map_err(|e| e.to_string())?;
                    col_rows.iter().map(|r| {
                        let raw_name: Vec<u8> = r.get::<Vec<u8>, _>(0);
                        let name = String::from_utf8_lossy(&raw_name).to_string();
                        let raw_type: Vec<u8> = r.get::<Vec<u8>, _>(1);
                        let data_type = String::from_utf8_lossy(&raw_type).to_string();
                        let raw_nullable: Vec<u8> = r.get::<Vec<u8>, _>(2);
                        let nullable = String::from_utf8_lossy(&raw_nullable).to_string() == "YES";
                        let raw_col_key: Vec<u8> = r.get::<Vec<u8>, _>(3);
                        let col_key = String::from_utf8_lossy(&raw_col_key).to_string();
                        let raw_default: Option<Vec<u8>> = r.get::<Option<Vec<u8>>, _>(4);
                        let default_value = raw_default.map(|v| String::from_utf8_lossy(&v).to_string());
                        let raw_extra: Vec<u8> = r.get::<Vec<u8>, _>(5);
                        let extra = String::from_utf8_lossy(&raw_extra).to_string();
                        ColumnInfo {
                            name,
                            data_type,
                            nullable,
                            key: col_key,
                            default_value,
                            extra,
                        }
                    }).collect()
                } else {
                    rows[0].columns().iter().map(|c| Self::mysql_column_info(c)).collect()
                };

                let json_rows: Vec<serde_json::Value> = rows.iter().map(|row| {
                    let mut map = serde_json::Map::new();
                    for col in &columns {
                        let val = Self::mysql_decode_value(row, col);
                        map.insert(col.name.clone(), val);
                    }
                    serde_json::Value::Object(map)
                }).collect();

                let pk_sql = format!(
                    "SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE \
                     WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}' AND CONSTRAINT_NAME = 'PRIMARY'",
                    database.replace('\'', "\\'"),
                    table.replace('\'', "\\'")
                );
                let pk_rows = sqlx::raw_sql(&pk_sql)
                    .fetch_all(pool)
                    .await
                    .map_err(|e| e.to_string())?;
                let primary_keys: Vec<String> = pk_rows.iter().map(|r| {
                    let raw: Vec<u8> = r.get::<Vec<u8>, _>(0);
                    String::from_utf8_lossy(&raw).to_string()
                }).collect();
                let row_handles = build_row_handles(&json_rows, &primary_keys);

                Ok(TableData {
                    columns,
                    rows: json_rows,
                    total,
                    duration: format!("{:.2}ms", start.elapsed().as_secs_f64() * 1000.0),
                    primary_keys,
                    row_handles,
                })
            }
            DbConnection::Pg(pool) => {
                let schema = match database { "testdb" | "postgres" | "" => "public", other => other };
                let qualified = format!("\"{}\".\"{}\"", schema.replace('"', "\"\""), table.replace('"', "\"\""));
                let where_str = where_clause.map(|w| format!(" WHERE {}", w)).unwrap_or_default();
                let count_sql = format!("SELECT COUNT(*) AS cnt FROM {}{}", &qualified, where_str);
                let count_row = sqlx::raw_sql(&count_sql)
                    .fetch_one(pool)
                    .await
                    .map_err(|e| e.to_string())?;
                let total: i64 = count_row.get(0);

                let data_sql = format!("SELECT * FROM {}{}{} LIMIT {} OFFSET {}", qualified, where_str, order_clause, limit, offset);
                let rows = sqlx::raw_sql(&data_sql)
                    .fetch_all(pool)
                    .await
                    .map_err(|e| e.to_string())?;

                let columns: Vec<ColumnInfo> = if rows.is_empty() {
                    let col_sql = format!(
                        "SELECT column_name, data_type, is_nullable, '', column_default, '' \
                         FROM information_schema.COLUMNS WHERE table_schema = '{}' AND table_name = '{}'",
                        database.replace('\'', "\\'"),
                        table.replace('\'', "\\'")
                    );
                    let col_rows = sqlx::raw_sql(&col_sql)
                        .fetch_all(pool)
                        .await
                        .map_err(|e| e.to_string())?;
                    col_rows.iter().map(|r| {
                        ColumnInfo {
                            name: r.get::<String, _>(0),
                            data_type: r.get::<String, _>(1),
                            nullable: r.get::<String, _>(2) == "YES",
                            key: r.get::<String, _>(3),
                            default_value: r.get::<Option<String>, _>(4),
                            extra: r.get::<String, _>(5),
                        }
                    }).collect()
                } else {
                    rows[0].columns().iter().map(|c| Self::pg_column_info(c)).collect()
                };

                let json_rows: Vec<serde_json::Value> = rows.iter().map(|row| {
                    let mut map = serde_json::Map::new();
                    for col in &columns {
                        let val = Self::pg_decode_value(row, col);
                        map.insert(col.name.clone(), val);
                    }
                    serde_json::Value::Object(map)
                }).collect();

                let cache = self.get_schema_cache(database).await.unwrap_or(crate::db::types::SchemaCache { tables: vec![], views: vec![], routines: vec![], triggers: vec![] });
                let primary_keys = extract_primary_keys(&cache, &table);
                let row_handles = build_row_handles(&json_rows, &primary_keys);

                Ok(TableData {
                    columns,
                    rows: json_rows,
                    total,
                    duration: format!("{:.2}ms", start.elapsed().as_secs_f64() * 1000.0),
                    primary_keys,
                    row_handles,
                })
            }
            DbConnection::Sqlite(pool) => {
                let qualified = format!("\"{}\".\"{}\"", database.replace('"', "\"\""), table.replace('"', "\"\""));
                let where_str = where_clause.map(|w| format!(" WHERE {}", w)).unwrap_or_default();
                let count_sql = format!("SELECT COUNT(*) AS cnt FROM {}{}", &qualified, where_str);
                let count_row = sqlx::raw_sql(&count_sql)
                    .fetch_one(pool)
                    .await
                    .map_err(|e| e.to_string())?;
                let total: i64 = count_row.get(0);

                let data_sql = format!("SELECT * FROM {}{}{} LIMIT {} OFFSET {}", qualified, where_str, order_clause, limit, offset);
                let rows = sqlx::raw_sql(&data_sql)
                    .fetch_all(pool)
                    .await
                    .map_err(|e| e.to_string())?;

                let columns: Vec<ColumnInfo> = if rows.is_empty() {
                    let col_sql = format!("PRAGMA table_info('{}')", table.replace('\'', "''"));
                    let col_rows = sqlx::raw_sql(&col_sql)
                        .fetch_all(pool)
                        .await
                        .map_err(|e| e.to_string())?;
                    col_rows.iter().map(|r| {
                        ColumnInfo {
                            name: r.get::<String, _>(1),
                            data_type: r.get::<String, _>(2),
                            nullable: !r.get::<bool, _>(3),
                            key: if r.get::<bool, _>(5) { "PRI".into() } else { String::new() },
                            default_value: r.get::<Option<String>, _>(4),
                            extra: String::new(),
                        }
                    }).collect()
                } else {
                    rows[0].columns().iter().map(|c| {
                        ColumnInfo {
                            name: c.name().to_string(),
                            data_type: c.type_info().to_string(),
                            nullable: true,
                            key: String::new(),
                            default_value: None,
                            extra: String::new(),
                        }
                    }).collect()
                };

                let json_rows: Vec<serde_json::Value> = rows.iter().map(|row| {
                    let mut map = serde_json::Map::new();
                    for col in &columns {
                        let val = Self::sqlite_decode_value(row, col);
                        map.insert(col.name.clone(), val);
                    }
                    serde_json::Value::Object(map)
                }).collect();

                let cache = self.get_schema_cache(database).await.unwrap_or(crate::db::types::SchemaCache { tables: vec![], views: vec![], routines: vec![], triggers: vec![] });
                let primary_keys = extract_primary_keys(&cache, &table);
                let row_handles = build_row_handles(&json_rows, &primary_keys);

                Ok(TableData {
                    columns,
                    rows: json_rows,
                    total,
                    duration: format!("{:.2}ms", start.elapsed().as_secs_f64() * 1000.0),
                    primary_keys,
                    row_handles,
                })
            }
            DbConnection::Mongo(client, db_name) => {
                let db = client.database(db_name);
                let coll = db.collection::<mongodb::bson::Document>(table);
                let filter_doc: mongodb::bson::Document = if let Some(wc) = where_clause {
                    serde_json::from_str::<serde_json::Value>(wc)
                        .ok()
                        .and_then(|v| {
                            mongodb::bson::to_bson(&v).ok()
                                .and_then(|b| b.as_document().cloned())
                        })
                        .unwrap_or(mongodb::bson::doc! {})
                } else {
                    mongodb::bson::doc! {}
                };
                let total = coll.count_documents(filter_doc.clone()).await.map_err(|e| e.to_string())? as i64;
                let mongo_limit = row_limit.unwrap_or(page_size);
                let opts = mongodb::options::FindOptions::builder()
                    .limit(mongo_limit)
                    .skip(offset as u64)
                    .build();
                let mut cursor = coll.find(filter_doc)
                    .with_options(opts)
                    .await
                    .map_err(|e| e.to_string())?;
                let mut docs = Vec::new();
                use futures_util::TryStreamExt;
                while let Some(doc) = cursor.try_next().await.map_err(|e| e.to_string())? {
                    docs.push(doc);
                }
                let columns: Vec<ColumnInfo> = if docs.is_empty() {
                    Vec::new()
                } else {
                    let mut keys = std::collections::BTreeSet::new();
                    for doc in &docs {
                        for key in doc.keys() {
                            keys.insert(key.clone());
                        }
                    }
                    keys.iter().map(|k| ColumnInfo {
                        name: k.clone(),
                        data_type: "string".to_string(),
                        nullable: true,
                        key: String::new(),
                        default_value: None,
                        extra: String::new(),
                    }).collect()
                };
                let json_rows: Vec<serde_json::Value> = docs.into_iter().map(|doc| {
                    let bval = mongodb::bson::to_bson(&doc).unwrap_or(mongodb::bson::Bson::Null);
                    let json: serde_json::Value = bval.into();
                    json.get("_").cloned().unwrap_or(json)
                }).collect();
                let primary_keys = if json_rows.iter().all(|r| r.get("_id").is_some()) {
                    vec!["_id".to_string()]
                } else {
                    Vec::new()
                };
                let row_handles = build_row_handles(&json_rows, &primary_keys);
                Ok(TableData {
                    columns,
                    rows: json_rows,
                    total,
                    duration: format!("{:.2}ms", start.elapsed().as_secs_f64() * 1000.0),
                    primary_keys,
                    row_handles,
                })
            }
            DbConnection::Oracle(conn) => {
                let conn = conn.clone();
                let table = table.to_string();
                let database = database.to_string();
                let o_limit = row_limit.unwrap_or(page_size);
                let where_str = where_clause.map(|w| format!(" WHERE {}", w)).unwrap_or_default();
                let result = tokio::task::spawn_blocking(move || {
                    let conn = conn.lock().map_err(|e| e.to_string())?;
                    let owner = database.to_uppercase();
                    let quote_if_needed = |s: &str| -> String {
                        if s.chars().any(|c| c.is_lowercase())
                            || s.chars().any(|c| !c.is_alphanumeric() && c != '_')
                        {
                            format!("\"{}\"", s.replace('"', "\"\""))
                        } else {
                            s.to_string()
                        }
                    };
                    let qtable = if table.contains('.') {
                        let parts: Vec<&str> = table.splitn(2, '.').collect();
                        format!("{}.{}", quote_if_needed(parts[0]), quote_if_needed(parts[1]))
                    } else {
                        format!("\"{}\".\"{}\"", owner.replace('"', "\"\""), table.replace('"', "\"\""))
                    };
                    let col_sql = format!(
                        "SELECT column_name, data_type, nullable FROM all_tab_columns WHERE owner = '{}' AND table_name = '{}' ORDER BY column_id",
                        owner.replace('\'', "''"),
                        table.replace('\'', "''"),
                    );
                    let mut col_stmt = conn.query(&col_sql, &[]).map_err(|e| e.to_string())?;
                    let mut col_info_list: Vec<(String, String, bool)> = Vec::new();
                    while let Some(row) = col_stmt.next() {
                        let row = row.map_err(|e| e.to_string())?;
                        let name = row.get::<usize, String>(0).unwrap_or_default();
                        let dtype = row.get::<usize, String>(1).unwrap_or_default();
                        let nullable = row.get::<usize, String>(2).unwrap_or_default() == "Y";
                        col_info_list.push((name, dtype, nullable));
                    }
                    let col_names: Vec<String> = col_info_list.iter().map(|(c, _, _)| quote_if_needed(c)).collect();
                    let select_cols = col_names.join(", ");
                    let offset = (page - 1) * page_size;
                    let data_sql = format!(
                        "SELECT {}, ROWID AS ROWID2 FROM {}{} OFFSET {} ROWS FETCH NEXT {} ROWS ONLY",
                        select_cols, qtable, where_str, offset, o_limit
                    );
                    let mut total = 0i64;
                    if let Ok(mut count_stmt) = conn.query(&format!("SELECT COUNT(*) FROM {}{}", qtable, where_str), &[]) {
                        if let Some(Ok(r)) = count_stmt.next() {
                            total = r.get::<usize, i64>(0).unwrap_or(0);
                        }
                    }
                    let mut data_stmt = conn.query(&data_sql, &[]).map_err(|e| e.to_string())?;
                    let mut json_rows = Vec::new();
                    while let Some(row) = data_stmt.next() {
                        let row = row.map_err(|e| e.to_string())?;
                        let mut map = serde_json::Map::new();
                        for (i, (col, _, _)) in col_info_list.iter().enumerate() {
                            let json_val = oracle_decode_value(&row, i);
                            map.insert(col.clone(), json_val);
                        }
                        let rowid: oracle::Result<String> = row.get(col_info_list.len());
                        if let Ok(rid) = rowid {
                            map.insert("ROWID2".to_string(), serde_json::Value::String(rid));
                        }
                        json_rows.push(serde_json::Value::Object(map));
                    }
                    let columns: Vec<ColumnInfo> = col_info_list.into_iter().map(|(name, dtype, nullable)| ColumnInfo {
                        name, data_type: dtype, nullable,
                        key: String::new(), default_value: None, extra: String::new(),
                    }).collect();
                    let primary_keys: Vec<String> = Vec::new();
                    let row_handles = build_row_handles(&json_rows, &primary_keys);
                    Ok(TableData {
                        columns,
                        rows: json_rows,
                        total,
                        duration: format!("{:.2}ms", start.elapsed().as_secs_f64() * 1000.0),
                        primary_keys,
                        row_handles,
                    })
                }).await.map_err(|e| e.to_string())?;
                result
            }
            DbConnection::Redis(conn) => {
                let mut conn = conn.clone();
                let db_index: i64 = database.trim_start_matches("db").parse().unwrap_or(0);
                let _ = redis::cmd("SELECT").arg(db_index).query_async::<()>(&mut conn).await;
                let key_type: String = redis::cmd("TYPE").arg(table).query_async(&mut conn).await.map_err(|e| e.to_string())?;
                let ttl: i64 = redis::cmd("TTL").arg(table).query_async(&mut conn).await.unwrap_or(-1);
                let value: serde_json::Value = Self::get_redis_value(&mut conn, table, &key_type).await?;
                let value_str = serde_json::to_string(&value).unwrap_or_default();
                let cols = vec![
                    ColumnInfo { name: "key".into(), data_type: "string".into(), nullable: false, key: "PRI".into(), default_value: None, extra: String::new() },
                    ColumnInfo { name: "type".into(), data_type: "string".into(), nullable: true, key: String::new(), default_value: None, extra: String::new() },
                    ColumnInfo { name: "ttl".into(), data_type: "integer".into(), nullable: true, key: String::new(), default_value: None, extra: String::new() },
                    ColumnInfo { name: "value".into(), data_type: key_type.clone(), nullable: true, key: String::new(), default_value: None, extra: String::new() },
                ];
                let json_rows = vec![serde_json::json!({
                    "key": table,
                    "type": key_type,
                    "ttl": ttl,
                    "value": value_str,
                })];
                let primary_keys = vec!["key".to_string()];
                let row_handles = build_row_handles(&json_rows, &primary_keys);
                Ok(TableData {
                    columns: cols,
                    rows: json_rows,
                    total: 1,
                    duration: format!("{:.2}ms", start.elapsed().as_secs_f64() * 1000.0),
                    primary_keys,
                    row_handles,
                })
            }
        }
    }

    async fn get_redis_value(conn: &mut redis::aio::ConnectionManager, key: &str, key_type: &str) -> Result<serde_json::Value, String> {
        match key_type {
            "string" => {
                let val: Option<String> = redis::cmd("GET").arg(key).query_async(conn).await.map_err(|e| e.to_string())?;
                Ok(serde_json::json!(val))
            }
            "list" => {
                let vals: Vec<String> = redis::cmd("LRANGE").arg(key).arg(0).arg(-1).query_async(conn).await.map_err(|e| e.to_string())?;
                Ok(serde_json::json!(vals))
            }
            "set" => {
                let vals: Vec<String> = redis::cmd("SMEMBERS").arg(key).query_async(conn).await.map_err(|e| e.to_string())?;
                Ok(serde_json::json!(vals))
            }
            "hash" => {
                let vals: Vec<(String, String)> = redis::cmd("HGETALL").arg(key).query_async(conn).await.map_err(|e| e.to_string())?;
                let map: serde_json::Map<String, serde_json::Value> = vals.into_iter().map(|(k, v)| (k, serde_json::json!(v))).collect();
                Ok(serde_json::Value::Object(map))
            }
            "zset" => {
                let vals: Vec<(String, f64)> = redis::cmd("ZRANGE").arg(key).arg(0).arg(-1).arg("WITHSCORES").query_async(conn).await.map_err(|e| e.to_string())?;
                let arr: Vec<serde_json::Value> = vals.into_iter().map(|(m, s)| serde_json::json!({"member": m, "score": s})).collect();
                Ok(serde_json::json!(arr))
            }
            "stream" => {
                let vals: Vec<(String, Vec<(String, Vec<(String, String)>)>)> =
                    redis::cmd("XRANGE").arg(key).arg("-").arg("+").arg("COUNT").arg(100).query_async(conn).await.map_err(|e| e.to_string())?;
                let arr: Vec<serde_json::Value> = vals.into_iter().map(|(id, fields)| {
                    let fmap: serde_json::Map<String, serde_json::Value> = fields.into_iter().flat_map(|(_k, v_pairs)| {
                        v_pairs.into_iter().map(|(fk, fv)| (fk, serde_json::json!(fv)))
                    }).collect();
                    serde_json::json!({"id": id, "fields": serde_json::Value::Object(fmap)})
                }).collect();
                Ok(serde_json::json!(arr))
            }
            _ => Ok(serde_json::json!("(unknown type)")),
        }
    }

    pub async fn get_table_ddl(&self, database: &str, table: &str) -> Result<String, String> {
        match self {
            DbConnection::MySql(pool) => {
                let sql = format!("SHOW CREATE TABLE `{}`.`{}`", database.replace('`', "``"), table.replace('`', "``"));
                let row = sqlx::raw_sql(&sql)
                    .fetch_one(pool)
                    .await
                    .map_err(|e| e.to_string())?;
                let ddl: String = row.get(1);
                Ok(ddl)
            }
            DbConnection::Pg(pool) => {
                let escaped = table.replace('\'', "''");
                let sql = format!(
                    "SELECT 'CREATE TABLE ' || '{}' || ' (' || E'\\n' || \
                     string_agg('  ' || column_name || ' ' || data_type || \
                     CASE WHEN character_maximum_length IS NOT NULL \
                          THEN '(' || character_maximum_length || ')' ELSE '' END || \
                     CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END || \
                     CASE WHEN column_default IS NOT NULL \
                          THEN ' DEFAULT ' || column_default ELSE '' END, ',' || E'\\n') \
                     || E'\\n);' AS ddl \
                     FROM information_schema.COLUMNS \
                     WHERE table_schema = 'public' AND table_name = '{}'",
                    table, escaped
                );
                let row = sqlx::raw_sql(&sql).fetch_one(pool).await.map_err(|e| e.to_string())?;
                let ddl: String = row.get(0);
                Ok(ddl)
            }
            DbConnection::Sqlite(pool) => {
                let sql = format!("SELECT sql FROM sqlite_master WHERE name = '{}'", table.replace('\'', "''"));
                let row = sqlx::raw_sql(&sql).fetch_one(pool).await.map_err(|e| e.to_string())?;
                let ddl: Option<String> = row.get(0);
                Ok(ddl.unwrap_or_else(|| "-- No DDL available".to_string()))
            }
            DbConnection::Mongo(_, _) => {
                Ok("-- DDL not available for MongoDB collections".to_string())
            }
            DbConnection::Oracle(conn) => {
                let conn = conn.clone();
                let table = table.to_string();
                let database = database.to_string();
                let result = tokio::task::spawn_blocking(move || {
                    let conn = conn.lock().map_err(|e| e.to_string())?;
                    let obj_name = if table.contains('.') {
                        let parts: Vec<&str> = table.splitn(2, '.').collect();
                        format!("{}.{}", parts[0], parts[1])
                    } else {
                        table.to_string()
                    };
                    let owner = database.to_uppercase();
                    let sql = format!(
                        "SELECT DBMS_METADATA.GET_DDL('TABLE', '\"{}\"', '{}') FROM dual",
                        obj_name.replace('\'', "''"),
                        owner.replace('\'', "''"),
                    );
                    let mut stmt = conn.query(&sql, &[]).map_err(|e| e.to_string())?;
                    if let Some(row) = stmt.next() {
                        match row {
                            Ok(r) => Ok(r.get::<usize, String>(0).unwrap_or_else(|_| "-- No DDL available".to_string())),
                            Err(e) => Ok(format!("-- Error: {}", e)),
                        }
                    } else {
                        Ok("-- No DDL available".to_string())
                    }
                }).await.map_err(|e| e.to_string())?;
                result
            }
            DbConnection::Redis(conn) => {
                let mut conn = conn.clone();
                let key_type: String = redis::cmd("TYPE").arg(table).query_async(&mut conn).await.map_err(|e| e.to_string())?;
                let ttl: i64 = redis::cmd("TTL").arg(table).query_async(&mut conn).await.unwrap_or(-1);
                let encoding: String = redis::cmd("OBJECT").arg("ENCODING").arg(table).query_async(&mut conn).await.unwrap_or_default();
                let idletime: i64 = redis::cmd("OBJECT").arg("IDLETIME").arg(table).query_async(&mut conn).await.unwrap_or(-1);
                let refcount: i64 = redis::cmd("OBJECT").arg("REFCOUNT").arg(table).query_async(&mut conn).await.unwrap_or(-1);
                Ok(format!(
                    "-- Key: {}\n-- Type: {}\n-- Encoding: {}\n-- TTL: {}\n-- Idle Time: {}\n-- Ref Count: {}",
                    table, key_type, encoding, ttl, idletime, refcount
                ))
            }
        }
    }

    pub async fn get_schema_cache(&self, database: &str) -> Result<SchemaCache, String> {
        match self {
            DbConnection::MySql(pool) => {
                let escaped = database.replace('\'', "\\'");
                let rows = sqlx::raw_sql(&format!(
                    "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA \
                     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '{}' ORDER BY TABLE_NAME, ORDINAL_POSITION",
                    escaped
                )).fetch_all(pool).await.map_err(|e| e.to_string())?;

                let mut tables_map: std::collections::HashMap<String, Vec<ColumnInfo>> = std::collections::HashMap::new();
                for row in &rows {
                    let raw_name: Vec<u8> = row.get::<Vec<u8>, _>(0);
                    let table_name = String::from_utf8_lossy(&raw_name).to_string();
                    let raw_col: Vec<u8> = row.get::<Vec<u8>, _>(1);
                    let col_name = String::from_utf8_lossy(&raw_col).to_string();
                    let raw_type: Vec<u8> = row.get::<Vec<u8>, _>(2);
                    let col_type = String::from_utf8_lossy(&raw_type).to_string();
                    let raw_null: Vec<u8> = row.get::<Vec<u8>, _>(3);
                    let nullable = String::from_utf8_lossy(&raw_null).to_string() == "YES";
                    let raw_key: Vec<u8> = row.get::<Vec<u8>, _>(4);
                    let col_key = String::from_utf8_lossy(&raw_key).to_string();
                    let raw_def: Option<Vec<u8>> = row.get::<Option<Vec<u8>>, _>(5);
                    let default = raw_def.map(|v| String::from_utf8_lossy(&v).to_string());
                    let raw_extra: Vec<u8> = row.get::<Vec<u8>, _>(6);
                    let extra = String::from_utf8_lossy(&raw_extra).to_string();

                    tables_map.entry(table_name).or_default().push(ColumnInfo {
                        name: col_name, data_type: col_type, nullable, key: col_key,
                        default_value: default, extra,
                    });
                }

                let fk_rows = sqlx::raw_sql(&format!(
                    "SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME \
                     FROM information_schema.KEY_COLUMN_USAGE \
                     WHERE TABLE_SCHEMA = '{}' AND REFERENCED_TABLE_NAME IS NOT NULL",
                    escaped
                )).fetch_all(pool).await.map_err(|e| e.to_string())?;

                let mut fk_map: std::collections::HashMap<String, Vec<ForeignKeyInfo>> = std::collections::HashMap::new();
                for row in &fk_rows {
                    let raw_t: Vec<u8> = row.get::<Vec<u8>, _>(0);
                    let t = String::from_utf8_lossy(&raw_t).to_string();
                    let raw_c: Vec<u8> = row.get::<Vec<u8>, _>(1);
                    let c = String::from_utf8_lossy(&raw_c).to_string();
                    let raw_rt: Vec<u8> = row.get::<Vec<u8>, _>(2);
                    let rt = String::from_utf8_lossy(&raw_rt).to_string();
                    let raw_rc: Vec<u8> = row.get::<Vec<u8>, _>(3);
                    let rc = String::from_utf8_lossy(&raw_rc).to_string();
                    fk_map.entry(t).or_default().push(ForeignKeyInfo { column_name: c, ref_table: rt, ref_column: rc, constraint_name: None });
                }

                let idx_rows = sqlx::raw_sql(&format!(
                    "SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX \
                     FROM information_schema.STATISTICS \
                     WHERE TABLE_SCHEMA = '{}' AND INDEX_NAME != 'PRIMARY' \
                     ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX",
                    escaped
                )).fetch_all(pool).await.map_err(|e| e.to_string())?;

                let mut idx_map: std::collections::HashMap<String, Vec<IndexInfo>> = std::collections::HashMap::new();
                for row in &idx_rows {
                    let raw_t: Vec<u8> = row.get::<Vec<u8>, _>(0);
                    let t = String::from_utf8_lossy(&raw_t).to_string();
                    let raw_idx: Vec<u8> = row.get::<Vec<u8>, _>(1);
                    let idx_name = String::from_utf8_lossy(&raw_idx).to_string();
                    let raw_col: Vec<u8> = row.get::<Vec<u8>, _>(2);
                    let col_name = String::from_utf8_lossy(&raw_col).to_string();
                    let unique: bool = row.try_get::<i32, _>(3).map(|v| v == 0).unwrap_or(true);
                    let idxes = idx_map.entry(t).or_default();
                    if let Some(existing) = idxes.iter_mut().find(|i: &&mut IndexInfo| i.name == idx_name) {
                        existing.columns.push(col_name);
                    } else {
                        idxes.push(IndexInfo {
                            name: idx_name, columns: vec![col_name], unique,
                            index_type: String::new(),
                        });
                    }
                }

                let tables = tables_map.into_iter().map(|(table, cols)| {
                    let fks = fk_map.remove(&table).unwrap_or_default();
                    let idxs = idx_map.remove(&table).unwrap_or_default();
                    TableSchemaInfo { table, columns: cols, foreign_keys: fks, indexes: idxs, views: vec![], routines: vec![], triggers: vec![] }
                }).collect();

                let views = sqlx::raw_sql(&format!(
                    "SELECT TABLE_NAME, VIEW_DEFINITION FROM information_schema.VIEWS WHERE TABLE_SCHEMA = '{}'",
                    escaped
                )).fetch_all(pool).await.map_err(|e| e.to_string())?.iter().map(|r| {
                    let raw_n: Vec<u8> = r.get::<Vec<u8>, _>(0);
                    let raw_d: Vec<u8> = r.get::<Vec<u8>, _>(1);
                    ViewInfo {
                        name: String::from_utf8_lossy(&raw_n).to_string(),
                        definition: String::from_utf8_lossy(&raw_d).to_string(),
                    }
                }).collect();

                let routines = sqlx::raw_sql(&format!(
                    "SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = '{}'",
                    escaped
                )).fetch_all(pool).await.map_err(|e| e.to_string())?;

                let mut routines_list: Vec<RoutineInfo> = Vec::new();
                for r in &routines {
                    let raw_n: Vec<u8> = r.get::<Vec<u8>, _>(0);
                    let raw_t: Vec<u8> = r.get::<Vec<u8>, _>(1);
                    let name = String::from_utf8_lossy(&raw_n).to_string();
                    let rtype = String::from_utf8_lossy(&raw_t).to_string();
                    let def = sqlx::raw_sql(&format!(
                        "SHOW CREATE {} `{}`.`{}`",
                        if rtype == "FUNCTION" { "FUNCTION" } else { "PROCEDURE" },
                        escaped, name.replace('`', "``")
                    )).fetch_all(pool).await.ok().and_then(|rows| {
                        rows.first().map(|row| {
                            if rtype == "FUNCTION" {
                                String::from_utf8_lossy(&row.get::<Vec<u8>, _>(2)).to_string()
                            } else {
                                String::from_utf8_lossy(&row.get::<Vec<u8>, _>(2)).to_string()
                            }
                        })
                    }).unwrap_or_default();
                    routines_list.push(RoutineInfo {
                        name, routine_type: rtype, definition: def,
                    });
                }

                let triggers = sqlx::raw_sql(&format!(
                    "SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION, ACTION_STATEMENT \
                     FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = '{}'",
                    escaped
                )).fetch_all(pool).await.map_err(|e| e.to_string())?.iter().map(|r| {
                    let raw_n: Vec<u8> = r.get::<Vec<u8>, _>(0);
                    let raw_t: Vec<u8> = r.get::<Vec<u8>, _>(1);
                    let raw_timing: Vec<u8> = r.get::<Vec<u8>, _>(2);
                    let raw_event: Vec<u8> = r.get::<Vec<u8>, _>(3);
                    let raw_stmt: Vec<u8> = r.get::<Vec<u8>, _>(4);
                    let trigger_name = String::from_utf8_lossy(&raw_n).to_string();
                    let table_name = String::from_utf8_lossy(&raw_t).to_string();
                    let timing = String::from_utf8_lossy(&raw_timing).to_string();
                    let event = String::from_utf8_lossy(&raw_event).to_string();
                    let stmt = String::from_utf8_lossy(&raw_stmt).to_string();
                    let definition = format!("CREATE TRIGGER {} {} {} ON {} FOR EACH ROW\n{}",
                        trigger_name, timing, event, table_name, stmt);
                    TriggerInfo {
                        name: trigger_name, table: table_name, definition,
                    }
                }).collect();

                Ok(SchemaCache { tables, views, routines: routines_list, triggers })
            }
            DbConnection::Pg(pool) => {
                let rows = sqlx::raw_sql(&format!(
                    "SELECT table_name, column_name, data_type, is_nullable, '', column_default, '' \
                     FROM information_schema.COLUMNS \
                     WHERE table_schema = 'public' AND table_catalog = '{}' \
                     ORDER BY table_name, ordinal_position",
                    database.replace('\'', "\\'")
                )).fetch_all(pool).await.map_err(|e| e.to_string())?;

                let mut tables_map: std::collections::HashMap<String, Vec<ColumnInfo>> = std::collections::HashMap::new();
                for row in &rows {
                    let table_name: String = row.get(0);
                    let col_name: String = row.get(1);
                    let col_type: String = row.get(2);
                    let nullable: String = row.get(3);
                    let default: Option<String> = row.get(5);
                    tables_map.entry(table_name).or_default().push(ColumnInfo {
                        name: col_name, data_type: col_type,
                        nullable: nullable == "YES", key: String::new(),
                        default_value: default, extra: String::new(),
                    });
                }

                let pk_rows = sqlx::raw_sql(&format!(
                    "SELECT tc.table_name, kcu.column_name \
                     FROM information_schema.table_constraints tc \
                     JOIN information_schema.key_column_usage kcu \
                       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema \
                     WHERE tc.table_schema = 'public' AND tc.table_catalog = '{}' AND tc.constraint_type = 'PRIMARY KEY'",
                    database.replace('\'', "\\'")
                )).fetch_all(pool).await.map_err(|e| e.to_string())?;
                for row in &pk_rows {
                    let t: String = row.get(0);
                    let c: String = row.get(1);
                    if let Some(cols) = tables_map.get_mut(&t) {
                        if let Some(col) = cols.iter_mut().find(|col| col.name == c) {
                            col.key = "PRI".to_string();
                        }
                    }
                }

                let fk_rows = sqlx::raw_sql(&format!(
                    "SELECT kcu.table_name, kcu.column_name, ccu.table_name, ccu.column_name \
                     FROM information_schema.key_column_usage kcu \
                     JOIN information_schema.constraint_column_usage ccu \
                       ON kcu.constraint_name = ccu.constraint_name \
                     WHERE kcu.table_schema = 'public' AND kcu.table_catalog = '{}'",
                    database.replace('\'', "\\'")
                )).fetch_all(pool).await.map_err(|e| e.to_string())?;

                let mut fk_map: std::collections::HashMap<String, Vec<ForeignKeyInfo>> = std::collections::HashMap::new();
                for row in &fk_rows {
                    let t: String = row.get(0);
                    let c: String = row.get(1);
                    let rt: String = row.get(2);
                    let rc: String = row.get(3);
                    fk_map.entry(t).or_default().push(ForeignKeyInfo { column_name: c, ref_table: rt, ref_column: rc, constraint_name: None });
                }

                let idx_rows = sqlx::raw_sql(&format!(
                    "SELECT t.relname, i.relname, a.attname, ix.indisunique, k.ordinality \
                     FROM pg_namespace n \
                     JOIN pg_class t ON t.relnamespace = n.oid AND t.relkind = 'r' \
                     JOIN pg_index ix ON ix.indrelid = t.oid \
                     JOIN pg_class i ON i.oid = ix.indexrelid \
                     CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ordinality) \
                     JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum \
                     WHERE n.nspname = 'public' AND NOT ix.indisprimary AND a.attnum > 0 \
                     ORDER BY t.relname, i.relname, k.ordinality",
                )).fetch_all(pool).await.map_err(|e| e.to_string())?;

                let mut idx_map: std::collections::HashMap<String, Vec<IndexInfo>> = std::collections::HashMap::new();
                for row in &idx_rows {
                    let t: String = row.get(0);
                    let idx_name: String = row.get(1);
                    let col_name: String = row.get(2);
                    let unique: bool = row.get(3);
                    let idxes = idx_map.entry(t).or_default();
                    if let Some(existing) = idxes.iter_mut().find(|i| i.name == idx_name) {
                        existing.columns.push(col_name);
                    } else {
                        idxes.push(IndexInfo {
                            name: idx_name, columns: vec![col_name], unique,
                            index_type: String::new(),
                        });
                }
                }

                let views = sqlx::raw_sql(&format!(
                    "SELECT table_name, view_definition FROM information_schema.views WHERE table_schema = 'public' AND table_catalog = '{}'",
                    database.replace('\'', "\\'")
                )).fetch_all(pool).await.map_err(|e| e.to_string())?.iter().map(|r| {
                    let name: String = r.get(0);
                    let def: String = r.get(1);
                    ViewInfo { name: name.clone(), definition: format!("CREATE OR REPLACE VIEW {} AS {}", name, def) }
                }).collect();

                Ok(SchemaCache {
                    tables: tables_map.into_iter().map(|(table, cols)| {
                        let fks = fk_map.remove(&table).unwrap_or_default();
                        let idxs = idx_map.remove(&table).unwrap_or_default();
                        TableSchemaInfo { table, columns: cols, foreign_keys: fks, indexes: idxs, views: vec![], routines: vec![], triggers: vec![] }
                    }).collect(),
                    views,
                    routines: vec![],
                    triggers: vec![],
                })
            }
            DbConnection::Sqlite(pool) => {
                let tbl_rows = sqlx::raw_sql("SELECT name FROM sqlite_master WHERE type IN ('table','view')")
                    .fetch_all(pool).await.map_err(|e| e.to_string())?;
                let mut tables = Vec::new();
                for trow in &tbl_rows {
                    let tname: String = trow.get(0);
                    let col_rows = sqlx::raw_sql(&format!("PRAGMA table_info('{}')", tname.replace('\'', "''")))
                        .fetch_all(pool).await.map_err(|e| e.to_string())?;
                    let cols: Vec<ColumnInfo> = col_rows.iter().map(|r| {
                        ColumnInfo {
                            name: r.get::<String, _>(1),
                            data_type: r.get::<String, _>(2),
                            nullable: !r.get::<bool, _>(3),
                            key: if r.get::<bool, _>(5) { "PRI".into() } else { String::new() },
                            default_value: r.get::<Option<String>, _>(4),
                            extra: String::new(),
                        }
                    }).collect();
                    let fk_rows = sqlx::raw_sql(&format!("PRAGMA foreign_key_list('{}')", tname.replace('\'', "''")))
                        .fetch_all(pool).await.map_err(|e| e.to_string())?;
                    let fks: Vec<ForeignKeyInfo> = fk_rows.iter().map(|r| {
                        ForeignKeyInfo {
                            column_name: r.get::<String, _>(3),
                            ref_table: r.get::<String, _>(2),
                            ref_column: r.get::<String, _>(4),
                            constraint_name: None,
                        }
                    }).collect();
                    let idx_list = sqlx::raw_sql(&format!("PRAGMA index_list('{}')", tname.replace('\'', "''")))
                        .fetch_all(pool).await.map_err(|e| e.to_string())?;
                    let mut indexes = Vec::new();
                    for idx_row in &idx_list {
                        let idx_name: String = idx_row.get(1);
                        let unique: bool = idx_row.get::<i32, _>(2) != 0;
                        let idx_info = sqlx::raw_sql(&format!("PRAGMA index_info('{}')", idx_name.replace('\'', "''")))
                            .fetch_all(pool).await.map_err(|e| e.to_string())?;
                        let cols: Vec<String> = idx_info.iter().map(|r| r.get::<String, _>(2)).collect();
                        if !cols.is_empty() {
                            indexes.push(IndexInfo {
                                name: idx_name, columns: cols, unique,
                                index_type: String::new(),
                            });
                        }
                    }
                    tables.push(TableSchemaInfo { table: tname, columns: cols, foreign_keys: fks, indexes, views: vec![], routines: vec![], triggers: vec![] });
                }
                Ok(SchemaCache { tables, views: vec![], routines: vec![], triggers: vec![] })
            }
            DbConnection::Mongo(_client, _db_name) => {
                Ok(SchemaCache { tables: vec![], views: vec![], routines: vec![], triggers: vec![] })
            }
            DbConnection::Oracle(conn) => {
                let conn = conn.clone();
                let database = database.to_string();
                let tables = tokio::task::spawn_blocking(move || {
                    let conn = conn.lock().map_err(|e| e.to_string())?;
                    let owner = database.to_uppercase();
                    let mut stmt = conn.query(
                        &format!(
                            "SELECT table_name, column_name, data_type, nullable, data_default \
                             FROM all_tab_columns WHERE owner = '{}' ORDER BY table_name, column_id",
                            owner.replace('\'', "''")
                        ), &[]
                    ).map_err(|e| e.to_string())?;
                    let mut map: std::collections::HashMap<String, Vec<ColumnInfo>> = std::collections::HashMap::new();
                    while let Some(row) = stmt.next() {
                        let row = row.map_err(|e| e.to_string())?;
                        let t: String = row.get::<usize, String>(0).unwrap_or_default();
                        let c: String = row.get::<usize, String>(1).unwrap_or_default();
                        let dt: String = row.get::<usize, String>(2).unwrap_or_default();
                        let nul: String = row.get::<usize, String>(3).unwrap_or_default();
                        let def: Option<String> = row.get::<usize, Option<String>>(4).ok().and_then(|v| v);
                        map.entry(t).or_default().push(ColumnInfo {
                            name: c, data_type: dt, nullable: nul == "Y",
                            key: String::new(), default_value: def, extra: String::new(),
                        });
                    }
                    let mut fk_map: std::collections::HashMap<String, Vec<ForeignKeyInfo>> = std::collections::HashMap::new();
                    if let Ok(mut fk_stmt) = conn.query(
                        "SELECT a.table_name, a.column_name, c_pk.table_name, a_pk.column_name \
                         FROM user_cons_columns a \
                         JOIN user_constraints c ON a.constraint_name = c.constraint_name AND c.constraint_type = 'R' \
                         JOIN user_constraints c_pk ON c.r_constraint_name = c_pk.constraint_name \
                         JOIN user_cons_columns a_pk ON c_pk.constraint_name = a_pk.constraint_name AND a_pk.position = a.position",
                        &[]
                    ) {
                        while let Some(row) = fk_stmt.next() {
                            if let Ok(r) = row {
                                let t: String = r.get::<usize, String>(0).unwrap_or_default();
                                let c: String = r.get::<usize, String>(1).unwrap_or_default();
                                let rt: String = r.get::<usize, String>(2).unwrap_or_default();
                                let rc: String = r.get::<usize, String>(3).unwrap_or_default();
                                fk_map.entry(t).or_default().push(ForeignKeyInfo { column_name: c, ref_table: rt, ref_column: rc, constraint_name: None });
                            }
                        }
                    }
                    let mut idx_map: std::collections::HashMap<String, Vec<IndexInfo>> = std::collections::HashMap::new();
                    if let Ok(mut idx_stmt) = conn.query(
                        &format!(
                            "SELECT ic.table_name, ic.index_name, ic.column_name, \
                                    CASE WHEN i.uniqueness = 'UNIQUE' THEN 1 ELSE 0 END, ic.column_position \
                             FROM all_ind_columns ic \
                             JOIN all_indexes i ON ic.index_name = i.index_name AND ic.table_owner = i.table_owner \
                             WHERE ic.table_owner = '{}' AND i.generated = 'N' \
                             ORDER BY ic.table_name, ic.index_name, ic.column_position",
                            owner
                        ), &[]
                    ) {
                        while let Some(row) = idx_stmt.next() {
                            if let Ok(r) = row {
                                let t: String = r.get::<usize, String>(0).unwrap_or_default();
                                let idx_name: String = r.get::<usize, String>(1).unwrap_or_default();
                                let col_name: String = r.get::<usize, String>(2).unwrap_or_default();
                                let unique: i32 = r.get::<usize, i32>(3).unwrap_or(0);
                                let idxes = idx_map.entry(t).or_default();
                                if let Some(existing) = idxes.iter_mut().find(|i| i.name == idx_name) {
                                    existing.columns.push(col_name);
                                } else {
                                    idxes.push(IndexInfo {
                                        name: idx_name, columns: vec![col_name], unique: unique != 0,
                                        index_type: String::new(),
                                    });
                                }
                            }
                        }
                    }
                    let tables = map.into_iter().map(|(table, cols)| {
                        let fks = fk_map.remove(&table).unwrap_or_default();
                        let idxs = idx_map.remove(&table).unwrap_or_default();
                    TableSchemaInfo { table, columns: cols, foreign_keys: fks, indexes: idxs, views: vec![], routines: vec![], triggers: vec![] }
                }).collect();
                Ok(SchemaCache { tables, views: vec![], routines: vec![], triggers: vec![] })
                }).await.map_err(|e| e.to_string())?;
                tables
            }
            DbConnection::Redis(_conn) => {
                Ok(SchemaCache { tables: vec![], views: vec![], routines: vec![], triggers: vec![] })
            }
        }
    }

    pub async fn find_in_tables(&self, database: &str, search: &str, max_tables: usize, per_table_limit: i64) -> Result<Vec<FindMatch>, String> {
        let needle = search.trim();
        if needle.is_empty() {
            return Ok(vec![]);
        }
        let schema = self.get_schema_cache(database).await?;
        let mut matches = Vec::new();
        for t in schema.tables.iter().take(max_tables) {
            // Only text-ish columns are searched; binary/blob columns are skipped.
            let text_cols: Vec<&String> = t.columns
                .iter()
                .filter(|c| {
                    let dt = c.data_type.to_uppercase();
                    dt.contains("CHAR") || dt.contains("TEXT") || dt.contains("VARCHAR") || dt.contains("STRING")
                })
                .map(|c| &c.name)
                .collect();
            if text_cols.is_empty() {
                continue;
            }
            let per_table = self.search_table(database, &t.table, &text_cols, needle, per_table_limit).await?;
            matches.extend(per_table);
        }
        Ok(matches)
    }

    async fn search_table(&self, database: &str, table: &str, cols: &[&String], needle: &str, limit: i64) -> Result<Vec<FindMatch>, String> {
        let pattern = format!("%{}%", needle.replace('%', "\\%").replace('_', "\\_"));
        match self {
            DbConnection::MySql(pool) => {
                let qualified = format!("`{}`.`{}`", database.replace('`', "``"), table.replace('`', "``"));
                let conds = cols.iter().map(|c| format!("`{}` LIKE '{}'", c.replace('`', "``"), pattern.replace('\\', "\\\\").replace('\'', "''"))).collect::<Vec<_>>().join(" OR ");
                let sql = format!("SELECT * FROM {} WHERE {} LIMIT {}", qualified, conds, limit);
                let rows = sqlx::raw_sql(&sql).fetch_all(pool).await.map_err(|e| e.to_string())?;
                let mut out = Vec::new();
                for row in rows {
                    let cols_info: Vec<ColumnInfo> = row.columns().iter().map(|c| mysql_column_info_free(c)).collect();
                    let mut map = serde_json::Map::new();
                    for col in &cols_info {
                        let v = mysql_decode_value_free(&row, col);
                        map.insert(col.name.clone(), v);
                    }
                    let json = serde_json::Value::Object(map);
                    for c in cols {
                        if let Some(v) = json.get(*c) {
                            if let Some(s) = v.as_str() {
                                if s.to_lowercase().contains(&needle.to_lowercase()) {
                                    out.push(FindMatch { table: table.to_string(), column: (*c).clone(), value: s.to_string(), row: json.clone() });
                                }
                            }
                        }
                    }
                }
                Ok(out)
            }
            DbConnection::Pg(pool) => {
                let qualified = format!("\"{}\".\"{}\"", database.replace('"', "\"\""), table.replace('"', "\"\""));
                let conds = cols.iter().map(|c| format!("\"{}\" ILIKE '{}'", c.replace('"', "\"\""), pattern.replace('\'', "''"))).collect::<Vec<_>>().join(" OR ");
                let sql = format!("SELECT * FROM {} WHERE {} LIMIT {}", qualified, conds, limit);
                let rows = sqlx::raw_sql(&sql).fetch_all(pool).await.map_err(|e| e.to_string())?;
                let mut out = Vec::new();
                for row in rows {
                    let cols_info: Vec<ColumnInfo> = row.columns().iter().map(|c| pg_column_info_free(c)).collect();
                    let mut map = serde_json::Map::new();
                    for col in &cols_info {
                        let v = pg_decode_value_free(&row, col);
                        map.insert(col.name.clone(), v);
                    }
                    let json = serde_json::Value::Object(map);
                    for c in cols {
                        if let Some(v) = json.get(*c) {
                            if let Some(s) = v.as_str() {
                                if s.to_lowercase().contains(&needle.to_lowercase()) {
                                    out.push(FindMatch { table: table.to_string(), column: (*c).clone(), value: s.to_string(), row: json.clone() });
                                }
                            }
                        }
                    }
                }
                Ok(out)
            }
            DbConnection::Sqlite(pool) => {
                let qualified = format!("\"{}\".\"{}\"", database.replace('"', "\"\""), table.replace('"', "\"\""));
                let conds = cols.iter().map(|c| format!("\"{}\" LIKE '{}'", c.replace('"', "\"\""), pattern.replace('\'', "''"))).collect::<Vec<_>>().join(" OR ");
                let sql = format!("SELECT * FROM {} WHERE {} LIMIT {}", qualified, conds, limit);
                let rows = sqlx::raw_sql(&sql).fetch_all(pool).await.map_err(|e| e.to_string())?;
                let mut out = Vec::new();
                for row in rows {
                    let cols_info: Vec<ColumnInfo> = row.columns().iter().map(|c| sqlite_column_info_free(c)).collect();
                    let mut map = serde_json::Map::new();
                    for col in &cols_info {
                        let v = sqlite_decode_value_free(&row, col);
                        map.insert(col.name.clone(), v);
                    }
                    let json = serde_json::Value::Object(map);
                    for c in cols {
                        if let Some(v) = json.get(*c) {
                            if let Some(s) = v.as_str() {
                                if s.to_lowercase().contains(&needle.to_lowercase()) {
                                    out.push(FindMatch { table: table.to_string(), column: (*c).clone(), value: s.to_string(), row: json.clone() });
                                }
                            }
                        }
                    }
                }
                Ok(out)
            }
            DbConnection::Oracle(conn) => {
                let conn = conn.clone();
                let table = table.to_string();
                let database = database.to_string();
                let cols: Vec<String> = cols.iter().map(|c| (*c).clone()).collect();
                let needle = needle.to_string();
                let result = tokio::task::spawn_blocking(move || {
                    let conn = conn.lock().map_err(|e| e.to_string())?;
                    let owner = if database.is_empty() { "".to_string() } else { database.clone() };
                    let qtable = if table.contains('.') {
                        table.clone()
                    } else if !owner.is_empty() {
                        format!("\"{}\".\"{}\"", owner.replace('"', "\"\""), table.replace('"', "\"\""))
                    } else {
                        format!("\"{}\"", table.replace('"', "\"\""))
                    };
                    let conds = cols.iter().map(|c| format!("\"{}\" LIKE '%{}%'", c.replace('"', "\"\""), needle.replace('\'', "''"))).collect::<Vec<_>>().join(" OR ");
                    let sql = format!("SELECT * FROM {} WHERE {} FETCH FIRST {} ROWS ONLY", qtable, conds, limit);
                    let mut stmt = conn.query(&sql, &[]).map_err(|e| e.to_string())?;
                    let cols_info: Vec<String> = stmt.column_info().iter().map(|c| c.name().to_string()).collect();
                    let mut out = Vec::new();
                    while let Some(row) = stmt.next() {
                        let row = row.map_err(|e| e.to_string())?;
                        let mut map = serde_json::Map::new();
                        for (i, col) in cols_info.iter().enumerate() {
                            let v = oracle_decode_value(&row, i);
                            map.insert(col.clone(), v);
                        }
                        let json = serde_json::Value::Object(map);
                        for c in &cols {
                            if let Some(v) = json.get(c) {
                                if let Some(s) = v.as_str() {
                                    if s.to_lowercase().contains(&needle.to_lowercase()) {
                                        out.push(FindMatch { table: table.clone(), column: c.clone(), value: s.to_string(), row: json.clone() });
                                    }
                                }
                            }
                        }
                    }
                    Ok(out)
                })
                .await
                .map_err(|e| e.to_string())?;
                result
            }
            DbConnection::Mongo(_, _) => Ok(vec![]),
            DbConnection::Redis(_) => Ok(vec![]),
        }
    }

    pub async fn execute_update(&self, query: &str) -> Result<QueryResult, String> {
        self.execute_query(query).await
    }

    pub async fn execute_batch(&self, queries: &[String]) -> Result<u64, String> {
        match self {
            DbConnection::MySql(pool) => {
                let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
                let mut count = 0u64;
                for q in queries {
                    let r = sqlx::query(q.as_str())
                        .execute(&mut *tx)
                        .await
                        .map_err(|e| e.to_string())?;
                    count += r.rows_affected();
                }
                tx.commit().await.map_err(|e| e.to_string())?;
                Ok(count)
            }
            DbConnection::Pg(pool) => {
                let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
                let mut count = 0u64;
                for q in queries {
                    let r = sqlx::query(q.as_str())
                        .execute(&mut *tx)
                        .await
                        .map_err(|e| e.to_string())?;
                    count += r.rows_affected();
                }
                tx.commit().await.map_err(|e| e.to_string())?;
                Ok(count)
            }
            DbConnection::Sqlite(pool) => {
                let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
                let mut count = 0u64;
                for q in queries {
                    let r = sqlx::query(q.as_str())
                        .execute(&mut *tx)
                        .await
                        .map_err(|e| e.to_string())?;
                    count += r.rows_affected();
                }
                tx.commit().await.map_err(|e| e.to_string())?;
                Ok(count)
            }
            DbConnection::Oracle(conn) => {
                let queries = queries.to_vec();
                let conn = conn.clone();
                let result = tokio::task::spawn_blocking(move || {
                    let conn = conn.lock().map_err(|e| e.to_string())?;
                    for q in &queries {
                        if let Err(e) = conn.execute(q, &[]) {
                            let _ = conn.rollback();
                            return Err(e.to_string());
                        }
                    }
                    conn.commit().map_err(|e| e.to_string())?;
                    Ok(queries.len() as u64)
                })
                .await
                .map_err(|e| e.to_string())?;
                result
            }
            DbConnection::Mongo(_, _) => {
                Err("Batch execution is not supported for MongoDB connections".to_string())
            }
            DbConnection::Redis(_) => {
                Err("Batch execution is not supported for Redis connections".to_string())
            }
        }
    }

pub async fn bulk_insert(
    &self,
    table: &str,
    columns: &[String],
    rows: &[Vec<serde_json::Value>],
    database: Option<&str>,
    source_col_types: Option<&[String]>,
    conflict_strategy: &types::ConflictStrategy,
) -> Result<u64, String> {
    let target_type = match self {
        DbConnection::MySql(_) => "mysql",
        DbConnection::Pg(_) => "postgresql",
        DbConnection::Sqlite(_) => "sqlite",
        DbConnection::Oracle(_) => "oracle",
        DbConnection::Mongo(_, _) => "mongodb",
        DbConnection::Redis(_) => "redis",
    };
    let quoted_table = if target_type == "mysql" {
        if let Some(db) = database {
            format!("`{}`.{}", db.replace('`', "``"), escape_identifier(table, target_type))
        } else {
            escape_identifier(table, target_type)
        }
    } else if target_type == "postgresql" {
        if let Some(db) = database {
            format!("\"{}\".{}", db.replace('"', "\"\""), escape_identifier(table, target_type))
        } else {
            escape_identifier(table, target_type)
        }
    } else {
        escape_identifier(table, target_type)
    };
        let col_list: Vec<String> = columns
            .iter()
            .map(|c| escape_identifier(c, target_type))
            .collect();
        let prefix = match conflict_strategy {
            types::ConflictStrategy::Ignore => format!(
                "INSERT IGNORE INTO {} ({}) ",
                quoted_table,
                col_list.join(", ")
            ),
            types::ConflictStrategy::Replace => format!(
                "REPLACE INTO {} ({}) ",
                quoted_table,
                col_list.join(", ")
            ),
            types::ConflictStrategy::Error => format!(
                "INSERT INTO {} ({}) ",
                quoted_table,
                col_list.join(", ")
            ),
        };

        macro_rules! push_json_val {
            ($b:ident, $val:expr) => {{
                match $val {
                    serde_json::Value::Null => $b.push_bind(None::<String>),
                    serde_json::Value::Bool(b) => $b.push_bind(*b),
                    serde_json::Value::Number(n) => {
                        if let Some(i) = n.as_i64() {
                            $b.push_bind(i)
                        } else {
                            $b.push_bind(n.as_f64().unwrap_or(0.0))
                        }
                    }
                    serde_json::Value::String(s) => $b.push_bind(s.clone()),
                    _ => $b.push_bind($val.to_string()),
                }
            }};
        }

        match self {
            DbConnection::MySql(pool) => {
                let max_cols = columns.len().max(1);
                let chunk_size = (65535usize / max_cols).min(500).max(1);
                let mut total_rows = 0u64;
                for row_chunk in rows.chunks(chunk_size) {
                    let mut qb = sqlx::QueryBuilder::<sqlx::MySql>::new(&prefix);
                    qb.push_values(row_chunk.iter(), |mut b, row| {
                        for (col_idx, val) in row.iter().enumerate() {
                            // MySQL's JSON column rejects non-text parameter types (e.g. a bare
                            // number bound as i64 fails with "Invalid JSON text"). Always bind the
                            // JSON text representation for JSON columns so scalars/arrays/objects
                            // are all accepted.
                            let is_json = source_col_types
                                .map(|types| types.get(col_idx).map(|t| t.to_lowercase().contains("json")).unwrap_or(false))
                                .unwrap_or(false);
                            if is_json {
                                match val {
                                    serde_json::Value::Null => { b.push_bind(None::<String>); }
                                    _ => { b.push_bind(val.to_string()); }
                                }
                            } else {
                                push_json_val!(b, val);
                            }
                        }
                    });
                    match qb.build().execute(pool).await {
                        Ok(result) => total_rows += result.rows_affected() as u64,
                        Err(e) => return Err(format!("MySQL bulk insert failed: {}", e)),
                    }
                }
                Ok(total_rows)
            }
            DbConnection::Pg(pool) => {
                let p_col_list: Vec<String> = columns
                    .iter()
                    .map(|c| escape_identifier(c, target_type))
                    .collect();
                let p_quoted_table = if let Some(db) = database {
                    format!("\"{}\".{}", db.replace('"', "\"\""), escape_identifier(table, target_type))
                } else {
                    escape_identifier(table, target_type)
                };
                let mut batch_vals: Vec<String> = Vec::new();
                for row in rows {
                    let vals: Vec<String> = row.iter().enumerate().map(|(col_idx, val)| {
                        let tl = source_col_types.map(|types| types.get(col_idx).map(|t| t.to_lowercase()).unwrap_or_default()).unwrap_or_default();
                        if tl.contains("blob") || tl.contains("bytea") || tl.contains("binary") || tl.contains("varbinary") {
                            if let serde_json::Value::String(s) = val {
                                let hex = s.strip_prefix("0x").unwrap_or(s);
                                format!("'\\x{}'::BYTEA", hex)
                            } else {
                                "NULL".to_string()
                            }
                        } else if tl.contains("bool") || tl.contains("tinyint") {
                            match val {
                                serde_json::Value::Bool(b) => {
                                    if tl.contains("bool") && !tl.contains("tinyint") {
                                        (if *b { "TRUE" } else { "FALSE" }).to_string()
                                    } else {
                                        (if *b { "1" } else { "0" }).to_string()
                                    }
                                }
                                serde_json::Value::Null => "NULL".to_string(),
                                _ => escape_val(val, target_type),
                            }
                        } else {
                            escape_val(val, target_type)
                        }
                    }).collect();
                    batch_vals.push(format!("({})", vals.join(", ")));
                }
                let conflict_suffix = match conflict_strategy {
                    types::ConflictStrategy::Ignore => " ON CONFLICT DO NOTHING".to_string(),
                    types::ConflictStrategy::Replace => {
                        let updates: Vec<String> = p_col_list.iter()
                            .map(|c| format!("{} = EXCLUDED.{}", c, c))
                            .collect();
                        format!(" ON CONFLICT DO UPDATE SET {}", updates.join(", "))
                    }
                    types::ConflictStrategy::Error => String::new(),
                };
                let mut total_rows = 0u64;
                for chunk in batch_vals.chunks(500) {
                    let insert_sql = format!(
                        "INSERT INTO {} ({}) VALUES {}{}",
                        p_quoted_table,
                        p_col_list.join(", "),
                        chunk.join(",\n"),
                        conflict_suffix,
                    );
                    match sqlx::raw_sql(&insert_sql).execute(pool).await {
                        Ok(res) => { total_rows += res.rows_affected() as u64; }
                        Err(e) => { return Err(format!("{}", e)); }
                    }
                }
                Ok(total_rows)
            }
            DbConnection::Sqlite(pool) => {
                let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(&prefix);
                qb.push_values(rows.iter(), |mut b, row| {
                    for val in row {
                        push_json_val!(b, val);
                    }
                });
                let result = qb.build().execute(pool).await.map_err(|e| e.to_string())?;
                Ok(result.rows_affected() as u64)
            }
            DbConnection::Oracle(conn) => {
                let o_col_list: Vec<String> = columns
                    .iter()
                    .map(|c| escape_identifier(c, target_type))
                    .collect();
                let o_quoted_table = if let Some(db) = database {
                    format!("\"{}\".{}", db.replace('"', "\"\""), escape_identifier(table, target_type))
                } else {
                    escape_identifier(table, target_type)
                };
                let mut batch_vals: Vec<String> = Vec::new();
                for row in rows {
                    let vals: Vec<String> = row.iter().map(|val| escape_val(val, target_type)).collect();
                    batch_vals.push(format!("({})", vals.join(", ")));
                }
                let conn = conn.clone();
                let result = tokio::task::spawn_blocking(move || {
                    let conn = conn.lock().map_err(|e| e.to_string())?;
                    let mut count = 0u64;
                    for row_vals in &batch_vals {
                        let insert_sql = format!(
                            "INSERT INTO {} ({}) VALUES {}",
                            o_quoted_table,
                            o_col_list.join(", "),
                            row_vals,
                        );
                        conn.execute(&insert_sql, &[]).map_err(|e| format!("{}", e))?;
                        count += 1;
                    }
                    conn.execute("COMMIT", &[]).map_err(|e| e.to_string())?;
                    Ok(count)
                }).await.map_err(|e| e.to_string())?;
                result
            }
            _ => Err("bulk_insert not supported for this connection type".into()),
        }
    }
}

fn map_type(source_type: &str, source_db: &str) -> &'static str {
    let st = source_type.to_lowercase();
    match source_db {
        "mysql" => match st.as_str() {
            "int" | "int(11)" | "integer" | "tinyint" | "smallint" | "mediumint" => "INTEGER",
            "bigint" => "BIGINT",
            "varchar" | "char" | "tinytext" | "text" | "mediumtext" | "longtext"
            | "enum" | "set" => "TEXT",
            "float" | "double" | "decimal" | "numeric" | "real" => "REAL",
            "date" | "datetime" | "timestamp" | "time" | "year" => "TEXT",
            "blob" | "mediumblob" | "longblob" | "binary" | "varbinary" => "BLOB",
            _ => "TEXT",
        },
        "postgresql" => match st.as_str() {
            "integer" | "int4" | "int2" | "smallint" | "int" => "INTEGER",
            "bigint" | "int8" => "BIGINT",
            "serial" | "smallserial" => "INTEGER",
            "bigserial" => "BIGINT",
            "character varying" | "varchar" | "character" | "char" | "text"
            | "name" | "uuid" => "TEXT",
            "real" | "float4" | "double precision" | "float8" | "numeric" => "REAL",
            "timestamp" | "timestamptz" | "date" | "time" | "timetz" => "TEXT",
            "bytea" | "blob" => "BLOB",
            "boolean" | "bool" => "INTEGER",
            _ => "TEXT",
        },
        "sqlite" => match st.as_str() {
            "integer" | "int" | "bigint" | "smallint" | "tinyint" | "mediumint" => "INTEGER",
            "text" | "varchar" | "char" | "clob" => "TEXT",
            "real" | "double" | "float" | "numeric" | "decimal" => "REAL",
            "blob" => "BLOB",
            _ => "TEXT",
        },
        "oracle" => {
            if st.contains("number") {
                let paren = st.find('(');
                let has_scale = paren.and_then(|p| st[p+1..].find(',')).is_some();
                if has_scale || st.starts_with("float") || st.contains("binary_float") || st.contains("binary_double") {
                    "REAL"
                } else {
                    "BIGINT"
                }
            } else if st.contains("varchar2") || st.contains("nvarchar2") || st.contains("char")
                || st.contains("clob") || st.contains("nclob") || st.contains("long")
                || st.contains("xmltype") {
                "TEXT"
            } else if st.contains("blob") || st.contains("raw") {
                "BLOB"
            } else if st.contains("date") || st.contains("timestamp") {
                "TEXT"
            } else {
                "TEXT"
            }
        }
        _ => "TEXT",
    }
}

fn escape_identifier(name: &str, target_type: &str) -> String {
    if target_type == "postgresql" || target_type == "sqlite" || target_type == "oracle" {
        format!("\"{}\"", name.replace('"', "\"\""))
    } else {
        format!("`{}`", name.replace('`', "``"))
    }
}

fn escape_val(val: &serde_json::Value, target_type: &str) -> String {
    let or_like = target_type == "oracle";
    match val {
        serde_json::Value::Null => "NULL".to_string(),
        serde_json::Value::Number(n) => {
            if or_like && n.is_f64() {
                let f = n.as_f64().unwrap();
                format!("TO_NUMBER('{}')", f)
            } else {
                n.to_string()
            }
        }
        serde_json::Value::String(s) => {
            let escaped = s.replace('\'', "''");
            if or_like && escaped.is_empty() {
                "' '".to_string()
            } else if or_like && escaped.len() > 3000 {
                let mut chunks: Vec<String> = Vec::new();
                let mut pos = 0;
                for (i, _) in escaped.char_indices() {
                    if i - pos >= 2000 {
                        chunks.push(format!("TO_CLOB('{}')", &escaped[pos..i]));
                        pos = i;
                    }
                }
                if pos < escaped.len() {
                    chunks.push(format!("TO_CLOB('{}')", &escaped[pos..]));
                }
                chunks.join(" || ")
            } else {
                format!("'{}'", escaped)
            }
        }
        serde_json::Value::Bool(b) => {
            if target_type == "postgresql" {
                (if *b { "TRUE" } else { "FALSE" }).to_string()
            } else {
                (if *b { "1" } else { "0" }).to_string()
            }
        }
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            let s = val.to_string();
            let escaped = s.replace('\'', "''");
            if or_like && escaped.len() > 3000 {
                let mut chunks: Vec<String> = Vec::new();
                let mut pos = 0;
                for (i, _) in escaped.char_indices() {
                    if i - pos >= 2000 {
                        chunks.push(format!("TO_CLOB('{}')", &escaped[pos..i]));
                        pos = i;
                    }
                }
                if pos < escaped.len() {
                    chunks.push(format!("TO_CLOB('{}')", &escaped[pos..]));
                }
                chunks.join(" || ")
            } else {
                format!("'{}'", escaped)
            }
        }
    }
}

fn is_blob_type(mapped: &str) -> bool {
    matches!(mapped, "BLOB" | "TEXT" | "JSON")
}

fn is_auto_increment(col: &ColumnInfo, source_type: &str) -> bool {
    match source_type {
        "mysql" => col.extra.to_lowercase().contains("auto_increment"),
        "postgresql" => {
            col.default_value.as_deref().map(|d| d.contains("nextval")).unwrap_or(false)
                || col.data_type.to_lowercase().contains("serial")
        }
        "sqlite" => {
            col.key == "PRI" && col.data_type.to_lowercase().contains("integer")
        }
        _ => false,
    }
}

fn auto_increment_sql(target_type: &str, mapped_type: &str) -> String {
    match target_type {
        "mysql" => " AUTO_INCREMENT".to_string(),
        "postgresql" => {
            if mapped_type == "BIGINT" { " BIGSERIAL".to_string() }
            else { " SERIAL".to_string() }
        }
        _ => String::new(),
    }
}

fn is_invalid_mysql_default(d: &str) -> bool {
    let upper = d.trim().to_uppercase();
    upper == "'0000-00-00'" || upper == "'0000-00-00 00:00:00'" || upper == "'0000-00-00 00:00:00.000000'"
}

fn create_table_sql(table: &str, columns: &[ColumnInfo], source_type: &str, target_type: &str, database: Option<&str>) -> String {
    let mut col_defs: Vec<String> = Vec::new();
    let mut pk_cols: Vec<String> = Vec::new();

    for c in columns {
        let mut mapped = if target_type == source_type {
            c.data_type.clone()
        } else {
            let m = map_type(&c.data_type, source_type);
            if target_type == "mysql" && m == "TEXT" && c.data_type.to_lowercase().contains("long") {
                "LONGTEXT".to_string()
            } else {
                m.to_string()
            }
        };
        if target_type == "postgresql" && mapped == "BLOB" { mapped = "BYTEA".to_string(); }
        if target_type == "oracle" {
            if mapped == "TEXT" {
                if c.key == "PRI" || c.key == "PRIMARY" {
                    mapped = "VARCHAR2(255)".to_string();
                } else {
                    mapped = "CLOB".to_string();
                }
            }
            else if mapped == "REAL" { mapped = "NUMBER".to_string(); }
            else if mapped == "INTEGER" { mapped = "NUMBER(38)".to_string(); }
            else if mapped == "BIGINT" { mapped = "NUMBER(38)".to_string(); }
        }

        let null_str = "";

        let mut has_default = c.default_value.is_some() && !c.default_value.as_ref().unwrap().is_empty();
        let mut default_val = c.default_value.as_deref().unwrap_or("").to_string();

        if is_auto_increment(c, source_type) {
            has_default = false;
        } else if has_default {
            if target_type == "mysql" && is_blob_type(&mapped) {
                has_default = false;
            } else if target_type == "oracle" && mapped == "CLOB" {
                has_default = false;
            } else if target_type == "mysql" && is_invalid_mysql_default(&default_val) {
                let txt = default_val.trim().to_uppercase();
                if txt.contains("0000-00-00") {
                    default_val = "'1970-01-01'".to_string();
                }
            } else if target_type == "mysql" {
                let dv = default_val.trim();
                if dv == "," || dv == ",," || dv == "()" {
                    has_default = false;
                } else if !dv.starts_with('\'') && !dv.is_empty() {
                    let is_string_type = mapped.to_lowercase().contains("varchar")
                        || mapped.to_lowercase().contains("char")
                        || mapped.to_lowercase().contains("text")
                        || mapped.to_lowercase().starts_with("enum")
                        || mapped.to_lowercase().starts_with("set")
                        || mapped.to_lowercase().contains("json");
                    let is_temporal = mapped.to_lowercase().contains("datetime")
                        || mapped.to_lowercase().contains("timestamp")
                        || mapped.to_lowercase() == "date"
                        || mapped.to_lowercase().contains("time");
                    if is_string_type || is_temporal {
                        let up = dv.to_uppercase();
                        if up != "NULL" && up != "CURRENT_TIMESTAMP" && up != "CURRENT_DATE" && up != "CURRENT_TIME"
                            && up != "LOCALTIMESTAMP" && up != "LOCALTIME" && up != "NOW()"
                        {
                            default_val = format!("'{}'", dv.replace('\'', "\\'"));
                        }
                    }
                }
            } else if target_type == "postgresql" {
                let dv = default_val.trim();
                if dv.starts_with('`') || dv.starts_with('\"') {
                    has_default = false;
                } else if dv.starts_with('(') {
                    has_default = false;
                } else if !dv.starts_with('\'') && !dv.chars().all(|c| c.is_ascii_digit() || c == '.' || c == '-') {
                    let kw = dv.to_uppercase();
                    if kw != "NULL" && kw != "CURRENT_TIMESTAMP" && kw != "CURRENT_DATE" && kw != "CURRENT_TIME"
                        && kw != "TRUE" && kw != "FALSE" && kw != "LOCALTIMESTAMP" && kw != "LOCALTIME"
                    {
                        has_default = false;
                    }
                }
            } else if target_type == "oracle" {
                let dv = default_val.trim();
                if !dv.starts_with('\'') && !dv.is_empty() {
                    let kw = dv.to_uppercase();
                    if kw == "NULL" || kw == "SYSDATE" || kw == "SYSTIMESTAMP" || kw == "CURRENT_TIMESTAMP" {
                        // keep as-is
                    } else if mapped.to_lowercase().contains("varchar2") || mapped.to_lowercase().contains("char") {
                        default_val = format!("'{}'", dv.replace('\'', "''"));
                    } else {
                        has_default = false;
                    }
                }
            }
        }

        let default_str = if has_default {
            format!(" DEFAULT {}", default_val)
        } else {
            String::new()
        };

        let col_name = escape_identifier(&c.name, target_type);
        let is_ai = is_auto_increment(c, source_type);
        let (type_str, ai_str) = if is_ai && target_type == "postgresql" {
            let pg_type = if mapped == "BIGINT" { "BIGSERIAL" } else { "SERIAL" };
            (pg_type.to_string(), String::new())
        } else {
            let ai_suffix = if is_ai { auto_increment_sql(target_type, &mapped) } else { String::new() };
            (mapped.clone(), ai_suffix)
        };
        col_defs.push(format!(
            "  {} {}{}{}{}",
            col_name, type_str, null_str, ai_str, if is_ai && target_type == "postgresql" { "" } else { &default_str }
        ));

        if (c.key == "PRI" || c.key == "PRIMARY") && !(target_type == "mysql" && is_blob_type(&mapped)) {
            pk_cols.push(col_name);
        }
    }

    if !pk_cols.is_empty() {
        col_defs.push(format!("  PRIMARY KEY ({})", pk_cols.join(", ")));
    }

    let qualified_table = if target_type == "mysql" {
        if let Some(db) = database {
            format!("`{}`.{}", db.replace('`', "``"), escape_identifier(table, target_type))
        } else {
            escape_identifier(table, target_type)
        }
    } else if target_type == "postgresql" || target_type == "oracle" {
        if let Some(db) = database {
            format!("\"{}\".{}", db.replace('"', "\"\""), escape_identifier(table, target_type))
        } else {
            escape_identifier(table, target_type)
        }
    } else {
        escape_identifier(table, target_type)
    };

    let if_not_exists = if target_type == "oracle" { "" } else { "IF NOT EXISTS " };
    let suffix = if target_type == "oracle" { "" } else { ";" };
    if col_defs.is_empty() {
        return format!(
            "-- Cannot create table {}: no columns defined",
            qualified_table,
        );
    }
    format!(
        "CREATE TABLE {}{} (\n{}\n){}",
        if_not_exists,
        qualified_table,
        col_defs.join(",\n"),
        suffix,
    )
}

fn create_index_sql(table: &str, idx: &IndexInfo, target_type: &str, database: Option<&str>) -> String {
    let unique = if idx.unique { "UNIQUE " } else { "" };
    let cols: Vec<String> = idx.columns.iter()
        .map(|c| escape_identifier(c, target_type))
        .collect();
    let quoted_table = if target_type == "mysql" {
        if let Some(db) = database {
            format!("`{}`.{}", db.replace('`', "``"), escape_identifier(table, target_type))
        } else {
            escape_identifier(table, target_type)
        }
    } else if target_type == "postgresql" || target_type == "oracle" {
        if let Some(db) = database {
            format!("\"{}\".{}", db.replace('"', "\"\""), escape_identifier(table, target_type))
        } else {
            escape_identifier(table, target_type)
        }
    } else {
        escape_identifier(table, target_type)
    };
    let if_not_exists = match target_type {
        "postgresql" | "sqlite" => "IF NOT EXISTS ",
        _ => "",
    };
    format!(
        "CREATE {}INDEX {} {} ON {} ({})",
        unique, if_not_exists, escape_identifier(&idx.name, target_type),
        quoted_table, cols.join(", ")
    )
}

fn create_foreign_key_sql(
    source_table: &str,
    fk: &ForeignKeyInfo,
    target_type: &str,
) -> String {
    let quoted_table = escape_identifier(source_table, target_type);
    let quoted_col = escape_identifier(&fk.column_name, target_type);
    let quoted_ref_table = escape_identifier(&fk.ref_table, target_type);
    let quoted_ref_col = escape_identifier(&fk.ref_column, target_type);
    let constraint_name = fk.constraint_name.as_deref()
        .map(|n| format!("CONSTRAINT {} ", escape_identifier(n, target_type)))
        .unwrap_or_default();
    format!(
        "ALTER TABLE {} ADD {}FOREIGN KEY ({}) REFERENCES {} ({})",
        quoted_table, constraint_name, quoted_col, quoted_ref_table, quoted_ref_col
    )
}

pub async fn compare_schemas(
    source: &DbConnection,
    target: &DbConnection,
    source_database: &str,
    target_database: &str,
) -> Result<types::CompareResult, String> {
    let src_cache = source.get_schema_cache(source_database).await?;
    let tgt_cache = target.get_schema_cache(target_database).await?;

    let mut tables: Vec<types::TableDiff> = Vec::new();
    let mut extra_in_source: Vec<String> = Vec::new();
    let mut extra_in_target: Vec<String> = Vec::new();

    let src_tables: Vec<&types::TableSchemaInfo> = src_cache.tables.iter().collect();
    let tgt_tables: Vec<&types::TableSchemaInfo> = tgt_cache.tables.iter().collect();

    for st in &src_tables {
        let tt = tgt_tables.iter().find(|t| t.table == st.table);
        match tt {
            None => {
                extra_in_source.push(st.table.clone());
                tables.push(types::TableDiff {
                    table: st.table.clone(),
                    status: "only_in_source".into(),
                    columns: st.columns.iter().map(|c| types::ColumnDiff {
                        name: c.name.clone(),
                        source_type: Some(c.data_type.clone()),
                        target_type: None,
                        source_nullable: Some(c.nullable),
                        target_nullable: None,
                        source_default: c.default_value.clone(),
                        target_default: None,
                        source_key: Some(c.key.clone()),
                        target_key: None,
                        status: "missing".into(),
                    }).collect(),
                    indexes: vec![],
                    foreign_keys: vec![],
                    sync_sql: vec![format!("CREATE TABLE {}", st.table)],
                });
            }
            Some(tgt) => {
                let mut columns: Vec<types::ColumnDiff> = Vec::new();
                for sc in &st.columns {
                    let tc = tgt.columns.iter().find(|c| c.name == sc.name);
                    match tc {
                        None => {
                            columns.push(types::ColumnDiff {
                                name: sc.name.clone(),
                                source_type: Some(sc.data_type.clone()),
                                target_type: None,
                                source_nullable: Some(sc.nullable),
                                target_nullable: None,
                                source_default: sc.default_value.clone(),
                                target_default: None,
                                source_key: Some(sc.key.clone()),
                                target_key: None,
                                status: "missing_in_target".into(),
                            });
                        }
                        Some(tc) => {
                            let mut status = "match".to_string();
                            if tc.data_type != sc.data_type { status = "type_mismatch".into(); }
                            else if tc.nullable != sc.nullable { status = "nullable_mismatch".into(); }
                            else if tc.default_value != sc.default_value { status = "default_mismatch".into(); }
                            else if tc.key != sc.key { status = "key_mismatch".into(); }
                            columns.push(types::ColumnDiff {
                                name: sc.name.clone(),
                                source_type: Some(sc.data_type.clone()),
                                target_type: Some(tc.data_type.clone()),
                                source_nullable: Some(sc.nullable),
                                target_nullable: Some(tc.nullable),
                                source_default: sc.default_value.clone(),
                                target_default: tc.default_value.clone(),
                                source_key: Some(sc.key.clone()),
                                target_key: Some(tc.key.clone()),
                                status,
                            });
                        }
                    }
                }
                for tc in &tgt.columns {
                    if !st.columns.iter().any(|c| c.name == tc.name) {
                        columns.push(types::ColumnDiff {
                            name: tc.name.clone(),
                            source_type: None,
                            target_type: Some(tc.data_type.clone()),
                            source_nullable: None,
                            target_nullable: Some(tc.nullable),
                            source_default: None,
                            target_default: tc.default_value.clone(),
                            source_key: None,
                            target_key: Some(tc.key.clone()),
                            status: "extra_in_target".into(),
                        });
                    }
                }

                let mut indexes: Vec<types::IndexDiff> = Vec::new();
                for si in &st.indexes {
                    let ti = tgt.indexes.iter().find(|i| i.name == si.name);
                    let status = match ti {
                        None => "missing_in_target",
                        Some(ti) if ti.columns != si.columns || ti.unique != si.unique => "mismatch",
                        Some(_) => "match",
                    };
                    indexes.push(types::IndexDiff {
                        name: si.name.clone(),
                        source_columns: si.columns.clone(),
                        target_columns: ti.map(|i| i.columns.clone()).unwrap_or_default(),
                        source_unique: si.unique,
                        target_unique: ti.map(|i| i.unique).unwrap_or(false),
                        status: status.into(),
                    });
                }

                let table_status = if columns.iter().any(|c| c.status != "match") || indexes.iter().any(|i| i.status != "match") {
                    "differs"
                } else {
                    "match"
                };

                let mut sync_sql: Vec<String> = Vec::new();
                for col in &columns {
                    if col.status == "missing_in_target" {
                        sync_sql.push(format!("ALTER TABLE {} ADD COLUMN {} {}", st.table, col.name, col.source_type.as_deref().unwrap_or("TEXT")));
                    }
                }

                tables.push(types::TableDiff {
                    table: st.table.clone(),
                    status: table_status.into(),
                    columns,
                    indexes,
                    foreign_keys: vec![],
                    sync_sql,
                });
            }
        }
    }

    for tt in &tgt_tables {
        if !src_tables.iter().any(|t| t.table == tt.table) {
            extra_in_target.push(tt.table.clone());
            tables.push(types::TableDiff {
                table: tt.table.clone(),
                status: "only_in_target".into(),
                columns: vec![],
                indexes: vec![],
                foreign_keys: vec![],
                sync_sql: vec![format!("DROP TABLE {}", tt.table)],
            });
        }
    }

    let match_count = tables.iter().filter(|t| t.status == "match").count();
    let diff_count = tables.iter().filter(|t| t.status != "match").count();
    let summary = format!("{} tables match, {} differ, {} extra in source, {} extra in target",
        match_count, diff_count, extra_in_source.len(), extra_in_target.len());

    Ok(types::CompareResult { tables, extra_in_source, extra_in_target, summary })
}

fn hex_to_bytes(hex: &str) -> Vec<u8> {
    let clean: String = hex.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    let mut bytes = Vec::with_capacity(clean.len() / 2);
    let mut i = 0;
    while i + 1 < clean.len() {
        if let (Ok(h), Ok(l)) = (
            u8::from_str_radix(&clean[i..i + 1], 16),
            u8::from_str_radix(&clean[i + 1..i + 2], 16),
        ) {
            bytes.push(h * 16 + l);
        }
        i += 2;
    }
    bytes
}

/// Oracle array-bound bulk insert using OCI Batch. Runs on a blocking thread
/// since OCI calls are synchronous. Returns (rows_inserted, errors).
async fn oracle_batch_insert(
    conn: Arc<std::sync::Mutex<oracle::Connection>>,
    table: &str,
    insert_sql: &str,
    col_names: &[String],
    col_types: &[String],
    mapped_rows: &[serde_json::Value],
) -> Result<(i64, Vec<String>), String> {
    let conn = conn.clone();
    let table = table.to_string();
    let insert_sql = insert_sql.to_string();
    let col_names: Vec<String> = col_names.to_vec();
    let col_types: Vec<String> = col_types.to_vec();
    let mapped_rows: Vec<serde_json::Value> = mapped_rows.to_vec();

    tokio::task::spawn_blocking(move || {
        let conn = conn.lock().map_err(|e| e.to_string())?;
        let col_types_lower: Vec<String> = col_types.iter().map(|t| t.to_lowercase()).collect();
        let mut errors = Vec::new();
        let mut rows_inserted = 0i64;
        if mapped_rows.is_empty() {
            return Ok((0, errors));
        }
        let batch_size = mapped_rows.len().max(1);
        let mut batch = conn.batch(&insert_sql, batch_size).build().map_err(|e| e.to_string())?;

        for row in &mapped_rows {
            let mut bind_vals: Vec<Box<dyn oracle::sql_type::ToSql>> = Vec::with_capacity(col_names.len());
            for (ci, c) in col_names.iter().enumerate() {
                let val = row.get(c).cloned().unwrap_or(serde_json::Value::Null);
                let tl = col_types_lower.get(ci).map(|s| s.as_str()).unwrap_or("");
                let is_blob = tl.starts_with("blob") || tl.starts_with("mediumblob") || tl.starts_with("longblob")
                    || tl.starts_with("tinyblob") || tl == "binary" || tl.starts_with("varbinary")
                    || tl == "bytea" || tl == "raw";
                if is_blob {
                    let v: Option<Vec<u8>> = match &val {
                        serde_json::Value::String(s) => Some(hex_to_bytes(s)),
                        _ => None,
                    };
                    bind_vals.push(Box::new(v));
                } else if tl.contains("int") || tl.contains("year") {
                    bind_vals.push(Box::new(val.as_i64()));
                } else if tl.contains("decimal") || tl.contains("float") || tl.contains("double")
                    || tl.contains("numeric") || tl.contains("real")
                {
                    let v: Option<f64> = val.as_f64().or_else(|| val.as_str().and_then(|s| s.parse().ok()));
                    bind_vals.push(Box::new(v));
                } else {
                    let v: Option<String> = match &val {
                        serde_json::Value::String(s) => Some(if s.is_empty() { " ".to_string() } else { s.clone() }),
                        _ => None,
                    };
                    bind_vals.push(Box::new(v));
                }
            }
            let refs: Vec<&dyn oracle::sql_type::ToSql> = bind_vals.iter().map(|b| b.as_ref()).collect();
            if let Err(e) = batch.append_row(&refs) {
                errors.push(format!("Oracle batch append error in '{}': {}", table, e));
                return Ok((rows_inserted, errors));
            }
        }
        match batch.execute() {
            Ok(_) => { rows_inserted = mapped_rows.len() as i64; }
            Err(e) => {
                errors.push(format!("Oracle batch execute error in '{}': {}", table, e));
            }
        }
        Ok((rows_inserted, errors))
    })
    .await
    .map_err(|e| e.to_string())?
}

pub async fn transfer_data(
    source: &DbConnection,
    target: &DbConnection,
    opts: &types::TransferOptions,
    log_tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
) -> Result<types::TransferResult, String> {
    let start = std::time::Instant::now();
    let mut tables_transferred = Vec::new();
    let mut rows_transferred = 0i64;
    let mut errors = Vec::new();
    let mut logs: Vec<String> = Vec::new();
    let mut stored_fks: HashMap<String, Vec<ForeignKeyInfo>> = HashMap::new();

    let source_type = match source {
        DbConnection::MySql(_) => "mysql",
        DbConnection::Pg(_) => "postgresql",
        DbConnection::Sqlite(_) => "sqlite",
        DbConnection::Mongo(_, _) => "mongodb",
        DbConnection::Oracle(_) => "oracle",
        DbConnection::Redis(_) => "redis",
    };

    let target_type = match target {
        DbConnection::MySql(_) => "mysql",
        DbConnection::Pg(_) => "postgresql",
        DbConnection::Sqlite(_) => "sqlite",
        DbConnection::Mongo(_, _) => "mongodb",
        DbConnection::Oracle(_) => "oracle",
        DbConnection::Redis(_) => "redis",
    };

    let completed: Vec<&str> = opts.checkpoint_id.as_ref()
        .map(|cp| cp.split(',').collect())
        .unwrap_or_default();

    'table_loop: for table in &opts.tables {
        macro_rules! check_error_mode {
            () => {
                match opts.error_mode {
                    types::ErrorMode::Stop => {
                        return Ok(types::TransferResult {
                            tables_transferred,
                            rows_transferred,
                            errors,
                            duration: format!("{:.2}s", start.elapsed().as_secs_f64()),
                            logs,
                        });
                    }
                    types::ErrorMode::SkipTable => {
                        break 'table_loop;
                    }
                    types::ErrorMode::Skip => {}
                }
            };
        }
        if completed.contains(&table.as_str()) {
            continue;
        }

        match source.get_schema_cache(&opts.source_database).await {
            Ok(cache) => {
                let schema = cache.tables.iter().find(|t| t.table == *table);
                let (cols, indexes, foreign_keys) = match schema {
                    Some(s) => (s.columns.clone(), s.indexes.clone(), s.foreign_keys.clone()),
                    None => {
                        errors.push(format!("Table '{}' not found in source", table));
                        check_error_mode!();
                        continue;
                    }
                };

                let col_mappings: HashMap<&str, &types::ColumnMapping> = opts.column_mappings.iter()
                    .map(|m| (m.source_column.as_str(), m)).collect();
                let mapped_cols: Vec<ColumnInfo> = if opts.column_mappings.is_empty() {
                    cols.clone()
                } else {
                    cols.iter().filter(|c| {
                        !col_mappings.get(c.name.as_str()).map(|m| m.skip).unwrap_or(false)
                    }).cloned().collect()
                };

                let target_cols: Vec<ColumnInfo> = if opts.column_mappings.is_empty() {
                    mapped_cols.clone()
                } else {
                    mapped_cols.iter().map(|c| {
                        let mut col = c.clone();
                        if let Some(m) = col_mappings.get(c.name.as_str()) {
                            if m.target_column != c.name {
                                col.name = m.target_column.clone();
                            }
                        }
                        col
                    }).collect()
                };

                if mapped_cols.is_empty() {
                    errors.push(format!("Table '{}': all columns were skipped via mappings", table));
                    check_error_mode!();
                    continue;
                }
                    { let _msg = format!("Starting table: {}", table); if let Some(ref _tx) = log_tx { let _ = _tx.send(_msg.clone()); } logs.push(_msg); }

                if opts.transfer_foreign_keys {
                    stored_fks.insert(table.clone(), foreign_keys.clone());
                }

                if opts.mode != types::TransferMode::DataOnly && target_type != "mongodb" {
                    if opts.drop_target {
                    { let _msg = format!("  Dropping table '{}'...", table); if let Some(ref _tx) = log_tx { let _ = _tx.send(_msg.clone()); } logs.push(_msg); }
                        let qualified_table = if target_type == "mysql" {
                            format!("`{}`.{}", opts.target_database.replace('`', "``"), escape_identifier(table, target_type))
                        } else if target_type == "postgresql" || target_type == "oracle" {
                            format!("\"{}\".{}", opts.target_database.replace('"', "\"\""), escape_identifier(table, target_type))
                        } else {
                            escape_identifier(table, target_type)
                        };
                        let drop_ddl = format!("DROP TABLE IF EXISTS {}", qualified_table);
                        target.execute_query(&drop_ddl).await.ok();
                    }
                    { let _msg = format!("  Creating table '{}'...", table); if let Some(ref _tx) = log_tx { let _ = _tx.send(_msg.clone()); } logs.push(_msg); }
                    let create_sql = create_table_sql(table, &target_cols, source_type, target_type, Some(&opts.target_database));
                    if let Err(e) = target.execute_query(&create_sql).await {
                        errors.push(format!("Failed to create table '{}': {}", table, e));
                        check_error_mode!();
                        continue;
                    }
                }

                if opts.mode == types::TransferMode::StructureOnly {
                    if opts.transfer_indexes {
                    logs.push(format!("  Creating indexes for '{}'...", table));
                        for idx in &indexes {
                            let idx_sql = create_index_sql(table, idx, target_type, Some(&opts.target_database));
                            if let Err(e) = target.execute_query(&idx_sql).await {
                                errors.push(format!("Failed to create index '{}' on '{}': {}", idx.name, table, e));
                                check_error_mode!();
                            }
                        }
                    }
                    logs.push(format!("  Structure done for '{}'", table));
                    tables_transferred.push(table.clone());
                    continue;
                }

                if opts.truncate_target && target_type != "mongodb" {
                    { let _msg = format!("  Truncating '{}'...", table); if let Some(ref _tx) = log_tx { let _ = _tx.send(_msg.clone()); } logs.push(_msg); }
                    let trunc_sql = format!("DELETE FROM {}", escape_identifier(table, target_type));
                    target.execute_query(&trunc_sql).await.ok();
                }

                let col_names: Vec<String> = target_cols.iter().map(|c| c.name.clone()).collect();
                let col_types: Vec<String> = target_cols.iter().map(|c| c.data_type.clone()).collect();
                let page_size = opts.page_size as i64;
                let mut page = 1;

                if target_type == "postgresql" {
                    target.execute_query("ROLLBACK").await.ok();
                }

                loop {
                    let data = match source.get_table_data(
                        &opts.source_database, table, page, page_size,
                        None, None,
                        opts.where_clause.as_deref(),
                        opts.row_limit,
                    ).await {
                        Ok(d) => d,
                        Err(e) => {
                            errors.push(format!("Failed to read data from '{}': {}", table, e));
                            check_error_mode!();
                            break;
                        }
                    };

                    if data.rows.is_empty() {
                        break;
                    }
                    { let _msg = format!("  Page {} ({} rows)...", page, data.rows.len()); if let Some(ref _tx) = log_tx { let _ = _tx.send(_msg.clone()); } logs.push(_msg); }

                    let mapped_rows: Vec<serde_json::Value> = if opts.column_mappings.is_empty() {
                        data.rows
                    } else {
                        data.rows.into_iter().map(|row_obj| {
                            let mut obj = serde_json::Map::new();
                            for col in &mapped_cols {
                                let src_name = col.name.as_str();
                                let val = col_mappings.get(src_name)
                                    .and_then(|m| m.default_value.clone())
                                    .or_else(|| row_obj.get(src_name).cloned())
                                    .unwrap_or(serde_json::Value::Null);
                                let tgt_name = col_mappings.get(src_name)
                                    .map(|m| m.target_column.as_str())
                                    .unwrap_or(src_name);
                                obj.insert(tgt_name.to_string(), val);
                            }
                            serde_json::Value::Object(obj)
                        }).collect()
                    };

                    if target_type == "mongodb" {
                        if let DbConnection::Mongo(client, db_name) = target {
                            let db = client.database(db_name);
                            let coll = db.collection::<mongodb::bson::Document>(table);
                            let mut docs = Vec::new();
                            for row in &mapped_rows {
                                if let Ok(doc) = mongodb::bson::to_document(row) {
                                    docs.push(doc);
                                }
                            }
                            if docs.len() != mapped_rows.len() {
                                errors.push(format!("MongoDB skipped {} rows in '{}' (BSON conversion failed)", mapped_rows.len() - docs.len(), table));
                            }
                            if !docs.is_empty() {
                                let inserted = docs.len() as i64;
                                if let Err(e) = coll.insert_many(docs).await {
                                    errors.push(format!("MongoDB insert error in '{}': {}", table, e));
                                    check_error_mode!();
                                } else {
                                    rows_transferred += inserted;
                                }
                            }
                        }
                    } else if target_type == "oracle" {
                        let col_types_lower: Vec<String> = col_types.iter().map(|t| t.to_lowercase()).collect();
                        let quoted_cols: Vec<String> = col_names.iter()
                            .map(|c| escape_identifier(c, target_type))
                            .collect();
                        let quoted_table = format!("\"{}\".{}", opts.target_database.replace('"', "\"\"").to_uppercase(), escape_identifier(table, target_type));
                        let col_list = quoted_cols.join(", ");

                        // Try OCI array binding first (much faster).
                        let mut batch_ok = false;
                        if let DbConnection::Oracle(conn) = target {
                            let placeholders: Vec<String> = (1..=col_names.len()).map(|i| format!(":{}", i)).collect();
                            let insert_sql = format!(
                                "INSERT INTO {} ({}) VALUES ({})",
                                quoted_table, col_list, placeholders.join(", "),
                            );
                            match oracle_batch_insert(conn.clone(), table, &insert_sql, &col_names, &col_types, &mapped_rows).await {
                                Ok((inserted, errs)) => {
                                    rows_transferred += inserted;
                                    if errs.is_empty() {
                                        batch_ok = true;
                                    } else {
                                        errors.extend(errs);
                                    }
                                }
                                Err(e) => {
                                    errors.push(format!("Oracle batch insert error in '{}': {}", table, e));
                                }
                            }
                        }

                        // Fall back to string-based INSERT ALL (handles CLOB > 4000 chars etc.)
                        if !batch_ok {
                            let mut batch_vals: Vec<String> = Vec::new();
                            for row in &mapped_rows {
                                let vals: Vec<String> = col_names.iter().enumerate().map(|(ci, c)| {
                                    let val = row.get(c).cloned().unwrap_or(serde_json::Value::Null);
                                    let tl = col_types_lower.get(ci).map(|s| s.as_str()).unwrap_or("");
                                    let is_blob = tl.starts_with("blob") || tl.starts_with("mediumblob") || tl.starts_with("longblob")
                                        || tl.starts_with("tinyblob") || tl == "binary" || tl.starts_with("varbinary")
                                        || tl == "bytea" || tl == "raw";
                                    if is_blob {
                                        if let serde_json::Value::String(s) = &val {
                                            let hex = s.strip_prefix("0x").unwrap_or(s);
                                            format!("HEXTORAW('{}')", hex)
                                        } else {
                                            "NULL".to_string()
                                        }
                                    } else {
                                        escape_val(&val, target_type)
                                    }
                                }).collect();
                                batch_vals.push(format!("({})", vals.join(", ")));
                            }
                            // Adaptive INSERT ALL batching: keep each statement under ~30KB
                            // to avoid OCI statement length limits (ORA-00913 on wide tables).
                            const MAX_BATCH_ROWS: usize = 500;
                            const MAX_STMT_BYTES: usize = 30_000;
                            let mut i = 0;
                            while i < batch_vals.len() {
                                let mut chunk: Vec<String> = Vec::new();
                                let mut stmt_len = 0usize;
                                while i < batch_vals.len() && chunk.len() < MAX_BATCH_ROWS {
                                    let extra = batch_vals[i].len() + 60;
                                    if !chunk.is_empty() && stmt_len + extra > MAX_STMT_BYTES {
                                        break;
                                    }
                                    stmt_len += extra;
                                    chunk.push(batch_vals[i].clone());
                                    i += 1;
                                }
                                let into_rows: Vec<String> = chunk.iter()
                                    .map(|row_vals| format!("  INTO {} ({}) VALUES {}", quoted_table, col_list, row_vals))
                                    .collect();
                                let insert_sql = format!("INSERT ALL\n{}\nSELECT 1 FROM dual", into_rows.join("\n"));
                                match target.execute_query(&insert_sql).await {
                                    Ok(_) => { rows_transferred += chunk.len() as i64; }
                                    Err(e) => {
                                        // Fall back to single-row inserts so one bad row
                                        // doesn't discard the whole batch.
                                        let mut fallback_ok = 0usize;
                                        for row_vals in &chunk {
                                            let one_sql = format!(
                                                "INSERT INTO {} ({}) VALUES {}",
                                                quoted_table, col_list, row_vals,
                                            );
                                            match target.execute_query(&one_sql).await {
                                                Ok(_) => { fallback_ok += 1; }
                                                Err(e2) => {
                                                    errors.push(format!("Insert error in '{}': {}", table, e2));
                                                    check_error_mode!();
                                                }
                                            }
                                        }
                                        rows_transferred += fallback_ok as i64;
                                        if fallback_ok < chunk.len() {
                                            errors.push(format!("Oracle INSERT ALL failed in '{}' (batch of {}); fell back to single rows ({} ok, {} bad). Batch error: {}",
                                                table, chunk.len(), fallback_ok, chunk.len() - fallback_ok, e));
                                        }
                                    }
                                }
                            }
                        }
                        target.execute_query("COMMIT").await.ok();
                    } else {
                        let ordered_rows: Vec<Vec<serde_json::Value>> = mapped_rows.iter().map(|row_obj| {
                            col_names.iter().map(|c| {
                                row_obj.get(c).cloned().unwrap_or(serde_json::Value::Null)
                            }).collect()
                        }).collect();
                        match target.bulk_insert(table, &col_names, &ordered_rows, Some(&opts.target_database), Some(&col_types), &opts.conflict_strategy).await {
                            Ok(n) => { rows_transferred += n as i64; }
                            Err(e) => {
                                errors.push(format!("Insert error in '{}': {}", table, e));
                                check_error_mode!();
                            }
                        }
                    }

                    if mapped_rows.len() < page_size as usize {
                        break;
                    }
                    page += 1;
                }

                if target_type == "postgresql" {
                    target.execute_query("ROLLBACK").await.ok();
                }

                if opts.transfer_indexes && opts.mode != types::TransferMode::StructureOnly {
                    logs.push(format!("  Creating indexes for '{}'...", table));
                    for idx in &indexes {
                        let idx_sql = create_index_sql(table, idx, target_type, Some(&opts.target_database));
                        if let Err(e) = target.execute_query(&idx_sql).await {
                            errors.push(format!("Failed to create index '{}' on '{}': {}", idx.name, table, e));
                            check_error_mode!();
                        }
                    }
                }
                    { let _msg = format!("Completed table: {}", table); if let Some(ref _tx) = log_tx { let _ = _tx.send(_msg.clone()); } logs.push(_msg); }
                tables_transferred.push(table.clone());
            }
            Err(e) => {
                errors.push(format!("Failed to get schema: {}", e));
            }
        }
    }

    if opts.transfer_foreign_keys {
        { let _msg = "Creating foreign keys...".to_string(); if let Some(ref _tx) = log_tx { let _ = _tx.send(_msg.clone()); } logs.push(_msg); }
        for table in &tables_transferred {
            if let Some(fks) = stored_fks.get(table) {
                for fk in fks {
                    let fk_sql = create_foreign_key_sql(table, fk, target_type);
                    if let Err(e) = target.execute_query(&fk_sql).await {
                        errors.push(format!("Failed to create FK on '{}': {}", table, e));
                        if matches!(opts.error_mode, types::ErrorMode::Stop) {
                            return Ok(types::TransferResult {
                                tables_transferred,
                                rows_transferred,
                                errors,
                                duration: format!("{:.2}s", start.elapsed().as_secs_f64()),
                                logs,
                            });
                        }
                    }
                }
            }
        }
    }

    if opts.transfer_views {
        { let _msg = "Creating views...".to_string(); if let Some(ref _tx) = log_tx { let _ = _tx.send(_msg.clone()); } logs.push(_msg); }
        if let Ok(cache) = source.get_schema_cache(&opts.source_database).await {
            for view in &cache.views {
                target.execute_query(&view.definition).await.ok();
            }
        }
    }

    if opts.transfer_routines {
        { let _msg = "Creating functions/procedures...".to_string(); if let Some(ref _tx) = log_tx { let _ = _tx.send(_msg.clone()); } logs.push(_msg); }
        if let Ok(cache) = source.get_schema_cache(&opts.source_database).await {
            for routine in &cache.routines {
                if !routine.definition.is_empty() {
                    target.execute_query(&routine.definition).await.ok();
                }
            }
        }
    }

    if opts.transfer_triggers {
        { let _msg = "Creating triggers...".to_string(); if let Some(ref _tx) = log_tx { let _ = _tx.send(_msg.clone()); } logs.push(_msg); }
        if let Ok(cache) = source.get_schema_cache(&opts.source_database).await {
            for trigger in &cache.triggers {
                target.execute_query(&trigger.definition).await.ok();
            }
        }
    }

    Ok(types::TransferResult {
        tables_transferred,
        rows_transferred,
        errors,
        duration: format!("{:.2}s", start.elapsed().as_secs_f64()),
        logs,
    })
}

pub async fn backup_database(
    source: &DbConnection,
    database: &str,
    tables: &[String],
    output_path: &str,
    log_tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
) -> Result<(i32, String), String> {
    use tokio::io::AsyncWriteExt;
    let start = std::time::Instant::now();
    let source_type = match source {
        DbConnection::MySql(_) => "mysql",
        DbConnection::Pg(_) => "postgresql",
        DbConnection::Sqlite(_) => "sqlite",
        DbConnection::Mongo(_, _) => "mongodb",
        DbConnection::Oracle(_) => "oracle",
        DbConnection::Redis(_) => "redis",
    };

    let cache = source.get_schema_cache(database).await?;
    let mut file = tokio::fs::File::create(output_path).await.map_err(|e| e.to_string())?;

    let header = format!("-- DBManager Backup\n-- Source: {} / {}\n-- Date: {}\n\n", source_type, database, chrono::Local::now().format("%Y-%m-%d %H:%M:%S"));
    file.write_all(header.as_bytes()).await.map_err(|e| e.to_string())?;

    let mut table_count = 0i32;
    for table_name in tables {
        let schema = cache.tables.iter().find(|t| t.table == *table_name);
        let cols = match schema {
            Some(s) => &s.columns,
            None => {
                if let Some(ref tx) = log_tx { let _ = tx.send(format!("Table '{}' not found, skipping", table_name)); }
                continue;
            }
        };

        let create_sql = create_table_sql(table_name, cols, source_type, source_type, Some(database));
        file.write_all(format!("{};\n\n", create_sql).as_bytes()).await.map_err(|e| e.to_string())?;

        if let Some(ref tx) = log_tx { let _ = tx.send(format!("Backing up '{}'...", table_name)); }

        let mut page = 1;
        let page_size: i64 = 2000;
        loop {
            let data = source.get_table_data(database, table_name, page, page_size, None, None, None, None).await?;
            if data.rows.is_empty() { break; }

            let col_names: Vec<String> = cols.iter().map(|c| c.name.clone()).collect();
            for row in &data.rows {
                let vals: Vec<String> = col_names.iter().map(|c| {
                    let val = row.get(c).cloned().unwrap_or(serde_json::Value::Null);
                    escape_val(&val, source_type)
                }).collect();

                let quoted_cols: Vec<String> = col_names.iter()
                    .map(|c| escape_identifier(c, source_type))
                    .collect();

                let insert_sql = format!(
                    "INSERT INTO {} ({}) VALUES ({});\n",
                    escape_identifier(table_name, source_type),
                    quoted_cols.join(", "),
                    vals.join(", "),
                );
                let _ = file.write_all(insert_sql.as_bytes()).await;
            }

            if data.rows.len() < page_size as usize { break; }
            page += 1;
        }

        if let Some(ref tx) = log_tx { let _ = tx.send(format!("  Done: {} rows", page_size)); }
        table_count += 1;
    }

    file.flush().await.map_err(|e| e.to_string())?;
    let duration = format!("{:.2}s", start.elapsed().as_secs_f64());
    if let Some(ref tx) = log_tx { let _ = tx.send(format!("Backup complete: {} tables in {}", table_count, duration)); }

    Ok((table_count, duration))
}

pub async fn restore_database(
    target: &DbConnection,
    _database: &str,
    input_path: &str,
    log_tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
) -> Result<(i32, Vec<String>), String> {
    let start = std::time::Instant::now();
    let content = tokio::fs::read_to_string(input_path).await.map_err(|e| e.to_string())?;
    let mut errors = Vec::new();
    let mut count = 0i32;

    for stmt in content.split(';') {
        let trimmed = stmt.trim();
        if trimmed.is_empty() { continue; }
        // Filter out comment-only segments and extract SQL from segments with leading comments
        let lines: Vec<&str> = trimmed.lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty() && !l.starts_with("--"))
            .collect();
        if lines.is_empty() { continue; }
        let sql = lines.join(" ");

        if let Some(ref tx) = log_tx { let _ = tx.send(format!("Executing: {}...", &sql[..sql.len().min(80)])); }

        match target.execute_query(&sql).await {
            Ok(_) => count += 1,
            Err(e) => {
                errors.push(format!("{}", e));
                if let Some(ref tx) = log_tx { let _ = tx.send(format!("  Error: {}", e)); }
            }
        }
    }

    let duration = format!("{:.2}s", start.elapsed().as_secs_f64());
    if let Some(ref tx) = log_tx {
        let _ = tx.send(format!("Restore complete: {} statements in {} ({} errors)", count, duration, errors.len()));
    }

    Ok((count, errors))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use sqlx::SqlitePool;

    #[tokio::test]
    async fn test_type_mapping() {
        assert_eq!(map_type("varchar(255)", "mysql"), "TEXT");
        assert_eq!(map_type("int(11)", "mysql"), "INTEGER");
        assert_eq!(map_type("bigint", "mysql"), "BIGINT");
        assert_eq!(map_type("text", "mysql"), "TEXT");
        assert_eq!(map_type("float", "mysql"), "REAL");
        assert_eq!(map_type("blob", "mysql"), "BLOB");
        assert_eq!(map_type("character varying", "postgresql"), "TEXT");
        assert_eq!(map_type("integer", "postgresql"), "INTEGER");
        assert_eq!(map_type("boolean", "postgresql"), "INTEGER");
        assert_eq!(map_type("integer", "sqlite"), "INTEGER");
        assert_eq!(map_type("text", "sqlite"), "TEXT");
    }

    #[tokio::test]
    async fn test_escape_identifier() {
        assert_eq!(escape_identifier("test", "mysql"), "`test`");
        assert_eq!(escape_identifier("test", "postgresql"), "\"test\"");
        assert_eq!(escape_identifier("test`quote", "mysql"), "`test``quote`");
        assert_eq!(escape_identifier("test\"quote", "postgresql"), "\"test\"\"quote\"");
        assert_eq!(escape_identifier("test", "sqlite"), "\"test\"");
    }

    #[tokio::test]
    async fn test_create_table_sql_with_database() {
        let cols = vec![
            ColumnInfo { name: "id".into(), data_type: "INTEGER".into(), nullable: false, key: "PRI".into(), default_value: None, extra: String::new() },
            ColumnInfo { name: "name".into(), data_type: "TEXT".into(), nullable: true, key: String::new(), default_value: None, extra: String::new() },
        ];
        // MySQL with database qualifier
        let sql = create_table_sql("mytable", &cols, "mysql", "mysql", Some("mydb"));
        assert!(sql.contains("`mydb`.`mytable`"), "MySQL with db: {}", sql);
        assert!(sql.contains("PRIMARY KEY"), "PK missing: {}", sql);
        // SQLite without database
        let sql2 = create_table_sql("mytable", &cols, "mysql", "sqlite", None);
        assert!(sql2.contains("\"mytable\""), "SQLite no db: {}", sql2);
        assert!(sql2.contains("INTEGER"));
        assert!(sql2.contains("TEXT"));
    }

    #[tokio::test]
    async fn test_bulk_insert_and_verify() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT, flag INTEGER)")
            .execute(&pool).await.unwrap();
        let conn = DbConnection::Sqlite(pool.clone());

        sqlx::query("INSERT INTO t VALUES (1, 'hello', 1), (2, 'world', 0), (3, 'foo''bar', NULL)")
            .execute(&pool).await.unwrap();

        // Read source data via get_table_data
        let data = conn.get_table_data("main", "t", 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(data.rows.len(), 3);

        let col_names = vec!["id".to_string(), "v".to_string(), "flag".to_string()];
        let ordered_rows: Vec<Vec<serde_json::Value>> = data.rows.iter().map(|row_obj| {
            col_names.iter().map(|c| {
                row_obj.get(c).cloned().unwrap_or(serde_json::Value::Null)
            }).collect()
        }).collect();

        // Create target in same pool (different logical table)
        let target = DbConnection::Sqlite(pool.clone());
        let ddl = create_table_sql("t2", &vec![
            ColumnInfo { name: "id".into(), data_type: "INTEGER".into(), nullable: false, key: "PRI".into(), default_value: None, extra: String::new() },
            ColumnInfo { name: "v".into(), data_type: "TEXT".into(), nullable: true, key: String::new(), default_value: None, extra: String::new() },
            ColumnInfo { name: "flag".into(), data_type: "INTEGER".into(), nullable: true, key: String::new(), default_value: None, extra: String::new() },
        ], "sqlite", "sqlite", None);
        target.execute_query(&ddl).await.unwrap();

        let n = target.bulk_insert("t2", &col_names, &ordered_rows, None, None, &types::ConflictStrategy::Error).await.unwrap();
        assert_eq!(n, 3);

        let tgt_data = target.get_table_data("main", "t2", 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 3);
        let r0 = &tgt_data.rows[0];
        assert_eq!(r0.get("id").and_then(|v| v.as_i64()), Some(1));
        assert_eq!(r0.get("v").and_then(|v| v.as_str()), Some("hello"));
        assert_eq!(r0.get("flag").and_then(|v| v.as_i64()), Some(1));
        let r3 = &tgt_data.rows[2];
        assert_eq!(r3.get("v").and_then(|v| v.as_str()), Some("foo'bar"));
        assert!(r3.get("flag").is_none() || r3.get("flag") == Some(&json!(null)));
    }

    #[tokio::test]
    async fn test_full_transfer_sqlite_to_sqlite() {
        let src_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let tgt_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query("CREATE TABLE src_table (pk INTEGER PRIMARY KEY, val TEXT, flag INTEGER)")
            .execute(&src_pool).await.unwrap();
        sqlx::query("INSERT INTO src_table VALUES (1, 'alice', 1), (2, 'bob', 0), (3, 'charlie', NULL)")
            .execute(&src_pool).await.unwrap();

        let source = DbConnection::Sqlite(src_pool);
        let target = DbConnection::Sqlite(tgt_pool);

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: "main".into(),
            target_id: "tgt".into(),
            target_database: "main".into(),
            tables: vec!["src_table".into()],
                    conflict_strategy: types::ConflictStrategy::Error,
            ..Default::default()
        };

        let result = transfer_data(&source, &target, &opts, None).await.unwrap();
        assert_eq!(result.tables_transferred, vec!["src_table"]);
        assert_eq!(result.rows_transferred, 3, "Errors: {:?}", result.errors);
        assert!(result.errors.is_empty(), "Errors: {:?}", result.errors);

        let tgt_data = target.get_table_data("main", "src_table", 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 3);
    }

    #[tokio::test]
    async fn test_transfer_empty_table() {
        let src_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let tgt_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query("CREATE TABLE empty_t (id INTEGER, name TEXT)")
            .execute(&src_pool).await.unwrap();

        let source = DbConnection::Sqlite(src_pool);
        let target = DbConnection::Sqlite(tgt_pool);

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: "main".into(),
            target_id: "tgt".into(),
            target_database: "main".into(),
            tables: vec!["empty_t".into()],
                    conflict_strategy: types::ConflictStrategy::Error,
            ..Default::default()
        };

        let result = transfer_data(&source, &target, &opts, None).await.unwrap();
        assert_eq!(result.tables_transferred, vec!["empty_t"]);
        assert_eq!(result.rows_transferred, 0);
        assert!(result.errors.is_empty(), "Errors: {:?}", result.errors);
    }

    // ── Transfer mode tests (SQLite in-memory) ──

    #[tokio::test]
    async fn test_transfer_mode_structure_only() {
        let src_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let tgt_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query("CREATE TABLE t (id INT, val TEXT)")
            .execute(&src_pool).await.unwrap();
        sqlx::query("INSERT INTO t VALUES (1, 'data'), (2, 'more')")
            .execute(&src_pool).await.unwrap();

        let src = DbConnection::Sqlite(src_pool);
        let tgt = DbConnection::Sqlite(tgt_pool);

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: "main".into(),
            target_id: "tgt".into(),
            target_database: "main".into(),
            tables: vec!["t".into()],
            mode: types::TransferMode::StructureOnly,
            ..Default::default()
        };

        let result = transfer_data(&src, &tgt, &opts, None).await.unwrap();
        assert_eq!(result.tables_transferred, vec!["t"]);
        assert_eq!(result.rows_transferred, 0);
        assert!(result.errors.is_empty(), "Errors: {:?}", result.errors);

        let tgt_data = tgt.get_table_data("main", "t", 1, 100, None, None, None, None).await.unwrap();
        assert!(tgt_data.rows.is_empty(), "structure_only should not transfer data");
        assert_eq!(tgt_data.columns.len(), 2, "structure should have 2 columns");
        assert!(tgt_data.columns.iter().any(|c| c.name == "id"));
        assert!(tgt_data.columns.iter().any(|c| c.name == "val"));
    }

    #[tokio::test]
    async fn test_transfer_mode_data_only() {
        let src_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let tgt_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query("CREATE TABLE t (id INT, val TEXT)")
            .execute(&src_pool).await.unwrap();
        sqlx::query("INSERT INTO t VALUES (1, 'hello'), (2, 'world')")
            .execute(&src_pool).await.unwrap();

        sqlx::query("CREATE TABLE t (id INT, val TEXT)")
            .execute(&tgt_pool).await.unwrap();

        let src = DbConnection::Sqlite(src_pool);
        let tgt = DbConnection::Sqlite(tgt_pool);

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: "main".into(),
            target_id: "tgt".into(),
            target_database: "main".into(),
            tables: vec!["t".into()],
            mode: types::TransferMode::DataOnly,
            ..Default::default()
        };

        let result = transfer_data(&src, &tgt, &opts, None).await.unwrap();
        assert_eq!(result.rows_transferred, 2);
        assert!(result.errors.is_empty(), "Errors: {:?}", result.errors);

        let tgt_data = tgt.get_table_data("main", "t", 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 2);
    }

    #[tokio::test]
    async fn test_transfer_drop_target() {
        let src_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let tgt_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query("CREATE TABLE t (id INT, val TEXT)")
            .execute(&src_pool).await.unwrap();
        sqlx::query("INSERT INTO t VALUES (1, 'src')")
            .execute(&src_pool).await.unwrap();

        sqlx::query("CREATE TABLE t (id INT, other_col TEXT)")
            .execute(&tgt_pool).await.unwrap();
        sqlx::query("INSERT INTO t VALUES (99, 'old')")
            .execute(&tgt_pool).await.unwrap();

        let src = DbConnection::Sqlite(src_pool);
        let tgt = DbConnection::Sqlite(tgt_pool);

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: "main".into(),
            target_id: "tgt".into(),
            target_database: "main".into(),
            tables: vec!["t".into()],
            drop_target: true,
            ..Default::default()
        };

        let result = transfer_data(&src, &tgt, &opts, None).await.unwrap();
        assert!(result.errors.is_empty(), "Errors: {:?}", result.errors);
        assert_eq!(result.rows_transferred, 1);

        let tgt_data = tgt.get_table_data("main", "t", 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 1);
        assert_eq!(tgt_data.rows[0].get("val").and_then(|v| v.as_str()), Some("src"));
        assert!(tgt_data.columns.iter().any(|c| c.name == "val"), "should have val column from source");
        assert!(tgt_data.columns.iter().any(|c| c.name == "id"), "should have id column from source");
    }

    #[tokio::test]
    async fn test_transfer_truncate_target() {
        let src_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let tgt_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query("CREATE TABLE t (id INT, val TEXT)")
            .execute(&src_pool).await.unwrap();
        sqlx::query("INSERT INTO t VALUES (3, 'new')")
            .execute(&src_pool).await.unwrap();

        sqlx::query("CREATE TABLE t (id INT, val TEXT)")
            .execute(&tgt_pool).await.unwrap();
        sqlx::query("INSERT INTO t VALUES (1, 'old'), (2, 'old2')")
            .execute(&tgt_pool).await.unwrap();

        let src = DbConnection::Sqlite(src_pool);
        let tgt = DbConnection::Sqlite(tgt_pool);

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: "main".into(),
            target_id: "tgt".into(),
            target_database: "main".into(),
            tables: vec!["t".into()],
            truncate_target: true,
            ..Default::default()
        };

        let result = transfer_data(&src, &tgt, &opts, None).await.unwrap();
        assert!(result.errors.is_empty(), "Errors: {:?}", result.errors);
        assert_eq!(result.rows_transferred, 1);

        let tgt_data = tgt.get_table_data("main", "t", 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 1, "old rows should be truncated before insert");
        assert_eq!(tgt_data.rows[0].get("id").and_then(|v| v.as_i64()), Some(3));
    }

    #[tokio::test]
    async fn test_transfer_error_mode_skip() {
        let src_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let tgt_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query("CREATE TABLE t1 (id INT, val TEXT)")
            .execute(&src_pool).await.unwrap();
        sqlx::query("INSERT INTO t1 VALUES (1, 'data')")
            .execute(&src_pool).await.unwrap();
        sqlx::query("CREATE TABLE t2 (id INT, val TEXT)")
            .execute(&src_pool).await.unwrap();
        sqlx::query("INSERT INTO t2 VALUES (10, 'more')")
            .execute(&src_pool).await.unwrap();

        let src = DbConnection::Sqlite(src_pool);
        let tgt = DbConnection::Sqlite(tgt_pool);

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: "main".into(),
            target_id: "tgt".into(),
            target_database: "main".into(),
            tables: vec!["t1".into(), "nonexistent".into(), "t2".into()],
            error_mode: types::ErrorMode::Skip,
            ..Default::default()
        };

        let result = transfer_data(&src, &tgt, &opts, None).await.unwrap();
        assert!(result.tables_transferred.contains(&"t1".to_string()), "t1 should transfer");
        assert!(result.tables_transferred.contains(&"t2".to_string()), "t2 should transfer despite earlier error");
        assert_eq!(result.tables_transferred.len(), 2);
        assert_eq!(result.rows_transferred, 2);
        assert!(!result.errors.is_empty(), "should have reported the nonexistent table error");
    }

    #[tokio::test]
    async fn test_transfer_error_mode_stop() {
        let src_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let tgt_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query("CREATE TABLE t1 (id INT, val TEXT)")
            .execute(&src_pool).await.unwrap();
        sqlx::query("INSERT INTO t1 VALUES (1, 'data')")
            .execute(&src_pool).await.unwrap();
        sqlx::query("CREATE TABLE t2 (id INT, val TEXT)")
            .execute(&src_pool).await.unwrap();
        sqlx::query("INSERT INTO t2 VALUES (10, 'more')")
            .execute(&src_pool).await.unwrap();

        let src = DbConnection::Sqlite(src_pool);
        let tgt = DbConnection::Sqlite(tgt_pool);

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: "main".into(),
            target_id: "tgt".into(),
            target_database: "main".into(),
            tables: vec!["t1".into(), "nonexistent".into(), "t2".into()],
            error_mode: types::ErrorMode::Stop,
            ..Default::default()
        };

        let result = transfer_data(&src, &tgt, &opts, None).await.unwrap();
        assert!(result.tables_transferred.contains(&"t1".to_string()), "t1 should transfer");
        assert_eq!(result.tables_transferred.len(), 1, "t2 should NOT transfer because ErrorMode::Stop halts on error");
        assert_eq!(result.rows_transferred, 1);
        assert!(!result.errors.is_empty(), "should have reported the nonexistent table error");
    }

    #[tokio::test]
    async fn test_transfer_conflict_strategy_replace() {
        let src_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let tgt_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query("CREATE TABLE t (id INT PRIMARY KEY, val TEXT)")
            .execute(&src_pool).await.unwrap();
        sqlx::query("INSERT INTO t VALUES (1, 'replaced')")
            .execute(&src_pool).await.unwrap();

        sqlx::query("CREATE TABLE t (id INT PRIMARY KEY, val TEXT)")
            .execute(&tgt_pool).await.unwrap();
        sqlx::query("INSERT INTO t VALUES (1, 'original')")
            .execute(&tgt_pool).await.unwrap();

        let src = DbConnection::Sqlite(src_pool);
        let tgt = DbConnection::Sqlite(tgt_pool);

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: "main".into(),
            target_id: "tgt".into(),
            target_database: "main".into(),
            tables: vec!["t".into()],
            mode: types::TransferMode::DataOnly,
            conflict_strategy: types::ConflictStrategy::Replace,
            transfer_indexes: false,
            ..Default::default()
        };

        let result = transfer_data(&src, &tgt, &opts, None).await.unwrap();
        assert!(result.errors.is_empty(), "Errors: {:?}", result.errors);
        assert_eq!(result.rows_transferred, 1);

        let tgt_data = tgt.get_table_data("main", "t", 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 1);
        assert_eq!(tgt_data.rows[0].get("val").and_then(|v| v.as_str()), Some("replaced"));
    }

    // ── Checkpoint/resume tests (SQLite in-memory) ──

    #[tokio::test]
    async fn test_transfer_checkpoint_skips_completed_table() {
        let src_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let tgt_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query("CREATE TABLE t1 (id INT, val TEXT)")
            .execute(&src_pool).await.unwrap();
        sqlx::query("INSERT INTO t1 VALUES (1, 'data')")
            .execute(&src_pool).await.unwrap();

        let src = DbConnection::Sqlite(src_pool);
        let tgt = DbConnection::Sqlite(tgt_pool);

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: "main".into(),
            target_id: "tgt".into(),
            target_database: "main".into(),
            tables: vec!["t1".into()],
            checkpoint_id: Some("t1".into()),
            ..Default::default()
        };

        let result = transfer_data(&src, &tgt, &opts, None).await.unwrap();
        assert_eq!(result.tables_transferred.len(), 0, "completed table should be skipped");
        assert_eq!(result.rows_transferred, 0);
        assert!(result.errors.is_empty(), "Errors: {:?}", result.errors);
    }

    #[tokio::test]
    async fn test_transfer_checkpoint_skips_partial() {
        let src_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let tgt_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query("CREATE TABLE t1 (id INT, val TEXT)")
            .execute(&src_pool).await.unwrap();
        sqlx::query("INSERT INTO t1 VALUES (1, 'keep')")
            .execute(&src_pool).await.unwrap();
        sqlx::query("CREATE TABLE t2 (id INT, val TEXT)")
            .execute(&src_pool).await.unwrap();
        sqlx::query("INSERT INTO t2 VALUES (10, 'transfer')")
            .execute(&src_pool).await.unwrap();

        let src = DbConnection::Sqlite(src_pool);
        let tgt = DbConnection::Sqlite(tgt_pool);

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: "main".into(),
            target_id: "tgt".into(),
            target_database: "main".into(),
            tables: vec!["t1".into(), "t2".into()],
            checkpoint_id: Some("t1".into()),
            ..Default::default()
        };

        let result = transfer_data(&src, &tgt, &opts, None).await.unwrap();
        assert_eq!(result.tables_transferred, vec!["t2"], "only t2 should be transferred");
        assert_eq!(result.rows_transferred, 1);
        assert!(result.errors.is_empty(), "Errors: {:?}", result.errors);

        let tgt_data = tgt.get_table_data("main", "t2", 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 1);
        assert_eq!(tgt_data.rows[0].get("id").and_then(|v| v.as_i64()), Some(10));
    }

    #[tokio::test]
    async fn test_transfer_checkpoint_all_completed() {
        let src_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let tgt_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query("CREATE TABLE t1 (id INT, val TEXT)")
            .execute(&src_pool).await.unwrap();
        sqlx::query("INSERT INTO t1 VALUES (1, 'a')")
            .execute(&src_pool).await.unwrap();
        sqlx::query("CREATE TABLE t2 (id INT, val TEXT)")
            .execute(&src_pool).await.unwrap();
        sqlx::query("INSERT INTO t2 VALUES (2, 'b')")
            .execute(&src_pool).await.unwrap();

        let src = DbConnection::Sqlite(src_pool);
        let tgt = DbConnection::Sqlite(tgt_pool);

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: "main".into(),
            target_id: "tgt".into(),
            target_database: "main".into(),
            tables: vec!["t1".into(), "t2".into()],
            checkpoint_id: Some("t1,t2".into()),
            ..Default::default()
        };

        let result = transfer_data(&src, &tgt, &opts, None).await.unwrap();
        assert_eq!(result.tables_transferred.len(), 0, "all tables should be skipped");
        assert_eq!(result.rows_transferred, 0);
        assert!(result.errors.is_empty(), "Errors: {:?}", result.errors);
    }

    // ── Integration tests (require Docker containers, ignore by default) ──

    struct TestDb {
        url: String,
        db_name: String,
    }

    fn mysql_cfg() -> TestDb {
        let host = std::env::var("MYSQL_TEST_HOST").unwrap_or_else(|_| "127.0.0.1".into());
        let port = std::env::var("MYSQL_TEST_PORT").unwrap_or_else(|_| "3307".into());
        let user = std::env::var("MYSQL_TEST_USER").unwrap_or_else(|_| "root".into());
        let pass = std::env::var("MYSQL_TEST_PASSWORD").unwrap_or_else(|_| "testpass".into());
        let db = std::env::var("MYSQL_TEST_DB").unwrap_or_else(|_| "testdb".into());
        TestDb {
            url: format!("mysql://{}:{}@{}:{}/{}", user, pass, host, port, db),
            db_name: db,
        }
    }

    fn pg_cfg() -> TestDb {
        let host = std::env::var("PG_TEST_HOST").unwrap_or_else(|_| "127.0.0.1".into());
        let port = std::env::var("PG_TEST_PORT").unwrap_or_else(|_| "5433".into());
        let user = std::env::var("PG_TEST_USER").unwrap_or_else(|_| "postgres".into());
        let pass = std::env::var("PG_TEST_PASSWORD").unwrap_or_else(|_| "testpass".into());
        let db = std::env::var("PG_TEST_DB").unwrap_or_else(|_| "testdb".into());
        TestDb {
            url: format!("postgres://{}:{}@{}:{}/{}", user, pass, host, port, db),
            db_name: db,
        }
    }

    /// Create source table with various edge-case data and return the target table name
    async fn prepare_mysql_source(conn: &DbConnection, db: &str, table: &str) {
        let sql = format!(
            "CREATE TABLE IF NOT EXISTS `{}`.`{}` (\
             id INT PRIMARY KEY, name TEXT, flag INT, price FLOAT, data BLOB, active BOOLEAN, ts DATETIME, \
             nullable_col TEXT)",
            db, table
        );
        conn.execute_query(&sql).await.unwrap();

        let insert = format!(
            "INSERT INTO `{}`.`{}` VALUES \
             (1, 'hello', 1, 3.14, X'00FF', TRUE, '2024-01-15 10:30:00', 'val'), \
             (2, 'world', 0, -2.5, NULL, FALSE, NULL, NULL), \
             (3, 'foo''bar', NULL, 0.0, X'DEAD', TRUE, '2024-06-01', '')",
            db, table
        );
        conn.execute_query(&insert).await.unwrap();
    }

    /// Create source table for PostgreSQL
    async fn prepare_pg_source(conn: &DbConnection, table: &str) {
        let sql = format!(
            "CREATE TABLE \"{}\" (id INT PRIMARY KEY, name TEXT, flag INT, price REAL, data BYTEA, active BOOLEAN, \
             ts TIMESTAMP, nullable_col TEXT)",
            table
        );
        conn.execute_query(&sql).await.unwrap();

        let insert = format!(
            "INSERT INTO \"{}\" VALUES \
             (1, 'hello', 1, 3.14, '\\x00ff'::BYTEA, TRUE, '2024-01-15 10:30:00', 'val'), \
             (2, 'world', 0, -2.5, NULL, FALSE, NULL, NULL), \
             (3, 'foo''bar', NULL, 0.0, '\\xdead'::BYTEA, TRUE, '2024-06-01', '')",
            table
        );
        conn.execute_query(&insert).await.unwrap();
    }

    async fn verify_transfer(source: &DbConnection, target: &DbConnection, opts: &types::TransferOptions) {
        let result = transfer_data(source, target, opts, None).await.unwrap();
        assert!(!result.tables_transferred.is_empty(), "No tables transferred. Errors: {:?}", result.errors);
        assert_eq!(result.rows_transferred, 3, "Errors: {:?}", result.errors);
        assert!(result.errors.is_empty(), "Errors: {:?}", result.errors);
    }

    #[ignore]
    #[tokio::test]
    async fn test_mysql_to_mysql() {
        let cfg = mysql_cfg();
        let pool = sqlx::MySqlPool::connect(&cfg.url).await.unwrap();
        let conn = DbConnection::MySql(pool.clone());
        let src_table = format!("src_m2m_{}", std::process::id());

        prepare_mysql_source(&conn, &cfg.db_name, &src_table).await;

        let tgt_pool = sqlx::MySqlPool::connect(&cfg.url).await.unwrap();
        let target = DbConnection::MySql(tgt_pool);

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: cfg.db_name.clone(),
            target_id: "tgt".into(),
            target_database: cfg.db_name.clone(),
            tables: vec![src_table.clone()],
                    conflict_strategy: types::ConflictStrategy::Error,
            ..Default::default()
        };

        // Transfer to a different database to avoid name collision:
        target.execute_query(&format!("CREATE DATABASE IF NOT EXISTS `{}`", "migration_test")).await.unwrap();
        target.execute_query(&format!("DROP TABLE IF EXISTS `{}`.`{}`", "migration_test", src_table)).await.unwrap();

        let cross_opts = types::TransferOptions {
            source_database: cfg.db_name.clone(),
            target_database: "migration_test".into(),
            ..opts
        };

        verify_transfer(&conn, &target, &cross_opts).await;

        // Verify data
        let tgt_data = target.get_table_data("migration_test", &src_table, 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 3);
        let r0 = &tgt_data.rows[0];
        assert_eq!(r0.get("id").and_then(|v| v.as_i64()), Some(1));
        assert_eq!(r0.get("name").and_then(|v| v.as_str()), Some("hello"));
        assert_eq!(r0.get("flag").and_then(|v| v.as_i64()), Some(1));
        let r3 = &tgt_data.rows[2];
        assert_eq!(r3.get("name").and_then(|v| v.as_str()), Some("foo'bar"));

        // Cleanup
        conn.execute_query(&format!("DROP TABLE `{}`.`{}`", cfg.db_name, src_table)).await.unwrap();
        target.execute_query(&format!("DROP TABLE `{}`.`{}`", "migration_test", src_table)).await.unwrap();
        target.execute_query(&format!("DROP DATABASE IF EXISTS `{}`", "migration_test")).await.unwrap();
    }

    #[ignore]
    #[tokio::test]
    async fn test_pg_to_pg() {
        let cfg = pg_cfg();
        let pool = sqlx::PgPool::connect(&cfg.url).await.unwrap();
        let conn = DbConnection::Pg(pool.clone());
        let src_table = format!("src_p2p_{}", std::process::id());

        prepare_pg_source(&conn, &src_table).await;

        let tgt_pool = sqlx::PgPool::connect(&cfg.url).await.unwrap();
        let target = DbConnection::Pg(tgt_pool);

        // Transfer to different schema to avoid name collision
        target.execute_query("CREATE SCHEMA IF NOT EXISTS migration_test").await.unwrap();
        target.execute_query(&format!("DROP TABLE IF EXISTS \"migration_test\".\"{}\"", src_table)).await.unwrap();

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: cfg.db_name.clone(),
            target_id: "tgt".into(),
            target_database: "migration_test".into(),
            tables: vec![src_table.clone()],
                    conflict_strategy: types::ConflictStrategy::Error,
            ..Default::default()
        };

        verify_transfer(&conn, &target, &opts).await;

        let tgt_data = target.get_table_data("migration_test", &src_table, 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 3);

        // Cleanup
        conn.execute_query(&format!("DROP TABLE \"{}\"", src_table)).await.unwrap();
        target.execute_query(&format!("DROP TABLE \"migration_test\".\"{}\"", src_table)).await.unwrap();
        target.execute_query("DROP SCHEMA IF EXISTS migration_test CASCADE").await.unwrap();
    }

    #[ignore]
    #[tokio::test]
    async fn test_mysql_to_pg() {
        let mysql = mysql_cfg();
        let pg = pg_cfg();

        let mysql_pool = sqlx::MySqlPool::connect(&mysql.url).await.unwrap();
        let pg_pool = sqlx::PgPool::connect(&pg.url).await.unwrap();

        let src = DbConnection::MySql(mysql_pool);
        let tgt = DbConnection::Pg(pg_pool);

        let table = format!("cross_mp_{}", std::process::id());
        prepare_mysql_source(&src, &mysql.db_name, &table).await;

        tgt.execute_query(&format!("DROP TABLE IF EXISTS \"{}\"", table)).await.unwrap();

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: mysql.db_name.clone(),
            target_id: "tgt".into(),
            target_database: "public".into(),
            tables: vec![table.clone()],
                    conflict_strategy: types::ConflictStrategy::Error,
            ..Default::default()
        };

        verify_transfer(&src, &tgt, &opts).await;

        let tgt_data = tgt.get_table_data("public", &table, 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 3);
        assert_eq!(tgt_data.rows[0].get("id").and_then(|v| v.as_i64()), Some(1));
        assert_eq!(tgt_data.rows[2].get("name").and_then(|v| v.as_str()), Some("foo'bar"));

        // Cleanup
        src.execute_query(&format!("DROP TABLE `{}`.`{}`", mysql.db_name, table)).await.unwrap();
        tgt.execute_query(&format!("DROP TABLE \"{}\"", table)).await.unwrap();
    }

    #[ignore]
    #[tokio::test]
    async fn test_pg_to_mysql() {
        let pg = pg_cfg();
        let mysql = mysql_cfg();

        let pg_pool = sqlx::PgPool::connect(&pg.url).await.unwrap();
        let mysql_pool = sqlx::MySqlPool::connect(&mysql.url).await.unwrap();

        let src = DbConnection::Pg(pg_pool);
        let tgt = DbConnection::MySql(mysql_pool);

        let table = format!("cross_pm_{}", std::process::id());
        prepare_pg_source(&src, &table).await;

        tgt.execute_query(&format!("DROP TABLE IF EXISTS `{}`.`{}`", mysql.db_name, table)).await.unwrap();

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: pg.db_name.clone(),
            target_id: "tgt".into(),
            target_database: mysql.db_name.clone(),
            tables: vec![table.clone()],
                    conflict_strategy: types::ConflictStrategy::Error,
            ..Default::default()
        };

        verify_transfer(&src, &tgt, &opts).await;

        let tgt_data = tgt.get_table_data(&mysql.db_name, &table, 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 3);

        // Cleanup
        src.execute_query(&format!("DROP TABLE \"{}\"", table)).await.unwrap();
        tgt.execute_query(&format!("DROP TABLE `{}`.`{}`", mysql.db_name, table)).await.unwrap();
    }

    #[ignore]
    #[tokio::test]
    async fn test_sqlite_to_mysql() {
        let mysql = mysql_cfg();
        let mysql_pool = sqlx::MySqlPool::connect(&mysql.url).await.unwrap();
        let src_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query("CREATE TABLE src_t (id INTEGER PRIMARY KEY, name TEXT, flag INTEGER)")
            .execute(&src_pool).await.unwrap();
        sqlx::query("INSERT INTO src_t VALUES (1, 'hello', 1), (2, 'world', 0), (3, 'foo''bar', NULL)")
            .execute(&src_pool).await.unwrap();

        let src = DbConnection::Sqlite(src_pool);
        let tgt = DbConnection::MySql(mysql_pool);

        let table = format!("sqlite2mysql_{}", std::process::id());
        tgt.execute_query(&format!("DROP TABLE IF EXISTS `{}`.`{}`", mysql.db_name, table)).await.unwrap();

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: "main".into(),
            target_id: "tgt".into(),
            target_database: mysql.db_name.clone(),
            tables: vec!["src_t".into()],
                    conflict_strategy: types::ConflictStrategy::Error,
            ..Default::default()
        };

        verify_transfer(&src, &tgt, &opts).await;

        let tgt_data = tgt.get_table_data(&mysql.db_name, "src_t", 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 3);

        tgt.execute_query(&format!("DROP TABLE `{}`.`src_t`", mysql.db_name)).await.unwrap();
    }

    #[ignore]
    #[tokio::test]
    async fn test_transfer_large_data() {
        let cfg = mysql_cfg();
        let pool = sqlx::MySqlPool::connect(&cfg.url).await.unwrap();
        let conn = DbConnection::MySql(pool.clone());

        let src_table = format!("src_large_{}", std::process::id());

        // Create src table and populate with 1000 rows
        conn.execute_query(&format!(
            "CREATE TABLE `{}`.`{}` (id INT PRIMARY KEY, val TEXT)", cfg.db_name, src_table
        )).await.unwrap();
        let mut insert_sql = format!("INSERT INTO `{}`.`{}` VALUES ", cfg.db_name, src_table);
        let rows_1000: Vec<String> = (0..1000).map(|i| format!("({}, 'row_{}')", i, i)).collect();
        insert_sql.push_str(&rows_1000.join(","));
        conn.execute_query(&insert_sql).await.unwrap();

        // Verify paginated source read works (2 pages of 500)
        let page1 = conn.get_table_data(&cfg.db_name, &src_table, 1, 500, None, None, None, None).await.unwrap();
        assert_eq!(page1.rows.len(), 500);
        assert_eq!(page1.rows[0].get("id").and_then(|v| v.as_i64()), Some(0));
        let page2 = conn.get_table_data(&cfg.db_name, &src_table, 2, 500, None, None, None, None).await.unwrap();
        assert_eq!(page2.rows.len(), 500);
        assert_eq!(page2.rows[0].get("id").and_then(|v| v.as_i64()), Some(500));
        let page3 = conn.get_table_data(&cfg.db_name, &src_table, 3, 500, None, None, None, None).await.unwrap();
        assert_eq!(page3.rows.len(), 0);

        // Test transfer to a clean target table (different name, same db)
        let tgt_table = format!("tgt_large_{}", std::process::id());
        let tgt_pool = sqlx::MySqlPool::connect(&cfg.url).await.unwrap();
        let target = DbConnection::MySql(tgt_pool);
        target.execute_query(&format!(
            "CREATE TABLE `{}`.`{}` (id INT PRIMARY KEY, val TEXT)", cfg.db_name, tgt_table
        )).await.unwrap();

        // Manually insert via bulk_insert to verify it works for 1000 rows
        let col_info = conn.get_schema_cache(&cfg.db_name).await.unwrap();
        let src_cols = col_info.tables.iter().find(|t| t.table == src_table).unwrap();
        let col_names: Vec<String> = src_cols.columns.iter().map(|c| c.name.clone()).collect();
        let col_types: Vec<String> = src_cols.columns.iter().map(|c| c.data_type.clone()).collect();

        let ordered_rows: Vec<Vec<serde_json::Value>> = page1.rows.iter().chain(page2.rows.iter())
            .map(|row_obj| {
                col_names.iter().map(|c| {
                    row_obj.get(c).cloned().unwrap_or(serde_json::Value::Null)
                }).collect()
            }).collect();
        assert_eq!(ordered_rows.len(), 1000);

        let n = target.bulk_insert(&tgt_table, &col_names, &ordered_rows, Some(&cfg.db_name), Some(&col_types), &types::ConflictStrategy::Error).await.unwrap();
        assert_eq!(n, 1000);

        let verify = target.get_table_data(&cfg.db_name, &tgt_table, 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(verify.rows.len(), 100);
        assert_eq!(verify.total, 1000);

        // Cleanup
        conn.execute_query(&format!("DROP TABLE `{}`.`{}`", cfg.db_name, src_table)).await.unwrap();
        target.execute_query(&format!("DROP TABLE `{}`.`{}`", cfg.db_name, tgt_table)).await.unwrap();
    }

    // ── Extended source table with comprehensive types ──

    async fn prepare_extended_mysql_source(conn: &DbConnection, db: &str, table: &str) {
        conn.execute_query(&format!(
            "CREATE TABLE IF NOT EXISTS `{}`.`{}` (\
             id INT PRIMARY KEY, bigint_col BIGINT, decimal_col DECIMAL(10,2), \
             float_col FLOAT, double_col DOUBLE, \
             varchar_col VARCHAR(100), char_col CHAR(10), text_col TEXT, \
             blob_col BLOB, json_col JSON, \
             date_col DATE, datetime_col DATETIME, time_col TIME, \
             enum_col ENUM('a','b','c'), boolean_col BOOLEAN, \
             binary_col BINARY(10))",
            db, table
        )).await.unwrap();

        conn.execute_query(&format!(
            "INSERT INTO `{}`.`{}` VALUES \
             (1, 9999999999, 123.45, 1.5, 3.14, \
              'hello', 'abc', 'text1', X'00FF', '{{\"k\":1}}', \
              '2024-01-15', '2024-01-15 10:30:00', '10:30:00', \
              'a', TRUE, X'CAFE')",
            db, table
        )).await.unwrap();
    }

    async fn prepare_extended_pg_source(conn: &DbConnection, table: &str) {
        conn.execute_query(&format!(
            "CREATE TABLE \"{}\" (\
             id INT PRIMARY KEY, bigint_col BIGINT, decimal_col DECIMAL(10,2), \
             real_col REAL, double_col DOUBLE PRECISION, \
             varchar_col VARCHAR(100), char_col CHAR(10), text_col TEXT, \
             bytea_col BYTEA, json_col JSON, jsonb_col JSONB, uuid_col UUID, \
             date_col DATE, timestamp_col TIMESTAMP, time_col TIME, \
             boolean_col BOOLEAN)",
            table
        )).await.unwrap();

        conn.execute_query(&format!(
            "INSERT INTO \"{}\" VALUES \
             (1, 9999999999, 123.45, 1.5, 3.14, \
              'hello', 'abc', 'text1', '\\x00ff'::BYTEA, '{{\"k\":1}}'::JSON, '{{\"k\":1}}'::JSONB, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, \
              '2024-01-15', '2024-01-15 10:30:00', '10:30:00', TRUE)",
            table
        )).await.unwrap();
    }

    fn oracle_connect() -> DbConnection {
        let conn = oracle::Connection::connect("TESTUSER", "testpass", "//127.0.0.1:1521/XEPDB1").unwrap();
        DbConnection::Oracle(Arc::new(std::sync::Mutex::new(conn)))
    }

    async fn prepare_oracle_source(conn: &DbConnection, table: &str) {
        conn.execute_query(&format!(
            "CREATE TABLE \"{}\" (\
             ID NUMBER(38) PRIMARY KEY, BIGINT_COL NUMBER(38), DECIMAL_COL NUMBER(10,2), \
             FLOAT_COL BINARY_FLOAT, DOUBLE_COL BINARY_DOUBLE, \
             VARCHAR2_COL VARCHAR2(100), NVARCHAR2_COL NVARCHAR2(100), \
             CHAR_COL CHAR(10), NCHAR_COL NCHAR(10), \
             CLOB_COL CLOB, NCLOB_COL NCLOB, \
             BLOB_COL BLOB, RAW_COL RAW(100), \
             DATE_COL DATE, TIMESTAMP_COL TIMESTAMP, \
             TIMESTAMPTZ_COL TIMESTAMP WITH TIME ZONE, \
             FLOAT126_COL FLOAT(126))",
            table
        )).await.unwrap();

        conn.execute_query(&format!(
            "INSERT INTO \"{}\" VALUES \
             (1, 9999999999, 123.45, 1.5, 3.14, \
              'hello', N'hello2', \
              'abc', N'xyz', \
              'text1', N'text2', \
              HEXTORAW('00FF'), HEXTORAW('CAFE'), \
              TO_DATE('2024-01-15','YYYY-MM-DD'), \
              TO_TIMESTAMP('2024-01-15 10:30:00','YYYY-MM-DD HH24:MI:SS'), \
              TO_TIMESTAMP_TZ('2024-01-15 10:30:00 +00:00','YYYY-MM-DD HH24:MI:SS TZH:TZM'), \
              3.14)",
            table
        )).await.unwrap();
        conn.execute_query("COMMIT").await.unwrap();
    }

    async fn cleanup_oracle_source(conn: &DbConnection, table: &str) {
        conn.execute_query(&format!("DROP TABLE \"{}\"", table)).await.ok();
        conn.execute_query("COMMIT").await.ok();
    }

    // ── Missing cross-DB integration tests (basic types) ──

    #[ignore]
    #[tokio::test]
    async fn test_sqlite_to_pg() {
        let pg = pg_cfg();
        let sqlite_pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        let pg_pool = sqlx::PgPool::connect(&pg.url).await.unwrap();

        let src = DbConnection::Sqlite(sqlite_pool);
        let tgt = DbConnection::Pg(pg_pool);

        let table = format!("cross_sp_{}", std::process::id());
        let test_db = "main";
        src.execute_query("CREATE TABLE src_table (id INT, name TEXT, flag INT)").await.unwrap();
        src.execute_query("INSERT INTO src_table VALUES (1, 'hello', 1), (2, 'world', 0), (3, 'foo''bar', NULL)").await.unwrap();

        tgt.execute_query(&format!("DROP TABLE IF EXISTS \"{}\"", table)).await.unwrap();

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: test_db.into(),
            target_id: "tgt".into(),
            target_database: "public".into(),
            tables: vec!["src_table".into()],
                    conflict_strategy: types::ConflictStrategy::Error,
            ..Default::default()
        };

        verify_transfer(&src, &tgt, &opts).await;

        let tgt_data = tgt.get_table_data("public", "src_table", 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 3);
        assert_eq!(tgt_data.rows[0].get("id").and_then(|v| v.as_i64()), Some(1));

        tgt.execute_query(&format!("DROP TABLE \"{}\"", "src_table")).await.unwrap();
    }

    #[ignore]
    #[tokio::test]
    async fn test_pg_to_sqlite() {
        let pg = pg_cfg();
        let pg_pool = sqlx::PgPool::connect(&pg.url).await.unwrap();
        let sqlite_pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();

        let src = DbConnection::Pg(pg_pool);
        let tgt = DbConnection::Sqlite(sqlite_pool);

        let table = format!("cross_ps_{}", std::process::id());
        prepare_pg_source(&src, &table).await;

        tgt.execute_query("DROP TABLE IF EXISTS src_table").await.unwrap();

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: "testdb".into(),
            target_id: "tgt".into(),
            target_database: "main".into(),
            tables: vec![table.clone()],
                    conflict_strategy: types::ConflictStrategy::Error,
            ..Default::default()
        };

        verify_transfer(&src, &tgt, &opts).await;

        let tgt_data = tgt.get_table_data("main", &table, 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 3);
        assert_eq!(tgt_data.rows[0].get("id").and_then(|v| v.as_i64()), Some(1));

        src.execute_query(&format!("DROP TABLE \"{}\"", table)).await.unwrap();
        tgt.execute_query(&format!("DROP TABLE \"{}\"", table)).await.unwrap();
    }

    #[ignore]
    #[tokio::test]
    async fn test_mysql_to_sqlite() {
        let mysql = mysql_cfg();
        let mysql_pool = sqlx::MySqlPool::connect(&mysql.url).await.unwrap();
        let sqlite_pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();

        let src = DbConnection::MySql(mysql_pool);
        let tgt = DbConnection::Sqlite(sqlite_pool);

        let table = format!("cross_ms_{}", std::process::id());
        prepare_mysql_source(&src, &mysql.db_name, &table).await;

        tgt.execute_query("DROP TABLE IF EXISTS src_table").await.unwrap();

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: mysql.db_name.clone(),
            target_id: "tgt".into(),
            target_database: "main".into(),
            tables: vec![table.clone()],
                    conflict_strategy: types::ConflictStrategy::Error,
            ..Default::default()
        };

        verify_transfer(&src, &tgt, &opts).await;

        let tgt_data = tgt.get_table_data("main", &table, 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 3);
        assert_eq!(tgt_data.rows[0].get("id").and_then(|v| v.as_i64()), Some(1));

        src.execute_query(&format!("DROP TABLE `{}`.`{}`", mysql.db_name, table)).await.unwrap();
        tgt.execute_query(&format!("DROP TABLE \"{}\"", table)).await.unwrap();
    }

    // ── Extended type cross-DB tests ──

    #[ignore]
    #[tokio::test]
    async fn test_extended_mysql_to_pg() {
        let mysql = mysql_cfg();
        let pg = pg_cfg();
        let mysql_pool = sqlx::MySqlPool::connect(&mysql.url).await.unwrap();
        let pg_pool = sqlx::PgPool::connect(&pg.url).await.unwrap();

        let src = DbConnection::MySql(mysql_pool);
        let tgt = DbConnection::Pg(pg_pool);

        let table = format!("ext_mp_{}", std::process::id());
        prepare_extended_mysql_source(&src, &mysql.db_name, &table).await;

        tgt.execute_query(&format!("DROP TABLE IF EXISTS \"{}\"", table)).await.unwrap();

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: mysql.db_name.clone(),
            target_id: "tgt".into(),
            target_database: "public".into(),
            tables: vec![table.clone()],
                    conflict_strategy: types::ConflictStrategy::Error,
            ..Default::default()
        };

        let result = transfer_data(&src, &tgt, &opts, None).await.unwrap();
        assert_eq!(result.rows_transferred, 1, "Errors: {:?}", result.errors);
        assert!(result.errors.is_empty(), "Errors: {:?}", result.errors);

        let tgt_data = tgt.get_table_data("public", &table, 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 1);

        src.execute_query(&format!("DROP TABLE `{}`.`{}`", mysql.db_name, table)).await.unwrap();
        tgt.execute_query(&format!("DROP TABLE \"{}\"", table)).await.unwrap();
    }

    #[ignore]
    #[tokio::test]
    async fn test_extended_pg_to_mysql() {
        let pg = pg_cfg();
        let mysql = mysql_cfg();
        let pg_pool = sqlx::PgPool::connect(&pg.url).await.unwrap();
        let mysql_pool = sqlx::MySqlPool::connect(&mysql.url).await.unwrap();

        let src = DbConnection::Pg(pg_pool);
        let tgt = DbConnection::MySql(mysql_pool);

        let table = format!("ext_pm_{}", std::process::id());
        prepare_extended_pg_source(&src, &table).await;

        tgt.execute_query(&format!("DROP TABLE IF EXISTS `{}`.`{}`", mysql.db_name, table)).await.unwrap();

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: "testdb".into(),
            target_id: "tgt".into(),
            target_database: mysql.db_name.clone(),
            tables: vec![table.clone()],
                    conflict_strategy: types::ConflictStrategy::Error,
            ..Default::default()
        };

        let result = transfer_data(&src, &tgt, &opts, None).await.unwrap();
        assert_eq!(result.rows_transferred, 1, "Errors: {:?}", result.errors);
        assert!(result.errors.is_empty(), "Errors: {:?}", result.errors);

        let tgt_data = tgt.get_table_data(&mysql.db_name, &table, 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 1);

        src.execute_query(&format!("DROP TABLE \"{}\"", table)).await.unwrap();
        tgt.execute_query(&format!("DROP TABLE `{}`.`{}`", mysql.db_name, table)).await.unwrap();
    }

    #[ignore]
    #[tokio::test]
    async fn test_extended_mysql_to_oracle() {
        let mysql = mysql_cfg();
        let mysql_pool = sqlx::MySqlPool::connect(&mysql.url).await.unwrap();
        let src = DbConnection::MySql(mysql_pool);
        let oracle = oracle_connect();

        let table = format!("ext_mo_{}", std::process::id());
        prepare_extended_mysql_source(&src, &mysql.db_name, &table).await;

        cleanup_oracle_source(&oracle, &table).await;

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: mysql.db_name.clone(),
            target_id: "tgt".into(),
            target_database: "TESTUSER".into(),
            tables: vec![table.clone()],
            conflict_strategy: types::ConflictStrategy::Error,
            ..Default::default()
        };

        let result = transfer_data(&src, &oracle, &opts, None).await.unwrap();
        assert!(!result.tables_transferred.is_empty(), "Errors: {:?}", result.errors);
        assert_eq!(result.rows_transferred, 1, "Errors: {:?}", result.errors);
        assert!(result.errors.is_empty(), "Errors: {:?}", result.errors);

        let tgt_data = oracle.get_table_data("TESTUSER", &table, 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 1);
        assert_eq!(tgt_data.rows[0].get("id").or_else(|| tgt_data.rows[0].get("ID")).and_then(|v| v.as_i64()), Some(1));

        src.execute_query(&format!("DROP TABLE `{}`.`{}`", mysql.db_name, table)).await.unwrap();
        cleanup_oracle_source(&oracle, &table).await;
    }

    #[ignore]
    #[tokio::test]
    async fn test_extended_pg_to_oracle() {
        let pg = pg_cfg();
        let pg_pool = sqlx::PgPool::connect(&pg.url).await.unwrap();
        let src = DbConnection::Pg(pg_pool);
        let oracle = oracle_connect();

        let table = format!("ext_po_{}", std::process::id());
        prepare_extended_pg_source(&src, &table).await;

        cleanup_oracle_source(&oracle, &table).await;

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: "testdb".into(),
            target_id: "tgt".into(),
            target_database: "TESTUSER".into(),
            tables: vec![table.clone()],
            conflict_strategy: types::ConflictStrategy::Error,
            ..Default::default()
        };

        let result = transfer_data(&src, &oracle, &opts, None).await.unwrap();
        assert!(!result.tables_transferred.is_empty(), "Errors: {:?}", result.errors);
        assert_eq!(result.rows_transferred, 1, "Errors: {:?}", result.errors);
        assert!(result.errors.is_empty(), "Errors: {:?}", result.errors);

        let tgt_data = oracle.get_table_data("TESTUSER", &table, 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 1);
        assert_eq!(tgt_data.rows[0].get("id").or_else(|| tgt_data.rows[0].get("ID")).and_then(|v| v.as_i64()), Some(1));

        src.execute_query(&format!("DROP TABLE \"{}\"", table)).await.unwrap();
        cleanup_oracle_source(&oracle, &table).await;
    }

    // ── Oracle integration tests ──

    #[ignore]
    #[tokio::test]
    async fn test_oracle_source() {
        let conn = oracle_connect();
        let table = format!("oracle_src_{}", std::process::id());
        prepare_oracle_source(&conn, &table).await;

        let data = conn.get_table_data("TESTUSER", &table, 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(data.rows.len(), 1);
        assert_eq!(data.rows[0].get("ID").and_then(|v| v.as_i64()), Some(1));
        assert_eq!(data.rows[0].get("VARCHAR2_COL").and_then(|v| v.as_str()), Some("hello"));

        cleanup_oracle_source(&conn, &table).await;
    }

    #[ignore]
    #[tokio::test]
    async fn test_oracle_to_mysql() {
        let oracle = oracle_connect();
        let mysql = mysql_cfg();
        let mysql_pool = sqlx::MySqlPool::connect(&mysql.url).await.unwrap();
        let tgt = DbConnection::MySql(mysql_pool);

        let table = format!("oram_{}", std::process::id());
        prepare_oracle_source(&oracle, &table).await;

        tgt.execute_query(&format!("DROP TABLE IF EXISTS `{}`.`{}`", mysql.db_name, table)).await.unwrap();

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: "TESTUSER".into(),
            target_id: "tgt".into(),
            target_database: mysql.db_name.clone(),
            tables: vec![table.clone()],
                    conflict_strategy: types::ConflictStrategy::Error,
            ..Default::default()
        };

        let result = transfer_data(&oracle, &tgt, &opts, None).await.unwrap();
        assert!(!result.tables_transferred.is_empty(), "Errors: {:?}", result.errors);
        assert_eq!(result.rows_transferred, 1, "Errors: {:?}", result.errors);
        assert!(result.errors.is_empty(), "Errors: {:?}", result.errors);

        let tgt_data = tgt.get_table_data(&mysql.db_name, &table, 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 1);
        assert_eq!(tgt_data.rows[0].get("ID").or_else(|| tgt_data.rows[0].get("id")).and_then(|v| v.as_i64()), Some(1));

        cleanup_oracle_source(&oracle, &table).await;
        tgt.execute_query(&format!("DROP TABLE `{}`.`{}`", mysql.db_name, table)).await.unwrap();
    }

    #[ignore]
    #[tokio::test]
    async fn test_mysql_to_oracle() {
        let mysql = mysql_cfg();
        let mysql_pool = sqlx::MySqlPool::connect(&mysql.url).await.unwrap();
        let src = DbConnection::MySql(mysql_pool);
        let oracle = oracle_connect();

        let table = format!("myora_{}", std::process::id());
        prepare_mysql_source(&src, &mysql.db_name, &table).await;

        cleanup_oracle_source(&oracle, &table).await;

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: mysql.db_name.clone(),
            target_id: "tgt".into(),
            target_database: "TESTUSER".into(),
            tables: vec![table.clone()],
                    conflict_strategy: types::ConflictStrategy::Error,
            ..Default::default()
        };

        let result = transfer_data(&src, &oracle, &opts, None).await.unwrap();
        assert!(!result.tables_transferred.is_empty(), "Errors: {:?}", result.errors);
        assert_eq!(result.rows_transferred, 3, "Errors: {:?}", result.errors);
        assert!(result.errors.is_empty(), "Errors: {:?}", result.errors);

        let tgt_data = oracle.get_table_data("TESTUSER", &table, 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 3);
        assert_eq!(tgt_data.rows[0].get("id").and_then(|v| v.as_i64()), Some(1));

        src.execute_query(&format!("DROP TABLE `{}`.`{}`", mysql.db_name, table)).await.unwrap();
        cleanup_oracle_source(&oracle, &table).await;
    }

    #[ignore]
    #[tokio::test]
    async fn test_oracle_to_pg() {
        let oracle = oracle_connect();
        let pg = pg_cfg();
        let pg_pool = sqlx::PgPool::connect(&pg.url).await.unwrap();
        let tgt = DbConnection::Pg(pg_pool);

        let table = format!("orapg_{}", std::process::id());
        prepare_oracle_source(&oracle, &table).await;

        tgt.execute_query(&format!("DROP TABLE IF EXISTS \"{}\"", table)).await.unwrap();

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: "TESTUSER".into(),
            target_id: "tgt".into(),
            target_database: "public".into(),
            tables: vec![table.clone()],
                    conflict_strategy: types::ConflictStrategy::Error,
            ..Default::default()
        };

        let result = transfer_data(&oracle, &tgt, &opts, None).await.unwrap();
        assert!(!result.tables_transferred.is_empty(), "Errors: {:?}", result.errors);
        assert_eq!(result.rows_transferred, 1, "Errors: {:?}", result.errors);
        assert!(result.errors.is_empty(), "Errors: {:?}", result.errors);

        let tgt_data = tgt.get_table_data("public", &table, 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 1);

        cleanup_oracle_source(&oracle, &table).await;
        tgt.execute_query(&format!("DROP TABLE \"{}\"", table)).await.unwrap();
    }

    #[ignore]
    #[tokio::test]
    async fn test_pg_to_oracle() {
        let pg = pg_cfg();
        let pg_pool = sqlx::PgPool::connect(&pg.url).await.unwrap();
        let src = DbConnection::Pg(pg_pool);
        let oracle = oracle_connect();

        let table = format!("pgora_{}", std::process::id());
        prepare_pg_source(&src, &table).await;

        cleanup_oracle_source(&oracle, &table).await;

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: "testdb".into(),
            target_id: "tgt".into(),
            target_database: "TESTUSER".into(),
            tables: vec![table.clone()],
                    conflict_strategy: types::ConflictStrategy::Error,
            ..Default::default()
        };

        let result = transfer_data(&src, &oracle, &opts, None).await.unwrap();
        assert!(!result.tables_transferred.is_empty(), "Errors: {:?}", result.errors);
        assert_eq!(result.rows_transferred, 3, "Errors: {:?}", result.errors);
        assert!(result.errors.is_empty(), "Errors: {:?}", result.errors);

        let tgt_data = oracle.get_table_data("TESTUSER", &table, 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 3);

        src.execute_query(&format!("DROP TABLE \"{}\"", table)).await.unwrap();
        cleanup_oracle_source(&oracle, &table).await;
    }

    // ── Column mapping tests (SQLite in-memory) ──

    #[tokio::test]
    async fn test_transfer_column_mapping_rename() {
        let src_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let tgt_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query("CREATE TABLE t (id INT, val TEXT)")
            .execute(&src_pool).await.unwrap();
        sqlx::query("INSERT INTO t VALUES (1, 'hello')")
            .execute(&src_pool).await.unwrap();

        let src = DbConnection::Sqlite(src_pool);
        let tgt = DbConnection::Sqlite(tgt_pool);

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: "main".into(),
            target_id: "tgt".into(),
            target_database: "main".into(),
            tables: vec!["t".into()],
            column_mappings: vec![
                types::ColumnMapping {
                    source_column: "val".into(),
                    target_column: "renamed".into(),
                    skip: false,
                    default_value: None,
                },
            ],
            ..Default::default()
        };

        let result = transfer_data(&src, &tgt, &opts, None).await.unwrap();
        assert!(result.errors.is_empty(), "Errors: {:?}", result.errors);
        assert_eq!(result.rows_transferred, 1);

        let tgt_data = tgt.get_table_data("main", "t", 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 1);
        assert_eq!(tgt_data.rows[0].get("renamed").and_then(|v| v.as_str()), Some("hello"));
        assert!(tgt_data.rows[0].get("val").is_none(), "original column name should not exist in target");
    }

    #[tokio::test]
    async fn test_transfer_column_mapping_skip() {
        let src_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let tgt_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query("CREATE TABLE t (id INT, val TEXT, secret TEXT)")
            .execute(&src_pool).await.unwrap();
        sqlx::query("INSERT INTO t VALUES (1, 'visible', 'hidden')")
            .execute(&src_pool).await.unwrap();

        let src = DbConnection::Sqlite(src_pool);
        let tgt = DbConnection::Sqlite(tgt_pool);

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: "main".into(),
            target_id: "tgt".into(),
            target_database: "main".into(),
            tables: vec!["t".into()],
            column_mappings: vec![
                types::ColumnMapping {
                    source_column: "secret".into(),
                    target_column: "secret".into(),
                    skip: true,
                    default_value: None,
                },
            ],
            ..Default::default()
        };

        let result = transfer_data(&src, &tgt, &opts, None).await.unwrap();
        assert!(result.errors.is_empty(), "Errors: {:?}", result.errors);
        assert_eq!(result.rows_transferred, 1);

        let tgt_data = tgt.get_table_data("main", "t", 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 1);
        assert_eq!(tgt_data.rows[0].get("id").and_then(|v| v.as_i64()), Some(1));
        assert_eq!(tgt_data.rows[0].get("val").and_then(|v| v.as_str()), Some("visible"));
        assert!(tgt_data.rows[0].get("secret").is_none(), "skipped column should not be in target");
    }

    #[tokio::test]
    async fn test_transfer_column_mapping_default_value() {
        let src_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let tgt_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query("CREATE TABLE t (id INT, val TEXT)")
            .execute(&src_pool).await.unwrap();
        sqlx::query("INSERT INTO t VALUES (1, 'original')")
            .execute(&src_pool).await.unwrap();

        let src = DbConnection::Sqlite(src_pool);
        let tgt = DbConnection::Sqlite(tgt_pool);

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: "main".into(),
            target_id: "tgt".into(),
            target_database: "main".into(),
            tables: vec!["t".into()],
            column_mappings: vec![
                types::ColumnMapping {
                    source_column: "val".into(),
                    target_column: "val".into(),
                    skip: false,
                    default_value: Some(serde_json::json!("defaulted")),
                },
            ],
            ..Default::default()
        };

        let result = transfer_data(&src, &tgt, &opts, None).await.unwrap();
        assert!(result.errors.is_empty(), "Errors: {:?}", result.errors);
        assert_eq!(result.rows_transferred, 1);

        let tgt_data = tgt.get_table_data("main", "t", 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 1);
        assert_eq!(tgt_data.rows[0].get("val").and_then(|v| v.as_str()), Some("defaulted"));
    }

    #[tokio::test]
    async fn test_transfer_column_mapping_all_skipped() {
        let src_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let tgt_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query("CREATE TABLE t (id INT, val TEXT)")
            .execute(&src_pool).await.unwrap();
        sqlx::query("INSERT INTO t VALUES (1, 'data')")
            .execute(&src_pool).await.unwrap();

        let src = DbConnection::Sqlite(src_pool);
        let tgt = DbConnection::Sqlite(tgt_pool);

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: "main".into(),
            target_id: "tgt".into(),
            target_database: "main".into(),
            tables: vec!["t".into()],
            column_mappings: vec![
                types::ColumnMapping {
                    source_column: "id".into(),
                    target_column: "id".into(),
                    skip: true,
                    default_value: None,
                },
                types::ColumnMapping {
                    source_column: "val".into(),
                    target_column: "val".into(),
                    skip: true,
                    default_value: None,
                },
            ],
            ..Default::default()
        };

        let result = transfer_data(&src, &tgt, &opts, None).await.unwrap();
        assert!(!result.errors.is_empty(), "should error when all columns skipped");
        assert!(result.errors[0].contains("all columns were skipped"));
        assert!(result.tables_transferred.is_empty(), "no tables should be transferred");
    }

    #[tokio::test]
    async fn test_transfer_column_mapping_skip_and_default() {
        let src_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let tgt_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query("CREATE TABLE t (id INT, val TEXT, flag INT)")
            .execute(&src_pool).await.unwrap();
        sqlx::query("INSERT INTO t VALUES (1, 'text', 42)")
            .execute(&src_pool).await.unwrap();

        let src = DbConnection::Sqlite(src_pool);
        let tgt = DbConnection::Sqlite(tgt_pool);

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: "main".into(),
            target_id: "tgt".into(),
            target_database: "main".into(),
            tables: vec!["t".into()],
            column_mappings: vec![
                types::ColumnMapping {
                    source_column: "flag".into(),
                    target_column: "flag".into(),
                    skip: true,
                    default_value: None,
                },
                types::ColumnMapping {
                    source_column: "val".into(),
                    target_column: "val".into(),
                    skip: false,
                    default_value: Some(serde_json::json!("overridden")),
                },
            ],
            ..Default::default()
        };

        let result = transfer_data(&src, &tgt, &opts, None).await.unwrap();
        assert!(result.errors.is_empty(), "Errors: {:?}", result.errors);
        assert_eq!(result.rows_transferred, 1);

        let tgt_data = tgt.get_table_data("main", "t", 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 1);
        assert_eq!(tgt_data.rows[0].get("id").and_then(|v| v.as_i64()), Some(1));
        assert_eq!(tgt_data.rows[0].get("val").and_then(|v| v.as_str()), Some("overridden"), "default_value should override source");
        assert!(tgt_data.rows[0].get("flag").is_none(), "flag should be skipped");
    }

    #[tokio::test]
    async fn test_transfer_column_mapping_combined() {
        let src_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let tgt_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query("CREATE TABLE t (id INT, val TEXT, flag INT)")
            .execute(&src_pool).await.unwrap();
        sqlx::query("INSERT INTO t VALUES (1, 'text', 42)")
            .execute(&src_pool).await.unwrap();

        let src = DbConnection::Sqlite(src_pool);
        let tgt = DbConnection::Sqlite(tgt_pool);

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: "main".into(),
            target_id: "tgt".into(),
            target_database: "main".into(),
            tables: vec!["t".into()],
            column_mappings: vec![
                types::ColumnMapping {
                    source_column: "flag".into(),
                    target_column: "flag".into(),
                    skip: true,
                    default_value: None,
                },
                types::ColumnMapping {
                    source_column: "val".into(),
                    target_column: "renamed_val".into(),
                    skip: false,
                    default_value: None,
                },
            ],
            ..Default::default()
        };

        let result = transfer_data(&src, &tgt, &opts, None).await.unwrap();
        assert!(result.errors.is_empty(), "Errors: {:?}", result.errors);
        assert_eq!(result.rows_transferred, 1);

        let tgt_data = tgt.get_table_data("main", "t", 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 1);
        assert_eq!(tgt_data.rows[0].get("id").and_then(|v| v.as_i64()), Some(1), "id should be preserved");
        assert_eq!(tgt_data.rows[0].get("renamed_val").and_then(|v| v.as_str()), Some("text"), "val should be renamed");
        assert!(tgt_data.rows[0].get("flag").is_none(), "flag should be skipped");
    }

    // ── Real MySQL → Docker targets integration test (read-only on source) ──
    // Connects to the user's MySQL at 192.168.0.156:3306 (apps_beitou),
    // transfers 3 small tables to each Docker target, verifies row counts.
    // Only reads from source; never creates/drops/alters the source.

    #[ignore]
    #[tokio::test]
    async fn test_real_mysql_to_docker_all() {
        let src_pwd = std::env::var("MYSQL_SRC_PASSWORD").expect("MYSQL_SRC_PASSWORD env var required for source DB connection");
        let src_url = format!("mysql://root:{}@192.168.0.156:3306/apps_beitou", src_pwd);
        let src_pool = sqlx::MySqlPool::connect(&src_url).await.unwrap();
        let src = DbConnection::MySql(src_pool);

        let target_tables = vec![
            "luckysheet_model".to_string(),
            "new_contract_system_info".to_string(),
            "prj_funds_user".to_string(),
        ];

        // ── Target: MySQL (Docker) ──
        {
            let tgt_pool = sqlx::MySqlPool::connect("mysql://root:testpass@127.0.0.1:3307/testdb").await.unwrap();
            let tgt = DbConnection::MySql(tgt_pool);
            let db = "testdb";
            for t in &target_tables {
                tgt.execute_query(&format!("DROP TABLE IF EXISTS `{}`.`{}`", db, t)).await.unwrap();
            }
            let opts = types::TransferOptions {
                source_id: "src".into(),
                source_database: "apps_beitou".into(),
                target_id: "tgt".into(),
                target_database: db.into(),
                tables: target_tables.clone(),
                conflict_strategy: types::ConflictStrategy::Error,
                transfer_indexes: false,
                ..Default::default()
            };
            let result = transfer_data(&src, &tgt, &opts, None).await.unwrap();
            assert!(result.errors.is_empty(), "MySQL→MySQL errors: {:?}", result.errors);
            println!("MySQL→MySQL: {} tables, {} rows", result.tables_transferred.len(), result.rows_transferred);
            for t in &target_tables {
                tgt.execute_query(&format!("DROP TABLE IF EXISTS `{}`.`{}`", db, t)).await.unwrap();
            }
        }

        // ── Target: PostgreSQL (Docker) ──
        {
            let tgt_pool = sqlx::PgPool::connect("postgres://postgres:testpass@127.0.0.1:5433/testdb").await.unwrap();
            let tgt = DbConnection::Pg(tgt_pool);
            for t in &target_tables {
                tgt.execute_query(&format!("DROP TABLE IF EXISTS \"{}\"", t)).await.unwrap();
            }
            let opts = types::TransferOptions {
                source_id: "src".into(),
                source_database: "apps_beitou".into(),
                target_id: "tgt".into(),
                target_database: "public".into(),
                tables: target_tables.clone(),
                conflict_strategy: types::ConflictStrategy::Error,
                transfer_indexes: false,
                ..Default::default()
            };
            let result = transfer_data(&src, &tgt, &opts, None).await.unwrap();
            assert!(result.errors.is_empty(), "MySQL→PG errors: {:?}", result.errors);
            println!("MySQL→PG: {} tables, {} rows", result.tables_transferred.len(), result.rows_transferred);
            for t in &target_tables {
                tgt.execute_query(&format!("DROP TABLE IF EXISTS \"{}\"", t)).await.unwrap();
            }
        }

        // ── Target: Oracle (Docker) ──
        {
            let oracle = oracle_connect();
            // Clean both case variants (Oracle stores quoted names as-is)
            for t in &target_tables {
                oracle.execute_query(&format!("DROP TABLE \"{}\"", t)).await.ok();
                oracle.execute_query(&format!("DROP TABLE \"{}\"", t.to_uppercase())).await.ok();
            }
            oracle.execute_query("COMMIT").await.ok();

            let opts = types::TransferOptions {
                source_id: "src".into(),
                source_database: "apps_beitou".into(),
                target_id: "tgt".into(),
                target_database: "TESTUSER".into(),
                tables: target_tables.clone(),
                conflict_strategy: types::ConflictStrategy::Error,
                transfer_indexes: false,
                drop_target: true,
                ..Default::default()
            };
            let result = transfer_data(&src, &oracle, &opts, None).await.unwrap();
            assert!(result.errors.is_empty(), "MySQL→Oracle errors: {:?}", result.errors);
            println!("MySQL→Oracle: {} tables, {} rows", result.tables_transferred.len(), result.rows_transferred);
            for t in &target_tables {
                oracle.execute_query(&format!("DROP TABLE \"{}\"", t)).await.ok();
                oracle.execute_query(&format!("DROP TABLE \"{}\"", t.to_uppercase())).await.ok();
            }
            oracle.execute_query("COMMIT").await.ok();
        }
    }

    // ── Full database migration test (read-only on source) ──
    // Migrates ALL tables from apps_beitou to each Docker target,
    // measures duration, collects errors.

    #[ignore]
    #[tokio::test]
    async fn test_full_mysql_to_docker_all() {
        use std::time::Instant;

        let src_pwd = std::env::var("MYSQL_SRC_PASSWORD").expect("MYSQL_SRC_PASSWORD env var required for source DB connection");
        let src_url = format!("mysql://root:{}@192.168.0.156:3306/apps_beitou", src_pwd);
        let src_pool = sqlx::MySqlPool::connect(&src_url).await.unwrap();
        let src = DbConnection::MySql(src_pool);

        let tables_resp = src.get_tables("apps_beitou").await.unwrap();
        let all_tables: Vec<String> = tables_resp.into_iter()
            .filter(|t| t.object_type.contains("TABLE") || t.object_type.is_empty())
            .map(|t| t.name)
            .collect();
        println!("\n=== Full migration from apps_beitou ===");
        println!("Total tables: {}", all_tables.len());

        async fn run_migration(
            src: &DbConnection, tgt: &DbConnection,
            tables: &[String], src_db: &str, tgt_db: &str,
            label: &str,
        ) {
            use std::io::Write;
            let start = Instant::now();
            let mut opts = types::TransferOptions {
                source_id: "src".into(),
                source_database: src_db.into(),
                target_id: "tgt".into(),
                target_database: tgt_db.into(),
                tables: tables.to_vec(),
                conflict_strategy: types::ConflictStrategy::Error,
                error_mode: types::ErrorMode::Skip,
                transfer_indexes: false,
                ..Default::default()
            };
            // Process in batches to track progress
            let batch_size = 20;
            let mut total_tables = 0usize;
            let mut total_rows = 0i64;
            let mut all_errors = Vec::new();
            for batch in tables.chunks(batch_size) {
                opts.tables = batch.to_vec();
                print!("  {}: batch {}/{}, tables {}-{}... ", label,
                    (total_tables / batch_size) + 1,
                    (tables.len() + batch_size - 1) / batch_size,
                    total_tables + 1,
                    (total_tables + batch.len()).min(tables.len()));
                std::io::stdout().flush().unwrap();
                let result = transfer_data(src, tgt, &opts, None).await.unwrap();
                total_tables += result.tables_transferred.len();
                total_rows += result.rows_transferred;
                all_errors.extend(result.errors);
                println!("{} tables, {} rows, {} errors", result.tables_transferred.len(), result.rows_transferred, all_errors.len());
            }
            let elapsed = start.elapsed();
            let secs = elapsed.as_secs_f64();
            println!("── {} done ──", label);
            println!("  Duration: {:.1}s", secs);
            println!("  Tables transferred: {}/{}", total_tables, tables.len());
            println!("  Total rows: {}", total_rows);
            println!("  Errors: {}", all_errors.len());
            let rate = total_rows as f64 / secs.max(0.1);
            println!("  Rate: {:.0} rows/s", rate);
            if !all_errors.is_empty() {
                let mut by_table: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
                for e in &all_errors {
                    let tbl = tables.iter().find(|t| e.contains(t.as_str())).map(|s| s.as_str()).unwrap_or("unknown");
                    *by_table.entry(tbl).or_insert(0) += 1;
                }
                println!("  Error breakdown (top 10):");
                let mut sorted: Vec<(&&str, &usize)> = by_table.iter().collect();
                sorted.sort_by(|a, b| b.1.cmp(a.1));
                for (tbl, count) in sorted.iter().take(10) {
                    println!("    {}: {} errors", tbl, count);
                    for e in &all_errors {
                        if e.contains(*tbl) {
                            println!("      First error: {}", e);
                            break;
                        }
                    }
                }
            }
        }

        // MySQL Docker (re-verified after JSON scalar binding fix)
        {
            let tgt_pool = sqlx::MySqlPool::connect("mysql://root:testpass@127.0.0.1:3307/testdb").await.unwrap();
            let tgt = DbConnection::MySql(tgt_pool);
            let existing = tgt.get_tables("testdb").await.unwrap();
            for t in &existing {
                tgt.execute_query(&format!("DROP TABLE IF EXISTS `testdb`.`{}`", t.name.replace('`', "``"))).await.ok();
            }
            run_migration(&src, &tgt, &all_tables, "apps_beitou", "testdb", "MySQL (Docker)").await;
            let existing = tgt.get_tables("testdb").await.unwrap();
            for t in &existing {
                tgt.execute_query(&format!("DROP TABLE IF EXISTS `testdb`.`{}`", t.name.replace('`', "``"))).await.ok();
            }
        }
        // PostgreSQL Docker — SKIP (already verified: 192/192, 5.2M rows, 0 errors)
        // Oracle Docker — SKIP (already verified: 192/192, 5.2M rows, 0 errors)

        println!("\n=== Migration test complete ===");
    }

    // ── Full MySQL → MongoDB migration test (read-only on source) ──
    // Migrates ALL tables from apps_beitou to MongoDB Docker (27018),
    // measures duration, collects errors, verifies document counts.

    #[ignore]
    #[tokio::test]
    async fn test_full_mysql_to_mongodb_all() {
        use std::time::Instant;

        let src_pwd = std::env::var("MYSQL_SRC_PASSWORD").expect("MYSQL_SRC_PASSWORD env var required for source DB connection");
        let src_url = format!("mysql://root:{}@192.168.0.156:3306/apps_beitou", src_pwd);
        let src_pool = sqlx::MySqlPool::connect(&src_url).await.unwrap();
        let src = DbConnection::MySql(src_pool);

        let tables_resp = src.get_tables("apps_beitou").await.unwrap();
        let all_tables: Vec<String> = tables_resp.into_iter()
            .filter(|t| t.object_type.contains("TABLE") || t.object_type.is_empty())
            .map(|t| t.name)
            .collect();
        println!("\n=== Full MySQL → MongoDB migration from apps_beitou ===");
        println!("Total tables: {}", all_tables.len());

        let mongo_client = mongodb::Client::with_uri_str("mongodb://127.0.0.1:27018").await.unwrap();
        let target_db = "apps_beitou";
        let mongo = DbConnection::Mongo(mongo_client.clone(), target_db.to_string());

        mongo.drop_database(target_db).await.unwrap();

        use std::io::Write;
        let start = Instant::now();
        let batch_size = 20;
        let mut total_tables = 0usize;
        let mut total_rows = 0i64;
        let mut all_errors = Vec::new();
        for batch in all_tables.chunks(batch_size) {
            let opts = types::TransferOptions {
                source_id: "src".into(),
                source_database: "apps_beitou".into(),
                target_id: "tgt".into(),
                target_database: target_db.into(),
                tables: batch.to_vec(),
                conflict_strategy: types::ConflictStrategy::Error,
                error_mode: types::ErrorMode::Skip,
                transfer_indexes: false,
                ..Default::default()
            };
            print!("  MongoDB (Docker): batch {}/{}, tables {}-{}... ",
                (total_tables / batch_size) + 1,
                (all_tables.len() + batch_size - 1) / batch_size,
                total_tables + 1,
                (total_tables + batch.len()).min(all_tables.len()));
            std::io::stdout().flush().unwrap();
            let result = transfer_data(&src, &mongo, &opts, None).await.unwrap();
            total_tables += result.tables_transferred.len();
            total_rows += result.rows_transferred;
            all_errors.extend(result.errors);
            println!("{} tables, {} rows, {} errors", result.tables_transferred.len(), result.rows_transferred, all_errors.len());
        }
        let elapsed = start.elapsed();
        let secs = elapsed.as_secs_f64();
        println!("── MongoDB (Docker) done ──");
        println!("  Duration: {:.1}s", secs);
        println!("  Tables transferred: {}/{}", total_tables, all_tables.len());
        println!("  Total rows: {}", total_rows);
        println!("  Errors: {}", all_errors.len());
        println!("  Rate: {:.0} rows/s", total_rows as f64 / secs.max(0.1));

        // Verify document counts against source row counts.
        let src_pool_ref = match &src {
            DbConnection::MySql(pool) => pool,
            _ => unreachable!(),
        };
        let db = mongo_client.database(target_db);
        let mut verified = 0usize;
        let mut mismatches = Vec::new();
        for table in &all_tables {
            let count_sql = format!(
                "SELECT COUNT(*) AS cnt FROM `{}`.`{}`",
                "apps_beitou".replace('`', "``"),
                table.replace('`', "``")
            );
            let count_row = sqlx::raw_sql(&count_sql).fetch_one(src_pool_ref).await.unwrap();
            let src_count: i64 = count_row.get(0);
            let coll = db.collection::<mongodb::bson::Document>(table);
            let doc_count = coll.count_documents(mongodb::bson::doc!{}).await.map(|n| n as i64).unwrap_or(-1);
            verified += 1;
            if src_count != doc_count {
                mismatches.push(format!("{}: source={} mongodb={}", table, src_count, doc_count));
            }
        }
        println!("  Verified collections: {}/{}", verified, all_tables.len());
        if mismatches.is_empty() {
            println!("  ✓ All document counts match source row counts");
        } else {
            println!("  ✗ {} count mismatches:", mismatches.len());
            for m in mismatches.iter().take(10) {
                println!("    {}", m);
            }
        }

        mongo.drop_database(target_db).await.unwrap();
        println!("\n=== MongoDB migration test complete ===");
    }

    #[test]
    fn test_create_table_sql_quotes_datetime_defaults() {
        let cols = vec![
            types::ColumnInfo {
                name: "id".into(),
                data_type: "INT".into(),
                key: "PRI".into(),
                default_value: None,
                nullable: false,
                extra: "auto_increment".into(),
            },
            types::ColumnInfo {
                name: "gmt_create".into(),
                data_type: "datetime".into(),
                key: "".into(),
                default_value: Some("2010-05-05 00:00:00".into()),
                nullable: false,
                extra: "".into(),
            },
            types::ColumnInfo {
                name: "name".into(),
                data_type: "varchar(100)".into(),
                key: "".into(),
                default_value: Some("hello".into()),
                nullable: true,
                extra: "".into(),
            },
            types::ColumnInfo {
                name: "ts".into(),
                data_type: "timestamp".into(),
                key: "".into(),
                default_value: Some("CURRENT_TIMESTAMP".into()),
                nullable: true,
                extra: "".into(),
            },
        ];
        let sql = create_table_sql("test_tbl", &cols, "mysql", "mysql", Some("target_db"));
        assert!(sql.contains("`gmt_create` datetime DEFAULT '2010-05-05 00:00:00'"),
            "datetime default should be quoted. SQL: {}", sql);
        assert!(sql.contains("`name` varchar(100) DEFAULT 'hello'"),
            "varchar default should be quoted. SQL: {}", sql);
        assert!(sql.contains("`ts` timestamp DEFAULT CURRENT_TIMESTAMP"),
            "CURRENT_TIMESTAMP should not be quoted. SQL: {}", sql);
    }

    #[ignore]
    #[tokio::test]
    async fn test_duplicate_database_mysql() {
        let cfg = mysql_cfg();
        let pool = sqlx::MySqlPool::connect(&cfg.url).await.unwrap();
        let conn = DbConnection::MySql(pool.clone());

        let src_db = format!("dup_src_{}", std::process::id());
        let tgt_db = format!("dup_tgt_{}", std::process::id());

        conn.create_database(&src_db).await.unwrap();
        conn.create_database(&tgt_db).await.unwrap();

        let table = format!("dup_test_{}", std::process::id());
        let create_sql = format!(
            "CREATE TABLE `{}`.`{}` (\
             id INT PRIMARY KEY AUTO_INCREMENT, \
             gmt_create DATETIME DEFAULT '2010-05-05 00:00:00', \
             gmt_modified DATETIME DEFAULT '2010-05-05 00:00:00', \
             name VARCHAR(100) DEFAULT 'hello', \
             ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP, \
             data TEXT)",
            src_db, table
        );
        conn.execute_query(&create_sql).await.unwrap();
        conn.execute_query(
            &format!("INSERT INTO `{}`.`{}` (name, data) VALUES ('test1', 'data1')", src_db, table)
        ).await.unwrap();
        conn.execute_query(
            &format!("INSERT INTO `{}`.`{}` (name, data) VALUES ('test2', 'data2')", src_db, table)
        ).await.unwrap();

        let tables = conn.get_tables(&src_db).await.unwrap();
        let table_names: Vec<String> = tables.iter().filter(|t| {
            matches!(t.object_type.as_str(), "TABLE" | "BASE TABLE")
        }).map(|t| t.name.clone()).collect();
        assert!(table_names.contains(&table), "Test table not found");

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: src_db.clone(),
            target_id: "tgt".into(),
            target_database: tgt_db.clone(),
            tables: vec![table.clone()],
            mode: types::TransferMode::StructureAndData,
            transfer_indexes: true,
            transfer_foreign_keys: true,
            transfer_views: true,
            transfer_routines: true,
            transfer_triggers: true,
            conflict_strategy: types::ConflictStrategy::Error,
            ..Default::default()
        };

        let target_conn = DbConnection::MySql(pool.clone());
        let result = transfer_data(&conn, &target_conn, &opts, None).await.unwrap();
        assert!(result.errors.is_empty(), "Transfer had errors: {:?}", result.errors);

        let tgt_data = target_conn.get_table_data(&tgt_db, &table, 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 2, "Target should have 2 rows");

        conn.execute_query(&format!("DROP TABLE `{}`.`{}`", src_db, table)).await.unwrap();
        conn.execute_query(&format!("DROP DATABASE `{}`", src_db)).await.unwrap();
        conn.execute_query(&format!("DROP DATABASE `{}`", tgt_db)).await.unwrap();
    }

    // ── DDL SQL generation tests (pure functions, no DB required) ──

    #[test]
    fn test_ddl_create_table_sql_variants() {
        for (kind, name) in [
            (ddl::DbKind::MySql, "mysql"),
            (ddl::DbKind::Postgres, "postgres"),
            (ddl::DbKind::Sqlite, "sqlite"),
            (ddl::DbKind::Oracle, "oracle"),
        ] {
            let cols = vec![
                types::ColumnDef { name: "id".into(), data_type: "INT".into(), nullable: false, default_value: None, primary_key: true },
                types::ColumnDef { name: "Name".into(), data_type: "VARCHAR(100)".into(), nullable: true, default_value: Some("'hello'".into()), primary_key: false },
                types::ColumnDef { name: "ts".into(), data_type: "TIMESTAMP".into(), nullable: true, default_value: Some("CURRENT_TIMESTAMP".into()), primary_key: false },
            ];
            let sql = ddl::create_table_sql(&kind, None, "t1", &cols);
            assert!(sql.contains("CREATE TABLE"), "{}: missing CREATE TABLE", name);
            assert!(sql.contains("PRIMARY KEY"), "{}: missing PRIMARY KEY", name);
            if matches!(kind, ddl::DbKind::MySql | ddl::DbKind::Sqlite) {
                assert!(sql.contains("`Name`"), "{}: expected backtick quotes", name);
            } else if matches!(kind, ddl::DbKind::Oracle) {
                assert!(sql.contains("\"Name\""), "{}: Oracle with uppercase chars should get double-quotes", name);
            } else {
                assert!(sql.contains("\"Name\""), "{}: expected double-quote quotes", name);
            }
        }
    }

    #[test]
    fn test_ddl_drop_table_sql() {
        let mysql = ddl::drop_table_sql(&ddl::DbKind::MySql, None, "t1");
        assert_eq!(mysql, "DROP TABLE IF EXISTS `t1`");
        let pg = ddl::drop_table_sql(&ddl::DbKind::Postgres, None, "t1");
        assert_eq!(pg, "DROP TABLE \"t1\"");
    }

    #[test]
    fn test_ddl_truncate_table_sql() {
        let m = ddl::truncate_table_sql(&ddl::DbKind::MySql, None, "t1");
        assert_eq!(m, "TRUNCATE TABLE `t1`");
        let s = ddl::truncate_table_sql(&ddl::DbKind::Sqlite, None, "t1");
        assert_eq!(s, "DELETE FROM `t1`");
        let o = ddl::truncate_table_sql(&ddl::DbKind::Oracle, None, "t1");
        assert_eq!(o, "TRUNCATE TABLE T1"); // Oracle uppercases
    }

    #[test]
    fn test_ddl_rename_table_sql() {
        let m = ddl::rename_table_sql(&ddl::DbKind::MySql, Some("mydb"), "old", "new");
        assert!(m.contains("RENAME TABLE"));
        assert!(m.contains("`mydb`.`old`"));
        assert!(m.contains("`new`"));
        let p = ddl::rename_table_sql(&ddl::DbKind::Postgres, None, "old", "new");
        assert!(p.contains("RENAME TO \"new\""));
    }

    #[test]
    fn test_ddl_add_column_sql() {
        let col = types::ColumnDef { name: "age".into(), data_type: "INT".into(), nullable: true, default_value: Some("0".into()), primary_key: false };
        let m = ddl::add_column_sql(&ddl::DbKind::MySql, None, "t1", &col);
        assert!(m.contains("ALTER TABLE `t1` ADD COLUMN `age` INT DEFAULT 0"));
        let p = ddl::add_column_sql(&ddl::DbKind::Postgres, None, "t1", &col);
        assert!(p.contains("ALTER TABLE \"t1\" ADD COLUMN \"age\" INT DEFAULT 0"));
    }

    #[test]
    fn test_ddl_drop_column_sql() {
        let m = ddl::drop_column_sql(&ddl::DbKind::MySql, None, "t1", "bad_col");
        assert_eq!(m, "ALTER TABLE `t1` DROP COLUMN `bad_col`");
    }

    #[test]
    fn test_ddl_modify_column_sql() {
        let col = types::ColumnDef { name: "name".into(), data_type: "TEXT".into(), nullable: true, default_value: None, primary_key: false };
        let m = ddl::modify_column_sql(&ddl::DbKind::MySql, None, "t1", &col);
        assert!(m.contains("MODIFY COLUMN"));
        let p = ddl::modify_column_sql(&ddl::DbKind::Postgres, None, "t1", &col);
        assert!(p.contains("ALTER COLUMN"));
    }

    #[test]
    fn test_ddl_rename_column_sql() {
        let m = ddl::rename_column_sql(&ddl::DbKind::MySql, None, "t1", "old", "new");
        assert!(m.contains("RENAME COLUMN `old` TO `new`"));
        let p = ddl::rename_column_sql(&ddl::DbKind::Postgres, None, "t1", "old", "new");
        assert!(p.contains("RENAME COLUMN \"old\" TO \"new\""));
    }

    #[test]
    fn test_ddl_drop_view_routine_trigger_sql() {
        let v = ddl::drop_view_sql(&ddl::DbKind::MySql, None, "myview");
        assert_eq!(v, "DROP VIEW IF EXISTS `myview`");
        let r = ddl::drop_routine_sql(&ddl::DbKind::MySql, None, "myproc", "PROCEDURE");
        assert_eq!(r, "DROP PROCEDURE IF EXISTS `myproc`");
        let t = ddl::drop_trigger_sql(&ddl::DbKind::MySql, None, "mytrig");
        assert_eq!(t, "DROP TRIGGER IF EXISTS `mytrig`");
        // PG without IF EXISTS
        let v2 = ddl::drop_view_sql(&ddl::DbKind::Postgres, None, "mv");
        assert_eq!(v2, "DROP VIEW \"mv\"");
    }

    #[test]
    fn test_ddl_default_literals() {
        let cols = vec![
            types::ColumnDef { name: "a".into(), data_type: "INT".into(), nullable: true, default_value: Some("NULL".into()), primary_key: false },
            types::ColumnDef { name: "b".into(), data_type: "INT".into(), nullable: true, default_value: Some("42".into()), primary_key: false },
            types::ColumnDef { name: "c".into(), data_type: "VARCHAR(10)".into(), nullable: true, default_value: Some("'direct'".into()), primary_key: false },
        ];
        let sql = ddl::create_table_sql(&ddl::DbKind::MySql, None, "lit", &cols);
        assert!(sql.contains("DEFAULT NULL"), "NULL literal: {}", sql);
        assert!(sql.contains("DEFAULT 42"), "numeric: {}", sql);
        assert!(sql.contains("DEFAULT 'direct'"), "quoted: {}", sql);
    }

    // ── SQLite operation tests (in-memory, no Docker) ──

    #[tokio::test]
    async fn test_sqlite_get_tables() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE t1 (id INT)").execute(&pool).await.unwrap();
        sqlx::query("CREATE TABLE t2 (val TEXT)").execute(&pool).await.unwrap();
        let conn = DbConnection::Sqlite(pool);
        let tables = conn.get_tables("main").await.unwrap();
        let names: Vec<&str> = tables.iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"t1"));
        assert!(names.contains(&"t2"));
    }

    #[tokio::test]
    async fn test_sqlite_get_table_ddl() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE ddl_t (id INTEGER PRIMARY KEY, name TEXT NOT NULL, flag INT DEFAULT 0)")
            .execute(&pool).await.unwrap();
        let conn = DbConnection::Sqlite(pool);
        let ddl = conn.get_table_ddl("main", "ddl_t").await.unwrap();
        assert!(ddl.to_lowercase().contains("create table"), "DDL missing CREATE TABLE: {}", ddl);
    }

    #[tokio::test]
    async fn test_sqlite_get_schema_cache() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE sc_t (id INT, val TEXT)").execute(&pool).await.unwrap();
        let conn = DbConnection::Sqlite(pool);
        let cache = conn.get_schema_cache("main").await.unwrap();
        assert!(!cache.tables.is_empty(), "should find tables");
        let t = cache.tables.iter().find(|t| t.table == "sc_t").unwrap();
        assert!(!t.columns.is_empty(), "should find columns");
    }

    #[tokio::test]
    async fn test_sqlite_create_database_returns_error() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let conn = DbConnection::Sqlite(pool);
        let result = conn.create_database("new_db").await;
        assert!(result.is_err(), "SQLite should not support CREATE DATABASE");
    }

    #[tokio::test]
    async fn test_sqlite_drop_database_returns_error() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let conn = DbConnection::Sqlite(pool);
        let result = conn.drop_database("some_db").await;
        assert!(result.is_err(), "SQLite should not support DROP DATABASE");
    }

    // ── compare_schemas test (SQLite vs SQLite) ──

    #[tokio::test]
    async fn test_compare_schemas_sqlite() {
        let src_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let tgt_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query("CREATE TABLE t1 (id INT PRIMARY KEY, name TEXT, flag INT)")
            .execute(&src_pool).await.unwrap();
        sqlx::query("CREATE TABLE t2 (val TEXT)").execute(&src_pool).await.unwrap();

        // Target has t1 with different column type, missing t2, extra t3
        sqlx::query("CREATE TABLE t1 (id BIGINT PRIMARY KEY, name TEXT, flag INT, extra INT)")
            .execute(&tgt_pool).await.unwrap();
        sqlx::query("CREATE TABLE t3 (x INT)").execute(&tgt_pool).await.unwrap();

        let src = DbConnection::Sqlite(src_pool);
        let tgt = DbConnection::Sqlite(tgt_pool);

        let result = compare_schemas(&src, &tgt, "main", "main").await.unwrap();
        assert!(!result.tables.is_empty(), "should have diffs");
        // t1 type mismatch on id column
        let t1 = result.tables.iter().find(|t| t.table == "t1").unwrap();
        assert_eq!(t1.status, "differs");
        let id_col = t1.columns.iter().find(|c| c.name == "id").unwrap();
        assert_eq!(id_col.status, "type_mismatch");
        // t2 only in source
        assert!(result.extra_in_source.contains(&"t2".to_string()));
        // t3 only in target
        assert!(result.extra_in_target.contains(&"t3".to_string()));
    }

    // ── backup / restore test (SQLite in-memory) ──

    #[tokio::test]
    async fn test_backup_restore_sqlite() {
        let src_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let tgt_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query("CREATE TABLE bk_t (id INT, val TEXT)")
            .execute(&src_pool).await.unwrap();
        sqlx::query("INSERT INTO bk_t VALUES (1, 'one'), (2, 'two'), (3, 'three')")
            .execute(&src_pool).await.unwrap();

        let src = DbConnection::Sqlite(src_pool);
        let tgt = DbConnection::Sqlite(tgt_pool);

        let tmp = std::env::temp_dir().join(format!("backup_test_{}.sql", std::process::id()));
        let path = tmp.to_str().unwrap();

        let (count, _) = backup_database(&src, "main", &["bk_t".into()], path, None).await.unwrap();
        assert_eq!(count, 1, "should backup 1 table");

        let (stmt_count, errors) = restore_database(&tgt, "main", path, None).await.unwrap();
        assert!(errors.is_empty(), "restore errors: {:?}", errors);
        assert!(stmt_count > 0, "should execute statements");

        let data = tgt.get_table_data("main", "bk_t", 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(data.rows.len(), 3, "restored data should have 3 rows");
        assert_eq!(data.rows[0].get("id").and_then(|v| v.as_i64()), Some(1));

        let _ = std::fs::remove_file(path);
    }

    // ── Scheduler pure logic tests ──

    #[test]
    fn test_scheduler_compute_next_run_valid() {
        let mut task = scheduler::ScheduledTask {
            id: "t1".into(),
            name: "Daily backup".into(),
            cron_expr: "0 0 * * * *".into(),
            enabled: true,
            config: scheduler::TaskConfig::Backup {
                source_id: "s1".into(),
                database: "mydb".into(),
                tables: vec!["t1".into()],
                output_path: "/tmp/bk.sql".into(),
            },
            created_at: "2024-01-01T00:00:00Z".into(),
            last_run: None,
            next_run: None,
            last_result: None,
        };
        task.compute_next_run();
        assert!(task.next_run.is_some(), "valid cron should produce next_run");
    }

    #[test]
    fn test_scheduler_compute_next_run_invalid() {
        let mut task = scheduler::ScheduledTask {
            id: "t2".into(),
            name: "Bad cron".into(),
            cron_expr: "not-a-cron".into(),
            enabled: true,
            config: scheduler::TaskConfig::Backup {
                source_id: "s1".into(),
                database: "mydb".into(),
                tables: vec!["t1".into()],
                output_path: "/tmp/bk.sql".into(),
            },
            created_at: "2024-01-01T00:00:00Z".into(),
            last_run: None,
            next_run: None,
            last_result: None,
        };
        task.compute_next_run();
        assert!(task.next_run.is_none(), "invalid cron should give None");
    }

    #[test]
    fn test_scheduler_task_serialization() {
        let task = scheduler::ScheduledTask {
            id: "t1".into(),
            name: "Test".into(),
            cron_expr: "0 * * * * *".into(),
            enabled: true,
            config: scheduler::TaskConfig::Transfer {
                source_id: "src".into(),
                source_database: "db1".into(),
                target_id: "tgt".into(),
                target_database: "db2".into(),
                tables: vec!["orders".into()],
                mode: types::TransferMode::StructureAndData,
                conflict_strategy: types::ConflictStrategy::Replace,
                drop_target: false,
                truncate_target: false,
                where_clause: None,
                row_limit: None,
                page_size: 1000,
                parallelism: 2,
                transfer_indexes: true,
                transfer_foreign_keys: true,
                transfer_views: false,
                transfer_routines: false,
                transfer_triggers: false,
                foreign_key_action: types::ForeignKeyAction::Skip,
                column_mappings: vec![],
                error_mode: types::ErrorMode::Skip,
            },
            created_at: "2024-06-01T00:00:00Z".into(),
            last_run: None,
            next_run: None,
            last_result: None,
        };

        let json = serde_json::to_string(&task).unwrap();
        let deserialized: scheduler::ScheduledTask = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.id, "t1");
        assert_eq!(deserialized.name, "Test");
        match deserialized.config {
            scheduler::TaskConfig::Transfer { ref source_id, .. } => {
                assert_eq!(source_id, "src");
            }
            _ => panic!("expected Transfer config"),
        }
    }

    // ── Transfer with where clause test (SQLite in-memory) ──

    #[tokio::test]
    async fn test_transfer_with_where_clause() {
        let src_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let tgt_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query("CREATE TABLE t (id INT, val TEXT)")
            .execute(&src_pool).await.unwrap();
        sqlx::query("INSERT INTO t VALUES (1, 'a'), (2, 'b'), (3, 'c'), (4, 'd')")
            .execute(&src_pool).await.unwrap();

        let src = DbConnection::Sqlite(src_pool);
        let tgt = DbConnection::Sqlite(tgt_pool);

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: "main".into(),
            target_id: "tgt".into(),
            target_database: "main".into(),
            tables: vec!["t".into()],
            where_clause: Some("id > 2".into()),
            conflict_strategy: types::ConflictStrategy::Error,
            ..Default::default()
        };

        let result = transfer_data(&src, &tgt, &opts, None).await.unwrap();
        assert_eq!(result.rows_transferred, 2, "should filter by where clause");
        assert!(result.errors.is_empty(), "Errors: {:?}", result.errors);

        let tgt_data = tgt.get_table_data("main", "t", 1, 100, None, None, None, None).await.unwrap();
        assert_eq!(tgt_data.rows.len(), 2);
        assert_eq!(tgt_data.rows[0].get("id").and_then(|v| v.as_i64()), Some(3));
    }

    // ── Transfer with row limit test (SQLite in-memory) ──

    #[tokio::test]
    async fn test_transfer_with_row_limit() {
        let src_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let tgt_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

        sqlx::query("CREATE TABLE t (id INT, val TEXT)")
            .execute(&src_pool).await.unwrap();
        sqlx::query("INSERT INTO t VALUES (1, 'a'), (2, 'b'), (3, 'c')")
            .execute(&src_pool).await.unwrap();

        let src = DbConnection::Sqlite(src_pool);
        let tgt = DbConnection::Sqlite(tgt_pool);

        let opts = types::TransferOptions {
            source_id: "src".into(),
            source_database: "main".into(),
            target_id: "tgt".into(),
            target_database: "main".into(),
            tables: vec!["t".into()],
            row_limit: Some(2),
            conflict_strategy: types::ConflictStrategy::Error,
            ..Default::default()
        };

        let result = transfer_data(&src, &tgt, &opts, None).await.unwrap();
        assert_eq!(result.rows_transferred, 2, "should limit rows");
        assert!(result.errors.is_empty(), "Errors: {:?}", result.errors);
    }

    // ── execute_batch transaction tests (SQLite in-memory) ──

    #[tokio::test]
    async fn test_execute_batch_commits_all() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO t VALUES (1, 'a'), (2, 'b')")
            .execute(&pool).await.unwrap();

        let conn = DbConnection::Sqlite(pool.clone());
        let queries = vec![
            "UPDATE t SET v = 'a2' WHERE id = 1".to_string(),
            "DELETE FROM t WHERE id = 2".to_string(),
            "INSERT INTO t (v) VALUES ('c')".to_string(),
        ];
        let affected = conn.execute_batch(&queries).await.unwrap();
        assert_eq!(affected, 3);

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM t")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(count, 2);
        let v: String = sqlx::query_scalar("SELECT v FROM t WHERE id = 1")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(v, "a2");
    }

    #[tokio::test]
    async fn test_execute_batch_rolls_back_on_error() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO t VALUES (1, 'a')")
            .execute(&pool).await.unwrap();

        let conn = DbConnection::Sqlite(pool.clone());
        let queries = vec![
            "UPDATE t SET v = 'changed' WHERE id = 1".to_string(),
            "INSERT INTO missing VALUES (1)".to_string(),
        ];
        let err = conn.execute_batch(&queries).await.unwrap_err();
        assert!(err.contains("missing"), "unexpected error: {}", err);

        let v: String = sqlx::query_scalar("SELECT v FROM t WHERE id = 1")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(v, "a", "failed batch must not partially apply");
    }

    // ── begin/commit/rollback transaction tests (SQLite in-memory) ──

    #[tokio::test]
    async fn test_transaction_rollback_discards_changes() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO t VALUES (1, 'a')")
            .execute(&pool).await.unwrap();

        let mut tx = DbTransaction::Sqlite(pool.begin().await.unwrap());
        tx.execute_query("UPDATE t SET v = 'changed' WHERE id = 1").await.unwrap();
        tx.rollback().await.unwrap();

        let v: String = sqlx::query_scalar("SELECT v FROM t WHERE id = 1")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(v, "a", "rollback must discard uncommitted changes");
    }

    #[tokio::test]
    async fn test_transaction_commit_persists_changes() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO t VALUES (1, 'a')")
            .execute(&pool).await.unwrap();

        let mut tx = DbTransaction::Sqlite(pool.begin().await.unwrap());
        tx.execute_query("UPDATE t SET v = 'changed' WHERE id = 1").await.unwrap();
        tx.commit().await.unwrap();

        let v: String = sqlx::query_scalar("SELECT v FROM t WHERE id = 1")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(v, "changed", "commit must persist changes");
    }

    #[tokio::test]
    async fn test_transaction_select_returns_rows() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO t VALUES (1, 'a'), (2, 'b')")
            .execute(&pool).await.unwrap();

        let mut tx = DbTransaction::Sqlite(pool.begin().await.unwrap());
        let result = tx.execute_query("SELECT id, v FROM t ORDER BY id").await.unwrap();
        assert_eq!(result.columns, vec!["id", "v"]);
        assert_eq!(result.rows.len(), 2);
        assert_eq!(result.row_count, 2);
        tx.commit().await.unwrap();
    }

    #[tokio::test]
    async fn test_transaction_execute_update_and_batch_route_to_tx() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO t VALUES (1, 'a'), (2, 'b')")
            .execute(&pool).await.unwrap();

        let mut tx = DbTransaction::Sqlite(pool.begin().await.unwrap());
        tx.execute_update("UPDATE t SET v = 'u' WHERE id = 1").await.unwrap();
        let affected = tx.execute_batch(&[
            "UPDATE t SET v = 'x' WHERE id = 2".to_string(),
            "INSERT INTO t (v) VALUES ('c')".to_string(),
        ]).await.unwrap();
        assert_eq!(affected, 2);

        tx.rollback().await.unwrap();

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM t")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(count, 2, "uncommitted changes must be discarded");
        let v: String = sqlx::query_scalar("SELECT v FROM t WHERE id = 1")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(v, "a");
    }
}
