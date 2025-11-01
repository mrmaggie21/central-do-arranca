/**
 * Script para criar ZIP da release automaticamente
 * Usage: node create-release-zip.js
 */

const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');
const packageJson = require('./package.json');

async function createReleaseZip() {
  const version = packageJson.version;
  const appName = 'Central do Arranca';
  const platform = 'win32-x64';
  
  const sourceDir = path.join(__dirname, 'dist', `${appName}-${platform}`);
  const zipFileName = `${appName.replace(/\s+/g, '-')}-v${version}-${platform}.zip`;
  const zipPath = path.join(__dirname, 'dist', zipFileName);
  
  console.log('📦 Criando ZIP da release...');
  console.log(`   Versão: v${version}`);
  console.log(`   Origem: ${sourceDir}`);
  console.log(`   Destino: ${zipPath}`);
  
  // Verifica se a pasta existe
  if (!fs.existsSync(sourceDir)) {
    console.error(`❌ Erro: Pasta não encontrada: ${sourceDir}`);
    console.error('   Execute primeiro: npm run pack');
    process.exit(1);
  }
  
  try {
    // Remove ZIP anterior se existir
    if (fs.existsSync(zipPath)) {
      fs.removeSync(zipPath);
      console.log('   Removendo ZIP anterior...');
    }
    
    // Cria o ZIP
    const zip = new AdmZip();
    zip.addLocalFolder(sourceDir, `${appName}-${platform}`);
    zip.writeZip(zipPath);
    
    const stats = fs.statSync(zipPath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    
    console.log(`✅ ZIP criado com sucesso!`);
    console.log(`   Arquivo: ${zipFileName}`);
    console.log(`   Tamanho: ${sizeMB} MB`);
    console.log(`   Local: ${zipPath}`);
    console.log('');
    console.log('🚀 Próximos passos:');
    console.log('   1. Acesse: https://github.com/mrmaggie21/central-do-arranca/releases/new');
    console.log(`   2. Tag version: v${version}`);
    console.log(`   3. Release title: ${appName} v${version}`);
    console.log(`   4. Anexe o arquivo: ${zipFileName}`);
    console.log('   5. Clique em "Publish release"');
    
  } catch (error) {
    console.error('❌ Erro ao criar ZIP:', error.message);
    process.exit(1);
  }
}

createReleaseZip();

