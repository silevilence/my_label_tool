$ErrorActionPreference = "Stop"

npm test -- --run src/lib/importers.test.ts src/lib/app-utils.test.ts src/lib/plugin-config-migration.test.ts src/types/plugin-protocol.test.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

cargo test --manifest-path src-tauri/Cargo.toml plugins::config_tests
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

cargo test --manifest-path src-tauri/Cargo.toml migration
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
