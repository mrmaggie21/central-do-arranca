const { ipcRenderer } = require('electron');

// Elementos da interface
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const testBtn = document.getElementById('testBtn');
const testSpecificBtn = document.getElementById('testSpecificBtn');
const openFolderBtn = document.getElementById('openFolderBtn');
const clearLogBtn = document.getElementById('clearLogBtn');

// Elementos da seção de teste
const cpfTestInput = document.getElementById('cpfTestInput');
const cpfSuggestions = document.querySelectorAll('.cpf-suggestion');

const delayInput = document.getElementById('delay');
const modeSelect = document.getElementById('mode');
const batchSizeInput = document.getElementById('batchSize');
const quantityInput = document.getElementById('quantity');
const quantityRow = document.getElementById('quantity-row');

const cpfTableBody = document.getElementById('cpfTableBody');
const logContent = document.getElementById('logContent');
const validCpfsList = document.getElementById('validCpfsList');

// Elementos de estatísticas
const totalVerified = document.getElementById('totalVerified');
const validFound = document.getElementById('validFound');
const successRate = document.getElementById('successRate');
const elapsedTime = document.getElementById('elapsedTime');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const validCount = document.getElementById('validCount');

// Elementos do indicador de proxy
const proxyLoadingIndicator = document.getElementById('proxyLoadingIndicator');
const proxyLoadingText = proxyLoadingIndicator.querySelector('.proxy-loading-text');
const proxyLoadingCount = proxyLoadingIndicator.querySelector('.proxy-loading-count');
const proxyLoadingSubtitle = proxyLoadingIndicator.querySelector('.proxy-loading-subtitle');

let isRunning = false;
let statsInterval;
let proxiesLoaded = false;
let proxyCount = 0;
let recentCPFs = []; // Array para armazenar os últimos 20 CPFs verificados

// Event Listeners
startBtn.addEventListener('click', startChecking);
stopBtn.addEventListener('click', stopChecking);
testBtn.addEventListener('click', generateTestCPF);
testSpecificBtn.addEventListener('click', testSpecificCPF);
openFolderBtn.addEventListener('click', openResultsFolder);
clearLogBtn.addEventListener('click', clearLog);

modeSelect.addEventListener('change', (e) => {
    quantityRow.style.display = e.target.value === 'limited' ? 'block' : 'none';
});

// Event listeners para seção de teste
cpfSuggestions.forEach(btn => {
    btn.addEventListener('click', (e) => {
        const cpf = e.target.getAttribute('data-cpf');
        cpfTestInput.value = cpf;
        cpfTestInput.focus();
        addLogEntry('info', `[${getCurrentTime()}] 📋 CPF selecionado: ${cpf}`);
    });
});

// Formatação automática do CPF no input
cpfTestInput.addEventListener('input', (e) => {
    let value = e.target.value.replace(/\D/g, ''); // Remove tudo que não é dígito
    
    // Aplica formatação
    if (value.length <= 11) {
        value = value.replace(/(\d{3})(\d)/, '$1.$2');
        value = value.replace(/(\d{3})(\d)/, '$1.$2');
        value = value.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    }
    
    e.target.value = value;
});

// Enter para testar CPF
cpfTestInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        testSpecificCPF();
    }
});

// IPC Listeners
ipcRenderer.on('log-message', (event, data) => {
    addLogEntry(data.type, `[${getCurrentTime()}] ${data.message}`);
});

ipcRenderer.on('proxy-loading-start', (event, data) => {
    showProxyLoadingIndicator();
    proxyLoadingText.textContent = '🇧🇷 Carregando proxies brasileiros...';
    proxyCount = 0;
    updateProxyCount();
    addLogEntry('info', `[${getCurrentTime()}] 🔄 Iniciando carregamento dos proxies brasileiros...`);
});

