//! Dameng (达梦) database support via ODBC.
//!
//! Dameng exposes an Oracle-style wire protocol and ships an ODBC driver
//! (`DM8 ODBC DRIVER` / `libdodbc.so`). We talk to it through the low-level
//! `odbc::ffi` interface so the connection handle can be stored as a plain
//! `'static` raw pointer (wrapped in `Arc<Mutex<...>>`) and driven from a
//! blocking thread, mirroring the existing Oracle integration.
//!
//! NOTE: This module is only compiled when the `dameng` cargo feature is
//! enabled, because it links against the system ODBC driver manager.

use std::sync::{Arc, Mutex};

use odbc::ffi::*;

use crate::db::types::*;

pub struct DamengConn {
    pub env: SQLHENV,
    pub dbc: SQLHDBC,
}

// The connection is only ever accessed behind a `Mutex`, so handing the raw
// handles to different threads (via the `Arc`) is safe: only one thread
// touches them at a time.
unsafe impl Send for DamengConn {}
unsafe impl Sync for DamengConn {}

impl Drop for DamengConn {
    fn drop(&mut self) {
        unsafe {
            let _ = SQLDisconnect(self.dbc);
            let _ = SQLFreeHandle(HandleType::SQL_HANDLE_DBC, self.dbc as SQLHANDLE);
            let _ = SQLFreeHandle(HandleType::SQL_HANDLE_ENV, self.env as SQLHANDLE);
        }
    }
}

type Conn = Arc<Mutex<DamengConn>>;

fn to_wide(s: &str) -> Vec<u16> {
    let mut v: Vec<u16> = s.encode_utf16().collect();
    v.push(0);
    v
}

fn from_wide_ptr(ptr: *const u16, len_chars: SQLSMALLINT) -> String {
    if ptr.is_null() || len_chars <= 0 {
        return String::new();
    }
    let len = len_chars as usize;
    unsafe { String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len)) }
}

/// Reads the diagnostic message for the given handle.
unsafe fn diag(handle_type: HandleType, handle: SQLHANDLE) -> String {
    let mut state = [0u16; SQL_SQLSTATE_SIZEW + 1];
    let mut native: SQLINTEGER = 0;
    let mut msg = vec![0u16; (SQL_MAX_MESSAGE_LENGTH + 1) as usize];
    let mut msg_len: SQLSMALLINT = 0;
    let ret = SQLGetDiagRecW(
        handle_type,
        handle,
        1,
        state.as_mut_ptr(),
        &mut native,
        msg.as_mut_ptr(),
        SQL_MAX_MESSAGE_LENGTH,
        &mut msg_len,
    );
    if ret == SQLRETURN::SQL_SUCCESS || ret == SQLRETURN::SQL_SUCCESS_WITH_INFO {
        let state_str = from_wide_ptr(state.as_ptr(), SQL_SQLSTATE_SIZEW as SQLSMALLINT);
        let msg_str = from_wide_ptr(msg.as_ptr(), msg_len);
        format!("[{}] {}", state_str, msg_str.trim())
    } else {
        "Unknown ODBC error".to_string()
    }
}

fn check(ret: SQLRETURN, handle_type: HandleType, handle: SQLHANDLE) -> Result<(), String> {
    if ret == SQLRETURN::SQL_SUCCESS || ret == SQLRETURN::SQL_SUCCESS_WITH_INFO {
        Ok(())
    } else {
        Err(unsafe { diag(handle_type, handle) })
    }
}

/// Builds a DM ODBC connection string.
fn connection_string(host: &str, port: u16, user: &str, password: &str, database: &str) -> String {
    if database.starts_with("DRIVER=") {
        return database.to_string();
    }
    format!(
        "DRIVER={{DM8 ODBC DRIVER}};SERVER={}:{};UID={};PWD={};DATABASE={}",
        host, port, user, password, database
    )
}

