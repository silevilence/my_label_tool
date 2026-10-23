use super::*;
use crate::github_proxy::test_support::{gateway, redirect};
use tauri::test::{mock_builder, mock_context, noop_assets};

const MANIFEST_PATH: &str = "/gateway/owner/app/releases/latest/download/latest.json";
const ASSET_PATH: &str = "/gateway/owner/app/releases/download/V99/update.exe";
const ASSET_URL: &str = "https://github.com/owner/app/releases/download/V99/update.exe";
const PAYLOAD: &[u8] = include_bytes!("fixtures/payload.txt");

fn app() -> tauri::App<tauri::test::MockRuntime> {
    let mut context = mock_context(noop_assets());
    context.config_mut().plugins.0.insert(
        "updater".into(),
        serde_json::json!({
            "endpoints": ["https://github.com/owner/app/releases/latest/download/latest.json"],
            "pubkey": include_str!("fixtures/public-key.txt").trim(),
            "dangerousInsecureTransportProtocol": true
        }),
    );
    let app = mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap();
    tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    app
}

fn manifest() -> Vec<u8> {
    manifest_for(ASSET_URL)
}

fn manifest_for(url: &str) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "version": "99.0.0", "notes": "### 更新说明", "url": url,
        "signature": include_str!("fixtures/payload.txt.sig").trim()
    }))
    .unwrap()
}

#[tokio::test]
async fn direct_github_and_api_asset_redirects_download_and_verify_signature() {
    // Resolve GitHub to loopback only in this test; exercise the real updater's
    // HTTP redirect callback and signature verification without internet access.
    for host in ["github.com", "api.github.com"] {
        let app = app();
        let webview = app.get_webview_window("main").unwrap().as_ref().clone();
        let (payload, payload_server) = gateway(PAYLOAD.to_vec(), "/gateway");
        let path = if host == "api.github.com" {
            "/repos/owner/app/releases/assets/668271883"
        } else {
            "/owner/app/releases/download/V99/update.exe"
        };
        let (asset, asset_server) = redirect(&payload.url, path);
        let local = reqwest::Url::parse(&asset.url).unwrap();
        let address = format!("127.0.0.1:{}", local.port().unwrap())
            .parse::<std::net::SocketAddr>()
            .unwrap();
        let url = format!("http://{host}:{}{path}", address.port());
        let (manifest, manifest_server) = gateway(manifest_for(&url), "/gateway");
        let update = webview
            .updater_builder()
            .configure_client(move |builder| {
                github_proxy::routing::updater_client(builder.no_proxy().resolve(host, address))
            })
            .endpoints(vec![manifest.url.parse().unwrap()])
            .unwrap()
            .build()
            .unwrap()
            .check()
            .await
            .unwrap()
            .unwrap();
        manifest_server.join().unwrap();
        let cached = register(&webview, update);
        let prepared = prepare_with_settings(&webview, cached.rid, &Default::default()).unwrap();
        let download = webview
            .resources_table()
            .get::<Update>(prepared.rid)
            .unwrap();
        let bytes = download.download(|_, _| {}, || {}).await;
        asset_server.join().unwrap();
        assert_eq!(bytes.unwrap(), PAYLOAD, "download from {host}");
        payload_server.join().unwrap();
    }
}

#[tokio::test]
async fn checks_via_gateway_downloads_via_new_gateway_and_verifies_signature() {
    let app = app();
    let webview = app.get_webview_window("main").unwrap().as_ref().clone();
    let (first, server) = gateway(manifest(), MANIFEST_PATH);
    let cached = check_with_settings(webview.clone(), &first)
        .await
        .unwrap()
        .unwrap();
    server.join().unwrap();
    assert_eq!(cached.version, "99.0.0");
    let original = webview.resources_table().get::<Update>(cached.rid).unwrap();
    assert_eq!(original.download_url.as_str(), ASSET_URL);
    let (next, server) = gateway(PAYLOAD.to_vec(), ASSET_PATH);
    let prepared = prepare_with_settings(&webview, cached.rid, &next).unwrap();
    let update = webview
        .resources_table()
        .get::<Update>(prepared.rid)
        .unwrap();
    let bytes = update.download(|_, _| {}, || {}).await.unwrap();
    server.join().unwrap();
    assert_eq!(bytes, PAYLOAD);
    webview.resources_table().close(prepared.rid).unwrap();
    // The original resource survives disposal of a download attempt.
    let cleared = prepare_with_settings(&webview, cached.rid, &Default::default()).unwrap();
    let cleared = webview
        .resources_table()
        .get::<Update>(cleared.rid)
        .unwrap();
    assert_eq!(cleared.download_url.as_str(), ASSET_URL);
    assert!(!cleared.no_proxy);
    let (tampered, server) = gateway(b"tampered update".to_vec(), ASSET_PATH);
    let tampered = prepare_with_settings(&webview, cached.rid, &tampered).unwrap();
    let tampered = webview
        .resources_table()
        .get::<Update>(tampered.rid)
        .unwrap();
    assert!(tampered.download(|_, _| {}, || {}).await.is_err());
    server.join().unwrap();
}

#[tokio::test]
async fn gateway_redirect_cannot_bypass_the_proxy_during_check_or_download() {
    let app = app();
    let webview = app.get_webview_window("main").unwrap().as_ref().clone();
    let (settings, server) = redirect("https://github.com/owner/app/latest.json", MANIFEST_PATH);
    assert!(check_with_settings(webview.clone(), &settings)
        .await
        .is_err());
    server.join().unwrap();
    let (settings, server) = gateway(manifest(), MANIFEST_PATH);
    let cached = check_with_settings(webview.clone(), &settings)
        .await
        .unwrap()
        .unwrap();
    server.join().unwrap();
    for target in [
        ASSET_URL,
        "https://api.github.com/repos/owner/app/releases/assets/668271883",
        "https://release-assets.githubusercontent.com/asset",
    ] {
        let (settings, server) = redirect(target, ASSET_PATH);
        let attempt = prepare_with_settings(&webview, cached.rid, &settings).unwrap();
        let update = webview
            .resources_table()
            .get::<Update>(attempt.rid)
            .unwrap();
        assert!(update.download(|_, _| {}, || {}).await.is_err());
        server.join().unwrap();
    }
}
