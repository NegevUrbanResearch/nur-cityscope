#!/bin/bash

# Cargar dependencias necesarias
if ! command -v yq &> /dev/null; then
    echo "El comando 'yq' es necesario pero no está instalado. Instálalo y vuelve a intentar."
    exit 1
fi

# Verificar existencia del archivo config.yaml
CONFIG_FILE="setup-config.yaml"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "El archivo $CONFIG_FILE no existe."
    exit 1
fi

# Leer el archivo config.yaml
REPOS=$(yq '.repositories' $CONFIG_FILE)

# Clonar repositorios y cambiar de rama
for i in $(seq 0 $(($(echo "$REPOS" | jq length) - 1))); do
    NAME=$(yq ".repositories[$i].name" $CONFIG_FILE)
    URL=$(yq ".repositories[$i].url" $CONFIG_FILE)
    BRANCH=$(yq ".repositories[$i].branch" $CONFIG_FILE)

    if [ ! -d "$NAME" ]; then
        echo "Clonando $NAME desde $URL..."
        git clone "$URL" "$NAME"
    fi

    echo "Cambiando a la rama $BRANCH en $NAME..."
    cd "$NAME" || exit
    git fetch origin
    git checkout "$BRANCH"
    cd ..
done

echo "Todos los repositorios han sido configurados correctamente."