pub fn connect(
    host: &str,
    port: u16,
    user: &str,
    password: &str,
    database: &str,
) -> Result<Conn, String> {
    unsafe {
        let mut env: SQLHANDLE = std::ptr::null_mut();
        check(
            SQLAllocHandle(HandleType::SQL_HANDLE_ENV, std::ptr::null_mut(), &mut env),
            HandleType::SQL_HANDLE_ENV,
            env,
        )?;
        let _ = SQLSetEnvAttr(
            env as SQLHENV,
            EnvironmentAttribute::SQL_ATTR_ODBC_VERSION,
            3 as SQLPOINTER,
            0,
        );
        let mut dbc: SQLHANDLE = std::ptr::null_mut();
        check(
            SQLAllocHandle(HandleType::SQL_HANDLE_DBC, env, &mut dbc),
            HandleType::SQL_HANDLE_ENV,
            env,
        )?;

        let conn_str = to_wide(&connection_string(host, port, user, password, database));
        let mut out = vec![0u16; 1024];
        let mut out_len: SQLSMALLINT = 0;
        let ret = SQLDriverConnectW(
            dbc as SQLHDBC,
            std::ptr::null_mut(),
            conn_str.as_ptr(),
            SQL_NTS,
            out.as_mut_ptr(),
            out.len() as SQLSMALLINT,
            &mut out_len,
            SqlDriverConnectOption::SQL_DRIVER_NOPROMPT,
        );
        check(ret, HandleType::SQL_HANDLE_DBC, dbc)?;

        Ok(Arc::new(Mutex::new(DamengConn {
            env: env as SQLHENV,
            dbc: dbc as SQLHDBC,
        })))
    }
}

/// Allocates a statement handle on the given connection.
unsafe fn alloc_stmt(dbc: SQLHDBC) -> Result<SQLHSTMT, String> {
    let mut stmt: SQLHANDLE = std::ptr::null_mut();
    check(
        SQLAllocHandle(HandleType::SQL_HANDLE_STMT, dbc as SQLHANDLE, &mut stmt),
        HandleType::SQL_HANDLE_DBC,
        dbc as SQLHANDLE,
    )?;
    Ok(stmt as SQLHSTMT)
}

/// Converts a textual column value into a sensible JSON value.
fn json_value(s: &str) -> serde_json::Value {
    let t = s.trim();
    if t.eq_ignore_ascii_case("NULL") {
        return serde_json::Value::Null;
    }
    if t.eq_ignore_ascii_case("TRUE") {
        return serde_json::Value::Bool(true);
    }
    if t.eq_ignore_ascii_case("FALSE") {
        return serde_json::Value::Bool(false);
    }
    if let Ok(i) = t.parse::<i64>() {
        return serde_json::Value::from(i);
    }
    if let Ok(f) = t.parse::<f64>() {
        return serde_json::Value::from(f);
    }
    serde_json::Value::String(s.to_string())
}

/// Retrieves a single column value as a wide string (handles truncation).
unsafe fn fetch_col_wstr(stmt: SQLHSTMT, col: SQLUSMALLINT) -> Result<serde_json::Value, String> {
    let mut buf: Vec<u16> = vec![0u16; 1024];
    let mut indicator: SQLLEN = 0;
    let ret = SQLGetData(
        stmt,
        col,
        SqlCDataType::SQL_C_WCHAR,
        buf.as_mut_ptr() as SQLPOINTER,
        (buf.len() * 2) as SQLLEN,
        &mut indicator,
    );
    if ret == SQLRETURN::SQL_SUCCESS || ret == SQLRETURN::SQL_SUCCESS_WITH_INFO {
        if indicator == SQL_NULL_DATA {
            return Ok(serde_json::Value::Null);
        }
        let mut s = from_wide_ptr(buf.as_ptr(), (indicator as usize / 2) as SQLSMALLINT);
        if ret == SQLRETURN::SQL_SUCCESS_WITH_INFO && (indicator as usize) >= buf.len() * 2 {
            let new_len = (indicator as usize / 2 + 1).max(buf.len() * 2);
            let mut big = vec![0u16; new_len];
            let r2 = SQLGetData(
                stmt,
                col,
                SqlCDataType::SQL_C_WCHAR,
                big.as_mut_ptr() as SQLPOINTER,
                (big.len() * 2) as SQLLEN,
                &mut indicator,
            );
            if r2 == SQLRETURN::SQL_SUCCESS || r2 == SQLRETURN::SQL_SUCCESS_WITH_INFO {
                s = from_wide_ptr(big.as_ptr(), (indicator as usize / 2) as SQLSMALLINT);
            }
        }
        Ok(json_value(&s))
    } else if ret == SQLRETURN::SQL_NO_DATA {
        Ok(serde_json::Value::Null)
    } else {
        Err(diag(HandleType::SQL_HANDLE_STMT, stmt as SQLHANDLE))
    }
}

