@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo   Pomodoro Release Script
echo ========================================
echo.

cd /d "%~dp0"

for /f "tokens=2 delims=:," %%a in ('findstr /r "\"version\"" package.json') do (
    set "version=%%a"
    set "version=!version:"=!"
    set "version=!version: =!"
    goto :got_version
)
:got_version
echo Version: %version%
echo.

set /p confirm="Release v%version%? (y/n): "
if /i not "%confirm%"=="y" (
    echo Cancelled
    pause
    exit /b 0
)

echo.
echo [1/4] Committing changes...
git add -A
git status --short
git commit -m "chore: release v%version%" 2>nul
if %errorlevel% neq 0 (
    echo No changes to commit
)

echo.
echo [2/4] Building installer...
call npm run build:installer
if %errorlevel% neq 0 (
    echo Build failed!
    pause
    exit /b 1
)

echo.
echo [3/4] Pushing and creating tag...
git push

git tag -l v%version% | findstr /x "v%version%" >nul
if %errorlevel% equ 0 (
    echo Tag v%version% already exists, skipping
) else (
    git tag v%version%
    git push origin v%version%
)

echo.
echo [4/4] Creating GitHub Release...
set "installer_path=dist\番茄钟 Setup %version%.exe"
set "release_notes=Pomodoro v%version% release"

gh release view v%version% >nul 2>&1
if %errorlevel% equ 0 (
    echo Release v%version% exists, uploading asset...
    gh release upload v%version% "!installer_path!" --clobber
) else (
    gh release create v%version% "!installer_path!" --title "v%version%" --notes "!release_notes!"
)

echo.
echo ========================================
echo   Release complete!
echo   https://github.com/BSAI301/course-project-ex2-team-8/releases/tag/v%version%
echo ========================================
pause