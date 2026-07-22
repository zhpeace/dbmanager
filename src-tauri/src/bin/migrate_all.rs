use app_lib::db;
use std::sync::Arc;
use tokio::sync::Semaphore;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== 全量数据并行迁移测试 ===\n");

    let source_host = "192.168.0.156";
    let source_port = "3306";
    let source_user = "root";
    let source_pass = "hhsj@2021!";
    let source_db = "apps_beitou";

    println!("[连接源库] MySQL {}:{}/{} ...", source_host, source_port, source_db);
    let src_url = format!("mysql://{}:{}@{}:{}/{}", source_user, source_pass, source_host, source_port, source_db);
    let src_pool = sqlx::mysql::MySqlPoolOptions::new()
        .max_connections(10)
        .connect(&src_url)
        .await
        .map_err(|e| format!("源库连接失败: {}", e))?;
    let src = db::DbConnection::MySql(src_pool);

    let tables = src.get_tables(source_db).await.map_err(|e| format!("获取表列表失败: {}", e))?;
    let table_names: Vec<String> = tables.iter()
        .filter(|t| t.object_type == "TABLE" || t.object_type == "BASE TABLE")
        .map(|t| t.name.clone())
        .collect();
    println!("  找到 {} 张表\n", table_names.len());

    if table_names.is_empty() {
        println!("没有表需要迁移");
        return Ok(());
    }

    // === Target 1: MySQL 3307 ===
    println!("[MySQL] 迁移到 127.0.0.1:3307 ...");
    let admin_url = "mysql://root:testpass@127.0.0.1:3307";
    let admin_pool = sqlx::mysql::MySqlPoolOptions::new()
        .max_connections(2)
        .connect(admin_url)
        .await
        .map_err(|e| format!("目标 MySQL 管理连接失败: {}", e))?;
    if let Err(e) = sqlx::raw_sql(format!("DROP DATABASE IF EXISTS `{}`", source_db).as_str())
        .execute(&admin_pool).await {
        eprintln!("  ⚠️ DROP DATABASE 失败: {} (继续)", e);
    }
    if let Err(e) = sqlx::raw_sql(format!("CREATE DATABASE `{}`", source_db).as_str())
        .execute(&admin_pool).await {
        eprintln!("  ⚠️ CREATE DATABASE 失败: {} (继续)", e);
    }
    admin_pool.close().await;
    let tgt_mysql_url = format!("mysql://root:testpass@127.0.0.1:3307/{}", source_db);
    let tgt_mysql_pool = sqlx::mysql::MySqlPoolOptions::new()
        .max_connections(10)
        .connect(&tgt_mysql_url)
        .await
        .map_err(|e| format!("目标 MySQL 连接失败: {}", e))?;
    transfer_all_parallel(&src, db::DbConnection::MySql(tgt_mysql_pool), source_db, source_db.to_string(), &table_names, 4).await;

    // === Target 2: PostgreSQL 5433 ===
    println!("\n[PostgreSQL] 迁移到 127.0.0.1:5433 ...");
    let pg_url = format!("postgres://postgres:testpass@127.0.0.1:5433/{}", source_db);
    match sqlx::postgres::PgPoolOptions::new()
        .max_connections(10)
        .connect(&pg_url)
        .await {
            Ok(p) => transfer_all_parallel(&src, db::DbConnection::Pg(p), source_db, "public".into(), &table_names, 4).await,
            Err(e) => println!("  ⚠️ PG 连接失败: {} (跳过)", e),
        }

    // === Target 3: Oracle XE 1521 ===
    println!("\n[Oracle] 迁移到 127.0.0.1:1521 ...");
    match tokio::task::spawn_blocking(move || {
        oracle::Connection::connect("TESTUSER", "testpass", "//127.0.0.1:1521/XEPDB1")
    }).await {
        Ok(Ok(conn)) => {
            let tgt_oracle = db::DbConnection::Oracle(Arc::new(std::sync::Mutex::new(conn)));
            transfer_all_parallel(&src, tgt_oracle, source_db, "TESTUSER".into(), &table_names, 2).await;
        }
        Ok(Err(e)) => println!("  ⚠️ Oracle 连接失败: {} (跳过)", e),
        Err(e) => println!("  ⚠️ Oracle 线程错误: {:?} (跳过)", e),
    }

    // === Target 4: MongoDB 27018 ===
    println!("\n[MongoDB] 迁移到 127.0.0.1:27018 ...");
    match mongodb::Client::with_uri_str("mongodb://root:testpass@127.0.0.1:27018").await {
        Ok(client) => {
            let tgt_mongo = db::DbConnection::Mongo(client, source_db.to_string());
            transfer_all_parallel(&src, tgt_mongo, source_db, source_db.into(), &table_names, 4).await;
        }
        Err(e) => println!("  ⚠️ MongoDB 连接失败: {} (跳过)", e),
    }

    println!("\n=== 迁移完成 ===");
    Ok(())
}

async fn transfer_all_parallel(
    src: &db::DbConnection,
    tgt: db::DbConnection,
    source_db: &str,
    target_db: String,
    table_names: &[String],
    parallelism: usize,
) {
    let total_tables = table_names.len();
    let semaphore = Arc::new(Semaphore::new(parallelism));
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<(String, Result<db::types::TransferResult, String>, std::time::Duration)>();

    let mut remaining = total_tables;
    let mut spawned = 0usize;

    let source_db_owned = source_db.to_string();

    for table in table_names {
        let table = table.clone();
        let sem = semaphore.clone();
        let tx = tx.clone();
        let src_conn = src.clone();
        let tgt_conn = tgt.clone();
        let target_db = target_db.clone();
        let source_db = source_db_owned.clone();

        tokio::spawn(async move {
            let _permit = sem.acquire().await.unwrap();
            let opts = db::types::TransferOptions {
                source_id: "source".into(),
                source_database: source_db,
                target_id: "target".into(),
                target_database: target_db,
                tables: vec![table.clone()],
                conflict_strategy: db::types::ConflictStrategy::Ignore,
                ..Default::default()
            };
            let ts = std::time::Instant::now();
            let result = db::transfer_data(&src_conn, &tgt_conn, &opts, None).await;
            tx.send((table, result, ts.elapsed())).unwrap();
        });

        spawned += 1;

        // Throttle: wait if we've reached the max concurrent tasks
        if spawned >= parallelism * 2 {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
    }

    drop(tx);

    let mut total_rows = 0u64;
    let mut total_errors = 0u64;
    let ts = std::time::Instant::now();

    while let Some((table, result, elapsed)) = rx.recv().await {
        remaining -= 1;
        let pct = ((total_tables - remaining) * 100) / total_tables;
        match result {
            Ok(r) => {
                if !r.errors.is_empty() {
                    total_errors += r.errors.len() as u64;
                    for e in &r.errors {
                        println!("  [{}%] ⚠️  {}: {}", pct, table, e);
                    }
                }
                if r.tables_transferred.is_empty() && r.rows_transferred == 0 {
                    println!("  [{}%] ⏭️  {} (已存在)", pct, table);
                } else {
                    total_rows += r.rows_transferred as u64;
                    println!("  [{}%] ✅ {} ({} 行) [{:.1}s]", pct, table, r.rows_transferred, elapsed.as_secs_f64());
                }
            }
            Err(e) => {
                total_errors += 1;
                println!("  [{}%] ❌ {}: {}", pct, table, e);
            }
        }
    }

    let elapsed = ts.elapsed();
    println!(
        "  ─── {} 张表 / {} 行 / {} 错误 / {:.1}s",
        total_tables, total_rows, total_errors, elapsed.as_secs_f64()
    );
}
