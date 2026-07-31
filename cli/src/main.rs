mod cli;
mod daemon;
mod logging;
mod process;
mod signals;

use clap::Parser;
use cli::Args;
use process::ProcessManager;
use std::sync::Arc;
use tokio::sync::mpsc;

#[tokio::main]
async fn main() {
    let args = Args::parse();
    let args = Arc::new(args);

    if let Err(e) = std::env::set_current_dir(&args.cwd) {
        logging::log(
            &args.logfile,
            &format!("Failed to set cwd to {}: {}", args.cwd, e),
        );
        eprintln!("Error: {}", e);
        std::process::exit(1);
    }

    // Handle daemon mode
    if args.daemon {
        #[cfg(unix)]
        {
            // Create PID file path
            let pid_file = format!("{}.pid", args.logfile);

            if let Err(e) = daemon::daemonize() {
                eprintln!("Failed to daemonize: {}", e);
                std::process::exit(1);
            }

            if let Err(e) = daemon::create_pid_file(&pid_file) {
                logging::log(&args.logfile, &format!("Failed to create PID file: {}", e));
            }

            // Ensure PID file is cleaned up on exit
            let pid_file_clone = pid_file.clone();
            let logfile_clone = args.logfile.clone();
            ctrlc::set_handler(move || {
                daemon::remove_pid_file(&pid_file_clone);
                logging::log(&logfile_clone, "Received interrupt signal, cleaning up");
                std::process::exit(0);
            })
            .expect("Error setting Ctrl-C handler");

            logging::log(
                &args.logfile,
                &format!("Running as daemon (pid: {})", std::process::id()),
            );
        }

        #[cfg(not(unix))]
        {
            eprintln!("Error: Daemon mode is only supported on Unix-like systems");
            std::process::exit(1);
        }
    }

    // Create signal handling channel
    let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);

    // Set up signal handlers
    signals::setup_signal_handlers(shutdown_tx, args.logfile.clone()).await;

    // Start the tsx process
    let (child, mode_description) = match process::spawn_tsx(&args.entry, args.port) {
        Ok(c) => c,
        Err(e) => {
            logging::log(&args.logfile, &e);
            eprintln!("Error: {}", e);
            std::process::exit(1);
        }
    };

    let pid = child.id();
    logging::log(
        &args.logfile,
        &format!("Started tsx {} {} (pid: {})", args.entry, mode_description, pid),
    );

    // Create and run process manager
    let mut process_manager = ProcessManager::default();

    process_manager
        .run_monitoring_loop(child, &args.entry, args.port, &args.logfile, shutdown_rx)
        .await;

    // Clean up daemon mode resources
    if args.daemon {
        #[cfg(unix)]
        {
            let pid_file = format!("{}.pid", args.logfile);
            daemon::remove_pid_file(&pid_file);
        }
    }
}
