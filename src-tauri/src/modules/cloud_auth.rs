//! 云端认证模块（Rust 重写）
//! 
//! 安全改进：
//! - 密码哈希使用 pbkdf2（与 Node 版本兼容）
//! - 凭据加密使用 AES-256-GCM（密钥由机器 ID 派生，不依赖 OS API）
//! - Supabase 通过 REST API 直接调用，不依赖客户端 SDK
//! - API Key 仅存在 Rust 内存中，前端只能查询布尔值

use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use aes_gcm::aead::Aead;
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use sha2::Sha512;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub(crate) const SUPABASE_URL: &str = "https://sjexeynibnfqxvwehnxk.supabase.co";
pub(crate) const SUPABASE_ANON_KEY: &str = "sb_publishable_NtzlEhTWwC4qpSY0DEvQ0Q_ER6yJoTz";
const PBKDF2_ITERATIONS: u32 = 100_000;
const KEY_LENGTH: usize = 32; // AES-256

/// 用户会话
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: i64,
    pub username: String,
    pub admin: bool,
}

/// 凭据文件结构
#[derive(Debug, Serialize, Deserialize)]
pub struct Credentials {
    pub username: String,
    pub password_encrypted: Option<String>, // AES-GCM 加密
    pub client_id: Option<String>,
    pub auto_login: Option<bool>,
    /// 解密后的明文密码（仅在内存中，不持久化）
    #[serde(skip)]
    pub password: Option<String>,
}

/// 从机器特征派生加密密钥
fn derive_machine_key() -> [u8; KEY_LENGTH] {
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_default();
    
    let username = whoami::username();
    
    let mut salt = Vec::new();
    salt.extend_from_slice(hostname.as_bytes());
    salt.extend_from_slice(username.as_bytes());
    salt.extend_from_slice(b"PomoSolo-v4-credential-key");
    
    let mut key = [0u8; KEY_LENGTH];
    pbkdf2_hmac::<Sha512>(b"PomoSolo-machine-key", &salt, PBKDF2_ITERATIONS, &mut key);
    key
}

/// 加密字符串
pub fn encrypt_string(plaintext: &str) -> Result<String, String> {
    let key = derive_machine_key();
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    
    let ciphertext = cipher.encrypt(nonce, plaintext.as_bytes()).map_err(|e| e.to_string())?;
    
    // 将 nonce + ciphertext 合并后 base64
    let mut combined = Vec::with_capacity(12 + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);
    
    Ok(base64_encode(&combined))
}

/// 解密字符串
pub fn decrypt_string(encrypted: &str) -> Result<String, String> {
    let key = derive_machine_key();
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    
    let combined = base64_decode(encrypted)?;
    if combined.len() < 12 {
        return Err("Invalid ciphertext length".to_string());
    }
    
    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);
    
    let plaintext = cipher.decrypt(nonce, ciphertext).map_err(|e| e.to_string())?;
    String::from_utf8(plaintext).map_err(|e| e.to_string())
}

/// 密码哈希（与 Node.js crypto.pbkdf2 兼容）
pub fn hash_password(password: &str, salt: &str) -> String {
    let salt_bytes = salt.as_bytes();
    let mut derived_key = [0u8; 64]; // 64 bytes = sha512 输出长度
    pbkdf2_hmac::<Sha512>(password.as_bytes(), salt_bytes, PBKDF2_ITERATIONS, &mut derived_key);
    hex_encode(&derived_key)
}

/// 生成随机 salt
pub fn generate_salt() -> String {
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    hex_encode(&salt)
}

/// 生成 client_id
pub fn generate_client_id() -> String {
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_default();
    let username = whoami::username();
    let combined = format!("{}-{}", hostname, username);
    
    let mut hasher = Sha512::new();
    use sha2::Digest;
    hasher.update(combined.as_bytes());
    let result = hasher.finalize();
    hex_encode(&result[..16])
}

/// 获取凭据文件路径
fn get_credentials_path(app: &AppHandle) -> PathBuf {
    let mut path = app.path().app_data_dir().unwrap_or_else(|_| {
        dirs::data_dir().unwrap_or_else(|| PathBuf::from("."))
    });
    path.push("PomoSolo");
    let _ = fs::create_dir_all(&path);
    path.join("credentials.json")
}

