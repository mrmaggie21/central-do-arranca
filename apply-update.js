/**
 * Script auxiliar para aplicar atualização após reiniciar o aplicativo
 * Substitui os arquivos antigos pelos novos arquivos extraídos
 */

const fs = require('fs-extra');
const path = require('path');

// Caminhos
const extractedPath = path.join(require('os').tmpdir(), 'central-do-arranca-updates', 'extracted');
const appPath = process.cwd(); // Caminho do aplicativo atual

console.log('🔄 Aplicando atualização...');
console.log(`   Origem: ${extractedPath}`);
console.log(`   Destino: ${appPath}`);

if (!fs.existsSync(extractedPath)) {
  console.error('❌ Pasta de atualização não encontrada:', extractedPath);
  console.error('   A atualização não foi extraída ainda.');
  process.exit(1);
}

// Encontra a pasta do aplicativo dentro da pasta extraída
const extractedAppPath = fs.readdirSync(extractedPath).find(dir => {
  return fs.statSync(path.join(extractedPath, dir)).isDirectory() && dir.includes('Central do Arranca');
});

if (!extractedAppPath) {
  console.error('❌ Pasta do aplicativo não encontrada na atualização extraída');
  process.exit(1);
}

const sourcePath = path.join(extractedPath, extractedAppPath);
console.log(`   Aplicando de: ${sourcePath}`);

try {
  // Faz backup dos arquivos importantes antes de substituir
  const backupPath = path.join(appPath, '..', 'backup-' + Date.now());
  console.log(`   Criando backup em: ${backupPath}`);
  fs.copySync(appPath, backupPath);
  
  // Substitui os arquivos (exceto alguns arquivos importantes)
  console.log('   Substituindo arquivos...');
  
  // Lista de arquivos/pastas a manter
  const keepFiles = ['node_modules', '.git', '.cache', 'lista'];
  
  // Copia arquivos, exceto os que devem ser mantidos
  const filesToCopy = fs.readdirSync(sourcePath);
  filesToCopy.forEach(file => {
    if (!keepFiles.includes(file)) {
      const sourceFile = path.join(sourcePath, file);
      const destFile = path.join(appPath, file);
      
      if (fs.existsSync(destFile)) {
        fs.removeSync(destFile);
      }
      fs.copySync(sourceFile, destFile);
      console.log(`   ✅ ${file}`);
    }
  });
  
  // Limpa arquivos temporários
  fs.removeSync(extractedPath);
  fs.removeSync(path.join(require('os').tmpdir(), 'central-do-arranca-updates'));
  
  console.log('✅ Atualização aplicada com sucesso!');
  console.log(`   Backup salvo em: ${backupPath}`);
  
} catch (error) {
  console.error('❌ Erro ao aplicar atualização:', error.message);
  process.exit(1);
}

