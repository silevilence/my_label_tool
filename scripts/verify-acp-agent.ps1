param(
    [Parameter(Mandatory=$true)][string]$Executable,
    [string]$ArgumentsJson = '["acp"]',
    [string]$Toolchain = 'stable'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $repo '.local-script-qa'
[IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
$env:ACP_REAL_PROGRAM = $Executable
$env:ACP_REAL_ARGS = $ArgumentsJson
$env:ACP_REAL_OUTPUT = Join-Path $outputDirectory 'acp-real-result.json'
$env:ACP_LUA_HOST = Join-Path $repo 'src-tauri/script-host/target/debug/label-script-host.exe'
try {
    cargo "+$Toolchain" build --locked --manifest-path (Join-Path $repo 'src-tauri/script-host/Cargo.toml')
    if ($LASTEXITCODE -ne 0) { throw 'Lua host build failed' }
    cargo "+$Toolchain" test --manifest-path (Join-Path $repo 'src-tauri/Cargo.toml') --test acp_real_agent -- --ignored --nocapture
    if ($LASTEXITCODE -ne 0) { throw 'Real ACP Agent acceptance failed' }
    Write-Output "PASS real ACP Agent and Lua host; evidence: $env:ACP_REAL_OUTPUT"
} finally {
    Remove-Item Env:ACP_REAL_PROGRAM, Env:ACP_REAL_ARGS, Env:ACP_REAL_OUTPUT, Env:ACP_LUA_HOST -ErrorAction SilentlyContinue
}
