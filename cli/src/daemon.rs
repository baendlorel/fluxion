use std::fs::File;
use std::io::{self, Write};
use std::path::Path;

pub fn create_pid_file(pid_path: &str) -> io::Result<()> {
    let pid = std::process::id();
    let mut file = File::create(pid_path)?;
    writeln!(file, "{}", pid)?;
    Ok(())
}

pub fn remove_pid_file(pid_path: &str) {
    if Path::new(pid_path).exists() {
        let _ = std::fs::remove_file(pid_path);
    }
}

#[cfg(unix)]
pub fn daemonize() -> io::Result<()> {
    use std::ffi::CString;

    unsafe {
        // Fork to create parent process exit
        let pid = libc::fork();
        if pid < 0 {
            return Err(io::Error::new(
                io::ErrorKind::Other,
                "Failed to fork (first time)",
            ));
        } else if pid > 0 {
            // Parent process exits
            libc::_exit(0);
        }

        // Create new session
        if libc::setsid() < 0 {
            return Err(io::Error::new(
                io::ErrorKind::Other,
                "Failed to create new session",
            ));
        }

        // Fork again to ensure daemon never acquires a terminal
        let pid = libc::fork();
        if pid < 0 {
            return Err(io::Error::new(
                io::ErrorKind::Other,
                "Failed to fork (second time)",
            ));
        } else if pid > 0 {
            // Parent process exits
            libc::_exit(0);
        }

        // Change working directory to root
        let root = CString::new("/").unwrap();
        if libc::chdir(root.as_ptr()) < 0 {
            return Err(io::Error::new(
                io::ErrorKind::Other,
                "Failed to change directory",
            ));
        }

        // Reset file mode creation mask
        libc::umask(0);

        // Redirect stdin, stdout, stderr to /dev/null
        let dev_null = CString::new("/dev/null").unwrap();
        let null_fd = libc::open(dev_null.as_ptr(), libc::O_RDWR, 0);
        if null_fd >= 0 {
            libc::dup2(null_fd, libc::STDIN_FILENO);
            libc::dup2(null_fd, libc::STDOUT_FILENO);
            libc::dup2(null_fd, libc::STDERR_FILENO);
            if null_fd > libc::STDERR_FILENO {
                libc::close(null_fd);
            }
        }
    }

    Ok(())
}

#[cfg(not(unix))]
pub fn daemonize() -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Daemon mode is only supported on Unix-like systems",
    ))
}
