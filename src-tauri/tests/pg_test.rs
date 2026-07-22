#[tokio::test]
async fn test_pg_connection() {
    let host = std::env::var("PG_HOST").unwrap_or_else(|_| "192.168.0.160".to_string());
    let port: u16 = std::env::var("PG_PORT").ok().and_then(|v| v.parse().ok()).unwrap_or(5432);
    let user = std::env::var("PG_USER").unwrap_or_else(|_| "oushutest".to_string());
    let password = std::env::var("PG_PASSWORD").unwrap_or_else(|_| "hhsj@2024!".to_string());
    let database = std::env::var("PG_DB").unwrap_or_else(|_| "postgres".to_string());

    println!("Testing PostgreSQL connection with builder pattern...");
    println!("host={}, port={}, user={}, password={}, db={}", host, port, user, password, database);

    let result = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_with(
            sqlx::postgres::PgConnectOptions::new()
                .host(&host)
                .port(port)
                .username(&user)
                .password(&password)
                .database(&database)
        )
        .await;

    match result {
        Ok(pool) => {
            println!("SUCCESS! Connection established.");
            let val: i32 = sqlx::query_scalar("SELECT 1")
                .fetch_one(&pool)
                .await
                .expect("Query failed");
            assert_eq!(val, 1);
            println!("Query result: {}", val);
            pool.close().await;
        }
        Err(e) => {
            panic!("Connection FAILED: {:?}", e);
        }
    }
}
