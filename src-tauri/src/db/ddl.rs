use crate::db::types::ColumnDef;
use crate::db::DbConnection;
use std::fmt::Write;

pub enum DbKind {
    MySql,
    Postgres,
    Sqlite,
    Oracle,
}

pub fn db_kind(conn: &DbConnection) -> Result<DbKind, String> {
    match conn {
        DbConnection::MySql(_) => Ok(DbKind::MySql),
        DbConnection::Pg(_) => Ok(DbKind::Postgres),
        DbConnection::Sqlite(_) => Ok(DbKind::Sqlite),
        DbConnection::Oracle(_) => Ok(DbKind::Oracle),
        _ => Err("DDL operations are not supported for this connection type".to_string()),
    }
}

fn quote_ident(kind: &DbKind, name: &str) -> String {
    match kind {
        DbKind::MySql | DbKind::Sqlite => format!("`{}`", name.replace('`', "``")),
        DbKind::Postgres => format!("\"{}\"", name.replace('"', "\"\"")),
        DbKind::Oracle => {
            if name.chars().any(|c| c.is_uppercase()) || name.chars().any(|c| !c.is_ascii_alphanumeric() && c != '_') {
                format!("\"{}\"", name.replace('"', "\"\""))
            } else {
                name.to_uppercase()
            }
        }
    }
}

fn quote_schema_table(kind: &DbKind, schema: Option<&str>, table: &str) -> String {
    match schema {
        Some(s) if !s.is_empty() => format!("{}.{}", quote_ident(kind, s), quote_ident(kind, table)),
        _ => quote_ident(kind, table),
    }
}

fn col_type_for(kind: &DbKind, col: &ColumnDef) -> String {
    let t = col.data_type.to_uppercase();
    match kind {
        DbKind::Oracle => {
            // map common types to oracle
            if t.contains("INT") {
                "NUMBER(38)".to_string()
            } else if t.contains("VARCHAR") || t.contains("TEXT") || t.contains("CHAR") {
                if t.contains("CHAR") {
                    let len = extract_len(&col.data_type, 1);
                    format!("VARCHAR2({})", len.max(1))
                } else {
                    "CLOB".to_string()
                }
            } else if t.contains("TEXT") {
                "CLOB".to_string()
            } else if t.contains("DECIMAL") || t.contains("NUMERIC") || t.contains("FLOAT") || t.contains("DOUBLE") {
                "NUMBER".to_string()
            } else if t.contains("DATE") {
                "DATE".to_string()
            } else if t.contains("TIMESTAMP") {
                "TIMESTAMP".to_string()
            } else if t.contains("BLOB") || t.contains("BYTE") {
                "BLOB".to_string()
            } else if t.contains("BOOL") {
                "NUMBER(1)".to_string()
            } else {
                "VARCHAR2(255)".to_string()
            }
        }
        _ => col.data_type.clone(),
    }
}

fn extract_len(s: &str, default: usize) -> usize {
    let re = regex_less_len(s);
    re.unwrap_or(default)
}

fn regex_less_len(s: &str) -> Option<usize> {
    let start = s.find('(')?;
    let end = s.find(')')?;
    let num: usize = s[start + 1..end].split(',').next()?.trim().parse().ok()?;
    Some(num)
}

fn build_column(kind: &DbKind, col: &ColumnDef) -> String {
    let mut s = quote_ident(kind, &col.name);
    write!(s, " {}", col_type_for(kind, col)).ok();
    if !col.nullable {
        s.push_str(" NOT NULL");
    } else if matches!(kind, DbKind::Oracle) {
        s.push_str(" NULL");
    }
    if let Some(d) = &col.default_value {
        if !d.is_empty() {
            let dv = if is_literal(kind, d) {
                d.clone()
            } else {
                format!("({})", d)
            };
            write!(s, " DEFAULT {}", dv).ok();
        }
    }
    if col.primary_key && matches!(kind, DbKind::MySql | DbKind::Sqlite) {
        s.push_str(" PRIMARY KEY");
    }
    s
}

fn is_literal(kind: &DbKind, v: &str) -> bool {
    let t = v.trim().to_uppercase();
    if t == "NULL" || t == "CURRENT_TIMESTAMP" || t == "CURRENT_DATE" || t == "NOW()" || t.starts_with("NEXTVAL") {
        return true;
    }
    if matches!(kind, DbKind::Oracle) && (t.starts_with("SYSDATE") || t.starts_with("SYSTIMESTAMP")) {
        return true;
    }
    // numeric
    if v.trim().parse::<f64>().is_ok() {
        return true;
    }
    // quoted string
    if v.trim().starts_with('\'') {
        return true;
    }
    false
}