/// Synchronous execution core. Performs no nested blocking, so it is safe to
/// invoke from within a `tokio::task::spawn_blocking` (e.g. from the transaction
/// helpers in `mod.rs`).
pub fn execute_sync(conn: &Conn, query: &str) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();
    let conn = conn.clone();
    let query = query.to_string();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    let dbc = guard.dbc;
    unsafe {
        let stmt = alloc_stmt(dbc)?;
        let wide = to_wide(&query);
        let ret = SQLExecDirectW(stmt, wide.as_ptr(), SQL_NTS as SQLINTEGER);
        if ret != SQLRETURN::SQL_SUCCESS && ret != SQLRETURN::SQL_SUCCESS_WITH_INFO {
            let e = diag(HandleType::SQL_HANDLE_STMT, stmt as SQLHANDLE);
            let _ = SQLFreeHandle(HandleType::SQL_HANDLE_STMT, stmt as SQLHANDLE);
            return Err(e);
        }

        let mut ncols: SQLSMALLINT = 0;
        let _ = SQLNumResultCols(stmt, &mut ncols);

        let mut columns: Vec<String> = Vec::new();
        for c in 1..=ncols as SQLUSMALLINT {
            let mut name_buf = vec![0u16; 256];
            let mut name_len: SQLSMALLINT = 0;
            let mut _dt: SqlDataType = std::mem::zeroed();
            let mut _size: SQLULEN = 0;
            let mut _dec: SQLSMALLINT = 0;
            let mut _null: Nullable = Nullable::SQL_NO_NULLS;
            let _ = SQLDescribeColW(
                stmt,
                c,
                name_buf.as_mut_ptr(),
                name_buf.len() as SQLSMALLINT,
                &mut name_len,
                &mut _dt,
                &mut _size,
                &mut _dec,
                &mut _null,
            );
            columns.push(from_wide_ptr(name_buf.as_ptr(), name_len));
        }

        let mut rows: Vec<serde_json::Value> = Vec::new();
        let has_result_set = ncols > 0;
        if has_result_set {
            loop {
                let fetch = SQLFetch(stmt);
                if fetch == SQLRETURN::SQL_NO_DATA {
                    break;
                }
                if fetch != SQLRETURN::SQL_SUCCESS && fetch != SQLRETURN::SQL_SUCCESS_WITH_INFO {
                    let e = diag(HandleType::SQL_HANDLE_STMT, stmt as SQLHANDLE);
                    let _ = SQLFreeHandle(HandleType::SQL_HANDLE_STMT, stmt as SQLHANDLE);
                    return Err(e);
                }
                let mut obj = serde_json::Map::new();
                for c in 1..=ncols as SQLUSMALLINT {
                    let v = fetch_col_wstr(stmt, c)?;
                    let col_name = columns
                        .get((c - 1) as usize)
                        .cloned()
                        .unwrap_or_else(|| format!("col{}", c));
                    obj.insert(col_name, v);
                }
                rows.push(serde_json::Value::Object(obj));
            }
        }

        let elapsed = format!("{:.2}ms", start.elapsed().as_secs_f64() * 1000.0);
        let row_count = if has_result_set {
            rows.len()
        } else {
            let mut cnt: SQLLEN = 0;
            let _ = SQLRowCount(stmt, &mut cnt);
            cnt as usize
        };
        let _ = SQLFreeHandle(HandleType::SQL_HANDLE_STMT, stmt as SQLHANDLE);
        Ok(QueryResult {
            columns,
            rows,
            row_count,
            duration: elapsed,
            error: None,
        })
    }
}

