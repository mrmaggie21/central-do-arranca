/**
 * Script para criar release no GitHub automaticamente
 * Requer token do GitHub com permissão de criar releases
 */

const https = require('https');
const fs = require('fs-extra');
const path = require('path');
const packageJson = require('./package.json');

// Configurações
// Token do GitHub - use variável de ambiente ou configure manualmente
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || 'YOUR_GITHUB_TOKEN_HERE';
const REPO_OWNER = 'mrmaggie21';
const REPO_NAME = 'central-do-arranca';
const VERSION = packageJson.version;
const TAG_NAME = `v${VERSION}`;
const RELEASE_TITLE = `Central do Arranca v${VERSION}`;
const ZIP_FILE = path.join(__dirname, 'dist', `Central-do-Arranca-v${VERSION}-win32-x64.zip`);

// Verifica se o token foi configurado
if (!GITHUB_TOKEN || GITHUB_TOKEN === 'YOUR_GITHUB_TOKEN_HERE') {
  console.error('❌ Erro: Token do GitHub não configurado!');
  console.error('   Configure o token usando uma das opções:');
  console.error('   1. Variável de ambiente: $env:GITHUB_TOKEN="seu_token" (PowerShell)');
  console.error('   2. Edite este arquivo e substitua YOUR_GITHUB_TOKEN_HERE pelo seu token');
  process.exit(1);
}

async function createRelease() {
  console.log('🚀 Criando release no GitHub...');
  console.log(`   Versão: ${TAG_NAME}`);
  console.log(`   Título: ${RELEASE_TITLE}`);
  console.log(`   Repositório: ${REPO_OWNER}/${REPO_NAME}`);
  console.log('');

  // Verifica se o ZIP existe
  if (!fs.existsSync(ZIP_FILE)) {
    console.error(`❌ Erro: Arquivo ZIP não encontrado: ${ZIP_FILE}`);
    console.error('   Execute primeiro: npm run release');
    process.exit(1);
  }

  const zipStats = fs.statSync(ZIP_FILE);
  const zipSize = zipStats.size;
  console.log(`✅ ZIP encontrado: ${path.basename(ZIP_FILE)} (${(zipSize / (1024 * 1024)).toFixed(2)} MB)`);
  console.log('');

  // Le o arquivo ZIP
  const zipContent = fs.readFileSync(ZIP_FILE);
  const zipBase64 = zipContent.toString('base64');

  // Cria a release primeiro
  const releaseData = JSON.stringify({
    tag_name: TAG_NAME,
    target_commitish: 'main',
    name: RELEASE_TITLE,
    body: `## Central do Arranca v${VERSION}

### 🚀 Release ${VERSION}

### ✨ Funcionalidades

- ✅ Gemeos CPF Checker
- ✅ Saúde Diária Checker (em desenvolvimento)
- ✅ Sistema de atualização automática
- ✅ Interface profissional
- ✅ Integração com WorkBuscas API

### 📝 Notas

- Sistema de atualização automática funcional
- Build completo para Windows x64
- Todas as dependências incluídas
- Melhorias na mensagem de atualização

### 📦 Download

Arquivo ZIP incluído para distribuição.`,
    draft: false,
    prerelease: false
  });

  return new Promise((resolve, reject) => {
    // Passo 1: Criar a release
    console.log('📝 Criando release no GitHub...');
    const createReleaseOptions = {
      hostname: 'api.github.com',
      path: `/repos/${REPO_OWNER}/${REPO_NAME}/releases`,
      method: 'POST',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'Central-do-Arranca-Release-Script',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(releaseData)
      }
    };

    const req = https.request(createReleaseOptions, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 201) {
          try {
            const release = JSON.parse(data);
            console.log(`✅ Release criada com sucesso!`);
            console.log(`   ID: ${release.id}`);
            console.log(`   URL: ${release.html_url}`);
            console.log('');
            
            // Passo 2: Upload do arquivo ZIP
            uploadAsset(release.upload_url.replace('{?name,label}', `?name=${path.basename(ZIP_FILE)}`), zipContent, resolve, reject);
          } catch (error) {
            reject(new Error(`Erro ao parsear resposta: ${error.message}`));
          }
        } else if (res.statusCode === 422) {
          // Release já existe
          console.log('⚠️  Release já existe. Tentando fazer upload do arquivo...');
          // Busca a release existente
          getExistingRelease(TAG_NAME, zipContent, resolve, reject);
        } else {
          console.error(`❌ Erro ao criar release: ${res.statusCode}`);
          console.error(`   Resposta: ${data}`);
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(releaseData);
    req.end();
  });
}

function getExistingRelease(tagName, zipContent, resolve, reject) {
  const options = {
    hostname: 'api.github.com',
    path: `/repos/${REPO_OWNER}/${REPO_NAME}/releases/tags/${tagName}`,
    method: 'GET',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'User-Agent': 'Central-do-Arranca-Release-Script',
      'Accept': 'application/vnd.github.v3+json'
    }
  };

  const req = https.request(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      if (res.statusCode === 200) {
        const release = JSON.parse(data);
        const uploadUrl = release.upload_url.replace('{?name,label}', `?name=${path.basename(ZIP_FILE)}`);
        uploadAsset(uploadUrl, zipContent, resolve, reject);
      } else {
        reject(new Error(`Erro ao buscar release: ${res.statusCode}`));
      }
    });
  });

  req.on('error', reject);
  req.end();
}

function uploadAsset(uploadUrl, fileContent, resolve, reject) {
  console.log('📤 Fazendo upload do arquivo ZIP...');
  
  const urlObj = new URL(uploadUrl);
  const options = {
    hostname: urlObj.hostname,
    path: urlObj.pathname + urlObj.search,
    method: 'POST',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'User-Agent': 'Central-do-Arranca-Release-Script',
      'Content-Type': 'application/zip',
      'Content-Length': fileContent.length
    }
  };

  const req = https.request(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      if (res.statusCode === 201) {
        const asset = JSON.parse(data);
        console.log(`✅ Upload concluído com sucesso!`);
        console.log(`   Arquivo: ${asset.name}`);
        console.log(`   Tamanho: ${(asset.size / (1024 * 1024)).toFixed(2)} MB`);
        console.log(`   URL: ${asset.browser_download_url}`);
        console.log('');
        console.log('🎉 Release criada e arquivo anexado com sucesso!');
        console.log(`   Acesse: https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/${TAG_NAME}`);
        resolve();
      } else {
        console.error(`❌ Erro ao fazer upload: ${res.statusCode}`);
        console.error(`   Resposta: ${data}`);
        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
      }
    });
  });

  req.on('error', reject);
  req.write(fileContent);
  req.end();
}

createRelease()
  .then(() => {
    console.log('✅ Processo concluído!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  });

