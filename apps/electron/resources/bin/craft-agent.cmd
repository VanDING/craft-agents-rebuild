@echo off
set "CRAFT_BUN_BIN=%CRAFT_BUN%"
if "%CRAFT_BUN_BIN%"=="" set "CRAFT_BUN_BIN=bun"
set "CRAFT_COMMANDS_BIN=%CRAFT_COMMANDS_ENTRY%"
if "%CRAFT_COMMANDS_BIN%"=="" set "CRAFT_COMMANDS_BIN=%CRAFT_CLI_ENTRY%"
if "%CRAFT_CLI_JSON_ONLY%"=="" set "CRAFT_CLI_JSON_ONLY=1"
set "ARGS="
:argloop
if "%~1"=="" goto :run
set "ARGS=%ARGS% "%~1""
shift
goto :argloop
:run
"%CRAFT_BUN_BIN%" run "%CRAFT_COMMANDS_BIN%"%ARGS%