pub async fn execute(conn: &Conn, query: &str) -> Result<QueryResult, String> {
    let conn = conn.clone();
    let query = query.to_string();
    tokio::task::spawn_blocking(move || execute_sync(&conn, &query))
        .await
        .map_err(|e| e.to_string())?
}

pub async fn execute_query(conn: &Conn, query: &str) -> Result<QueryResult, String> {
    execute(conn, query).await
}

pub async fn execute_update(conn: &Conn, query: &str) -> Result<QueryResult, String> {
    execute(conn, query).await
}

/// Returns the column metadata for a table (re-export of the private helper
/// used by `get_schema_cache`).
pub async fn get_table_columns(conn: &Conn, table: &str) -> Result<Vec<ColumnInfo>, String> {
    get_columns(conn, table).await
}

/// Returns the primary-key column names of a table.
pub async fn get_primary_keys(conn: &Conn, table: &str) -> Result<Vec<String>, String> {
    let sql = format!(
        "SELECT cc.COLUMN_NAME FROM USER_CONSTRAINTS uc \
         JOIN USER_CONS_COLUMNS cc ON uc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME \
         WHERE uc.CONSTRAINT_TYPE='P' AND cc.TABLE_NAME='{tbl}' ORDER BY cc.POSITION",
        tbl = table.replace('\'', "''")
    );
    let res = execute(conn, &sql).await?;
    let mut pk = Vec::new();
    for row in &res.rows {
        let o = row.as_object().unwrap();
        let name = o
            .get("COLUMN_NAME")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if !name.is_empty() {
            pk.push(name);
        }
    }
    Ok(pk)
}

/// Lists user tables and views.
pub async fn get_tables(conn: &Conn) -> Result<Vec<TableInfo>, String> {
    let sql = "SELECT TABLE_NAME, 'TABLE' AS OBJECT_TYPE FROM USER_TABLES \
               UNION ALL \
               SELECT VIEW_NAME, 'VIEW' AS OBJECT_TYPE FROM USER_VIEWS \
               ORDER BY TABLE_NAME";
    let res = execute(conn, sql).await?;
    let mut tables = Vec::new();
    for row in &res.rows {
        let obj = row.as_object().unwrap();
        let name = obj
            .get("TABLE_NAME")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let object_type = obj
            .get("OBJECT_TYPE")
            .and_then(|v| v.as_str())
            .unwrap_or("TABLE")
            .to_string();
        if name.is_empty() {
            continue;
        }
        tables.push(TableInfo {
            name,
            object_type,
            schema: None,
            size_bytes: None,
            row_count: None,
            ttl: None,
        });
    }
    Ok(tables)
}

