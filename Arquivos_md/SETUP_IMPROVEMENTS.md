# 🔧 Guia de Setup das Melhorias

## Passo 1: Instalar Dependências

```bash
cd F:\IA_Para_VS-Code

# Instala vitest e dependências de teste
npm install

# ou se npm não funcionar, tente yarn
yarn install
```

**Esperado:** Você verá `added N packages` e `up to date` ao final.

---

## Passo 2: Compilar TypeScript

```bash
npm run compile
```

**Esperado:** Sem erros. Você verá:
```
(no output = sucesso!)
```

Se houver erros, revise:
- Imports em `src/chat/ChatPanel.ts`
- Caminho do CSS em `_getHtml()`
- Tipos do `vscode.Memento`

---

## Passo 3: Executar Testes

```bash
# Roda testes no terminal
npm run test:unit

# OU abra dashboard interativo
npm run test:unit -- --ui

# OU veja cobertura de código
npm run test:unit -- --coverage
```

**Esperado:** Todos os 11+ testes passam ✅

```
✓ retry.test.ts (4 testes)
✓ ollama.test.ts (7 testes)

Test Files  2 passed (2)
Tests      11 passed (11)
```

---

## Passo 4: Testar no VS Code

### Opção A: Executar Extensão em Desenvolvimento

```bash
# No VS Code, abra o diretório do projeto
File → Open Folder → selecione F:\IA_Para_VS-Code

# Pressione F5 (Launch Extension)
# Abrirá nova janela do VS Code com a extensão carregada
```

### Opção B: Build e Package (opcional)

```bash
# Compila e cria arquivo .vsix
npm run package
```

---

## Verificação: Histórico Persistido

### Como Testar
1. Abra o painel chat (Ctrl+Shift+A)
2. Envie uma mensagem: "Olá, sou um teste"
3. Feche o painel (clique no X)
4. Reabra o painel (Ctrl+Shift+A)

**Esperado:** Sua mensagem anterior aparece! ✅

---

## Verificação: Context do Projeto

### Como Testar
1. Abra painel chat
2. Pergunte: "Quais linguagens este projeto usa?"

**Esperado:** A IA responde algo como:
> "Este projeto usa TypeScript, JavaScript, HTML e CSS. É uma extensão VS Code chamada 'local-ai-vscode'..."

Se receber apenas resposta genérica, contexto não foi injetado.

---

## Verificação: Retry Automático

### Como Testar
1. Desligue o Ollama
2. Envie mensagem no chat
3. Veja erros na console (F12 → Console)

**Esperado:** Log mostra tentativas:
```
Attempt 1/3: requesting...
Attempt 2/3: retrying after 1000ms...
Attempt 3/3: retrying after 2000ms...
Error: connection refused
```

---

## Troubleshooting

### ❌ `npm not recognized`
- Instale Node.js: https://nodejs.org
- Reinicie terminal após instalar
- Ou use `yarn` em vez de `npm`

### ❌ `tsc: command not found`
```bash
# Use npx (vem com npm)
npx tsc --version

# Ou compile via npm script
npm run compile
```

### ❌ Testes falham
```bash
# Limpar cache e reinstalar
rm -r node_modules package-lock.json
npm install
npm run test:unit
```

### ❌ CSS não carrega (webview em branco)
- Verifique que `src/chat/chat.css` existe
- `npm run compile` precisa copiar para `out/`
- Veja F12 → Console da webview para erros de CSP

### ❌ Histórico não persiste
- Limpar `globalState` de VS Code:
  ```bash
  # No terminal integrado do VS Code
  code --user-data-dir /tmp/vscode-clean
  ```
- Ou execute: `Developer: Clear All Global State`

---

## 📋 Checklist de Validação

- [ ] `npm install` sem erros
- [ ] `npm run compile` sem erros
- [ ] `npm run test:unit` com 11+ testes ✅
- [ ] F5 abre extensão em debug
- [ ] Chat mantém histórico ao fechar
- [ ] Context injeta info do projeto
- [ ] Retry aparece em logs
- [ ] CSS carrega sem erros

---

## 🎓 Estrutura de Código

```typescript
// Para entender o fluxo de persistência:
ChatViewProvider.constructor()
  ├─ loadHistoryFromStorage()        // restaura
  └─ // conversas restauradas ✓

ChatViewProvider.dispose()
  └─ saveHistoryToStorage()          // salva últimas 100

handleUserMessage(text)
  ├─ getProjectContext()             // injeta contexto
  ├─ retryWithBackoff(chatStream)    // 3 tentativas
  └─ saveHistoryToStorage()          // persiste

// Para testar um utilitário isolado:
import { retryWithBackoff } from './utils/retry';

const result = await retryWithBackoff(
  () => fetch(...),
  3,
  1000
);
```

---

## 🔗 Referências Rápidas

| Arquivo | Propósito |
|---------|-----------|
| `src/chat/chat.css` | Estilos da webview |
| `src/utils/projectContext.ts` | Análise de projeto |
| `src/utils/retry.ts` | Retry com backoff |
| `src/utils/retry.test.ts` | Testes de retry |
| `src/utils/ollama.test.ts` | Testes de utils |
| `IMPROVEMENTS.md` | Documentação detalhada |
| `CHANGES_SUMMARY.md` | Resumo visual |

---

## ⚡ Comandos Úteis

```bash
# Desenvolvimento
npm run watch              # Recompila ao salvar

# Testes
npm run test:unit         # Roda testes
npm run test:unit -- --ui # UI interativa

# Deploy
npm run package           # Cria .vsix
npm publish               # Publica na VS Code Marketplace

# Debug
npm run compile -- --sourceMap   # Habilita source maps
```

---

## 💬 Suporte

Se encontrar problemas:

1. Verifique o console: F12 → Console
2. Veja os logs: `npm run test:unit`
3. Releia `IMPROVEMENTS.md` para contexto
4. Limpe cache: `rm -r out node_modules`, `npm install`

---

**Status:** ✅ Todas as 5 melhorias implementadas e documentadas!
