const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const CPFGenerator = require('../cpf-generator');
const GemeosChecker = require('../modules/gemeos/checker');
const SaudeChecker = require('../modules/saude/checker');
const WorkBuscasChecker = require('../modules/workbuscas/checker');
const Updater = require('../updater');
const fs = require('fs-extra');

let mainWindow;
let splashWindow;
let moduleSelectorWindow;
let checkers = {}; // Armazena checkers por módulo: { 'gemeos': GemeosChecker, 'saude': SaudeChecker }
let isRunning = false;
// Rastreamento de módulos em execução: { 'gemeos': { window: BrowserWindow, isRunning: bool }, 'saude': {...} }
let activeModules = {};
// Estatísticas separadas por módulo: { 'gemeos': { totalVerified, validFound, ... }, 'saude': { ... } }
let sessionStats = {};

function createWindow(moduleName = 'gemeos') {
  const moduleWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    fullscreen: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    title: `Central do Arranca - ${moduleName.toUpperCase()}`,
    icon: path.join(__dirname, '../logo.jpeg'),
    show: false,
    frame: true,
    titleBarStyle: 'default'
  });

  // Carrega a tela específica do módulo
  let htmlFile;
  if (moduleName === 'gemeos') {
    htmlFile = 'gemeos-checker.html';
  } else if (moduleName === 'saude') {
    htmlFile = 'saude-checker.html';
  } else if (moduleName === 'workbuscas') {
    htmlFile = 'workbuscas-checker.html';
  } else {
    htmlFile = 'gemeos-checker.html'; // fallback
  }
  moduleWindow.loadFile(path.join(__dirname, htmlFile));
  moduleWindow.center();
  
  // Rastreia o módulo ativo
  activeModules[moduleName] = {
    window: moduleWindow,
    isRunning: false,
    isChecking: false
  };
  
  // Quando a janela for fechada, remove do rastreamento
  moduleWindow.on('closed', () => {
    delete activeModules[moduleName];
    // Atualiza o menu de módulos se ainda estiver aberto
    updateModuleSelectorStatus();
  });
  
  // Mostra a janela quando estiver pronta
  moduleWindow.once('ready-to-show', () => {
    moduleWindow.show();
    // Atualiza o menu de módulos se ainda estiver aberto
    updateModuleSelectorStatus();
  });
  
  return moduleWindow;
}

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 720,
    height: 520,
    resizable: false,
    frame: false,
    alwaysOnTop: true,
    transparent: false,
    show: true, // Mostra imediatamente
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  
  // Aguarda a splash estar pronta antes de verificar atualizações
  return new Promise((resolve) => {
    splashWindow.webContents.once('did-finish-load', () => {
      console.log('[Splash] Splash screen carregada e pronta');
      // Aguarda mais um pouco para garantir que o JS está rodando
      setTimeout(() => {
        resolve();
      }, 300);
    });
  });
}

