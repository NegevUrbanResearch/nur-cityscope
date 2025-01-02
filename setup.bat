@echo off

REM Verificar existencia del archivo setup-config.csv
set CONFIG_FILE=setup-config.csv
if not exist %CONFIG_FILE% (
    echo El archivo %CONFIG_FILE% no existe.
    exit /b 1
)

REM Leer el archivo CSV línea por línea
for /f "skip=1 tokens=1,2,3 delims=," %%a in (%CONFIG_FILE%) do (
    set "NAME=%%a"
    set "URL=%%b"
    set "BRANCH=%%c"

    REM Clonar repositorio si no existe
    if not exist "%%a" (
        echo Clonando %%a desde %%b...
        git clone %%b %%a
    )

    REM Cambiar a la rama especificada
    echo Cambiando a la rama %%c en %%a...
    pushd %%a
    git fetch origin
    git checkout %%c
    popd
)

echo Todos los repositorios han sido configurados correctamente.
