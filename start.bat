@echo off
chcp 65001 >nul
title Universe Server
cd /d "%~dp0"

if exist ".venv\Scripts\python.exe" (
    set PY=.venv\Scripts\python.exe
) else (
    set PY=python
)

%PY% start.py
pause
