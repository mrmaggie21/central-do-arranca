#!/usr/bin/env node

/**
 * Checker de CPF Automático para API Gemeos Brasil com Proxy Rotativo
 * 
 * Uso:
 *   node index.js [quantidade] [delay] [--continuous]
 * 
 * Exemplos:
 *   node index.js 100                    # Verifica 100 CPFs em lotes de 20 com proxies
 *   node index.js 50 10000              # Verifica 50 CPFs com delay de 10s entre lotes
 *   node index.js 20 5000 --continuous # Modo contínuo: 20 CPFs a cada 5s
 *   node index.js                        # Verifica 10 CPFs com delay padrão (5s)
 * 
 * Funcionalidades:
 *   - 1000 proxies rotativos da Webshare
 *   - Processamento em lotes de 20 CPFs
 *   - Logs detalhados com informações de proxy
 *   - Modo contínuo sem limite
 */

const chalk = require('chalk');
const CPFGenerator = require('./cpf-generator');
const GemeosChecker = require('./api-checker');

async function main() {
  try {
    // Parse argumentos da linha de comando
    const args = process.argv.slice(2);
    const count = parseInt(args[0]) || 10;
    const delay = parseInt(args[1]) || 5000; // Delay padrão: 5 segundos
    const continuous = args.includes('--continuous') || args.includes('-c');
    
    // Validações
    if (count <= 0 || count > 10000) {
      console.log(chalk.red('❌ Quantidade deve ser entre 1 e 10.000'));
      process.exit(1);
    }
    
    if (delay < 500 || delay > 60000) { // Mínimo: 0.5 segundo, Máximo: 1 minuto
      console.log(chalk.red('❌ Delay deve ser entre 500ms (0.5s) e 60000ms (1min)'));
      process.exit(1);
    }
    
    // Banner
    console.log(chalk.blue('🔍 GEMEOS CPF CHECKER COM PROXY ROTATIVO'));
    console.log(chalk.blue('='.repeat(50)));
    console.log(chalk.white(`📊 CPFs a verificar: ${count}`));
    console.log(chalk.white(`📦 CPFs por lote: 20`));
    console.log(chalk.white(`🌐 Proxies: Webshare (1000 proxies rotativos)`));
    console.log(chalk.white(`⏱️  Delay entre lotes: ${delay}ms (${delay/1000}s)`));
    console.log(chalk.white(`🔗 API: https://api.gemeosbrasil.com.br/api/auth/login/client`));
    if (continuous) {
      console.log(chalk.green(`🔄 Modo contínuo: ATIVADO`));
    }
    console.log('');
    
    // Confirmação do usuário
    console.log(chalk.yellow('⚠️  ATENÇÃO: Este tool faz requisições para uma API externa.'));
    console.log(chalk.yellow('   Use com responsabilidade e respeite os limites da API.'));
    console.log('');
    
    // Inicia o checker
    const checker = new GemeosChecker({
      delay: delay,
      timeout: 15000,
      maxRetries: 2
    });
    
    // Função para executar uma rodada de verificações
    async function runVerification() {
      try {
        // Gera CPFs válidos
        console.log(chalk.blue('🎲 Gerando CPFs válidos...'));
        const cpfs = CPFGenerator.generateMultiple(count);
        console.log(chalk.green(`✅ ${cpfs.length} CPFs válidos gerados!`));
        console.log('');
        
        // Exibe alguns CPFs de exemplo
        console.log(chalk.blue('📋 Exemplos de CPFs gerados:'));
        cpfs.slice(0, 5).forEach((cpf, index) => {
          console.log(chalk.white(`  ${index + 1}. ${cpf}`));
        });
        if (cpfs.length > 5) {
          console.log(chalk.gray(`  ... e mais ${cpfs.length - 5} CPFs`));
        }
        console.log('');
        
        // Executa as verificações
        await checker.checkMultipleCPFs(cpfs);
        
        // Exibe resumo
        checker.showSummary();
        
        // Salva resultados
        await checker.saveResults();
        
        console.log('');
        console.log(chalk.green('🎉 Verificação concluída com sucesso!'));
        
        // Se for modo contínuo, aguarda e executa novamente
        if (continuous) {
          console.log('');
          console.log(chalk.blue('🔄 Modo contínuo ativo. Aguardando 30 segundos para próxima rodada...'));
          console.log(chalk.gray('   Pressione Ctrl+C para parar'));
          console.log('');
          
          // Aguarda 30 segundos antes da próxima rodada
          await new Promise(resolve => setTimeout(resolve, 30000));
          
          // Limpa contadores para próxima rodada
          checker.results = [];
          checker.successCount = 0;
          checker.errorCount = 0;
          checker.registeredCount = 0;
          checker.unregisteredCount = 0;
          
          console.log(chalk.blue('🔄 Iniciando próxima rodada...'));
          console.log(chalk.blue('='.repeat(40)));
          console.log('');
          
          // Executa próxima rodada
          await runVerification();
        }
        
      } catch (error) {
        console.error(chalk.red('❌ Erro durante a execução:'));
        console.error(chalk.red(error.message));
        
        if (error.code === 'ECONNREFUSED') {
          console.error(chalk.red('   Verifique se a API está acessível'));
        } else if (error.code === 'ENOTFOUND') {
          console.error(chalk.red('   Verifique sua conexão com a internet'));
        }
        
        if (continuous) {
          console.log(chalk.yellow('⚠️  Aguardando 60 segundos antes de tentar novamente...'));
          await new Promise(resolve => setTimeout(resolve, 60000));
          await runVerification();
        } else {
          process.exit(1);
        }
      }
    }
    
    // Executa a verificação
    await runVerification();
    
  } catch (error) {
    console.error(chalk.red('❌ Erro fatal:'));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}

// Tratamento de interrupção (Ctrl+C)
process.on('SIGINT', () => {
  console.log('');
  console.log(chalk.yellow('⚠️  Interrompido pelo usuário'));
  process.exit(0);
});

// Executa o programa
if (require.main === module) {
  main();
}

module.exports = { main }; 
