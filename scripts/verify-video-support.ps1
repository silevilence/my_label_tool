$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    npm run typecheck
    if ($LASTEXITCODE) { throw 'Typecheck failed' }
    npm run lint
    if ($LASTEXITCODE) { throw 'Lint failed' }
    npm run test:coverage -- --maxWorkers=4
    if ($LASTEXITCODE) { throw 'Frontend tests or coverage failed' }
    cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
    if ($LASTEXITCODE) { throw 'Clippy failed' }
    cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=4
    if ($LASTEXITCODE) { throw 'Rust tests failed' }
    cargo test --manifest-path src-tauri/Cargo.toml real_video_extract_reload_cancel_and_failure_cleanup -- --ignored
    if ($LASTEXITCODE) { throw 'Real video extraction tests failed' }
    npm run build
    if ($LASTEXITCODE) { throw 'Frontend production build failed' }
} finally {
    Pop-Location
}
