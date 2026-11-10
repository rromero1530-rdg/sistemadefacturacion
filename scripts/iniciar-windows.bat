@echo off
REM Doble clic para iniciar Pixel POS y abrir el navegador.
cd /d "%~dp0.."
start "" http://localhost:3000
npm start
