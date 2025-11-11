/**
 * Central do Arranca - Sistema de Métricas de Performance
 * Coleta e armazena métricas de performance das operações
 */

const fs = require('fs-extra');
const path = require('path');
const configLoader = require('./config-loader');
const Logger = require('./logger');

class MetricsCollector {
  constructor() {
    this.config = configLoader.get('metrics') || { enabled: true };
    this.logger = new Logger('METRICS');
    this.metrics = {
      requests: {
        total: 0,
        success: 0,
        failed: 0,
        rateLimited: 0
      },
      proxies: {
        total: 0,
        valid: 0,
        invalid: 0,
        tested: 0
      },
      performance: {
        averageResponseTime: 0,
        minResponseTime: Infinity,
        maxResponseTime: 0,
        responseTimes: []
      },
      modules: {
        gemeos: { requests: 0, success: 0, failed: 0, avgTime: 0 },
        saude: { requests: 0, success: 0, failed: 0, avgTime: 0 },
        workbuscas: { requests: 0, success: 0, failed: 0, avgTime: 0 },
        telesena: { requests: 0, success: 0, failed: 0, avgTime: 0 }
      },
      timestamps: {
        start: new Date().toISOString(),
        lastUpdate: new Date().toISOString()
      }
    };
    
    this.intervalId = null;
    this.responseTimeWindow = []; // Mantém últimas 100 respostas
    this.maxWindowSize = 100;
    
    if (this.config.enabled) {
      this.startCollection();
    }
  }

  /**
   * Inicia coleta periódica de métricas
   */
  startCollection() {
    const interval = this.config.collectionInterval || 5000;
    
    this.intervalId = setInterval(() => {
      this.updateMetrics();
    }, interval);
    
    // Salva métricas periodicamente
    const saveInterval = this.config.saveInterval || 60000;
    setInterval(() => {
      this.saveMetrics();
    }, saveInterval);
  }

  /**
   * Para coleta de métricas
   */
  stopCollection() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Registra uma requisição
   */
  recordRequest(module, success, duration, statusCode = null) {
    if (!this.config.enabled) return;

    // Garante que o módulo existe na estrutura de métricas
    if (!this.metrics.modules[module]) {
      this.metrics.modules[module] = { requests: 0, success: 0, failed: 0, avgTime: 0 };
    }

    this.metrics.requests.total++;
    this.metrics.modules[module].requests++;
    
    if (success) {
      this.metrics.requests.success++;
      this.metrics.modules[module].success++;
    } else {
      this.metrics.requests.failed++;
      this.metrics.modules[module].failed++;
      
      if (statusCode === 429) {
        this.metrics.requests.rateLimited++;
      }
    }

    // Atualiza métricas de performance
    if (duration !== null && duration !== undefined) {
      this.recordResponseTime(duration);
      this.updateModuleAvgTime(module, duration);
    }
    
    this.metrics.timestamps.lastUpdate = new Date().toISOString();
  }

  /**
   * Registra tempo de resposta
   */
  recordResponseTime(duration) {
    this.responseTimeWindow.push(duration);
    
    // Mantém apenas últimas N respostas
    if (this.responseTimeWindow.length > this.maxWindowSize) {
      this.responseTimeWindow.shift();
    }
    
    // Atualiza min/max
    if (duration < this.metrics.performance.minResponseTime) {
      this.metrics.performance.minResponseTime = duration;
    }
    if (duration > this.metrics.performance.maxResponseTime) {
      this.metrics.performance.maxResponseTime = duration;
    }
  }

  /**
   * Atualiza tempo médio do módulo
   */
  updateModuleAvgTime(module, duration) {
    // Garante que o módulo existe
    if (!this.metrics.modules[module]) {
      this.metrics.modules[module] = { requests: 0, success: 0, failed: 0, avgTime: 0 };
    }
    
    const moduleMetrics = this.metrics.modules[module];
    const totalRequests = moduleMetrics.success + moduleMetrics.failed;
    
    if (totalRequests > 0) {
      moduleMetrics.avgTime = Math.round(
        (moduleMetrics.avgTime * (totalRequests - 1) + duration) / totalRequests
      );
    }
  }

