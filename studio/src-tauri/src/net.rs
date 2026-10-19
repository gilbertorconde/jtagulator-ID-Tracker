//! Downloads for firmware updates (GitHub releases). Only https URLs on GitHub
//! hosts are allowed.

use std::io::Read;

const ALLOWED_HOSTS: &[&str] = &["api.github.com", "github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"];

fn check(url: &str) -> Result<(), String> {
    let rest = url.strip_prefix("https://").ok_or("Only https URLs are allowed")?;
    let host = rest.split(['/', '?', ':']).next().unwrap_or_default();
    if ALLOWED_HOSTS.contains(&host) {
        Ok(())
    } else {
        Err(format!("{host} is not an allowed download host"))
    }
}

/// GET a URL and return the body. `accept` sets the Accept header.
#[tauri::command]
pub async fn http_get(url: String, accept: Option<String>) -> Result<Vec<u8>, String> {
    check(&url)?;
    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq::AgentBuilder::new().redirects(5).build();
        let mut req = agent.get(&url).set("User-Agent", "JTAGulator-Studio");
        if let Some(a) = accept {
            req = req.set("Accept", &a);
        }
        let resp = req.call().map_err(|e| e.to_string())?;
        let mut body = Vec::new();
        resp.into_reader().take(16 * 1024 * 1024).read_to_end(&mut body).map_err(|e| e.to_string())?;
        Ok(body)
    })
    .await
    .map_err(|e| e.to_string())?
}