function createModuleSelector() {
  moduleSelectorWindow = new BrowserWindow({
    width: 800,
    height: 600,
    resizable: false,
    frame: false,
    alwaysOnTop: true,
    transparent: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  moduleSelectorWindow.loadFile(path.join(__dirname, 'module-selector.html'));
  moduleSelectorWindow.center();
  
  // Atualiza o status quando o menu carregar
  moduleSelectorWindow.webContents.once('did-finish-load', () => {
    updateModuleSelectorStatus();
  });
}

function updateModuleSelectorStatus() {
  if (moduleSelectorWindow && !moduleSelectorWindow.isDestroyed()) {
    moduleSelectorWindow.webContents.send('update-modules-status', activeModules);
  }
}

app.whenReady().then(async () => {
  // Splash: mostra logo e progresso de proxies
  await createSplash();
  
  // Aguarda um pequeno delay para garantir que a splash está totalmente renderizada
  await new Promise(resolve => setTimeout(resolve, 200));
  
  // Inicializa o updater
  const updater = new Updater();
  
  // Verifica se há atualização pendente para aplicar
  try {
    const updateApplied = await updater.checkAndApplyPendingUpdate();
    if (updateApplied && splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.send('splash-log', '✅ Atualização aplicada automaticamente!');
      splashWindow.webContents.send('splash-log', '🔄 Reiniciando aplicativo...');
      // Aguarda um pouco para mostrar a mensagem
      await new Promise(resolve => setTimeout(resolve, 2000));
      // Reinicia o aplicativo
      app.relaunch();
      app.exit(0);
      return;
    }
  } catch (error) {
    console.error('[Updater] Erro ao verificar atualização pendente:', error);
  }

  // Verifica atualizações na splash screen
  try {
    console.log('[Updater] Iniciando verificação de atualizações...');
    
    // Garante que a splash está pronta
    if (splashWindow && !splashWindow.isDestroyed()) {
      // Mostra mensagem inicial
      splashWindow.webContents.send('splash-log', '🔍 Verificando atualizações no GitHub...');
      console.log('[Updater] Mensagem enviada para splash screen');
    } else {
      console.warn('[Updater] Splash window não está disponível');
    }
    
    const updateInfo = await updater.checkForUpdates();
    console.log('[Updater] Resultado da verificação:', updateInfo);
    
    if (updateInfo && updateInfo.available) {
      console.log('[Updater] Nova versão disponível:', updateInfo.latestVersion);
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.webContents.send('splash-log', `✨ Nova versão disponível: v${updateInfo.latestVersion}`);
        splashWindow.webContents.send('splash-log', `📥 Baixando atualização...`);
        splashWindow.webContents.send('update-available', {
          currentVersion: updateInfo.currentVersion,
          latestVersion: updateInfo.latestVersion,
          releaseNotes: updateInfo.releaseNotes
        });
      }
      
      // Faz download da atualização se houver URL
      if (updateInfo.downloadUrl) {
        try {
          const downloadProgress = (progress) => {
            if (splashWindow && !splashWindow.isDestroyed()) {
              const percent = progress.progress || 0;
              splashWindow.webContents.send('update-progress', {
                downloaded: progress.downloaded,
                total: progress.total,
                percent: percent
              });
              splashWindow.webContents.send('splash-log', `📥 Download: ${percent}%`);
            }
          };
          
          const zipPath = await updater.downloadUpdate(updateInfo.downloadUrl, downloadProgress);
          
          if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.webContents.send('splash-log', '✅ Download concluído!');
            splashWindow.webContents.send('splash-log', '📦 Extraindo atualização...');
          }
          
          // Extrai o ZIP automaticamente
          try {
            const extractedPath = await updater.applyUpdate(zipPath);
            
            if (splashWindow && !splashWindow.isDestroyed()) {
              splashWindow.webContents.send('splash-log', '✅ Atualização extraída!');
              splashWindow.webContents.send('splash-log', '🔄 Reinicie o aplicativo para aplicar automaticamente.');
              splashWindow.webContents.send('splash-log', '💡 A atualização será aplicada automaticamente na próxima inicialização!');
              splashWindow.webContents.send('update-downloaded', { zipPath, extractedPath });
            }
          } catch (extractError) {
            console.error('[Updater] Erro ao extrair atualização:', extractError);
            if (splashWindow && !splashWindow.isDestroyed()) {
              splashWindow.webContents.send('splash-log', '❌ Erro ao extrair atualização. O arquivo ZIP foi salvo.');
              splashWindow.webContents.send('splash-log', `📂 Local do ZIP: ${zipPath}`);
            }
          }
        } catch (error) {
          console.error('[Updater] Erro ao baixar atualização:', error);
          if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.webContents.send('splash-log', '❌ Erro ao baixar atualização. Continuando...');
          }
        }
      }
    } else {
      // Sem atualização disponível
      let versionMessage;
      if (updateInfo?.error === 'Nenhuma release encontrada') {
        // Primeira execução - ainda não há releases no GitHub
        versionMessage = `✅ Versão atual: v${updater.currentVersion}`;
      } else if (updateInfo?.error) {
        // Erro real ao verificar
        versionMessage = `⚠️ Não foi possível verificar atualizações (${updateInfo.error}). Continuando...`;
      } else {
        // Está atualizado
        versionMessage = `✅ Você está com a versão mais recente (v${updateInfo?.currentVersion || updater.currentVersion})`;
      }
      
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.webContents.send('splash-log', versionMessage);
        console.log('[Updater]', versionMessage);
      }
    }
  } catch (error) {
    console.error('[Updater] Erro ao verificar atualizações:', error);
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.send('splash-log', `⚠️ Erro ao verificar atualizações: ${error.message}`);
      console.log('[Updater] Mensagem de erro enviada para splash');
    }
  }
  
  // Inicializa checkers para todos os módulos
  checkers['gemeos'] = new GemeosChecker({
    delay: 5000,
    timeout: 15000,
    maxRetries: 2
  });
  checkers['saude'] = new SaudeChecker({
    delay: 5000,
    timeout: 15000
  });
  checkers['workbuscas'] = new WorkBuscasChecker({
    delay: 2000,
    timeout: 15000
  });
  
  // Carrega proxies do Gemeos (módulo principal por enquanto)
  const gemeosChecker = checkers['gemeos'];
  
  // Progresso no splash
  const progressCallback = (count) => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.send('splash-progress', { count });
      if (count % 50 === 0) splashWindow.webContents.send('splash-log', `Recebidos ${count} proxies...`);
    }
  };
  try {
    // Sinaliza início
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.send('splash-start');
      splashWindow.webContents.send('splash-log', 'Iniciando carregamento dos proxies...');
    }
    const start = Date.now();
    await gemeosChecker.loadProxies(progressCallback);
    // Garante duração mínima de 3500ms para visualizar carregamento
    const elapsed = Date.now() - start;
    if (elapsed < 3500) {
      await new Promise(r => setTimeout(r, 3500 - elapsed));
    }
    if (splashWindow && !splashWindow.isDestroyed()) {
      const totalValid = gemeosChecker?.proxies?.length || 0;
      splashWindow.webContents.send('splash-log', `Teste concluído: ${totalValid} proxies válidos.`);
      splashWindow.webContents.send('splash-log', 'Preparando interface...');
    }
  } catch (e) {
    // Ignora; seguirá com o que houver
  }
  // Cria a tela de seleção de módulo ANTES de fechar a splash
  createModuleSelector();
  
  // Aguarda um pouco e fecha a splash
  setTimeout(() => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
  }, 300);
});

app.on('window-all-closed', () => {
  // Não fecha o app se ainda houver janelas sendo criadas ou se houver tela de seleção
  if (splashWindow && !splashWindow.isDestroyed()) return;
  if (moduleSelectorWindow && !moduleSelectorWindow.isDestroyed()) return;
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // Não cria janela automaticamente, espera seleção de módulo
  if (BrowserWindow.getAllWindows().length === 0 && !moduleSelectorWindow) {
    createModuleSelector();
  }
});

