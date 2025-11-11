# Changelog - Melhorias de Arquitetura

## [1.6.0] - 2025-01-XX

### ✨ Novas Funcionalidades

#### 📋 Configuração Centralizada
- **Novo arquivo `config.json`**: Todas as configurações em um único lugar
  - APIs (gemeos, saude, workbuscas)
  - Proxies (Webshare)
  - Checkers (batch size, delays, timeouts)
  - Segurança (SSL)
  - Logging e métricas

#### 🔒 Segurança Aprimorada
- **Variáveis de ambiente**: Tokens removidos do código
  - `WS_PROXY_TOKEN` - Token da Webshare
  - `WORKBUSCAS_TOKEN` - Token do WorkBuscas
  - `SSL_REJECT_UNAUTHORIZED` - Configuração SSL
- **Arquivo `.env.example`**: Template para configuração
- **Config loader**: Prioriza env vars sobre valores padrão

#### 📝 Logs Estruturados
- **Novo módulo `logger.js`**: Sistema completo de logs
  - Formato JSON para análise
  - Rotação automática de arquivos
  - Níveis: error, warn, info, debug
  - Output: console (legível) + arquivo (JSON)
  - Configurável via `config.json` e `.env`

#### 📊 Métricas de Performance
- **Novo módulo `metrics.js`**: Coleta automática de métricas
  - Total de requisições (sucesso/falha)
  - Tempo médio de resposta
  - Taxa de sucesso por módulo
  - Rate limits detectados
  - Proxies testados/válidos
  - Salva automaticamente em `./logs/metrics.json`

#### 🚦 Rate Limiting Inteligente
- **Novo módulo `rate-limiter.js`**: Gestão avançada de rate limits
  - Backoff exponencial automático
  - Prevenção proativa de rate limits
  - Retry inteligente
  - Estatísticas em tempo real
  - Configurável por módulo

### 🔧 Melhorias

#### GemeosChecker Atualizado
- Usa configuração centralizada
- Integrado com logger estruturado
- Métricas automáticas
- Rate limiting inteligente
- SSL configurável via env

### 📚 Documentação

- **`MIGRATION-GUIDE.md`**: Guia completo de migração
  - Como configurar variáveis de ambiente
  - Exemplos de uso
  - Troubleshooting

### 🔄 Mudanças que Quebram Compatibilidade

⚠️ **Nenhuma!** Todas as mudanças são retrocompatíveis.

Os tokens padrão ainda funcionam como fallback se as variáveis de ambiente não estiverem definidas.

### 📦 Arquivos Novos

```
gemeos-checker/
├── config.json              # Configuração centralizada
├── config-loader.js         # Carregador de configuração
├── logger.js                # Sistema de logs estruturados
├── metrics.js               # Coletor de métricas
├── rate-limiter.js          # Rate limiter inteligente
├── .env.example             # Template de variáveis de ambiente
├── MIGRATION-GUIDE.md       # Guia de migração
└── CHANGELOG.md             # Este arquivo
```

### 🐛 Correções

- N/A (sem correções de bugs nesta versão)

### ⚙️ Configuração

#### Variáveis de Ambiente Recomendadas

```bash
# .env
WS_PROXY_TOKEN=seu_token_aqui
WORKBUSCAS_TOKEN=seu_token_aqui
SSL_REJECT_UNAUTHORIZED=false
LOG_LEVEL=info
METRICS_ENABLED=true
```

### 📈 Próximas Melhorias Planejadas

- [ ] Atualizar SaudeChecker para usar nova arquitetura
- [ ] Atualizar WorkBuscasChecker para usar nova arquitetura
- [ ] Dashboard web para visualizar métricas
- [ ] Banco de dados para histórico de verificações
- [ ] API REST para integrações externas

---

## Como Usar

### 1. Configurar variáveis de ambiente

```bash
cp .env.example .env
# Edite .env com seus tokens
```

### 2. Ajustar config.json (opcional)

Edite `config.json` conforme suas necessidades.

### 3. Usar normalmente

```javascript
const GemeosChecker = require('./modules/gemeos/checker');

const checker = new GemeosChecker();
// Tudo funciona igual, mas agora com logs, métricas e rate limiting!
```

---

**Autor:** Mr.Robot  
**Data:** 2025-01-XX  
**Versão:** 1.6.0

