# Local AI Assistant for VS Code

[![Version](https://img.shields.io/visual-studio-marketplace/v/paulosergio.local-ai-vscode)](https://marketplace.visualstudio.com/items?itemName=paulosergio.local-ai-vscode)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/paulosergio.local-ai-vscode)](https://marketplace.visualstudio.com/items?itemName=paulosergio.local-ai-vscode)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/paulosergio.local-ai-vscode)](https://marketplace.visualstudio.com/items?itemName=paulosergio.local-ai-vscode)
[![License](https://img.shields.io/github/license/paulosergio/local-ai-vscode)](LICENSE)

**100% Local AI Assistant** powered by [Ollama](https://ollama.com). Your code never leaves your machine.

## ✨ Features

| Feature | Description |
|---------|-------------|
| 💬 **Chat Sidebar** | Full-featured chat with streaming, history, copy/insert code blocks |
| ⚡ **Inline Autocomplete** | FIM (Fill-in-the-Middle) for supported models (qwen2.5-coder, deepseek-coder), fallback to chat |
| 🔧 **Code Commands** | Explain, Document, Refactor, Generate Tests, Fix Code - via context menu or Command Palette |
| 📁 **Smart Context** | Auto-includes active file, entry points, config files; respects token budget (`numCtx`) |
| 🗂️ **Context Groups** | Organize files by patterns (Backend, Frontend, Tests, etc.) with priority |
| 🔍 **Semantic Search** | Search chat history & project files using embeddings (`nomic-embed-text`) |
| 🐛 **Bug Detective** | Detect hardcoded secrets, missing error handling, SQL injection risks, infinite loops |
| ⚡ **Performance Profiler** | Find nested loops, `eval()`, inefficient patterns |
| 📊 **Quality Dashboard** | Project metrics, AI response quality trends, bug risk, doc coverage |
| 🔗 **Git Integration** | Analyze commits, generate commit messages, validate before push |
| 🤖 **Multi-Provider** | Ollama (local), Claude, GPT, Gemini - API keys stored securely in SecretStorage |
| 📝 **Snippet Manager** | Save & insert code snippets with tags |

## 📸 Screenshots

| Chat | Dashboard | Context Groups |
|------|-----------|----------------|
| ![Chat](images/chat.png) | ![Dashboard](images/dashboard.png) | ![Context](images/context.png) |

## 🚀 Quick Start

### Prerequisites

1. **Install Ollama**: https://ollama.com
2. **Start Ollama**: `ollama serve`
3. **Pull a code model**:
   ```bash
   ollama pull qwen2.5-coder:7b
   ```
   Other good options: `qwen2.5-coder:14b`, `deepseek-coder-v2:16b`, `llama3.1:8b`

### Installation

**From Marketplace** (recommended):
1. Open Extensions (`Ctrl+Shift+X`)
2. Search "Local AI Assistant"
3. Click Install

**From VSIX**:
```bash
# Download .vsix from Releases, then:
code --install-extension local-ai-vscode-0.4.0.vsix
```

## ⌨️ Keybindings

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+A` | Open Chat |
| `Ctrl+Shift+Space` | Trigger Autocomplete |

## ⚙️ Configuration

Settings (`Ctrl+,` → search "Local AI"):

| Setting | Default | Description |
|---------|---------|-------------|
| `local-ai.ollamaUrl` | `http://localhost:11434` | Ollama API URL |
| `local-ai.model` | `qwen2.5-coder:7b` | Model name |
| `local-ai.numCtx` | `8192` | **Critical**: Context window (Ollama default 2048-4096 cuts long code) |
| `local-ai.enableInlineCompletion` | `true` | Enable autocomplete |
| `local-ai.inlineCompletionDelay` | `800` | ms delay before suggestion |
| `local-ai.temperature` | `0.2` | 0.1-0.3 recommended for code |
| `local-ai.maxTokens` | `1024` | Max response tokens |
| `local-ai.enableAutoReview` | `true` | Analyze code on save |
| `local-ai.enableSemanticSearch` | `true` | Enable semantic search |
| `local-ai.embeddingModel` | `nomic-embed-text` | Embedding model for search |
| `local-ai.similarityThreshold` | `0.3` | Search relevance threshold |

## 🔍 Semantic Search Setup

```bash
# Pull embedding model
ollama pull nomic-embed-text
```

Then:
1. `Ctrl+Shift+P` → **Local AI: Index Project for Search**
2. `Ctrl+Shift+P` → **Local AI: Busca Semântica**
3. Search in natural language: "Como validar formulário React?"

## 🗂️ Context Groups

Organize context by feature/module:
1. `Ctrl+Shift+P` → **Local AI: Organizar Grupos de Context**
2. Create groups with patterns: `src/api/**`, `src/components/**`, `**/*.test.ts`
3. Select active group - only those files sent to AI

## 🔐 Multi-Provider (Cloud APIs)

1. `Ctrl+Shift+P` → **Local AI: Configurar Provedor IA**
2. Choose: Ollama / Claude / ChatGPT / Gemini
3. Enter API key (stored in **VS Code SecretStorage**, not settings.json)
4. Select model

## 📦 Development

```bash
# Install deps
npm install

# Compile
npm run compile

# Watch mode
npm run watch

# Run tests
npm run test:unit

# Package VSIX
npm run package
```

Press `F5` to launch Extension Development Host.

## 🏗️ Architecture

```
src/
├── extension.ts                    # Entry point
├── chat/ChatPanel.ts               # Webview chat (streaming, history)
├── completion/InlineCompletionProvider.ts  # FIM + fallback autocomplete
├── commands/index.ts               # 20+ command registrations
└── utils/
    ├── ollama.ts                   # HTTP client (chat, FIM, embeddings)
    ├── projectContext.ts           # Smart context injection
    ├── advancedContextManager.ts   # Context groups with patterns
    ├── semanticSearch.ts           # Vector search with embeddings
    ├── gitIntegration.ts           # Git diff analysis (VS Code Git API)
    ├── autoReview.ts               # Diagnostics on save
    ├── qualityScore.ts             # Response quality tracking
    ├── bugDetective.ts             # Static + AI bug detection
    ├── performanceProfiler.ts      # Performance pattern detection
    ├── dashboardProvider.ts        # Unified quality dashboard
    ├── multiAI.ts                  # Multi-provider with SecretStorage
    ├── modelManager.ts             # Models per use-case
    └── snippetManager.ts           # Persistent snippets
```

## 🤝 Contributing

1. Fork the repo
2. Create feature branch
3. Run tests: `npm run test:unit`
4. Submit PR

## 📄 License

MIT - see [LICENSE](LICENSE)

---

**Privacy First**: Your code stays on your machine. No telemetry, no cloud required (with Ollama).