ipcRenderer.on('proxy-loading-progress', (event, data) => {
    proxyCount = data.count;
    updateProxyCount();
    
    // Atualiza texto baseado no progresso
    if (proxyCount < 25) {
        proxyLoadingText.textContent = '🇧🇷 Carregando proxies brasileiros...';
        proxyLoadingSubtitle.textContent = '🌐 Conectando com API Webshare';
    } else if (proxyCount < 100) {
        proxyLoadingText.textContent = '🌐 Filtrando proxies do Brasil...';
        proxyLoadingSubtitle.textContent = '🇧🇷 Aplicando filtro geográfico';
    } else if (proxyCount < 500) {
        proxyLoadingText.textContent = '🧪 Testando proxies válidos...';
        proxyLoadingSubtitle.textContent = '✅ Verificando conectividade';
    } else {
        proxyLoadingText.textContent = '✅ Finalizando carregamento...';
        proxyLoadingSubtitle.textContent = '🎯 Otimizando para uso';
    }
    
    // Mostra progresso a cada 100 proxies para não sobrecarregar o log
    if (proxyCount % 100 === 0 || proxyCount === 25) {
        addLogEntry('info', `[${getCurrentTime()}] 📊 Progresso: ${proxyCount}/1000 proxies brasileiros carregados`);
    }
});

ipcRenderer.on('proxy-loading-complete', (event, data) => {
    proxyCount = data.total;
    proxiesLoaded = true;
    updateProxyCount();
    proxyLoadingText.textContent = '🎉 Proxies brasileiros carregados!';
    proxyLoadingSubtitle.textContent = `🇧🇷 ${data.total} proxies do Brasil prontos`;
    addLogEntry('success', `[${getCurrentTime()}] ✅ ${data.total} proxies brasileiros carregados com sucesso!`);
    addLogEntry('info', `[${getCurrentTime()}] 🇧🇷 Sistema otimizado para proxies do Brasil!`);
    addLogEntry('info', `[${getCurrentTime()}] 🎮 Sistema pronto para iniciar verificações!`);
    
    setTimeout(() => {
        hideProxyLoadingIndicator();
    }, 4000); // Mostra por 4 segundos para ler as informações
});

ipcRenderer.on('batch-info', (event, data) => {
    addLogEntry('info', `[${getCurrentTime()}] 🔄 LOTE ${data.batchNumber} - Processando ${data.batchSize} CPFs`);
    addLogEntry('info', `[${getCurrentTime()}] 📋 CPFs: ${data.cpfs.join(', ')}${data.totalCpfs > 3 ? ` ... (+${data.totalCpfs - 3} mais)` : ''}`);
});

ipcRenderer.on('proxy-info', (event, data) => {
    addLogEntry('info', `[${getCurrentTime()}] 🌐 Proxy: ${data.proxy} (${data.hasAuth ? 'Auth' : 'No Auth'})`);
});

ipcRenderer.on('cpf-result', (event, data) => {
    handleCPFResult(data);
});

ipcRenderer.on('batch-summary', (event, data) => {
    addLogEntry('info', `[${getCurrentTime()}] 📊 Lote concluído: ${data.validCPFsInBatch} válidos, ${data.errorsInBatch} erros`);
    addLogEntry('info', `[${getCurrentTime()}] 📊 Total válidos: ${data.totalValid} | Total verificados: ${data.totalVerified}`);
});

ipcRenderer.on('cpf-saved', (event, data) => {
    addLogEntry('success', `[${getCurrentTime()}] CPF ${data.cpf} salvo em: ${data.filename}`);
});

async function startChecking() {
    // Verifica se os proxies estão carregados
    if (!proxiesLoaded) {
        addLogEntry('warning', `[${getCurrentTime()}] ⚠️ Aguarde o carregamento dos proxies antes de iniciar!`);
        showProxyLoadingIndicator();
        return;
    }
    
    const config = {
        delay: parseInt(delayInput.value) * 1000, // Converter para ms
        mode: modeSelect.value,
        batchSize: parseInt(batchSizeInput.value),
        quantity: parseInt(quantityInput.value)
    };
    
    const result = await ipcRenderer.invoke('start-checking', config);
    
    if (result.success) {
        isRunning = true;
        startBtn.disabled = true;
        stopBtn.disabled = false;
        
        // Desabilita controles durante execução
        delayInput.disabled = true;
        modeSelect.disabled = true;
        quantityInput.disabled = true;
        
        // Inicia atualização das estatísticas
        statsInterval = setInterval(updateStats, 1000);
        
        addLogEntry('success', `[${getCurrentTime()}] ✅ Verificação iniciada - Modo: ${config.mode}, Delay: ${config.delay/1000}s`);
        updateCPFTable('---', 'checking', 'Sistema', 'Iniciando verificação...');
    } else {
        addLogEntry('error', `[${getCurrentTime()}] ❌ Erro: ${result.message}`);
    }
}

