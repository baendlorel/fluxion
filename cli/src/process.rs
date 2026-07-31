use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::time::{interval, sleep};

#[derive(Debug, Clone, PartialEq)]
pub enum TsxRunMode {
    Local,
    Npx,
    GlobalInstall,
}

pub struct TsxRunner {
    pub mode: TsxRunMode,
    pub tsx_path: Option<String>,
}

impl TsxRunner {
    pub fn new() -> Result<Self, String> {
        // 首先检查 tsx 是否在 PATH 中
        if let Ok(tsx_path) = Self::check_tsx_installed() {
            return Ok(TsxRunner {
                mode: TsxRunMode::Local,
                tsx_path: Some(tsx_path),
            });
        }

        // 检查 npx 是否可用
        if Self::check_npx_available() {
            return Ok(TsxRunner {
                mode: TsxRunMode::Npx,
                tsx_path: None,
            });
        }

        // 如果都不行，提供安装建议
        Err("tsx not found. Please install tsx using: npm install -g tsx".to_string())
    }

    fn check_tsx_installed() -> Result<String, String> {
        // 使用 which 或 command -v 来检测 tsx
        if cfg!(unix) {
            let output = Command::new("which")
                .arg("tsx")
                .output()
                .map_err(|e| format!("Failed to execute which: {}", e))?;

            if output.status.success() {
                let tsx_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !tsx_path.is_empty() {
                    return Ok(tsx_path);
                }
            }
        } else if cfg!(windows) {
            let output = Command::new("where")
                .arg("tsx")
                .output()
                .map_err(|e| format!("Failed to execute where: {}", e))?;

            if output.status.success() {
                let tsx_path = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .map(|s| s.to_string())
                    .unwrap_or_default();

                if !tsx_path.is_empty() {
                    return Ok(tsx_path);
                }
            }
        }

        Err("tsx not found in PATH".to_string())
    }

    fn check_npx_available() -> bool {
        let result = if cfg!(unix) {
            Command::new("which").arg("npx").output()
        } else {
            Command::new("where").arg("npx").output()
        };

        result.map_or(false, |output| output.status.success())
    }

    pub fn command(&self) -> Command {
        match self.mode {
            TsxRunMode::Local => {
                if let Some(ref tsx_path) = self.tsx_path {
                    Command::new(tsx_path)
                } else {
                    Command::new("tsx")
                }
            }
            TsxRunMode::Npx => {
                let mut cmd = Command::new("npx");
                cmd.arg("tsx");
                cmd
            }
            TsxRunMode::GlobalInstall => Command::new("tsx"),
        }
    }

    pub fn mode_description(&self) -> &str {
        match self.mode {
            TsxRunMode::Local => "local tsx",
            TsxRunMode::Npx => "npx tsx",
            TsxRunMode::GlobalInstall => "globally installed tsx",
        }
    }
}

impl Default for TsxRunner {
    fn default() -> Self {
        Self::new().unwrap_or_else(|_| TsxRunner {
            mode: TsxRunMode::GlobalInstall,
            tsx_path: None,
        })
    }
}

pub fn spawn_tsx(entry: &str, port: u16, cli_logfile: &str) -> Result<(std::process::Child, String), String> {
    let tsx_runner = TsxRunner::new()?;
    let mut cmd = tsx_runner.command();

    // 从 CLI 日志文件路径生成 instance 日志文件路径
    // .fluxion/fluxion.log -> .fluxion/fluxion-instance.log
    let instance_logfile = cli_logfile.replace("fluxion.log", "fluxion-instance.log");

    cmd.arg(entry)
        .env("FLUXION_CLI_PORT", port.to_string())
        .env("FLUXION_INSTANCE_LOG", &instance_logfile)
        .spawn()
        .map(|child| (child, format!("using {}", tsx_runner.mode_description())))
        .map_err(|e| format!("Failed to start tsx using {}: {}", tsx_runner.mode_description(), e))
}

pub struct ProcessManager {
    pub max_restarts: u32,
    pub restart_count: u32,
    pub health_fail_count: Arc<AtomicU32>,
    pub health_check_interval: Duration,
    pub health_check_fail_threshold: u32,
}

