use super::*;
use reqwest::{Client, StatusCode};

async fn fixture() -> (Arc<Host>, tempfile::TempDir, String, String) {
    let dir = tempfile::tempdir().unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let cfg = Config {
        enabled: true,
        address: "127.0.0.1".into(),
        port,
        token: config::secret().unwrap(),
    };
    config::save(&dir.path().join("mcp.json"), &cfg).unwrap();
    let host = Arc::new(Host::default());
    host.initialize(dir.path().join("mcp.json")).await;
    assert!(host.poll().unwrap().status.running);
    (host, dir, format!("http://127.0.0.1:{port}/mcp"), cfg.token)
}
fn request(url: &str, token: &str, value: Value) -> reqwest::RequestBuilder {
    Client::new()
        .post(url)
        .bearer_auth(token)
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .body(value.to_string())
}
async fn initialize(url: &str, token: &str, version: &str) -> String {
    let response=request(url,token,json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":version,"clientInfo":{"name":"conformance","version":"1"},"capabilities":{}}})).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let sid = response.headers()["mcp-session-id"]
        .to_str()
        .unwrap()
        .to_string();
    let v: Value = serde_json::from_str(&response.text().await.unwrap()).unwrap();
    assert_eq!(v["result"]["protocolVersion"], version);
    assert_eq!(
        request(
            url,
            token,
            json!({"jsonrpc":"2.0","method":"notifications/initialized"})
        )
        .header("mcp-session-id", &sid)
        .send()
        .await
        .unwrap()
        .status(),
        StatusCode::ACCEPTED
    );
    sid
}
#[tokio::test]
async fn auth_origin_session_discovery_and_real_bridge_roundtrip() {
    let (host, _dir, url, token) = fixture().await;
    let ping = json!({"jsonrpc":"2.0","id":2,"method":"ping"});
    assert_eq!(
        request(&url, "wrong", ping.clone())
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request(&url, &token, ping.clone())
            .header("origin", "https://evil.test")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(&url, &token, ping.clone())
            .header("host", "evil.test")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(&url, &token, ping.clone())
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );
    let sid = initialize(&url, &token, VERSIONS[2]).await;
    let response = request(
        &url,
        &token,
        json!({"jsonrpc":"2.0","id":3,"method":"tools/list"}),
    )
    .header("mcp-session-id", &sid)
    .send()
    .await
    .unwrap();
    assert!(response.text().await.unwrap().contains("app_state"));
    let call=request(&url,&token,json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"app_state","arguments":{}}})).header("mcp-session-id",&sid);
    let handle = tokio::spawn(async move { call.send().await.unwrap() });
    let call = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            if let Some(call) = host.poll().unwrap().calls.first() {
                break call.clone();
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    host.resolve(
        &call.id,
        json!({"content":[{"type":"text","text":"ok"}],"structuredContent":{"ready":true}}),
    )
    .unwrap();
    assert!(handle
        .await
        .unwrap()
        .text()
        .await
        .unwrap()
        .contains("ready"));
    assert_eq!(
        host.poll().unwrap().status.audit.last().unwrap().result,
        "OK"
    );
    assert_eq!(
        Client::new()
            .get(&url)
            .bearer_auth(&token)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::METHOD_NOT_ALLOWED
    );
    assert_eq!(
        Client::new()
            .delete(&url)
            .bearer_auth(&token)
            .header("mcp-session-id", &sid)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        request(&url, &token, ping)
            .header("mcp-session-id", sid)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    host.shutdown();
}
#[tokio::test]
async fn rotation_restart_limits_and_port_conflicts() {
    let (host, _dir, url, token) = fixture().await;
    let sid = initialize(&url, &token, VERSIONS[0]).await;
    let status = host.poll().unwrap().status;
    let new = host
        .configure(true, status.address.clone(), status.port, true)
        .await
        .unwrap();
    assert!(new.running);
    assert!(new.sessions.is_empty());
    assert_ne!(token, host.token().unwrap());
    assert_eq!(
        request(&url, &token, json!({}))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request(
            &url,
            &host.token().unwrap(),
            json!({"jsonrpc":"2.0","id":1,"method":"ping"})
        )
        .header("mcp-session-id", sid)
        .send()
        .await
        .unwrap()
        .status(),
        StatusCode::NOT_FOUND
    );
    let occupied = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    assert!(host
        .configure(
            true,
            status.address.clone(),
            occupied.local_addr().unwrap().port(),
            false
        )
        .await
        .is_err());
    assert!(host.poll().unwrap().status.error.is_some());
    assert!(
        host.configure(true, status.address, status.port, false)
            .await
            .unwrap()
            .running
    );
    let sid = initialize(&url, &host.token().unwrap(), VERSIONS[1]).await;
    host.lock().unwrap().sessions.get_mut(&sid).unwrap().count = 120;
    assert_eq!(
        request(
            &url,
            &host.token().unwrap(),
            json!({"jsonrpc":"2.0","id":1,"method":"ping"})
        )
        .header("mcp-session-id", sid)
        .send()
        .await
        .unwrap()
        .status(),
        StatusCode::TOO_MANY_REQUESTS
    );
    host.shutdown();
}
