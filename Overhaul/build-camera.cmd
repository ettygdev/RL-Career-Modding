@echo off
setlocal
if "%~1"=="" exit /b 2
if not exist ".build" mkdir ".build"
if not exist "bin" mkdir "bin"
if not exist ".build\imgui\imgui.h" tar -xf "%~1\imgui_bm.zip" -C ".build"
if not exist ".build\imgui\imgui.h" exit /b 3
cl /nologo /std:c++20 /EHsc /O2 /MT /DNOMINMAX /LD /I"%~1\include" /I".build\imgui" /Fo.build\ "src\cameras.cpp" ".build\imgui\imgui.cpp" ".build\imgui\imgui_draw.cpp" ".build\imgui\imgui_widgets.cpp" /link /OUT:"bin\rlcareercameras.dll" /IMPLIB:".build\rlcareercameras.lib" "%~1\lib\pluginsdk.lib" xaudio2.lib ole32.lib user32.lib shell32.lib
exit /b %errorlevel%
