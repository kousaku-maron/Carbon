use dom_query::Document;
use encoding_rs::{Encoding, UTF_8};
use std::{
    collections::HashSet,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    time::Duration,
};
use tauri_plugin_http::reqwest::{
    self,
    header::{ACCEPT, CONTENT_TYPE, LOCATION, USER_AGENT},
    redirect::Policy,
    Url,
};
use tokio::{net::lookup_host, time::timeout};

const FETCH_TIMEOUT: Duration = Duration::from_secs(8);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(6);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_REDIRECTS: usize = 5;
const MAX_HTML_BYTES: usize = 512 * 1024;
const MAX_TITLE_CHARS: usize = 300;

#[tauri::command]
pub async fn fetch_page_title(url: String) -> Result<Option<String>, String> {
    timeout(FETCH_TIMEOUT, fetch_page_title_inner(&url))
        .await
        .map_err(|_| "Page title request timed out".to_string())?
}

async fn fetch_page_title_inner(raw_url: &str) -> Result<Option<String>, String> {
    let mut current_url = validate_url(raw_url)?;

    for redirect_count in 0..=MAX_REDIRECTS {
        let client = build_client(&current_url).await?;
        let mut response = client
            .get(current_url.clone())
            .header(ACCEPT, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1")
            .header(USER_AGENT, concat!("Carbon/", env!("CARGO_PKG_VERSION")))
            .send()
            .await
            .map_err(|error| format!("Failed to fetch page: {error}"))?;

        if response.status().is_redirection() {
            if redirect_count == MAX_REDIRECTS {
                return Err("Page title request exceeded the redirect limit".to_string());
            }

            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| "Redirect response did not include a valid location".to_string())?;
            let redirected_url = current_url
                .join(location)
                .map_err(|_| "Redirect response contained an invalid URL".to_string())?;
            current_url = validate_url(redirected_url.as_str())?;
            continue;
        }

        if !response.status().is_success() {
            return Ok(None);
        }

        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        if !is_html_content_type(content_type.as_deref()) {
            return Ok(None);
        }

        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| format!("Failed to read page: {error}"))?
        {
            let remaining = MAX_HTML_BYTES.saturating_sub(bytes.len());
            if remaining == 0 {
                break;
            }

            if chunk.len() > remaining {
                bytes.extend_from_slice(&chunk[..remaining]);
                break;
            }

            bytes.extend_from_slice(&chunk);
        }

        let html = decode_html(&bytes, content_type.as_deref());
        return Ok(extract_title(&html));
    }

    Ok(None)
}

fn validate_url(raw_url: &str) -> Result<Url, String> {
    let mut url = Url::parse(raw_url).map_err(|_| "Invalid page URL".to_string())?;

    if !matches!(url.scheme(), "http" | "https") {
        return Err("Only HTTP and HTTPS URLs can provide page titles".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("URLs containing credentials are not supported".to_string());
    }
    if url.host_str().is_none() {
        return Err("Page URL does not include a host".to_string());
    }
    if url.port_or_known_default() == Some(0) {
        return Err("Page URL contains an invalid port".to_string());
    }

    url.set_fragment(None);
    Ok(url)
}

async fn build_client(url: &Url) -> Result<reqwest::Client, String> {
    let host = url
        .host_str()
        .ok_or_else(|| "Page URL does not include a host".to_string())?;
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "Page URL does not include a valid port".to_string())?;

    let mut builder = reqwest::Client::builder()
        .redirect(Policy::none())
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .no_proxy();

    if let Ok(ip) = host.parse::<IpAddr>() {
        if !is_public_ip(ip) {
            return Err("Page URL resolves to a non-public address".to_string());
        }
    } else {
        let addresses = lookup_public_addresses(host, port).await?;
        builder = builder.resolve_to_addrs(host, &addresses);
    }

    builder
        .build()
        .map_err(|error| format!("Failed to create page title client: {error}"))
}

async fn lookup_public_addresses(host: &str, port: u16) -> Result<Vec<SocketAddr>, String> {
    let addresses: HashSet<_> = lookup_host((host, port))
        .await
        .map_err(|_| "Failed to resolve page host".to_string())?
        .collect();

    if addresses.is_empty() {
        return Err("Page host did not resolve to an address".to_string());
    }
    if addresses.iter().any(|address| !is_public_ip(address.ip())) {
        return Err("Page URL resolves to a non-public address".to_string());
    }

    Ok(addresses.into_iter().collect())
}

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_public_ipv4(ip),
        IpAddr::V6(ip) => is_public_ipv6(ip),
    }
}

fn is_public_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, c, d] = ip.octets();

    !(a == 0
        || a == 10
        || a == 127
        || (a == 100 && (64..=127).contains(&b))
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 168)
        || (a == 192 && b == 0 && c == 0 && !matches!(d, 9 | 10))
        || (a == 192 && b == 0 && c == 2)
        || (a == 198 && matches!(b, 18 | 19))
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113)
        || a >= 224)
}

