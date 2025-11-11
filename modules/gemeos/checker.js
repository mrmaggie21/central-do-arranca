/**
 * Central do Arranca - Gemeos Checker
 * Checker específico para a API Gemeos Brasil
 * Faz requisições para verificar CPFs na API Gemeos usando proxies da Webshare
 * Implementa fallback inteligente: proxy → sem proxy
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

class GemeosChecker {
  constructor(options = {}) {
    // Carrega configurações centralizadas
    this.config = configLoader.get('apis.gemeos') || {};
    this.checkerConfig = configLoader.get('checkers.gemeos') || {};
    this.proxyConfig = configLoader.get('proxies') || {};
    
    // Logger estruturado
    this.logger = new Logger('GEMEOS');
    
    // Rate limiter
    this.rateLimiter = new RateLimiter('gemeos');
    
    // Tokens via config loader (prioriza variáveis de ambiente)
    this.proxyApiToken = configLoader.getProxyToken();
    this.workbuscasToken = configLoader.getWorkBuscasToken();
    
    // URLs e configurações
    this.proxyApiUrl = this.proxyConfig.webshare?.apiUrl || 'https://proxy.webshare.io/api/v2/proxy/list/';
    this.workbuscasUrl = configLoader.get('apis.workbuscas.baseUrl') || 'https://completa.workbuscas.com/api';
    
    // Configuração do proxy rotate (SOCKS5)
    this.rotateConfig = this.proxyConfig.webshare?.rotate || {};
    this.useRotate = this.rotateConfig.enabled === true;
    
    this.proxies = [];
    this.brazilianProxies = []; // Proxies brasileiras separadas
    this.foreignProxies = []; // Proxies gringas separadas
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
    
    // Cache de proxies - módulo Gemeos
    const cacheConfig = configLoader.get('cache') || {};
    this.cacheDir = path.join(__dirname, '../../', cacheConfig.baseDir || '.cache');
    this.cacheFile = path.join(this.cacheDir, cacheConfig.proxies?.gemeos || 'proxies-gemeos.json');
    this.cacheExpiry = (this.proxyConfig.webshare?.cacheExpiryHours || 24) * 60 * 60 * 1000;
  }

  /**
   * Cria configurações SSL padrão para requisições
   * Agora usa configuração centralizada com suporte a variáveis de ambiente
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
      console.log('[DEBUG] saveToCache: ⏳ Escrevendo arquivo JSON...');
      await fs.writeJson(this.cacheFile, cacheData, { spaces: 2 });
      console.log(`[DEBUG] saveToCache: ✅✅✅ ARQUIVO ESCRITO! 💾 ${proxies.length} proxies salvos no cache`);
    } catch (error) {
      console.log('❌ Erro ao salvar cache:', error.message);
    }
  }

  /**
   * Filtra apenas proxies brasileiros
   */
  filterBrazilianProxies(proxies) {
    const brazilianProxies = proxies.filter(proxy => {
      return proxy.country_code === 'BR' || 
             proxy.country_code === 'br' || 
             proxy.country_code === 'Brazil' ||
             proxy.country_code === 'brazil' ||
             proxy.country_code === 'BRASIL' ||
             proxy.country_code === 'brasil';
    });
    
    console.log(`🇧🇷 Filtrados ${brazilianProxies.length}/${proxies.length} proxies brasileiros`);
    return brazilianProxies;
  }

  /**
   * Filtra proxies estrangeiros (não BR)
   */
  filterForeignProxies(proxies) {
    const isBR = (cc) => {
      if (!cc) return false;
      const v = String(cc).toLowerCase();
      return v === 'br' || v === 'brazil' || v === 'brasil';
    };
    const foreign = proxies.filter(p => !isBR(p.country_code));
    console.log(`🌍 Filtrados ${foreign.length}/${proxies.length} proxies estrangeiros`);
    return foreign;
  }

  /**
   * Testa um proxy específico
   */
  async testProxy(proxy) {
    try {
      // Testa no endpoint alvo com CPF inválido para validar JSON esperado
      const testConfig = {
        method: 'get',
        url: `https://dashboard.gemeosbrasil.me/api/ver-numeros?telefone=null&cpf=${encodeURIComponent('000.000.000-00')}&lojista=null`,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': this.getRandomUserAgent(),
          'accept': 'application/json, text/plain, */*',
          'accept-encoding': 'gzip, deflate, br, zstd',
          'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          'origin': 'https://www.gemeosbrasil.me',
          'referer': 'https://www.gemeosbrasil.me/'
        },
        timeout: testTimeout,
        ...this.getSSLConfig(),
        validateStatus: function (status) { return status >= 200 && status < 500; }
      };
      
      if (HttpsProxyAgent) {
        const authPart = proxy.username && proxy.password
          ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`
          : '';
        const proxyUrl = `http://${authPart}${proxy.proxy_address}:${proxy.port}`;
        testConfig.proxy = false;
        testConfig.httpsAgent = new HttpsProxyAgent.HttpsProxyAgent(proxyUrl);
      } else {
        testConfig.proxy = {
          host: proxy.proxy_address,
          port: proxy.port,
          auth: proxy.username && proxy.password ? {
            username: proxy.username,
            password: proxy.password
          } : undefined,
          protocol: 'http'
        };
      }
      
      const response = await axios(testConfig);
      const data = response.data;
      const isObj = typeof data === 'object' && data !== null;
      const hasComprasKey = isObj && (data.compras !== undefined || data.next !== undefined || data.result !== undefined);
      return isObj && hasComprasKey;
    } catch (error) {
      return false;
    }
  }

  /**
   * Testa múltiplos proxies em paralelo
   */
  async testProxies(proxies, progressCallback) {
    console.log(`🧪 Testando ${proxies.length} proxies...`);
    
    const batchSize = this.proxyConfig.webshare?.testBatchSize || 10;
    const validProxies = [];
    let testedCount = 0;
    
    for (let i = 0; i < proxies.length; i += batchSize) {
      const batch = proxies.slice(i, i + batchSize);
      
      const promises = batch.map(async (proxy) => {
        const isValid = await this.testProxy(proxy);
        testedCount++;
        
        // Atualiza progresso a cada proxy testado (mais frequente)
        if (progressCallback && testedCount % 50 === 0) {
          progressCallback(1000 + testedCount); // 1000+ indica fase de teste
        }
        
        return isValid ? proxy : null;
      });
      
      const batchResults = await Promise.all(promises);
      const validBatch = batchResults.filter(proxy => proxy !== null);
      validProxies.push(...validBatch);
      
      // Atualiza progresso a cada lote
      if (progressCallback) {
        progressCallback(1000 + testedCount); // 1000+ indica fase de teste
      }
      
      // Pequena pausa entre lotes
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    console.log(`✅ ${validProxies.length}/${proxies.length} proxies válidos encontrados`);
    return validProxies;
  }

  /**
   * Carrega proxies da API Webshare
   */
  async loadProxies(progressCallback) {
    console.log('[DEBUG] loadProxies chamado');
    console.log('[DEBUG] Cache válido?', this.isCacheValid());
    
    // Verifica cache primeiro
    if (this.isCacheValid()) {
      console.log('[DEBUG] Cache válido encontrado, tentando carregar...');
      const cachedProxies = this.loadFromCache();
      console.log(`[DEBUG] Proxies do cache: ${cachedProxies.length}`);
      
        if (cachedProxies.length > 0) {
        this.proxies = cachedProxies;
        console.log(`[DEBUG] ✅ Usando ${cachedProxies.length} proxies do cache`);
        // Quando carrega do cache, completa o progresso até 1000 para não travar a UI
        if (progressCallback) {
          console.log('[DEBUG] Chamando progressCallback com proxies do cache');
          progressCallback(cachedProxies.length);
          // Completa o progresso para não travar na splash
          setTimeout(() => {
            if (progressCallback) {
              console.log('[DEBUG] Completando progresso até 1000 para não travar UI');
              progressCallback(1000);
            }
          }, 100);
        }
        console.log(`[DEBUG] ✅✅✅ RETORNANDO ${this.proxies.length} proxies DO CACHE! ✅✅✅`);
        return this.proxies;
      } else {
        console.log('[DEBUG] Cache vazio, continuando para carregar da API');
      }
    } else {
      console.log('[DEBUG] Cache inválido ou não existe, carregando da API');
    }
    
    console.log('🔄 Carregando proxies da Webshare...');
    
    try {
      const allProxies = [];
      let page = 1;
      const pageSize = 25;
      
      while (true) {
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
        
        if (allProxies.length >= 1000) break;
        // Breve atraso para permitir visualização de progresso na splash/GUI
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      // Seleciona proxies conforme modo
      if (this.useForeignOnly) {
        console.log('🌍 Modo teste: usando apenas proxies estrangeiros (não BR)');
        this.proxies = this.filterForeignProxies(allProxies).slice(0, 1000);
      } else {
        console.log('🌍 Usando proxies globais da Webshare (sem filtro por país)');
        this.proxies = allProxies.slice(0, 1000);
      }
      
      // Separa proxies em brasileiras e gringas para estratégia de tentativas
      this.brazilianProxies = this.filterBrazilianProxies(this.proxies);
      this.foreignProxies = this.filterForeignProxies(this.proxies);
      console.log(`🇧🇷 ${this.brazilianProxies.length} proxies brasileiras | 🌍 ${this.foreignProxies.length} proxies gringas`);
      
      // SEMPRE filtra/testa proxies BR antes de iniciar (obrigatório)
      if (this.brazilianProxies.length > 0) {
        console.log('🧪 SEMPRE filtrando proxies brasileiras antes de iniciar...');
        const brSampleSize = Math.min(30, this.brazilianProxies.length);
        const brSample = this.brazilianProxies.slice(0, brSampleSize);
        const validBR = await this.testProxies(brSample, null);
        const brValidRate = validBR.length / brSampleSize;
        
        console.log(`📊 Taxa de validade BR: ${(brValidRate * 100).toFixed(1)}% (${validBR.length}/${brSampleSize})`);
        
        // Se taxa de validade BR for muito baixa, remove as inválidas
        if (brValidRate < 0.5) {
          console.log(`⚠️ Taxa de validade BR baixa (${(brValidRate * 100).toFixed(1)}%), filtrando proxies inválidas...`);
          // Mantém apenas as válidas testadas + as não testadas
          const validBRAddresses = new Set(validBR.map(p => `${p.proxy_address}:${p.port}`));
          this.brazilianProxies = this.brazilianProxies.filter(p => {
            const addr = `${p.proxy_address}:${p.port}`;
            // Mantém se foi testada e é válida, ou se não foi testada ainda
            return validBRAddresses.has(addr) || !brSample.some(sp => `${sp.proxy_address}:${sp.port}` === addr);
          });
          console.log(`✅ ${this.brazilianProxies.length} proxies BR válidas após filtro`);
        } else {
          console.log(`✅ Taxa de validade BR boa - mantendo todas as ${this.brazilianProxies.length} proxies BR`);
        }
      } else {
        console.log('⚠️ Nenhuma proxy BR encontrada para filtrar');
      }
      
      // Opção: pular teste de proxies na inicialização (muito lento)
      // O teste pode ser feito depois, durante o uso
      const skipTestConfig = configLoader.get('proxies.skipTestOnLoad');
      const skipTestEnv = process.env.SKIP_PROXY_TEST === 'true';
      const skipProxyTest = skipTestConfig === true || skipTestEnv === true;
      
      console.log('[DEBUG] Configuração de teste de proxies:');
      console.log('  - config.proxies.skipTestOnLoad:', skipTestConfig);
      console.log('  - env.SKIP_PROXY_TEST:', process.env.SKIP_PROXY_TEST);
      console.log('  - skipProxyTest (resultado):', skipProxyTest);
      console.log(`  - Proxies carregados: ${this.proxies.length}`);
      
      if (skipProxyTest) {
        console.log('⚡ Teste de proxies PULADO na inicialização (configurado para pular)');
        console.log(`✅ ${this.proxies.length} proxies carregados (não testados - serão testados durante uso)`);
        // Usa todos os proxies sem testar (serão testados em uso real)
        if (progressCallback) {
          console.log('[DEBUG] Chamando progressCallback(1000) para completar progresso');
          progressCallback(1000); // Completa o progresso
        }
        // Salva no cache e retorna IMEDIATAMENTE
        console.log('[DEBUG] ⏳ Iniciando saveToCache...');
        await this.saveToCache(this.proxies);
        console.log('[DEBUG] ✅ saveToCache concluído!');
        console.log(`[DEBUG] ✅✅✅ RETORNANDO ${this.proxies.length} proxies AGORA! ✅✅✅`);
        return this.proxies;
      } else {
        // Notifica início do teste de proxies
        if (progressCallback) {
          progressCallback(1000); // Marca que terminou carregamento e inicia teste
        }
        console.log('🧪 Testando proxies (isso pode levar alguns minutos)...');
        
        // Testa apenas uma amostra de proxies para validar conexão
        // Não testa todos para não travar a inicialização
        const sampleSize = Math.min(50, this.proxies.length); // Testa apenas 50 primeiros
        const sampleProxies = this.proxies.slice(0, sampleSize);
        console.log(`🧪 Testando amostra de ${sampleSize} proxies (para não travar)...`);
        
        const validSample = await this.testProxies(sampleProxies, progressCallback);
        const validRate = validSample.length / sampleSize;
        
        console.log(`📊 Taxa de validade: ${(validRate * 100).toFixed(1)}% (${validSample.length}/${sampleSize})`);
        
        // Se a taxa for muito baixa (< 10%), usa todos mesmo
        if (validRate < 0.1) {
          console.log('⚠️ Taxa de validade muito baixa, usando todos os proxies sem filtro');
          // Mantém todos os proxies
        } else {
          console.log('✅ Taxa de validade aceitável, usando todos os proxies');
          // Mantém todos os proxies mesmo assim (teste completo seria muito lento)
        }
        
        if (progressCallback) {
          progressCallback(1000); // Completa o progresso
        }
      }
      
      // Salva no cache
      console.log('[DEBUG] ⏳ Iniciando saveToCache (depois do teste)...');
      await this.saveToCache(this.proxies);
      console.log('[DEBUG] ✅ saveToCache concluído (depois do teste)!');
      console.log(`[DEBUG] ✅✅✅ RETORNANDO ${this.proxies.length} proxies AGORA (depois do teste)! ✅✅✅`);
      
      return this.proxies;
      
    } catch (error) {
      console.log('❌ Erro ao carregar proxies:', error.message);
      
      // Fallback para cache mesmo expirado
      const cachedProxies = this.loadFromCache();
      if (cachedProxies.length > 0) {
        console.log('📦 Usando cache expirado como fallback');
        this.proxies = cachedProxies;
        return this.proxies;
      }
      
      throw error;
    }
  }

  /**
   * Obtém um proxy aleatório
   */
  getRandomProxy() {
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
      } : undefined
    };
  }

  /**
   * Retorna uma proxy gringa aleatória
   */
  getRandomForeignProxy() {
    if (!this.foreignProxies || this.foreignProxies.length === 0) {
      return null;
    }
    const randomIndex = Math.floor(Math.random() * this.foreignProxies.length);
    const proxy = this.foreignProxies[randomIndex];
    return {
      host: proxy.proxy_address,
      port: proxy.port,
      auth: proxy.username && proxy.password ? {
        username: proxy.username,
        password: proxy.password
      } : undefined
    };
  }

  /**
   * Retorna uma proxy brasileira aleatória
   */
  getRandomBrazilianProxy() {
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
    
    if (!this.brazilianProxies || this.brazilianProxies.length === 0) {
      return null;
    }
    const randomIndex = Math.floor(Math.random() * this.brazilianProxies.length);
    const proxy = this.brazilianProxies[randomIndex];
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
   * Detecta se a resposta é um bloqueio do Cloudflare
   */
  detectCloudflareBlock(response) {
    // Verifica headers do Cloudflare
    const headers = response.headers || {};
    const hasCloudflareHeaders = headers['cf-ray'] || headers['cf-request-id'] || 
                                  (headers['server'] && headers['server'].toLowerCase().includes('cloudflare'));
    
    if (hasCloudflareHeaders) {
      return true;
    }
    
    // Verifica se a resposta é HTML (Cloudflare geralmente retorna HTML)
    if (typeof response.data === 'string') {
      const dataLower = response.data.toLowerCase();
      const cloudflareIndicators = [
        'checking your browser',
        'just a moment',
        'cloudflare',
        'ddos protection',
        'ray id',
        'cf-ray',
        'please wait',
        'access denied'
      ];
      
      if (cloudflareIndicators.some(indicator => dataLower.includes(indicator))) {
        return true;
      }
    }
    
    // Status 403 ou 429 com proxy geralmente é Cloudflare
    if ((response.status === 403 || response.status === 429) && response.config?.proxy) {
      return true;
    }
    
    return false;
  }

  /**
   * Faz requisição para a API (com ou sem proxy)
   * Agora com logs estruturados, métricas e rate limiting
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
          
          // Log apenas a cada 10 iterações para não poluir
          if (waitCount % 10 === 1 || waitCount === 1) {
            // Log silencioso - apenas para debug se necessário
          }
          
          // Aguarda o tempo necessário
          if (rateLimitCheck.waitSeconds && rateLimitCheck.waitSeconds > 0) {
            // Aguarda o tempo indicado, mas no máximo 5 segundos por vez para poder verificar novamente
            const waitTime = Math.min(rateLimitCheck.waitSeconds * 1000, 5000);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          } else {
            // Se não há waitSeconds, aguarda 1 segundo e verifica novamente
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          
          // Verifica novamente após esperar
          rateLimitCheck = this.rateLimiter.canMakeRequest();
        }
        
        // Registra a requisição ANTES de fazer (importante para evitar múltiplas simultâneas)
        this.rateLimiter.recordRequest();
      } else {
        // Com proxy mas rate limit ativo - apenas registra (não bloqueia preventivamente)
        this.rateLimiter.recordRequest();
      }
      
      const baseUrl = this.config.baseUrl || 'https://dashboard.gemeosbrasil.me/api/ver-numeros';
      const axiosConfig = {
        method: 'get',
        url: `${baseUrl}?telefone=null&cpf=${encodeURIComponent(cpf)}&lojista=null`,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': this.getRandomUserAgent(),
          'accept': 'application/json, text/plain, */*',
          'accept-encoding': 'gzip, deflate, br, zstd',
          'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          'origin': 'https://www.gemeosbrasil.me',
          'referer': 'https://www.gemeosbrasil.me/'
        },
        timeout: this.timeout,
        ...this.getSSLConfig(),
        validateStatus: function (status) {
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
              console.log(`[Gemeos] 🔄 Usando proxy rotate SOCKS5: ${proxy.host}:${proxy.port}`);
            } catch (socksError) {
              console.error(`[Gemeos] ❌ Erro ao configurar proxy SOCKS5:`, socksError.message);
              // Se falhar SOCKS5 e tryHttp estiver ativo, tenta HTTP
              if (proxy.tryHttp && HttpsProxyAgent) {
                console.log(`[Gemeos] ⚠️ SOCKS5 falhou, tentando HTTP...`);
                const httpProxyUrl = `http://${authPart}${proxy.host}:${proxy.port}`;
                axiosConfig.httpsAgent = new HttpsProxyAgent.HttpsProxyAgent(httpProxyUrl);
                console.log(`[Gemeos] 🔄 Usando proxy rotate HTTP: ${proxy.host}:${proxy.port}`);
              } else {
                throw new Error(`Erro ao configurar proxy SOCKS5: ${socksError.message}`);
              }
            }
          } else if (HttpsProxyAgent) {
            // Usa HTTP diretamente se não for SOCKS5
            const httpProxyUrl = `http://${authPart}${proxy.host}:${proxy.port}`;
            axiosConfig.proxy = false;
            axiosConfig.httpsAgent = new HttpsProxyAgent.HttpsProxyAgent(httpProxyUrl);
            console.log(`[Gemeos] 🔄 Usando proxy rotate HTTP: ${proxy.host}:${proxy.port}`);
          } else {
            // Fallback para objeto proxy
            axiosConfig.proxy = {
              host: proxy.host,
              port: proxy.port,
              auth: proxy.auth,
              protocol: 'http'
            };
            console.log(`[Gemeos] 🔄 Usando proxy rotate (fallback): ${proxy.host}:${proxy.port}`);
          }
        } else if (HttpsProxyAgent) {
          // Proxy HTTP normal
          const authPart = proxy.auth && proxy.auth.username && proxy.auth.password
            ? `${encodeURIComponent(proxy.auth.username)}:${encodeURIComponent(proxy.auth.password)}@`
            : '';
          const proxyUrl = `http://${authPart}${proxy.host}:${proxy.port}`;
          axiosConfig.proxy = false; // usar agent em vez do objeto proxy
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
      
      // IMPORTANTE: Verifica status 402/403 PRIMEIRO (antes de qualquer processamento)
      // Status 402 = limite de banda da proxy ou bloqueio
      if (response.status === 402 || response.status === 403) {
        const duration = Date.now() - startTime;
        metrics.recordRequest('gemeos', false, duration, response.status);
        
        // Verifica se a resposta é string indicando limite de banda
        const responseText = typeof response.data === 'string' ? response.data.toLowerCase() : '';
        const isBandwidthLimit = responseText.includes('bandwidth limit') || responseText.includes('bandwidth reached');
        
        // Remove proxy se tiver
        if (proxy) {
          this.proxies = this.proxies.filter(p => !(p.proxy_address === proxy.host && p.port === proxy.port));
          this.brazilianProxies = this.brazilianProxies.filter(p => !(p.proxy_address === proxy.host && p.port === proxy.port));
        }
        
        // Retorna como erro para forçar tentativa com outra proxy ou sem proxy
        return {
          cpf: cpf,
          success: false,
          error: isBandwidthLimit ? 'Status 402 - Limite de banda da proxy atingido' : `Status ${response.status} - Proxy/Cloudflare bloqueado`,
          status: response.status,
          proxy: proxy ? `${proxy.host}:${proxy.port}` : 'Sem Proxy'
        };
      }
      
      // Detecta bloqueio do Cloudflare ANTES de processar a resposta
      // MAS só se a resposta não for JSON válido com dados
      let dataIsObject = typeof response.data === 'object' && response.data !== null;
      const hasValidData = dataIsObject && (
        response.data.compras !== undefined ||
        response.data.result !== undefined ||
        response.data.user !== undefined
      );
      
      // Só detecta Cloudflare se NÃO tiver dados válidos
      const isCloudflareBlocked = !hasValidData && this.detectCloudflareBlock(response);
      if (isCloudflareBlocked && proxy) {
        console.log('[Gemeos] 🛡️ Cloudflare bloqueou a proxy - tentando sem proxy...');
        const duration = Date.now() - startTime;
        metrics.recordRequest('gemeos', false, duration, response.status);
        await this.logger.warn('Cloudflare bloqueou proxy', {
          cpf,
          status: response.status,
          proxy: `${proxy.host}:${proxy.port}`,
          duration
        });
        
        // Remove proxy problemática (só se não for rotate)
        if (!proxy.isRotate) {
          this.proxies = this.proxies.filter(p => !(p.proxy_address === proxy.host && p.port === proxy.port));
          this.brazilianProxies = this.brazilianProxies.filter(p => !(p.proxy_address === proxy.host && p.port === proxy.port));
        }
        
        // Retorna como erro para forçar tentativa sem proxy
        return {
          cpf: cpf,
          success: false,
          error: 'Cloudflare bloqueou a proxy',
          status: response.status,
          proxy: `${proxy.host}:${proxy.port}`
        };
      }
      
      // Normaliza resposta: tenta parsear JSON mesmo se content-type vier errado
      const contentType = (response.headers && (response.headers['content-type'] || response.headers['Content-Type'])) || '';
      if (typeof response.data === 'string') {
        const trimmed = response.data.trim();
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
          try {
            response.data = JSON.parse(trimmed);
            // Recalcula dataIsObject após parsear JSON
            dataIsObject = typeof response.data === 'object' && response.data !== null;
          } catch (_) {
            // segue abaixo para marcar como desconhecida
          }
        }
      }
      // Recalcula dataIsObject após normalização (caso não tenha sido recalculado acima)
      dataIsObject = typeof response.data === 'object' && response.data !== null;
      if (!dataIsObject) {
        // Se não é JSON e tem proxy, pode ser Cloudflare
        if (proxy && (response.status === 403 || response.status === 429)) {
          console.log('[Gemeos] ⚠️ Resposta não-JSON com status ' + response.status + ' - possível bloqueio do Cloudflare');
          const duration = Date.now() - startTime;
          metrics.recordRequest('gemeos', false, duration, response.status);
          await this.logger.warn('Resposta não-JSON - possível bloqueio', {
            cpf,
            status: response.status,
            proxy: `${proxy.host}:${proxy.port}`,
            duration
          });
          
          // Remove proxy problemática
          this.proxies = this.proxies.filter(p => !(p.proxy_address === proxy.host && p.port === proxy.port));
          
          return {
            cpf: cpf,
            success: false,
            error: 'Resposta inválida - possível bloqueio do Cloudflare',
            status: response.status,
            proxy: `${proxy.host}:${proxy.port}`
          };
        }
        
        // Trata resposta não-JSON como não cadastrado, sem poluir logs
        const result = {
          cpf: cpf,
          success: true,
          status: response.status,
          data: null,
          proxy: proxy ? `${proxy.host}:${proxy.port}` : 'Sem Proxy',
          interpretation: 'not_registered',
          timestamp: new Date().toISOString()
        };
        this.unregisteredCount++;
        this.successCount++;
        return result;
      }

      // Status 402/403 já foi verificado acima, não precisa verificar novamente aqui

      const result = {
        cpf: cpf,
        success: true,
        status: response.status,
        data: response.data,
        proxy: proxy ? `${proxy.host}:${proxy.port}` : 'Sem Proxy'
      };

      // Tratamento de rate limit (mensagem em PT-BR)
      // IMPORTANTE: Só marca como rate limit se realmente for status 429 ou mensagem explícita
      // Não marca como rate limit se for apenas status 400 sem mensagem clara
      try {
        const payloadText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data || {});
        const isRateLimited = response.status === 429 || (
          typeof response.data === 'string' && (
            /excedeu o limite|limite de consultas|rate limit|too many requests/i.test(payloadText)
          )
        );
        
        if (isRateLimited) {
          const duration = Date.now() - startTime;
          // NOTA: recordRequest() já foi chamado ANTES da requisição
          await this.rateLimiter.handleRateLimit(duration);
          
          metrics.recordRequest('gemeos', false, duration, 429);
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
      } catch (_) {}

      // Interpretação do retorno da nova rota (dashboard.gemeosbrasil.me)
      try {
        const payload = response.data;
        
        // DEBUG: Log da resposta para diagnóstico (apenas se necessário)
        // Removido logs excessivos para melhorar performance
        
        const compras = payload?.compras;
        const isRegistered = Array.isArray(compras) && compras.length > 0;
        
        // Verifica também outros campos que podem indicar registro
        // Algumas APIs retornam objetos vazios ou estruturas diferentes
        const hasData = payload && typeof payload === 'object';
        const hasComprasKey = compras !== undefined;
        const hasUser = payload?.user !== undefined || (Array.isArray(compras) && compras.some(c => c?.user));
        
        // Verifica se há outros campos que podem indicar registro
        const hasNext = payload?.next !== undefined;
        const hasResult = payload?.result !== undefined;
        const resultValue = payload?.result;
        const hasDataKey = payload?.data !== undefined;
        const hasMessage = payload?.message !== undefined;
        
        // IMPORTANTE: Campo "result" indica registro (1 = registrado, 0 = não registrado)
        // Se result === 1, mesmo sem compras, o CPF está registrado
        // Usa uma flag para evitar contagem duplicada
        let alreadyCounted = false;
        
        if (isRegistered) {
          // Caso 1: Tem compras (registrado)
          this.registeredCount++;
          alreadyCounted = true;
          result.interpretation = 'registered';
          result.products = { success: true, data: compras, count: compras.length };
          // Dados úteis do primeiro registro (telefone mascarado, hashes)
          const first = compras[0];
          if (first?.user) {
            result.user = {
              id: first.user.id,
              nome: first.user.nome,
              telefone: first.user.telefone,
              email_hash: first.user.hash?.email,
              phone_hash: first.user.hash?.phone,
              phone_plus_hash: first.user.hash?.phone_plus
            };
          }
          console.log('[Gemeos] ✅ CPF REGISTRADO - compras encontradas:', compras.length);
        } else if (hasResult && resultValue === 1) {
          // Caso 2: result === 1 mas sem compras (ainda registrado)
          console.log('[Gemeos] ⚠️ Campo "result" = 1 indica registro, mas sem compras - verificando outros dados...');
          const userData = payload.user || (Array.isArray(compras) && compras.length > 0 ? compras[0]?.user : null);
          if (userData || hasNext || hasComprasKey) {
            this.registeredCount++;
            alreadyCounted = true;
            result.interpretation = 'registered';
            result.products = { success: true, data: compras || [], count: Array.isArray(compras) ? compras.length : 0 };
            if (userData) {
              result.user = {
                id: userData.id,
                nome: userData.nome,
                telefone: userData.telefone,
                email_hash: userData.hash?.email,
                phone_hash: userData.hash?.phone,
                phone_plus_hash: userData.hash?.phone_plus
              };
            }
            console.log('[Gemeos] ✅ CPF REGISTRADO - campo "result" = 1 indica registro');
          }
        } else if (hasData && hasComprasKey && hasUser) {
          // Caso 3: Tem dados de usuário mas sem compras (pode estar registrado)
          console.log('[Gemeos] ⚠️ CPF pode estar registrado mas sem compras - verificando dados de usuário...');
          const userData = payload.user || (Array.isArray(compras) && compras.length > 0 ? compras[0]?.user : null);
          if (userData) {
            this.registeredCount++;
            alreadyCounted = true;
            result.interpretation = 'registered';
            result.products = { success: true, data: compras || [], count: Array.isArray(compras) ? compras.length : 0 };
            result.user = {
              id: userData.id,
              nome: userData.nome,
              telefone: userData.telefone,
              email_hash: userData.hash?.email,
              phone_hash: userData.hash?.phone,
              phone_plus_hash: userData.hash?.phone_plus
            };
            console.log('[Gemeos] ✅ CPF REGISTRADO - dados de usuário encontrados');
          }
        }
        
        // Se não foi contado como registrado, conta como não registrado
        if (!alreadyCounted) {
          this.unregisteredCount++;
          result.interpretation = 'not_registered';
          if (hasResult && resultValue === 0) {
            console.log('[Gemeos] ❌ CPF NÃO CADASTRADO - campo "result" = 0');
          } else {
            console.log('[Gemeos] ❌ CPF NÃO CADASTRADO - sem indicadores de registro');
          }
        }
      } catch (error) {
        // Fallback conservador
        console.error('[Gemeos] ❌ Erro ao interpretar resposta:', error.message);
        this.unregisteredCount++;
        result.interpretation = 'not_registered';
      }

      result.timestamp = new Date().toISOString();

      this.successCount++;
      
      // Registra métricas e logs
      // NOTA: recordRequest() já foi chamado ANTES da requisição para evitar múltiplas simultâneas
      const duration = Date.now() - startTime;
      this.rateLimiter.recordSuccess();
      metrics.recordRequest('gemeos', true, duration, result.status);
      
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
      // NOTA: recordRequest() já foi chamado ANTES da requisição para evitar múltiplas simultâneas
      
      // Verifica se é rate limit
      if (error.response?.status === 429) {
        await this.rateLimiter.handleRateLimit(duration);
        metrics.recordRequest('gemeos', false, duration, 429);
        await this.logger.warn('Rate limit (429) na requisição', {
          cpf,
          duration,
          proxy: proxy ? `${proxy.host}:${proxy.port}` : 'Sem Proxy'
        });
      } else if (error.response?.status === 402 || error.message?.includes('402')) {
        // Status 402 = Payment Required (geralmente bloqueio de proxy)
        console.log('[Gemeos] ⚠️ Status 402 detectado - proxy pode estar bloqueada');
        metrics.recordRequest('gemeos', false, duration, 402);
        await this.logger.warn('Status 402 (Payment Required) - possível bloqueio de proxy', {
          cpf,
          duration,
          proxy: proxy ? `${proxy.host}:${proxy.port}` : 'Sem Proxy'
        });
        // Propaga o erro para que o código tente sem proxy
        throw error;
      } else {
        metrics.recordRequest('gemeos', false, duration, error.response?.status || 0);
        await this.logger.error('Erro ao fazer requisição', {
          cpf,
          error: error.message,
          status: error.response?.status || 0,
          duration,
          proxy: proxy ? `${proxy.host}:${proxy.port}` : 'Sem Proxy'
        });
      }
      
      if (error.response && error.response.status === 400) {
        try {
          const payload = error.response.data;
          
          // DEBUG: Log da resposta de erro 400
          console.log('[Gemeos] DEBUG - Erro 400, payload:', JSON.stringify(payload, null, 2));
          
          const compras = payload?.compras;
          const isRegistered = Array.isArray(compras) && compras.length > 0;
          const resultValue = payload?.result;
          
          // Verifica também outros indicadores
          const hasUser = payload?.user !== undefined || (Array.isArray(compras) && compras.some(c => c?.user));
          
          const result = {
            cpf: cpf,
            success: true,
            status: 400,
            data: payload,
            proxy: proxy ? `${proxy.host}:${proxy.port}` : 'Sem Proxy'
          };
          
          // IMPORTANTE: Campo "result" indica registro (1 = registrado, 0 = não registrado)
          // Se result === 1, mesmo sem compras, o CPF está registrado
          if (resultValue === 1 && !isRegistered) {
            console.log('[Gemeos] ⚠️ Campo "result" = 1 indica registro (erro 400), mas sem compras - verificando outros dados...');
            const userData = payload.user || (Array.isArray(compras) && compras.length > 0 ? compras[0]?.user : null);
            if (userData || payload?.next !== undefined || compras !== undefined) {
              this.registeredCount++;
              result.interpretation = 'registered';
              result.products = { success: true, data: compras || [], count: Array.isArray(compras) ? compras.length : 0 };
              if (userData) {
                result.user = {
                  id: userData.id,
                  nome: userData.nome,
                  telefone: userData.telefone,
                  email_hash: userData.hash?.email,
                  phone_hash: userData.hash?.phone,
                  phone_plus_hash: userData.hash?.phone_plus
                };
              }
              console.log('[Gemeos] ✅ CPF REGISTRADO (erro 400) - campo "result" = 1 indica registro');
              result.timestamp = new Date().toISOString();
              this.successCount++;
              return result;
            }
          }
          
          if (isRegistered) {
            this.registeredCount++;
            result.interpretation = 'registered';
            result.products = { success: true, data: compras, count: compras.length };
            
            // Extrai dados do usuário
            const first = compras[0];
            if (first?.user) {
              result.user = {
                id: first.user.id,
                nome: first.user.nome,
                telefone: first.user.telefone,
                email_hash: first.user.hash?.email,
                phone_hash: first.user.hash?.phone,
                phone_plus_hash: first.user.hash?.phone_plus
              };
            }
            
            console.log('[Gemeos] ✅ CPF REGISTRADO (erro 400) - compras encontradas:', compras.length);
          } else if (hasUser) {
            // Mesmo sem compras, se tem dados de usuário, pode estar registrado
            const userData = payload.user || (Array.isArray(compras) && compras.length > 0 ? compras[0]?.user : null);
            if (userData) {
              this.registeredCount++;
              result.interpretation = 'registered';
              result.products = { success: true, data: compras || [], count: Array.isArray(compras) ? compras.length : 0 };
              result.user = {
                id: userData.id,
                nome: userData.nome,
                telefone: userData.telefone,
                email_hash: userData.hash?.email,
                phone_hash: userData.hash?.phone,
                phone_plus_hash: userData.hash?.phone_plus
              };
              console.log('[Gemeos] ✅ CPF REGISTRADO (erro 400) - dados de usuário encontrados');
            } else {
              this.unregisteredCount++;
              result.interpretation = 'not_registered';
              console.log('[Gemeos] ❌ CPF NÃO CADASTRADO (erro 400)');
            }
          } else {
            this.unregisteredCount++;
            result.interpretation = 'not_registered';
            console.log('[Gemeos] ❌ CPF NÃO CADASTRADO (erro 400)');
          }
          
          result.timestamp = new Date().toISOString();
          this.successCount++;
          return result;
        } catch (parseError) {
          console.error('[Gemeos] ❌ Erro ao parsear resposta de erro 400:', parseError.message);
          // continua para retorno de erro padrão
        }
      }
      this.errorCount++;
      
      // Se for proxy rotate e erro de conexão, adiciona informação útil
      const errorMessage = proxy && proxy.isRotate && (!error.response || error.response.status === 0)
        ? `Erro de conexão com proxy rotate SOCKS5: ${error.message}`
        : error.message;
      
      return {
        cpf: cpf,
        success: false,
        error: errorMessage,
        status: error.response?.status || 0,
        proxy: proxy ? `${proxy.host}:${proxy.port}` : 'Sem Proxy'
      };
    }
  }

  /**
   * Consulta dados complementares na API WorkBuscas
   * Retorna: telefone, email, renda, score, nome da mãe e data de nascimento
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
        telefone: null,
        telefones: [], // Array com todos os telefones
        email: null,
        renda: null,
        score: null,
        nomeMae: null,
        dataNascimento: null,
        rg: null,
        rgDataEmissao: null,
        rgOrgaoEmissor: null,
        rgUfEmissao: null
      };

      // Telefones (pega todos os telefones disponíveis)
      if (data.telefones && Array.isArray(data.telefones) && data.telefones.length > 0) {
        workbuscasData.telefones = data.telefones.map(t => ({
          numero: t.telefone || null,
          operadora: t.operadora || null,
          tipo: t.tipo || null,
          status: t.status || null,
          whatsapp: t.whatsapp || null
        })).filter(t => t.numero !== null); // Remove telefones sem número
        
        // Mantém compatibilidade: primeiro telefone como telefone principal
        if (workbuscasData.telefones.length > 0) {
          workbuscasData.telefone = workbuscasData.telefones[0].numero;
        }
      }

      // Email (pega o primeiro disponível)
      if (data.emails && Array.isArray(data.emails) && data.emails.length > 0) {
        workbuscasData.email = data.emails[0].email || null;
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

      // Nome da mãe e data de nascimento (DadosBasicos)
      if (data.DadosBasicos) {
        if (data.DadosBasicos.nomeMae) {
          workbuscasData.nomeMae = data.DadosBasicos.nomeMae;
        }
        if (data.DadosBasicos.dataNascimento) {
          workbuscasData.dataNascimento = data.DadosBasicos.dataNascimento;
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

      // Verifica se pelo menos um dado foi extraído
      const hasData = Object.values(workbuscasData).some(v => v !== null);
      if (!hasData) {
        console.warn(`[WorkBuscas] Nenhum dado extraído para CPF ${cpf}`);
        return null;
      }
      
      return workbuscasData;
    } catch (error) {
      // Em caso de erro, retorna null silenciosamente (não é crítico)
      console.warn(`[WorkBuscas] Erro ao consultar CPF ${cpf}:`, error.message);
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
      let rateLimitDetected = false;

      // ESTRATÉGIA: SEMPRE tenta com proxy BR primeiro, se der rate limit tenta sem proxy
      // Fase 1: SEMPRE tenta com proxy BR primeiro (até 5 tentativas) - proxies já filtradas
      // Se usar rotate, mostra informação sobre rotate; caso contrário, mostra proxies BR
      const proxyInfo = this.useRotate && this.brazilianProxies.length === 0 
        ? 'proxy ROTATE (SOCKS5)' 
        : `${this.brazilianProxies.length} proxies BR`;
      console.log(`[Gemeos] 🇧🇷 Tentando SOMENTE com ${proxyInfo} primeiro...`);
      
      if (this.brazilianProxies.length === 0) {
        console.log('[Gemeos] ⚠️ Nenhuma proxy BR disponível - recarregando filtro...');
        // Tenta recarregar do cache ou usar todas as proxies BR sem filtro
        const allProxies = this.proxies || [];
        this.brazilianProxies = this.filterBrazilianProxies(allProxies);
        console.log(`[Gemeos] 🇧🇷 ${this.brazilianProxies.length} proxies BR encontradas após recarregar`);
      }
      
      // SEMPRE tenta com proxy BR primeiro (mesmo que tenha poucas)
      let brAttempts = 0;
      // Se usar rotate E não tiver proxies BR individuais, usa rotate
      // Caso contrário, prioriza proxies BR individuais
      const shouldUseRotate = this.useRotate && this.brazilianProxies.length === 0;
      const maxAttempts = shouldUseRotate ? 5 : (this.brazilianProxies.length > 0 ? 5 : 0);
      
      while (brAttempts < maxAttempts && !rateLimitDetected) {
        // Se tem proxies BR individuais, usa elas. Se não, usa rotate
        if (shouldUseRotate) {
          usedProxy = this.getRandomBrazilianProxy(); // Retorna rotate se não tiver BR
        } else {
          // Prioriza proxies BR individuais
          if (this.brazilianProxies.length > 0) {
            const randomIndex = Math.floor(Math.random() * this.brazilianProxies.length);
            const proxy = this.brazilianProxies[randomIndex];
            usedProxy = {
              host: proxy.proxy_address,
              port: proxy.port,
              auth: proxy.username && proxy.password ? {
                username: proxy.username,
                password: proxy.password
              } : undefined,
              isRotate: false
            };
          } else {
            usedProxy = this.getRandomBrazilianProxy(); // Fallback para rotate se não tiver BR
          }
        }
        
        if (!usedProxy) {
          console.log('[Gemeos] ⚠️ Não conseguiu obter proxy BR, tentando sem proxy...');
          break;
        }
        
        if (usedProxy.isRotate) {
          console.log(`[Gemeos] 🔄 Tentativa ${brAttempts + 1}/5 com proxy ROTATE (pode não ser BR): ${usedProxy.host}:${usedProxy.port}`);
        } else {
          console.log(`[Gemeos] 🇧🇷 Tentativa ${brAttempts + 1}/5 com proxy BR: ${usedProxy.host}:${usedProxy.port}`);
        }
        result = await this.makeAPIRequest(cpf, usedProxy);
        
        if (result.success) {
          console.log('[Gemeos] ✅ Sucesso com proxy brasileira!');
          break;
        }

          const err = String(result.error || '');
          const isTimeout = /timeout|ETIMEDOUT|ECONNABORTED|Network/i.test(err);
          const isUnknown = /unknown_response|non_json|html/i.test(err);
          const isRateLimited = /rate_limited/i.test(err) || result.status === 429;
          const isNetworkStatus = !result.status || result.status === 0;
          const is402 = result.status === 402 || /402|Payment Required|Bandwidth limit/i.test(err);
          const is403 = result.status === 403 || /403|Forbidden/i.test(err);
          const isCloudflare = /cloudflare|cf-ray|checking your browser/i.test(err);
          const isBlocked = is402 || is403 || isCloudflare;
          const is400WithoutData = result.status === 400 && !result.data && !result.interpretation;

          // Remove proxy se tiver problemas (402 = limite de banda da proxy, remove e tenta outra)
          // NÃO remove proxy rotate (não está na lista de proxies BR)
          if (usedProxy && !usedProxy.isRotate && (isTimeout || isUnknown || isNetworkStatus || isBlocked)) {
            console.log(`[Gemeos] Removendo proxy BR problemática: ${usedProxy.host}:${usedProxy.port} (status: ${result.status})`);
            this.brazilianProxies = this.brazilianProxies.filter(p => !(p.proxy_address === usedProxy.host && p.port === usedProxy.port));
            this.proxies = this.proxies.filter(p => !(p.proxy_address === usedProxy.host && p.port === usedProxy.port));
          } else if (usedProxy && usedProxy.isRotate && (isTimeout || isUnknown || isNetworkStatus || isBlocked)) {
            console.log(`[Gemeos] ⚠️ Proxy rotate com problema (status: ${result.status}) - não removendo (é rotate)`);
          }

          lastError = err || `Status ${result.status}`;
          brAttempts++;
          
          // Se 402 (limite de banda da proxy), tenta outra proxy BR (não vai para sem proxy ainda)
          if (is402) {
            console.log('[Gemeos] ⚠️ Status 402 (limite de banda da proxy) - tentando outra proxy BR...');
            continue; // Continua tentando outras proxies BR
          }
          
          // Se rate limit da API (429), PARA e tenta sem proxy
          if (isRateLimited) {
            console.log('[Gemeos] ⚠️ Rate limit da API (429) detectado com proxy BR - parando tentativas com proxy e tentando SEM PROXY...');
            rateLimitDetected = true;
            break;
          }
          
          // Se status 400 sem dados e sem interpretation, pode ser rate limit disfarçado
          if (is400WithoutData) {
            console.log('[Gemeos] ⚠️ Status 400 sem dados válidos - pode ser rate limit, tentando outra proxy BR...');
            continue; // Tenta outra proxy BR primeiro
          }
          
          // Se bloqueado (403/Cloudflare), continua tentando outras proxies BR
          if (isBlocked && !is402) {
            console.log('[Gemeos] ⚠️ Proxy BR bloqueada (403/Cloudflare), tentando outra proxy BR...');
            continue;
          }
      }
      
      if (this.brazilianProxies.length === 0 && brAttempts > 0) {
        console.log('[Gemeos] ⚠️ Todas as proxies BR foram removidas após tentativas');
      }

      // Fase 2: Se deu rate limit com proxy BR OU realmente falhou, tenta SEM PROXY
      // NÃO tenta sem proxy se teve sucesso com proxy BR (mesmo que status 402)
      const shouldTryWithoutProxy = rateLimitDetected || 
                                    !result || 
                                    !result.success || 
                                    (result.success && result.status === 402 && !result.data && !result.interpretation) ||
                                    (result.success && !result.data && !result.interpretation);
      
      if (shouldTryWithoutProxy) {
        if (rateLimitDetected) {
          console.log('[Gemeos] ⚠️ Rate limit com proxy BR detectado, tentando SEM PROXY...');
        } else if (result && result.success && result.status === 402) {
          console.log('[Gemeos] ⚠️ Status 402 com proxy BR (sem dados válidos), tentando SEM PROXY...');
        } else {
          console.log('[Gemeos] ⚠️ Tentativas com proxy falharam, tentando SEM PROXY...');
        }
        
        // Aguarda um pouco antes de tentar sem proxy (evita rate limit)
        await this.sleep(500);
        
        result = await this.makeAPIRequest(cpf, null);
        
        // Logs de debug removidos para melhorar performance
        
        // Se sem proxy cair em rate limit, aguarda e retorna erro claro
        if (!result.success && (/rate_limited/i.test(String(result.error)) || result.status === 429)) {
          console.log('[Gemeos] ⚠️ Rate limit mesmo sem proxy - aguardando...');
          await this.rateLimiter.handleRateLimit(Date.now() - startTime);
          return {
            cpf: cpf,
            success: false,
            error: 'rate_limited',
            status: result.status || 429,
            proxy: 'Sem Proxy'
          };
        }
        
        // Se status 400 sem dados e sem interpretation, pode ser rate limit ou erro
        if (result.status === 400 && !result.data && !result.interpretation) {
          // Verifica se é rate limit disfarçado
          if (/rate|limit|excedeu|too many/i.test(String(result.error || ''))) {
            console.log('[Gemeos] ⚠️ Status 400 com mensagem de rate limit - tratando como rate limit');
            await this.rateLimiter.handleRateLimit(Date.now() - startTime);
            return {
              cpf: cpf,
              success: false,
              error: 'rate_limited',
              status: 429,
              proxy: 'Sem Proxy'
            };
          }
          console.log('[Gemeos] ❌ Status 400 sem dados válidos - CPF pode estar inválido ou API bloqueou');
          result.success = false;
          result.error = result.error || 'Status 400 - Requisição inválida';
        }
      }
      
      // Se encontrou CPF registrado, consulta API WorkBuscas para dados complementares
      if (result && result.success && result.interpretation === 'registered') {
        try {
          const workbuscasData = await this.consultWorkBuscas(cpf);
          if (workbuscasData) {
            result.workbuscas = workbuscasData;
          } else {
            console.warn(`[WorkBuscas] Nenhum dado retornado para CPF ${cpf}`);
          }
        } catch (error) {
          // Não falha a requisição se WorkBuscas falhar
          console.warn(`[WorkBuscas] Erro ao consultar CPF ${cpf}:`, error.message);
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
  async checkMultipleCPFs(cpfs) {
    const results = [];
    
    if (this.proxies.length === 0) {
      await this.loadProxies();
    }
    
    for (let i = 0; i < cpfs.length; i += this.batchSize) {
      const batch = cpfs.slice(i, i + this.batchSize);
      const batchNumber = Math.floor(i / this.batchSize) + 1;
      const totalBatches = Math.ceil(cpfs.length / this.batchSize);
      
      
      // Processa CPFs SEQUENCIALMENTE para evitar rate limit simultâneo
      // Cada CPF aguarda o anterior terminar antes de começar
      const batchResults = [];
      for (let index = 0; index < batch.length; index++) {
        const cpf = batch[index];
        try {
          // Delay entre requisições para evitar rate limit (200ms entre cada CPF)
          if (index > 0) {
            await this.sleep(200);
          }
          
          const result = await this.checkCPF(cpf, true);
          if (!result.timestamp) {
            result.timestamp = new Date().toISOString();
          }
          this.results.push(result);
          
          const proxyInfo = '';
          const status = result.interpretation === 'registered' ? 'CADASTRADO' : 'NÃO CADASTRADO';
          const comprasCount = result.products && result.products.success ? result.products.count : 0;
          const foneMask = result.user && result.user.telefone ? ` - ${result.user.telefone}` : '';
          const extra = result.interpretation === 'registered' ? ` | compras=${comprasCount}${foneMask}` : '';
          if (status === 'CADASTRADO') {
            console.log(`✅ [Gemeos] CPF ${cpf} CADASTRADO${proxyInfo}`);
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
      filename = path.join(__dirname, '../../lista/gemeos-valid-cpfs-' + timestamp + '.txt');
    }

    const validCPFs = this.results.filter(result => 
      result.success && result.interpretation === 'registered'
    );

    if (validCPFs.length === 0) {
      console.log('Nenhum CPF válido encontrado para salvar.');
      return;
    }

    let txtContent = '';
    txtContent += '🔍 CENTRAL DO ARRANCA - CPFs VÁLIDOS ENCONTRADOS\n';
    txtContent += '='.repeat(60) + '\n\n';
    txtContent += `📅 Data/Hora: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n`;
    txtContent += `📊 Total de CPFs válidos: ${validCPFs.length}\n`;
    txtContent += `📝 Nota: Apenas CPFs com cadastro na plataforma Gemeos Brasil\n\n`;
    txtContent += '='.repeat(60) + '\n\n';

    validCPFs.forEach((result, index) => {
      txtContent += `📋 CPF ${index + 1}:\n`;
      txtContent += `   🔢 CPF: ${result.cpf}\n`;
      txtContent += `   ✅ Status: CADASTRADO\n`;
      txtContent += `   🌐 Proxy usado: ${result.proxy || 'Sem Proxy'}\n`;
      txtContent += `   ⏰ Verificado em: ${new Date(result.timestamp).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n\n`;

      // Dados de usuário adaptados ao novo endpoint (telefone mascarado e hashes)
      if (result.user) {
        txtContent += `   👤 DADOS DO USUÁRIO:\n`;
        if (result.user.id !== undefined) txtContent += `      🆔 ID: ${result.user.id}\n`;
        if (result.user.nome) txtContent += `      📛 Nome: ${result.user.nome}\n`;
        if (result.user.telefone) txtContent += `      📱 Telefone (mascarado): ${result.user.telefone}\n`;
        if (result.user.email_hash) txtContent += `      🔒 Email (hash): ${result.user.email_hash}\n`;
        if (result.user.phone_hash) txtContent += `      🔒 Phone (hash): ${result.user.phone_hash}\n`;
        if (result.user.phone_plus_hash) txtContent += `      🔒 Phone+ (hash): ${result.user.phone_plus_hash}\n`;
        txtContent += '\n';
      }

      // Compras (novo endpoint)
      if (result.products && result.products.success) {
        txtContent += `   🧾 COMPRAS:\n`;
        txtContent += `      📊 Quantidade: ${result.products.count}\n`;
        if (Array.isArray(result.products.data) && result.products.data.length > 0) {
          const preview = result.products.data.slice(0, 3).map((c, i) => {
            const title = c?.rifa?.title || c?.rifa?.titulo || c?.titulo || 'Compra';
            const data = c?.data || c?.insert || '';
            return `${i + 1}) ${title}${data ? ` - ${data}` : ''}`;
          }).join('\n         ');
          txtContent += `      📋 Amostra:\n         ${preview}\n`;
          if (result.products.data.length > 3) {
            txtContent += `         ... (+${result.products.data.length - 3} mais)\n`;
          }
        }
        txtContent += '\n';
      }

      txtContent += '─'.repeat(40) + '\n\n';
    });

    try {
      // Garantir que a pasta lista existe
      const listaDir = path.join(__dirname, '../../lista');
      if (!fs.existsSync(listaDir)) {
        fs.mkdirSync(listaDir, { recursive: true });
      }
      
      // Garantir que filename é um caminho absoluto se necessário
      if (!path.isAbsolute(filename)) {
        filename = path.join(listaDir, path.basename(filename));
      }
      
      await fs.writeFile(filename, txtContent, 'utf8');
    } catch (error) {
      console.log('❌ [Gemeos] Erro ao salvar resultados:', error.message);
    }
  }

  /**
   * Exibe resumo das verificações
   */
  showSummary() {
    console.log('\n' + '='.repeat(50));
    console.log('📊 RESUMO DAS VERIFICAÇÕES');
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

module.exports = GemeosChecker;
