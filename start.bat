@echo off
cd /d "%~dp0"
echo Starting database...
docker compose up -d
echo Installing dependencies (first run takes a few minutes)...
call pnpm install
echo Starting webhook forwarder (new window)...
start "webhook forwarder" cmd /k npx -y smee-client -u https://smee.io/64ikbeaD3pdyRT -t http://127.0.0.1:4000/webhooks/github
echo Starting the app (new window, output goes to dev.log)...
start "ai code reviewer app" cmd /k "pnpm dev > dev.log 2>&1"
echo Waiting 60 seconds for the app to start...
timeout /t 60 /nobreak > nul
call pnpm cr repos
echo.
echo Ready. Dashboard: http://localhost:3000
start "" http://localhost:3000
echo Type commands here, for example: pnpm cr repos
cmd /k
