@echo off
chcp 65001 >nul 2>&1
title StoryGraph 启动器
cd /d "%~dp0"
set "PORT=8123"

echo(
echo   ============================================
echo     StoryGraph - 多分支可视化编辑器
echo     正在为你启动本地服务器...
echo   ============================================
echo(

REM 直接尝试运行解释器来检测（比 where 更可靠：where 依赖 System32 在 PATH 上，
REM 某些精简/受限环境下 where 不可用，会误报“未检测到”）
set "RTYPE="
python -V >nul 2>&1 && set "RTYPE=python"
if not defined RTYPE py -V >nul 2>&1 && set "RTYPE=py"
if not defined RTYPE python3 -V >nul 2>&1 && set "RTYPE=python3"
if not defined RTYPE node -v >nul 2>&1 && set "RTYPE=node"

if not defined RTYPE goto notfound

REM 在独立窗口启动服务器（用 start 直接拉起解释器，不依赖 cmd / where）
if "%RTYPE%"=="node" (
  start "StoryGraph 本地服务器（关闭此窗口即停止）" node serve.mjs %PORT%
) else (
  start "StoryGraph 本地服务器（关闭此窗口即停止）" %RTYPE% -m http.server %PORT%
)

REM 等服务器就绪（timeout 不可用时忽略），再打开浏览器
timeout /t 2 /nobreak >nul 2>&1
start "" "http://localhost:%PORT%/index.html"

echo(
echo   √ 已启动并在浏览器打开： http://localhost:%PORT%/index.html
echo   若浏览器显示空白，请稍等 1-2 秒后刷新，或手动访问上面的网址。
echo(
echo   ^> 停止运行：关闭名为「StoryGraph 本地服务器」的那个窗口即可。
echo(
pause
exit /b 0

:notfound
echo   [!] 未检测到 Python 或 Node.js。
echo       请安装 Python ^(https://www.python.org/downloads/^)，安装时勾选
echo       "Add python.exe to PATH"，然后重新双击本文件。
echo(
pause
exit /b 1