pub fn create_table_sql(kind: &DbKind, schema: Option<&str>, table: &str, columns: &[ColumnDef]) -> String {
    let mut cols_sql: Vec<String> = columns.iter().map(|c| build_column(kind, c)).collect();
    let pks: Vec<String> = columns.iter().filter(|c| c.primary_key).map(|c| quote_ident(kind, &c.name)).collect();
    if !pks.is_empty() && matches!(kind, DbKind::Postgres | DbKind::Oracle) {
        cols_sql.push(format!("PRIMARY KEY ({})", pks.join(", ")));
    }
    let q = quote_schema_table(kind, schema, table);
    format!("CREATE TABLE {} (\n  {}\n)", q, cols_sql.join(",\n  "))
}

pub fn drop_table_sql(kind: &DbKind, schema: Option<&str>, table: &str) -> String {
    let q = quote_schema_table(kind, schema, table);
    match kind {
        DbKind::MySql => format!("DROP TABLE IF EXISTS {}", q),
        _ => format!("DROP TABLE {}", q),
    }
}

pub fn truncate_table_sql(kind: &DbKind, schema: Option<&str>, table: &str) -> String {
    let q = quote_schema_table(kind, schema, table);
    match kind {
        DbKind::Oracle => format!("TRUNCATE TABLE {}", q),
        DbKind::Sqlite => format!("DELETE FROM {}", q),
        _ => format!("TRUNCATE TABLE {}", q),
    }
}

pub fn rename_table_sql(kind: &DbKind, schema: Option<&str>, table: &str, new_name: &str) -> String {
    let q = quote_schema_table(kind, schema, table);
    let new_q = quote_ident(kind, new_name);
    match kind {
        DbKind::MySql => format!("RENAME TABLE {} TO {}", q, new_q),
        DbKind::Postgres => format!("ALTER TABLE {} RENAME TO {}", q, new_q),
        DbKind::Sqlite => format!("ALTER TABLE {} RENAME TO {}", q, new_q),
        DbKind::Oracle => format!("ALTER TABLE {} RENAME TO {}", q, new_q),
    }
}

pub fn add_column_sql(kind: &DbKind, schema: Option<&str>, table: &str, col: &ColumnDef) -> String {
    let q = quote_schema_table(kind, schema, table);
    format!("ALTER TABLE {} ADD COLUMN {}", q, build_column(kind, col))
}

pub fn drop_column_sql(kind: &DbKind, schema: Option<&str>, table: &str, column: &str) -> String {
    let q = quote_schema_table(kind, schema, table);
    format!("ALTER TABLE {} DROP COLUMN {}", q, quote_ident(kind, column))
}

pub fn modify_column_sql(kind: &DbKind, schema: Option<&str>, table: &str, col: &ColumnDef) -> String {
    let q = quote_schema_table(kind, schema, table);
    match kind {
        DbKind::MySql => format!("ALTER TABLE {} MODIFY COLUMN {}", q, build_column(kind, col)),
        DbKind::Oracle => format!("ALTER TABLE {} MODIFY ({})", q, build_column(kind, col)),
        _ => format!("ALTER TABLE {} ALTER COLUMN {}", q, build_column(kind, col)),
    }
}

pub fn rename_column_sql(kind: &DbKind, schema: Option<&str>, table: &str, column: &str, new_name: &str) -> String {
    let q = quote_schema_table(kind, schema, table);
    let c = quote_ident(kind, column);
    let n = quote_ident(kind, new_name);
    match kind {
        DbKind::MySql => format!("ALTER TABLE {} RENAME COLUMN {} TO {}", q, c, n),
        DbKind::Postgres => format!("ALTER TABLE {} RENAME COLUMN {} TO {}", q, c, n),
        DbKind::Sqlite => format!("ALTER TABLE {} RENAME COLUMN {} TO {}", q, c, n),
        DbKind::Oracle => format!("ALTER TABLE {} RENAME COLUMN {} TO {}", q, c, n),
    }
}

pub fn drop_view_sql(kind: &DbKind, schema: Option<&str>, view: &str) -> String {
    let q = quote_schema_table(kind, schema, view);
    match kind {
        DbKind::MySql => format!("DROP VIEW IF EXISTS {}", q),
        _ => format!("DROP VIEW {}", q),
    }
}

pub fn drop_routine_sql(kind: &DbKind, schema: Option<&str>, routine: &str, routine_type: &str) -> String {
    let q = quote_schema_table(kind, schema, routine);
    match kind {
        DbKind::MySql => format!("DROP {} IF EXISTS {}", routine_type.to_uppercase(), q),
        _ => format!("DROP {} {}", routine_type.to_uppercase(), q),
    }
}

pub fn drop_trigger_sql(kind: &DbKind, schema: Option<&str>, trigger: &str) -> String {
    let q = quote_schema_table(kind, schema, trigger);
    match kind {
        DbKind::MySql => format!("DROP TRIGGER IF EXISTS {}", q),
        DbKind::Postgres => format!("DROP TRIGGER {}", q),
        DbKind::Oracle => format!("DROP TRIGGER {}", q),
        DbKind::Sqlite => format!("DROP TRIGGER {}", q),
    }
}

