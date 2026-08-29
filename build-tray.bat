@echo off
rem Build ComicTray.exe from trayhost.cs using the built-in .NET Framework C# compiler (no extra dependencies).
cd /d "%~dp0"

set "CSC="
if exist "%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not defined CSC if exist "%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"

if not defined CSC (
  echo [ERROR] csc.exe not found. .NET Framework 4.x is required.
  pause
  exit /b 1
)

echo Compiling ComicTray.exe ...
"%CSC%" /nologo /target:winexe /out:ComicTray.exe -r:System.Windows.Forms.dll -r:System.Drawing.dll trayhost.cs
if errorlevel 1 (
  echo [ERROR] Compilation failed.
  pause
  exit /b 1
)
echo Done: ComicTray.exe
pause
