/// Disable browser commands at the native layer, including when a text field or
/// modal owns focus. Application shortcuts and basic text editing remain available.
pub fn configure(_app: &tauri::App) -> tauri::Result<()> {
    #[cfg(windows)]
    {
        use tauri::Manager;
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
        use windows_core::Interface;
        if let Some(window) = _app.get_webview_window("main") {
            window.with_webview(|webview| {
                let result = (|| -> windows_core::Result<()> {
                    unsafe {
                        let settings = webview.controller().CoreWebView2()?.Settings()?;
                        settings
                            .cast::<ICoreWebView2Settings3>()?
                            .SetAreBrowserAcceleratorKeysEnabled(false)?;
                    }
                    Ok(())
                })();
                if let Err(error) = result {
                    eprintln!("{}", crate::i18n::recovery_zh_cn::failed(error));
                }
            })?;
        }
    }
    Ok(())
}
