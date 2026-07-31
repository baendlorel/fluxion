use clap::Parser;
use std::fs::OpenOptions;
use std::io::Write;
use std::process::Command;
use std::time::Duration;
use tokio::time::interval;

#[derive(Parser, Debug)]
#[command(name = "fluxion")]
#[command(about = "Fluxion hot-reload server runner", long_about = None)]
struct Args {
    #[arg(short, long, default_value = "main.ts")]
    entry: String,

    #[arg(long, default_value = "fluxion.log")]
    logfile: String,

    #[arg(long, default_value = ".")]
    cwd: String,
}

fn log(logfile: &str, message: &str) {
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(logfile)
    {
        let _ = writeln!(file, "{}", message);
    }
}

#[tokio::main]
async fn main() {
    let args = Args::parse();

    // 设置工作目录
    if let Err(e) = std::env::set_current_dir(&args.cwd) {
        log(&args.logfile, &format!("[{}] Failed to set cwd to {}: {}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"), args.cwd, e));
        std::process::exit(1);
    }

    // 启动tsx进程
    let mut child = match Command::new("tsx")
        .arg(&args.entry)
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            log(&args.logfile, &format!("[{}] Failed to start tsx: {}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"), e));
            std::process::exit(1);
        }
    };

    let pid = child.id();
    log(&args.logfile, &format!("[{}] Started tsx {} (pid: {})", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"), args.entry, pid));

    // 每10秒检查healthz
    let mut check_interval = interval(Duration::from_secs(10));

    loop {
        check_interval.tick().await;

        // 检查进程是否还在运行
        match child.try_wait() {
            Ok(Some(status)) => {
                log(&args.logfile, &format!("[{}] Process exited with status: {}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"), status));
                break;
            }
            Ok(None) => {
                // 进程还在运行，检查healthz
                match reqwest::get("http://localhost:3000/__fluxion__/healthz").await {
                    Ok(resp) if resp.status().is_success() => {
                        // 健康时不记录
                    }
                    Ok(resp) => {
                        log(&args.logfile, &format!("[{}] Health check failed: status {}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"), resp.status()));
                    }
                    Err(e) => {
                        log(&args.logfile, &format!("[{}] Health check error: {}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"), e));
                    }
                }
            }
            Err(e) => {
                log(&args.logfile, &format!("[{}] Error checking process: {}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"), e));
                break;
            }
        }
    }
}
