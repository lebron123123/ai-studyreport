@echo off
setlocal
cd /d "%~dp0"
title Company LLM API Connectivity Check
chcp 65001 >nul

echo ========================================================
echo   Company LLM API Connectivity Check
echo ========================================================
echo.

where node.exe >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js was not found. Please confirm Node.js is installed.
  echo.
  if not defined CHECK_NO_PAUSE pause
  exit /b 1
)

if not exist "local-server\.env" (
  echo ERROR: local-server\.env was not found.
  echo.
  if not defined CHECK_NO_PAUSE pause
  exit /b 1
)

if not exist "local-server\.env.company" (
  echo ERROR: local-server\.env.company was not found.
  echo.
  if not defined CHECK_NO_PAUSE pause
  exit /b 1
)

if defined CHECK_DRY_RUN exit /b 0

echo Running checks. This normally takes 10-60 seconds...
echo.
set "OPEN_ARG=--open"
if defined CHECK_NO_OPEN set "OPEN_ARG="
node.exe --env-file="local-server\.env" --env-file="local-server\.env.company" "scripts\check-company-llm.mjs" %OPEN_ARG%
set "CHECK_EXIT=%ERRORLEVEL%"

echo.
if "%CHECK_EXIT%"=="0" (
  echo Check finished. The result file has been created in this folder.
) else (
  echo Check program failed with exit code %CHECK_EXIT%.
  echo Please take a screenshot of this window.
)
echo.
if not defined CHECK_NO_PAUSE pause
exit /b %CHECK_EXIT%
