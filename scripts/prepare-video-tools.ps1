$ErrorActionPreference = 'Stop'
$destination = Join-Path $PSScriptRoot '../src-tauri/video-tools'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
foreach ($name in @('ffmpeg', 'ffprobe')) {
    $command = Get-Command "$name.exe" -ErrorAction Stop
    $source = Get-Item -LiteralPath $command.Source
    if ($source.Target) { $source = Get-Item -LiteralPath $source.Target }
    # Chocolatey PATH entries can be shim executables; bundle the actual distribution.
    if ($env:ChocolateyInstall -and $source.DirectoryName -eq (Join-Path $env:ChocolateyInstall 'bin')) {
        $source = Get-ChildItem -Path (Join-Path $env:ChocolateyInstall 'lib/ffmpeg') -Filter "$name.exe" -Recurse |
            Where-Object { $_.Directory.Name -eq 'bin' } | Select-Object -First 1
        if (-not $source) { throw "Cannot locate the FFmpeg distribution behind the Chocolatey shim." }
    }
    Copy-Item -LiteralPath $source.FullName -Destination (Join-Path $destination "$name.exe") -Force
    $distribution = Split-Path (Split-Path $source.FullName)
    $license = Join-Path $distribution 'LICENSE'
    if (-not (Test-Path -LiteralPath $license)) { throw "FFmpeg distribution must include LICENSE: $license" }
    Copy-Item -LiteralPath $license -Destination (Join-Path $destination 'LICENSE-FFmpeg.txt') -Force
    & $source.FullName -version | Select-Object -First 3 | Set-Content (Join-Path $destination "$name-version.txt")
}
# Use the base .NET API so packaging also works in Windows PowerShell hosts
# where Microsoft.PowerShell.Utility does not expose Get-FileHash.
$checksums = foreach ($binary in Get-ChildItem -LiteralPath $destination -Filter '*.exe') {
    $stream = [System.IO.File]::OpenRead($binary.FullName)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = [System.BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '')
        [PSCustomObject]@{ Hash = $hash; File = $binary.Name }
    } finally {
        $sha256.Dispose()
        $stream.Dispose()
    }
}
$checksums | ConvertTo-Json | Set-Content (Join-Path $destination 'checksums.json')
