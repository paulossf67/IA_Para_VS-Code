#!/usr/bin/env bash
# Instalador do Local AI Assistant para macOS e Linux.
# Equivalente ao instalar-extensao.bat usado no Windows.
set -uo pipefail

cd "$(dirname "$0")"

# Cores só quando a saída é um terminal — em pipe/CI viram ruído
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'
  GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; RED=''; GREEN=''; YELLOW=''; RESET=''
fi

echo
echo "  ==================================================="
echo "  ${BOLD}    LOCAL AI ASSISTANT - INSTALADOR${RESET}"
echo "  ==================================================="
echo
echo "   Extensao de IA 100% local para VS Code."
echo "   Seu codigo nunca sai da maquina."
echo
echo "  ---------------------------------------------------"
echo

# ---------- 1. Localizar o pacote .vsix ----------
echo "  [1/4] Procurando o pacote da extensao..."

VSIX=$(ls -t local-ai-vscode-*.vsix 2>/dev/null | head -n 1 || true)

if [ -z "$VSIX" ]; then
  echo
  echo "   ${RED}[ERRO]${RESET} Nenhum arquivo .vsix encontrado nesta pasta."
  echo
  echo "   Gere o pacote antes de instalar:"
  echo "       npm install"
  echo "       npm run compile"
  echo "       npm run package"
  echo
  exit 1
fi

echo "        Encontrado: $VSIX"
echo

# ---------- 2. Localizar o VS Code ----------
echo "  [2/4] Verificando o VS Code..."

CODE=""
if command -v code >/dev/null 2>&1; then
  CODE="code"
else
  # Caminhos padrão de quem nunca rodou "Install 'code' command in PATH"
  for candidate in \
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
    "$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
    "/usr/share/code/bin/code" \
    "/usr/bin/code" \
    "/snap/bin/code" \
    "/var/lib/flatpak/exports/bin/com.visualstudio.code"
  do
    if [ -x "$candidate" ]; then CODE="$candidate"; break; fi
  done
fi

if [ -z "$CODE" ]; then
  echo
  echo "   ${RED}[ERRO]${RESET} Nao encontrei a instalacao do VS Code."
  echo
  echo "   Se ele ja esta instalado, adicione ao PATH:"
  echo "     1. Abra o VS Code"
  echo "     2. Cmd+Shift+P (macOS) ou Ctrl+Shift+P (Linux)"
  echo "     3. Digite: Shell Command: Install 'code' command in PATH"
  echo "     4. Rode este instalador de novo"
  echo
  echo "   Se ainda nao instalou: https://code.visualstudio.com"
  echo
  exit 1
fi

echo "        VS Code encontrado."
echo

# ---------- 3. Instalar a extensao ----------
echo "  [3/4] Instalando a extensao..."
echo

if ! "$CODE" --install-extension "$VSIX" --force; then
  echo
  echo "   ${RED}[ERRO]${RESET} A instalacao falhou. Mensagem do VS Code acima."
  echo
  exit 1
fi

echo
echo "        ${GREEN}Extensao instalada.${RESET}"
echo

# ---------- 4. Verificar o Ollama ----------
echo "  [4/4] Verificando o Ollama..."

OLLAMA_URL="http://localhost:11434/api/tags"
TAGS=""

if command -v curl >/dev/null 2>&1; then
  TAGS=$(curl -fsS --max-time 5 "$OLLAMA_URL" 2>/dev/null || true)
elif command -v wget >/dev/null 2>&1; then
  TAGS=$(wget -qO- --timeout=5 "$OLLAMA_URL" 2>/dev/null || true)
else
  echo "        ${DIM}(sem curl nem wget — pulando a verificacao)${RESET}"
fi

if [ -z "$TAGS" ]; then
  echo
  echo "   ${YELLOW}[AVISO]${RESET} O Ollama nao respondeu em localhost:11434."
  echo
  echo "   A extensao precisa dele para funcionar. Para resolver:"
  echo "     1. Instale: https://ollama.com"
  echo "     2. Rode:    ollama serve"
  echo "     3. Baixe:   ollama pull qwen2.5-coder:7b"
  echo
else
  echo "        Ollama esta rodando."
  echo

  # Extrai os nomes sem depender de jq
  MODELOS=$(printf '%s' "$TAGS" | grep -o '"name":"[^"]*"' | cut -d'"' -f4 || true)

  if [ -z "$MODELOS" ]; then
    echo "   ${YELLOW}[AVISO]${RESET} Nenhum modelo instalado no Ollama."
    echo
    printf "   Baixar o qwen2.5-coder:7b agora? (cerca de 4.7 GB) [s/N]: "
    read -r RESP
    if [ "${RESP:-}" = "s" ] || [ "${RESP:-}" = "S" ]; then
      echo
      echo "   Baixando... isso pode demorar bastante."
      echo
      ollama pull qwen2.5-coder:7b
      echo
    else
      echo
      echo "   Tudo bem. Quando quiser, rode: ollama pull qwen2.5-coder:7b"
      echo
    fi
  else
    echo "        Modelos disponiveis:"
    printf '%s\n' "$MODELOS" | while IFS= read -r m; do echo "          - $m"; done
    echo
  fi
fi

# ---------- Resumo ----------
echo "  ---------------------------------------------------"
echo
echo "   ${GREEN}${BOLD}INSTALACAO CONCLUIDA${RESET}"
echo
echo "   Proximos passos:"
echo "     1. Abra o VS Code (ou recarregue: Cmd/Ctrl+Shift+P, Reload Window)"
echo "     2. Pressione Cmd/Ctrl+Shift+A para abrir o chat"
echo "     3. Selecione um codigo, clique com o botao direito,"
echo "        menu \"Local AI\""
echo
echo "   Configuracoes: Settings, procure por \"Local AI\""
echo "   Todos os comandos: Cmd/Ctrl+Shift+P, digite \"Local AI\""
echo
echo "  ---------------------------------------------------"
echo
