/**
 * Script para instalar dependências no build após o pack
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const buildPath = path.join(__dirname, 'dist', 'Central do Arranca-win32-x64', 'resources', 'app');

console.log('📦 Instalando dependências no build...');
console.log('   Caminho:', buildPath);

if (!fs.existsSync(buildPath)) {
  console.error('❌ Erro: Caminho do build não encontrado:', buildPath);
  console.error('   Execute primeiro: npm run pack');
  process.exit(1);
}

try {
  process.chdir(buildPath);
  console.log('   Executando npm install --production...');
  execSync('npm install --production --omit=dev', { stdio: 'inherit' });
  console.log('✅ Dependências instaladas com sucesso!');
} catch (error) {
  console.error('❌ Erro ao instalar dependências:', error.message);
  process.exit(1);
}

