use genetic_assembly_server::{ServerConfig, run};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "genetic_assembly=info,tower_http=info".into()),
        )
        .init();
    let config = ServerConfig::from_env().map_err(std::io::Error::other)?;
    run(config).await
}
