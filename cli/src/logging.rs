use std::fs::OpenOptions;
use std::io::{stderr, Write};

pub fn log(logfile: &str, message: &str) {
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    let log_message = format!("[{}] {}", timestamp, message);

    // Try to write to log file
    match OpenOptions::new().create(true).append(true).open(logfile) {
        Ok(mut file) => {
            if let Err(e) = writeln!(file, "{}", log_message) {
                // If file write fails, fallback to stderr with error context
                let fallback_msg = format!("[LOG WRITE ERROR: {}] {}", e, log_message);
                let _ = writeln!(stderr(), "{}", fallback_msg);
            }
        }
        Err(e) => {
            // If cannot open file, output to stderr with error context
            let fallback_msg = format!("[LOG FILE ERROR: {}] {}", e, log_message);
            let _ = writeln!(stderr(), "{}", fallback_msg);
        }
    }
}
