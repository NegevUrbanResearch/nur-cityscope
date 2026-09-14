$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path (Split-Path $scriptRoot -Parent) 'projection-network.ps1')
. (Join-Path (Split-Path $scriptRoot -Parent) 'watch-projection-network.ps1') -DotSource
. (Join-Path (Split-Path $scriptRoot -Parent) 'start-otef.ps1') -DotSource

function Assert-Equal([object]$actual, [object]$expected, [string]$message) {
    if ($actual -ne $expected) {
        throw "$message (expected '$expected', got '$actual')"
    }
}

function Assert-True([bool]$condition, [string]$message) {
    if (-not $condition) { throw $message }
}

$physicalWifi = [pscustomobject]@{
    InterfaceIndex = 10; HardwareInterface = $true; Status = 'Up'
    PhysicalMediaType = 'Native 802.11'; InterfaceAlias = ('Wi-Fi ' + [char]0x05DC + [char]0x05D5 + [char]0x05E7 + [char]0x05DC + [char]0x05D0 + [char]0x05DC + [char]0x05D9 + [char]0x05EA)
}
$physicalEthernet = [pscustomobject]@{
    InterfaceIndex = 20; HardwareInterface = $true; Status = 'Up'
    PhysicalMediaType = '802.3'; InterfaceAlias = ('Ethernet ' + [char]0x043D + [char]0x0435 + [char]0x0442)
}
$vpn = [pscustomobject]@{
    InterfaceIndex = 30; HardwareInterface = $false; Status = 'Up'
    PhysicalMediaType = 'Tunnel'; InterfaceAlias = ('VPN ' + [char]0x05D7 + [char]0x05D1 + [char]0x05E8 + [char]0x05D4)
}
$addresses = @(
    [pscustomobject]@{ InterfaceIndex = 10; IPAddress = '192.0.2.10'; AddressState = 4 },
    [pscustomobject]@{ InterfaceIndex = 20; IPAddress = '192.0.2.20'; AddressState = 'Preferred' },
    [pscustomobject]@{ InterfaceIndex = 30; IPAddress = '192.0.2.30'; AddressState = 'Preferred' }
)
$interfaces = @(
    [pscustomobject]@{ InterfaceIndex = 10; InterfaceMetric = 20 },
    [pscustomobject]@{ InterfaceIndex = 20; InterfaceMetric = 20 },
    [pscustomobject]@{ InterfaceIndex = 30; InterfaceMetric = 1 }
)

$chosen = Select-ProjectionNetworkAddress -Adapters @($physicalWifi, $physicalEthernet, $vpn) `
    -Addresses $addresses -Interfaces $interfaces -Routes @(
        [pscustomobject]@{ InterfaceIndex = 10; DestinationPrefix = '0.0.0.0/0'; RouteMetric = 10 },
        [pscustomobject]@{ InterfaceIndex = 20; DestinationPrefix = '0.0.0.0/0'; RouteMetric = 40 },
        [pscustomobject]@{ InterfaceIndex = 30; DestinationPrefix = '0.0.0.0/0'; RouteMetric = 1 }
    )
Assert-Equal $chosen '192.0.2.10' 'lower physical route plus interface metric should win over VPN'

$tieChosen = Select-ProjectionNetworkAddress -Adapters @($physicalWifi, $physicalEthernet) `
    -Addresses @($addresses[0], $addresses[1]) -Interfaces $interfaces -Routes @(
        [pscustomobject]@{ InterfaceIndex = 10; DestinationPrefix = '0.0.0.0/0'; RouteMetric = 10 },
        [pscustomobject]@{ InterfaceIndex = 20; DestinationPrefix = '0.0.0.0/0'; RouteMetric = 10 }
    )
Assert-Equal $tieChosen '192.0.2.10' 'interface index should break equal route rankings'

