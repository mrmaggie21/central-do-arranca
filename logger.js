/**
 * Central do Arranca - Sistema de Logs Estruturados
 * Logs em formato JSON com diferentes níveis e outputs
 */

const fs = require('fs-extra');
const path = require('path');
const configLoader = require('./config-loader');

class Logger {
  constructor(moduleName = 'APP') {
    this.moduleName = moduleName;
    this.config = configLoader.get('logging') || { enabled: true, level: 'info', format: 'json' };
    this.logLevels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3
    };
    this.currentLevel = this.logLevels[this.config.level] || 2;
    
    // Garante que o diretório de logs existe
    if (this.config.output?.file) {
      const logDir = path.dirname(this.config.output.filePath || './logs/app.log');
      fs.ensureDirSync(logDir);
    }
  }

  /**
   * Cria estrutura de log padronizada
   */
  createLogEntry(level, message, meta = {}) {
    return {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      module: this.moduleName,
      message: message,
      ...meta
    };
  }

  /**
   * Formata log para exibição no console
   */
  formatConsoleLog(entry) {
    const time = new Date(entry.timestamp).toLocaleTimeString('pt-BR');
    const emoji = this.getEmoji(entry.level);
    return `${emoji} [${time}] [${entry.module}] ${entry.message}`;
  }

  /**
   * Retorna emoji para cada nível
   */
  getEmoji(level) {
    const emojis = {
      ERROR: '❌',
      WARN: '⚠️',
      INFO: 'ℹ️',
      DEBUG: '🔍'
    };
    return emojis[level] || '📝';
  }

  /**
   * Escreve log no console (formato legível)
   */
  writeConsole(entry) {
    if (this.config.output?.console !== false) {
      const formatted = this.formatConsoleLog(entry);
      console.log(formatted);
      
      // Para erros, também usa console.error
      if (entry.level === 'ERROR') {
        console.error(formatted);
      }
    }
  }

  /**
   * Escreve log em arquivo (formato JSON)
   */
  async writeFile(entry) {
    if (this.config.output?.file && this.config.format === 'json') {
      try {
        const filePath = this.config.output.filePath || './logs/app.log';
        const logLine = JSON.stringify(entry) + '\n';
        
        await fs.appendFile(filePath, logLine, 'utf8');
        
        // Rotação de arquivo (simplificada)
        await this.rotateLogIfNeeded(filePath);
      } catch (error) {
        // Falha silenciosa para não quebrar o app se log falhar
        console.error('Erro ao escrever log:', error.message);
      }
    }
  }

  /**
   * Rotaciona log se exceder tamanho máximo
   */
  async rotateLogIfNeeded(filePath) {
    try {
      const stats = await fs.stat(filePath);
      const maxSize = this.parseFileSize(this.config.output?.maxFileSize || '10MB');
      
      if (stats.size > maxSize) {
        const dir = path.dirname(filePath);
        const ext = path.extname(filePath);
        const base = path.basename(filePath, ext);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
        const rotatedPath = path.join(dir, `${base}-${timestamp}${ext}`);
        
        await fs.move(filePath, rotatedPath);
        
        // Remove logs antigos (mantém apenas os últimos N)
        const maxFiles = this.config.output?.maxFiles || 5;
        await this.cleanOldLogs(dir, base, ext, maxFiles);
      }
    } catch (error) {
      // Ignora erro de rotação
    }
  }

  /**
   * Remove logs antigos
   */
  async cleanOldLogs(dir, base, ext, maxFiles) {
    try {
      const files = await fs.readdir(dir);
      const logFiles = files
        .filter(f => f.startsWith(base) && f.endsWith(ext))
        .map(f => ({
          name: f,
          path: path.join(dir, f)
        }))
        .sort((a, b) => {
          // Ordena por data no nome do arquivo
          return b.name.localeCompare(a.name);
        });

      // Remove arquivos excedentes
      for (let i = maxFiles; i < logFiles.length; i++) {
        await fs.unlink(logFiles[i].path);
      }
    } catch (error) {
      // Ignora erro
    }
  }

  /**
   * Converte string de tamanho (ex: "10MB") para bytes
   */
  parseFileSize(sizeStr) {
    const units = { KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 };
    const match = sizeStr.match(/^(\d+)(KB|MB|GB)$/i);
    
    if (match) {
      const value = parseInt(match[1]);
      const unit = match[2].toUpperCase();
      return value * (units[unit] || 1);
    }
    
    return 10 * 1024 * 1024; // Default 10MB
  }

  /**
   * Log genérico
   */
  async log(level, message, meta = {}) {
    if (this.logLevels[level] > this.currentLevel) {
      return; // Nível muito baixo, ignora
    }

    const entry = this.createLogEntry(level, message, meta);
    
    // Escreve em paralelo
    this.writeConsole(entry);
    await this.writeFile(entry);
  }

  /**
   * Métodos de conveniência
   */
  async error(message, meta = {}) {
    await this.log('error', message, meta);
  }

  async warn(message, meta = {}) {
    await this.log('warn', message, meta);
  }

  async info(message, meta = {}) {
    await this.log('info', message, meta);
  }

  async debug(message, meta = {}) {
    await this.log('debug', message, meta);
  }
}

module.exports = Logger;