// IPC Handlers
ipcMain.on('module-selected', async (event, moduleName) => {
  if (moduleName === 'gemeos' || moduleName === 'saude' || moduleName === 'workbuscas') {
    // Apenas cria a janela do checker se não existir ainda
    if (!activeModules[moduleName] || activeModules[moduleName].window.isDestroyed()) {
      const moduleWindow = createWindow(moduleName);
      
      moduleWindow.webContents.once('did-finish-load', () => {
        if (moduleName === 'workbuscas') {
          // WorkBuscas não usa proxies
          moduleWindow.webContents.send('log-message', { type: 'success', message: `✅ WorkBuscas Checker pronto para uso!` });
        } else {
          moduleWindow.webContents.send('proxy-loading-start');
          const moduleChecker = checkers[moduleName];
          const total = moduleChecker?.proxies?.length || 0;
          moduleWindow.webContents.send('proxy-loading-progress', { count: total });
          moduleWindow.webContents.send('proxy-loading-complete', { total });
          moduleWindow.webContents.send('log-message', { type: 'success', message: `✅ ${total} proxies carregados com sucesso!` });
        }
      });
      
      // Fecha o menu de módulos após abrir o checker
      if (moduleSelectorWindow && !moduleSelectorWindow.isDestroyed()) {
        setTimeout(() => {
          if (moduleSelectorWindow && !moduleSelectorWindow.isDestroyed()) {
            moduleSelectorWindow.close();
            moduleSelectorWindow = null;
          }
        }, 300);
      }
    } else {
      // Se já existe, apenas traz a janela para frente e fecha o menu
      activeModules[moduleName].window.focus();
      if (moduleSelectorWindow && !moduleSelectorWindow.isDestroyed()) {
        moduleSelectorWindow.close();
        moduleSelectorWindow = null;
      }
    }
  }
});

// Handler para verificar status dos módulos
ipcMain.handle('get-modules-status', () => {
  return activeModules;
});

ipcMain.on('back-to-menu', (event) => {
  // Identifica qual módulo está chamando para voltar ao menu
  const senderWindow = event.sender.getOwnerBrowserWindow();
  let moduleName = null;
  
  // Encontra o módulo correspondente à janela que chamou
  for (const [key, module] of Object.entries(activeModules)) {
    if (module.window && module.window.webContents.id === senderWindow.webContents.id) {
      moduleName = key;
      break;
    }
  }
  
  // IMPORTANTE: NÃO para o checker, apenas minimiza ou esconde a janela
  // O checker continua rodando em background
  if (moduleName && activeModules[moduleName] && activeModules[moduleName].window && !activeModules[moduleName].window.isDestroyed()) {
    // Minimiza a janela ao invés de fechar - o checker continua rodando
    activeModules[moduleName].window.minimize();
    // NÃO remove do activeModules nem para o checker - apenas minimiza
    console.log('[back-to-menu] Janela minimizada, checker continua rodando:', moduleName);
  }
  
  // Abre/mostra o menu de módulos
  if (!moduleSelectorWindow || moduleSelectorWindow.isDestroyed()) {
    createModuleSelector();
  } else {
    moduleSelectorWindow.focus();
  }
  
  // Atualiza o status dos módulos no menu após um pequeno delay
  setTimeout(() => {
    if (moduleSelectorWindow && !moduleSelectorWindow.isDestroyed()) {
      moduleSelectorWindow.webContents.send('update-modules-status', activeModules);
    }
  }, 100);
});

ipcMain.handle('start-checking', async (event, config) => {
  // Identifica qual módulo está iniciando a partir da janela que enviou o evento
  let moduleName = 'gemeos'; // padrão
  const senderWindow = event.sender.getOwnerBrowserWindow();
  
  // Encontra o módulo correspondente à janela
  for (const [key, module] of Object.entries(activeModules)) {
    if (module.window && module.window.webContents.id === senderWindow.webContents.id) {
      moduleName = key;
      break;
    }
  }
  
  if (activeModules[moduleName] && activeModules[moduleName].isRunning) {
    return { success: false, message: 'Verificação já está em execução' };
  }
  
  // Marca o módulo como rodando
  if (activeModules[moduleName]) {
    activeModules[moduleName].isRunning = true;
  }
  
  isRunning = true;
  
  // Inicializa estatísticas separadas para o módulo
  if (!sessionStats[moduleName]) {
    sessionStats[moduleName] = {
      totalVerified: 0,
      validFound: 0,
      startTime: null,
      intervalId: null
    };
  }
  
  // Reseta estatísticas ao iniciar nova verificação
  sessionStats[moduleName].totalVerified = 0;
  sessionStats[moduleName].validFound = 0;
  sessionStats[moduleName].startTime = new Date();
  
  // Usa o checker específico do módulo
  if (!checkers[moduleName]) {
    if (moduleName === 'gemeos') {
      checkers[moduleName] = new GemeosChecker({
        delay: config.delay || 5000,
        timeout: 15000,
        maxRetries: 2
      });
    } else if (moduleName === 'saude') {
      checkers[moduleName] = new SaudeChecker({
        delay: config.delay || 5000,
        timeout: 15000
      });
    }
  }
  
  // Atualiza o menu de módulos ANTES de iniciar (para mostrar aura verde imediatamente)
  updateModuleSelectorStatus();
  
  // Pequeno delay para garantir que o IPC foi processado
  setTimeout(() => {
    updateModuleSelectorStatus();
  }, 50);
  
  // Inicia verificação contínua (não await para não bloquear)
  // Usa setTimeout para garantir que o status seja atualizado primeiro
  setTimeout(() => {
    console.log('[start-checking] Iniciando startContinuousChecking para módulo:', moduleName);
    startContinuousChecking(config).catch(err => {
      console.error('[start-checking] Erro ao iniciar verificação contínua:', err);
      if (activeModules[moduleName]) {
        activeModules[moduleName].isRunning = false;
        activeModules[moduleName].isChecking = false;
        updateModuleSelectorStatus();
      }
    });
  }, 150);
  
  return { success: true, message: 'Verificação iniciada' };
});

ipcMain.handle('stop-checking', async (event) => {
  // Identifica qual módulo está parando
  let moduleName = 'gemeos'; // padrão
  const senderWindow = event.sender.getOwnerBrowserWindow();
  
  // Encontra o módulo correspondente à janela
  for (const [key, module] of Object.entries(activeModules)) {
    if (module.window && module.window.webContents.id === senderWindow.webContents.id) {
      moduleName = key;
      break;
    }
  }
  
  // Marca o módulo como parado
  if (activeModules[moduleName]) {
    activeModules[moduleName].isRunning = false;
    activeModules[moduleName].isChecking = false;
  }
  
  // Para o intervalo específico do módulo
  if (sessionStats[moduleName] && sessionStats[moduleName].intervalId) {
    clearTimeout(sessionStats[moduleName].intervalId);
    sessionStats[moduleName].intervalId = null;
  }
  
  // Verifica se ainda há módulos rodando
  const hasRunningModules = Object.values(activeModules).some(m => m.isRunning);
  isRunning = hasRunningModules;
  
  // Atualiza o menu de módulos imediatamente
  updateModuleSelectorStatus();
  
  return { success: true, message: 'Verificação parada' };
});

