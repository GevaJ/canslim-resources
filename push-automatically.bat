@echo off
setlocal EnableExtensions DisableDelayedExpansion

pushd "%~dp0" >nul
if errorlevel 1 exit /b 1

rem Task Scheduler may have a minimal PATH and no interactive desktop.
set "PATH=%ProgramFiles%\nodejs;%ProgramFiles%\Git\cmd;%PATH%"
set "GIT_TERMINAL_PROMPT=0"
set "GCM_INTERACTIVE=Never"
if not exist "logs\" mkdir "logs"
if not exist "logs\" (
  echo ERROR: Cannot create the logs directory.
  popd >nul
  exit /b 1
)
echo Running scraper. Output is appended to "%~dp0logs\push-automatically.log".
call :run %* >> "logs\push-automatically.log" 2>&1
set "runStatus=%errorlevel%"
popd >nul
exit /b %runStatus%

:run
echo.
echo ===== Started %date% %time% =====
set "step=checking prerequisites"
where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed or is not on PATH.
  goto :error
)
node -e "if (Number(process.versions.node.split('.')[0]) < 18) process.exit(1)"
if errorlevel 1 (
  echo ERROR: Node.js 18 or newer is required.
  goto :error
)
where git >nul 2>&1
if errorlevel 1 (
  echo ERROR: Git is not installed or is not on PATH.
  goto :error
)
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 goto :error
if not defined DISCORD_TOKEN if not exist ".env" (
  echo ERROR: Set DISCORD_TOKEN in the environment or in .env.
  goto :error
)

set "step=scraping Discord"
echo [1/4] Scraping Discord. Link enrichment can take several minutes...
node scraper.js
if errorlevel 1 goto :error

set "step=updating inline results"
echo [2/4] Updating inline results...
node update-links.js
if errorlevel 1 goto :error

set "step=staging changes"
echo [3/4] Staging project and scraper results...
git add -- index.html main.js scraper.js update-links.js topics.json results.txt results-inline.js push-automatically.bat .gitignore
if errorlevel 1 goto :error
if exist "media\" (
  git add -- media
  if errorlevel 1 goto :error
)

set "step=checking staged changes"
git diff --cached --quiet
set "diffStatus=%errorlevel%"
if "%diffStatus%"=="0" goto :push
if not "%diffStatus%"=="1" goto :error

set "step=committing changes"
set "msg=Update inline results"
if not "%~1"=="" set "msg=%~1"
git commit -m "%msg%"
if errorlevel 1 goto :error

:push
set "step=pushing commits"
echo [4/4] Pushing commits...
git push
if errorlevel 1 goto :error

echo SUCCESS: Scraping, inline results, and Git push completed.
echo ===== Finished %date% %time% =====
exit /b 0

:error
echo ERROR: Failed while %step%. See the error above. Nothing further was run.
echo ===== Failed %date% %time% =====
exit /b 1
