@echo off
rem UYAP Dosya Esitleyici: yerel yardimciyi tarayiciya tanitir (Windows)
rem Cift tiklayarak calistirin. Kaldirmak icin:  install_windows.bat --kaldir
chcp 65001 >nul
where py >nul 2>nul && (py -3 "%~dp0install.py" %* & goto son)
where python >nul 2>nul && (python "%~dp0install.py" %* & goto son)
echo HATA: Python bulunamadi. Once https://www.python.org/downloads/ adresinden Python 3 kurun
echo (kurulumda "Add python.exe to PATH" kutusunu isaretleyin), sonra bu dosyayi yeniden calistirin.
:son
echo.
pause