$rejected = @(
    [pscustomobject]@{ InterfaceIndex = 40; IPAddress = '169.254.10.4'; AddressState = 'Preferred' },
    [pscustomobject]@{ InterfaceIndex = 50; IPAddress = '192.0.2.50'; AddressState = 1 },
    [pscustomobject]@{ InterfaceIndex = 60; IPAddress = '192.0.2.60'; AddressState = 'Preferred' },
    [pscustomobject]@{ InterfaceIndex = 70; IPAddress = '192.0.2.70'; AddressState = 'Preferred' }
)
$rejectedAdapters = @(
    [pscustomobject]@{ InterfaceIndex = 40; HardwareInterface = $true; Status = 'Up'; PhysicalMediaType = '802.3'; InterfaceAlias = ('Ethernet ' + [char]0x5907 + [char]0x7528) },
    [pscustomobject]@{ InterfaceIndex = 50; HardwareInterface = $true; Status = 'Up'; PhysicalMediaType = 'Native 802.11'; InterfaceAlias = ('WiFi ' + [char]0x00E9 + [char]0x00E9) },
    [pscustomobject]@{ InterfaceIndex = 60; HardwareInterface = $true; Status = 'Up'; PhysicalMediaType = '802.3'; InterfaceAlias = ('Ethernet ' + [char]0x0440 + [char]0x0435 + [char]0x0437) },
    [pscustomobject]@{ InterfaceIndex = 70; HardwareInterface = $true; Status = 'Down'; PhysicalMediaType = '802.3'; InterfaceAlias = ('Ethernet ' + [char]0x043D + [char]0x0435 + [char]0x0442) }
)
$rejectedInterfaces = @(
    [pscustomobject]@{ InterfaceIndex = 40; InterfaceMetric = 1 },
    [pscustomobject]@{ InterfaceIndex = 50; InterfaceMetric = 1 },
    [pscustomobject]@{ InterfaceIndex = 60; InterfaceMetric = 2 },
    [pscustomobject]@{ InterfaceIndex = 70; InterfaceMetric = 0 }
)
Assert-Equal (Select-ProjectionNetworkAddress -Adapters $rejectedAdapters -Addresses $rejected -Interfaces $rejectedInterfaces -Routes @()) `
    '192.0.2.60' 'APIPA, tentative and down interfaces should be rejected'

$noRoute = Select-ProjectionNetworkAddress -Adapters @($physicalWifi, $physicalEthernet) `
    -Addresses @($addresses[0], $addresses[1]) -Interfaces @(
        [pscustomobject]@{ InterfaceIndex = 10; InterfaceMetric = 20 },
        [pscustomobject]@{ InterfaceIndex = 20; InterfaceMetric = 40 }
    ) -Routes @()
Assert-Equal $noRoute '192.0.2.10' 'without a default route interface metric should rank physical interfaces'
Assert-Equal (Select-ProjectionNetworkAddress -Adapters @() -Addresses @() -Interfaces @() -Routes @()) $null 'empty inputs should return null'

$seenArguments = @()
$portRunner = { param([string[]]$arguments) $script:seenArguments = $arguments; [pscustomobject]@{ Output = @('127.0.0.1:8512'); ExitCode = 0 } }
Assert-Equal (Get-ProjectionPublishedPort -ComposeRoot $PWD.Path -Runner $portRunner) 8512 'published port parser should accept IPv4 bindings'
Assert-Equal ($seenArguments -join ' ') 'compose port nginx 80' 'published port query should pass the exact compose port arguments'
Assert-Equal (Get-ProjectionPublishedPort -ComposeRoot $PWD.Path -Runner { param([string[]]$arguments) '[::]:80' }) 80 'published port parser should accept bracketed IPv6 bindings'
Assert-Equal (Get-ProjectionPublishedPort -ComposeRoot $PWD.Path -Runner { param([string[]]$arguments) '' }) $null 'empty port output should return null'

