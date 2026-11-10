@echo off
REM Ambiente de PRUEBA de Zoe Closet: base de datos aparte, puerto 3001.
REM No toca la base ni los respaldos reales de la tienda. Cierra esta ventana para apagarlo.
title Zoe Closet - AMBIENTE DE PRUEBA
cd /d "%~dp0.."
if not exist node_modules (
  echo Instalando dependencias...
  call npm install --no-audit --no-fund || goto :error
)
call npm run --silent prueba:demo || goto :error
start "" http://localhost:3001
call npm run --silent prueba
goto :eof

:error
echo.
echo Algo fallo. Copia el mensaje de arriba y pidele ayuda a Claude.
pause
