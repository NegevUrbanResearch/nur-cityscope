# Shared host-side network discovery for the OTEF launcher and QR page.
# This file is intentionally dot-sourceable; it has no work at import time.

function ConvertTo-ProjectionNumber([object]$value, [double]$fallback = [double]::PositiveInfinity) {
    if ($null -eq $value -or $value -is [bool]) { return $fallback }
    $number = 0.0
    if ([double]::TryParse(([string]$value), [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$number)) {
        return $number
    }
    return $fallback
}

function Get-ProjectionProperty([object]$object, [string]$name) {
    if ($null -eq $object) { return $null }
    $property = $object.PSObject.Properties[$name]
    if ($property) { return $property.Value }
    return $null
}

function Test-ProjectionPhysicalAdapter([object]$adapter) {
    if ($null -eq $adapter) { return $false }
    if (([string](Get-ProjectionProperty $adapter 'Status')) -notmatch '^(?i:up)$') { return $false }
    $hardware = Get-ProjectionProperty $adapter 'HardwareInterface'
    if ($hardware -isnot [bool] -and [string]$hardware -notmatch '^(?i:true|1)$') { return $false }
    if ($hardware -is [bool] -and -not $hardware) { return $false }

    # PhysicalMediaType is populated by Get-NetAdapter on this host. MediaType
    # is retained as a fallback for older Windows versions and test fixtures.
    $media = [string](Get-ProjectionProperty $adapter 'PhysicalMediaType')
    if (-not $media) { $media = [string](Get-ProjectionProperty $adapter 'MediaType') }
    if (-not $media -or $media -notmatch '^(?i:802\.3|native\s+802\.11|ethernet|wifi|wi-fi)$') { return $false }
    return $true
}

function Test-ProjectionPreferredAddress([object]$address) {
    if ($null -eq $address) { return $false }
    $ip = [string](Get-ProjectionProperty $address 'IPAddress')
    $parsed = $null
    if (-not [Net.IPAddress]::TryParse($ip, [ref]$parsed)) { return $false }
    if ($parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { return $false }
    $octets = $ip.Split('.')
    if ($octets.Count -ne 4) { return $false }
    if ([int]$octets[0] -eq 127 -or ([int]$octets[0] -eq 169 -and [int]$octets[1] -eq 254)) { return $false }

    $state = Get-ProjectionProperty $address 'AddressState'
    if ($null -eq $state) { return $false }
    $stateText = [string]$state
    if ($stateText -match '^(?i:preferred)$') { return $true }
    # AddressState is a CIM enum: Preferred=4, Tentative=1, Deprecated=3.
    return (ConvertTo-ProjectionNumber $stateText -1) -eq 4
}

function Select-ProjectionNetworkAddress {
    param(
        [object[]]$Adapters = @(),
        [object[]]$Addresses = @(),
        [object[]]$Interfaces = @(),
        [object[]]$Routes = @()
    )

    $adapterByIndex = @{}
    foreach ($adapter in @($Adapters)) {
        $index = ConvertTo-ProjectionNumber (Get-ProjectionProperty $adapter 'InterfaceIndex') -1
        if ($index -ge 0 -and (Test-ProjectionPhysicalAdapter $adapter)) { $adapterByIndex[[int]$index] = $adapter }
    }
    $interfaceByIndex = @{}
    foreach ($interface in @($Interfaces)) {
        $index = ConvertTo-ProjectionNumber (Get-ProjectionProperty $interface 'InterfaceIndex') -1
        if ($index -ge 0) { $interfaceByIndex[[int]$index] = $interface }
    }
    $addressByIndex = @{}
    foreach ($address in @($Addresses)) {
        if (-not (Test-ProjectionPreferredAddress $address)) { continue }
        $index = ConvertTo-ProjectionNumber (Get-ProjectionProperty $address 'InterfaceIndex') -1
        if ($index -ge 0 -and $adapterByIndex.ContainsKey([int]$index)) {
            if (-not $addressByIndex.ContainsKey([int]$index)) { $addressByIndex[[int]$index] = @() }
            $addressByIndex[[int]$index] += $address
        }
    }

    $ranked = @()
    foreach ($route in @($Routes)) {
        $prefix = [string](Get-ProjectionProperty $route 'DestinationPrefix')
        if ($prefix -notmatch '^(?i:0\.0\.0\.0/0)$') { continue }
        $indexValue = ConvertTo-ProjectionNumber (Get-ProjectionProperty $route 'InterfaceIndex') -1
        if ($indexValue -lt 0 -or -not $adapterByIndex.ContainsKey([int]$indexValue) -or -not $addressByIndex.ContainsKey([int]$indexValue)) { continue }
        $interfaceMetric = 0.0
        if ($interfaceByIndex.ContainsKey([int]$indexValue)) {
            $interfaceMetric = ConvertTo-ProjectionNumber (Get-ProjectionProperty $interfaceByIndex[[int]$indexValue] 'InterfaceMetric') 0
        }
        $routeMetric = ConvertTo-ProjectionNumber (Get-ProjectionProperty $route 'RouteMetric') 0
        foreach ($address in @($addressByIndex[[int]$indexValue])) {
            $ranked += [pscustomobject]@{
                Address = [string](Get-ProjectionProperty $address 'IPAddress')
                Score = $routeMetric + $interfaceMetric
                InterfaceIndex = [int]$indexValue
            }
        }
    }
    if ($ranked.Count -gt 0) {
        return ($ranked | Sort-Object @{Expression='Score'; Ascending=$true}, @{Expression='InterfaceIndex'; Ascending=$true}, @{Expression='Address'; Ascending=$true} | Select-Object -First 1).Address
    }

    # With no usable physical default route, choose the best active physical
    # interface by its Windows interface metric and then stable index.
    $fallback = @()
    foreach ($index in @($addressByIndex.Keys)) {
        $interfaceMetric = 0.0
        if ($interfaceByIndex.ContainsKey([int]$index)) {
            $interfaceMetric = ConvertTo-ProjectionNumber (Get-ProjectionProperty $interfaceByIndex[[int]$index] 'InterfaceMetric') 0
        }
        foreach ($address in @($addressByIndex[[int]$index])) {
            $fallback += [pscustomobject]@{ Address = [string](Get-ProjectionProperty $address 'IPAddress'); Score = $interfaceMetric; InterfaceIndex = [int]$index }
        }
    }
    if ($fallback.Count -eq 0) { return $null }
    return ($fallback | Sort-Object @{Expression='Score'; Ascending=$true}, @{Expression='InterfaceIndex'; Ascending=$true}, @{Expression='Address'; Ascending=$true} | Select-Object -First 1).Address
}

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

function Get-ProjectionDiscoveredAddress {
    $adapters = @(Get-NetAdapter -ErrorAction SilentlyContinue)
    $addresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue)
    $interfaces = @(Get-NetIPInterface -AddressFamily IPv4 -ErrorAction SilentlyContinue)
    $routes = @(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue)
    return Select-ProjectionNetworkAddress -Adapters $adapters -Addresses $addresses -Interfaces $interfaces -Routes $routes
}

function Write-ProjectionNetworkRuntime {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [AllowNull()][string]$Origin,
        [datetime]$Now = (Get-Date).ToUniversalTime()
    )
    $utc = $Now.ToUniversalTime()
    $runtime = [ordered]@{
        version = 1
        remoteOrigin = $(if ($Origin) { $Origin } else { $null })
        generatedAt = $utc.ToString('o', [Globalization.CultureInfo]::InvariantCulture)
        status = $(if ($Origin) { 'ready' } else { 'unavailable' })
    }
    $json = $runtime | ConvertTo-Json -Compress
    $directory = Split-Path -Parent $Path
    if ($directory) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
    $temporary = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        $encoding = New-Object System.Text.UTF8Encoding($false)
        [IO.File]::WriteAllText($temporary, $json, $encoding)
        if ([IO.File]::Exists($Path)) {
            [IO.File]::Replace($temporary, $Path, [NullString]::Value)
        } else {
            [IO.File]::Move($temporary, $Path)
        }
    } finally {
        if ([IO.File]::Exists($temporary)) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
    }
    return $runtime
}

