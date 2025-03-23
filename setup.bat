@echo off

REM Check if setup-config.csv file exists
set CONFIG_FILE=setup-config.csv
if not exist %CONFIG_FILE% (
    echo File %CONFIG_FILE% does not exist.
    exit /b 1
)

REM Read the CSV file line by line
for /f "skip=1 tokens=1,2,3 delims=," %%a in (%CONFIG_FILE%) do (
    set "NAME=%%a"
    set "URL=%%b"
    set "BRANCH=%%c"

    REM Clone repository if it doesn't exist
    if not exist "%%a" (
        echo Cloning %%a from %%b...
        git clone %%b %%a
    )

    REM Switch to the specified branch
    echo Switching to branch %%c in %%a...
    pushd %%a
    git fetch origin
    git checkout %%c
    popd
)

REM Create ./clbb-io/core/external_files folder if it doesn't exist
if not exist "clbb-io/core/external_files" (
    mkdir "clbb-io/core/external_files"
    echo Folder clbb-io/core/external_files created.
)

REM Create ./clbb-io/core/migrations folder if it doesn't exist
if not exist "clbb-io/core/migrations" (
    mkdir "clbb-io/core/migrations"
    echo Folder clbb-io/core/migrations created.
)

REM Create empty __init__.py file in ./clbb-io/core/migrations folder
if not exist "clbb-io/core/migrations/__init__.py" (
    type nul > "clbb-io/core/migrations/__init__.py"
    echo File __init__.py created in clbb-io/core/migrations.
)

REM Create empty __init__.py file in ./clbb-io/backend/migrations folder
if not exist "clbb-io/backend/migrations/__init__.py" (
    type nul > "clbb-io/backend/migrations/__init__.py"
    echo File __init__.py created in clbb-io/backend/migrations.
)

REM Create .env file with specified parameters
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
echo .env file created with specified parameters.

echo All repositories have been successfully configured.


# This is the setup file
