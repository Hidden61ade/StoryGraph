@echo off
chcp 65001 >nul 2>&1
title StoryGraph Launcher
cd /d "%~dp0"
set "STORYGRAPH_PORT=8123"

echo(
echo   StoryGraph - Visual Narrative Editor
echo   Starting a local server...
echo(

set "STORYGRAPH_RUNTIME="
node -v >nul 2>&1 && set "STORYGRAPH_RUNTIME=node"
if not defined STORYGRAPH_RUNTIME python -V >nul 2>&1 && set "STORYGRAPH_RUNTIME=python"
if not defined STORYGRAPH_RUNTIME py -V >nul 2>&1 && set "STORYGRAPH_RUNTIME=py"
if not defined STORYGRAPH_RUNTIME python3 -V >nul 2>&1 && set "STORYGRAPH_RUNTIME=python3"
if not defined STORYGRAPH_RUNTIME goto notfound

if "%STORYGRAPH_RUNTIME%"=="node" (
  start "StoryGraph Local Server - close this window to stop" node serve.mjs %STORYGRAPH_PORT%
) else (
  start "StoryGraph Local Server - close this window to stop" %STORYGRAPH_RUNTIME% -m http.server %STORYGRAPH_PORT%
)
timeout /t 2 /nobreak >nul 2>&1
start "" "http://localhost:%STORYGRAPH_PORT%/index.html"

echo   Opened http://localhost:%STORYGRAPH_PORT%/index.html
echo   If the browser is blank, wait briefly and refresh.
echo   Close the StoryGraph Local Server window to stop.
pause
exit /b 0

:notfound
echo   Node.js or Python was not found.
echo   Install Node.js from https://nodejs.org/ or Python from https://www.python.org/downloads/
echo   Then run this launcher again.
pause
exit /b 1
