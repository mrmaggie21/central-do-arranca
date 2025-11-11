const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
// Função simples de geração de CPF (substitui cpf-generator.js)
function generateCPF() {
  const n1 = Math.floor(Math.random() * 9);
  const n2 = Math.floor(Math.random() * 9);
  const n3 = Math.floor(Math.random() * 9);
  const n4 = Math.floor(Math.random() * 9);
  const n5 = Math.floor(Math.random() * 9);
  const n6 = Math.floor(Math.random() * 9);
  const n7 = Math.floor(Math.random() * 9);
  const n8 = Math.floor(Math.random() * 9);
  const n9 = Math.floor(Math.random() * 9);
  
  let d1 = n9*2 + n8*3 + n7*4 + n6*5 + n5*6 + n4*7 + n3*8 + n2*9 + n1*10;
  d1 = 11 - (d1 % 11);
  if (d1 >= 10) d1 = 0;
  
  let d2 = d1*2 + n9*3 + n8*4 + n7*5 + n6*6 + n5*7 + n4*8 + n3*9 + n2*10 + n1*11;
  d2 = 11 - (d2 % 11);
  if (d2 >= 10) d2 = 0;
  
  return `${n1}${n2}${n3}${n4}${n5}${n6}${n7}${n8}${n9}${d1}${d2}`;
}

function generateMultipleCPFs(count) {
  const cpfs = [];
  for (let i = 0; i < count; i++) {
    cpfs.push(generateCPF());
  }
  return cpfs;
}
const GemeosChecker = require('../modules/gemeos/checker');
const SaudeChecker = require('../modules/saude/checker');
const WorkBuscasChecker = require('../modules/workbuscas/checker');
const TelesenaChecker = require('../modules/telesena/checker');
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
  } else if (moduleName === 'telesena') {
    htmlFile = 'telesena-checker.html';
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
  // Splash screen criada
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
  
  // Aguardando carregamento do splash
  
  // Aguarda a splash estar pronta antes de verificar atualizações
  return new Promise((resolve) => {
    splashWindow.webContents.once('did-finish-load', () => {
      // Splash HTML carregado
      // Aguarda mais um pouco para garantir que o JS está rodando
      setTimeout(() => {
        // Splash pronta
        resolve();
      }, 300);
    });
    
    splashWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error('[Splash] ERRO ao carregar splash:', errorCode, errorDescription);
    });
  });
}

function createModuleSelector() {
  // Criando seletor de módulos
  
  // Se já existe e não está destruída, não cria novamente
  if (moduleSelectorWindow && !moduleSelectorWindow.isDestroyed()) {
    // Janela já existe, focando
    moduleSelectorWindow.show();
    moduleSelectorWindow.focus();
    return;
  }
  
  moduleSelectorWindow = new BrowserWindow({
    width: 800,
    height: 600,
    resizable: false,
    frame: false,
    alwaysOnTop: false, // Mudado para false para não conflitar com splash
    transparent: false,
    show: true, // Mostra imediatamente
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  
  const htmlPath = path.join(__dirname, 'module-selector.html');
  // Verificando arquivo HTML do seletor
  
  if (!fs.existsSync(htmlPath)) {
    console.error('[ModuleSelector] ❌ ERRO CRÍTICO: Arquivo module-selector.html não encontrado!');
    console.error('[ModuleSelector] Procurando em:', __dirname);
    const files = fs.readdirSync(__dirname);
    console.error('[ModuleSelector] Arquivos disponíveis:', files);
    return;
  }
  
  moduleSelectorWindow.loadFile(htmlPath);
  moduleSelectorWindow.center();
  
  // Aguardando carregamento HTML do seletor
  
  // Atualiza o status quando o menu carregar
  moduleSelectorWindow.webContents.once('did-finish-load', () => {
    // HTML do seletor carregado
    updateModuleSelectorStatus();
    // Garante que está visível
    if (moduleSelectorWindow && !moduleSelectorWindow.isDestroyed()) {
      moduleSelectorWindow.show();
      moduleSelectorWindow.focus();
      // Janela visível e focada
    } else {
      console.error('[ModuleSelector] ❌ Janela foi destruída após carregar!');
    }
  });
  
  // Log de erro se houver
  moduleSelectorWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('[ModuleSelector] ❌ ERRO ao carregar HTML!');
    console.error('[ModuleSelector] Error Code:', errorCode);
    console.error('[ModuleSelector] Description:', errorDescription);
    console.error('[ModuleSelector] URL:', validatedURL);
  });
  
  // Log quando está pronto para mostrar
  moduleSelectorWindow.once('ready-to-show', () => {
    // Janela pronta para mostrar
    if (moduleSelectorWindow && !moduleSelectorWindow.isDestroyed()) {
      moduleSelectorWindow.show();
      moduleSelectorWindow.focus();
      // Janela mostrada
    }
  });
  
  // Log quando a janela é mostrada
  moduleSelectorWindow.on('show', () => {
    // Evento show disparado
  });
}