pub fn create_index_sql(
    kind: &DbKind,
    schema: Option<&str>,
    table: &str,
    name: &str,
    columns: &[String],
    unique: bool,
) -> String {
    let cols = columns.iter().map(|c| quote_ident(kind, c)).collect::<Vec<_>>().join(", ");
    let uniq = if unique { "UNIQUE " } else { "" };
    format!(
        "CREATE {}INDEX {} ON {} ({})",
        uniq,
        quote_ident(kind, name),
        quote_schema_table(kind, schema, table),
        cols
    )
}

pub fn drop_index_sql(kind: &DbKind, schema: Option<&str>, table: &str, name: &str) -> String {
    match kind {
        DbKind::MySql => {
            format!("DROP INDEX {} ON {}", quote_ident(kind, name), quote_schema_table(kind, schema, table))
        }
        _ => format!("DROP INDEX {}", quote_ident(kind, name)),
    }
}

pub fn add_foreign_key_sql(
    kind: &DbKind,
    schema: Option<&str>,
    table: &str,
    name: &str,
    column: &str,
    ref_table: &str,
    ref_column: &str,
) -> Result<String, String> {
    if matches!(kind, DbKind::Sqlite) {
        return Err("Foreign key management is not supported for SQLite".to_string());
    }
    Ok(format!(
        "ALTER TABLE {} ADD CONSTRAINT {} FOREIGN KEY ({}) REFERENCES {} ({})",
        quote_schema_table(kind, schema, table),
        quote_ident(kind, name),
        quote_ident(kind, column),
        quote_ident(kind, ref_table),
        quote_ident(kind, ref_column),
    ))
}

pub fn drop_foreign_key_sql(
    kind: &DbKind,
    schema: Option<&str>,
    table: &str,
    name: &str,
) -> Result<String, String> {
    if matches!(kind, DbKind::Sqlite) {
        return Err("Foreign key management is not supported for SQLite".to_string());
    }
    match kind {
        DbKind::MySql => Ok(format!(
            "ALTER TABLE {} DROP FOREIGN KEY {}",
            quote_schema_table(kind, schema, table),
            quote_ident(kind, name)
        )),
        _ => Ok(format!(
            "ALTER TABLE {} DROP CONSTRAINT {}",
            quote_schema_table(kind, schema, table),
            quote_ident(kind, name)
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cols(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn create_index_sql_mysql() {
        let sql = create_index_sql(&DbKind::MySql, Some("mydb"), "orders", "idx_status", &cols(&["status", "created_at"]), false);
        assert_eq!(sql, "CREATE INDEX `idx_status` ON `mydb`.`orders` (`status`, `created_at`)");
    }

    #[test]
    fn create_index_sql_unique_postgres() {
        let sql = create_index_sql(&DbKind::Postgres, None, "orders", "uq_order_no", &cols(&["order_no"]), true);
        assert_eq!(sql, "CREATE UNIQUE INDEX \"uq_order_no\" ON \"orders\" (\"order_no\")");
    }

    #[test]
    fn drop_index_sql_mysql_uses_on_table() {
        let sql = drop_index_sql(&DbKind::MySql, None, "orders", "idx_status");
        assert_eq!(sql, "DROP INDEX `idx_status` ON `orders`");
    }

    #[test]
    fn drop_index_sql_postgres_no_table() {
        let sql = drop_index_sql(&DbKind::Postgres, None, "orders", "idx_status");
        assert_eq!(sql, "DROP INDEX \"idx_status\"");
    }

    #[test]
    fn test_add_foreign_key_sql() {
        let sql = add_foreign_key_sql(&DbKind::MySql, None, "orders", "fk_customer", "customer_id", "customers", "id").unwrap();
        assert_eq!(
            sql,
            "ALTER TABLE `orders` ADD CONSTRAINT `fk_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`)"
        );
    }

    #[test]
    fn add_foreign_key_sqlite_unsupported() {
        assert!(add_foreign_key_sql(&DbKind::Sqlite, None, "t", "fk", "a", "u", "id").is_err());
    }

    #[test]
    fn drop_foreign_key_sql_mysql() {
        let sql = drop_foreign_key_sql(&DbKind::MySql, None, "orders", "fk_customer").unwrap();
        assert_eq!(sql, "ALTER TABLE `orders` DROP FOREIGN KEY `fk_customer`");
    }

    #[test]
    fn drop_foreign_key_sql_postgres() {
        let sql = drop_foreign_key_sql(&DbKind::Postgres, None, "orders", "fk_customer").unwrap();
        assert_eq!(sql, "ALTER TABLE \"orders\" DROP CONSTRAINT \"fk_customer\"");
    }
}
