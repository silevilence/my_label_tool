# Bundled Lua host

`scripts/prepare-script-host.ps1` builds `label-script-host.exe` here before a desktop production build.
The complete directory is bundled as a Tauri resource. Do not commit the generated binary.
Development uses the separate crate's debug target. See `docs/scripting-user.md`.
