/**
 * Performance Logger - Ring-buffer structured logger + diagnostic report export
 * Spec §4.11: {level, module, message, context, timestamp} format
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARNING: 2,
  ERROR: 3
};

const MAX_BUFFER_SIZE = 500; // Keep last 500 log entries

class RingBufferLogger {
  constructor() {
    this.buffer = [];
    this.index = 0;
    this.enabled = true;
    this.minLevel = LOG_LEVELS.INFO; // Default minimum level
    
    // Console output enabled by default
    this.consoleOutput = true;
  }
  
  /**
   * Set minimum log level
   */
  setLevel(level) {
    if (typeof level === 'string') {
      this.minLevel = LOG_LEVELS[level.toUpperCase()] ?? LOG_LEVELS.INFO;
    } else {
      this.minLevel = level;
    }
  }
  
  /**
   * Enable/disable console output
   */
  setConsoleOutput(enabled) {
    this.consoleOutput = enabled;
  }
  
  /**
   * Add log entry to ring buffer
   */
  _log(level, module, message, context = {}) {
    if (!this.enabled || level < this.minLevel) return;
    
    const entry = {
      level: Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key] === level),
      module,
      message,
      context,
      timestamp: new Date().toISOString(),
      sequence: this.index++
    };
    
    // Ring buffer: overwrite oldest when full
    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      const removeIndex = this.index % MAX_BUFFER_SIZE;
      this.buffer[removeIndex] = entry;
    } else {
      this.buffer.push(entry);
    }
    
    // Console output
    if (this.consoleOutput) {
      const prefix = `${entry.level} [${module}]`;
      const logFn = level === LOG_LEVELS.ERROR ? console.error :
                    level === LOG_LEVELS.WARNING ? console.warn :
                    console.log;
      
      logFn(`${prefix} ${message}`, Object.keys(context).length > 0 ? context : '');
    }
  }
  
  debug(module, message, context = {}) {
    this._log(LOG_LEVELS.DEBUG, module, message, context);
  }
  
  info(module, message, context = {}) {
    this._log(LOG_LEVELS.INFO, module, message, context);
  }
  
  warning(module, message, context = {}) {
    this._log(LOG_LEVELS.WARNING, module, message, context);
  }
  
  error(module, message, context = {}) {
    this._log(LOG_LEVELS.ERROR, module, message, context);
  }
  
  /**
   * Get all logs in buffer (for diagnostic export)
   */
  getLogs(sinceSequence = 0) {
    if (sinceSequence === 0) {
      return [...this.buffer];
    }
    
    return this.buffer.filter(entry => entry.sequence >= sinceSequence);
  }
  
  /**
   * Get logs filtered by module
   */
  getLogsByModule(module) {
    return this.buffer.filter(entry => entry.module === module);
  }
  
  /**
   * Get logs filtered by level
   */
  getLogsByLevel(level) {
    const levelNum = typeof level === 'string' ? LOG_LEVELS[level.toUpperCase()] : level;
    return this.buffer.filter(entry => LOG_LEVELS[entry.level] >= levelNum);
  }
  
  /**
   * Clear buffer
   */
  clear() {
    this.buffer = [];
    this.index = 0;
  }
  
  /**
   * Export logs for diagnostic report
   */
  exportDiagnosticReport() {
    const warnings = this.getLogsByLevel(LOG_LEVELS.WARNING);
    const errors = this.getLogsByLevel(LOG_LEVELS.ERROR);
    
    return {
      exportedAt: new Date().toISOString(),
      totalEntries: this.buffer.length,
      summary: {
        debug: this.buffer.filter(e => e.level === 'DEBUG').length,
        info: this.buffer.filter(e => e.level === 'INFO').length,
        warning: warnings.length,
        error: errors.length
      },
      recentErrors: errors.slice(-10),
      recentWarnings: warnings.slice(-20),
      modules: [...new Set(this.buffer.map(e => e.module))],
      timeRange: {
        start: this.buffer[0]?.timestamp,
        end: this.buffer[this.buffer.length - 1]?.timestamp
      }
    };
  }
}

// Singleton instance
export const logger = new RingBufferLogger();

// Convenience exports
export const logDebug = (module, message, context) => logger.debug(module, message, context);
export const logInfo = (module, message, context) => logger.info(module, message, context);
export const logWarning = (module, message, context) => logger.warning(module, message, context);
export const logError = (module, message, context) => logger.error(module, message, context);

export default logger;
