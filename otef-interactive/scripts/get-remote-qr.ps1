# Open the existing printable QR page on the running local OTEF origin.
# The page resolves the current phone address from runtime/share.json.
$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptDir 'start-otef.ps1') -DotSource

$repositoryRoot = Split-Path (Split-Path $scriptDir -Parent) -Parent
$port = Get-ProjectionPublishedPort -ComposeRoot $repositoryRoot
if (-not $port) {
    Write-Error 'The running nginx container has no published FRONT_PORT.'
    exit 1
}

node --experimental-detect-module (Join-Path $PSScriptRoot 'write-share-hosts.mjs') --repository-root $repositoryRoot --port $port
if ($LASTEXITCODE -ne 0) {
    Write-Error 'Failed to write hostname share file.'
    exit 1
}

$url = "$(Get-ProjectionLocalOrigin -Port ([int]$port))/otef-interactive/qr.html"
Write-Host "Opening QR code page: $url" -ForegroundColor Cyan
Start-Process $url
