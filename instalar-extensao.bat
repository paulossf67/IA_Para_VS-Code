@echo off
setlocal EnableDelayedExpansion
title Local AI Assistant - Instalador
color 0B

echo.
echo  ===================================================
echo       LOCAL AI ASSISTANT - INSTALADOR
echo  ===================================================
echo.
echo   Extensao de IA 100%% local para VS Code.
echo   Seu codigo nunca sai da maquina.
echo.
echo  ---------------------------------------------------
echo.

cd /d "%~dp0"

REM ---------- 1. Localizar o pacote .vsix ----------
echo  [1/4] Procurando o pacote da extensao...

set "VSIX="
for /f "delims=" %%F in ('dir /b /o-d "local-ai-vscode-*.vsix" 2^>nul') do (
    if not defined VSIX set "VSIX=%%F"
)

if not defined VSIX (
    echo.
    echo   [ERRO] Nenhum arquivo .vsix encontrado nesta pasta.
    echo.
    echo   Gere o pacote antes de instalar:
    echo       npm install
    echo       npm run compile
    echo       npm run package
    echo.
    goto :fim
)

echo        Encontrado: !VSIX!
echo.

REM ---------- 2. Verificar o VS Code ----------
echo  [2/4] Verificando o VS Code...

REM Procura o code.cmd pelo PATH e, se nao achar, nos locais padrao de
REM instalacao - quem nunca rodou "Install 'code' command in PATH" nao o tem.
set "CODE="
for /f "delims=" %%P in ('where code.cmd 2^>nul') do (
    if not defined CODE set "CODE=%%P"
)

if not defined CODE (
    for %%P in (
        "%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd"
        "%ProgramFiles%\Microsoft VS Code\bin\code.cmd"
        "%ProgramFiles(x86)%\Microsoft VS Code\bin\code.cmd"
    ) do (
        if not defined CODE if exist "%%~P" set "CODE=%%~P"
    )
)

if not defined CODE (
    echo.
    echo   [ERRO] Nao encontrei a instalacao do VS Code.
    echo.
    echo   Se ele ja esta instalado, adicione ao PATH:
    echo     1. Abra o VS Code
    echo     2. Ctrl+Shift+P
    echo     3. Digite: Shell Command: Install 'code' command in PATH
    echo     4. Feche e reabra este instalador
    echo.
    echo   Se ainda nao instalou: https://code.visualstudio.com
    echo.
    goto :fim
)

echo        VS Code encontrado.
echo.

REM ---------- 3. Instalar a extensao ----------
echo  [3/4] Instalando a extensao...
echo.

call "!CODE!" --install-extension "!VSIX!" --force
if errorlevel 1 (
    echo.
    echo   [ERRO] A instalacao falhou. Mensagem do VS Code acima.
    echo.
    goto :fim
)

echo.
echo        Extensao instalada.
echo.

REM ---------- 4. Verificar o Ollama ----------
echo  [4/4] Verificando o Ollama...

set "OLLAMA_OK="
for /f "delims=" %%R in ('powershell -NoProfile -Command "try { $null = Invoke-RestMethod -Uri 'http://localhost:11434/api/tags' -TimeoutSec 5; 'SIM' } catch { 'NAO' }" 2^>nul') do set "OLLAMA_OK=%%R"

if /i "!OLLAMA_OK!"=="SIM" goto :ollama_rodando

echo.
echo   [AVISO] O Ollama nao respondeu em localhost:11434.
echo.
echo   A extensao precisa dele para funcionar. Para resolver:
echo     1. Instale: https://ollama.com
echo     2. Abra um terminal e rode: ollama serve
echo     3. Baixe um modelo:        ollama pull qwen2.5-coder:7b
echo.
goto :resumo

:ollama_rodando
echo        Ollama esta rodando.
echo.

REM Verificar se ha algum modelo de codigo instalado
set "TEM_MODELO="
for /f "delims=" %%M in ('powershell -NoProfile -Command "try { $m = (Invoke-RestMethod -Uri 'http://localhost:11434/api/tags' -TimeoutSec 5).models; if ($m -and $m.Count -gt 0) { 'SIM' } else { 'NAO' } } catch { 'NAO' }" 2^>nul') do set "TEM_MODELO=%%M"

if /i "!TEM_MODELO!"=="SIM" goto :listar_modelos

echo   [AVISO] Nenhum modelo instalado no Ollama.
echo.
set /p BAIXAR="   Baixar o qwen2.5-coder:7b agora? (cerca de 4.7 GB) [S/N]: "
if /i "!BAIXAR!"=="S" (
    echo.
    echo   Baixando... isso pode demorar bastante.
    echo.
    ollama pull qwen2.5-coder:7b
    echo.
) else (
    echo.
    echo   Tudo bem. Quando quiser, rode: ollama pull qwen2.5-coder:7b
    echo.
)
goto :resumo

:listar_modelos
echo        Modelos disponiveis:
powershell -NoProfile -Command "(Invoke-RestMethod -Uri 'http://localhost:11434/api/tags' -TimeoutSec 5).models | ForEach-Object { '          - ' + $_.name }" 2>nul
echo.

:resumo
echo  ---------------------------------------------------
echo.
echo   INSTALACAO CONCLUIDA
echo.
echo   Proximos passos:
echo     1. Abra o VS Code (ou recarregue: Ctrl+Shift+P, Reload Window)
echo     2. Pressione Ctrl+Shift+A para abrir o chat
echo     3. Selecione um codigo, clique com o botao direito,
echo        menu "Local AI"
echo.
echo   Configuracoes: Settings, procure por "Local AI"
echo   Todos os comandos: Ctrl+Shift+P, digite "Local AI"
echo.
echo  ---------------------------------------------------
echo.

:fim
pause
endlocal
