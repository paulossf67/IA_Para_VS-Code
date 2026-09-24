# Local AI Assistant para VS Code

Extensão de IA **100% local** usando Ollama.  
Inclui:

- Chat em painel lateral
- Autocomplete enquanto digita (Inline Completion)
- Comandos: Explicar, Documentar, Refatorar, Gerar Testes, Corrigir

---

## 1. Pré-requisitos (Windows)

### 1.1 Instalar Node.js

1. Acesse: https://nodejs.org
2. Baixe a versão **LTS** (recomendada)
3. Instale normalmente (deixe as opções padrão)
4. Abra um **novo** terminal (PowerShell ou CMD) e teste:

```bash
node -v
npm -v
```

Ambos devem mostrar uma versão.

### 1.2 Instalar Ollama

1. Acesse: https://ollama.com
2. Baixe e instale o Ollama para Windows
3. Após instalar, abra o terminal e rode:

```bash
ollama serve
```

Deixe esse terminal aberto (ou o Ollama roda em segundo plano normalmente).

### 1.3 Baixar um modelo bom para código

No terminal:

```bash
ollama pull qwen2.5-coder:7b
```

**Outras opções boas:**
- `qwen2.5-coder:14b` → melhor qualidade (precisa de mais RAM/VRAM)
- `deepseek-coder-v2:16b`
- `llama3.1:8b` → mais geral

---

## 2. Como rodar a extensão (modo desenvolvimento)

1. Abra a pasta do projeto (a que contém o `package.json`) no VS Code
2. Abra o terminal integrado (`Ctrl + '`)
3. Instale as dependências:

```bash
npm install
```

4. Compile o TypeScript:

```bash
npm run compile
```

5. Pressione **F5**  
   Isso abre uma nova janela do VS Code chamada **"Extension Development Host"**

6. Nessa nova janela a extensão já estará ativa!

---

## 3. Como usar

### Chat
- Clique no ícone de robô na barra lateral esquerda
- Ou pressione `Ctrl + Shift + A`
- Blocos de código na resposta têm os botões **Copiar** e **Inserir** (insere no editor, substituindo a seleção)
- O botão com o nome do modelo, no topo do chat, troca o modelo

### Comandos rápidos
1. Selecione um trecho de código
2. Clique com o botão direito → menu **Local AI**
3. Ou use a Command Palette (`Ctrl + Shift + P`) e digite "Local AI"

### Autocomplete
- Comece a digitar código normalmente
- Quando você para de digitar (delay configurável), a extensão sugere a continuação; `Tab` aceita
- Nos modelos que suportam FIM (qwen2.5-coder, deepseek-coder, codellama…) o modelo vê o código antes **e depois** do cursor, o que dá sugestões melhores. Outros modelos usam o chat como plano B
- Você pode desativar em: **Settings → Local AI → Enable Inline Completion**

### Atalhos
| Atalho              | Ação                  |
|---------------------|-----------------------|
| `Ctrl + Shift + A`  | Abrir Chat            |
| `Ctrl + Shift + Space` | Completar no cursor |

---

## 4. Configurações

Vá em **Settings** e procure por `Local AI`:

- `local-ai.ollamaUrl` → padrão: `http://localhost:11434`
- `local-ai.model` → modelo que você baixou
- `local-ai.enableInlineCompletion` → liga/desliga autocomplete
- `local-ai.temperature` → 0.1 a 0.3 é bom para código
- `local-ai.maxTokens` → tamanho máximo da resposta
- `local-ai.numCtx` → tamanho do contexto enviado ao Ollama (padrão 8192). O padrão do próprio Ollama é pequeno e corta código longo; aumente se tiver memória sobrando, diminua se ficar lento
- `local-ai.maxHistoryMessages` → quantas mensagens anteriores do chat vão para o modelo (padrão 20)
- `local-ai.inlineCompletionDelay` → quanto tempo (ms) esperar depois da última tecla antes de sugerir

Também dá para trocar o modelo pelo comando **Local AI: Escolher Modelo** (`Ctrl + Shift + P`).

---

## 5. Empacotar a extensão (opcional)

Para gerar um arquivo `.vsix` e instalar permanentemente:

```bash
npm install
npm run package
```

(O `vsce` já vem nas dependências de desenvolvimento, não precisa instalar globalmente.)

Depois instale o `.vsix` gerado:
- `Ctrl + Shift + P` → **Extensions: Install from VSIX...**

---

## Dicas de performance

- Modelos 7B rodam bem em CPU (mais lento) ou GPU com 6GB+
- Modelos 14B+ precisam de mais memória
- Para respostas mais rápidas, use temperatura baixa (0.1–0.2)
- O autocomplete só dispara depois de um pequeno delay (configurável)

---

## Sobre os arquivos `.bat`

`install.bat`, `start-windows.bat` e `optimiced.bat` **não fazem parte da extensão**. São de um projeto de IA portátil em pendrive (Ollama + AnythingLLM) e dependem de arquivos que não estão nesta pasta (`install-core.ps1`, `ollama\`, `anythingllm\`). Eles ficam fora do `.vsix` pelo `.vscodeignore`.

---

Feito com ❤️ para quem quer privacidade e controle total da IA.
