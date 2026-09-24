# Changelog

## 0.2.0

- Autocomplete com debounce de verdade (espera você parar de digitar) e cancelamento das requisições no Ollama.
- Autocomplete usa FIM (`/api/generate` com `suffix`) nos modelos que suportam, com o chat como plano B.
- Chat: corrigida a perda de trechos da resposta quando uma linha JSON chegava dividida.
- Chat: renderização de markdown com blocos de código e botões **Copiar** / **Inserir**.
- Chat: fila de mensagens (comandos disparados durante uma resposta esperam a vez) e a conversa não some ao esconder o painel.
- Novas configurações `local-ai.numCtx` (contexto) e `local-ai.maxHistoryMessages` (limite do histórico).
- Novo comando **Local AI: Escolher Modelo** (também pelo botão do modelo no topo do chat).
- Aviso correto quando o modelo configurado não está instalado.
- Temperatura 0 agora é respeitada.

## 0.1.0

- Versão inicial.
