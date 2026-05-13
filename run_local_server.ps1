param(
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $PSScriptRoot).Path

function Get-MimeType([string]$Path) {
    switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        ".html" { "text/html; charset=utf-8"; break }
        ".htm"  { "text/html; charset=utf-8"; break }
        ".js"   { "text/javascript; charset=utf-8"; break }
        ".mjs"  { "text/javascript; charset=utf-8"; break }
        ".css"  { "text/css; charset=utf-8"; break }
        ".json" { "application/json; charset=utf-8"; break }
        ".wasm" { "application/wasm"; break }
        ".png"  { "image/png"; break }
        ".ico"  { "image/x-icon"; break }
        ".svg"  { "image/svg+xml"; break }
        ".srt"  { "text/plain; charset=utf-8"; break }
        default  { "application/octet-stream"; break }
    }
}

function Send-Response($Stream, [int]$StatusCode, [string]$Reason, [byte[]]$Body, [string]$ContentType) {
    $headers = @(
        "HTTP/1.1 $StatusCode $Reason",
        "Content-Type: $ContentType",
        "Content-Length: $($Body.Length)",
        "Cache-Control: no-store",
        "Connection: close",
        ""
    ) -join "`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers + "`r`n")
    $Stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($Body.Length -gt 0) {
        $Stream.Write($Body, 0, $Body.Length)
    }
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()
$url = "http://localhost:$Port/"
Write-Host "L'aor Dubber local server running at $url" -ForegroundColor Green
Write-Host "Serving folder: $Root"
Write-Host "Press Ctrl+C to stop."
Start-Process $url

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 4096, $true)
            $requestLine = $reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($requestLine)) {
                $client.Close()
                continue
            }

            while ($true) {
                $line = $reader.ReadLine()
                if ($null -eq $line -or $line -eq "") { break }
            }

            if ($requestLine -notmatch "^(GET|HEAD)\s+([^\s]+)") {
                $body = [System.Text.Encoding]::UTF8.GetBytes("Bad Request")
                Send-Response $stream 400 "Bad Request" $body "text/plain; charset=utf-8"
                $client.Close()
                continue
            }

            $method = $matches[1]
            $requestPath = $matches[2].Split("?")[0]
            $requestPath = [System.Uri]::UnescapeDataString($requestPath)
            if ($requestPath -eq "/") { $requestPath = "/index.html" }
            $relative = $requestPath.TrimStart("/").Replace("/", [System.IO.Path]::DirectorySeparatorChar)
            $fullPath = [System.IO.Path]::GetFullPath((Join-Path $Root $relative))

            if (-not $fullPath.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
                $body = [System.Text.Encoding]::UTF8.GetBytes("Forbidden")
                Send-Response $stream 403 "Forbidden" $body "text/plain; charset=utf-8"
            } elseif (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
                $body = [System.Text.Encoding]::UTF8.GetBytes("Not Found")
                Send-Response $stream 404 "Not Found" $body "text/plain; charset=utf-8"
            } else {
                $bytes = if ($method -eq "HEAD") { [byte[]]::new(0) } else { [System.IO.File]::ReadAllBytes($fullPath) }
                Send-Response $stream 200 "OK" $bytes (Get-MimeType $fullPath)
                Write-Host "$method $requestPath"
            }
        } catch {
            try {
                $body = [System.Text.Encoding]::UTF8.GetBytes("Server Error: $($_.Exception.Message)")
                Send-Response $stream 500 "Internal Server Error" $body "text/plain; charset=utf-8"
            } catch {}
        } finally {
            $client.Close()
        }
    }
} finally {
    $listener.Stop()
}
