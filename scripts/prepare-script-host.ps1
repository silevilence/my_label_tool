param([switch]$DebugBuild)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$manifest = Join-Path $repo 'src-tauri/script-host/Cargo.toml'
$arguments = @('build', '--locked', '--manifest-path', $manifest, '--bin', 'label-script-host')
if (-not $DebugBuild) { $arguments += '--release' }
& cargo @arguments
if ($LASTEXITCODE -ne 0) { throw 'Lua script host build failed.' }
if (-not $DebugBuild) {
    $destination = Join-Path $repo 'src-tauri/script-tools'
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    Copy-Item -LiteralPath (Join-Path $repo 'src-tauri/script-host/target/release/label-script-host.exe') -Destination (Join-Path $destination 'label-script-host.exe') -Force
}