function Update-ProjectionNetworkRuntime {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [string]$ComposeRoot = (Get-Location).Path,
        [scriptblock]$AddressProvider = $null,
        [scriptblock]$PortProvider = $null,
        [datetime]$Now = (Get-Date).ToUniversalTime()
    )
    if ($null -eq $AddressProvider) { $AddressProvider = { Get-ProjectionDiscoveredAddress } }
    if ($null -eq $PortProvider) { $PortProvider = { Get-ProjectionPublishedPort -ComposeRoot $ComposeRoot } }
    $address = $null
    $port = $null
    try { $address = & $AddressProvider } catch { $address = $null }
    try { $port = & $PortProvider } catch { $port = $null }
    $origin = $null
    if ($address -and $port) { $origin = Get-ProjectionLocalOrigin -Port ([int]$port) -HostName ([string]$address) }
    return Write-ProjectionNetworkRuntime -Path $Path -Origin $origin -Now $Now
}

function Get-ProjectionMutexName([string]$RepositoryRoot) {
    $normalized = [IO.Path]::GetFullPath($RepositoryRoot).TrimEnd('\').ToLowerInvariant()
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($normalized)
        $hash = $sha.ComputeHash($bytes)
        $hex = [BitConverter]::ToString($hash).Replace('-', '')
    } finally { $sha.Dispose() }
    return "Local\NurCityScopeProjectionNetwork-$hex"
}