  /**
   * Registra teste de proxy
   */
  recordProxyTest(valid) {
    if (!this.config.enabled) return;

    this.metrics.proxies.tested++;
    
    if (valid) {
      this.metrics.proxies.valid++;
    } else {
      this.metrics.proxies.invalid++;
    }
  }

  /**
   * Atualiza contador total de proxies
   */
  updateProxyTotal(count) {
    this.metrics.proxies.total = count;
  }

  /**
   * Atualiza métricas calculadas
   */
  updateMetrics() {
    // Calcula tempo médio de resposta
    if (this.responseTimeWindow.length > 0) {
      const sum = this.responseTimeWindow.reduce((a, b) => a + b, 0);
      this.metrics.performance.averageResponseTime = Math.round(sum / this.responseTimeWindow.length);
    }
    
    this.metrics.performance.responseTimes = [...this.responseTimeWindow];
  }

  /**
   * Obtém métricas resumidas
   */
  getSummary() {
    this.updateMetrics();
    
    const total = this.metrics.requests.total;
    const success = this.metrics.requests.success;
    const failed = this.metrics.requests.failed;
    const successRate = total > 0 ? ((success / total) * 100).toFixed(2) : '0.00';
    
    return {
      requests: {
        total,
        success,
        failed,
        successRate: `${successRate}%`,
        rateLimited: this.metrics.requests.rateLimited
      },
      proxies: {
        total: this.metrics.proxies.total,
        valid: this.metrics.proxies.valid,
        invalid: this.metrics.proxies.invalid,
        validRate: this.metrics.proxies.tested > 0 
          ? ((this.metrics.proxies.valid / this.metrics.proxies.tested) * 100).toFixed(2) + '%'
          : '0.00%'
      },
      performance: {
        averageResponseTime: `${this.metrics.performance.averageResponseTime}ms`,
        minResponseTime: this.metrics.performance.minResponseTime !== Infinity 
          ? `${this.metrics.performance.minResponseTime}ms`
          : 'N/A',
        maxResponseTime: `${this.metrics.performance.maxResponseTime}ms`
      },
      modules: this.metrics.modules,
      uptime: {
        start: this.metrics.timestamps.start,
        lastUpdate: this.metrics.timestamps.lastUpdate
      }
    };
  }

  /**
   * Salva métricas em arquivo
   */
  async saveMetrics() {
    if (!this.config.enabled) return;

    try {
      this.updateMetrics();
      
      const outputPath = this.config.outputPath || './logs/metrics.json';
      const dir = path.dirname(outputPath);
      await fs.ensureDir(dir);
      
      const data = {
        ...this.metrics,
        summary: this.getSummary(),
        savedAt: new Date().toISOString()
      };
      
      await fs.writeJson(outputPath, data, { spaces: 2 });
      await this.logger.debug('Métricas salvas', { path: outputPath });
    } catch (error) {
      await this.logger.error('Erro ao salvar métricas', { error: error.message });
    }
  }

  /**
   * Reseta métricas
   */
  reset() {
    this.metrics = {
      requests: { total: 0, success: 0, failed: 0, rateLimited: 0 },
      proxies: { total: 0, valid: 0, invalid: 0, tested: 0 },
      performance: {
        averageResponseTime: 0,
        minResponseTime: Infinity,
        maxResponseTime: 0,
        responseTimes: []
      },
      modules: {
        gemeos: { requests: 0, success: 0, failed: 0, avgTime: 0 },
        saude: { requests: 0, success: 0, failed: 0, avgTime: 0 },
        workbuscas: { requests: 0, success: 0, failed: 0, avgTime: 0 },
        telesena: { requests: 0, success: 0, failed: 0, avgTime: 0 }
      },
      timestamps: {
        start: new Date().toISOString(),
        lastUpdate: new Date().toISOString()
      }
    };
    this.responseTimeWindow = [];
  }

  /**
   * Obtém todas as métricas
   */
  getAll() {
    this.updateMetrics();
    return this.metrics;
  }
}

// Singleton
const metricsCollector = new MetricsCollector();

module.exports = metricsCollector;

