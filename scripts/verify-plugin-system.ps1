param(
    [string]$LogPath = "target/plugin-system-verification.log"
)

$ErrorActionPreference = "Stop"
$repository = Split-Path -Parent $PSScriptRoot
$resolvedLog = [System.IO.Path]::GetFullPath((Join-Path $repository $LogPath))
$logDirectory = Split-Path -Parent $resolvedLog
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-VerificationOutput {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Value)

    $rendered = $Value | Out-String
    [System.IO.File]::AppendAllText($resolvedLog, $rendered, $utf8NoBom)
    Write-Output $Value
}

function Invoke-Checked {
    param(
        [string]$Name,
        [string]$RequiredPattern = "",
        [scriptblock]$Command
    )

    Write-VerificationOutput @("`n=== $Name ===")
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $output = & $Command 2>&1
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorAction
    Write-VerificationOutput $output
    if ($exitCode -ne 0) {
        throw "$Name failed with exit code $exitCode"
    }
    if ($RequiredPattern -and -not (($output | Out-String) -match $RequiredPattern)) {
        throw "$Name did not execute the required test scenario"
    }
}

Push-Location $repository
[System.IO.File]::WriteAllText(
    $resolvedLog,
    "Plugin system verification started: $([DateTime]::Now.ToString('o'))`r`n",
    $utf8NoBom
)
try {
    Invoke-Checked "Bad plugin isolation" "test result: ok\. [1-9][0-9]* passed;" {
        cargo test --manifest-path src-tauri/Cargo.toml timeout_crash_and_garbage_remove_the_session -- --nocapture
    }
    Invoke-Checked "Permission denial" "test result: ok\. [1-9][0-9]* passed;" {
        cargo test --manifest-path src-tauri/Cargo.toml file_proxy_returns_only_authorized_content_and_denies_outside_paths -- --nocapture
    }
    Invoke-Checked "OS file and network isolation" "test result: ok\. [1-9][0-9]* passed;" {
        cargo test --manifest-path src-tauri/Cargo.toml appcontainer_denies_direct_file_escape_and_unauthorized_network -- --nocapture
    }
    Invoke-Checked "System Python isolation and environment sanitization" "test result: ok\. [1-9][0-9]* passed;" {
        cargo test --manifest-path src-tauri/Cargo.toml appcontainer_runs_system_python_without_host_secrets -- --nocapture
    }
    Invoke-Checked "Offline process environment" "test result: ok\. [1-9][0-9]* passed;" {
        cargo test --manifest-path src-tauri/Cargo.toml command_environment_removes_all_proxy_spellings_and_sets_offline_flags -- --nocapture
    }
    Invoke-Checked "Timeout process cleanup" "test result: ok\. [1-9][0-9]* passed;" {
        cargo test --manifest-path src-tauri/Cargo.toml timeout_terminates_the_parent_and_descendant_processes -- --nocapture
    }
    Invoke-Checked "Cancellation process cleanup" "test result: ok\. [1-9][0-9]* passed;" {
        cargo test --manifest-path src-tauri/Cargo.toml cancellation_aware_prelabel_can_return_partial_result_before_termination -- --nocapture
    }
    Invoke-Checked "Automatic disable and recovery" "test result: ok\. [1-9][0-9]* passed;" {
        cargo test --manifest-path src-tauri/Cargo.toml failures_auto_disable_and_a_later_success_clears_the_counter -- --nocapture
    }
    Invoke-Checked "Safe mode" "test result: ok\. [1-9][0-9]* passed;" {
        cargo test --manifest-path src-tauri/Cargo.toml safe_mode_rejects_code_plugins_but_keeps_label_presets_available -- --nocapture
    }
    Invoke-Checked "Configuration migration failure and retry" "test result: ok\. [1-9][0-9]* passed;" {
        cargo test --manifest-path src-tauri/Cargo.toml plugins::config_tests -- --nocapture
    }
    Invoke-Checked "Uninstall cleanup" "test result: ok\. [1-9][0-9]* passed;" {
        cargo test --manifest-path src-tauri/Cargo.toml uninstall_removes_only_package_and_registry_entry -- --nocapture
    }
    Invoke-Checked "Update preserves grants and triggers migration" "test result: ok\. [1-9][0-9]* passed;" {
        cargo test --manifest-path src-tauri/Cargo.toml update_preserves_install_time_and_marks_changed_config_for_migration -- --nocapture
    }
    Invoke-Checked "Plugin state persistence" "test result: ok\. [1-9][0-9]* passed;" {
        cargo test --manifest-path src-tauri/Cargo.toml enable_disable_status_and_failure_clear_round_trip -- --nocapture
    }
    Invoke-Checked "Plugin lifecycle restart" "test result: ok\. [1-9][0-9]* passed;" {
        cargo test --manifest-path src-tauri/Cargo.toml enabled_label_presets_restore_after_restart_and_follow_plugin_lifecycle -- --nocapture
    }
    Invoke-Checked -Name "SDK examples packaging and conformance" -Command {
        powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-plugin-sdk.ps1
    }
    Invoke-Checked "Plugin UI acceptance" "Tests  3 passed" {
        npm test -- --run src/components/settings/plugin-ui.acceptance.test.tsx
    }
    Invoke-Checked -Name "Frontend typecheck" -Command { npm run typecheck }
    Invoke-Checked -Name "Frontend lint" -Command { npm run lint }
    Invoke-Checked -Name "Frontend coverage" -Command { npm run test:coverage }
    Invoke-Checked -Name "Rust clippy" -Command { cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings }
    Invoke-Checked -Name "Rust full test suite" -Command { cargo test --manifest-path src-tauri/Cargo.toml }
    Write-VerificationOutput @("`nPLUGIN SYSTEM VERIFICATION: PASS")
    Write-VerificationOutput @("Log: $resolvedLog")
} finally {
    Pop-Location
}
