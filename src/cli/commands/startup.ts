import { writeFileSync, chmodSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SYSTEMD_SERVICE_PATH = '/etc/systemd/system/fluxion-daemon.service';

function generateSystemdService(): string {
  const user = process.env.USER || 'root';
  const home = homedir();
  const nodePath = process.execPath;
  // 查找 daemon 脚本
  // 方案一：与 startup 同目录（已编译）
  const daemonScript = resolve(__dirname, '../daemon.js');
  // 方案二：bundled 产物（daemon.mjs 在 cli/ 目录下）
  const bundledScript = resolve(__dirname, 'daemon.mjs');

  let scriptPath = daemonScript;
  if (existsSync(bundledScript)) {
    scriptPath = bundledScript;
  }

  return `[Unit]
Description=Fluxion process manager
Documentation=https://github.com/baendlorel/fluxion
After=network.target

[Service]
Type=simple
User=${user}
Environment=FLUXION_HOME=${home}/.fluxion
ExecStart=${nodePath} ${scriptPath}
ExecStop=${nodePath} ${scriptPath} shutdown
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
`;
}

export async function startup(): Promise<void> {
  // 检查是否 systemd
  try {
    execSync('which systemctl', { stdio: 'ignore' });
  } catch {
    console.error('systemd not found. This command only supports systemd.');
    process.exit(1);
  }

  // 生成 service 文件内容
  const content = generateSystemdService();

  // 写入（需要 sudo）
  try {
    writeFileSync(SYSTEMD_SERVICE_PATH, content);
    chmodSync(SYSTEMD_SERVICE_PATH, 0o644);
  } catch {
    // 权限不足，提示用户用 sudo
    console.log('Need root permission. Run:');
    console.log();
    console.log(`  sudo fluxion startup`);
    console.log();
    console.log('Or manually install:');
    console.log(`  sudo cat > ${SYSTEMD_SERVICE_PATH} << 'EOF'`);
    console.log(content);
    console.log('EOF');
    console.log(`  sudo systemctl daemon-reload`);
    console.log(`  sudo systemctl enable fluxion-daemon`);
    process.exit(1);
  }

  // 注册并启动
  execSync('systemctl daemon-reload', { stdio: 'inherit' });
  execSync('systemctl enable fluxion-daemon', { stdio: 'inherit' });
  execSync('systemctl start fluxion-daemon', { stdio: 'inherit' });

  console.log('✓ Fluxion daemon service installed and started.');
  console.log('  It will automatically start on boot.');
}