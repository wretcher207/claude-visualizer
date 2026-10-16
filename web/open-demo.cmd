@echo off
rem Opens the Prompt Is Prologue demo in your browser (Windows).
rem Leave this window open while you use it; close it to stop.
cd /d "%~dp0"
start "" cmd /c "timeout /t 1 >nul & start http://127.0.0.1:5178/web/"
node serve.cjs
