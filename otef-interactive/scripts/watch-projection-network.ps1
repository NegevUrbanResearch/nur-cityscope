param(
    [string]$RuntimePath = (Join-Path $PSScriptRoot '..\frontend\runtime\network.json'),
    [string]$RepositoryRoot = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent),
    [switch]$DotSource
)

. (Join-Path $PSScriptRoot 'projection-network.ps1')

function Test-ProjectionNginxRunning {
    param([string]$ComposeRoot = (Get-Location).Path, [scriptblock]$Runner = $null)
    if ($null -eq $Runner) { $Runner = { param([string[]]$arguments) Invoke-ProjectionDocker -Arguments $arguments -ComposeRoot $ComposeRoot } }
    $result = & $Runner @('inspect', '--format', '{{.State.Running}}', 'nginx-front')
    $output = @($result)
    if ($result -and $result.PSObject.Properties['Output']) {
        $output = @($result.Output)
        if ([int]$result.ExitCode -ne 0) { return $false }
    }
    return (($output -join '').Trim() -match '^(?i:true)$')
}

function Start-ProjectionNetworkWatcher {
    param(
        [string]$RuntimePath = (Join-Path $PSScriptRoot '..\frontend\runtime\network.json'),
        [string]$RepositoryRoot = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent),
        [scriptblock]$MutexFactory = $null,
        [scriptblock]$IsNginxRunning = $null,
        [scriptblock]$Refresh = $null,
        [scriptblock]$Sleep = $null,
        [int]$MaxIterations = 0
    )
    if ($null -eq $MutexFactory) { $MutexFactory = { param($name) New-Object System.Threading.Mutex($false, $name) } }
    if ($null -eq $IsNginxRunning) { $IsNginxRunning = { Test-ProjectionNginxRunning -ComposeRoot $RepositoryRoot } }
    if ($null -eq $Refresh) { $Refresh = { Update-ProjectionNetworkRuntime -Path $RuntimePath -ComposeRoot $RepositoryRoot } }
    if ($null -eq $Sleep) { $Sleep = { param($seconds) Start-Sleep -Seconds $seconds } }

    $mutex = & $MutexFactory (Get-ProjectionMutexName $RepositoryRoot)
    $ownsMutex = $false
    try {
        try { $ownsMutex = $mutex.WaitOne(0) }
        catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
        if (-not $ownsMutex) { return $false }

        $iterations = 0
        while ($true) {
            if ($MaxIterations -gt 0 -and $iterations -ge $MaxIterations) { break }
            if (-not (& $IsNginxRunning)) {
                # Remove stale ready data as soon as the stack stops.
                Write-ProjectionNetworkRuntime -Path $RuntimePath -Origin $null | Out-Null
                break
            }
            & $Refresh | Out-Null
            $iterations++
            if ($MaxIterations -gt 0 -and $iterations -ge $MaxIterations) { break }
            & $Sleep 15 | Out-Null
        }
        return $true
    } finally {
        if ($ownsMutex) { $mutex.ReleaseMutex() | Out-Null }
        $mutex.Dispose() | Out-Null
    }
}

if (-not $DotSource -and $MyInvocation.InvocationName -ne '.') {
    Start-ProjectionNetworkWatcher -RuntimePath $RuntimePath -RepositoryRoot $RepositoryRoot | Out-Null
}
