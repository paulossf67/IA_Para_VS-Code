@echo off
title Portable AI - Multi-Model Setup
color 0E

echo ===================================================
echo     PORTABLE UNCENSORED AI - USB SETUP             
echo ===================================================
echo.
echo This will download and configure AI models onto
echo your USB drive. You'll get to CHOOSE which models
echo to install from a curated list.
echo.
echo  - 6 preset models (uncensored + standard)
echo  - Custom model support (bring your own GGUF)
echo  - Minimum USB space: 16 GB (32 GB recommended)
echo.
echo Make sure you have a good internet connection!
echo.
pause

if not exist "%~dp0install-core.ps1" (
	echo.
	echo [ERROR] Missing install-core.ps1. This portable AI installer is incomplete.
	echo Place the setup script beside this file before running it again.
	pause
	exit /b 1
)

:: Run the PowerShell setup script from the same folder as this bat file
powershell -ExecutionPolicy Bypass -File "%~dp0install-core.ps1"
if errorlevel 1 (
	echo.
	echo [ERROR] Portable AI setup failed. See the PowerShell error above.
	pause
	exit /b 1
)

echo.
echo ===================================================
echo     SETUP COMPLETE! You're ready to go!            
echo ===================================================
echo.
echo To start your AI, double-click start-windows.bat
echo.
pause
