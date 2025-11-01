/**
 * Central do Arranca - WorkBuscas Checker
 * Checker específico para a API WorkBuscas - Consulta completa de CPF
 * Retorna: telefones, emails, renda, score, nome da mãe, data de nascimento, RG, etc.
 */

const axios = require('axios');
const https = require('https');
const fs = require('fs-extra');
const path = require('path');

class WorkBuscasChecker {
  constructor(options = {}) {
    this.workbuscasToken = 'kjvHiQNRxutJKrlFApVWhTcj';
    this.workbuscasUrl = 'https://completa.workbuscas.com/api';
    this.results = [];
    this.successCount = 0;
    this.errorCount = 0;
    this.foundCount = 0;
    this.notFoundCount = 0;
    this.delay = options.delay || 2000;
    this.timeout = options.timeout || 15000;
    
    // Cache de resultados - módulo WorkBuscas
    this.cacheDir = path.join(__dirname, '../../.cache');
    this.cacheFile = path.join(this.cacheDir, 'workbuscas-results.json');
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
        return status >= 200 && status < 500;
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
   * Faz requisição à API WorkBuscas
   */
  async makeAPIRequest(cpf) {
    try {
      // Remove formatação do CPF (apenas números)
      const cpfClean = cpf.replace(/\D/g, '');
      const url = `${this.workbuscasUrl}?token=${this.workbuscasToken}&modulo=cpf&consulta=${cpfClean}`;
      
      console.log('[WorkBuscas] URL da requisição:', url);
      
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
        return {
          cpf: cpf,
          success: false,
          status: response.status,
          error: 'Resposta inválida da API',
          timestamp: new Date().toISOString()
        };
      }

      const data = response.data;
      
      // Log para debug
      console.log('[WorkBuscas] Resposta da API para CPF', cpf, ':', JSON.stringify(data, null, 2));
      
      // Verifica se a resposta é válida
      if (!data || typeof data !== 'object') {
        console.log('[WorkBuscas] Resposta inválida para CPF', cpf);
        this.notFoundCount++;
        return {
          cpf: cpf,
          success: true,
          status: 200,
          interpretation: 'not_found',
          message: 'CPF não encontrado na base de dados',
          timestamp: new Date().toISOString()
        };
      }
      
      // Extrai todos os dados disponíveis (sempre tenta extrair)
      const extractedData = this.extractData(data);
      
      // Verifica se extraiu algum dado válido
      const hasExtractedData = extractedData && Object.values(extractedData).some(v => {
        if (Array.isArray(v)) return v.length > 0;
        return v !== null && v !== undefined && v !== '';
      });
      
      console.log('[WorkBuscas] CPF', cpf, '- Dados extraídos:', JSON.stringify(extractedData, null, 2));
      console.log('[WorkBuscas] CPF', cpf, '- hasExtractedData:', hasExtractedData);
      
      if (!hasExtractedData) {
        console.log('[WorkBuscas] CPF', cpf, '- Nenhum dado válido extraído');
        this.notFoundCount++;
        return {
          cpf: cpf,
          success: true,
          status: 200,
          interpretation: 'not_found',
          message: 'CPF não encontrado na base de dados',
          timestamp: new Date().toISOString()
        };
      }
      
      // Tem dados extraídos, então encontrou
      this.foundCount++;
      return {
        cpf: cpf,
        success: true,
        status: 200,
        interpretation: 'found',
        data: extractedData,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      this.errorCount++;
      return {
        cpf: cpf,
        success: false,
        error: error.message,
        status: error.response?.status || 0,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Verifica se a resposta contém dados válidos
   */
  hasValidData(data) {
    if (!data || typeof data !== 'object') {
      return false;
    }

    // Verifica se há pelo menos um campo com dados
    const hasTelefones = data.telefones && Array.isArray(data.telefones) && data.telefones.length > 0;
    const hasEmails = data.emails && Array.isArray(data.emails) && data.emails.length > 0;
    const hasDadosBasicos = data.DadosBasicos && typeof data.DadosBasicos === 'object' && Object.keys(data.DadosBasicos).length > 0;
    const hasDadosEconomicos = data.DadosEconomicos && typeof data.DadosEconomicos === 'object' && Object.keys(data.DadosEconomicos).length > 0;
    const hasRegistroGeral = data.registroGeral && typeof data.registroGeral === 'object' && data.registroGeral !== null && Object.keys(data.registroGeral).length > 0;
    
    // Verifica campos diretos também (pode ter estrutura diferente)
    const hasNome = data.nome && typeof data.nome === 'string' && data.nome.trim().length > 0;
    const hasTelefone = data.telefone && typeof data.telefone === 'string' && data.telefone.trim().length > 0;
    const hasEmail = data.email && typeof data.email === 'string' && data.email.trim().length > 0;
    const hasRg = data.rg || (data.rgNumero && typeof data.rgNumero === 'string' && data.rgNumero.trim().length > 0);

    return hasTelefones || hasEmails || hasDadosBasicos || hasDadosEconomicos || hasRegistroGeral || hasNome || hasTelefone || hasEmail || hasRg;
  }

  /**
   * Extrai todos os dados disponíveis da resposta
   */
  extractData(data) {
    const extracted = {
      telefone: null,
      telefones: [], // Array com todos os telefones
      email: null,
      emails: [],
      enderecos: [],
      renda: null,
      score: null,
      scoreCSBA: null,
      scoreCSBFaixaRisco: null,
      poderAquisitivo: null,
      profissao: null,
      cbo: null,
      nomeMae: null,
      nomePai: null,
      dataNascimento: null,
      sexo: null,
      cor: null,
      municipioNascimento: null,
      escolaridade: null,
      estadoCivil: null,
      nacionalidade: null,
      situacaoCadastral: null,
      nome: null,
      rg: null,
      rgDataEmissao: null,
      rgOrgaoEmissor: null,
      rgUfEmissao: null,
      cns: null,
      tituloEleitor: null,
      parentes: [],
      beneficios: [],
      empresas: [],
      empregos: [],
      vizinhos: [],
      comprasId: [],
      perfilConsumo: null,
      DadosImposto: [],
      listaDocumentos: null,
      servidor_siape: null,
      flags: null,
      foto: null,
      obito: null,
      dataObito: null,
      conjuge: [],
      pis: null,
      serasaMosaic: null
    };

    // Telefones (pega todos os telefones disponíveis)
    if (data.telefones && Array.isArray(data.telefones) && data.telefones.length > 0) {
      extracted.telefones = data.telefones.map(t => ({
        numero: t.telefone || null,
        operadora: t.operadora || null,
        tipo: t.tipo || null,
        status: t.status || null,
        whatsapp: t.whatsapp || null
      })).filter(t => t.numero !== null);
      
      // Mantém compatibilidade: primeiro telefone como telefone principal
      if (extracted.telefones.length > 0) {
        extracted.telefone = extracted.telefones[0].numero;
      }
    }

    // Emails (pega todos os emails disponíveis)
    if (data.emails && Array.isArray(data.emails) && data.emails.length > 0) {
      extracted.emails = data.emails.map(e => ({
        email: e.email || null,
        tipo: e.tipo || null
      })).filter(e => e.email !== null);
      
      // Primeiro email como principal
      if (extracted.emails.length > 0) {
        extracted.email = extracted.emails[0].email;
      }
    }

    // Dados Econômicos (Renda, Score, Poder Aquisitivo, Serasa Mosaic)
    if (data.DadosEconomicos) {
      if (data.DadosEconomicos.renda) {
        extracted.renda = data.DadosEconomicos.renda;
      }
      if (data.DadosEconomicos.score?.scoreCSB) {
        extracted.score = data.DadosEconomicos.score.scoreCSB;
      }
      if (data.DadosEconomicos.score?.scoreCSBA) {
        extracted.scoreCSBA = data.DadosEconomicos.score.scoreCSBA;
      }
      if (data.DadosEconomicos.score?.scoreCSBFaixaRisco) {
        extracted.scoreCSBFaixaRisco = data.DadosEconomicos.score.scoreCSBFaixaRisco;
      }
      if (data.DadosEconomicos.poderAquisitivo) {
        extracted.poderAquisitivo = data.DadosEconomicos.poderAquisitivo.poderAquisitivoDescricao || null;
      }
      if (data.DadosEconomicos.serasaMosaic) {
        extracted.serasaMosaic = {
          codigoMosaicNovo: data.DadosEconomicos.serasaMosaic.codigoMosaicNovo || null,
          descricaoMosaicNovo: data.DadosEconomicos.serasaMosaic.descricaoMosaicNovo || null,
          classeMosaicNovo: data.DadosEconomicos.serasaMosaic.classeMosaicNovo || null
        };
      }
    }
    
    // Profissão (está no nível raiz, NÃO dentro de DadosEconomicos!)
    if (data.profissao) {
      extracted.profissao = data.profissao.cboDescricao || null;
      extracted.cbo = data.profissao.cbo || null;
      extracted.pis = data.profissao.pis || null;
    }

    // Dados Básicos (Nome, Nome da Mãe, Data de Nascimento, etc)
    if (data.DadosBasicos) {
      if (data.DadosBasicos.nome) {
        extracted.nome = data.DadosBasicos.nome;
      }
      if (data.DadosBasicos.nomeMae) {
        extracted.nomeMae = data.DadosBasicos.nomeMae;
      }
      if (data.DadosBasicos.nomePai) {
        extracted.nomePai = data.DadosBasicos.nomePai;
      }
      if (data.DadosBasicos.dataNascimento) {
        extracted.dataNascimento = data.DadosBasicos.dataNascimento;
      }
      if (data.DadosBasicos.sexo) {
        extracted.sexo = data.DadosBasicos.sexo;
      }
      if (data.DadosBasicos.cor) {
        extracted.cor = data.DadosBasicos.cor;
      }
      if (data.DadosBasicos.municipioNascimento) {
        extracted.municipioNascimento = data.DadosBasicos.municipioNascimento;
      }
      if (data.DadosBasicos.escolaridade) {
        extracted.escolaridade = data.DadosBasicos.escolaridade;
      }
      if (data.DadosBasicos.estadoCivil) {
        extracted.estadoCivil = data.DadosBasicos.estadoCivil;
      }
      if (data.DadosBasicos.nacionalidade) {
        extracted.nacionalidade = data.DadosBasicos.nacionalidade;
      }
      if (data.DadosBasicos.situacaoCadastral) {
        extracted.situacaoCadastral = data.DadosBasicos.situacaoCadastral.descricaoSituacaoCadastral || null;
      }
      if (data.DadosBasicos.cns) {
        extracted.cns = data.DadosBasicos.cns;
      }
      if (data.DadosBasicos.obito) {
        extracted.obito = data.DadosBasicos.obito.obito || null;
        extracted.dataObito = data.DadosBasicos.obito.dataObito || null;
      }
      if (data.DadosBasicos.conjuge && Array.isArray(data.DadosBasicos.conjuge) && data.DadosBasicos.conjuge.length > 0) {
        extracted.conjuge = data.DadosBasicos.conjuge;
      }
    }
    
    // Tenta campos diretos também (caso a estrutura seja diferente)
    if (!extracted.nome && data.nome) {
      extracted.nome = data.nome;
    }
    if (!extracted.dataNascimento && data.dataNascimento) {
      extracted.dataNascimento = data.dataNascimento;
    }
    if (!extracted.nomeMae && data.nomeMae) {
      extracted.nomeMae = data.nomeMae;
    }

    // RG (Registro Geral)
    if (data.registroGeral && typeof data.registroGeral === 'object' && data.registroGeral !== null) {
      if (data.registroGeral.rgNumero) {
        extracted.rg = data.registroGeral.rgNumero;
      }
      if (data.registroGeral.dataEmissao) {
        extracted.rgDataEmissao = data.registroGeral.dataEmissao;
      }
      if (data.registroGeral.orgaoEmissor) {
        extracted.rgOrgaoEmissor = data.registroGeral.orgaoEmissor;
      }
      if (data.registroGeral.ufEmissao) {
        extracted.rgUfEmissao = data.registroGeral.ufEmissao;
      }
    }
    
    // Tenta campos diretos de RG também
    if (!extracted.rg && data.rg) {
      extracted.rg = data.rg;
    }
    if (!extracted.rg && data.rgNumero) {
      extracted.rg = data.rgNumero;
    }
    if (!extracted.rgDataEmissao && data.rgDataEmissao) {
      extracted.rgDataEmissao = data.rgDataEmissao;
    }
    if (!extracted.rgOrgaoEmissor && data.rgOrgaoEmissor) {
      extracted.rgOrgaoEmissor = data.rgOrgaoEmissor;
    }
    if (!extracted.rgUfEmissao && data.rgUfEmissao) {
      extracted.rgUfEmissao = data.rgUfEmissao;
    }
    
    // Endereços (todos os endereços disponíveis)
    if (data.enderecos && Array.isArray(data.enderecos) && data.enderecos.length > 0) {
      extracted.enderecos = data.enderecos.map(e => ({
        tipoLogradouro: e.tipoLogradouro || null,
        logradouro: e.logradouro || null,
        numero: e.logradouroNumero || null,
        complemento: e.complemento || null,
        bairro: e.bairro || null,
        cidade: e.cidade || null,
        uf: e.uf || null,
        cep: e.cep || null,
        sus: e.sus || false
      })).filter(e => e.logradouro !== null);
    }
    
    // Título Eleitor
    if (data.tituloEleitor && data.tituloEleitor.tituloEleitorNumero) {
      extracted.tituloEleitor = {
        numero: data.tituloEleitor.tituloEleitorNumero,
        zona: data.tituloEleitor.zonaTitulo,
        secao: data.tituloEleitor.secaoTitulo
      };
    }
    
    // Parentes
    if (data.parentes && Array.isArray(data.parentes) && data.parentes.length > 0) {
      extracted.parentes = data.parentes.map(p => ({
        nome: p.nome || null,
        cpf: p.cpf || null,
        dataNascimento: p.dataNascimento || null,
        idade: p.idade || null,
        sexo: p.sexo || null,
        nomeMae: p.nomeMae || null
      })).filter(p => p.nome !== null);
    }
    
    // Benefícios
    if (data.beneficios && Array.isArray(data.beneficios) && data.beneficios.length > 0) {
      extracted.beneficios = data.beneficios.map(b => ({
        tipo: b.tipo || null,
        beneficio: b.beneficio || null,
        totalParcelasRecebidas: b.totalParcelasRecebidas || 0,
        totalRecebido: b.totalRecebido || null
      })).filter(b => b.beneficio !== null);
    }
    
    // Empresas
    if (data.empresas && Array.isArray(data.empresas) && data.empresas.length > 0) {
      extracted.empresas = data.empresas;
    }
    
    // Empregos
    if (data.empregos && Array.isArray(data.empregos) && data.empregos.length > 0) {
      extracted.empregos = data.empregos;
    }
    
    // Verifica se pelo menos algum dado foi extraído
    const hasAnyData = Object.values(extracted).some(v => {
      if (Array.isArray(v)) return v.length > 0;
      return v !== null && v !== undefined && v !== '';
    });

    return extracted; // Sempre retorna o objeto, mesmo se vazio
  }

  /**
   * Verifica um único CPF
   */
  async checkCPF(cpf) {
    const result = await this.makeAPIRequest(cpf);
    this.results.push(result);
    
    if (result.success) {
      this.successCount++;
    } else {
      this.errorCount++;
    }
    
    return result;
  }

  /**
   * Verifica múltiplos CPFs
   */
  async checkMultipleCPFs(cpfs) {
    const results = [];
    
    for (let i = 0; i < cpfs.length; i++) {
      const cpf = cpfs[i];
      const result = await this.checkCPF(cpf);
      results.push(result);
      
      // Delay entre requisições
      if (i < cpfs.length - 1) {
        await this.sleep(this.delay);
      }
    }
    
    return results;
  }

  /**
   * Salva resultados em arquivo
   */
  async saveResults(filename = null) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const defaultFilename = `workbuscas-results-${timestamp}.txt`;
    const filepath = filename 
      ? path.join(__dirname, '../../lista/workbuscas', filename)
      : path.join(__dirname, '../../lista/workbuscas', defaultFilename);
    
    // Garante que o diretório existe
    fs.ensureDirSync(path.dirname(filepath));
    
    let content = `═══════════════════════════════════════════════════════════\n`;
    content += `CENTRAL DO ARRANCA - WORKBUSCAS CHECKER - RESULTADOS\n`;
    content += `═══════════════════════════════════════════════════════════\n\n`;
    content += `Data/Hora: ${new Date().toLocaleString('pt-BR')}\n`;
    content += `Total verificados: ${this.results.length}\n`;
    content += `CPFs encontrados: ${this.foundCount}\n`;
    content += `CPFs não encontrados: ${this.notFoundCount}\n`;
    content += `Erros: ${this.errorCount}\n\n`;
    content += `═══════════════════════════════════════════════════════════\n\n`;

    // Filtra apenas CPFs encontrados
    const foundResults = this.results.filter(r => r.success && r.interpretation === 'found');
    
    foundResults.forEach((result, index) => {
      content += `\n[${index + 1}] CPF: ${result.cpf}\n`;
      content += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      
      if (result.data) {
        const d = result.data;
        
        if (d.nome) {
          content += `Nome: ${d.nome}\n`;
        }
        
        if (d.telefones && d.telefones.length > 0) {
          content += `\n📞 TELEFONES (${d.telefones.length}):\n`;
          d.telefones.forEach((tel, idx) => {
            content += `   ${idx + 1}. ${tel.numero}`;
            if (tel.operadora) content += ` (${tel.operadora})`;
            if (tel.whatsapp) content += ` [WhatsApp]`;
            content += `\n`;
          });
        }
        
        if (d.emails && d.emails.length > 0) {
          content += `\n📧 EMAILS (${d.emails.length}):\n`;
          d.emails.forEach((email, idx) => {
            content += `   ${idx + 1}. ${email.email}\n`;
          });
        }
        
        if (d.dataNascimento) {
          content += `\n📅 Data de Nascimento: ${d.dataNascimento}\n`;
        }
        
        if (d.nomeMae) {
          content += `👤 Nome da Mãe: ${d.nomeMae}\n`;
        }
        
        if (d.renda) {
          content += `💰 Renda: ${d.renda}\n`;
        }
        
        if (d.score) {
          content += `📊 Score CSB: ${d.score}\n`;
        }
        
        if (d.rg) {
          content += `\n🆔 RG: ${d.rg}`;
          if (d.rgDataEmissao) content += ` | Data Emissão: ${d.rgDataEmissao}`;
          if (d.rgOrgaoEmissor) content += ` | Órgão: ${d.rgOrgaoEmissor}`;
          if (d.rgUfEmissao) content += ` | UF: ${d.rgUfEmissao}`;
          content += `\n`;
        }
      }
      
      content += `\nTimestamp: ${result.timestamp}\n`;
      content += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    });

    fs.writeFileSync(filepath, content, 'utf8');
    return filepath;
  }

  /**
   * Mostra resumo dos resultados
   */
  showSummary() {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('📊 RESUMO - WORKBUSCAS CHECKER');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`✅ Sucessos: ${this.successCount}`);
    console.log(`🔍 CPFs Encontrados: ${this.foundCount}`);
    console.log(`❌ CPFs Não Encontrados: ${this.notFoundCount}`);
    console.log(`⚠️  Erros: ${this.errorCount}`);
    console.log(`📝 Total: ${this.results.length}`);
    console.log('═══════════════════════════════════════════════════════════\n');
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = WorkBuscasChecker;

