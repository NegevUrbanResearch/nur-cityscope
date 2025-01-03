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

REM Crear la carpeta ./clbb-io/core/external_files si no existe
if not exist "clbb-io/core/external_files" (
    mkdir "clbb-io/core/external_files"
    echo Carpeta clbb-io/core/external_files creada.
)

REM Crear la carpeta ./clbb-io/core/migrations si no existe
if not exist "clbb-io/core/migrations" (
    mkdir "clbb-io/core/migrations"
    echo Carpeta clbb-io/core/migrations creada.
)

REM Crear el archivo __init__.py vacío en la carpeta ./clbb-io/core/migrations
if not exist "clbb-io/core/migrations/__init__.py" (
    type nul > "clbb-io/core/migrations/__init__.py"
    echo Archivo __init__.py creado en clbb-io/core/migrations.
)

REM Crear el archivo __init__.py vacío en la carpeta ./clbb-io/core/migrations
if not exist "clbb-io/backend/migrations/__init__.py" (
    type nul > "clbb-io/backend/migrations/__init__.py"
    echo Archivo __init__.py creado en clbb-io/backend/migrations.
)

REM Crear el archivo .env con los parámetros especificados
set ENV_FILE=.env
(
    echo DB_CONTAINER_NAME=
    echo POSTGRES_USER=
    echo POSTGRES_PASSWORD=
    echo POSTGRES_DB=
    echo DATABASE_URL=
    echo API_PORT=
    echo FRONT_PORT=
) > %ENV_FILE%
echo Archivo .env creado con los parámetros especificados.

echo Todos los repositorios han sido configurados correctamente.
