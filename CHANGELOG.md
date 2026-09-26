# Changelog

All notable changes to this project will be documented in this format.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2025-09-25

### Added
- **Semantic Search** with embeddings via Ollama (`nomic-embed-text`)
  - Index project files and chat history
  - Natural language search across codebase
  - Commands: `Index Project for Search`, `Busca Semântica`
- **Quality Dashboard** (unified webview)
  - Project metrics (files, LOC, languages, complexity, doc coverage)
  - AI quality trends (weekly score, category breakdown)
  - Bug risk scoring with severity breakdown
  - Performance issue detection
  - One-click scan buttons for current file
- **Git Integration via VS Code Git API**
  - Replaced `child_process` with native `vscode.git` extension API
  - Works without git in PATH
- **Multi-Provider with Secure Storage**
  - API keys stored in VS Code SecretStorage (not settings.json)
  - Supports Ollama, Claude, GPT, Gemini
- **Context Groups (AdvancedContextManager)**
  - Organize files by glob patterns with priority
  - Create groups via QuickPick (manual selection or patterns)
  - Auto-detect common patterns (Backend, Frontend, Tests, Config)
  - Migration command from legacy `contextSelector`
- **Bug Detective Enhancements**
  - Static patterns: hardcoded secrets, missing error handling, SQL injection, infinite loops
  - AI-powered analysis for complex patterns
  - Webview report with severity badges
- **Performance Profiler**
  - Detects nested loops, `eval()`, for-in on objects
  - AI-powered performance analysis
- **Auto-Review Uses Token Budget**
  - Respects `numCtx` setting instead of fixed 1000 chars
- **Unit Tests**
  - Chat panel: history, export, trim, config
  - Inline completion: FIM, fallback, caching, debounce
  - Ollama utils: trimHistory, isModelInstalled, stripCodeFences
  - Retry with backoff

### Changed
- **Removed 11 placeholder commands** (semanticSearch, voiceCommand, generateProjectDocs, profilePerformance, reviewPR, learningPaths, codeGenetics, teamCollaboration, marketplace, qualityDashboard, detectBugs)
- **Unified context selection** into AdvancedContextManager
- **Improved README** with badges, screenshots placeholders, detailed docs

### Fixed
- Git commands work on Windows without git in PATH
- API keys no longer stored in plain text
- Context injection respects token budget correctly

## [0.3.0] - 2025-09-15

### Added
- Inline Completion with FIM support
- Context-aware chat (project files auto-included)
- Git integration (analyze, commit message, validate)
- Snippet Manager
- Model Manager (per use-case)
- Multi-provider support (Ollama, Claude, GPT, Gemini)
- Dashboard webview

## [0.2.0] - 2025-09-01

### Added
- Chat sidebar with streaming
- Code commands (explain, refactor, tests, fix, docs)
- Basic Ollama integration
- Configuration settings

## [0.1.0] - 2025-08-15

### Added
- Initial release
- Basic chat functionality
- Ollama connection

---

## Upcoming (0.5.0)

- [ ] CI/CD GitHub Actions (build, test, auto-publish on tag)
- [ ] Code Genetics (git history + LLM semantic evolution)
- [ ] Improved semantic search UI (filters, facets)
- [ ] Team collaboration features (shared context, annotations)
- [ ] More language support for bug/perf patterns