ipcMain.handle('get-stats', (event) => {
  // Identifica qual módulo está solicitando estatísticas
  const senderWindow = event.sender.getOwnerBrowserWindow();
  let moduleName = 'gemeos';
  for (const [key, module] of Object.entries(activeModules)) {
    if (module.window && module.window.webContents.id === senderWindow.webContents.id) {
      moduleName = key;
      break;
    }
  }
  
  // Inicializa estatísticas se não existirem
  if (!sessionStats[moduleName]) {
    sessionStats[moduleName] = {
      totalVerified: 0,
      validFound: 0,
      startTime: null,
      intervalId: null
    };
  }
  
  const moduleStats = sessionStats[moduleName];
  const elapsed = moduleStats.startTime ? new Date() - moduleStats.startTime : 0;
  const elapsedMinutes = Math.floor(elapsed / 60000);
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  const remainingMinutes = elapsedMinutes % 60;
  
  return {
    totalVerified: moduleStats.totalVerified,
    validFound: moduleStats.validFound,
    elapsedTime: `${elapsedHours}h ${remainingMinutes}m`,
    isRunning: activeModules[moduleName]?.isRunning || false,
    successRate: moduleStats.totalVerified > 0 ? 
      ((moduleStats.validFound / moduleStats.totalVerified) * 100).toFixed(3) : '0.000'
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
  // Identifica qual módulo está fazendo a requisição
  const senderWindow = event.sender.getOwnerBrowserWindow();
  let moduleName = 'gemeos';
  for (const [key, module] of Object.entries(activeModules)) {
    if (module.window && module.window.webContents.id === senderWindow.webContents.id) {
      moduleName = key;
      break;
    }
  }
  const moduleWindow = activeModules[moduleName]?.window || senderWindow;
  
  // Usa o checker específico do módulo
  if (!checkers[moduleName]) {
    if (moduleName === 'gemeos') {
      checkers[moduleName] = new GemeosChecker({
        delay: 5000,
        timeout: 15000,
        maxRetries: 2
      });
    } else if (moduleName === 'saude') {
      checkers[moduleName] = new SaudeChecker({
        delay: 5000,
        timeout: 15000
      });
    } else if (moduleName === 'workbuscas') {
      checkers[moduleName] = new WorkBuscasChecker({
        delay: 2000,
        timeout: 15000
      });
    }
  }
  
  const checker = checkers[moduleName];
  
  try {
    const result = await checker.checkCPF(cpf);
    
    // Envia resultado para interface
    if (moduleWindow && !moduleWindow.isDestroyed()) {
      moduleWindow.webContents.send('cpf-checking', { 
        cpf, 
        count: 1 
      });
    }
    
    // WorkBuscas tem formato diferente
    if (moduleName === 'workbuscas') {
      console.log('[WorkBuscas] Resultado completo:', JSON.stringify(result, null, 2));
      
      if (result.success) {
        const status = result.interpretation === 'found' ? 'found' : 'not_found';
        
        console.log('[WorkBuscas] Status:', status);
        console.log('[WorkBuscas] Has data:', !!result.data);
        
        // Salva se encontrou dados
        if (status === 'found' && result.data) {
          // Salva resultado
          try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
            const filename = `workbuscas-result-${timestamp}.txt`;
            await checker.saveResults(filename);
          } catch (saveError) {
            console.error('[WorkBuscas] Erro ao salvar resultado:', saveError);
          }
        }
        
        // Retorna resultado formatado para WorkBuscas
        const resultData = result.data || {};
        
        // Adiciona o CPF nos dados para facilitar exibição
        if (!resultData.cpf && result.cpf) {
          resultData.cpf = result.cpf;
        }
        
        return {
          success: true,
          result: {
            cpf: result.cpf,
            success: result.success,
            interpretation: result.interpretation,
            data: resultData,
            message: result.interpretation === 'found' ? 'CPF encontrado' : 'CPF não encontrado',
            timestamp: result.timestamp
          }
        };
      } else {
        console.log('[WorkBuscas] Erro ao consultar:', result.error);
        return {
          success: false,
          error: result.error || 'Erro ao consultar CPF',
          status: result.status
        };
      }
    }
    
    // Código original para Gemeos e Saúde
    if (result.success) {
      const status = result.interpretation === 'registered' ? 'registered' : 'not_registered';
      if (result.proxy && result.proxy !== 'Sem Proxy') {
        if (moduleWindow && !moduleWindow.isDestroyed()) {
          moduleWindow.webContents.send('proxy-info', {
            cpf,
            proxy: result.proxy,
            hasAuth: true
          });
        }
      }
      const message = status === 'registered' ? 'CPF CADASTRADO' : 'CPF NÃO CADASTRADO';
      let userData = null;
      let products = [];
      
      if (result.user) {
        userData = {
          id: result.user.id,
          name: result.user.nome || result.user.name,
          email: result.user.email || undefined,
          phone: result.user.telefone || result.user.phone
        };
      }
      
      if (result.products && result.products.success && Array.isArray(result.products.data)) {
        products = result.products.data.map(p => ({
          id: p?.rifa?.id || p?.id || 'N/A',
          title: p?.rifa?.title || p?.titulo || p?.title || 'Compra'
        }));
      }
      
      if (status === 'registered') {
        console.log(`[DEBUG] Salvando CPF ${cpf} - Has workbuscas:`, !!result.workbuscas);
        if (result.workbuscas) {
          console.log(`[DEBUG] WorkBuscas data:`, JSON.stringify(result.workbuscas, null, 2));
        }
        await saveSingleValidCPF(cpf, result, true, moduleName);
      }
      
      if (moduleWindow && !moduleWindow.isDestroyed()) {
        moduleWindow.webContents.send('cpf-result', {
          cpf,
          status,
          message,
          userData,
          products,
          proxy: result.proxy,
          workbuscas: result.workbuscas || null
        });
      }
    } else {
      if (moduleWindow && !moduleWindow.isDestroyed()) {
        moduleWindow.webContents.send('cpf-result', {
          cpf,
          status: 'error',
          message: `Erro: ${result.error}`,
          errorCode: result.status
        });
      }
    }
    
    return { success: true, result };
  } catch (error) {
      if (moduleWindow && !moduleWindow.isDestroyed()) {
        moduleWindow.webContents.send('cpf-result', {
          cpf,
          status: 'error',
          message: `Erro: ${error.message}`
        });
      }
    
    return { success: false, error: error.message };
  }
});

