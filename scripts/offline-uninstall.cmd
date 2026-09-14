@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0uninstall.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if /I not "%~1"=="-Quiet" pause
exit /b %EXIT_CODE%
