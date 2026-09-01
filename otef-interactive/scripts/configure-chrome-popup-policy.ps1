<#
.SYNOPSIS
    Configure the Chrome popup allowlist for the local OTEF exhibit.

.DESCRIPTION
    Installs or removes one machine-level Chrome policy entry for the exact
    exhibit origin http://localhost:80. Other popup settings and other numbered
    allowlist entries remain unchanged.

    Install and Remove require an elevated Windows PowerShell session because
    Chrome reads this policy from HKLM. Status is read-only and does not need
    elevation.

.PARAMETER Mode
    Install adds the localhost origin to the first unused numbered value.
    Remove removes entries whose value is exactly http://localhost:80.
    Status reports the current entries without changing the registry.

.EXAMPLE
    .\configure-chrome-popup-policy.ps1 -Mode Status

.EXAMPLE
    .\configure-chrome-popup-policy.ps1 -Mode Install

.EXAMPLE
    .\configure-chrome-popup-policy.ps1 -Mode Remove
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateSet('Install', 'Remove', 'Status')]
    [string]$Mode = 'Status'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$PolicyPath = 'HKLM:\Software\Policies\Google\Chrome\PopupsAllowedForUrls'
$AllowedOrigin = 'http://localhost:80'

function Test-IsAdministrator {
    try {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = New-Object Security.Principal.WindowsPrincipal($identity)
        return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch {
        return $false
    }
}

function Assert-Administrator {
    if (-not (Test-IsAdministrator)) {
        throw 'Administrator privileges are required for -Mode Install or -Mode Remove. Re-run PowerShell as Administrator.'
    }
}

function Get-PolicyEntries {
    if (-not (Test-Path -LiteralPath $PolicyPath)) {
        return @()
    }

    $key = Get-Item -LiteralPath $PolicyPath
    $entries = foreach ($name in $key.GetValueNames()) {
        [pscustomobject]@{
            Name  = [string]$name
            Value = [string]$key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        }
    }

    return @($entries)
}

function Get-NextPolicySlot {
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$Entries
    )

    $usedNumbers = @{}
    foreach ($entry in $Entries) {
        $number = 0
        if ([int]::TryParse($entry.Name, [ref]$number) -and $number -ge 1) {
            $usedNumbers[$number] = $true
        }
    }

    $slot = 1
    while ($usedNumbers.ContainsKey($slot)) {
        $slot++
    }

    return [string]$slot
}

function Show-Status {
    $entries = @(Get-PolicyEntries)
    Write-Host "Chrome popup policy: $PolicyPath" -ForegroundColor Cyan
    Write-Host "Allowed exhibit origin: $AllowedOrigin" -ForegroundColor Cyan

    if ($entries.Count -eq 0) {
        Write-Host 'No policy entries found.' -ForegroundColor Yellow
        return
    }

    Write-Host 'Current entries:' -ForegroundColor Gray
    foreach ($entry in $entries) {
        $marker = if ($entry.Value -eq $AllowedOrigin) { ' (exhibit origin)' } else { '' }
        Write-Host "  $($entry.Name) = $($entry.Value)$marker"
    }

    $matchingEntries = @($entries | Where-Object { $_.Value -eq $AllowedOrigin })
    if ($matchingEntries.Count -gt 0) {
        Write-Host 'The exact localhost origin is configured.' -ForegroundColor Green
    } else {
        Write-Host 'The exact localhost origin is not configured.' -ForegroundColor Yellow
    }
}

function Install-Policy {
    Assert-Administrator
    $entries = @(Get-PolicyEntries)
    $matchingEntries = @($entries | Where-Object { $_.Value -eq $AllowedOrigin })

    if ($matchingEntries.Count -gt 0) {
        Write-Host 'The exact localhost origin is already configured; no registry changes were made.' -ForegroundColor Green
        return
    }

    if (-not (Test-Path -LiteralPath $PolicyPath)) {
        if (-not $PSCmdlet.ShouldProcess($PolicyPath, 'Create Chrome popup allowlist key')) {
            return
        }
        New-Item -Path $PolicyPath -Force | Out-Null
    }

    $slot = Get-NextPolicySlot -Entries $entries
    if ($PSCmdlet.ShouldProcess("$PolicyPath\$slot", "Allow $AllowedOrigin")) {
        New-ItemProperty -LiteralPath $PolicyPath -Name $slot -Value $AllowedOrigin -PropertyType String | Out-Null
        Write-Host "Added $AllowedOrigin as entry $slot." -ForegroundColor Green
        Write-Host 'Restart Chrome if the policy is not applied to an existing tab immediately.' -ForegroundColor Yellow
    }
}

function Remove-Policy {
    Assert-Administrator
    $entries = @(Get-PolicyEntries)
    $matchingEntries = @($entries | Where-Object { $_.Value -eq $AllowedOrigin })

    if ($matchingEntries.Count -eq 0) {
        Write-Host 'The exact localhost origin is not configured; no registry changes were made.' -ForegroundColor Yellow
        return
    }

    foreach ($entry in $matchingEntries) {
        if ($PSCmdlet.ShouldProcess("$PolicyPath\$($entry.Name)", "Remove $AllowedOrigin")) {
            Remove-ItemProperty -LiteralPath $PolicyPath -Name $entry.Name
            Write-Host "Removed entry $($entry.Name)." -ForegroundColor Green
        }
    }

    Write-Host 'Restart Chrome if the policy removal is not applied immediately.' -ForegroundColor Yellow
}

try {
    switch ($Mode) {
        'Install' { Install-Policy }
        'Remove'  { Remove-Policy }
        'Status'  { Show-Status }
    }
} catch {
    Write-Error $_
    exit 1
}
