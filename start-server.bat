@echo off
title Oasis Pulse — Server
setlocal

:: ── Resolve project root (folder where this .bat lives) ─────────
set "ROOT=%~dp0"
set "SERVER=%ROOT%server"

echo.
echo  ============================================================
echo    Oasis Pulse  ^|  Attendance System
echo  ============================================================
echo.

:: ── 1. Check Node.js ────────────────────────────────────────────
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo  [ERROR] Node.js is not installed or not in PATH.
  echo  Download it from: https://nodejs.org
  echo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v 2^>nul') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER% found.

:: ── 2. Check .env exists ─────────────────────────────────────────
if not exist "%SERVER%\.env" (
  echo.
  echo  [ERROR] server\.env file is missing.
  echo  Copy server\.env.example to server\.env and fill in your values.
  echo.
  pause
  exit /b 1
)
echo  [OK] .env file found.

:: ── 3. Check node_modules ────────────────────────────────────────
if not exist "%SERVER%\node_modules" (
  echo.
  echo  [INFO] node_modules not found. Installing dependencies...
  cd /d "%SERVER%"
  call npm install
  if %ERRORLEVEL% neq 0 (
    echo  [ERROR] npm install failed. Check your internet connection.
    pause
    exit /b 1
  )
  echo  [OK] Dependencies installed.
) else (
  echo  [OK] Dependencies found.
)

:: ── 4. Kill anything already on port 3001 ────────────────────────
echo  [INFO] Checking for processes on port 3001...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3001 " ^| findstr "LISTENING"') do (
  echo  [INFO] Killing existing process on port 3001 ^(PID %%a^)...
  taskkill /PID %%a /F >nul 2>&1
)

:: ── 5. Start server ──────────────────────────────────────────────
cd /d "%SERVER%"
echo.
echo  [INFO] Starting server...
echo.

:: Small pause to let port fully release
timeout /t 1 /nobreak >nul

:: Open browser after 2 seconds
start "" /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3001"

:: Run node directly in this window (single process, output visible)
node index.js

:: ── If node exits, offer restart ─────────────────────────────────
echo.
echo  ============================================================
echo    Server stopped.
echo  ============================================================
echo.
echo  Press any key to restart, or close this window to quit.
pause >nul
start "" "%~f0"
