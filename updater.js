/**
 * Central do Arranca - Sistema de Atualização Automática
 * Verifica novas versões no GitHub e faz download automático
 */

const https = require('https');
const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');
const { app } = require('electron');

class Updater {
  constructor() {
    this.repoOwner = 'mrmaggie21';
    this.repoName = 'central-do-arranca';
    this.currentVersion = require('./package.json').version;
    this.updateCheckUrl = `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/releases/latest`;
    this.updateProgressCallback = null;
  }

  /**
   * Verifica se há uma nova versão disponível
   */
  async checkForUpdates() {
    try {
      console.log('[Updater] Verificando atualizações...');
      console.log('[Updater] Versão atual:', this.currentVersion);

      const releaseInfo = await this.fetchLatestRelease();
      
      if (!releaseInfo) {
        console.log('[Updater] Nenhuma release encontrada ou não foi possível obter informações');
        return { 
          available: false, 
          currentVersion: this.currentVersion,
          latestVersion: this.currentVersion,
          error: 'Nenhuma release encontrada'
        };
      }

      const latestVersion = releaseInfo.tag_name.replace(/^v/, ''); // Remove 'v' prefix se existir
      console.log('[Updater] Última versão disponível:', latestVersion);

      const needsUpdate = this.compareVersions(this.currentVersion, latestVersion) < 0;

      if (needsUpdate) {
        console.log('[Updater] Nova versão disponível!');
        return {
          available: true,
          currentVersion: this.currentVersion,
          latestVersion: latestVersion,
          releaseNotes: releaseInfo.body || '',
          downloadUrl: releaseInfo.assets?.[0]?.browser_download_url || null,
          releaseDate: releaseInfo.published_at
        };
      } else {
        console.log('[Updater] Você está com a versão mais recente');
        return { available: false, currentVersion: this.currentVersion, latestVersion: latestVersion };
      }
    } catch (error) {
      console.error('[Updater] Erro ao verificar atualizações:', error.message);
      return { 
        available: false, 
        currentVersion: this.currentVersion,
        error: error.message 
      };
    }
  }

