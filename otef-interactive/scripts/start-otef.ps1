param(
    [switch]$AlreadyStarted,
    [string]$RepositoryRoot = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent),
    [int]$TimeoutSeconds = 120,
    [scriptblock]$ComposeStart = $null,
    [scriptblock]$PortProvider = $null,
    [scriptblock]$Probe = $null,
    [scriptblock]$Sleep = $null,
    [scriptblock]$BrowserLauncher = $null,
    [switch]$DotSource
)

function Invoke-ProjectionDocker {
    param([string[]]$Arguments, [string]$ComposeRoot = (Get-Location).Path)
    Push-Location -LiteralPath $ComposeRoot
    try {
        $output = @(& docker @Arguments 2>$null)
        $exitCode = $LASTEXITCODE
        return [pscustomobject]@{ Output = $output; ExitCode = $exitCode }
    }
    finally { Pop-Location }
}

function Get-ProjectionPublishedPort {
    param(
        [string]$ComposeRoot = (Get-Location).Path,
        [scriptblock]$Runner = $null
    )
    if ($null -eq $Runner) { $Runner = { param([string[]]$arguments) Invoke-ProjectionDocker -Arguments $arguments -ComposeRoot $ComposeRoot } }
    $result = & $Runner @('compose', 'port', 'nginx', '80')
    $exitCode = 0
    $output = @($result)
    if ($result -and $result.PSObject.Properties['Output']) {
        $output = @($result.Output)
        $exitCode = [int]$result.ExitCode
    }
    if ($output.Count -eq 0 -or $exitCode -ne 0) { return $null }
    foreach ($line in $output) {
        if ([string]$line -match ':(\d+)\s*$') {
            $port = [int]$Matches[1]
            if ($port -ge 1 -and $port -le 65535) { return $port }
        }
    }
    return $null
}

function Get-ProjectionLocalOrigin([int]$Port, [string]$HostName = 'localhost') {
    if ($Port -eq 80) { return "http://$HostName" }
    return "http://$HostName`:$Port"
}

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

function Invoke-ProjectionStartup {
    param(
        [switch]$AlreadyStarted,
        [string]$RepositoryRoot,
        [int]$TimeoutSeconds = 120,
        [scriptblock]$ComposeStart = $null,
        [scriptblock]$PortProvider = $null,
        [scriptblock]$Probe = $null,
        [scriptblock]$Sleep = $null,
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

    node --experimental-detect-module (Join-Path $PSScriptRoot 'write-share-hosts.mjs') --repository-root $RepositoryRoot --port $port
    if ($LASTEXITCODE -ne 0) {
        Write-Error 'Failed to write hostname share file.'
        return $false
    }
    $launcherUrl = "$origin/otef-interactive/launcher.html"
    if ($null -eq $BrowserLauncher) { $BrowserLauncher = { param($url) Start-Process $url | Out-Null } }
    & $BrowserLauncher $launcherUrl | Out-Null
    Write-Host "OTEF ready: $launcherUrl" -ForegroundColor Green
    return $true
}

if (-not $DotSource -and $MyInvocation.InvocationName -ne '.') {
    $startupResult = Invoke-ProjectionStartup -AlreadyStarted:$AlreadyStarted -RepositoryRoot $RepositoryRoot -TimeoutSeconds $TimeoutSeconds `
        -ComposeStart $ComposeStart -PortProvider $PortProvider -Probe $Probe -Sleep $Sleep `
        -BrowserLauncher $BrowserLauncher
    if (-not $startupResult) { exit 1 }
}
