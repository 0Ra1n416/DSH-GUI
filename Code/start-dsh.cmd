@echo off
setlocal
chcp 65001 >nul
title DeepSeek Harness (dsh web)

rem --- Check Node.js ---
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] No Node.js !
    pause
    exit /b 1
)

rem --- Start DeepSeek Harness Web---
npx -y @deepseek-ai/dsh web %*

pause >nul
endlocal
