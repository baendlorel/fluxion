use clap::Parser;
use std::process::Command;
use std::time::Duration;
use tokio::time::interval;

#[derive(Parser, Debug)]
#[command(name = "fluxion")]
#[command(about = "Fluxion hot-reload server runner", long_about = None)]
struct Args {
    #[arg(short, long, default_value = "main.ts")]
    entry: String,
}

#[tokio::main]
async fn main() {
    let args = Args::parse();

    // 启动tsx进程
    let child = match Command::new("tsx")
        .arg(&args.entry)
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Failed to start tsx: {}", e);
            std::process::exit(1);
        }
    };

    let pid = child.id();
    println!("Started tsx {} (pid: {})", args.entry, pid);

    // 每10秒检查healthz
    let mut check_interval = interval(Duration::from_secs(10));

    loop {
        check_interval.tick().await;

        // 检查进程是否还在运行
        match child.try_wait() {
            Ok(Some(status)) => {
                println!("Process exited with status: {}", status);
                break;
            }
            Ok(None) => {
                // 进程还在运行，检查healthz
                match reqwest::get("http://localhost:3000/__fluxion__/healthz").await {
                    Ok(resp) if resp.status().is_success() => {
                        if let Ok(json) = resp.json::<serde_json::Value>().await {
                            println!("Health check: ok (pid: {})", json["pid"].as_i64().unwrap_or(0));
                        }
                    }
                    Ok(resp) => {
                        eprintln!("Health check failed: status {}", resp.status());
                    }
                    Err(e) => {
                        eprintln!("Health check error: {}", e);
                    }
                }
            }
            Err(e) => {
                eprintln!("Error checking process: {}", e);
                break;
            }
        }
    }
}
