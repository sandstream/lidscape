//! Looks for a newer Lidscape among the releases on GitHub, as Lyssna does. Only the
//! list of releases is fetched: nothing about the user is sent. The page can turn it off.

use serde::{Deserialize, Serialize};

const RELEASES: &str = "https://api.github.com/repos/sandstream/lidscape/releases";
/// Only pages in the Lidscape repository are opened from the app.
pub const PAGE_PREFIX: &str = "https://github.com/sandstream/lidscape/releases/";

#[derive(Debug, Deserialize)]
pub struct Release {
    pub tag_name: String,
    pub html_url: String,
    #[serde(default)]
    pub draft: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Update {
    pub version: String,
    pub url: String,
}

fn version(v: &str) -> Option<(u32, u32, u32)> {
    let mut parts = v.trim().trim_start_matches('v').split('.').map(|p| p.parse::<u32>().ok());
    let v = (parts.next()??, parts.next()??, parts.next()??);
    parts.next().is_none().then_some(v)
}

/// The newest release that is newer than `current`, or None. Pre-releases count, so a
/// test version reaches the testers. Drafts and tags that are not x.y.z do not.
pub fn newest(current: &str, releases: &[Release]) -> Option<Update> {
    let now = version(current)?;
    releases
        .iter()
        .filter(|r| !r.draft && r.html_url.starts_with(PAGE_PREFIX) && !r.html_url.chars().any(char::is_whitespace))
        .filter_map(|r| version(&r.tag_name).map(|v| (v, r)))
        .filter(|(v, _)| *v > now)
        .max_by_key(|(v, _)| *v)
        .map(|((a, b, c), r)| Update { version: format!("{a}.{b}.{c}"), url: r.html_url.clone() })
}

/// Asks GitHub for the releases. Short timeouts: the check must never hold anything up.
pub fn check(current: &str) -> anyhow::Result<Option<Update>> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_connect(Some(std::time::Duration::from_secs(5)))
        .timeout_global(Some(std::time::Duration::from_secs(15)))
        .build()
        .into();
    let releases: Vec<Release> = agent
        .get(RELEASES)
        .header("User-Agent", "Lidscape")
        .header("Accept", "application/vnd.github+json")
        .call()?
        .body_mut()
        .read_json()?;
    Ok(newest(current, &releases))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rel(tag: &str, draft: bool) -> Release {
        Release { tag_name: tag.into(), html_url: format!("{PAGE_PREFIX}tag/{tag}"), draft }
    }

    #[test]
    fn finds_the_newest_newer_release() {
        let list = [rel("v0.1.2", false), rel("v0.1.10", false), rel("v0.1.7", false), rel("v0.2.0", true), rel("nightly", false)];
        assert_eq!(newest("0.1.6", &list), Some(Update { version: "0.1.10".into(), url: format!("{PAGE_PREFIX}tag/v0.1.10") }));
        assert_eq!(newest("0.1.10", &list), None);
        assert_eq!(newest("0.2.0", &list), None);
    }

    #[test]
    fn ignores_links_outside_the_repository() {
        let list = [
            Release { tag_name: "v9.0.0".into(), html_url: "https://example.com/lidscape".into(), draft: false },
            Release { tag_name: "v9.0.1".into(), html_url: "https://github.com/sandstream/lidscape-releases/releases/tag/v9.0.1".into(), draft: false },
            Release { tag_name: "v9.0.2".into(), html_url: format!("{PAGE_PREFIX}tag/v9 --x"), draft: false },
        ];
        assert_eq!(newest("0.1.0", &list), None);
    }

    #[test]
    fn reads_the_github_answer() {
        let json = r#"[{"tag_name":"v0.1.1","html_url":"https://github.com/sandstream/lidscape/releases/tag/v0.1.1","prerelease":true,"assets":[]}]"#;
        let list: Vec<Release> = serde_json::from_str(json).unwrap();
        assert_eq!(newest("0.1.0", &list).unwrap().version, "0.1.1");
    }

    #[test]
    #[ignore = "asks GitHub: cargo test --lib update -- --ignored"]
    fn asks_github() {
        let u = check("0.0.1").unwrap().expect("a published release newer than 0.0.1");
        assert!(u.url.starts_with(PAGE_PREFIX), "{u:?}");
        assert_eq!(check("999.0.0").unwrap(), None);
    }
}
