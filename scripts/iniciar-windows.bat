@echo off
REM Modo desarrollo: inicia Zoe Closet en esta ventana y abre el navegador.
REM En la PC de la tienda usa scripts\instalar-windows.ps1 (se ejecuta como servicio).
cd /d "%~dp0.."
start "" http://localhost:3000
npm start
