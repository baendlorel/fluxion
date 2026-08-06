const { homedir } = require('os');
const { execSync } = require('child_process');

const tsxPath = execSync('which tsx').toString().trim(); // got '<paths>/bin/tsx\n' so we need to trim it.

module.exports = {
  apps: [{ name: 'app', script: './main.ts', interpreter: tsxPath }],
};
