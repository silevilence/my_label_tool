$ErrorActionPreference = "Stop"

$repository = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$temporary = [System.IO.Path]::GetFullPath((Join-Path $temporaryRoot ("my-label-tool-plugin-sdk-" + [Guid]::NewGuid().ToString("N"))))
if (-not $temporary.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or
    -not ([System.IO.Path]::GetFileName($temporary)).StartsWith("my-label-tool-plugin-sdk-", [StringComparison]::Ordinal)) {
    throw "Refusing to use an unsafe verification directory: $temporary"
}
New-Item -ItemType Directory -Path $temporary | Out-Null

try {
    cargo run --quiet --manifest-path (Join-Path $repository "src-tauri/Cargo.toml") --bin plugin-validator -- (Join-Path $repository "examples/plugins/label-preset-demo")
    cargo run --quiet --manifest-path (Join-Path $repository "src-tauri/Cargo.toml") --bin plugin-validator -- (Join-Path $repository "examples/plugins/prelabel-demo")

    $labelArchive = Join-Path $temporary "label-preset-demo.zip"
    $prelabelArchive = Join-Path $temporary "prelabel-demo.mlt-plugin"
    node (Join-Path $repository "scripts/package-plugin.mjs") (Join-Path $repository "examples/plugins/label-preset-demo") --output $labelArchive
    node (Join-Path $repository "scripts/package-plugin.mjs") (Join-Path $repository "examples/plugins/prelabel-demo") --output $prelabelArchive
    cargo run --quiet --manifest-path (Join-Path $repository "src-tauri/Cargo.toml") --bin plugin-validator -- $labelArchive
    cargo run --quiet --manifest-path (Join-Path $repository "src-tauri/Cargo.toml") --bin plugin-validator -- $prelabelArchive

    $extensionSource = Join-Path $temporary "extension-source"
    Copy-Item -Recurse (Join-Path $repository "examples/plugins/label-preset-demo") $extensionSource
    $extensionArchive = (node (Join-Path $repository "scripts/package-plugin.mjs") $extensionSource --extension .mlt-plugin | Select-Object -Last 1)
    if ([System.IO.Path]::GetExtension($extensionArchive) -ne ".mlt-plugin" -or -not (Test-Path -LiteralPath $extensionArchive)) {
        throw "package-plugin.mjs did not honor --extension"
    }

    $invalid = Join-Path $temporary "invalid-source"
    Copy-Item -Recurse (Join-Path $repository "examples/plugins/label-preset-demo") $invalid
    Set-Content -LiteralPath (Join-Path $invalid "unexpected.txt") -Value "must be rejected"

    $unsafeName = Join-Path $temporary "unsafe-name-source"
    Copy-Item -Recurse (Join-Path $repository "examples/plugins/label-preset-demo") $unsafeName
    $unsafeManifestPath = Join-Path $unsafeName "manifest.json"
    $unsafeManifest = Get-Content -Raw -LiteralPath $unsafeManifestPath | ConvertFrom-Json
    $unsafeManifest.id = "../escape"
    [System.IO.File]::WriteAllText($unsafeManifestPath, ($unsafeManifest | ConvertTo-Json -Depth 20), (New-Object System.Text.UTF8Encoding($false)))

    $oversized = Join-Path $temporary "oversized-source"
    Copy-Item -Recurse (Join-Path $repository "examples/plugins/label-preset-demo") $oversized
    $oversizedFile = [System.IO.File]::Create((Join-Path $oversized "labels.json"))
    try {
        $oversizedFile.SetLength((50 * 1024 * 1024) + 1)
    }
    finally {
        $oversizedFile.Dispose()
    }

    $previousErrorPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        node (Join-Path $repository "scripts/package-plugin.mjs") $invalid --output (Join-Path $temporary "invalid.zip") 2>$null
        $invalidExitCode = $LASTEXITCODE
        node (Join-Path $repository "scripts/package-plugin.mjs") $unsafeName --output (Join-Path $temporary "unsafe.zip") 2>$null
        $unsafeNameExitCode = $LASTEXITCODE
        node (Join-Path $repository "scripts/package-plugin.mjs") $oversized --output (Join-Path $temporary "oversized.zip") 2>$null
        $oversizedExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorPreference
    }
    if ($invalidExitCode -eq 0 -or $unsafeNameExitCode -eq 0 -or $oversizedExitCode -eq 0) {
        throw "package-plugin.mjs accepted an invalid package source"
    }

    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($null -ne $python) {
        $previousErrorPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = "Continue"
            $pythonVersion = ((& $python.Source --version 2>&1) | Out-String).Trim()
        }
        finally {
            $ErrorActionPreference = $previousErrorPreference
        }
        if ($pythonVersion -match '^Python 3\.') {
            $pythonExample = Join-Path $repository "examples/plugins/prelabel-demo/plugin/main.py"
            $helloRequest = '{"v":1,"id":"hello-verify","type":"request","method":"hello","params":{"protocolVersion":1,"hostApiVersion":1,"supportedVersions":{"hostApi":[1],"exporter":[1],"prelabel":[1]}}}'
            $helloResponse = ($helloRequest | & $python.Source $pythonExample | Select-Object -First 1 | ConvertFrom-Json)
            if ($helloResponse.id -ne "hello-verify" -or -not $helloResponse.result.capabilities.prelabel) {
                throw "Python example failed hello negotiation"
            }
            $badVersionRequest = '{"v":1,"id":"bad-version","type":"request","method":"hello","params":{"protocolVersion":1,"hostApiVersion":2,"supportedVersions":{"hostApi":[2],"prelabel":[1]}}}'
            $badVersionResponse = ($badVersionRequest | & $python.Source $pythonExample | Select-Object -First 1 | ConvertFrom-Json)
            if ($badVersionResponse.error.code -ne "API_VERSION_UNSUPPORTED") {
                throw "Python example accepted an unsupported host API"
            }
            $shapeResponse = ('[]' | & $python.Source $pythonExample | Select-Object -First 1 | ConvertFrom-Json)
            if ($shapeResponse.error.code -ne "PROTOCOL_ERROR") {
                throw "Python example misclassified a non-object message"
            }
        }
    }

    cargo test --quiet --manifest-path (Join-Path $repository "src-tauri/Cargo.toml") --test plugin_conformance
}
finally {
    if (Test-Path -LiteralPath $temporary) {
        Remove-Item -LiteralPath $temporary -Recurse -Force
    }
}