async function startContinuousChecking(config) {
  // Identifica qual módulo está rodando (para atualizar status)
  let currentModuleName = 'gemeos';
  for (const [key, module] of Object.entries(activeModules)) {
    if (module.isRunning) {
      currentModuleName = key;
      break;
    }
  }
  
  // Verifica se o módulo específico está rodando
  if (!activeModules[currentModuleName]) {
    console.log('[startContinuousChecking] Módulo não existe:', currentModuleName, 'activeModules:', Object.keys(activeModules));
    return;
  }
  
  if (!activeModules[currentModuleName].isRunning) {
    console.log('[startContinuousChecking] Módulo não está marcado como rodando:', currentModuleName);
    return;
  }
  
  if (!isRunning) {
    console.log('[startContinuousChecking] isRunning global é false, parando');
    // Atualiza status no menu
    if (activeModules[currentModuleName]) {
      activeModules[currentModuleName].isRunning = false;
      activeModules[currentModuleName].isChecking = false;
      updateModuleSelectorStatus();
    }
    return;
  }
  
  console.log('[startContinuousChecking] Iniciando verificação para módulo:', currentModuleName, 'isRunning:', isRunning, 'module.isRunning:', activeModules[currentModuleName].isRunning);
  
  try {
    // Pega a janela do módulo que está rodando primeiro
    const currentModuleWindow = activeModules[currentModuleName]?.window;
    if (!currentModuleWindow || currentModuleWindow.isDestroyed()) {
      // Se a janela foi fechada, para o processamento e atualiza status
      if (activeModules[currentModuleName]) {
        activeModules[currentModuleName].isRunning = false;
        activeModules[currentModuleName].isChecking = false;
        updateModuleSelectorStatus();
      }
      return;
    }
    
    // Pega o checker específico do módulo
    const checker = checkers[currentModuleName];
    if (!checker) {
      console.error(`[startContinuousChecking] Checker não encontrado para módulo: ${currentModuleName}`);
      return;
    }
    
    // Carrega proxies se ainda não foram carregados
    if (checker.proxies.length === 0) {
      currentModuleWindow.webContents.send('proxy-loading-start');
      currentModuleWindow.webContents.send('log-message', {
        type: 'info',
        message: '🔄 Carregando proxies da Webshare...'
      });
      
      // Callback para reportar progresso real
      const progressCallback = (count) => {
        if (currentModuleWindow && !currentModuleWindow.isDestroyed()) {
          currentModuleWindow.webContents.send('proxy-loading-progress', { count });
        }
      };
      
      await checker.loadProxies(progressCallback);
      
      if (currentModuleWindow && !currentModuleWindow.isDestroyed()) {
        currentModuleWindow.webContents.send('proxy-loading-complete', { total: checker.proxies.length });
        currentModuleWindow.webContents.send('log-message', {
          type: 'success',
          message: `✅ ${checker.proxies.length} proxies carregados com sucesso!`
        });
      }
    }
    
    // Gera lote de CPFs
    const batchSize = config.batchSize || 20;
    const cpfs = CPFGenerator.generateMultiple(batchSize);
    
    console.log('[startContinuousChecking] Geração de lote de CPFs:', cpfs.length, 'CPFs');
    
    // Envia informações do lote para interface
    // Garante que as estatísticas do módulo existem
    if (!sessionStats[currentModuleName]) {
      sessionStats[currentModuleName] = {
        totalVerified: 0,
        validFound: 0,
        startTime: new Date(),
        intervalId: null
      };
    }
    const moduleStats = sessionStats[currentModuleName];
    const batchNumber = Math.floor(moduleStats.totalVerified / batchSize) + 1;
    if (currentModuleWindow && !currentModuleWindow.isDestroyed()) {
      currentModuleWindow.webContents.send('batch-info', {
        batchNumber,
        batchSize: cpfs.length,
        cpfs: cpfs.slice(0, 3), // Primeiros 3 CPFs para exibir
        totalCpfs: cpfs.length
      });
    }
    
    // Marca como "checking" quando inicia processamento do lote
    if (activeModules[currentModuleName]) {
      activeModules[currentModuleName].isChecking = true;
      updateModuleSelectorStatus();
      console.log('[startContinuousChecking] Marcando como checking (aura laranja)');
    }
    
    // Verifica lote de CPFs
    console.log('[startContinuousChecking] Iniciando verificação do lote...');
    const results = await checker.checkMultipleCPFs(cpfs);
    console.log('[startContinuousChecking] Lote processado:', results.length, 'resultados');
    
    // Remove status "checking" após processar (volta para aura verde)
    if (activeModules[currentModuleName]) {
      activeModules[currentModuleName].isChecking = false;
      updateModuleSelectorStatus();
      console.log('[startContinuousChecking] Removendo status checking (volta para aura verde)');
    }
    
    // Processa resultados do lote
    let validCPFsInBatch = 0;
    let errorsInBatch = 0;
    
    // moduleStats já foi declarado acima, apenas reutiliza
    
    results.forEach(result => {
      moduleStats.totalVerified++;
      
      if (result.success) {
        const status = result.interpretation === 'registered' ? 'registered' : 'not_registered';
        if (status === 'registered') {
          validCPFsInBatch++;
          moduleStats.validFound++;
        }
        let userData = null;
        let products = [];
        if (result.user) {
          userData = {
            id: result.user.id,
            name: result.user.nome || result.user.name,
            email: result.user.email || undefined,
            phone: result.user.telefone || result.user.phone
          };
        }
        if (result.products && result.products.success && Array.isArray(result.products.data)) {
          products = result.products.data.map(p => ({
            id: p?.rifa?.id || p?.id || 'N/A',
            title: p?.rifa?.title || p?.titulo || p?.title || 'Compra'
          }));
        }
        if (result.proxy && result.proxy !== 'Sem Proxy') {
          if (currentModuleWindow && !currentModuleWindow.isDestroyed()) {
            currentModuleWindow.webContents.send('proxy-info', {
              cpf: result.cpf,
              proxy: result.proxy,
              hasAuth: true
            });
          }
        }
        if (currentModuleWindow && !currentModuleWindow.isDestroyed()) {
          currentModuleWindow.webContents.send('cpf-result', {
            cpf: result.cpf,
            status,
            message: status === 'registered' ? 'CPF CADASTRADO' : 'CPF NÃO CADASTRADO',
            userData,
            products,
            proxy: result.proxy,
            workbuscas: result.workbuscas || null
          });
        }
        if (status === 'registered') {
          console.log(`[DEBUG] Salvando CPF ${result.cpf} - Has workbuscas:`, !!result.workbuscas);
          if (result.workbuscas) {
            console.log(`[DEBUG] WorkBuscas data:`, JSON.stringify(result.workbuscas, null, 2));
          }
          saveSingleValidCPF(result.cpf, result, false, currentModuleName);
        }
      } else {
        errorsInBatch++;
        if (currentModuleWindow && !currentModuleWindow.isDestroyed()) {
          currentModuleWindow.webContents.send('cpf-result', {
            cpf: result.cpf,
            status: 'error',
            message: `Erro: ${result.error}`,
            proxy: result.proxy
          });
        }
      }
    });
    
    // Envia resumo do lote
    if (currentModuleWindow && !currentModuleWindow.isDestroyed()) {
      currentModuleWindow.webContents.send('batch-summary', {
        validCPFsInBatch,
        errorsInBatch,
        totalValid: moduleStats.validFound,
        totalVerified: moduleStats.totalVerified
      });
    }
    
    // Continua verificação após delay - verifica tanto isRunning global quanto do módulo
    if (isRunning && activeModules[currentModuleName] && activeModules[currentModuleName].isRunning) {
      console.log('[startContinuousChecking] Agendando próximo lote em', config.delay || 5000, 'ms');
      moduleStats.intervalId = setTimeout(() => {
        startContinuousChecking(config);
      }, config.delay || 5000);
    } else {
      console.log('[startContinuousChecking] Parando - isRunning:', isRunning, 'módulo rodando:', activeModules[currentModuleName]?.isRunning);
      // Se parou, atualiza status no menu
      if (activeModules[currentModuleName]) {
        activeModules[currentModuleName].isRunning = false;
        activeModules[currentModuleName].isChecking = false;
        updateModuleSelectorStatus();
      }
      // Limpa intervalo do módulo
      if (moduleStats.intervalId) {
        clearTimeout(moduleStats.intervalId);
        moduleStats.intervalId = null;
      }
    }
    
  } catch (error) {
    console.error('[startContinuousChecking] Erro:', error);
    const errorModuleWindow = activeModules[currentModuleName]?.window;
    if (errorModuleWindow && !errorModuleWindow.isDestroyed()) {
      errorModuleWindow.webContents.send('cpf-result', {
        cpf: 'ERRO',
        status: 'error',
        message: `Erro fatal: ${error.message}`
      });
    }
    
    // Reinicia após erro - verifica se ainda está rodando
    // Garante que as estatísticas do módulo existem
    if (!sessionStats[currentModuleName]) {
      sessionStats[currentModuleName] = {
        totalVerified: 0,
        validFound: 0,
        startTime: new Date(),
        intervalId: null
      };
    }
    // Acessa moduleStats do escopo do objeto sessionStats (não precisa redeclarar)
    const errorModuleStats = sessionStats[currentModuleName];
    
    if (isRunning && activeModules[currentModuleName] && activeModules[currentModuleName].isRunning) {
      errorModuleStats.intervalId = setTimeout(() => {
        startContinuousChecking(config);
      }, 10000);
    } else {
      // Se parou, atualiza status no menu
      if (activeModules[currentModuleName]) {
        activeModules[currentModuleName].isRunning = false;
        activeModules[currentModuleName].isChecking = false;
        updateModuleSelectorStatus();
      }
    }
  }
}