async function stopChecking() {
    const result = await ipcRenderer.invoke('stop-checking');
    
    if (result.success) {
        isRunning = false;
        startBtn.disabled = false;
        stopBtn.disabled = true;
        
        // Reabilita controles
        delayInput.disabled = false;
        modeSelect.disabled = false;
        quantityInput.disabled = false;
        
        // Para atualização das estatísticas
        if (statsInterval) {
            clearInterval(statsInterval);
            statsInterval = null;
        }
        
        addLogEntry('warning', `[${getCurrentTime()}] ⚠️ Verificação parada pelo usuário`);
        updateCPFTable('---', 'stopped', 'Sistema', 'Verificação parada');
    }
}

async function generateTestCPF() {
    const cpf = await ipcRenderer.invoke('generate-test-cpf');
    addLogEntry('info', `[${getCurrentTime()}] 🎲 CPF de teste gerado: ${cpf}`);
    updateCPFTable(cpf, 'generated', 'Sistema', 'CPF de teste gerado');
}

async function testSpecificCPF() {
    const cpfToTest = cpfTestInput.value.trim();
    
    if (!cpfToTest) {
        addLogEntry('warning', `[${getCurrentTime()}] ⚠️ Digite um CPF para testar`);
        cpfTestInput.focus();
        return;
    }
    
    // Validação básica de formato
    const cpfPattern = /^\d{3}\.\d{3}\.\d{3}-\d{2}$/;
    if (!cpfPattern.test(cpfToTest)) {
        addLogEntry('warning', `[${getCurrentTime()}] ⚠️ Formato de CPF inválido. Use: 000.000.000-00`);
        cpfTestInput.focus();
        return;
    }
    
    addLogEntry('info', `[${getCurrentTime()}] 🧪 Testando CPF específico: ${cpfToTest}`);
    updateCPFTable(cpfToTest, 'checking', 'Sistema', 'Testando CPF específico...');
    
    // Desabilita botão durante teste
    testSpecificBtn.disabled = true;
    testSpecificBtn.textContent = '⏳ Testando...';
    
    try {
        const result = await ipcRenderer.invoke('test-single-cpf', cpfToTest);
        if (result.success) {
            addLogEntry('success', `[${getCurrentTime()}] ✅ Teste de CPF específico concluído`);
        } else {
            addLogEntry('error', `[${getCurrentTime()}] ❌ Erro no teste: ${result.error}`);
        }
    } catch (error) {
        addLogEntry('error', `[${getCurrentTime()}] ❌ Erro no teste: ${error.message}`);
    } finally {
        // Reabilita botão
        testSpecificBtn.disabled = false;
        testSpecificBtn.textContent = '✅ Testar CPF';
    }
}

async function openResultsFolder() {
    await ipcRenderer.invoke('open-results-folder');
    addLogEntry('info', `[${getCurrentTime()}] 📁 Pasta de resultados aberta`);
}

function clearLog() {
    logContent.innerHTML = '';
    addLogEntry('info', `[${getCurrentTime()}] 🗑️ Log limpo`);
}

async function updateStats() {
    const stats = await ipcRenderer.invoke('get-stats');
    
    totalVerified.textContent = stats.totalVerified;
    validFound.textContent = stats.validFound;
    successRate.textContent = stats.successRate + '%';
    elapsedTime.textContent = stats.elapsedTime;
    validCount.textContent = stats.validFound;
    
    // Atualiza status visual
    if (stats.isRunning) {
        statusDot.className = 'status-dot active';
        statusText.textContent = 'Executando';
    } else {
        statusDot.className = 'status-dot';
        statusText.textContent = 'Aguardando';
    }
}

