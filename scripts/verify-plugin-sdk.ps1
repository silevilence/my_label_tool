$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Assert-NativeSuccess {
    param([Parameter(Mandatory = $true)][string]$Name)
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE"
    }
}

function Invoke-PythonWithUtf8Input {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string[]]$InputLines
    )

    $inputPath = [System.IO.Path]::GetTempFileName()
    try {
        [System.IO.File]::WriteAllLines(
            $inputPath,
            $InputLines,
            (New-Object System.Text.UTF8Encoding($false))
        )
        $quotedArguments = (($Arguments | ForEach-Object {
                    '"' + $_.Replace('"', '""') + '"'
                }) -join ' ')
        $command = '""' + $Executable.Replace('"', '""') + '" ' + $quotedArguments +
            ' < "' + $inputPath.Replace('"', '""') + '""'

        $startInfo = New-Object System.Diagnostics.ProcessStartInfo
        $startInfo.FileName = $env:ComSpec
        $startInfo.Arguments = "/d /s /c $command"
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true
        $startInfo.EnvironmentVariables["PYTHONDONTWRITEBYTECODE"] = "1"

        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = $startInfo
        if (-not $process.Start()) {
            throw "Failed to start Python executable: $Executable"
        }

        try {
            $stdout = $process.StandardOutput.ReadToEnd()
            $stderr = $process.StandardError.ReadToEnd()
            $process.WaitForExit()
            if ($process.ExitCode -ne 0) {
                throw "Python process exited with code $($process.ExitCode): $stderr"
            }
            return @($stdout -split "`r?`n" | Where-Object { $_.Length -gt 0 })
        }
        finally {
            $process.Dispose()
        }
    }
    finally {
        Remove-Item -LiteralPath $inputPath -Force -ErrorAction SilentlyContinue
    }
}

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
    Assert-NativeSuccess "label-preset directory validation"
    cargo run --quiet --manifest-path (Join-Path $repository "src-tauri/Cargo.toml") --bin plugin-validator -- (Join-Path $repository "examples/plugins/prelabel-demo")
    Assert-NativeSuccess "prelabel directory validation"
    cargo run --quiet --manifest-path (Join-Path $repository "src-tauri/Cargo.toml") --bin plugin-validator -- (Join-Path $repository "examples/plugins/exporter-labelme-demo")
    Assert-NativeSuccess "exporter directory validation"

    $labelArchive = Join-Path $temporary "label-preset-demo.zip"
    $prelabelArchive = Join-Path $temporary "prelabel-demo.mlt-plugin"
    $exporterArchive = Join-Path $temporary "exporter-labelme-demo.zip"
    node (Join-Path $repository "scripts/package-plugin.mjs") (Join-Path $repository "examples/plugins/label-preset-demo") --output $labelArchive
    Assert-NativeSuccess "label-preset packaging"
    node (Join-Path $repository "scripts/package-plugin.mjs") (Join-Path $repository "examples/plugins/prelabel-demo") --output $prelabelArchive
    Assert-NativeSuccess "prelabel packaging"
    node (Join-Path $repository "scripts/package-plugin.mjs") (Join-Path $repository "examples/plugins/exporter-labelme-demo") --output $exporterArchive
    Assert-NativeSuccess "exporter packaging"
    cargo run --quiet --manifest-path (Join-Path $repository "src-tauri/Cargo.toml") --bin plugin-validator -- $labelArchive
    Assert-NativeSuccess "label-preset archive validation"
    cargo run --quiet --manifest-path (Join-Path $repository "src-tauri/Cargo.toml") --bin plugin-validator -- $prelabelArchive
    Assert-NativeSuccess "prelabel archive validation"
    cargo run --quiet --manifest-path (Join-Path $repository "src-tauri/Cargo.toml") --bin plugin-validator -- $exporterArchive
    Assert-NativeSuccess "exporter archive validation"

    $extensionSource = Join-Path $temporary "extension-source"
    Copy-Item -Recurse (Join-Path $repository "examples/plugins/label-preset-demo") $extensionSource
    $extensionArchive = (node (Join-Path $repository "scripts/package-plugin.mjs") $extensionSource --extension .mlt-plugin | Select-Object -Last 1)
    Assert-NativeSuccess "custom-extension packaging"
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
    if ($null -eq $python) {
        throw "Python 3 is required to verify the executable plugin examples"
    }
    else {
        $previousErrorPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = "Continue"
            $pythonVersion = ((& $python.Source --version 2>&1) | Out-String).Trim()
            $pythonVersionExitCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $previousErrorPreference
        }
        if ($pythonVersionExitCode -ne 0 -or $pythonVersion -notmatch '^Python 3\.') {
            throw "Python 3 probe failed: $pythonVersion"
        }
        else {
            # Resolve past a pyenv-win .bat shim, then write protocol input with
            # an explicit BOM-less stream. Windows PowerShell 5 otherwise adds
            # a UTF-8 BOM to a native-process pipeline.
            $pythonExecutable = ((& $python.Source -c "import sys; print(sys.executable)") | Select-Object -First 1).Trim()
            Assert-NativeSuccess "Python executable resolution"
            if (-not (Test-Path -LiteralPath $pythonExecutable -PathType Leaf)) {
                throw "Python executable could not be resolved from $($python.Source)"
            }
            $pythonExample = Join-Path $repository "examples/plugins/prelabel-demo/plugin/main.py"
            $helloRequest = '{"v":1,"id":"hello-verify","type":"request","method":"hello","params":{"protocolVersion":1,"hostApiVersion":1,"supportedVersions":{"hostApi":[1],"exporter":[1],"prelabel":[1]}}}'
            $helloResponse = (Invoke-PythonWithUtf8Input $pythonExecutable @($pythonExample) @($helloRequest) | Select-Object -First 1 | ConvertFrom-Json)
            if ($helloResponse.id -ne "hello-verify" -or -not $helloResponse.result.capabilities.prelabel) {
                $helloDiagnostic = $helloResponse | ConvertTo-Json -Depth 10 -Compress
                throw "Python example failed hello negotiation: $helloDiagnostic"
            }
            $badVersionRequest = '{"v":1,"id":"bad-version","type":"request","method":"hello","params":{"protocolVersion":1,"hostApiVersion":2,"supportedVersions":{"hostApi":[2],"prelabel":[1]}}}'
            $badVersionResponse = (Invoke-PythonWithUtf8Input $pythonExecutable @($pythonExample) @($badVersionRequest) | Select-Object -First 1 | ConvertFrom-Json)
            if ($badVersionResponse.error.code -ne "API_VERSION_UNSUPPORTED") {
                throw "Python example accepted an unsupported host API"
            }
            $shapeResponse = (Invoke-PythonWithUtf8Input $pythonExecutable @($pythonExample) @('[]') | Select-Object -First 1 | ConvertFrom-Json)
            if ($shapeResponse.error.code -ne "PROTOCOL_ERROR") {
                throw "Python example misclassified a non-object message"
            }

            $exporterExample = Join-Path $repository "examples/plugins/exporter-labelme-demo/plugin/main.py"
            $exportHello = '{"v":1,"id":"hello-export","type":"request","method":"hello","params":{"protocolVersion":1,"hostApiVersion":1,"supportedVersions":{"hostApi":[1],"exporter":[1],"prelabel":[1]}}}'
            $exportCall = '{"v":1,"id":"export-verify","type":"request","method":"exporter.export","params":{"formatId":"labelme","exportData":{"labels":[{"id":"car","name":"汽车","color":"#38bdf8","shapeType":"rect"}],"images":[{"path":"images/a.jpg","name":"a.jpg","width":640,"height":480,"annotations":[{"id":"one","type":"rect","labelId":"car","points":[1,2,3,4]}]}]},"options":{},"outputBaseName":"annotations"}}'
            $exportResponses = Invoke-PythonWithUtf8Input $pythonExecutable @($exporterExample) @($exportHello, $exportCall) | ForEach-Object { $_ | ConvertFrom-Json }
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
            Invoke-PythonWithUtf8Input $pythonExecutable @('-', $exporterExample) @($boundaryProbe -split "`r?`n") | Out-Null
        }
    }

    cargo test --quiet --manifest-path (Join-Path $repository "src-tauri/Cargo.toml") --test plugin_conformance
    Assert-NativeSuccess "plugin conformance"
}
finally {
    if (Test-Path -LiteralPath $temporary) {
        Remove-Item -LiteralPath $temporary -Recurse -Force
    }
}
