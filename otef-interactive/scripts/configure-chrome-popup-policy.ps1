<#
.SYNOPSIS
    Configure Chrome for the local OTEF exhibit.

.DESCRIPTION
    Installs or removes the exact exhibit origin http://localhost:80 from the
    popup and autoplay allowlists. Other numbered allowlist entries remain
    unchanged.

    Install also adds --disable-features=CrossOriginOpenerPolicy to existing
    Google Chrome shortcuts so GIS can close the named NLI archive window.
    Chrome must be fully quit and started from an updated shortcut (or with
    that flag) before the close path works.

    Install and Remove require an elevated Windows PowerShell session for the
    HKLM Chrome policies. Shortcut updates use the current user when elevation
    is unavailable. Status is read-only and does not need elevation.

.PARAMETER Mode
    Install adds the localhost origin to the first unused numbered value in
    each allowlist and adds the Chrome launch flag to Google Chrome.lnk shortcuts.
    Remove removes entries whose value is exactly http://localhost:80 from both
    keys and removes the launch flag from those shortcuts.
    Status reports the current entries and shortcut flags without changing
    the registry.

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

$Policies = @(
    [pscustomobject]@{ Name = 'popup'; Path = 'HKLM:\Software\Policies\Google\Chrome\PopupsAllowedForUrls' },
    [pscustomobject]@{ Name = 'autoplay'; Path = 'HKLM:\Software\Policies\Google\Chrome\AutoplayAllowlist' }
)
$AllowedOrigin = 'http://localhost:80'
$ChromeFeature = 'CrossOriginOpenerPolicy'
$ChromeDisableFeatures = '--disable-features=CrossOriginOpenerPolicy'

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
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return @()
    }

    $key = Get-Item -LiteralPath $Path
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