async function saveValidCPF(result, moduleName = 'gemeos') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
  // Criar nome do arquivo baseado no nome da pessoa
  let personName = 'Desconhecido';
  if ((result.user && (result.user.nome || result.user.name)) || (result.data && result.data.user && result.data.user.name)) {
    const rawName = result.user ? (result.user.nome || result.user.name) : result.data.user.name;
    // Limpar nome para usar como nome de arquivo
    personName = rawName
      .replace(/[<>:"/\\|?*]/g, '') // Remover caracteres inválidos
      .replace(/\s+/g, '_') // Substituir espaços por underscore
      .substring(0, 50); // Limitar tamanho
  }
  
  // Cria pasta específica por módulo
  const listaDir = path.resolve(process.cwd(), 'lista', moduleName);
  if (!fs.existsSync(listaDir)) {
    fs.mkdirSync(listaDir, { recursive: true });
  }
  
  const filename = path.join(listaDir, `validado-${personName}-${result.cpf}.txt`);
  
  const moduleTitle = moduleName === 'gemeos' ? 'Gemeos Brasil' : 'Saúde Diária';
  
  let txtContent = '';
  txtContent += `🔍 CENTRAL DO ARRANCA - CPF VÁLIDO ENCONTRADO (${moduleTitle})\n`;
  txtContent += '='.repeat(55) + '\n\n';
  txtContent += `📅 Data/Hora: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n`;
  txtContent += `🔢 CPF: ${result.cpf}\n`;
  txtContent += `✅ Status: CADASTRADO\n\n`;
  
    const userBlock = result.user || (result.data && result.data.user) || null;
    if (userBlock) {
      const nome = userBlock.nome || userBlock.name || 'Desconhecido';
      const email = userBlock.email || '';
      const phone = userBlock.telefone || userBlock.phone || '';
      const moduleTitle = moduleName === 'gemeos' ? 'Gemeos Brasil' : 'Saúde Diária';
      txtContent += `👤 DADOS DO USUÁRIO (${moduleTitle}):\n`;
    if (userBlock.id !== undefined) txtContent += `   🆔 ID: ${userBlock.id}\n`;
    txtContent += `   📛 Nome: ${nome}\n`;
    if (email) txtContent += `   📧 Email: ${email}\n`;
    if (phone) txtContent += `   📱 Telefone: ${phone}\n`;
    txtContent += `\n`;
  }

  // Dados complementares da API WorkBuscas
  console.log(`[DEBUG saveValidCPF] Verificando workbuscas para CPF ${result.cpf}:`, !!result.workbuscas);
  if (result.workbuscas) {
    console.log(`[DEBUG saveValidCPF] WorkBuscas data recebido:`, JSON.stringify(result.workbuscas, null, 2));
    txtContent += `📊 DADOS COMPLEMENTARES (WorkBuscas):\n`;
    // Salva todos os telefones
    if (result.workbuscas.telefones && Array.isArray(result.workbuscas.telefones) && result.workbuscas.telefones.length > 0) {
      txtContent += `   📱 Telefones (${result.workbuscas.telefones.length}):\n`;
      result.workbuscas.telefones.forEach((tel, index) => {
        let telInfo = `      ${index + 1}. ${tel.numero}`;
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
      // Fallback para compatibilidade
      txtContent += `   📱 Telefone: ${result.workbuscas.telefone}\n`;
    }
    if (result.workbuscas.email) {
      txtContent += `   📧 Email: ${result.workbuscas.email}\n`;
    }
    if (result.workbuscas.renda) {
      txtContent += `   💰 Renda: R$ ${result.workbuscas.renda}\n`;
    }
    if (result.workbuscas.score) {
      txtContent += `   📈 Score CSB: ${result.workbuscas.score}\n`;
    }
    if (result.workbuscas.nomeMae) {
      txtContent += `   👩 Nome da Mãe: ${result.workbuscas.nomeMae}\n`;
    }
    if (result.workbuscas.dataNascimento) {
      txtContent += `   📅 Data de Nascimento: ${result.workbuscas.dataNascimento}\n`;
    }
    if (result.workbuscas.rg) {
      let rgInfo = `   🆔 RG: ${result.workbuscas.rg}`;
      if (result.workbuscas.rgOrgaoEmissor) {
        rgInfo += ` - ${result.workbuscas.rgOrgaoEmissor}`;
      }
      if (result.workbuscas.rgUfEmissao) {
        rgInfo += ` (${result.workbuscas.rgUfEmissao})`;
      }
      txtContent += `${rgInfo}\n`;
      if (result.workbuscas.rgDataEmissao) {
        txtContent += `   📅 Data de Emissão do RG: ${result.workbuscas.rgDataEmissao}\n`;
      }
    }
    txtContent += `\n`;
  } else {
    console.log(`[DEBUG saveValidCPF] CPF ${result.cpf} NÃO TEM dados workbuscas no resultado!`);
  }
  
  if (result.products && result.products.success && result.products.data && result.products.data.length > 0) {
    txtContent += `📦 PRODUTOS/TÍTULOS:\n`;
    result.products.data.forEach((p, index) => {
      const title = p?.rifa?.title || p?.rifa?.titulo || p?.titulo || p?.title || 'Produto';
      const date = p?.data || p?.insert || '';
      txtContent += `   ${index + 1}. ${title}${date ? ` - ${date}` : ''}\n`;
    });
    txtContent += '\n';
  }
  
  txtContent += '='.repeat(55) + '\n';
  txtContent += '💾 Salvo automaticamente pela Interface Gráfica\n';
  txtContent += '='.repeat(55) + '\n';
  
  await fs.writeFile(filename, txtContent, 'utf8');
  
  console.log(`💾 [${moduleName}] CPF válido salvo em: ${filename}`);
  
  // Envia notificação para a interface do módulo correto
  const moduleWindow = activeModules[moduleName]?.window;
  if (moduleWindow && !moduleWindow.isDestroyed()) {
    moduleWindow.webContents.send('cpf-saved', {
      filename,
      cpf: result.cpf
    });
  }
}

async function saveSingleValidCPF(cpf, result, isManualTest = false, moduleName = 'gemeos') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
  // Criar nome do arquivo baseado no nome da pessoa
  let personName = 'Desconhecido';
  if ((result.user && (result.user.nome || result.user.name)) || (result.data && result.data.user && result.data.user.name)) {
    const rawName = result.user ? (result.user.nome || result.user.name) : result.data.user.name;
    // Limpar nome para usar como nome de arquivo
    personName = rawName
      .replace(/[<>:"/\\|?*]/g, '') // Remover caracteres inválidos
      .replace(/\s+/g, '_') // Substituir espaços por underscore
      .substring(0, 50); // Limitar tamanho
  }
  
  // Cria pasta específica por módulo
  const listaDir = path.resolve(process.cwd(), 'lista', moduleName);
  if (!fs.existsSync(listaDir)) {
    fs.mkdirSync(listaDir, { recursive: true });
  }
  
  const filename = path.join(listaDir, isManualTest ? 
    `teste-${personName}-${cpf}.txt` : 
    `validado-${personName}-${cpf}.txt`);
  
  const moduleTitle = moduleName === 'gemeos' ? 'Gemeos Brasil' : 'Saúde Diária';
  
  let txtContent = '';
  if (isManualTest) {
    txtContent += `🔍 CENTRAL DO ARRANCA - TESTE DE CPF ESPECÍFICO (${moduleTitle})\n`;
    txtContent += '='.repeat(55) + '\n\n';
    txtContent += `📅 Data/Hora: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n`;
    txtContent += `🔢 CPF: ${cpf}\n`;
    txtContent += `✅ Status: CADASTRADO\n`;
    txtContent += `🧪 Tipo: TESTE MANUAL\n\n`;
  } else {
    txtContent += `🔍 CENTRAL DO ARRANCA - CPF VÁLIDO ENCONTRADO (${moduleTitle})\n`;
    txtContent += '='.repeat(55) + '\n\n';
    txtContent += `📅 Data/Hora: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n`;
    txtContent += `🔢 CPF: ${cpf}\n`;
    txtContent += `✅ Status: CADASTRADO\n`;
    txtContent += `🧪 Tipo: VERIFICAÇÃO AUTOMÁTICA\n\n`;
  }
  
    const userBlock2 = result.user || (result.data && result.data.user) || null;
    if (userBlock2) {
      const nome2 = userBlock2.nome || userBlock2.name || 'Desconhecido';
      const email2 = userBlock2.email || '';
      const phone2 = userBlock2.telefone || userBlock2.phone || '';
      txtContent += `👤 DADOS DO USUÁRIO (${moduleTitle}):\n`;
    if (userBlock2.id !== undefined) txtContent += `   🆔 ID: ${userBlock2.id}\n`;
    txtContent += `   📛 Nome: ${nome2}\n`;
    if (email2) txtContent += `   📧 Email: ${email2}\n`;
    if (phone2) txtContent += `   📱 Telefone: ${phone2}\n`;
    txtContent += `\n`;
  }

  // Dados complementares da API WorkBuscas
  console.log(`[DEBUG saveSingleValidCPF] Verificando workbuscas para CPF ${cpf}:`, !!result.workbuscas);
  if (result.workbuscas) {
    console.log(`[DEBUG saveSingleValidCPF] WorkBuscas data recebido:`, JSON.stringify(result.workbuscas, null, 2));
    txtContent += `📊 DADOS COMPLEMENTARES (WorkBuscas):\n`;
    // Salva todos os telefones
    if (result.workbuscas.telefones && Array.isArray(result.workbuscas.telefones) && result.workbuscas.telefones.length > 0) {
      txtContent += `   📱 Telefones (${result.workbuscas.telefones.length}):\n`;
      result.workbuscas.telefones.forEach((tel, index) => {
        let telInfo = `      ${index + 1}. ${tel.numero}`;
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
      // Fallback para compatibilidade
      txtContent += `   📱 Telefone: ${result.workbuscas.telefone}\n`;
    }
    if (result.workbuscas.email) {
      txtContent += `   📧 Email: ${result.workbuscas.email}\n`;
    }
    if (result.workbuscas.renda) {
      txtContent += `   💰 Renda: R$ ${result.workbuscas.renda}\n`;
    }
    if (result.workbuscas.score) {
      txtContent += `   📈 Score CSB: ${result.workbuscas.score}\n`;
    }
    if (result.workbuscas.nomeMae) {
      txtContent += `   👩 Nome da Mãe: ${result.workbuscas.nomeMae}\n`;
    }
    if (result.workbuscas.dataNascimento) {
      txtContent += `   📅 Data de Nascimento: ${result.workbuscas.dataNascimento}\n`;
    }
    if (result.workbuscas.rg) {
      let rgInfo = `   🆔 RG: ${result.workbuscas.rg}`;
      if (result.workbuscas.rgOrgaoEmissor) {
        rgInfo += ` - ${result.workbuscas.rgOrgaoEmissor}`;
      }
      if (result.workbuscas.rgUfEmissao) {
        rgInfo += ` (${result.workbuscas.rgUfEmissao})`;
      }
      txtContent += `${rgInfo}\n`;
      if (result.workbuscas.rgDataEmissao) {
        txtContent += `   📅 Data de Emissão do RG: ${result.workbuscas.rgDataEmissao}\n`;
      }
    }
    txtContent += `\n`;
  } else {
    console.log(`[DEBUG saveSingleValidCPF] CPF ${cpf} NÃO TEM dados workbuscas no resultado!`);
  }
  
  if (result.products && result.products.success && result.products.data && result.products.data.length > 0) {
    txtContent += `📦 PRODUTOS/TÍTULOS:\n`;
    result.products.data.forEach((p, index) => {
      const title = p?.rifa?.title || p?.rifa?.titulo || p?.titulo || p?.title || 'Produto';
      const date = p?.data || p?.insert || '';
      txtContent += `   ${index + 1}. ${title}${date ? ` - ${date}` : ''}\n`;
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
  
  await fs.writeFile(filename, txtContent, 'utf8');
  
  console.log(`💾 [${moduleName}] CPF válido salvo em: ${filename}`);
  
  // Envia notificação para a interface do módulo correto
  const moduleWindow = activeModules[moduleName]?.window;
  if (moduleWindow && !moduleWindow.isDestroyed()) {
    moduleWindow.webContents.send('cpf-saved', {
      filename,
      cpf: cpf
    });
  }
}
