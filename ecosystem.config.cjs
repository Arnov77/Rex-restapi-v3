const { resolve } = require('node:path');
module.exports = {
  apps: [{
    name: 'rex-api',
    script: 'dist/server.js',
    cwd: resolve(__dirname, '..'),
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '500M',
    autorestart: true,
    env: { NODE_ENV: 'production' },
    out_file: 'logs/pm2-out.log',
    error_file: 'logs/pm2-err.log',
    merge_logs: true,
    time: true,
  }],
};
