use tokio::signal;
use tokio::sync::mpsc;

pub async fn setup_signal_handlers(
    shutdown_tx: mpsc::Sender<()>,
    logfile: String,
) {
    let ctrl_c = signal::ctrl_c();
    let terminate_result = signal::unix::signal(signal::unix::SignalKind::terminate());

    // Check if SIGTERM handler setup succeeded and handle accordingly
    if terminate_result.is_err() {
        let e = terminate_result.unwrap_err();
        crate::logging::log(
            &logfile,
            &format!("Failed to setup SIGTERM handler: {}", e),
        );
        crate::logging::log(&logfile, "Will only respond to Ctrl+C");

        // Only listen for Ctrl+C if SIGTERM setup failed
        tokio::spawn(async move {
            if ctrl_c.await.is_ok() {
                let _ = shutdown_tx.send(()).await;
                crate::logging::log(&logfile, "Received Ctrl+C signal");
            }
        });
    } else {
        let mut terminate = terminate_result.unwrap();

        // Listen for both signals
        tokio::spawn(async move {
            tokio::select! {
                _ = ctrl_c => {
                    let _ = shutdown_tx.send(()).await;
                    crate::logging::log(&logfile, "Received Ctrl+C signal");
                }
                _ = terminate.recv() => {
                    let _ = shutdown_tx.send(()).await;
                    crate::logging::log(&logfile, "Received SIGTERM signal");
                }
            }
        });
    }
}
