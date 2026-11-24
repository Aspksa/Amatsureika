@echo off
setlocal DisableDelayedExpansion
title Amatsureika - Local launcher
pushd "%~dp0" || goto :folder_error
if not exist "logs" mkdir "logs"
if not exist "logs" goto :folder_error
> "logs\startup.log" echo Amatsureika launcher started
set "PYTHONUTF8=1"
set "PYTHONUNBUFFERED=1"
if exist "runtime\python\python.exe" (
  "runtime\python\python.exe" -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)" >>"logs\startup.log" 2>&1
  if not errorlevel 1 goto :use_portable
)
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)" >>"logs\startup.log" 2>&1
if not errorlevel 1 goto :use_py
python -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)" >>"logs\startup.log" 2>&1
if not errorlevel 1 goto :use_python
echo ERROR: Python 3.10 or newer is required. Install Python and enable PATH.
>>"logs\startup.log" echo ERROR: Python 3.10 or newer is required.
goto :failed
:use_portable
"runtime\python\python.exe" launcher.py %*
set "RC=%errorlevel%"
goto :finish
:use_py
py -3 launcher.py %*
set "RC=%errorlevel%"
goto :finish
:use_python
python launcher.py %*
set "RC=%errorlevel%"
:finish
if not "%RC%"=="0" goto :failed
popd
exit /b 0
:failed
echo.
echo Startup failed. See logs\startup.log for the reason.
if /i "%~1"=="--check" goto :exit_failed
pause
:exit_failed
popd
exit /b 1
:folder_error
echo ERROR: Cannot access the project folder or create logs.
if /i not "%~1"=="--check" pause
exit /b 1
