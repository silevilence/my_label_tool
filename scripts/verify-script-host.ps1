param(
    [switch]$Container,
    [string]$Engine = 'podman',
    [string]$Image = 'localhost/label-script-host:qa',
    [string]$Executable = ''
)
$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$repo = Split-Path -Parent $PSScriptRoot
if (-not $Executable) { $Executable = Join-Path $repo 'src-tauri/script-tools/label-script-host.exe' }
$catalog = ConvertFrom-Json ([IO.File]::ReadAllText((Join-Path $repo 'examples/scripts/catalog.json')))
foreach ($entry in $catalog) {
    $sample = $entry.id
    $source = [IO.File]::ReadAllText((Join-Path $repo "examples/scripts/$sample.lua"))
    $labels = @(
        @{id='generated-vehicle'; name='车辆'; color='#fff'; shapeType='rect'},
        @{id='generated-car'; name='汽车'; color='#fff'; shapeType='rect'}
    )
    $images = @(0..1 | ForEach-Object {
        @{path="image-$_.png"; name="image-$_.png"; annotations=@(@{id="shape-$_"; labelId='generated-vehicle'; type='rect'; points=@(-1,2,30,40); frameIndex=0})}
    })
    if ($entry.includeDimensions) {
        foreach ($sampleImage in $images) { $sampleImage['size'] = @{width=100; height=80} }
    }
    $messages = @(
        @{op='hello'; version=1; limits=@{maxMemoryMiB=256; timeoutSeconds=30}},
        @{op='section'; name='labels'; items=$labels},
        @{op='section'; name='images'; items=$images},
        @{op='execute'; source=$source}
    ) | ForEach-Object { ConvertTo-Json -InputObject $_ -Compress -Depth 32 }
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true

    $start.StandardOutputEncoding = [System.Text.UTF8Encoding]::new($false)
    if ($Container) {
        if ($Image -notmatch '^[a-zA-Z0-9._:/-]+$') { throw 'Invalid container image name' }
        $start.FileName = $Engine
        $start.Arguments = "run --rm -i --network none --read-only --cap-drop ALL --security-opt no-new-privileges $Image"
    } else { $start.FileName = $Executable }
    $process = [System.Diagnostics.Process]::Start($start)
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    $bytes = [Text.Encoding]::UTF8.GetBytes(($messages -join "`n") + "`n")
    $process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
    $process.StandardInput.Close()
    if (-not $process.WaitForExit(35000)) { $process.Kill(); throw "$sample verifier timed out" }
    $output = $stdout.GetAwaiter().GetResult()
    $diagnostics = $stderr.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) { throw "$sample host exit: $($process.ExitCode) $diagnostics" }
    $lines = @($output -split "`r?`n" | Where-Object { $_.Trim() })
    $process.Dispose()
    $events = @($lines | ForEach-Object { ConvertFrom-Json $_ })
    if ($events[-1].event -ne 'done' -or @($events | Where-Object event -eq 'failed').Count -gt 0) { throw "$sample failed: $lines" }
    $results = @($events | Where-Object event -eq 'result')
    $expectedResults = if ($sample -in @('submit', 'reassign', 'coordinates', 'numbering')) { 2 } else { 0 }
    if ($results.Count -ne $expectedResults) { throw "$sample expected $expectedResults image results" }
    if ($expectedResults -eq 0 -and @($events | Where-Object event -eq 'log').Count -eq 0) { throw "$sample expected log output" }
    switch ($sample) {
        'submit' { if ($results[0].annotations[0].attributes.reviewed -ne $true) { throw 'Attribute submission failed' } }
        'progress' { if (@($events | Where-Object { $_.event -eq 'progress' -and $_.completed -eq 2 -and $_.total -eq 2 }).Count -eq 0) { throw 'Progress reporting failed' } }
        'reassign' { if ($results[0].annotations[0].labelId -ne 'generated-car') { throw 'Label resolution failed' } }
        'coordinates' { if ($results[0].annotations[0].points[0] -ne 0) { throw 'Coordinate correction failed' } }
        'numbering' { if ($results[1].annotations[0].attributes.sequence -ne 2) { throw 'Cross-image numbering failed' } }
    }
    Write-Output "PASS $sample (2 images; $(@('desktop','container')[[int][bool]$Container]))"
}
