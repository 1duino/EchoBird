//! Cursor account identity, browser authorization, and Windows Electron safeStorage.
#[cfg(windows)]
use aes_gcm::KeyInit;
use aes_gcm::{aead::Aead, Aes256Gcm, Nonce};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use rand::RngCore;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs, path::Path, sync::Mutex, time::Duration};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub email: String,
    pub active: bool,
    pub usage: Option<super::cursor_usage::Usage>,
}

#[derive(Clone)]
struct Pending {
    id: String,
    verifier: String,
    expires: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginStart {
    login_id: String,
    verification_uri: String,
    expires_at: i64,
}

pub(super) fn read<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    serde_json::from_slice(&fs::read(path).map_err(|_| "accountError.read")?)
        .map_err(|_| "accountError.format".into())
}
pub(super) fn write(path: &Path, value: &impl Serialize) -> Result<(), String> {
    use std::io::Write;
    fs::create_dir_all(path.parent().ok_or("accountError.write")?)
        .map_err(|_| "accountError.write")?;
    let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp).map_err(|_| "accountError.write")?;
        file.write_all(&serde_json::to_vec_pretty(value).map_err(|_| "accountError.format")?)
            .map_err(|_| "accountError.write")?;
        file.sync_all().map_err(|_| "accountError.write")?;
        drop(file);
        fs::rename(&temp, path).map_err(|_| "accountError.write".to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

pub(super) fn cipher(dir: &Path) -> Result<Aes256Gcm, String> {
    #[cfg(windows)]
    {
        use windows::Win32::{
            Foundation::{LocalFree, HLOCAL},
            Security::Cryptography::{
                CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
            },
        };
        let state: Value = read(&dir.join("Local State"))?;
        let encoded = state["os_crypt"]["encrypted_key"]
            .as_str()
            .ok_or("accountError.keychain")?;
        let wrapped = STANDARD
            .decode(encoded)
            .map_err(|_| "accountError.keychain")?;
        let key = wrapped
            .strip_prefix(b"DPAPI")
            .ok_or("accountError.keychain")?;
        let input = CRYPT_INTEGER_BLOB {
            cbData: key.len().try_into().map_err(|_| "accountError.keychain")?,
            pbData: key.as_ptr().cast_mut(),
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        // DPAPI owns output; copy into the cipher before releasing it with LocalFree.
        unsafe {
            CryptUnprotectData(
                &input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
            .map_err(|_| "accountError.keychain")?;
            let result = if output.cbData == 32 && !output.pbData.is_null() {
                Aes256Gcm::new_from_slice(std::slice::from_raw_parts(output.pbData, 32))
                    .map_err(|_| "accountError.keychain".to_string())
            } else {
                Err("accountError.keychain".into())
            };
            let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
            result
        }
    }
    #[cfg(not(windows))]
    {
        let _ = dir;
        Err("accountError.keychain".into())
    }
}

pub(super) fn decrypt(cipher: &Aes256Gcm, encoded: &str) -> Result<String, String> {
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| "accountError.format")?;
    if !bytes.starts_with(b"v10") || bytes.len() < 31 {
        return Err("accountError.format".into());
    }
    let plain = cipher
        .decrypt(Nonce::from_slice(&bytes[3..15]), &bytes[15..])
        .map_err(|_| "accountError.keychain")?;
    String::from_utf8(plain).map_err(|_| "accountError.format".into())
}
pub(super) fn encrypt(cipher: &Aes256Gcm, plain: &str) -> Result<String, String> {
    let mut nonce = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let mut bytes = b"v10".to_vec();
    bytes.extend_from_slice(&nonce);
    bytes.extend(
        cipher
            .encrypt(Nonce::from_slice(&nonce), plain.as_bytes())
            .map_err(|_| "accountError.keychain")?,
    );
    Ok(STANDARD.encode(bytes))
}
pub(super) fn claims(token: &str) -> Result<Value, String> {
    let payload = token
        .split('.')
        .nth(1)
        .ok_or("accountError.invalidAccount")?;
    serde_json::from_slice(
        &URL_SAFE_NO_PAD
            .decode(payload.trim_end_matches('='))
            .map_err(|_| "accountError.invalidAccount")?,
    )
    .map_err(|_| "accountError.invalidAccount".into())
}
pub(super) fn identity(token: &str) -> Result<String, String> {
    let payload = claims(token)?;
    let sub = payload["sub"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("accountError.invalidAccount")?;
    Ok(format!("{:x}", Sha256::digest(sub)))
}

// Current Cursor access tokens contain a subject but may omit the email.
pub(super) async fn account_email(access_token: &str) -> Result<String, String> {
    if let Some(email) = claims(access_token)?["email"]
        .as_str()
        .filter(|s| !s.is_empty())
    {
        return Ok(email.into());
    }
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "accountError.network")?
        .post("https://api2.cursor.sh/aiserver.v1.AuthService/GetUserMeta")
        .bearer_auth(access_token)
        .header("Accept", "application/json")
        .json(&serde_json::json!({}))
        .send()
        .await
        .map_err(|_| "accountError.network")?;
    if !response.status().is_success() {
        return Err(format!(
            "accountError.auth|HTTP {}",
            response.status().as_u16()
        ));
    }
    let profile: Value = response
        .json()
        .await
        .map_err(|_| "accountError.authResponse")?;
    profile["email"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(String::from)
        .ok_or_else(|| "accountError.authResponse".into())
}

pub(super) struct LoginFlow(Mutex<Option<Pending>>);
impl LoginFlow {
    pub const fn new() -> Self {
        Self(Mutex::new(None))
    }
    pub fn start(&self, redirect_target: Option<&str>) -> Result<LoginStart, String> {
        let mut bytes = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        let verifier = URL_SAFE_NO_PAD.encode(bytes);
        let id = uuid::Uuid::new_v4().to_string();
        let expires = chrono::Utc::now().timestamp() + 60;
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let mut url = url::Url::parse("https://cursor.com/loginDeepControl")
            .map_err(|_| "accountError.auth")?;
        url.query_pairs_mut().extend_pairs([
            ("challenge", challenge.as_str()),
            ("uuid", id.as_str()),
            ("mode", "login"),
            ("supportsSelectedTeamLogin", "true"),
        ]);
        if let Some(target) = redirect_target {
            url.query_pairs_mut().append_pair("redirectTarget", target);
        }
        *self.0.lock().map_err(|_| "accountError.busy")? = Some(Pending {
            id: id.clone(),
            verifier,
            expires,
        });
        Ok(LoginStart {
            login_id: id,
            verification_uri: url.into(),
            expires_at: expires,
        })
    }
    pub async fn poll(&self, id: &str) -> Result<Option<Value>, String> {
        let p = valid_pending(
            &*self.0.lock().map_err(|_| "accountError.busy")?,
            id,
            chrono::Utc::now().timestamp(),
        )?;
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| "accountError.network")?;
        let response = client
            .get("https://api2.cursor.sh/auth/poll")
            .query(&[("uuid", p.id.as_str()), ("verifier", p.verifier.as_str())])
            .send()
            .await
            .map_err(|_| "accountError.network")?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(format!(
                "accountError.auth|HTTP {}",
                response.status().as_u16()
            ));
        }
        let mut value: Value = response
            .json()
            .await
            .map_err(|_| "accountError.authResponse")?;
        if let Some(access) = value["accessToken"].as_str() {
            // A temporary profile failure must not discard a successful authorization.
            if let Ok(email) = account_email(access).await {
                value["email"] = Value::String(email);
            }
        }
        Ok(Some(value))
    }
    pub fn complete<T>(
        &self,
        id: &str,
        save: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let mut pending = self.0.lock().map_err(|_| "accountError.busy")?;
        valid_pending(&pending, id, chrono::Utc::now().timestamp())?;
        let result = save()?;
        *pending = None;
        Ok(result)
    }
    pub fn cancel(&self, id: &str) -> Result<(), String> {
        let mut pending = self.0.lock().map_err(|_| "accountError.busy")?;
        if pending.as_ref().is_some_and(|p| p.id == id) {
            *pending = None;
        }
        Ok(())
    }
}
fn valid_pending(pending: &Option<Pending>, id: &str, now: i64) -> Result<Pending, String> {
    let p = pending
        .as_ref()
        .filter(|p| p.id == id)
        .ok_or("accountError.cancelled")?;
    if now >= p.expires {
        return Err("accountError.expired".into());
    }
    Ok(p.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancelled_expired_and_superseded_logins_cannot_be_saved() {
        let p = Some(Pending {
            id: "new".into(),
            verifier: "private".into(),
            expires: 60,
        });
        assert!(valid_pending(&p, "new", 59).is_ok());
        assert_eq!(
            valid_pending(&p, "old", 10).err().unwrap(),
            "accountError.cancelled"
        );
        assert_eq!(
            valid_pending(&p, "new", 60).err().unwrap(),
            "accountError.expired"
        );
        assert_eq!(
            valid_pending(&None, "new", 10).err().unwrap(),
            "accountError.cancelled"
        );
    }

    #[test]
    fn clients_use_independent_flows_and_cancel_cannot_clear_a_new_login() {
        let cursor = LoginFlow::new();
        let bot = LoginFlow::new();
        let old = cursor.start(None).unwrap();
        let current = cursor.start(None).unwrap();
        let other = bot.start(Some("sand")).unwrap();
        assert!(!current.verification_uri.contains("redirectTarget"));
        assert!(other.verification_uri.contains("redirectTarget=sand"));
        assert!(current
            .verification_uri
            .contains("supportsSelectedTeamLogin=true"));
        cursor.cancel(&old.login_id).unwrap();
        assert!(cursor.complete(&old.login_id, || Ok(())).is_err());
        assert!(cursor.complete(&current.login_id, || Ok(())).is_ok());
        bot.cancel(&other.login_id).unwrap();
        assert!(bot.complete(&other.login_id, || Ok(())).is_err());
    }
}
