param(
    [switch]$AlreadyStarted,
    [string]$RepositoryRoot = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent),
    [int]$TimeoutSeconds = 120,
    [scriptblock]$ComposeStart = $null,
    [scriptblock]$PortProvider = $null,
    [scriptblock]$Probe = $null,
    [scriptblock]$Sleep = $null,
    [scriptblock]$WatcherLauncher = $null,
    [scriptblock]$BrowserLauncher = $null,
    [switch]$DotSource
)

. (Join-Path $PSScriptRoot 'projection-network.ps1')

function Invoke-ProjectionComposeStart {
    param([string]$ComposeRoot)
    Push-Location -LiteralPath $ComposeRoot
    try {
        $null = & docker compose up -d 2>&1
        $exitCode = $LASTEXITCODE
        return [bool]($exitCode -eq 0)
    }
    finally { Pop-Location }
}

function Test-ProjectionHttpReady {
    param([string]$Url, [int]$TimeoutSec = 5)
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec ([math]::Max(1, $TimeoutSec))
        return ($response -and [int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 400)
    } catch { return $false }
}

function Wait-ProjectionReadiness {
    param(
        [Parameter(Mandatory=$true)][string]$Origin,
        [int]$TimeoutSeconds = 120,
        [scriptblock]$Probe = $null,
        [scriptblock]$Sleep = $null
    )
    if ($null -eq $Probe) { $Probe = { param($url, $timeout) Test-ProjectionHttpReady -Url $url -TimeoutSec $timeout } }
    if ($null -eq $Sleep) { $Sleep = { param($seconds) Start-Sleep -Seconds $seconds } }
    $launcherUrl = "$Origin/otef-interactive/launcher.html"
    $apiUrl = "$Origin/api/otef/projection-config/?table=otef"
    $deadline = [Diagnostics.Stopwatch]::StartNew()
    while ($deadline.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        $remaining = $TimeoutSeconds - $deadline.Elapsed.TotalSeconds
        if ($remaining -le 0) { break }
        $probeTimeout = [int][math]::Max(1, [math]::Min(5, [math]::Ceiling($remaining)))
        $launcherReady = [bool](& $Probe $launcherUrl $probeTimeout)
        $remaining = $TimeoutSeconds - $deadline.Elapsed.TotalSeconds
        if ($remaining -le 0) { break }
        $probeTimeout = [int][math]::Max(1, [math]::Min(5, [math]::Ceiling($remaining)))
        $apiReady = [bool](& $Probe $apiUrl $probeTimeout)
        if ($launcherReady -and $apiReady -and $deadline.Elapsed.TotalSeconds -le $TimeoutSeconds) { return $true }
        if ($deadline.Elapsed.TotalSeconds -ge $TimeoutSeconds) { break }
        & $Sleep 1 | Out-Null
    }
    return $false
}

function Start-ProjectionWatcherHidden {
    param([string]$RepositoryRoot, [string]$RuntimePath)
    $watcher = Join-Path $PSScriptRoot 'watch-projection-network.ps1'
    $quotedWatcher = '"' + $watcher.Replace('"', '\"') + '"'
    $quotedRoot = '"' + $RepositoryRoot.Replace('"', '\"') + '"'
    $quotedRuntime = '"' + $RuntimePath.Replace('"', '\"') + '"'
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $quotedWatcher, '-RepositoryRoot', $quotedRoot, '-RuntimePath', $quotedRuntime)
    Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -WorkingDirectory $RepositoryRoot -ArgumentList $arguments | Out-Null
}

function Invoke-ProjectionStartup {
    param(
        [switch]$AlreadyStarted,
        [string]$RepositoryRoot,
        [int]$TimeoutSeconds = 120,
        [scriptblock]$ComposeStart = $null,
        [scriptblock]$PortProvider = $null,
        [scriptblock]$Probe = $null,
        [scriptblock]$Sleep = $null,
        [scriptblock]$WatcherLauncher = $null,
        [scriptblock]$BrowserLauncher = $null
    )
    if ($null -eq $ComposeStart) { $ComposeStart = { param($root) Invoke-ProjectionComposeStart -ComposeRoot $root } }
    if (-not $AlreadyStarted) {
        $composeResult = @(& $ComposeStart $RepositoryRoot)
        $composeSucceeded = ($composeResult.Count -gt 0 -and [bool]$composeResult[$composeResult.Count - 1])
        if (-not $composeSucceeded) {
            Write-Error 'Docker Compose could not start the OTEF stack.'
            return $false
        }
    }
    if ($null -eq $PortProvider) { $PortProvider = { param($root) Get-ProjectionPublishedPort -ComposeRoot $root } }
    $port = & $PortProvider $RepositoryRoot
    if (-not $port) {
        Write-Error 'The running nginx container has no published FRONT_PORT.'
        return $false
    }
    $origin = Get-ProjectionLocalOrigin -Port ([int]$port)
    if (-not (Wait-ProjectionReadiness -Origin $origin -TimeoutSeconds $TimeoutSeconds -Probe $Probe -Sleep $Sleep)) {
        Write-Error "OTEF readiness timed out after $TimeoutSeconds seconds; launcher was not opened."
        return $false
    }

    $runtimePath = Join-Path $RepositoryRoot 'otef-interactive\frontend\runtime\network.json'
    Update-ProjectionNetworkRuntime -Path $runtimePath -ComposeRoot $RepositoryRoot | Out-Null
    if ($null -eq $WatcherLauncher) { $WatcherLauncher = { param($root, $path) Start-ProjectionWatcherHidden -RepositoryRoot $root -RuntimePath $path } }
    & $WatcherLauncher $RepositoryRoot $runtimePath | Out-Null
    $launcherUrl = "$origin/otef-interactive/launcher.html"
    if ($null -eq $BrowserLauncher) { $BrowserLauncher = { param($url) Start-Process $url | Out-Null } }
    & $BrowserLauncher $launcherUrl | Out-Null
    Write-Host "OTEF ready: $launcherUrl" -ForegroundColor Green
    return $true
}

if (-not $DotSource -and $MyInvocation.InvocationName -ne '.') {
    $startupResult = Invoke-ProjectionStartup -AlreadyStarted:$AlreadyStarted -RepositoryRoot $RepositoryRoot -TimeoutSeconds $TimeoutSeconds `
        -ComposeStart $ComposeStart -PortProvider $PortProvider -Probe $Probe -Sleep $Sleep `
        -WatcherLauncher $WatcherLauncher -BrowserLauncher $BrowserLauncher
    if (-not $startupResult) { exit 1 }
}
