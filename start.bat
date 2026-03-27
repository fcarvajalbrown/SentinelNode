@echo off
echo Starting SentinelNode...
docker compose up -d
timeout /t 3 /nobreak >nul
start http://localhost:3000
echo SentinelNode is running at http://localhost:3000
echo To stop it, run: docker compose down