fn is_public_ipv6(ip: Ipv6Addr) -> bool {
    let segments = ip.segments();

    // Public website hosts use global unicast space (2000::/3). Exclude the
    // documentation and benchmarking blocks that also fall inside that range.
    if segments[0] & 0xe000 != 0x2000 {
        return false;
    }
    if matches!(segments, [0x2001, 0x0002, 0, ..])
        || matches!(segments, [0x2001, 0x0db8, ..])
        || (segments[0] == 0x3fff && segments[1] & 0xf000 == 0)
    {
        return false;
    }

    true
}

fn is_html_content_type(content_type: Option<&str>) -> bool {
    let Some(content_type) = content_type else {
        return true;
    };
    let media_type = content_type.split(';').next().unwrap_or_default().trim();

    media_type.eq_ignore_ascii_case("text/html")
        || media_type.eq_ignore_ascii_case("application/xhtml+xml")
}

fn decode_html(bytes: &[u8], content_type: Option<&str>) -> String {
    let encoding = charset_from_content_type(content_type)
        .or_else(|| charset_from_html_prefix(bytes))
        .and_then(|label| Encoding::for_label(label.as_bytes()))
        .unwrap_or(UTF_8);
    let (decoded, _, _) = encoding.decode(bytes);
    decoded.into_owned()
}

fn charset_from_content_type(content_type: Option<&str>) -> Option<String> {
    content_type?
        .split(';')
        .skip(1)
        .find_map(|parameter| {
            let (name, value) = parameter.trim().split_once('=')?;
            name.eq_ignore_ascii_case("charset")
                .then(|| value.trim().trim_matches(['\'', '"']).to_string())
        })
        .filter(|value| !value.is_empty())
}

fn charset_from_html_prefix(bytes: &[u8]) -> Option<String> {
    let prefix = &bytes[..bytes.len().min(8192)];
    let ascii = String::from_utf8_lossy(prefix).to_ascii_lowercase();
    let mut remainder = ascii.as_str();

    while let Some(index) = remainder.find("charset") {
        remainder = &remainder[index + "charset".len()..];
        let Some(after_equals) = remainder.trim_start().strip_prefix('=') else {
            continue;
        };
        let after_equals = after_equals.trim_start();
        let value = after_equals
            .strip_prefix('\'')
            .or_else(|| after_equals.strip_prefix('"'))
            .unwrap_or(after_equals);
        let label: String = value
            .chars()
            .take_while(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
            })
            .collect();

        if !label.is_empty() {
            return Some(label);
        }
        remainder = after_equals;
    }

    None
}

fn extract_title(html: &str) -> Option<String> {
    let document = Document::from(html);
    let title = document.select("title").first().text().to_string();
    normalize_title(&title)
}

fn normalize_title(title: &str) -> Option<String> {
    let normalized = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return None;
    }

    let mut characters = normalized.chars();
    let title: String = characters.by_ref().take(MAX_TITLE_CHARS).collect();
    Some(if characters.next().is_some() {
        format!("{title}…")
    } else {
        title
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_and_normalizes_document_title() {
        let html = r#"
            <html>
              <head>
                <meta property="og:title" content="Fallback title">
                <title>  Carbon &amp; Notes
                  App  </title>
              </head>
            </html>
        "#;

        assert_eq!(extract_title(html).as_deref(), Some("Carbon & Notes App"));
    }

    #[test]
    fn ignores_metadata_when_document_title_is_missing() {
        let html = r#"<meta property="og:title" content="Carbon &amp; Notes">"#;

        assert_eq!(extract_title(html), None);
    }

    #[test]
    fn ignores_an_empty_document_title() {
        assert_eq!(extract_title("<title>  </title>"), None);
    }

    #[test]
    fn reads_charset_from_headers_and_html() {
        assert_eq!(
            charset_from_content_type(Some("text/html; charset=Shift_JIS")).as_deref(),
            Some("Shift_JIS")
        );
        assert_eq!(
            charset_from_html_prefix(br#"<meta charset='euc-jp'>"#).as_deref(),
            Some("euc-jp")
        );
    }

    #[test]
    fn rejects_non_http_and_credential_urls() {
        assert!(validate_url("file:///tmp/private.html").is_err());
        assert!(validate_url("https://user:password@example.com").is_err());
        assert!(validate_url("https://example.com/page#section").is_ok());
    }

    #[test]
    fn rejects_private_and_special_ip_ranges() {
        for ip in [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.0.1",
            "169.254.1.1",
            "100.64.0.1",
            "::1",
            "fe80::1",
            "fc00::1",
        ] {
            assert!(!is_public_ip(ip.parse().unwrap()), "{ip} must be rejected");
        }

        assert!(is_public_ip("8.8.8.8".parse().unwrap()));
        assert!(is_public_ip("2606:4700:4700::1111".parse().unwrap()));
    }
}