function updateCPFTable(cpf, status, proxy, timestamp) {
    // Adicionar novo CPF ao início do array
    recentCPFs.unshift({
        cpf: cpf,
        status: status,
        proxy: proxy || 'Sem Proxy',
        timestamp: timestamp || new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    });
    
    // Manter apenas os últimos 20 CPFs
    if (recentCPFs.length > 20) {
        recentCPFs = recentCPFs.slice(0, 20);
    }
    
    // Atualizar a tabela
    renderCPFTable();
}

function renderCPFTable() {
    if (recentCPFs.length === 0) {
        cpfTableBody.innerHTML = '<tr class="no-data"><td colspan="5">Aguardando início da verificação...</td></tr>';
        return;
    }
    
    cpfTableBody.innerHTML = recentCPFs.map((item, index) => {
        let statusClass = '';
        let statusText = '';
        
        switch (item.status) {
            case 'registered':
                statusClass = 'status-valid';
                statusText = 'CADASTRADO';
                break;
            case 'not_registered':
                statusClass = 'status-invalid';
                statusText = 'NÃO CADASTRADO';
                break;
            case 'checking':
                statusClass = 'status-checking';
                statusText = 'VERIFICANDO';
                break;
            case 'generated':
                statusClass = 'status-checking';
                statusText = 'GERADO';
                break;
            case 'stopped':
                statusClass = 'status-checking';
                statusText = 'PARADO';
                break;
            default:
                statusClass = 'status-checking';
                statusText = 'VERIFICANDO';
        }
        
        // Adicionar classe de destaque para a primeira linha (mais recente)
        const highlightClass = index === 0 ? 'new-entry' : '';
        
        return `
            <tr class="${highlightClass}">
                <td>${index + 1}</td>
                <td>${item.cpf}</td>
                <td class="${statusClass}">${statusText}</td>
                <td class="proxy-info">${item.proxy}</td>
                <td class="timestamp">${item.timestamp}</td>
            </tr>
        `;
    }).join('');
    
    // Scroll automático suave para o topo da tabela
    setTimeout(() => {
        const tableContainer = document.querySelector('.cpf-table-container');
        if (tableContainer) {
            tableContainer.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        }
    }, 50);
}

function handleCPFResult(data) {
    let statusClass = '';
    let statusText = '';
    let logMessage = '';
    
    switch (data.status) {
        case 'registered':
            statusClass = 'valid';
            statusText = '✅ CPF CADASTRADO';
            logMessage = `✅ ${data.cpf} - CADASTRADO`;
            if (data.proxy && data.proxy !== 'Sem Proxy') {
                logMessage += ` [${data.proxy}]`;
            }
            addValidCPF(data);
            addLogEntry('success', `[${getCurrentTime()}] ${logMessage}`);
            break;
        case 'not_registered':
            statusClass = 'invalid';
            statusText = '❓ CPF NÃO CADASTRADO';
            logMessage = `❓ ${data.cpf} - NÃO CADASTRADO`;
            if (data.proxy && data.proxy !== 'Sem Proxy') {
                logMessage += ` [${data.proxy}]`;
            }
            addLogEntry('warning', `[${getCurrentTime()}] ${logMessage}`);
            break;
        case 'error':
            statusClass = 'error';
            statusText = '❌ ERRO';
            logMessage = `❌ ${data.cpf} - ${data.message}`;
            if (data.proxy && data.proxy !== 'Sem Proxy') {
                logMessage += ` [${data.proxy}]`;
            }
            addLogEntry('error', `[${getCurrentTime()}] ${logMessage}`);
            break;
        case 'unknown':
            statusClass = 'unknown';
            statusText = '❓ RESPOSTA DESCONHECIDA';
            logMessage = `❓ ${data.cpf} - RESPOSTA DESCONHECIDA`;
            if (data.proxy && data.proxy !== 'Sem Proxy') {
                logMessage += ` [${data.proxy}]`;
            }
            addLogEntry('warning', `[${getCurrentTime()}] ${logMessage}`);
            break;
    }
    
    updateCPFTable(data.cpf, data.status, data.proxy);
}

