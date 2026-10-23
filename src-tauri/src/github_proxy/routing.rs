use super::Settings;
use crate::i18n::zh_cn as text;
use reqwest::{redirect::Policy, ClientBuilder, Url};

pub struct Route {
    pub url: Url,
    pub proxied: bool,
}

impl Settings {
    pub fn route(&self, source: &str) -> Result<Route, String> {
        let source = Url::parse(source.trim()).map_err(text::github_proxy_failed)?;
        let normal_port = match source.scheme() {
            "http" => source.port_or_known_default() == Some(80),
            "https" => source.port_or_known_default() == Some(443),
            _ => false,
        };
        let tail = if normal_port && source.username().is_empty() && source.password().is_none() {
            match source.host_str() {
                Some("github.com") => Some(source.path().trim_start_matches('/').to_owned()),
                Some("raw.githubusercontent.com") => {
                    let mut parts = source.path().trim_start_matches('/').splitn(3, '/');
                    match (parts.next(), parts.next(), parts.next()) {
                        (Some(owner), Some(repo), Some(rest))
                            if !owner.is_empty() && !repo.is_empty() && !rest.is_empty() =>
                        {
                            Some(format!("{owner}/{repo}/raw/{rest}"))
                        }
                        _ => None,
                    }
                }
                _ => None,
            }
        } else {
            None
        };
        if let Some(tail) = tail.filter(|_| !self.url.is_empty()) {
            let mut url =
                Url::parse(&format!("{}/{tail}", self.url)).map_err(text::github_proxy_failed)?;
            url.set_query(source.query());
            Ok(Route { url, proxied: true })
        } else {
            Ok(Route {
                url: source,
                proxied: false,
            })
        }
    }
}

impl Route {
    pub fn client(&self, builder: ClientBuilder) -> ClientBuilder {
        if self.proxied {
            // The gateway follows upstream redirects. Never escape back to GitHub or a CDN.
            builder.no_proxy().redirect(gateway_redirects(false))
        } else {
            builder
        }
    }
}

/// Updater clones retain this callback; inspect each request's original URL, so a
/// cached update can switch gateways (or clear the gateway) before downloading.
pub fn updater_client(builder: ClientBuilder) -> ClientBuilder {
    builder
        .connect_timeout(std::time::Duration::from_secs(10))
        .read_timeout(std::time::Duration::from_secs(120))
        .redirect(gateway_redirects(true))
}

fn gateway_redirects(detect_direct: bool) -> Policy {
    Policy::custom(move |attempt| {
        if attempt.previous().len() >= 10 {
            return attempt.error(text::GITHUB_PROXY_REDIRECT_LIMIT);
        }
        let Some(first) = attempt.previous().first() else {
            return attempt.stop();
        };
        // Release manifests may contain API asset URLs; these also redirect to
        // GitHub's asset CDN. Classify by the first URL, never the redirect target.
        let direct = detect_direct
            && matches!(
                first.host_str(),
                Some(
                    "github.com"
                        | "api.github.com"
                        | "raw.githubusercontent.com"
                        | "release-assets.githubusercontent.com"
                        | "objects.githubusercontent.com"
                )
            );
        if direct || first.origin() == attempt.url().origin() {
            attempt.follow()
        } else {
            attempt.error(text::GITHUB_PROXY_REDIRECT_REJECTED)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn routes_github_releases_and_raw_paths_without_touching_other_sources() {
        let settings = Settings {
            url: "http://localhost:8719/prefix/github".into(),
        };
        for (source, suffix) in [
            (
                "https://github.com/owner/repo/releases/latest/download/latest.json",
                "owner/repo/releases/latest/download/latest.json",
            ),
            (
                "https://github.com/owner/repo/releases/download/V1/a%20b.exe?x=1",
                "owner/repo/releases/download/V1/a%20b.exe?x=1",
            ),
            (
                "https://raw.githubusercontent.com/owner/repo/main/model.onnx",
                "owner/repo/raw/main/model.onnx",
            ),
        ] {
            let route = settings.route(source).unwrap();
            assert!(route.proxied);
            assert_eq!(route.url.as_str(), format!("{}/{suffix}", settings.url));
            assert_eq!(
                Settings::default().route(source).unwrap().url.as_str(),
                source
            );
        }
        for source in [
            "https://models.example/model.onnx",
            "https://github.com.evil.example/model.onnx",
            "http://localhost:8719/prefix/github/o/r/file",
            "https://api.github.com/repos/o/r",
            "https://github.com:8443/o/r",
            "https://raw.githubusercontent.com/owner",
        ] {
            let route = settings.route(source).unwrap();
            assert!(!route.proxied);
            assert_eq!(route.url.as_str(), source);
        }
    }
}
