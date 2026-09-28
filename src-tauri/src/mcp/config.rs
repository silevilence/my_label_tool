use super::text;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::{net::IpAddr, path::Path};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub enabled: bool,
    pub address: String,
    pub port: u16,
    pub token: String,
}
pub fn secret() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(text::failed)?;
    Ok(bytes.iter().map(|v| format!("{v:02x}")).collect())
}
pub fn validate(address: &str, port: u16) -> Result<IpAddr, String> {
    let ip: IpAddr = address.parse().map_err(|_| text::LOOPBACK.to_string())?;
    if !ip.is_loopback() || port == 0 {
        return Err(text::LOOPBACK.into());
    }
    Ok(ip)
}
pub fn load(path: &Path) -> Result<Config, String> {
    if !path.exists() {
        let config = Config {
            enabled: true,
            address: "127.0.0.1".into(),
            port: 1421,
            token: secret()?,
        };
        save(path, &config)?;
        return Ok(config);
    }
    let config: Config =
        serde_json::from_str(&crate::text_read::read(path)?).map_err(text::failed)?;
    validate(&config.address, config.port)?;
    if config.token.len() != 64 || !config.token.bytes().all(|v| v.is_ascii_hexdigit()) {
        return Err(text::INVALID.into());
    }
    Ok(config)
}
pub fn save(path: &Path, config: &Config) -> Result<(), String> {
    let parent = path.parent().ok_or(text::INVALID)?;
    std::fs::create_dir_all(parent).map_err(text::failed)?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(text::failed)?;
    file.write_all(&serde_json::to_vec_pretty(config).map_err(text::failed)?)
        .map_err(text::failed)?;
    file.as_file().sync_all().map_err(text::failed)?;
    file.persist(path).map_err(text::failed)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn credentials_persist_and_only_loopback_is_allowed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mcp.json");
        let mut value = load(&path).unwrap();
        assert_eq!(value.token, load(&path).unwrap().token);
        let previous = value.token.clone();
        value.token = secret().unwrap();
        save(&path, &value).unwrap();
        assert_ne!(previous, load(&path).unwrap().token);
        assert!(validate("0.0.0.0", 1421).is_err());
        assert!(validate("::", 1421).is_err());
        assert!(validate("127.0.0.1", 0).is_err());
        assert!(validate("::1", 1421).is_ok());
    }
}
