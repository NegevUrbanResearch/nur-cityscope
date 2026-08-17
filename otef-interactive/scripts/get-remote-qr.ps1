# === OTEF Remote QR Generator ===
# This script detects the local LAN IP and opens the QR code page for the remote controller.

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$QR_HTML = Join-Path $SCRIPT_DIR "..\frontend\qr.html"

# Prefer a phone-reachable Wi-Fi/Ethernet address. Lowest InterfaceIndex is often
# Tailscale / WSL / VMware, which a phone on lab Wi-Fi cannot open.
$virtualAliasPatterns = @(
    "*Loopback*", "*Tailscale*", "*WSL*", "*Hyper-V*", "*vEthernet*",
    "*VMware*", "*VMnet*", "*VirtualBox*", "*Docker*"
)
function Test-VirtualLanAlias([string]$alias) {
    foreach ($pattern in $virtualAliasPatterns) {
        if ($alias -like $pattern) { return $true }
    }
    return $false
}
function Test-TailscaleCgnat([string]$ip) {
    $parts = $ip.Split(".")
    if ($parts.Count -lt 2) { return $false }
    $a = [int]$parts[0]
    $b = [int]$parts[1]
    return ($a -eq 100 -and $b -ge 64 -and $b -le 127)
}

$localIP = "localhost"
try {
    $candidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.IPAddress -notlike "127.*" -and
            $_.IPAddress -notlike "169.254.*" -and
            -not (Test-TailscaleCgnat $_.IPAddress) -and
            -not (Test-VirtualLanAlias $_.InterfaceAlias)
        }

    $preferred = $candidates |
        Where-Object {
            $_.InterfaceAlias -like "*Wi-Fi*" -or
            $_.InterfaceAlias -like "*WiFi*" -or
            $_.InterfaceAlias -like "*Ethernet*"
        } |
        Select-Object -First 1

    if ($preferred) {
        $localIP = $preferred.IPAddress
    } elseif ($candidates) {
        $localIP = ($candidates | Select-Object -First 1).IPAddress
    }
} catch {
    $conf = Get-NetIPConfiguration -ErrorAction SilentlyContinue |
        Where-Object {
            $_.IPv4Address.IPAddress -notlike "127.*" -and
            $_.IPv4Address.IPAddress -notlike "169.254.*" -and
            -not (Test-TailscaleCgnat $_.IPv4Address.IPAddress) -and
            -not (Test-VirtualLanAlias $_.InterfaceAlias)
        } |
        Select-Object -First 1
    if ($conf -and $conf.IPv4Address) {
        $localIP = $conf.IPv4Address.IPAddress
    }
}

Write-Host "Detected Local IP: $localIP" -ForegroundColor Green
Write-Host "Opening QR code page..." -ForegroundColor Cyan

# Open in default browser via the local web server (Nginx).
# This avoids issues with the file:// protocol stripping parameters.
$url = "http://localhost/otef-interactive/qr.html?ip=$localIP"

Write-Host "URL: $url" -ForegroundColor Gray
Start-Process $url
