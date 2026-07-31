use std::fs::{create_dir_all, OpenOptions};
use std::io::{stderr, Write};
use std::path::Path;

pub fn log(logfile: &str, message: &str) {
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    let log_message = format!("[{}] {}", timestamp, message);

    // 确保日志目录存在
    if let Some(parent_dir) = Path::new(logfile).parent() {
        if !parent_dir.as_os_str().is_empty() {
            let _ = create_dir_all(parent_dir);
        }
    }

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
