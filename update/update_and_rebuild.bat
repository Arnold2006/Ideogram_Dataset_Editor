@echo off
call "%~dp0update.bat" nopause
echo -
echo Rebuilding portable (npm run dist)...
echo -
where npm >nul 2>&1
if errorlevel 1 goto :nonpm
call npm run dist
goto :done
:nonpm
echo npm not on PATH - install Node.js 18+ or use the pre-built out\win-unpacked
:done
pause