impl Default for ProcessManager {
    fn default() -> Self {
        Self {
            max_restarts: 10,
            restart_count: 0,
            health_fail_count: Arc::new(AtomicU32::new(0)),
            health_check_interval: Duration::from_secs(10),
            health_check_fail_threshold: 3,
        }
    }
}

impl ProcessManager {
    #[allow(dead_code)]
    pub fn new(max_restarts: u32, health_check_fail_threshold: u32) -> Self {
        Self {
            max_restarts,
            health_check_fail_threshold,
            ..Default::default()
        }
    }

    pub fn calculate_backoff(&self) -> u64 {
        // Exponential backoff: 2s, 4s, 8s, max 30s
        (2u64 << self.restart_count.min(5)).min(30)
    }

    pub async fn check_process_health(
        &self,
        logfile: &str,
        port: u16,
    ) -> Result<(), String> {
        let health_url = format!("http://localhost:{}/__fluxion__/healthz", port);
        let health_result = reqwest::get(&health_url).await;

        match health_result {
            Ok(resp) if resp.status().is_success() => {
                // Health check passed, reset counter
                self.health_fail_count.store(0, Ordering::Relaxed);
                Ok(())
            }
            Ok(resp) => {
                let status = resp.status();
                crate::logging::log(
                    logfile,
                    &format!("Health check failed: status {}", status),
                );

                // Increment failure counter
                let fail_count = self.health_fail_count.fetch_add(1, Ordering::Relaxed) + 1;
                if fail_count >= self.health_check_fail_threshold {
                    return Err(format!(
                        "Health check failed {} times in a row",
                        self.health_check_fail_threshold
                    ));
                }
                Ok(())
            }
            Err(e) => {
                crate::logging::log(logfile, &format!("Health check error: {}", e));
                // Network error - might be normal during startup
                Ok(())
            }
        }
    }

    pub async fn run_monitoring_loop(
        &mut self,
        mut child: std::process::Child,
        entry: &str,
        port: u16,
        logfile: &str,
        mut shutdown_rx: tokio::sync::mpsc::Receiver<()>,
    ) {
        let mut check_interval = interval(self.health_check_interval);

        loop {
            tokio::select! {
                // Handle shutdown signal
                _ = shutdown_rx.recv() => {
                    crate::logging::log(logfile, "Shutting down...");
                    let _ = child.kill();
                    let _ = child.wait();
                    crate::logging::log(logfile, "Shutdown complete");
                    break;
                }
                // Periodically check process and health status
                _ = check_interval.tick() => {
                    // Check if process is still running
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            crate::logging::log(
                                logfile,
                                &format!("Process exited with status: {}", status),
                            );
                            self.restart_count += 1;

                            if self.restart_count >= self.max_restarts {
                                crate::logging::log(
                                    logfile,
                                    &format!("Too many restarts ({}), giving up", self.max_restarts),
                                );
                                break;
                            }

                            crate::logging::log(
                                logfile,
                                &format!("Restarting... (attempt {}/{})", self.restart_count, self.max_restarts),
                            );

                            let backoff_secs = self.calculate_backoff();
                            crate::logging::log(
                                logfile,
                                &format!("Waiting {}s before restart", backoff_secs),
                            );
                            sleep(Duration::from_secs(backoff_secs)).await;

                            match spawn_tsx(entry, port, logfile) {
                                Ok((c, mode)) => {
                                    let new_pid = c.id();
                                    child = c;
                                    crate::logging::log(
                                        logfile,
                                        &format!("Restarted tsx {} (pid: {})", mode, new_pid),
                                    );
                                }
                                Err(e) => {
                                    crate::logging::log(logfile, &e);
                                    break;
                                }
                            };
                        }
                        Ok(None) => {
                            // Process is still running, check health endpoint
                            if let Err(e) = self.check_process_health(logfile, port).await {
                                crate::logging::log(logfile, &e);
                                crate::logging::log(logfile, "Restarting process due to health check failure");
                                self.health_fail_count.store(0, Ordering::Relaxed);

                                let _ = child.kill();
                                let _ = child.wait();

                                // Process will be restarted in next iteration
                                continue;
                            }
                        }
                        Err(e) => {
                            crate::logging::log(
                                logfile,
                                &format!("Error checking process: {}", e),
                            );
                            break;
                        }
                    }
                }
            }
        }
    }
}
