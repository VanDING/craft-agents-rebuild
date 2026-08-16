@echo off
set "ARGS="
:argloop
if "%~1"=="" goto :run
set "ARGS=%ARGS% "%~1""
shift
goto :argloop
:run
"%CRAFT_UV%" run --python 3.12 "%CRAFT_SCRIPTS%\pdf_tool.py"%ARGS%
