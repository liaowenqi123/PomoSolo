@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo   番茄钟打包发布脚本
echo ========================================
echo.

:: 切换到脚本所在目录
cd /d "%~dp0"

:: 读取 package.json 中的版本号
for /f "tokens=2 delims=:," %%a in ('findstr /r "\"version\"" package.json') do (
    set "version=%%a"
    set "version=!version:"=!"
    set "version=!version: =!"
    goto :got_version
)
:got_version
echo 当前版本号: %version%
echo.

:: 确认是否继续
set /p confirm="确认打包并发布 v%version%? (y/n): "
if /i not "%confirm%"=="y" (
    echo 已取消
    pause
    exit /b 0
)

echo.
echo [1/4] 提交代码更改...
git add -A
git status --short
git commit -m "chore: 发布 v%version%" 2>nul
if %errorlevel% neq 0 (
    echo 没有需要提交的更改或提交失败
)

echo.
echo [2/4] 打包应用...
call npm run build:installer
if %errorlevel% neq 0 (
    echo 打包失败!
    pause
    exit /b 1
)

echo.
echo [3/4] 推送代码并创建标签...
git push
git tag v%version%
git push origin v%version%

echo.
echo [4/4] 创建 GitHub Release...
set "installer_path=dist\番茄钟 Setup %version%.exe"
set "release_notes=番茄钟 v%version% 发布版本"

gh release create v%version% "!installer_path!" --title "v%version%" --notes "!release_notes!"

echo.
echo ========================================
echo   发布完成!
echo   Release: https://github.com/BSAI301/course-project-ex2-team-8/releases/tag/v%version%
echo ========================================
pause