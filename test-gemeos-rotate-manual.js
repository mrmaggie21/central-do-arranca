/**
 * Teste manual do proxy rotate do Gemeos
 * Para debugar problemas com Cloudflare e proxy rotate
 */

const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');
const HttpsProxyAgent = require('https-proxy-agent');

// Configuração do proxy rotate
const proxyConfig = {
  host: 'p.webshare.io',
  port: 80,
  username: 'qkwskesg-rotate',
  password: '8f5e27vxgc2y',
  protocol: 'socks5'
};

// CPF de teste
const testCPF = '07411506460'; // Sem pontos/traços

// URL da API Gemeos
const apiUrl = `https://dashboard.gemeosbrasil.me/api/ver-numeros?telefone=null&cpf=${testCPF}&lojista=null`;

async function testWithSOCKS5() {
  console.log('\n=== TESTE 1: SOCKS5 ===');
  try {
    const authPart = `${encodeURIComponent(proxyConfig.username)}:${encodeURIComponent(proxyConfig.password)}@`;
    const proxyUrl = `socks5://${authPart}${proxyConfig.host}:${proxyConfig.port}`;
    
    console.log('Proxy URL:', proxyUrl.replace(proxyConfig.password, '***'));
    console.log('API URL:', apiUrl);
    
    const agent = new SocksProxyAgent(proxyUrl);
    
    const response = await axios({
      method: 'get',
      url: apiUrl,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'accept': 'application/json, text/plain, */*',
        'accept-encoding': 'gzip, deflate, br, zstd',
        'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'origin': 'https://www.gemeosbrasil.me',
        'referer': 'https://www.gemeosbrasil.me/'
      },
      httpsAgent: agent,
      httpAgent: agent,
      timeout: 10000,
      validateStatus: function (status) {
        return status >= 200 && status < 500;
      }
    });
    
    console.log('✅ Status:', response.status);
    console.log('✅ Headers:', JSON.stringify(response.headers, null, 2));
    console.log('✅ Data:', JSON.stringify(response.data, null, 2));
    
    // Verifica se é Cloudflare
    const isCloudflare = response.data && (
      typeof response.data === 'string' && (
        response.data.includes('cf-ray') ||
        response.data.includes('checking your browser') ||
        response.data.includes('Cloudflare') ||
        response.data.includes('Just a moment')
      )
    );
    
    if (isCloudflare) {
      console.log('⚠️ CLOUDFLARE DETECTADO!');
    }
    
    return response;
  } catch (error) {
    console.error('❌ Erro SOCKS5:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
    throw error;
  }
}

async function testWithHTTP() {
  console.log('\n=== TESTE 2: HTTP ===');
  try {
    const authPart = `${encodeURIComponent(proxyConfig.username)}:${encodeURIComponent(proxyConfig.password)}@`;
    const proxyUrl = `http://${authPart}${proxyConfig.host}:${proxyConfig.port}`;
    
    console.log('Proxy URL:', proxyUrl.replace(proxyConfig.password, '***'));
    console.log('API URL:', apiUrl);
    
    const agent = new HttpsProxyAgent.HttpsProxyAgent(proxyUrl);
    
    const response = await axios({
      method: 'get',
      url: apiUrl,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'accept': 'application/json, text/plain, */*',
        'accept-encoding': 'gzip, deflate, br, zstd',
        'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'origin': 'https://www.gemeosbrasil.me',
        'referer': 'https://www.gemeosbrasil.me/'
      },
      httpsAgent: agent,
      timeout: 10000,
      validateStatus: function (status) {
        return status >= 200 && status < 500;
      }
    });
    
    console.log('✅ Status:', response.status);
    console.log('✅ Headers:', JSON.stringify(response.headers, null, 2));
    console.log('✅ Data:', JSON.stringify(response.data, null, 2));
    
    // Verifica se é Cloudflare
    const isCloudflare = response.data && (
      typeof response.data === 'string' && (
        response.data.includes('cf-ray') ||
        response.data.includes('checking your browser') ||
        response.data.includes('Cloudflare') ||
        response.data.includes('Just a moment')
      )
    );
    
    if (isCloudflare) {
      console.log('⚠️ CLOUDFLARE DETECTADO!');
    }
    
    return response;
  } catch (error) {
    console.error('❌ Erro HTTP:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
    throw error;
  }
}

async function testWithoutProxy() {
  console.log('\n=== TESTE 3: SEM PROXY ===');
  try {
    const response = await axios({
      method: 'get',
      url: apiUrl,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'accept': 'application/json, text/plain, */*',
        'accept-encoding': 'gzip, deflate, br, zstd',
        'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'origin': 'https://www.gemeosbrasil.me',
        'referer': 'https://www.gemeosbrasil.me/'
      },
      timeout: 10000,
      validateStatus: function (status) {
        return status >= 200 && status < 500;
      }
    });
    
    console.log('✅ Status:', response.status);
    console.log('✅ Headers:', JSON.stringify(response.headers, null, 2));
    console.log('✅ Data:', JSON.stringify(response.data, null, 2));
    
    return response;
  } catch (error) {
    console.error('❌ Erro sem proxy:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
    throw error;
  }
}

async function runTests() {
  console.log('🔍 TESTE MANUAL - Gemeos API com Proxy Rotate');
  console.log('CPF:', testCPF);
  console.log('='.repeat(60));
  
  try {
    // Teste 1: SOCKS5
    await testWithSOCKS5();
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Teste 2: HTTP
    await testWithHTTP();
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Teste 3: Sem proxy
    await testWithoutProxy();
    
    console.log('\n✅ Todos os testes concluídos!');
  } catch (error) {
    console.error('\n❌ Erro nos testes:', error.message);
  }
}

runTests();

