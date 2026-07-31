use clap::Parser;
use std::fs::OpenOptions;
use std::io::{stderr, Write};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;
use tokio::signal;
use tokio::sync::mpsc;
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

    #[arg(long, default_value = "9335")]
    port: u16,
}

fn log(logfile: &str, message: &str) {
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    let log_message = format!("[{}] {}", timestamp, message);

    // Try to write to log file
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(logfile) {
        if writeln!(file, "{}", log_message).is_err() {
            // If file write fails, fallback to stderr
            let _ = writeln!(stderr(), "{}", log_message);
        }
    } else {
        // If cannot open file, output to stderr
        let _ = writeln!(stderr(), "{}", log_message);
    }
}

fn spawn_tsx(entry: &str, port: u16) -> Result<std::process::Child, String> {
    Command::new("tsx")
        .arg(entry)
        .env("FLUXION_CLI_PORT", port.to_string())
        .spawn()
        .map_err(|e| format!("Failed to start tsx: {}", e))
}

#[tokio::main]
async fn main() {
    let args = Args::parse();
    let args = Arc::new(args);

    if let Err(e) = std::env::set_current_dir(&args.cwd) {
        log(
            &args.logfile,
            &format!("Failed to set cwd to {}: {}", args.cwd, e),
        );
        std::process::exit(1);
    }

    // Create signal handling channel
    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);

    // Listen for signals in background task
    let logfile_clone = args.logfile.clone();
    tokio::spawn(async move {
        // Listen for Ctrl+C
        let ctrl_c = signal::ctrl_c();
        if let Ok(_) = ctrl_c.await {
            let _ = shutdown_tx.send(()).await;
            log(&logfile_clone, "Received Ctrl+C signal");
            return;
        }

        // Listen for SIGTERM
        let mut terminate = signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("Failed to setup SIGTERM handler");
        if let Some(_) = terminate.recv().await {
            let _ = shutdown_tx.send(()).await;
            log(&logfile_clone, "Received SIGTERM signal");
        }
    });

    let mut child = match spawn_tsx(&args.entry, args.port) {
        Ok(c) => c,
        Err(e) => {
            log(&args.logfile, &e);
            std::process::exit(1);
        }
    };

    let pid = child.id();
    log(
        &args.logfile,
        &format!("Started tsx {} (pid: {})", args.entry, pid),
    );

    let mut check_interval = interval(Duration::from_secs(10));
    let mut restart_count = 0;
    const MAX_RESTARTS: u32 = 10;

    loop {
        tokio::select! {
            // Handle shutdown signal
            _ = shutdown_rx.recv() => {
                log(&args.logfile, "Shutting down...");
                let _ = child.kill();
                let _ = child.wait();
                log(&args.logfile, "Shutdown complete");
                break;
            }
            // Periodically check process and health status
            _ = check_interval.tick() => {
                // Check if process is still running
                match child.try_wait() {
                    Ok(Some(status)) => {
                        log(&args.logfile, &format!("Process exited with status: {}", status));
                        restart_count += 1;

                        if restart_count >= MAX_RESTARTS {
                            log(&args.logfile, &format!("Too many restarts ({}), giving up", MAX_RESTARTS));
                            break;
                        }

                        log(&args.logfile, &format!("Restarting... (attempt {}/{})", restart_count, MAX_RESTARTS));
                        tokio::time::sleep(Duration::from_secs(1)).await;

                        child = match spawn_tsx(&args.entry, args.port) {
                            Ok(c) => c,
                            Err(e) => {
                                log(&args.logfile, &e);
                                break;
                            }
                        };

                        let new_pid = child.id();
                        log(&args.logfile, &format!("Restarted tsx (pid: {})", new_pid));
                    }
                    Ok(None) => {
                        let health_url = format!("http://localhost:{}/__fluxion__/healthz", args.port);
                        match reqwest::get(&health_url).await {
                            Ok(resp) if resp.status().is_success() => {
                            }
                            Ok(resp) => {
                                log(&args.logfile, &format!("Health check failed: status {}", resp.status()));
                            }
                            Err(e) => {
                                log(&args.logfile, &format!("Health check error: {}", e));
                            }
                        }
                    }
                    Err(e) => {
                        log(&args.logfile, &format!("Error checking process: {}", e));
                        break;
                    }
                }
            }
        }
    }
}
