#!/bin/bash

# === CLBB-CityScope Setup Script ===
# This script clones and configures all repositories needed for the CLBB-CityScope project.

# Check for required dependencies
if ! command -v yq &> /dev/null; then
    echo "ERROR: The 'yq' command is required but not installed. Please install it and try again."
    echo "Install instructions: https://github.com/mikefarah/yq#install"
    exit 1
fi

# Determine script directory (works regardless of where the script is called from)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Set config file path relative to the script location
CONFIG_FILE="$SCRIPT_DIR/setup-config.yaml"

# Check if config file exists
if [ ! -f "$CONFIG_FILE" ]; then
    echo "ERROR: Configuration file $CONFIG_FILE does not exist."
    echo "Make sure you have the setup-config.yaml file in the same directory as this script."
    exit 1
fi

# Read the repositories from config file - output as JSON for jq compatibility
echo "Reading configuration from $CONFIG_FILE..."
REPOS=$(yq -o=json '.repositories' "$CONFIG_FILE")

# Navigate to script directory
cd "$SCRIPT_DIR" || exit

# Clone repositories and switch to specified branch
REPO_COUNT=$(echo "$REPOS" | jq length)
echo "Found $REPO_COUNT repositories to configure."

for i in $(seq 0 $((REPO_COUNT - 1))); do
    NAME=$(echo "$REPOS" | jq -r ".[$i].name")
    URL=$(echo "$REPOS" | jq -r ".[$i].url")
    BRANCH=$(echo "$REPOS" | jq -r ".[$i].branch")

    if [ ! -d "$NAME" ]; then
        echo "Cloning $NAME from $URL..."
        git clone "$URL" "$NAME"
    else
        echo "Directory $NAME already exists, skipping clone."
    fi

    echo "Switching to branch $BRANCH in $NAME..."
    cd "$NAME" || { echo "ERROR: Could not change to directory $NAME"; exit 1; }
    git fetch origin
    git checkout "$BRANCH"
    cd "$SCRIPT_DIR" || exit
done

# Create necessary migration folders
echo "Creating required migration folders..."
mkdir -p "$SCRIPT_DIR/clbb-io/core/external_files"
mkdir -p "$SCRIPT_DIR/clbb-io/core/migrations"
mkdir -p "$SCRIPT_DIR/clbb-io/backend/migrations"

# Create empty __init__.py files
touch "$SCRIPT_DIR/clbb-io/core/migrations/__init__.py"
touch "$SCRIPT_DIR/clbb-io/backend/migrations/__init__.py"

echo "✅ All repositories have been successfully configured."
echo "Next step: Run 'docker-compose up -d' to start the services."

