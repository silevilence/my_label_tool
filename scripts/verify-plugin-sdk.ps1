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
    cargo run --quiet --manifest-path (Join-Path $repository "src-tauri/Cargo.toml") --bin plugin-validator -- (Join-Path $repository "examples/plugins/exporter-labelme-demo")

    $labelArchive = Join-Path $temporary "label-preset-demo.zip"
    $prelabelArchive = Join-Path $temporary "prelabel-demo.mlt-plugin"
    $exporterArchive = Join-Path $temporary "exporter-labelme-demo.zip"
    node (Join-Path $repository "scripts/package-plugin.mjs") (Join-Path $repository "examples/plugins/label-preset-demo") --output $labelArchive
    node (Join-Path $repository "scripts/package-plugin.mjs") (Join-Path $repository "examples/plugins/prelabel-demo") --output $prelabelArchive
    node (Join-Path $repository "scripts/package-plugin.mjs") (Join-Path $repository "examples/plugins/exporter-labelme-demo") --output $exporterArchive
    cargo run --quiet --manifest-path (Join-Path $repository "src-tauri/Cargo.toml") --bin plugin-validator -- $labelArchive
    cargo run --quiet --manifest-path (Join-Path $repository "src-tauri/Cargo.toml") --bin plugin-validator -- $prelabelArchive
    cargo run --quiet --manifest-path (Join-Path $repository "src-tauri/Cargo.toml") --bin plugin-validator -- $exporterArchive

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

            $exporterExample = Join-Path $repository "examples/plugins/exporter-labelme-demo/plugin/main.py"
            $exportHello = '{"v":1,"id":"hello-export","type":"request","method":"hello","params":{"protocolVersion":1,"hostApiVersion":1,"supportedVersions":{"hostApi":[1],"exporter":[1],"prelabel":[1]}}}'
            $exportCall = '{"v":1,"id":"export-verify","type":"request","method":"exporter.export","params":{"formatId":"labelme","exportData":{"labels":[{"id":"car","name":"汽车","color":"#38bdf8","shapeType":"rect"}],"images":[{"path":"images/a.jpg","name":"a.jpg","width":640,"height":480,"annotations":[{"id":"one","type":"rect","labelId":"car","points":[1,2,3,4]}]}]},"options":{},"outputBaseName":"annotations"}}'
            $exportResponses = @($exportHello, $exportCall) | & $python.Source $exporterExample | ForEach-Object { $_ | ConvertFrom-Json }
            $hello = $exportResponses | Where-Object { $_.id -eq "hello-export" } | Select-Object -First 1
            $result = $exportResponses | Where-Object { $_.id -eq "export-verify" -and $null -ne $_.result } | Select-Object -First 1
            if (-not $hello.result.capabilities.exporter -or $result.result.files[0].relativePath -ne "a.json") {
                throw "LabelMe exporter example failed hello or exporter.export"
            }
            $labelMe = $result.result.files[0].contentUtf8 | ConvertFrom-Json
            if ($labelMe.imagePath -ne "images/a.jpg" -or $labelMe.shapes[0].shape_type -ne "rectangle") {
                throw "LabelMe exporter example produced an invalid document"
            }

            $boundaryProbe = @'
import importlib.util
import io
import sys

spec = importlib.util.spec_from_file_location("labelme_exporter_example", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

status, line = module.read_protocol_line(io.BytesIO(b"x" * 8 + b"\r\n"), 8)
assert (status, line) == ("line", b"x" * 8)

stream = io.BytesIO(b"x" * 9 + b"\r\nnext\n")
assert module.read_protocol_line(stream, 8) == ("too-long", None)
assert module.read_protocol_line(stream, 8) == ("line", b"next")
'@
            $boundaryProbe | & $python.Source - $exporterExample
            if ($LASTEXITCODE -ne 0) {
                throw "LabelMe exporter example failed exact-limit CRLF recovery"
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
