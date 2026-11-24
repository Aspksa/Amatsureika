@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
where npm.cmd >nul 2>&1 || (echo Node.js is required. & exit /b 1)
if not exist "node_modules\typescript\bin\tsc" (
  call npm.cmd install --no-audit --no-fund || exit /b 1
)
call npm.cmd run build || exit /b 1
where py.exe >nul 2>&1
if errorlevel 1 (
  python server.py
) else (
  py -3 server.py
)
