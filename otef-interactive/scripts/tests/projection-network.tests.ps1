$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path (Split-Path $scriptRoot -Parent) 'start-otef.ps1') -DotSource

function Assert-Equal([object]$actual, [object]$expected, [string]$message) {
    if ($actual -ne $expected) {
        throw "$message (expected '$expected', got '$actual')"
    }
}

function Assert-True([bool]$condition, [string]$message) {
    if (-not $condition) { throw $message }
}

$seenArguments = @()
$portRunner = { param([string[]]$arguments) $script:seenArguments = $arguments; [pscustomobject]@{ Output = @('127.0.0.1:8512'); ExitCode = 0 } }
Assert-Equal (Get-ProjectionPublishedPort -ComposeRoot $PWD.Path -Runner $portRunner) 8512 'published port parser should accept IPv4 bindings'
Assert-Equal ($seenArguments -join ' ') 'compose port nginx 80' 'published port query should pass the exact compose port arguments'
Assert-Equal (Get-ProjectionPublishedPort -ComposeRoot $PWD.Path -Runner { param([string[]]$arguments) '[::]:80' }) 80 'published port parser should accept bracketed IPv6 bindings'
Assert-Equal (Get-ProjectionPublishedPort -ComposeRoot $PWD.Path -Runner { param([string[]]$arguments) '' }) $null 'empty port output should return null'

$startupProbeCalls = @()
$startupLaunches = @()
$startupRoot = Join-Path ([IO.Path]::GetTempPath()) ('otef-startup-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $startupRoot -Force | Out-Null
try {
    $composeFailureStopped = $false
    try {
        Invoke-ProjectionStartup -RepositoryRoot $startupRoot -TimeoutSeconds 2 `
            -ComposeStart { 'compose diagnostic'; return $false } -PortProvider { param($root) 8512 } `
            -Probe { param($url) $script:startupProbeCalls += $url; return $false } -Sleep { param($seconds) } | Out-Null
    } catch { $composeFailureStopped = $true }
    Assert-True $composeFailureStopped 'Compose failure with diagnostic output must stop startup'
    $startupProbeCalls = @()
    $ok = Invoke-ProjectionStartup -AlreadyStarted -RepositoryRoot $startupRoot -TimeoutSeconds 2 `
        -PortProvider { param($root) 8512 } -Probe { param($url) $script:startupProbeCalls += $url; return $true } `
        -Sleep { param($seconds) } `
        -BrowserLauncher { param($url) $script:startupLaunches += $url }
    Assert-True $ok 'startup should complete after both readiness probes succeed'
    Assert-Equal $startupLaunches.Count 1 'startup should open the launcher once'
    Assert-Equal $startupLaunches[0] 'http://localhost:8512/otef-interactive/launcher.html' 'startup should use the published port'

    $deadlineProbe = { param($url, $timeout) Start-Sleep -Milliseconds 1100; return $true }
    Assert-Equal (Wait-ProjectionReadiness -Origin 'http://localhost:8512' -TimeoutSeconds 1 -Probe $deadlineProbe -Sleep { param($seconds) }) $false `
        'readiness must reject a late successful probe and avoid opening the browser'
    Assert-True ((Get-Content -Raw (Join-Path (Split-Path $scriptRoot -Parent) 'get-remote-qr.ps1')) -match 'write-share-hosts.mjs') `
        'standalone QR command should write share hosts once'
    Assert-True (-not ((Get-Content -Raw (Join-Path (Split-Path $scriptRoot -Parent) 'get-remote-qr.ps1')) -match 'watch-projection-network')) `
        'standalone QR command should not launch a LAN watcher'
} finally {
    Remove-Item -LiteralPath $startupRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host 'projection-network.tests.ps1: PASS' -ForegroundColor Green
