@echo off

REM Verificar existencia del archivo config.yaml
set CONFIG_FILE=setup-config.yaml
if not exist %CONFIG_FILE% (
    echo El archivo %CONFIG_FILE% no existe.
    exit /b 1
)

REM Requiere Python para procesar YAML
for /f "delims=" %%i in ('python -c "import yaml,sys; data = yaml.safe_load(open('%CONFIG_FILE%')); [print(f'{r['name']}|{r['url']}|{r['branch']}') for r in data['repositories']]"') do (
    set "line=%%i"
    for /f "tokens=1,2,3 delims=|" %%a in ("%%line%%") do (
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
)

echo Todos los repositorios han sido configurados correctamente.
