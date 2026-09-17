use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::path::PathBuf;
use std::str::FromStr;

use axum::http::{HeaderMap, Method, Uri};
use serde::Serialize;

use crate::NcxResult;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    #[default]
    Local,
    Http,
    Https,
}

impl FromStr for Mode {
    type Err = String;
    fn from_str(value: &str) -> NcxResult<Self> {
        match value.to_ascii_lowercase().as_str() {
            "local" => Ok(Self::Local),
            "http" => Ok(Self::Http),
            "https" => Ok(Self::Https),
            _ => Err("mode must be local, HTTP, or HTTPS".to_owned()),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SshAuth {
    #[default]
    Key,
    Password,
}

impl FromStr for SshAuth {
    type Err = String;
    fn from_str(value: &str) -> NcxResult<Self> {
        match value {
            "key" => Ok(Self::Key),
            "password" => Ok(Self::Password),
            _ => Err("ssh-auth must be key or password".to_owned()),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum HostKeys {
    #[default]
    Strict,
    AcceptNew,
    Insecure,
}

impl FromStr for HostKeys {
    type Err = String;
    fn from_str(value: &str) -> NcxResult<Self> {
        match value {
            "strict" => Ok(Self::Strict),
            "accept-new" => Ok(Self::AcceptNew),
            "insecure" => Ok(Self::Insecure),
            _ => Err("host-key-policy must be strict, accept-new, or insecure".to_owned()),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct HubPolicy {
    pub mode: Mode,
    pub auth: SshAuth,
    pub host_keys: HostKeys,
    pub known_hosts: Option<PathBuf>,
    pub trusted_proxy: Option<Ipv4Addr>,
    pub public_origin: Option<String>,
}

impl HubPolicy {
    pub fn validate(&self, listen: SocketAddrV4) -> NcxResult<()> {
        if self.mode == Mode::Local && !listen.ip().is_loopback() {
            return Err("local hub mode requires a loopback listener".to_owned());
        }
        if let Some(path) = &self.known_hosts {
            if !path.is_file()
                || path
                    .to_str()
                    .is_none_or(|path| path.chars().any(char::is_control))
            {
                return Err("known-hosts must name a readable regular file".to_owned());
            }
            std::fs::File::open(path)
                .map_err(|error| format!("cannot read known-hosts: {error}"))?;
        }
        if self.mode == Mode::Https {
            if self.auth != SshAuth::Key || self.host_keys != HostKeys::Strict {
                return Err(
                    "HTTPS mode requires key authentication and strict host keys".to_owned(),
                );
            }
            if self
                .trusted_proxy
                .is_none_or(|ip| ip.is_unspecified() || ip.is_multicast())
            {
                return Err("HTTPS mode requires --trusted-proxy IPv4".to_owned());
            }
            let origin = self
                .public_origin
                .as_deref()
                .ok_or("HTTPS mode requires --public-origin")?;
            let uri: Uri = origin.parse().map_err(|_| "invalid public origin")?;
            if uri.scheme_str() != Some("https")
                || uri.authority().is_none()
                || uri.authority().is_some_and(|a| a.as_str().contains('@'))
                || !matches!(uri.path(), "" | "/")
                || uri.query().is_some()
                || origin.ends_with('/')
            {
                return Err("public-origin must be an HTTPS origin without a path".to_owned());
            }
        } else if self.trusted_proxy.is_some() || self.public_origin.is_some() {
            return Err("proxy options require HTTPS mode".to_owned());
        }
        Ok(())
    }

    /// Only the configured transport peer may attest TLS and authentication.
    pub fn accepts_proxy(
        &self,
        peer: Option<SocketAddr>,
        method: &Method,
        headers: &HeaderMap,
    ) -> bool {
        if self.mode != Mode::Https {
            return true;
        }
        let Some(proxy) = self.trusted_proxy else {
            return false;
        };
        if peer.map(|peer| peer.ip()) != Some(std::net::IpAddr::V4(proxy)) {
            return false;
        }
        let header = |name| headers.get(name).and_then(|value| value.to_str().ok());
        let Some(origin) = self.public_origin.as_deref() else {
            return false;
        };
        header("x-forwarded-proto") == Some("https")
            && header("x-ncx-authenticated") == Some("1")
            && header("host") == origin.strip_prefix("https://")
            && (matches!(*method, Method::GET | Method::HEAD) || header("origin") == Some(origin))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modes_have_distinct_listener_and_ssh_contracts() {
        let listen = "0.0.0.0:8765".parse().unwrap();
        assert!(HubPolicy::default().validate(listen).is_err());
        let http = HubPolicy {
            mode: Mode::Http,
            auth: SshAuth::Password,
            ..Default::default()
        };
        assert!(http.validate(listen).is_ok());
        let mut https = HubPolicy {
            mode: Mode::Https,
            trusted_proxy: Some(Ipv4Addr::LOCALHOST),
            public_origin: Some("https://viewer.example".into()),
            ..Default::default()
        };
        assert!(https.validate(listen).is_ok());
        https.host_keys = HostKeys::Insecure;
        assert!(https.validate(listen).is_err());
        https.host_keys = HostKeys::Strict;
        https.auth = SshAuth::Password;
        assert!(https.validate(listen).is_err());
    }

    #[test]
    fn forwarded_headers_do_not_replace_peer_authentication() {
        let policy = HubPolicy {
            mode: Mode::Https,
            trusted_proxy: Some(Ipv4Addr::LOCALHOST),
            public_origin: Some("https://viewer.example".into()),
            ..Default::default()
        };
        let mut headers = HeaderMap::new();
        for (name, value) in [
            ("host", "viewer.example"),
            ("origin", "https://viewer.example"),
            ("x-forwarded-proto", "https"),
            ("x-ncx-authenticated", "1"),
        ] {
            headers.insert(name, value.parse().unwrap());
        }
        assert!(policy.accepts_proxy(
            Some("127.0.0.1:1234".parse().unwrap()),
            &Method::POST,
            &headers
        ));
        assert!(!policy.accepts_proxy(
            Some("192.0.2.1:1234".parse().unwrap()),
            &Method::POST,
            &headers
        ));
        assert!(!policy.accepts_proxy(None, &Method::POST, &headers));
        headers.remove("x-ncx-authenticated");
        assert!(!policy.accepts_proxy(
            Some("127.0.0.1:1234".parse().unwrap()),
            &Method::GET,
            &headers
        ));
    }
}
