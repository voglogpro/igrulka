@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Для сервера нужен Node.js 24 или новее. Установите его с nodejs.org.
  pause
  exit /b 1
)
if not exist "node_modules\ws\package.json" (
  call npm ci --ignore-scripts
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node server/index.mjs %*
pause