function updateModuleSelectorStatus() {
  if (moduleSelectorWindow && !moduleSelectorWindow.isDestroyed()) {
    // Cria versão serializável do activeModules (remove referências de BrowserWindow)
    const serializableStatus = {};
    for (const [moduleName, moduleData] of Object.entries(activeModules)) {
      serializableStatus[moduleName] = {
        isRunning: moduleData.isRunning || false,
        isChecking: moduleData.isChecking || false,
        // Não inclui 'window' pois não pode ser serializado
      };
    }
    moduleSelectorWindow.webContents.send('update-modules-status', serializableStatus);
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
    
    // Garante que a splash está pronta
    if (splashWindow && !splashWindow.isDestroyed()) {
      // Mostra mensagem inicial
      splashWindow.webContents.send('splash-log', '🔍 Verificando atualizações no GitHub...');
    } else {
      console.warn('[Updater] Splash window não está disponível');
    }
    
    const updateInfo = await updater.checkForUpdates();
    
    if (updateInfo && updateInfo.available) {
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
      }
    }
  } catch (error) {
    console.error('[Updater] Erro ao verificar atualizações:', error);
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.send('splash-log', `⚠️ Erro ao verificar atualizações: ${error.message}`);
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
  checkers['telesena'] = new TelesenaChecker({
    delay: 2000,
    timeout: 15000,
    maxRetries: 2
  });
  
  // Carrega proxies do Gemeos E Saúde na inicialização
  const gemeosChecker = checkers['gemeos'];
  const saudeChecker = checkers['saude'];
  
  // Progresso no splash
  const progressCallback = (count) => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      // Normaliza para máximo 1000 (pode vir mais se estiver testando)
      const normalizedCount = Math.min(count, 1000);
      splashWindow.webContents.send('splash-progress', { count: normalizedCount });
      // Log a cada 100 proxies ou quando completa
      if (count > 0 && (count % 100 === 0 || count >= 1000)) {
        const message = count >= 1000 
          ? `✅ ${normalizedCount} proxies carregados!` 
          : `✅ ${count} proxies carregados...`;
        splashWindow.webContents.send('splash-log', message);
      }
    }
  };
  try {
    // Sinaliza início (splash-start atualiza status, splash-log adiciona no log)
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.send('splash-start');
      splashWindow.webContents.send('splash-log', 'Carregando proxies da Webshare...');
    }
    const start = Date.now();
    // Carregando proxies do Gemeos...
    
    // Carrega proxies do Gemeos
    await gemeosChecker.loadProxies(progressCallback);
    // Gemeos proxies carregados
    
    // Força completar progresso se ainda não completou
    if (progressCallback) {
      // Forçando progresso
      progressCallback(1000);
    }
    
    // Carrega proxies do Saúde também (sem mostrar progresso no splash)
    // FAZ EM PARALELO/ASSÍNCRONO PARA NÃO TRAVAR
    // ADICIONA DELAY MAIOR PARA EVITAR RATE LIMIT COM GEMEOS
    if (saudeChecker && (!saudeChecker.proxies || saudeChecker.proxies.length === 0)) {
      // Carregando proxies do Saúde em background...
      // Aguarda 10 segundos antes de iniciar para não conflitar com Gemeos (aumentado)
      setTimeout(() => {
        console.log('[GUI] Iniciando carregamento de proxies do Saúde agora...');
        saudeChecker.loadProxies(null).then(() => {
          console.log(`[GUI] ✅ Saúde proxies carregados: ${saudeChecker.proxies.length}`);
        }).catch((err) => {
          if (err.response?.status === 429) {
            // Saúde: Rate limit detectado, usando cache
            // Se tiver cache, tenta carregar do cache
            const cachePath = require('path').join(__dirname, '../.cache/proxies-saude.json');
            const fs = require('fs-extra');
            if (fs.existsSync(cachePath)) {
              try {
                const cacheData = fs.readJsonSync(cachePath);
                if (cacheData.proxies && cacheData.proxies.length > 0) {
                  saudeChecker.proxies = cacheData.proxies;
                  // Saúde: Proxies carregados do cache
                }
              } catch (e) {
                // Não foi possível carregar cache do Saúde
              }
            }
          } else {
            console.error(`[GUI] ❌ Erro ao carregar proxies do Saúde:`, err.message);
          }
        });
      }, 10000); // 10 segundos de delay (aumentado para evitar rate limit)
      // Saúde carregando em background
    }
    
    // Garante duração mínima de 1000ms para visualizar carregamento (reduzido)
    const elapsed = Date.now() - start;
    console.log(`[GUI] Tempo decorrido: ${elapsed}ms`);
    if (elapsed < 1000) {
      const remaining = 1000 - elapsed;
      console.log(`[GUI] Aguardando mais ${remaining}ms para completar animação...`);
      await new Promise(r => setTimeout(r, remaining));
    } else {
      console.log(`[GUI] Tempo suficiente decorrido, prosseguindo imediatamente`);
    }
    
    // Força progresso final
    if (progressCallback) {
      progressCallback(1000);
    }
    
    if (splashWindow && !splashWindow.isDestroyed()) {
      const totalValid = gemeosChecker?.proxies?.length || 0;
      const totalSaude = saudeChecker?.proxies?.length || 0;
      splashWindow.webContents.send('splash-log', `✅ ${totalValid} proxies Gemeos carregados`);
      if (totalSaude > 0) {
        splashWindow.webContents.send('splash-log', `✅ ${totalSaude} proxies Saúde carregados`);
      }
      splashWindow.webContents.send('splash-log', 'Preparando interface...');
      // Força progresso final na UI
      splashWindow.webContents.send('splash-progress', { count: 1000 });
    }
    // Carregamento de proxies concluído
  } catch (e) {
    console.error('[Splash] ❌❌❌ ERRO ao carregar proxies:', e);
    console.error('[Splash] Stack:', e.stack);
    // Completa progresso mesmo em erro para não travar
    if (progressCallback) {
      progressCallback(1000);
    }
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.send('splash-progress', { count: 1000 });
      splashWindow.webContents.send('splash-log', '⚠️ Erro ao carregar alguns proxies, continuando...');
    }
    // Carregamento concluído (com erros)
    // Ignora; seguirá com o que houver
  }
  
  // TRANSIÇÃO ULTRA SIMPLIFICADA - SEM AWAITS DESNECESSÁRIOS
  // Iniciando transição para seletor de módulos
  
  // Força progresso final
  if (progressCallback) progressCallback(1000);
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash-progress', { count: 1000 });
    splashWindow.webContents.send('splash-log', '✅ Carregamento completo!');
  }
  
  // Criando module selector
  if (!moduleSelectorWindow || moduleSelectorWindow.isDestroyed()) {
    createModuleSelector();
  } else {
    moduleSelectorWindow.show();
    moduleSelectorWindow.focus();
  }
  
  // Aguarda apenas 300ms para HTML carregar (reduzido ao mínimo)
  await new Promise(r => setTimeout(r, 300));
  
  // Fechando splash
  if (splashWindow && !splashWindow.isDestroyed()) {
    try {
      splashWindow.setAlwaysOnTop(false);
      splashWindow.hide();
      splashWindow.close();
      splashWindow = null;
    } catch (e) {
      console.error('[Splash] Erro ao fechar splash:', e);
      try {
        splashWindow.destroy();
        splashWindow = null;
      } catch (e2) {}
    }
  }
  
  // Garantindo module selector visível
  if (moduleSelectorWindow && !moduleSelectorWindow.isDestroyed()) {
    moduleSelectorWindow.show();
    moduleSelectorWindow.focus();
    moduleSelectorWindow.moveTop();
  } else {
    createModuleSelector();
    setTimeout(() => {
      if (moduleSelectorWindow && !moduleSelectorWindow.isDestroyed()) {
        moduleSelectorWindow.show();
        moduleSelectorWindow.focus();
      }
    }, 300);
  }
  
  // Garantia final - força transição após 1 segundo
  setTimeout(() => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      try {
        splashWindow.setAlwaysOnTop(false);
        splashWindow.hide();
        splashWindow.close();
        splashWindow.destroy();
        splashWindow = null;
      } catch (e) {
        splashWindow = null;
      }
    }
    
    if (!moduleSelectorWindow || moduleSelectorWindow.isDestroyed()) {
      try {
        createModuleSelector();
      } catch (e) {}
    }
    
    setTimeout(() => {
      if (moduleSelectorWindow && !moduleSelectorWindow.isDestroyed()) {
        moduleSelectorWindow.show();
        moduleSelectorWindow.focus();
        moduleSelectorWindow.moveTop();
      }
    }, 200);
  }, 1000);
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
  if (moduleName === 'gemeos' || moduleName === 'saude' || moduleName === 'workbuscas' || moduleName === 'telesena') {
    // Apenas cria a janela do checker se não existir ainda
    if (!activeModules[moduleName] || activeModules[moduleName].window.isDestroyed()) {
      const moduleWindow = createWindow(moduleName);
      
      // LÓGICA IGUAL AO GEMEOS - MAS CARREGA PROXIES SE PRECISAR
      moduleWindow.webContents.once('did-finish-load', async () => {
        if (moduleName === 'workbuscas') {
          // WorkBuscas não usa proxies
          moduleWindow.webContents.send('log-message', { type: 'success', message: `✅ WorkBuscas Checker pronto para uso!` });
        } else if (moduleName === 'telesena') {
          // Telesena usa proxies (mesmo comportamento do Gemeos/Saúde)
          const moduleChecker = checkers[moduleName];
          
          if (moduleChecker.proxies && moduleChecker.proxies.length > 0) {
            const total = moduleChecker.proxies.length;
            moduleWindow.webContents.send('proxy-loading-start');
            moduleWindow.webContents.send('proxy-loading-progress', { count: total });
            moduleWindow.webContents.send('proxy-loading-complete', { total });
            moduleWindow.webContents.send('log-message', { type: 'success', message: `✅ ${total} proxies carregados com sucesso!` });
          } else {
            moduleWindow.webContents.send('proxy-loading-start');
            moduleWindow.webContents.send('log-message', {
              type: 'info',
              message: '🔄 Carregando proxies...'
            });
            
            const progressCallback = (count) => {
              if (moduleWindow && !moduleWindow.isDestroyed()) {
                moduleWindow.webContents.send('proxy-loading-progress', { count });
              }
            };
            
            try {
              await moduleChecker.loadProxies(progressCallback);
              const total = moduleChecker.proxies.length;
              
              if (moduleWindow && !moduleWindow.isDestroyed()) {
                moduleWindow.webContents.send('proxy-loading-progress', { count: total });
                moduleWindow.webContents.send('proxy-loading-complete', { total });
                moduleWindow.webContents.send('log-message', {
                  type: 'success',
                  message: `✅ ${total} proxies carregados com sucesso!`
                });
              }
            } catch (error) {
              console.error(`[${moduleName}] ERRO:`, error);
              const total = moduleChecker.proxies?.length || 0;
              if (moduleWindow && !moduleWindow.isDestroyed()) {
                moduleWindow.webContents.send('proxy-loading-progress', { count: total });
                moduleWindow.webContents.send('proxy-loading-complete', { total });
                moduleWindow.webContents.send('log-message', {
                  type: 'error',
                  message: `❌ Erro: ${error.message}`
                });
              }
            }
          }
        } else {
          const moduleChecker = checkers[moduleName];
          
          // Verifica se tem proxies carregados na memória PRIMEIRO
          if (moduleChecker.proxies && moduleChecker.proxies.length > 0) {
            // JÁ TEM PROXIES NA MEMÓRIA - usa direto (igual Gemeos)
            const total = moduleChecker.proxies.length;
            // Proxies já carregados na memória
            moduleWindow.webContents.send('proxy-loading-start');
            moduleWindow.webContents.send('proxy-loading-progress', { count: total });
            moduleWindow.webContents.send('proxy-loading-complete', { total });
            moduleWindow.webContents.send('log-message', { type: 'success', message: `✅ ${total} proxies carregados com sucesso!` });
          } else {
            // NÃO TEM PROXIES - carrega (vai usar cache se tiver)
            // Carregando proxies...
            moduleWindow.webContents.send('proxy-loading-start');
            moduleWindow.webContents.send('log-message', {
              type: 'info',
              message: '🔄 Carregando proxies...'
            });
            
            // Callback para progresso
            const progressCallback = (count) => {
              // Progresso: proxies carregados
              if (moduleWindow && !moduleWindow.isDestroyed()) {
                moduleWindow.webContents.send('proxy-loading-progress', { count });
              }
            };
            
            try {
              await moduleChecker.loadProxies(progressCallback);
              const total = moduleChecker.proxies.length;
              // Proxies carregados
              
              if (moduleWindow && !moduleWindow.isDestroyed()) {
                moduleWindow.webContents.send('proxy-loading-progress', { count: total });
                moduleWindow.webContents.send('proxy-loading-complete', { total });
                moduleWindow.webContents.send('log-message', {
                  type: 'success',
                  message: `✅ ${total} proxies carregados com sucesso!`
                });
              }
            } catch (error) {
              console.error(`[${moduleName}] ERRO:`, error);
              const total = moduleChecker.proxies?.length || 0;
              if (moduleWindow && !moduleWindow.isDestroyed()) {
                moduleWindow.webContents.send('proxy-loading-progress', { count: total });
                moduleWindow.webContents.send('proxy-loading-complete', { total });
                moduleWindow.webContents.send('log-message', {
                  type: 'error',
                  message: `❌ Erro: ${error.message}`
                });
              }
            }
          }
          
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
  // Retorna versão serializável (sem referências de BrowserWindow)
  const serializableStatus = {};
  for (const [moduleName, moduleData] of Object.entries(activeModules)) {
    serializableStatus[moduleName] = {
      isRunning: moduleData.isRunning || false,
      isChecking: moduleData.isChecking || false,
      // Não inclui 'window' pois não pode ser serializado
    };
  }
  return serializableStatus;
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
  }
  
  // Abre/mostra o menu de módulos
  if (!moduleSelectorWindow || moduleSelectorWindow.isDestroyed()) {
    createModuleSelector();
  } else {
    moduleSelectorWindow.focus();
  }
  
  // Atualiza o status dos módulos no menu após um pequeno delay
  setTimeout(() => {
    updateModuleSelectorStatus();
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
  
  // Verifica se o módulo existe
  if (!activeModules[moduleName]) {
    return { success: false, message: `Módulo ${moduleName} não encontrado. Feche e abra a janela novamente.` };
  }
  
  // Verifica se já está rodando
  if (activeModules[moduleName].isRunning) {
    return { success: false, message: 'Verificação já está em execução' };
  }
  
  // Marca o módulo como rodando ANTES de fazer qualquer coisa
  activeModules[moduleName].isRunning = true;
  
  // Atualiza isRunning global baseado em se há algum módulo rodando
  const hasRunningModules = Object.values(activeModules).some(m => m.isRunning);
  isRunning = hasRunningModules;
  
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
  
  // Reseta rate limiter ao iniciar nova verificação (evita bloqueios de execuções anteriores)
  if (checkers[moduleName] && checkers[moduleName].rateLimiter) {
    checkers[moduleName].rateLimiter.reset();
  }
  
  // Atualiza o menu de módulos ANTES de iniciar (para mostrar aura verde imediatamente)
  updateModuleSelectorStatus();
  
  // Pequeno delay para garantir que o IPC foi processado
  setTimeout(() => {
    updateModuleSelectorStatus();
  }, 50);
  
  // Verifica se já existe um intervalo rodando para este módulo (evita múltiplas instâncias)
  if (sessionStats[moduleName] && sessionStats[moduleName].intervalId) {
    clearTimeout(sessionStats[moduleName].intervalId);
    sessionStats[moduleName].intervalId = null;
  }
  
  // Inicia verificação contínua ESPECÍFICA PARA ESTE MÓDULO (não await para não bloquear)
  // IMPORTANTE: Cada módulo roda sua própria instância de startContinuousChecking em paralelo
  setTimeout(() => {
    startContinuousChecking(config, moduleName).catch(err => {
      console.error(`[${moduleName.toUpperCase()}] Erro ao iniciar:`, err.message);
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
  } catch (error) {
    console.error('❌ Erro ao abrir pasta:', error.message);
    // Fallback: abrir pasta pai
    await shell.openPath(path.dirname(listaPath));
  }
});

ipcMain.handle('generate-test-cpf', async () => {
  return generateCPF();
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
    } else if (moduleName === 'telesena') {
      checkers[moduleName] = new TelesenaChecker({
        delay: 2000,
        timeout: 15000
      });
    }
  }
  
  const checker = checkers[moduleName];
  
  try {
    // Cria callback de status para atualizações em tempo real (especialmente para Saúde)
    let currentProxy = null;
    const statusCallback = (status, cpf, extra = null, proxy = null) => {
      // Atualiza proxy atual se fornecido
      if (proxy) {
        currentProxy = proxy;
      }
      
      if (moduleWindow && !moduleWindow.isDestroyed()) {
        let statusText = 'Testando CPF específico...';
        if (status === 'buscando_email') {
          statusText = 'Buscando email e telefone no WorkBuscas...';
        } else if (status === 'dados_insuficientes') {
          statusText = 'Dados insuficientes no WorkBuscas';
        } else if (status === 'testando') {
          statusText = 'Testando na API do Saúde Diária...';
        } else if (status === 'testando_email') {
          statusText = `Testando email ${extra}...`;
        } else if (status === 'retry') {
          statusText = `Tentando novamente (tentativa ${extra})...`;
        }
        
        moduleWindow.webContents.send('cpf-checking', { 
          cpf, 
          count: 1,
          statusText: statusText,
          proxy: currentProxy || proxy || 'N/A'
        });
      }
    };
    
    // Chama checkCPF com statusCallback (para módulos que suportam, como Saúde)
    const result = moduleName === 'saude' 
      ? await checker.checkCPF(cpf, false, statusCallback)
      : await checker.checkCPF(cpf);
    
    // Envia resultado inicial para interface
    if (moduleWindow && !moduleWindow.isDestroyed()) {
      moduleWindow.webContents.send('cpf-checking', { 
        cpf, 
        count: 1,
        statusText: 'Processando...',
        proxy: result.proxy || 'N/A'
      });
    }
    
    // WorkBuscas tem formato diferente
    if (moduleName === 'workbuscas') {
      
      if (result.success) {
        const status = result.interpretation === 'found' ? 'found' : 'not_found';
        
        
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
        return {
          success: false,
          error: result.error || 'Erro ao consultar CPF',
          status: result.status
        };
      }
    }
    
    // Código original para Gemeos, Saúde e Telesena
    console.log('[MAIN] DEBUG - Resultado do teste:', JSON.stringify(result, null, 2));
    console.log('[MAIN] DEBUG - result.success:', result.success);
    console.log('[MAIN] DEBUG - result.interpretation:', result.interpretation);
    console.log('[MAIN] DEBUG - moduleWindow existe?', !!moduleWindow);
    console.log('[MAIN] DEBUG - moduleWindow.isDestroyed?', moduleWindow ? moduleWindow.isDestroyed() : 'N/A');
    
    if (result.success) {
      const status = result.interpretation === 'registered' ? 'registered' : 'not_registered';
      console.log('[MAIN] DEBUG - Status calculado:', status);
      
      // IMPORTANTE: Atualiza estatísticas do módulo para teste específico também contar
      if (!sessionStats[moduleName]) {
        sessionStats[moduleName] = {
          totalVerified: 0,
          validFound: 0,
          errors: 0,
          startTime: null,
          intervalId: null
        };
      }
      const moduleStats = sessionStats[moduleName];
      
      // Incrementa total de verificados
      moduleStats.totalVerified++;
      
      // Se registrado, incrementa válidos
      if (status === 'registered') {
        moduleStats.validFound++;
      }
      
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
        console.log('[MAIN] DEBUG - userData extraído:', userData);
      }
      
      if (result.products && result.products.success && Array.isArray(result.products.data)) {
        products = result.products.data.map(p => ({
          id: p?.rifa?.id || p?.id || 'N/A',
          title: p?.rifa?.title || p?.titulo || p?.title || 'Compra'
        }));
        console.log('[MAIN] DEBUG - products extraídos:', products.length, 'produtos');
      }
      
      if (status === 'registered') {
        console.log('[MAIN] DEBUG - Salvando CPF válido...');
        await saveSingleValidCPF(cpf, result, true, moduleName);
      }
      
      const resultData = {
        cpf,
        status,
        message,
        userData,
        products,
        proxy: result.proxy,
        workbuscas: result.workbuscas || null,
        emailMascarado: result.emailMascarado || null,
        finalTelefone: result.finalTelefone || null
      };
      
      console.log('[MAIN] DEBUG - Enviando cpf-result com dados:', JSON.stringify(resultData, null, 2));
      
      if (moduleWindow && !moduleWindow.isDestroyed()) {
        moduleWindow.webContents.send('cpf-result', resultData);
        console.log('[MAIN] DEBUG - ✅ cpf-result enviado para a interface');
      } else {
        console.log('[MAIN] DEBUG - ❌ Não foi possível enviar cpf-result - janela não disponível');
      }
    } else {
      console.log('[MAIN] DEBUG - Resultado não teve sucesso, enviando erro');
      
      // IMPORTANTE: Atualiza estatísticas mesmo em caso de erro (conta como verificado)
      if (!sessionStats[moduleName]) {
        sessionStats[moduleName] = {
          totalVerified: 0,
          validFound: 0,
          errors: 0,
          startTime: null,
          intervalId: null
        };
      }
      const moduleStats = sessionStats[moduleName];
      moduleStats.totalVerified++; // Conta como verificado mesmo com erro
      if (!moduleStats.errors) moduleStats.errors = 0;
      moduleStats.errors++;
      
      const errorData = {
        cpf,
        status: 'error',
        message: `Erro: ${result.error}`,
        errorCode: result.status
      };
      console.log('[MAIN] DEBUG - Enviando cpf-result (erro):', JSON.stringify(errorData, null, 2));
      
      if (moduleWindow && !moduleWindow.isDestroyed()) {
        moduleWindow.webContents.send('cpf-result', errorData);
        console.log('[MAIN] DEBUG - ✅ cpf-result (erro) enviado para a interface');
      } else {
        console.log('[MAIN] DEBUG - ❌ Não foi possível enviar cpf-result (erro) - janela não disponível');
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

async function startContinuousChecking(config, moduleName) {
  // Cada módulo roda independentemente - TODOS podem rodar simultaneamente
  // Verifica se o módulo específico está rodando
  if (!activeModules[moduleName] || !activeModules[moduleName].isRunning) {
    return;
  }
  
  
  try {
    // Pega a janela do módulo específico
    const currentModuleWindow = activeModules[moduleName]?.window;
    if (!currentModuleWindow || currentModuleWindow.isDestroyed()) {
      // Se a janela foi fechada, para o processamento e atualiza status
      if (activeModules[moduleName]) {
        activeModules[moduleName].isRunning = false;
        activeModules[moduleName].isChecking = false;
        updateModuleSelectorStatus();
      }
      return;
    }
    
    // Pega o checker específico do módulo
    const checker = checkers[moduleName];
    if (!checker) {
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
      
      try {
        await checker.loadProxies(progressCallback);
        
        if (currentModuleWindow && !currentModuleWindow.isDestroyed()) {
          currentModuleWindow.webContents.send('proxy-loading-complete', { total: checker.proxies.length });
          currentModuleWindow.webContents.send('log-message', {
            type: 'success',
            message: `✅ ${checker.proxies.length} proxies carregados com sucesso!`
          });
        }
      } catch (err) {
        // Se der erro mas tiver algum proxy, continua mesmo assim
        if (checker.proxies.length > 0) {
          // Erro ao carregar proxies, mas já tem na memória
          if (currentModuleWindow && !currentModuleWindow.isDestroyed()) {
            currentModuleWindow.webContents.send('proxy-loading-complete', { total: checker.proxies.length });
            currentModuleWindow.webContents.send('log-message', {
              type: 'warning',
              message: `⚠️ ${checker.proxies.length} proxies carregados (alguns erros durante carregamento)`
            });
          }
        } else {
          // Se não tem nenhum proxy, tenta cache
          const cachePath = require('path').join(__dirname, `../.cache/proxies-${moduleName}.json`);
          const fs = require('fs-extra');
          if (fs.existsSync(cachePath)) {
            try {
              const cacheData = fs.readJsonSync(cachePath);
              if (cacheData.proxies && cacheData.proxies.length > 0) {
                checker.proxies = cacheData.proxies;
                // Proxies carregados do cache
                if (currentModuleWindow && !currentModuleWindow.isDestroyed()) {
                  currentModuleWindow.webContents.send('proxy-loading-complete', { total: checker.proxies.length });
                  currentModuleWindow.webContents.send('log-message', {
                    type: 'success',
                    message: `✅ ${checker.proxies.length} proxies carregados do cache!`
                  });
                }
              }
            } catch (e) {
              console.error(`[${moduleName}] Erro ao carregar cache:`, e);
            }
          }
          
          // Se ainda não tem proxies, permite continuar sem proxies (pode funcionar sem)
          if (checker.proxies.length === 0) {
            // Nenhum proxy disponível, continuando sem proxy
            if (currentModuleWindow && !currentModuleWindow.isDestroyed()) {
              currentModuleWindow.webContents.send('proxy-loading-complete', { total: 0 });
              currentModuleWindow.webContents.send('log-message', {
                type: 'warning',
                message: `⚠️ Nenhum proxy disponível. Continuando sem proxies...`
              });
            }
          }
        }
      }
    }
    
    // Gera lote de CPFs
    const batchSize = config.batchSize || 20;
    const cpfs = generateMultipleCPFs(batchSize);
    
    // Envia informações do lote para interface
    // Garante que as estatísticas do módulo existem
    if (!sessionStats[moduleName]) {
      sessionStats[moduleName] = {
        totalVerified: 0,
        validFound: 0,
        startTime: new Date(),
        intervalId: null
      };
    }
    const moduleStats = sessionStats[moduleName];
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
    if (activeModules[moduleName]) {
      activeModules[moduleName].isChecking = true;
      updateModuleSelectorStatus();
    }
    
    // Callback para atualizar status em tempo real
    const statusCallback = (status, cpf, extra = null) => {
      if (currentModuleWindow && !currentModuleWindow.isDestroyed()) {
        let statusText = '';
        let statusType = 'checking';
        
        switch (status) {
          case 'buscando_email':
            statusText = '🔍 Buscando email';
            break;
          case 'dados_insuficientes':
            statusText = '⚠️ Dados insuficientes';
            statusType = 'skipped';
            break;
          case 'testando':
            statusText = '🧪 Testando...';
            break;
          case 'testando_email':
            statusText = `🧪 Testando email ${extra}`;
            break;
          case 'retry':
            statusText = `🔄 Retry ${extra}`;
            break;
          default:
            statusText = '⏳ Processando...';
        }
        
        // Obtém proxy atual se disponível
        let proxyInfo = 'Sistema';
        if (checker.proxies.length > 0) {
          const randomProxy = checker.getRandomProxy();
          if (randomProxy) {
            proxyInfo = `${randomProxy.host}:${randomProxy.port}`;
          }
        }
        
        currentModuleWindow.webContents.send('cpf-checking', {
          cpf: cpf,
          status: statusType,
          statusText: statusText,
          proxy: proxyInfo
        });
      }
    };
    
    // Verifica lote de CPFs
    const results = await checker.checkMultipleCPFs(cpfs, statusCallback);
    
    // Remove status "checking" após processar (volta para aura verde)
    if (activeModules[moduleName]) {
      activeModules[moduleName].isChecking = false;
      updateModuleSelectorStatus();
    }
    
    // Processa resultados do lote
    let validCPFsInBatch = 0;
    let errorsInBatch = 0;
    
    // moduleStats já foi declarado acima, apenas reutiliza
    
    results.forEach(result => {
      // Trata CPFs com status "skipped" (não encontrou email e telefone no WorkBuscas) PRIMEIRO
      // Deve pular imediatamente antes de incrementar contadores
      if (result.interpretation === 'skipped') {
        if (currentModuleWindow && !currentModuleWindow.isDestroyed()) {
          currentModuleWindow.webContents.send('cpf-result', {
            cpf: result.cpf,
            status: 'skipped',
            message: 'NÃO TESTADO (dados insuficientes)',
            proxy: result.proxy || 'N/A'
          });
        }
        // Não incrementa totalVerified nem processa mais nada - pula imediatamente
        return; // Pula este CPF imediatamente
      }
      
      // Só incrementa contadores se não for 'skipped'
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
            workbuscas: result.workbuscas || null,
            emailMascarado: result.emailMascarado || null,
            finalTelefone: result.finalTelefone || null
          });
        }
        if (status === 'registered') {
          saveSingleValidCPF(result.cpf, result, false, moduleName);
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
    
    // Continua verificação após delay - CADA MÓDULO RODA INDEPENDENTEMENTE
    // Limpa intervalo anterior antes de criar novo (evita múltiplas instâncias)
    if (moduleStats.intervalId) {
      clearTimeout(moduleStats.intervalId);
      moduleStats.intervalId = null;
    }
    
    if (activeModules[moduleName] && activeModules[moduleName].isRunning) {
      const delay = config.delay || 5000;
      moduleStats.intervalId = setTimeout(() => {
        startContinuousChecking(config, moduleName);
      }, delay);
    } else {
      // Se parou, atualiza status no menu
      if (activeModules[moduleName]) {
        activeModules[moduleName].isRunning = false;
        activeModules[moduleName].isChecking = false;
        updateModuleSelectorStatus();
      }
      // Limpa intervalo do módulo
      if (moduleStats.intervalId) {
        clearTimeout(moduleStats.intervalId);
        moduleStats.intervalId = null;
      }
    }
    
  } catch (error) {
    // Log apenas erros críticos
    if (error.message && !error.message.includes('rate limit')) {
      console.error(`[${moduleName.toUpperCase()}] Erro:`, error.message);
    }
    
    const errorModuleWindow = activeModules[moduleName]?.window;
    if (errorModuleWindow && !errorModuleWindow.isDestroyed()) {
      errorModuleWindow.webContents.send('cpf-result', {
        cpf: 'ERRO',
        status: 'error',
        message: `Erro fatal: ${error.message}`
      });
    }
    
    // Reinicia após erro - verifica se ainda está rodando
    if (!sessionStats[moduleName]) {
      sessionStats[moduleName] = {
        totalVerified: 0,
        validFound: 0,
        startTime: new Date(),
        intervalId: null
      };
    }
    const errorModuleStats = sessionStats[moduleName];
    
    // Limpa intervalo anterior antes de criar novo
    if (errorModuleStats.intervalId) {
      clearTimeout(errorModuleStats.intervalId);
      errorModuleStats.intervalId = null;
    }
    
    if (activeModules[moduleName] && activeModules[moduleName].isRunning) {
      errorModuleStats.intervalId = setTimeout(() => {
        startContinuousChecking(config, moduleName);
      }, 10000);
    } else {
      if (activeModules[moduleName]) {
        activeModules[moduleName].isRunning = false;
        activeModules[moduleName].isChecking = false;
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
  // Verificando workbuscas para CPF
  if (result.workbuscas) {
    // WorkBuscas data recebido
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
  
  // Para Telesena, tenta pegar o nome do WorkBuscas primeiro
  if (moduleName === 'telesena' && result.workbuscas && result.workbuscas.nome) {
    personName = result.workbuscas.nome
      .replace(/[<>:"/\\|?*]/g, '') // Remover caracteres inválidos
      .replace(/\s+/g, '_') // Substituir espaços por underscore
      .substring(0, 50); // Limitar tamanho
  } else if ((result.user && (result.user.nome || result.user.name)) || (result.data && result.data.user && result.data.user.name)) {
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
  
  const moduleTitle = moduleName === 'gemeos' ? 'Gemeos Brasil' : 
                     moduleName === 'saude' ? 'Saúde Diária' :
                     moduleName === 'telesena' ? 'Telesena' : 'Sistema';
  
  let txtContent = '';
  if (isManualTest) {
    txtContent += `🔍 CENTRAL DO ARRANCA - TESTE DE CPF ESPECÍFICO (${moduleTitle})\n`;
    txtContent += '='.repeat(55) + '\n\n';
    txtContent += `📅 Data/Hora: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n`;
    txtContent += `🔢 CPF: ${cpf}\n`;
    txtContent += `✅ Status: CADASTRADO\n\n`;
  } else {
    txtContent += `🔍 CENTRAL DO ARRANCA - CPF VÁLIDO ENCONTRADO (${moduleTitle})\n`;
    txtContent += '='.repeat(55) + '\n\n';
    txtContent += `📅 Data/Hora: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n`;
    txtContent += `🔢 CPF: ${cpf}\n`;
    txtContent += `✅ Status: CADASTRADO\n\n`;
  }
  
  // Dados específicos do Telesena
  if (moduleName === 'telesena') {
    if (result.emailMascarado) {
      txtContent += `📧 Email (mascarado): ${result.emailMascarado}\n`;
    }
    if (result.finalTelefone) {
      txtContent += `📱 Final do Telefone: ${result.finalTelefone}\n`;
    }
    txtContent += `\n`;
    
    // Dados complementares da API WorkBuscas para Telesena
    if (result.workbuscas) {
      txtContent += `📊 DADOS COMPLEMENTARES (WorkBuscas):\n`;
      
      if (result.workbuscas.nome) {
        txtContent += `   📛 Nome Completo: ${result.workbuscas.nome}\n`;
      }
      
      if (result.workbuscas.nomeMae) {
        txtContent += `   👩 Nome da Mãe: ${result.workbuscas.nomeMae}\n`;
      }
      
      if (result.workbuscas.dataNascimento) {
        txtContent += `   📅 Data de Nascimento: ${result.workbuscas.dataNascimento}\n`;
      }
      
      // Telefones (todos os telefones disponíveis)
      if (result.workbuscas.telefones && Array.isArray(result.workbuscas.telefones) && result.workbuscas.telefones.length > 0) {
        txtContent += `   📱 Telefones (${result.workbuscas.telefones.length}):\n`;
        result.workbuscas.telefones.forEach((tel, telIndex) => {
          let telInfo = `      ${telIndex + 1}. ${tel.numero}`;
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
          txtContent += `      📅 Data de Emissão do RG: ${result.workbuscas.rgDataEmissao}\n`;
        }
      }
      
      txtContent += `\n`;
    }
  } else {
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
}

  // Dados complementares da API WorkBuscas (apenas para módulos que não têm tratamento específico)
  // Telesena já tem seu próprio bloco acima, então não entra aqui
  if (result.workbuscas && moduleName !== 'telesena') {
    // WorkBuscas data recebido
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

