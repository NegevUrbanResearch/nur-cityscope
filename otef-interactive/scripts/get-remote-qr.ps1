# === OTEF Remote QR Generator ===
# This script detects the local LAN IP and opens the QR code page for the remote controller.

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$QR_HTML = Join-Path $SCRIPT_DIR "..\frontend\qr.html"

# Get local IP address (Logic from setup.ps1)
$localIP = "localhost"
try {
    $networkAdapters = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.IPAddress -notlike "127.*" -and
            $_.IPAddress -notlike "169.254.*" -and
            $_.InterfaceAlias -notlike "*Loopback*"
        } |
        Sort-Object InterfaceIndex |
        Select-Object -First 1

    if ($networkAdapters) {
        $localIP = $networkAdapters.IPAddress
    }
} catch {
    # Fallback method
    $conf = Get-NetIPConfiguration -ErrorAction SilentlyContinue |
        Where-Object { $_.IPv4Address.IPAddress -notlike "127.*" -and $_.IPv4Address.IPAddress -notlike "169.254.*" } |
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
