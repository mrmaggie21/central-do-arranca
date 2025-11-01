/**
 * Script para gerar PNG do diagrama usando Puppeteer
 * Instale: npm install puppeteer
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function gerarDiagramaPNG(inputFile = 'diagrama-saude-checker.md', outputFile = 'diagrama-saude-checker.png') {
  try {
    // Lê o conteúdo do diagrama
    const diagramContent = fs.readFileSync(path.join(__dirname, inputFile), 'utf8');
    
    // Extrai apenas a parte do diagrama ASCII (entre ```)
    const diagramMatch = diagramContent.match(/```[\s\S]*?```/);
    if (!diagramMatch) {
      console.error('❌ Não foi possível encontrar o diagrama no arquivo');
      return;
    }
    
    const diagramText = diagramMatch[0].replace(/```/g, '').trim();
    
    // Cria HTML que renderiza o diagrama
    const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Diagrama Saúde Diária Checker</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: 'Courier New', 'Consolas', 'Monaco', monospace;
            background: #0d1117;
            color: #e0e0e0;
            padding: 40px;
            margin: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            min-height: 100vh;
        }
        h1 {
            color: #58a6ff;
            text-align: center;
            margin-bottom: 20px;
            font-size: 28px;
            font-weight: 600;
        }
        .container {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 8px;
            padding: 40px;
            max-width: 1400px;
            width: 100%;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        }
        .diagram {
            background: #0d1117;
            padding: 30px;
            border-radius: 6px;
            white-space: pre;
            font-size: 11px;
            line-height: 1.5;
            overflow-x: auto;
            color: #c9d1d9;
            border: 1px solid #21262d;
            font-family: 'Courier New', 'Consolas', 'Monaco', monospace;
        }
        .info {
            margin-top: 30px;
            padding: 20px;
            background: #161b22;
            border-radius: 6px;
            border-left: 4px solid #58a6ff;
        }
        .info h2 {
            color: #58a6ff;
            margin-bottom: 15px;
            font-size: 18px;
        }
        .info ul {
            list-style: none;
            padding-left: 0;
        }
        .info li {
            margin: 8px 0;
            color: #c9d1d9;
        }
        .info li::before {
            content: "✅ ";
            color: #3fb950;
            margin-right: 8px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Diagrama de Fluxo - Saúde Diária Checker</h1>
        <div class="diagram">${diagramText}</div>
        <div class="info">
            <h2>Detalhes Importantes</h2>
            <ul>
                <li><strong>Geração de CPF:</strong> Gera CPF válido se não fornecido</li>
                <li><strong>Consulta WorkBuscas:</strong> Extrai TODOS emails e telefones</li>
                <li><strong>Teste com Todos Emails:</strong> Loop para cada email encontrado</li>
                <li><strong>Sistema de Proxy:</strong> FORÇA uso de proxy, retry com rotação</li>
                <li><strong>Interpretação:</strong> Status 201 = CADASTRADO</li>
                <li><strong>Resultado Final:</strong> Inclui proxy, dados WorkBuscas e contadores</li>
            </ul>
        </div>
    </div>
</body>
</html>`;
    
    // Salva HTML temporário
    const htmlPath = path.join(__dirname, 'diagrama-temp.html');
    fs.writeFileSync(htmlPath, htmlContent, 'utf8');
    
    console.log('✅ HTML criado: diagrama-temp.html');
    console.log('🖼️  Iniciando captura de screenshot...');
    
    // Inicia browser
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Define viewport maior para diagrama
    await page.setViewport({
      width: 1600,
      height: 2400,
      deviceScaleFactor: 2
    });
    
    // Carrega HTML
    await page.goto(`file://${htmlPath}`, {
      waitUntil: 'networkidle0'
    });
    
    // Aguarda renderização completa
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Captura screenshot
    const outputPath = path.join(__dirname, outputFile);
    await page.screenshot({
      path: outputPath,
      fullPage: true,
      type: 'png'
    });
    
    await browser.close();
    
    // Remove HTML temporário
    fs.unlinkSync(htmlPath);
    
    console.log('✅ PNG gerado com sucesso!');
    console.log(`📄 Arquivo: ${outputPath}`);
    
  } catch (error) {
    console.error('❌ Erro ao gerar PNG:', error.message);
    
    if (error.message.includes("Cannot find module 'puppeteer'")) {
      console.log('\n💡 Instale o Puppeteer primeiro:');
      console.log('   npm install puppeteer');
    }
  }
}

// Permite passar arquivos via argumentos
const args = process.argv.slice(2);
const inputFile = args[0] || 'diagrama-saude-checker.md';
const outputFile = args[1] || inputFile.replace('.md', '.png');

gerarDiagramaPNG(inputFile, outputFile);

