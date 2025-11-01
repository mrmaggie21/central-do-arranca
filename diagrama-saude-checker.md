# Diagrama de Fluxo - Saúde Diária Checker

## Fluxo Completo do Checker

```
┌─────────────────────────────────────────────────────────────────┐
│                    INÍCIO DO PROCESSO                          │
│                   checkCPF(cpf = null?)                        │
└──────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │ CPF fornecido? │
                    └───────┬────────┘
                            │
           ┌────────────────┴────────────────┐
           │ SIM                              │ NÃO
           ▼                                  ▼
    ┌──────────────┐                  ┌──────────────────┐
    │ Usa CPF     │                  │ generateValidCPF()│
    │ fornecido   │                  │ Gera CPF válido   │
    └──────┬───────┘                  └────────┬─────────┘
           │                                   │
           └──────────────────┬────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ Remove formatação│
                    │ do CPF          │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ CPF válido?     │
                    │ (11 dígitos)    │
                    └────────┬────────┘
                             │
                  ┌──────────┴──────────┐
                  │ SIM                 │ NÃO
                  ▼                     ▼
         ┌─────────────────┐    ┌──────────────┐
         │ Continua        │    │ Return ERROR │
         └────────┬────────┘    └──────────────┘
                  │
                  ▼
    ┌─────────────────────────────────────────┐
    │   consultWorkBuscas(cpf)                │
    │   - Faz GET na API WorkBuscas           │
    │   - Extrai TODOS os emails              │
    │   - Extrai TODOS os telefones           │
    └──────────────────┬──────────────────────┘
                       │
                       ▼
            ┌──────────────────────┐
            │ Emails E telefones   │
            │ encontrados?         │
            └──────┬───────────────┘
                   │
      ┌────────────┴────────────┐
      │ NÃO                    │ SIM
      ▼                        ▼
┌─────────────┐       ┌─────────────────────┐
│ Return      │       │ Prepara dados       │
│ SKIPPED     │       │ - emails[]          │
│ (não testa) │       │ - phones[]          │
└─────────────┘       └──────────┬──────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │ Proxies disponíveis?   │
                    └───────┬───────────────┘
                            │
              ┌─────────────┴─────────────┐
              │ NÃO                       │ SIM
              ▼                           ▼
    ┌─────────────────┐       ┌───────────────────┐
    │ Return ERROR    │       │ Continua           │
    │ (sem proxy)     │       │ processamento      │
    └─────────────────┘       └─────────┬──────────┘
                                        │
                                        ▼
                        ┌───────────────────────────────┐
                        │   LOOP: Para cada EMAIL       │
                        │   encontrado no WorkBuscas    │
                        └───────────────┬───────────────┘
                                        │
                                        ▼
                        ┌───────────────────────────────┐
                        │ Usa primeiro telefone         │
                        │ phones[0]                     │
                        └───────────────┬───────────────┘
                                        │
                                        ▼
                        ┌───────────────────────────────┐
                        │ getRandomProxy()              │
                        │ - Seleciona proxy aleatório    │
                        └───────────────┬───────────────┘
                                        │
                                        ▼
                        ┌───────────────────────────────┐
                        │   LOOP RETRY (max 3x)         │
                        │                               │
                        │   makeAPIRequest(             │
                        │     cpf,                      │
                        │     email,                    │
                        │     phonenumber,              │
                        │     proxy                     │
                        │   )                           │
                        └───────────────┬───────────────┘
                                        │
                        ┌───────────────┴───────────────┐
                        │                               │
                        ▼                               ▼
                ┌───────────────┐              ┌──────────────┐
                │ Sucesso ou    │              │ Erro de rede?│
                │ CADASTRADO?   │              │ (timeout,     │
                │               │              │  ECONNREFUSED)│
                └───────┬───────┘              └──────┬───────┘
                        │                             │
            ┌───────────┴──────────┐      ┌───────────┴──────────┐
            │ SIM                  │      │ SIM                  │
            ▼                      │      ▼                      │
    ┌───────────────┐             │ ┌──────────────┐            │
    │ Para loop     │             │ │ Retry count  │            │
    │ emails        │             │ │ < 3?          │            │
    │               │             │ └──────┬───────┘            │
    │ finalResult = │             │         │                    │
    │ result        │             │   ┌─────┴─────┐              │
    │               │             │   │ SIM       │              │
    │ BREAK         │             │   │           │              │
    └───────┬───────┘             │   ▼           │              │
            │                     │ ┌───────────┐ │              │
            │                     │ │ Nova proxy│ │              │
            │                     │ │ Sleep 500ms│              │
            │                     │ │ CONTINUE  │ │              │
            │                     │ └───────────┘ │              │
            │                     │               │              │
            │                     └───────┬───────┘              │
            │                             │                      │
            │                             │ NÃO                  │
            │                             ▼                      │
            │                     ┌──────────────┐              │
            │                     │ Para retry    │              │
            │                     │ continua     │              │
            │                     │ próximo email│              │
            │                     └───────┬───────┘              │
            │                             │                      │
            │                             │                      │
            └─────────────────────────────┴──────────────────────┘
                                        │
                                        ▼
                            ┌───────────────────────┐
                            │ CPF CADASTRADO        │
                            │ encontrado?           │
                            │ (finalResult &&       │
                            │  interpretation ==    │
                            │  'registered')        │
                            └───────┬───────────────┘
                                    │
                        ┌───────────┴───────────┐
                        │ SIM                  │ NÃO
                        ▼                      ▼
                ┌──────────────┐       ┌────────────────┐
                │ BREAK loop   │       │ Testa próximo  │
                │ emails       │       │ email ou       │
                │               │       │ guarda último  │
                │               │       │ resultado      │
                └───────┬───────┘       └────────┬───────┘
                        │                       │
                        └───────────┬───────────┘
                                    │
                                    ▼
                        ┌───────────────────────┐
                        │ Atualiza contadores   │
                        │ - successCount        │
                        │ - errorCount          │
                        │ - registeredCount    │
                        │ - unregisteredCount   │
                        └───────────┬───────────┘
                                    │
                                    ▼
                        ┌───────────────────────┐
                        │ Adiciona dados        │
                        │ WorkBuscas ao         │
                        │ resultado             │
                        └───────────┬───────────┘
                                    │
                                    ▼
                        ┌───────────────────────┐
                        │ Garante que proxy     │
                        │ está no resultado     │
                        │ (não pode ser N/A)    │
                        └───────────┬───────────┘
                                    │
                                    ▼
                        ┌───────────────────────┐
                        │   RETURN RESULT       │
                        │                       │
                        │   {                   │
                        │     cpf,               │
                        │     success,          │
                        │     status,           │
                        │     interpretation,   │
                        │     proxy,            │
                        │     workbuscas        │
                        │   }                   │
                        └───────────────────────┘
```