  /**
   * Busca informações da última release no GitHub
   */
  async fetchLatestRelease() {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${this.repoOwner}/${this.repoName}/releases/latest`,
        method: 'GET',
        headers: {
          'User-Agent': 'Central-do-Arranca-Updater',
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
            try {
              const release = JSON.parse(data);
              resolve(release);
            } catch (error) {
              reject(new Error('Erro ao parsear resposta da API'));
            }
          } else if (res.statusCode === 404) {
            // Nenhuma release encontrada
            resolve(null);
          } else {
            reject(new Error(`Erro HTTP ${res.statusCode}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.end();
    });
  }

  /**
   * Compara duas versões (retorna -1 se v1 < v2, 0 se iguais, 1 se v1 > v2)
   */
  compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    
    const maxLength = Math.max(parts1.length, parts2.length);
    
    for (let i = 0; i < maxLength; i++) {
      const part1 = parts1[i] || 0;
      const part2 = parts2[i] || 0;
      
      if (part1 < part2) return -1;
      if (part1 > part2) return 1;
    }
    
    return 0;
  }

  /**
   * Faz download da nova versão
   */
  async downloadUpdate(downloadUrl, progressCallback = null) {
    return new Promise((resolve, reject) => {
      const updateDir = path.join(app.getPath('temp'), 'central-do-arranca-updates');
      const zipPath = path.join(updateDir, 'update.zip');

      // Cria diretório de atualizações
      fs.ensureDirSync(updateDir);

      console.log('[Updater] Iniciando download de:', downloadUrl);
      console.log('[Updater] Salvar em:', zipPath);

      const file = fs.createWriteStream(zipPath);
      let downloadedBytes = 0;
      let totalBytes = 0;

      const urlObj = new URL(downloadUrl);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Central-do-Arranca-Updater'
        }
      };

      const req = https.request(options, (res) => {
        totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        
        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          const progress = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;
          
          if (progressCallback) {
            progressCallback({
              downloaded: downloadedBytes,
              total: totalBytes,
              progress: Math.round(progress)
            });
          }
        });

        res.on('end', () => {
          file.end();
          console.log('[Updater] Download concluído');
          resolve(zipPath);
        });
      });

      req.on('error', (error) => {
        file.close();
        try {
          if (fs.existsSync(zipPath)) {
            fs.unlinkSync(zipPath);
          }
        } catch (unlinkError) {
          // Ignora erro ao deletar arquivo
          console.warn('[Updater] Erro ao deletar arquivo parcial:', unlinkError.message);
        }
        reject(error);
      });

      req.pipe(file);
    });
  }

  /**
   * Extrai e aplica a atualização
   */
  async applyUpdate(zipPath) {
    try {
      console.log('[Updater] Extraindo atualização de:', zipPath);
      
      const zip = new AdmZip(zipPath);
      const updateDir = path.join(app.getPath('temp'), 'central-do-arranca-updates', 'extracted');
      
      // Remove diretório anterior se existir
      if (fs.existsSync(updateDir)) {
        fs.removeSync(updateDir);
      }
      fs.ensureDirSync(updateDir);
      
      // Extrai o ZIP
      zip.extractAllTo(updateDir, true);
      
      console.log('[Updater] Atualização extraída para:', updateDir);
      
      // Marca que há atualização pendente
      const pendingFile = path.join(updateDir, '..', 'pending-update.json');
      fs.writeFileSync(pendingFile, JSON.stringify({
        extractedPath: updateDir,
        timestamp: Date.now()
      }, null, 2));
      
      console.log('[Updater] Atualização será aplicada automaticamente ao reiniciar');
      
      return updateDir;
    } catch (error) {
      console.error('[Updater] Erro ao extrair atualização:', error);
      throw error;
    }
  }

  /**
   * Verifica e aplica atualização pendente
   */
  async checkAndApplyPendingUpdate() {
    try {
      const pendingFile = path.join(app.getPath('temp'), 'central-do-arranca-updates', 'pending-update.json');
      
      if (!fs.existsSync(pendingFile)) {
        return false; // Nenhuma atualização pendente
      }

      const pendingInfo = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
      const extractedPath = pendingInfo.extractedPath;

      if (!fs.existsSync(extractedPath)) {
        // Limpa arquivo pendente se pasta não existe mais
        fs.unlinkSync(pendingFile);
        return false;
      }

      console.log('[Updater] Aplicando atualização pendente...');
      await this.installUpdate(extractedPath);

      // Limpa arquivos temporários
      fs.unlinkSync(pendingFile);
      fs.removeSync(extractedPath);
      fs.removeSync(path.join(app.getPath('temp'), 'central-do-arranca-updates'));

      return true; // Atualização aplicada
    } catch (error) {
      console.error('[Updater] Erro ao aplicar atualização pendente:', error);
      return false;
    }
  }

  /**
   * Instala a atualização extraída
   */
  async installUpdate(extractedPath) {
    try {
      // Encontra a pasta do aplicativo dentro da pasta extraída
      const extractedFiles = fs.readdirSync(extractedPath);
      const appFolderName = extractedFiles.find(dir => {
        const fullPath = path.join(extractedPath, dir);
        return fs.statSync(fullPath).isDirectory() && dir.includes('Central do Arranca');
      });

      if (!appFolderName) {
        throw new Error('Pasta do aplicativo não encontrada na atualização extraída');
      }

      const sourcePath = path.join(extractedPath, appFolderName, 'resources', 'app');
      const appPath = app.getAppPath(); // Caminho do aplicativo atual
      const targetPath = appPath;

      console.log('[Updater] Instalando atualização...');
      console.log(`   Origem: ${sourcePath}`);
      console.log(`   Destino: ${targetPath}`);

      // Lista de arquivos/pastas a manter
      const keepItems = ['node_modules', '.git', '.cache', 'lista'];

      // Copia arquivos, exceto os que devem ser mantidos
      const filesToCopy = fs.readdirSync(sourcePath);
      
      for (const file of filesToCopy) {
        if (keepItems.includes(file)) {
          continue; // Pula arquivos que devem ser mantidos
        }

        const sourceFile = path.join(sourcePath, file);
        const destFile = path.join(targetPath, file);

        try {
          if (fs.existsSync(destFile)) {
            const stat = fs.statSync(destFile);
            if (stat.isDirectory()) {
              fs.removeSync(destFile);
            } else {
              fs.unlinkSync(destFile);
            }
          }
          fs.copySync(sourceFile, destFile);
          console.log(`   ✅ ${file}`);
        } catch (error) {
          console.warn(`   ⚠️  Erro ao atualizar ${file}:`, error.message);
        }
      }

      console.log('[Updater] Atualização instalada com sucesso!');
      return true;
    } catch (error) {
      console.error('[Updater] Erro ao instalar atualização:', error);
      throw error;
    }
  }

  /**
   * Define callback para progresso do download
   */
  setProgressCallback(callback) {
    this.updateProgressCallback = callback;
  }
}

module.exports = Updater;

