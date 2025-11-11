/**
 * Central do Arranca - Carregador de Configuração
 * Carrega configurações de arquivos JSON e variáveis de ambiente
 */

const fs = require('fs-extra');
const path = require('path');

class ConfigLoader {
  constructor() {
    this.config = null;
    this.envOverrides = {};
    this.loadConfig();
  }

  /**
   * Carrega configuração do arquivo config.json
   */
  loadConfig() {
    try {
      const configPath = path.join(__dirname, 'config.json');
      
      if (!fs.existsSync(configPath)) {
        console.warn('⚠️  config.json não encontrado, usando configurações padrão');
        this.config = this.getDefaultConfig();
        return;
      }

      const configData = fs.readFileSync(configPath, 'utf8');
      this.config = JSON.parse(configData);
      this.loadEnvOverrides();
      
      console.log('✅ Configuração carregada com sucesso');
    } catch (error) {
      console.error('❌ Erro ao carregar configuração:', error.message);
      this.config = this.getDefaultConfig();
    }
  }

  /**
   * Carrega variáveis de ambiente e sobrescreve configurações
   */
  loadEnvOverrides() {
    // API Tokens (prioridade nas variáveis de ambiente)
    if (process.env.WS_PROXY_TOKEN) {
      this.envOverrides.proxyToken = process.env.WS_PROXY_TOKEN;
    }
    
    if (process.env.WORKBUSCAS_TOKEN) {
      this.envOverrides.workbuscasToken = process.env.WORKBUSCAS_TOKEN;
    }

    // SSL Configuration
    if (process.env.SSL_REJECT_UNAUTHORIZED === 'true') {
      this.config.security.ssl.rejectUnauthorized = true;
    } else if (process.env.SSL_REJECT_UNAUTHORIZED === 'false') {
      this.config.security.ssl.rejectUnauthorized = false;
    }

    // Logging
    if (process.env.LOG_LEVEL) {
      this.config.logging.level = process.env.LOG_LEVEL;
    }

    // Metrics
    if (process.env.METRICS_ENABLED === 'false') {
      this.config.metrics.enabled = false;
    }
  }

  /**
   * Retorna configuração padrão caso arquivo não exista
   */
  getDefaultConfig() {
    return {
      app: {
        name: "Central do Arranca",
        version: "1.5.1"
      },
      apis: {
        gemeos: {
          baseUrl: "https://dashboard.gemeosbrasil.me/api/ver-numeros",
          timeout: 15000,
          maxRetries: 3,
          rateLimit: { enabled: true, maxRequestsPerMinute: 60, retryAfterSeconds: 60 }
        },
        saude: {
          baseUrl: "https://api-saudediaria.entregadigital.app.br/api/v1/app/resetpassword",
          timeout: 15000,
          maxRetries: 3,
          rateLimit: { enabled: true, maxRequestsPerMinute: 60, retryAfterSeconds: 60 }
        },
        workbuscas: {
          baseUrl: "https://completa.workbuscas.com/api",
          timeout: 15000,
          rateLimit: { enabled: true, maxRequestsPerMinute: 60, retryAfterSeconds: 60 }
        }
      },
      proxies: {
        webshare: {
          apiUrl: "https://proxy.webshare.io/api/v2/proxy/list/",
          maxProxies: 1000,
          pageSize: 25,
          cacheExpiryHours: 24,
          testTimeout: 7000,
          testBatchSize: 10
        },
        useForeignOnly: false
      },
      checkers: {
        gemeos: { batchSize: 20, delay: 2000, timeout: 10000 },
        saude: { batchSize: 20, delay: 2000, timeout: 10000 },
        workbuscas: { delay: 2000, timeout: 15000 }
      },
      security: {
        ssl: {
          rejectUnauthorized: false,
          secureProtocol: "TLSv1_2_method"
        }
      },
      logging: {
        enabled: true,
        level: "info",
        format: "json",
        output: { console: true, file: true, filePath: "./logs/app.log" }
      },
      metrics: {
        enabled: true,
        collectionInterval: 5000,
        saveInterval: 60000,
        outputPath: "./logs/metrics.json"
      }
    };
  }

  /**
   * Obtém valor de configuração (com suporte a paths aninhados)
   * Exemplo: get('apis.gemeos.timeout')
   */
  get(path, defaultValue = null) {
    const keys = path.split('.');
    let value = this.config;

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return defaultValue;
      }
    }

    return value;
  }

  /**
   * Obtém token do proxy (prioridade: env > config padrão)
   */
  getProxyToken() {
    return this.envOverrides.proxyToken || process.env.WS_PROXY_TOKEN || 'qxew5x0zbdftbcsh63ql5flysll0jaf5u96msek9';
  }

  /**
   * Obtém token do WorkBuscas (prioridade: env > config padrão)
   */
  getWorkBuscasToken() {
    return this.envOverrides.workbuscasToken || process.env.WORKBUSCAS_TOKEN || 'kjvHiQNRxutJKrlFApVWhTcj';
  }

  /**
   * Retorna configuração completa
   */
  getAll() {
    return this.config;
  }
}

// Singleton
const configLoader = new ConfigLoader();

module.exports = configLoader;