$runtimePath = Join-Path ([IO.Path]::GetTempPath()) ('otef-network-test-' + [guid]::NewGuid().ToString('N') + '.json')
try {
    Write-ProjectionNetworkRuntime -Path $runtimePath -Origin 'http://192.0.2.10:8512' -Now ([datetime]'2026-09-13T10:00:00Z') | Out-Null
    Update-ProjectionNetworkRuntime -Path $runtimePath -Now ([datetime]'2026-09-13T10:00:15Z') `
        -AddressProvider { throw 'network unavailable' } -PortProvider { param($root) 8512 } | Out-Null
    $unavailable = Get-Content -Raw $runtimePath | ConvertFrom-Json
    Assert-Equal $unavailable.version 1 'runtime version should be 1'
    Assert-Equal $unavailable.remoteOrigin $null 'failed discovery should replace old origin'
    Assert-Equal $unavailable.status 'unavailable' 'failed discovery should publish unavailable status'
    Assert-Equal $unavailable.generatedAt '2026-09-13T10:00:15.0000000Z' 'runtime timestamp should refresh in UTC'
} finally {
    Remove-Item -LiteralPath $runtimePath -Force -ErrorAction SilentlyContinue
}

$sleepSeconds = @()
$refreshCount = 0
$fakeMutex = New-Object psobject
$fakeMutex | Add-Member ScriptMethod WaitOne { param($timeout) return $true }
$fakeMutex | Add-Member ScriptMethod ReleaseMutex { return $null }
$fakeMutex | Add-Member ScriptMethod Dispose { return $null }
$watcherResult = Start-ProjectionNetworkWatcher -RepositoryRoot $PWD.Path -RuntimePath (Join-Path ([IO.Path]::GetTempPath()) 'otef-network-watcher-test.json') -MutexFactory { param($name) $fakeMutex } `
    -IsNginxRunning { return ($script:refreshCount -lt 2) } -Refresh { param($unused) $script:refreshCount++ } `
    -Sleep { param($seconds) $script:sleepSeconds += $seconds }
Assert-True $watcherResult 'watcher should run when it acquires the mutex'
Assert-Equal $sleepSeconds[0] 15 'watcher refresh interval should be 15 seconds'
Remove-Item -LiteralPath (Join-Path ([IO.Path]::GetTempPath()) 'otef-network-watcher-test.json') -Force -ErrorAction SilentlyContinue

$duplicateMutex = New-Object psobject
$duplicateMutex | Add-Member ScriptMethod WaitOne { param($timeout) return $false }
$duplicateMutex | Add-Member ScriptMethod ReleaseMutex { throw 'duplicate must not release mutex' }
$duplicateMutex | Add-Member ScriptMethod Dispose { return $null }
Assert-Equal (Start-ProjectionNetworkWatcher -RepositoryRoot $PWD.Path -MutexFactory { param($name) $duplicateMutex } `
    -IsNginxRunning { return $true } -Refresh { throw 'duplicate must not refresh' } -Sleep { param($seconds) }) $false `
    'duplicate watcher should exit without refreshing'

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
        -Sleep { param($seconds) } -WatcherLauncher { param($root, $path) } `
        -BrowserLauncher { param($url) $script:startupLaunches += $url }
    Assert-True $ok 'startup should complete after both readiness probes succeed'
    Assert-Equal $startupLaunches.Count 1 'startup should open the launcher once'
Assert-Equal $startupLaunches[0] 'http://localhost:8512/otef-interactive/launcher.html' 'startup should use the published port'

$deadlineProbe = { param($url, $timeout) Start-Sleep -Milliseconds 1100; return $true }
Assert-Equal (Wait-ProjectionReadiness -Origin 'http://localhost:8512' -TimeoutSeconds 1 -Probe $deadlineProbe -Sleep { param($seconds) }) $false `
    'readiness must reject a late successful probe and avoid opening the browser'
Assert-True ((Get-Content -Raw (Join-Path (Split-Path $scriptRoot -Parent) 'get-remote-qr.ps1')) -match 'Start-ProjectionWatcherHidden') `
    'standalone QR command should ensure the shared hidden watcher'
} finally {
    Remove-Item -LiteralPath $startupRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host 'projection-network.tests.ps1: PASS' -ForegroundColor Green
