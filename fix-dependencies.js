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
  
  // Garante que axios.cjs existe (pode não ser copiado pelo npm install)
  const axiosNodePath = path.join(buildPath, 'node_modules', 'axios', 'dist', 'node');
  const axiosNodeSource = path.join(__dirname, 'node_modules', 'axios', 'dist', 'node');
  
  if (!fs.existsSync(axiosNodePath) && fs.existsSync(axiosNodeSource)) {
    console.log('   Copiando arquivos do axios...');
    fs.ensureDirSync(axiosNodePath);
    const files = fs.readdirSync(axiosNodeSource);
    files.forEach(file => {
      fs.copyFileSync(
        path.join(axiosNodeSource, file),
        path.join(axiosNodePath, file)
      );
    });
    console.log('✅ Arquivos do axios copiados!');
  }
} catch (error) {
  console.error('❌ Erro ao instalar dependências:', error.message);
  process.exit(1);
}

