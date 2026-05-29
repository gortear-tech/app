@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-cadencia-android.ps1"
if errorlevel 1 (
  echo.
  echo No se pudo completar la instalacion.
  echo Revisa que el telefono este conectado, desbloqueado y con Depuracion USB autorizada.
)
echo.
pause
