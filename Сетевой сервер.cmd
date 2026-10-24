@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Для сервера нужен Node.js 24 или новее. Установите его с nodejs.org.
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0]) < 24) process.exit(1)"
if errorlevel 1 (
  echo Обновите Node.js до версии 24 или новее: https://nodejs.org
  pause
  exit /b 1
)
set "SKYFRONT_NEEDS_INSTALL="
if not exist "node_modules\ws\package.json" set "SKYFRONT_NEEDS_INSTALL=1"
if not exist "node_modules\https-proxy-agent\package.json" set "SKYFRONT_NEEDS_INSTALL=1"
if defined SKYFRONT_NEEDS_INSTALL (
  call npm ci --ignore-scripts
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node server/index.mjs %*
pause
