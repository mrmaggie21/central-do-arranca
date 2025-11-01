# 🚀 Guia de Releases - Central do Arranca

## Como criar uma nova release no GitHub

Para que o sistema de atualização automática funcione, você precisa criar releases no GitHub com os arquivos de build.

### Passo 1: Build do aplicativo

Execute o build do aplicativo:

```bash
npm run pack
```

Isso criará o executável em `dist/Central do Arranca-win32-x64/`

### Passo 2: Criar um ZIP do executável

1. Vá até a pasta `dist/`
2. Crie um ZIP do arquivo `Central do Arranca-win32-x64.zip` (já criado automaticamente) OU
3. Compacte manualmente a pasta `Central do Arranca-win32-x64/` em um arquivo ZIP

**Importante:** O arquivo ZIP deve ter um nome padronizado, por exemplo:
- `Central-do-Arranca-v1.2.0-win32-x64.zip`

### Passo 3: Criar a Release no GitHub

1. Acesse: https://github.com/mrmaggie21/central-do-arranca/releases/new

2. Preencha os campos:
   - **Tag version:** Use o formato de versão (ex: `v1.2.0`)
   - **Release title:** "Central do Arranca v1.2.0"
   - **Description:** Descreva as mudanças desta versão:
     ```markdown
     ## Novidades
     - ✨ Nova funcionalidade X
     - 🐛 Correção de bug Y
     - 📝 Melhorias gerais
     ```

3. **Arraste o arquivo ZIP** para a seção "Attach binaries"

4. Clique em **"Publish release"**

### Passo 4: Verificação

O sistema de atualização automática irá:
- Verificar a última release disponível
- Comparar a versão local com a versão no GitHub
- Se houver nova versão, fazer download automaticamente
- Mostrar progresso na splash screen

## Estrutura de Versionamento

Use **Semantic Versioning** (SemVer):
- `1.0.0` → `1.0.1` (patch: correções)
- `1.0.0` → `1.1.0` (minor: novas funcionalidades)
- `1.0.0` → `2.0.0` (major: mudanças incompatíveis)

## Checklist antes de fazer release

- [ ] Atualizar `version` no `package.json`
- [ ] Testar o build (`npm run pack`)
- [ ] Verificar se o executável funciona
- [ ] Criar ZIP do executável
- [ ] Criar release no GitHub com tag `v{versão}`
- [ ] Anexar o arquivo ZIP na release
- [ ] Testar atualização automática instalando uma versão anterior

## Notas Importantes

⚠️ **IMPORTANTE:** O arquivo ZIP deve ser criado a partir da pasta completa `Central do Arranca-win32-x64/`, não apenas o `.exe`.

⚠️ **IMPORTANTE:** A tag da release deve começar com `v` (ex: `v1.2.0`)

⚠️ **IMPORTANTE:** O sistema busca a primeira asset da release para download. Certifique-se de que é um arquivo ZIP válido.

## Exemplo de Release

**Tag:** `v1.1.0`
**Title:** Central do Arranca v1.1.0
**Files:** `Central-do-Arranca-v1.1.0-win32-x64.zip`

O sistema automaticamente:
1. Detectará que a versão local (1.0.0) é menor que 1.1.0
2. Baixará o ZIP automaticamente
3. Mostrará o progresso na splash screen
4. Informará ao usuário para reiniciar o aplicativo