## Detalhes Importantes

### 1. Geração de CPF
- Se `cpf` não fornecido → `generateValidCPF()` gera um CPF válido matematicamente
- Remove formatação (pontos e traços)

### 2. Consulta WorkBuscas
- Extrai **TODOS** os emails encontrados (não apenas o primeiro)
- Extrai **TODOS** os telefones encontrados (não apenas o primeiro)
- Se não encontrou **nenhum** email **E** nenhum telefone → retorna `skipped`

### 3. Teste com Todos os Emails
- **Loop para cada email** encontrado no WorkBuscas
- Usa o primeiro telefone para todos os emails (ou pode ser ajustado para testar todas combinações)
- **Para imediatamente** se encontrar um email que retorna `registered`

### 4. Sistema de Proxy
- **FORÇA uso de proxy** - não permite requisição sem proxy se houver proxies disponíveis
- Se não há proxies → retorna erro (não testa)
- **Retry com rotação de proxy**: em caso de erro de rede/timeout, tenta com outro proxy (até 3 vezes)
- **Nunca** tenta sem proxy (removido fallback)

### 5. Interpretação de Resultados
- **Status 201** → CPF CADASTRADO
- **Status 202 + msg "não conferem"** → CPF NÃO CADASTRADO
- **Status 202 + msg "enviado email"** → CPF CADASTRADO

### 6. Resultado Final
- Sempre inclui o proxy usado no resultado
- Inclui dados do WorkBuscas (se encontrado)
- Atualiza contadores estatísticos

## Vantagens do Fluxo

✅ **Testa todos os emails** - aumenta chance de encontrar CPF cadastrado  
✅ **Força uso de proxy** - evita rate limiting e bloqueios  
✅ **Rotação de proxy** - em caso de erro, tenta com outro  
✅ **Otimização** - para de testar se já encontrou cadastrado  
✅ **Dados completos** - salva informações do WorkBuscas para CPFs válidos  

