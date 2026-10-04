@echo off
cd /d "%~dp0"
call pnpm install > install.log 2>&1
echo EXIT CODE %errorlevel% >> install.log