function Get-ChromeShortcutPaths {
    return @(
        (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Google Chrome.lnk'),
        (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Google Chrome.lnk'),
        (Join-Path $env:USERPROFILE 'Desktop\Google Chrome.lnk'),
        (Join-Path $env:PUBLIC 'Desktop\Google Chrome.lnk'),
        (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Google Chrome.lnk')
    )
}

function Get-ShortcutArguments {
    param([Parameter(Mandatory)][string]$Path)

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($Path)
    $target = [string]$shortcut.TargetPath
    $arguments = [string]$shortcut.Arguments
    if ($target -notmatch '(?i)[\\/]chrome\.exe$') {
        return $null
    }
    return [pscustomobject]@{
        Path      = $Path
        Target    = $target
        Arguments = $arguments
        Shortcut  = $shortcut
        Shell     = $shell
    }
}

function Add-ChromeDisableFeature {
    param(
        [string]$Arguments,
        [Parameter(Mandatory)][string]$Feature
    )

    $trimmed = if ($null -eq $Arguments) { '' } else { $Arguments.Trim() }
    if ($trimmed -match '--disable-features=([^\s]+)') {
        $features = @($Matches[1] -split ',' | Where-Object { $_ })
        if ($features -contains $Feature) {
            return $trimmed
        }
        $features += $Feature
        return ($trimmed -replace '--disable-features=[^\s]+', ('--disable-features=' + ($features -join ','))).Trim()
    }
    if ($trimmed.Length -eq 0) {
        return "--disable-features=$Feature"
    }
    return "$trimmed --disable-features=$Feature"
}

function Remove-ChromeDisableFeature {
    param(
        [string]$Arguments,
        [Parameter(Mandatory)][string]$Feature
    )

    $trimmed = if ($null -eq $Arguments) { '' } else { $Arguments.Trim() }
    if ($trimmed -notmatch '--disable-features=([^\s]+)') {
        return $trimmed
    }
    $features = @($Matches[1] -split ',' | Where-Object { $_ -and $_ -ne $Feature })
    if ($features.Count -eq 0) {
        return ($trimmed -replace '\s*--disable-features=[^\s]+', '').Trim()
    }
    return ($trimmed -replace '--disable-features=[^\s]+', ('--disable-features=' + ($features -join ','))).Trim()
}

function Test-HasChromeFeature {
    param(
        [string]$Arguments,
        [Parameter(Mandatory)][string]$Feature
    )

    if ([string]::IsNullOrWhiteSpace($Arguments)) {
        return $false
    }
    if ($Arguments -notmatch '--disable-features=([^\s]+)') {
        return $false
    }
    return @($Matches[1] -split ',') -contains $Feature
}

function Save-ShortcutArguments {
    param(
        [Parameter(Mandatory)]$Info,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Arguments
    )

    $Info.Shortcut.Arguments = $Arguments
    $Info.Shortcut.Save()
}

function Install-ChromeLaunchFlag {
    $updated = 0
    foreach ($path in Get-ChromeShortcutPaths) {
        if (-not (Test-Path -LiteralPath $path)) {
            continue
        }
        $info = Get-ShortcutArguments -Path $path
        if ($null -eq $info) {
            continue
        }
        $next = Add-ChromeDisableFeature -Arguments $info.Arguments -Feature $ChromeFeature
        if ($next -eq $info.Arguments.Trim()) {
            Write-Host "Launch flag already present: $path" -ForegroundColor Green
            continue
        }
        if ($PSCmdlet.ShouldProcess($path, "Add $ChromeDisableFeatures")) {
            try {
                Save-ShortcutArguments -Info $info -Arguments $next
                Write-Host "Added $ChromeDisableFeatures to $path" -ForegroundColor Green
                $updated++
            } catch {
                Write-Host "Could not update $path : $_" -ForegroundColor Yellow
            }
        }
    }
    if ($updated -eq 0) {
        Write-Host "No Google Chrome.lnk shortcuts were changed. Start GIS Chrome with $ChromeDisableFeatures after a full Chrome quit." -ForegroundColor Yellow
    }
}

function Remove-ChromeLaunchFlag {
    foreach ($path in Get-ChromeShortcutPaths) {
        if (-not (Test-Path -LiteralPath $path)) {
            continue
        }
        $info = Get-ShortcutArguments -Path $path
        if ($null -eq $info) {
            continue
        }
        $next = Remove-ChromeDisableFeature -Arguments $info.Arguments -Feature $ChromeFeature
        if ($next -eq $info.Arguments.Trim()) {
            continue
        }
        if ($PSCmdlet.ShouldProcess($path, "Remove $ChromeDisableFeatures")) {
            try {
                Save-ShortcutArguments -Info $info -Arguments $next
                Write-Host "Removed $ChromeDisableFeatures from $path" -ForegroundColor Green
            } catch {
                Write-Host "Could not update $path : $_" -ForegroundColor Yellow
            }
        }
    }
}

function Show-LaunchFlagStatus {
    Write-Host "Chrome NLI close flag: $ChromeDisableFeatures" -ForegroundColor Cyan
    $found = $false
    foreach ($path in Get-ChromeShortcutPaths) {
        if (-not (Test-Path -LiteralPath $path)) {
            continue
        }
        $info = Get-ShortcutArguments -Path $path
        if ($null -eq $info) {
            continue
        }
        $found = $true
        $marker = if (Test-HasChromeFeature -Arguments $info.Arguments -Feature $ChromeFeature) {
            ' (flag present)'
        } else {
            ' (flag missing)'
        }
        Write-Host "  $path$marker"
        if (-not [string]::IsNullOrWhiteSpace($info.Arguments)) {
            Write-Host "    $($info.Arguments)" -ForegroundColor Gray
        }
    }
    if (-not $found) {
        Write-Host 'No Google Chrome.lnk shortcuts found.' -ForegroundColor Yellow
    }
    Write-Host 'Quit Chrome completely, then start GIS from an updated shortcut so the flag applies.' -ForegroundColor Yellow
}

function Show-Status {
    foreach ($policy in $Policies) {
        $entries = @(Get-PolicyEntries -Path $policy.Path)
        Write-Host "Chrome $($policy.Name) policy: $($policy.Path)" -ForegroundColor Cyan
        Write-Host "Allowed exhibit origin: $AllowedOrigin" -ForegroundColor Cyan

        if ($entries.Count -eq 0) {
            Write-Host 'No policy entries found.' -ForegroundColor Yellow
        } else {
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
    }
    Show-LaunchFlagStatus
}

function Install-Policy {
    foreach ($policy in $Policies) {
        $entries = @(Get-PolicyEntries -Path $policy.Path)
        $matchingEntries = @($entries | Where-Object { $_.Value -eq $AllowedOrigin })

        if ($matchingEntries.Count -gt 0) {
            Write-Host "The exact localhost origin is already configured for $($policy.Name)." -ForegroundColor Green
            continue
        }

        Assert-Administrator

        if (-not (Test-Path -LiteralPath $policy.Path)) {
            if (-not $PSCmdlet.ShouldProcess($policy.Path, "Create Chrome $($policy.Name) allowlist key")) {
                continue
            }
            New-Item -Path $policy.Path -Force | Out-Null
        }

        $slot = Get-NextPolicySlot -Entries $entries
        if ($PSCmdlet.ShouldProcess("$($policy.Path)\$slot", "Allow $AllowedOrigin")) {
            New-ItemProperty -LiteralPath $policy.Path -Name $slot -Value $AllowedOrigin -PropertyType String | Out-Null
            Write-Host "Added $AllowedOrigin as $($policy.Name) entry $slot." -ForegroundColor Green
            Write-Host 'Restart Chrome if the policy is not applied to an existing tab immediately.' -ForegroundColor Yellow
        }
    }
}

function Remove-Policy {
    Assert-Administrator
    foreach ($policy in $Policies) {
        $entries = @(Get-PolicyEntries -Path $policy.Path)
        $matchingEntries = @($entries | Where-Object { $_.Value -eq $AllowedOrigin })

        if ($matchingEntries.Count -eq 0) {
            Write-Host "The exact localhost origin is not configured for $($policy.Name)." -ForegroundColor Yellow
            continue
        }

        foreach ($entry in $matchingEntries) {
            if ($PSCmdlet.ShouldProcess("$($policy.Path)\$($entry.Name)", "Remove $AllowedOrigin")) {
                Remove-ItemProperty -LiteralPath $policy.Path -Name $entry.Name
                Write-Host "Removed $($policy.Name) entry $($entry.Name)." -ForegroundColor Green
            }
        }
    }

    Write-Host 'Restart Chrome if the policy removal is not applied immediately.' -ForegroundColor Yellow
}

try {
    switch ($Mode) {
        'Install' {
            Install-Policy
            Install-ChromeLaunchFlag
        }
        'Remove' {
            Remove-Policy
            Remove-ChromeLaunchFlag
        }
        'Status' { Show-Status }
    }
} catch {
    Write-Error $_
    exit 1
}
