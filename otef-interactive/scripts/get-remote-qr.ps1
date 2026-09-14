# Open the existing printable QR page on the running local OTEF origin.
# The page resolves the current phone address from runtime/network.json.
$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptDir 'projection-network.ps1')
. (Join-Path $scriptDir 'start-otef.ps1') -DotSource

$repositoryRoot = Split-Path (Split-Path $scriptDir -Parent) -Parent
$port = Get-ProjectionPublishedPort -ComposeRoot $repositoryRoot
if (-not $port) {
    Write-Error 'The running nginx container has no published FRONT_PORT.'
    exit 1
}

$runtimePath = Join-Path $repositoryRoot 'otef-interactive\frontend\runtime\network.json'
Update-ProjectionNetworkRuntime -Path $runtimePath -ComposeRoot $repositoryRoot | Out-Null
Start-ProjectionWatcherHidden -RepositoryRoot $repositoryRoot -RuntimePath $runtimePath
$url = "$(Get-ProjectionLocalOrigin -Port ([int]$port))/otef-interactive/qr.html"
Write-Host "Opening QR code page: $url" -ForegroundColor Cyan
Start-Process $url
