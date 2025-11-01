# Diagrama de Fluxo - Saúde Diária Checker (Simplificado)

## Fluxo Principal

```
[INÍCIO]
  │
  ▼
Gera/Recebe CPF
  │
  ▼
Consulta WorkBuscas
  │
  ├─► Emails e telefones encontrados?
  │   │
  │   ├─► NÃO ──► [SKIP - Dados insuficientes]
  │   │
  │   └─► SIM
  │       │
  │       ▼
  │   Proxies disponíveis?
  │       │
  │       ├─► NÃO ──► [ERRO - Sem proxy]
  │       │
  │       └─► SIM
  │           │
  │           ▼
  │       Para cada EMAIL encontrado:
  │           │
  │           ├─► Seleciona proxy aleatório
  │           │
  │           ├─► Testa API Saúde Diária
  │           │   │
  │           │   ├─► Sucesso/Cadastrado?
  │           │   │   │
  │           │   │   └─► SIM ──► [PARA - CPF CADASTRADO]
  │           │   │
  │           │   └─► Erro de rede?
  │           │       │
  │           │       └─► SIM ──► Retry com novo proxy (até 3x)
  │           │
  │           └─► Se não cadastrado, testa próximo email
  │
  ▼
Atualiza contadores
  │
  ▼
Adiciona dados WorkBuscas
  │
  ▼
[RETORNA RESULTADO]
```

## Resumo dos Passos

### 1. Preparação
- Gera CPF válido OU usa CPF fornecido
- Remove formatação

### 2. Consulta WorkBuscas
- Busca **TODOS** os emails do CPF
- Busca **TODOS** os telefones do CPF
- Se não encontrou nenhum → **SKIP**

### 3. Verificação de Proxies
- Se não há proxies → **ERRO**
- Se há proxies → continua

### 4. Teste na API
- Loop: Para cada email encontrado
  - Seleciona proxy aleatório
  - Testa API Saúde Diária
  - Se cadastrado → **PARA** (não testa outros emails)
  - Se erro de rede → retry com novo proxy (máx 3x)

### 5. Resultado Final
- Status: CADASTRADO / NÃO CADASTRADO / ERRO
- Inclui proxy usado
- Inclui dados do WorkBuscas

## Regras Importantes

✅ **Testa TODOS os emails** - aumenta chance de encontrar  
✅ **Força uso de proxy** - nunca testa sem proxy  
✅ **Retry com rotação** - em caso de erro, tenta outro proxy  
✅ **Para imediatamente** - se encontrar cadastrado com qualquer email  

