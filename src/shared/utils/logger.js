const fs = require('fs');
const path = require('path');

/**
 * Simple Logger Utility
 * Writes logs to console and files
 */
class Logger {
  constructor() {
    this.logDir = path.join(__dirname, '../../logs');
    this._ensureLogDir();
  }

  /**
   * Ensure log directory exists
   */
  _ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Format log message
   */
  _formatMessage(level, message) {
    return `[${new Date().toISOString()}] [${level}] ${message}`;
  }

  /**
   * Write log to console and file
   */
  _write(level, message) {
    const formatted = this._formatMessage(level, message);
    const color = this._getColor(level);
    
    console.log(`${color}${formatted}\x1b[0m`);

    // Write to file
    const filePath = path.join(this.logDir, `${level.toLowerCase()}.log`);
    fs.appendFileSync(filePath, formatted + '\n');

    // Also write to combined log
    const combinedPath = path.join(this.logDir, 'combined.log');
    fs.appendFileSync(combinedPath, formatted + '\n');
  }

  /**
   * Get ANSI color for log level
   */
  _getColor(level) {
    const colors = {
      INFO: '\x1b[36m',    // Cyan
      ERROR: '\x1b[31m',   // Red
      WARN: '\x1b[33m',    // Yellow
      DEBUG: '\x1b[35m',   // Magenta
      SUCCESS: '\x1b[32m', // Green
    };
    return colors[level] || '\x1b[0m';
  }

  info(message) {
    this._write('INFO', message);
  }

  error(message) {
    this._write('ERROR', message);
  }

  warn(message) {
    this._write('WARN', message);
  }

  debug(message) {
    if (process.env.NODE_ENV === 'development') {
      this._write('DEBUG', message);
    }
  }

  success(message) {
    this._write('SUCCESS', message);
  }
}

module.exports = new Logger();