function addValidCPF(data) {
    // Remove mensagem de "nenhum resultado" se existir
    const noResults = validCpfsList.querySelector('.no-results');
    if (noResults) {
        noResults.remove();
    }
    
    const item = document.createElement('div');
    item.className = 'valid-cpf-item';
    
    let detailsHTML = '';
    if (data.userData) {
        detailsHTML += `
            <div><strong>👤 Nome:</strong> ${data.userData.name}</div>
            <div><strong>📧 Email:</strong> ${data.userData.email}</div>
            <div><strong>📱 Telefone:</strong> ${data.userData.phone}</div>
        `;
    }
    
    if (data.products && data.products.length > 0) {
        detailsHTML += `<div><strong>📦 Produtos:</strong></div>`;
        data.products.forEach((product, index) => {
            detailsHTML += `<div style="margin-left: 15px;">${index + 1}. ${product.title}</div>`;
        });
    }
    
    if (data.proxy && data.proxy !== 'Sem Proxy') {
        detailsHTML += `<div><strong>🌐 Proxy:</strong> ${data.proxy}</div>`;
    }
    
    item.innerHTML = `
        <div class="valid-cpf-header">
            <span class="valid-cpf-number">${data.cpf}</span>
            <span class="valid-cpf-time">${getCurrentTime()}</span>
        </div>
        <div class="valid-cpf-details">
            ${detailsHTML}
        </div>
    `;
    
    // Adiciona no início da lista
    validCpfsList.insertBefore(item, validCpfsList.firstChild);
    
    // Atualiza contador
    updateStats();
}

function addLogEntry(type, message) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    
    entry.innerHTML = `
        <span class="timestamp">[${getCurrentTime()}]</span>
        <span class="message">${message}</span>
    `;
    
    logContent.appendChild(entry);
    logContent.scrollTop = logContent.scrollHeight;
    
    // Limita o número de entradas no log (últimas 100)
    const entries = logContent.querySelectorAll('.log-entry');
    if (entries.length > 100) {
        entries[0].remove();
    }
}

function getCurrentTime() {
    return new Date().toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// Funções para controlar o indicador de proxy
function showProxyLoadingIndicator() {
    proxyLoadingIndicator.classList.add('show');
}

function hideProxyLoadingIndicator() {
    proxyLoadingIndicator.classList.remove('show');
}

function updateProxyCount() {
    proxyLoadingCount.textContent = `${proxyCount}/1000`;
}

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
    addLogEntry('info', `[${getCurrentTime()}] 🚀 Interface profissional com Proxy Rotativo carregada!`);
    addLogEntry('info', `[${getCurrentTime()}] 🌐 Sistema com 1000 proxies da Webshare`);
    addLogEntry('info', `[${getCurrentTime()}] 📦 Processamento em lotes de 50 CPFs`);
    addLogEntry('info', `[${getCurrentTime()}] ⚙️ Configure os parâmetros na sidebar e inicie a verificação`);
    addLogEntry('info', `[${getCurrentTime()}] 🔄 Aguardando carregamento dos proxies...`);
    
    // Carrega estatísticas iniciais
    updateStats();
    
    // Foco no campo de delay
    delayInput.focus();
});

// Atalhos de teclado
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
            case 's':
                e.preventDefault();
                if (!isRunning) {
                    startChecking();
                }
                break;
            case 'q':
                e.preventDefault();
                if (isRunning) {
                    stopChecking();
                }
                break;
            case 't':
                e.preventDefault();
                generateTestCPF();
                break;
            case 'l':
                e.preventDefault();
                clearLog();
                break;
        }
    }
});

// Validação em tempo real dos inputs
delayInput.addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    if (value < 1) e.target.value = 1;
    if (value > 60) e.target.value = 60;
});

quantityInput.addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    if (value < 1) e.target.value = 1;
    if (value > 1000) e.target.value = 1000;
});

// Tooltip para os botões
const tooltips = {
    startBtn: 'Ctrl+S para iniciar',
    stopBtn: 'Ctrl+Q para parar',
    testBtn: 'Ctrl+T para gerar CPF',
    testSpecificBtn: 'Testa CPF específico ou Enter no campo',
    clearLogBtn: 'Ctrl+L para limpar log'
};

Object.entries(tooltips).forEach(([id, tooltip]) => {
    const element = document.getElementById(id);
    element.title = tooltip;
});