/// Builds the full schema cache (columns, indexes, foreign keys, views,
/// routines and triggers) for the current user schema.
pub async fn get_schema_cache(conn: &Conn) -> Result<SchemaCache, String> {
    let table_list = execute(
        conn,
        "SELECT TABLE_NAME FROM USER_TABLES ORDER BY TABLE_NAME",
    )
    .await?;
    let mut tables: Vec<TableSchemaInfo> = Vec::new();

    for row in &table_list.rows {
        let name = row
            .as_object()
            .and_then(|o| o.get("TABLE_NAME"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if name.is_empty() {
            continue;
        }
        let columns = get_columns(conn, &name).await?;
        let indexes = get_indexes(conn, &name).await?;
        let foreign_keys = get_foreign_keys(conn, &name).await?;
        tables.push(TableSchemaInfo {
            table: name,
            columns,
            foreign_keys,
            indexes,
            views: vec![],
            routines: vec![],
            triggers: vec![],
        });
    }

    let mut views = Vec::new();
    if let Ok(vres) = execute(
        conn,
        "SELECT VIEW_NAME, TEXT FROM USER_VIEWS ORDER BY VIEW_NAME",
    )
    .await
    {
        for row in &vres.rows {
            let o = row.as_object().unwrap();
            let name = o.get("VIEW_NAME").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let definition = o.get("TEXT").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if !name.is_empty() {
                views.push(ViewInfo { name, definition });
            }
        }
    }

    let mut routines = Vec::new();
    let _ = get_routines(conn, &mut routines).await;
    let mut triggers = Vec::new();
    let _ = get_triggers(conn, &mut triggers).await;

    Ok(SchemaCache {
        tables,
        views,
        routines,
        triggers,
    })
}

async fn get_columns(conn: &Conn, table: &str) -> Result<Vec<ColumnInfo>, String> {
    let sql = format!(
        "SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, DATA_PRECISION, DATA_SCALE, \
                NULLABLE, DATA_DEFAULT, \
                (SELECT COUNT(*) FROM USER_CONSTRAINTS uc, USER_CONS_COLUMNS ucc \
                  WHERE uc.CONSTRAINT_TYPE='P' AND uc.CONSTRAINT_NAME=ucc.CONSTRAINT_NAME \
                  AND ucc.TABLE_NAME='{tbl}' AND ucc.COLUMN_NAME=utc.COLUMN_NAME) AS IS_PK \
         FROM USER_TAB_COLUMNS utc WHERE TABLE_NAME='{tbl}' ORDER BY COLUMN_ID",
        tbl = table.replace('\'', "''")
    );
    let res = execute(conn, &sql).await?;
    let mut cols = Vec::new();
    for row in &res.rows {
        let o = row.as_object().unwrap();
        let name = o.get("COLUMN_NAME").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let data_type = o.get("DATA_TYPE").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let nullable = o
            .get("NULLABLE")
            .and_then(|v| v.as_str())
            .map(|s| s == "Y")
            .unwrap_or(true);
        let default_value = o
            .get("DATA_DEFAULT")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let primary_key = o
            .get("IS_PK")
            .and_then(|v| v.as_str())
            .map(|s| s.parse::<i64>().unwrap_or(0) > 0)
            .unwrap_or(false);
        cols.push(ColumnInfo {
            name,
            data_type,
            nullable,
            key: if primary_key { "PRI".to_string() } else { String::new() },
            default_value,
            extra: String::new(),
        });
    }
    Ok(cols)
}

async fn get_indexes(conn: &Conn, table: &str) -> Result<Vec<IndexInfo>, String> {
    let sql = format!(
        "SELECT i.INDEX_NAME, i.UNIQUENESS, c.COLUMN_NAME \
         FROM USER_INDEXES i, USER_IND_COLUMNS c \
         WHERE i.INDEX_NAME = c.INDEX_NAME AND i.TABLE_NAME='{tbl}' \
         ORDER BY i.INDEX_NAME",
        tbl = table.replace('\'', "''")
    );
    let res = execute(conn, &sql).await?;
    let mut map: std::collections::BTreeMap<String, IndexInfo> = std::collections::BTreeMap::new();
    for row in &res.rows {
        let o = row.as_object().unwrap();
        let name = o.get("INDEX_NAME").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let unique = o
            .get("UNIQUENESS")
            .and_then(|v| v.as_str())
            .map(|s| s == "UNIQUE")
            .unwrap_or(false);
        let column = o.get("COLUMN_NAME").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if name.is_empty() {
            continue;
        }
        let entry = map.entry(name.clone()).or_insert(IndexInfo {
            name,
            columns: Vec::new(),
            unique,
            index_type: "BTREE".to_string(),
        });
        entry.columns.push(column);
    }
    Ok(map.into_values().collect())
}

async fn get_foreign_keys(conn: &Conn, table: &str) -> Result<Vec<ForeignKeyInfo>, String> {
    let sql = format!(
        "SELECT a.CONSTRAINT_NAME, a.COLUMN_NAME, c_pk.TABLE_NAME AS REF_TABLE, b.COLUMN_NAME AS REF_COLUMN \
         FROM USER_CONSTRAINTS a, USER_CONS_COLUMNS b, USER_CONSTRAINTS c_pk, USER_CONS_COLUMNS d \
         WHERE a.CONSTRAINT_TYPE='R' AND a.R_CONSTRAINT_NAME=c_pk.CONSTRAINT_NAME \
           AND a.CONSTRAINT_NAME=b.CONSTRAINT_NAME AND c_pk.CONSTRAINT_NAME=d.CONSTRAINT_NAME \
           AND a.TABLE_NAME='{tbl}' \
         ORDER BY a.CONSTRAINT_NAME",
        tbl = table.replace('\'', "''")
    );
    let res = execute(conn, &sql).await?;
    let mut fks = Vec::new();
    for row in &res.rows {
        let o = row.as_object().unwrap();
        let column_name = o.get("COLUMN_NAME").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let ref_table = o.get("REF_TABLE").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let ref_column = o.get("REF_COLUMN").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let constraint_name = o.get("CONSTRAINT_NAME").and_then(|v| v.as_str()).map(|s| s.to_string());
        fks.push(ForeignKeyInfo {
            column_name,
            ref_table,
            ref_column,
            constraint_name,
        });
    }
    Ok(fks)
}

async fn get_routines(conn: &Conn, out: &mut Vec<RoutineInfo>) -> Result<(), String> {
    let sql = "SELECT OBJECT_NAME AS NAME, OBJECT_TYPE AS ROUTINE_TYPE, '' AS DEFINITION \
               FROM USER_PROCEDURES ORDER BY OBJECT_NAME";
    let res = execute(conn, sql).await?;
    for row in &res.rows {
        let o = row.as_object().unwrap();
        let name = o.get("NAME").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let routine_type = o.get("ROUTINE_TYPE").and_then(|v| v.as_str()).unwrap_or("PROCEDURE").to_string();
        if !name.is_empty() {
            out.push(RoutineInfo {
                name,
                routine_type,
                definition: String::new(),
            });
        }
    }
    Ok(())
}

async fn get_triggers(conn: &Conn, out: &mut Vec<TriggerInfo>) -> Result<(), String> {
    let sql = "SELECT TRIGGER_NAME AS NAME, TABLE_NAME AS TBL, '' AS DEFINITION \
               FROM USER_TRIGGERS ORDER BY TRIGGER_NAME";
    let res = execute(conn, sql).await?;
    for row in &res.rows {
        let o = row.as_object().unwrap();
        let name = o.get("NAME").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let table = o.get("TBL").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if !name.is_empty() {
            out.push(TriggerInfo {
                name,
                table,
                definition: String::new(),
            });
        }
    }
    Ok(())
}

/// Returns the DDL for a table or view.
pub async fn get_table_ddl(conn: &Conn, _database: &str, table: &str) -> Result<String, String> {
    let view_sql = format!(
        "SELECT TEXT FROM USER_VIEWS WHERE VIEW_NAME='{tbl}'",
        tbl = table.replace('\'', "''")
    );
    if let Ok(res) = execute(conn, &view_sql).await {
        if let Some(row) = res.rows.first() {
            let o = row.as_object().unwrap();
            let def = o.get("TEXT").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if !def.is_empty() {
                return Ok(format!("CREATE OR REPLACE VIEW \"{}\" AS\n{}", table, def));
            }
        }
    }

    let cols = get_columns(conn, table).await?;
    let pk_cols: Vec<String> = cols
        .iter()
        .filter(|c| c.key == "PRI")
        .map(|c| c.name.clone())
        .collect();

    let mut lines = Vec::new();
    for c in &cols {
        let mut line = format!("  \"{}\" {}", c.name, c.data_type);
        if !c.nullable {
            line.push_str(" NOT NULL");
        }
        if let Some(d) = &c.default_value {
            line.push_str(&format!(" DEFAULT {}", d));
        }
        lines.push(line);
    }
    if !pk_cols.is_empty() {
        let pk = pk_cols
            .iter()
            .map(|c| format!("\"{}\"", c))
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!("  PRIMARY KEY ({})", pk));
    }
    let indexes = get_indexes(conn, table).await.unwrap_or_default();
    let fks = get_foreign_keys(conn, table).await.unwrap_or_default();
    let mut ddl = format!("CREATE TABLE \"{}\" (\n{}\n);", table, lines.join(",\n"));
    for idx in &indexes {
        let cols = idx.columns.join(", ");
        let uniq = if idx.unique { "UNIQUE " } else { "" };
        ddl.push_str(&format!(
            "\nCREATE {}INDEX \"{}\" ON \"{}\" ({});",
            uniq, idx.name, table, cols
        ));
    }
    for fk in &fks {
        if let Some(cname) = &fk.constraint_name {
            ddl.push_str(&format!(
                "\nALTER TABLE \"{}\" ADD CONSTRAINT \"{}\" FOREIGN KEY (\"{}\") REFERENCES \"{}\" (\"{}\");",
                table, cname, fk.column_name, fk.ref_table, fk.ref_column
            ));
        }
    }
    Ok(ddl)
}

pub async fn create_database(conn: &Conn, db_name: &str) -> Result<(), String> {
    execute(conn, &format!("CREATE DATABASE \"{}\"", db_name)).await?;
    Ok(())
}

pub async fn drop_database(conn: &Conn, db_name: &str) -> Result<(), String> {
    execute(conn, &format!("DROP DATABASE \"{}\"", db_name)).await?;
    Ok(())
}

pub fn db_kind() -> crate::db::ddl::DbKind {
    // Dameng is SQL/Oracle compatible, so we reuse the Oracle DDL builders.
    crate::db::ddl::DbKind::Oracle
}

/// Toggles autocommit for an explicit transaction.
pub fn set_autocommit(conn: &Conn, on: bool) -> Result<(), String> {
    let guard = conn.lock().map_err(|e| e.to_string())?;
    unsafe {
        let value: SQLPOINTER = (if on { 1i64 } else { 0i64 }) as SQLPOINTER;
        check(
            SQLSetConnectAttrW(
                guard.dbc,
                SqlConnectionAttribute::SQL_ATTR_AUTOCOMMIT,
                value,
                0,
            ),
            HandleType::SQL_HANDLE_DBC,
            guard.dbc as SQLHANDLE,
        )
    }
}

pub fn commit(conn: &Conn) -> Result<(), String> {
    let guard = conn.lock().map_err(|e| e.to_string())?;
    unsafe {
        check(
            SQLEndTran(
                HandleType::SQL_HANDLE_DBC,
                guard.dbc as SQLHANDLE,
                SqlCompletionType::SQL_COMMIT,
            ),
            HandleType::SQL_HANDLE_DBC,
            guard.dbc as SQLHANDLE,
        )
    }
}

pub fn rollback(conn: &Conn) -> Result<(), String> {
    let guard = conn.lock().map_err(|e| e.to_string())?;
    unsafe {
        check(
            SQLEndTran(
                HandleType::SQL_HANDLE_DBC,
                guard.dbc as SQLHANDLE,
                SqlCompletionType::SQL_ROLLBACK,
            ),
            HandleType::SQL_HANDLE_DBC,
            guard.dbc as SQLHANDLE,
        )
    }
}
