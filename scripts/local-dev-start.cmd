@echo off
setlocal

cd /d "%~dp0.."

echo ==========================================
echo MAONO MAPS - AMBIENTE LOCAL
echo ==========================================
echo Banco: maono_maps_local
echo Dados: .wrangler\local-dev
echo URL:   http://127.0.0.1:8788
echo.
echo Pressione CTRL+C para encerrar.
echo.

npx --yes wrangler@4.113.0 pages dev dist ^
  --d1 DB=00000000-0000-0000-0000-000000000001 ^
  --persist-to .wrangler\local-dev ^
  --env-file .dev.vars ^
  --ip 127.0.0.1 ^
  --port 8788

set EXIT_CODE=%ERRORLEVEL%

echo.
echo WRANGLER_PAGES_EXIT_CODE=%EXIT_CODE%

endlocal & exit /b %EXIT_CODE%