const { resolve } = require('node:path');
module.exports = {
  apps: [
    {
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
    },
    {
      name: 'deezload-service',
      script: 'venv/bin/uvicorn',
      args: 'deezload_service:app --host 127.0.0.1 --port 8001',
      interpreter: 'none',
      cwd: resolve(__dirname, '..', 'python', 'deezload'),
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '300M',
      autorestart: true,
      out_file: 'logs/deezload-out.log',
      error_file: 'logs/deezload-err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
