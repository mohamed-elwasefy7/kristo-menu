@echo off
rem كريستو — local server launcher
cd /d "%~dp0"
start "" http://localhost:4177
where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server 4177
) else (
  npx serve -l 4177 .
)