/// 保存凭据（密码加密存储）
pub fn save_credentials(app: &AppHandle, username: &str, password: &str, auto_login: bool) -> Result<(), String> {
    let password_encrypted = encrypt_string(password)?;
    let creds = Credentials {
        username: username.to_string(),
        password_encrypted: Some(password_encrypted),
        client_id: Some(generate_client_id()),
        auto_login: Some(auto_login),
        password: None,
    };

    let path = get_credentials_path(app);
    let content = serde_json::to_string_pretty(&creds).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

/// 加载凭据（解密密码）
pub fn load_credentials(app: &AppHandle) -> Result<Option<Credentials>, String> {
    let path = get_credentials_path(app);
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut creds: Credentials = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    // 解密密码并填入内存字段（不持久化）
    if let Some(ref encrypted) = creds.password_encrypted {
        creds.password = Some(decrypt_string(encrypted)?);
    }

    Ok(Some(creds))
}

/// 清除凭据
pub fn clear_credentials(app: &AppHandle) -> Result<(), String> {
    let path = get_credentials_path(app);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ===== 辅助函数 =====

fn base64_encode(data: &[u8]) -> String {
    use base64::{engine::general_purpose, Engine};
    general_purpose::STANDARD.encode(data)
}

fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
    use base64::{engine::general_purpose, Engine};
    general_purpose::STANDARD.decode(s).map_err(|e| e.to_string())
}

fn hex_encode(data: &[u8]) -> String {
    data.iter().map(|b| format!("{:02x}", b)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let plaintext = "my-secret-password-123";
        let encrypted = encrypt_string(plaintext).expect("加密应成功");
        assert_ne!(encrypted, plaintext, "加密后内容应不同于原文");
        let decrypted = decrypt_string(&encrypted).expect("解密应成功");
        assert_eq!(decrypted, plaintext, "解密后应得到原文");
    }

    #[test]
    fn test_encrypt_produces_different_ciphertext() {
        // 由于 nonce 随机，同一明文加密两次应产生不同密文
        let plaintext = "same-password";
        let a = encrypt_string(plaintext).expect("加密 a");
        let b = encrypt_string(plaintext).expect("加密 b");
        assert_ne!(a, b, "不同次加密应产生不同密文（nonce 随机）");
        // 但都能解回原文
        assert_eq!(decrypt_string(&a).unwrap(), plaintext);
        assert_eq!(decrypt_string(&b).unwrap(), plaintext);
    }

    #[test]
    fn test_hash_password_consistency() {
        let password = "p@ssw0rd";
        let salt = "fixed-salt-value";
        let h1 = hash_password(password, salt);
        let h2 = hash_password(password, salt);
        assert_eq!(h1, h2, "相同密码+salt 应得到相同哈希");
    }

    #[test]
    fn test_hash_password_different_salt() {
        let password = "p@ssw0rd";
        let h1 = hash_password(password, "salt-one");
        let h2 = hash_password(password, "salt-two");
        assert_ne!(h1, h2, "不同 salt 应得到不同哈希");
    }

    #[test]
    fn test_hash_password_different_password() {
        let salt = "same-salt";
        let h1 = hash_password("password-a", salt);
        let h2 = hash_password("password-b", salt);
        assert_ne!(h1, h2, "不同密码应得到不同哈希");
    }

    #[test]
    fn test_generate_salt_length() {
        let salt = generate_salt();
        assert_eq!(salt.len(), 32, "salt 应为 32 字符的 hex 字符串（16 字节）");
        // 应为合法的十六进制字符串
        assert!(
            salt.chars().all(|c| c.is_ascii_hexdigit()),
            "salt 应仅包含十六进制字符"
        );
    }

    #[test]
    fn test_generate_salt_uniqueness() {
        let a = generate_salt();
        let b = generate_salt();
        assert_ne!(a, b, "两次生成的 salt 应不同（随机）");
    }

    #[test]
    fn test_generate_client_id_length() {
        let client_id = generate_client_id();
        assert_eq!(client_id.len(), 32, "client_id 应为 32 字符（16 字节 hex）");
        assert!(
            client_id.chars().all(|c| c.is_ascii_hexdigit()),
            "client_id 应仅包含十六进制字符"
        );
    }

    #[test]
    fn test_generate_client_id_stability() {
        // 同一机器上多次调用应一致（基于 hostname+username）
        let a = generate_client_id();
        let b = generate_client_id();
        assert_eq!(a, b, "同一机器生成的 client_id 应稳定一致");
    }

    #[test]
    fn test_decrypt_invalid_input_returns_error() {
        let result = decrypt_string("not-valid-base64-!!!@@@");
        assert!(result.is_err(), "非法密文应返回错误");
    }

    #[test]
    fn test_decrypt_short_input_returns_error() {
        // 长度小于 12 字节（nonce 长度）应失败
        let short = base64_encode(b"short");
        let result = decrypt_string(&short);
        assert!(result.is_err(), "过短的密文应返回错误");
    }
}
