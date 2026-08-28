use serde::Deserialize;
use std::process::Stdio;

/// SSH tunnel (jump-host / bastion) configuration.
///
/// The database `host:port` supplied by the user is treated as the *remote*
/// target reachable from the SSH server. We spawn a local `ssh -N -L` process
/// that forwards a local ephemeral port to that target, then point the DB
/// driver at `127.0.0.1:<local_port>`. This reuses the OS `ssh` binary, so it
/// adds no new Rust/link dependencies and works with the existing ad-hoc
/// signing / entitlement setup.
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct SshConfig {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub user: String,
    #[serde(default)]
    pub auth_type: String, // "password" | "key"
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub private_key: Option<String>, // file path or PEM content
    #[serde(default)]
    pub passphrase: Option<String>,
}

/// TLS/SSL configuration for drivers that support it (PostgreSQL, MySQL).
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct SslConfig {
    pub enabled: bool,
    #[serde(default)]
    pub mode: Option<String>, // disable|prefer|require|verify-ca|verify-full
    #[serde(default)]
    pub ca_path: Option<String>,
    #[serde(default)]
    pub cert_path: Option<String>,
    #[serde(default)]
    pub key_path: Option<String>,
}

pub struct SshTunnel {
    pub local_port: u16,
    pub child: tokio::process::Child,
}

fn free_local_port() -> Result<u16, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("无法分配本地端口: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();
    drop(listener);
    Ok(port)
}

fn sshpass_path() -> Option<String> {
    let out = std::process::Command::new("sh")
        .arg("-c")
        .arg("command -v sshpass")
        .output()
        .ok()?;
    let s = String::from_utf8(out.stdout).ok()?;
    let s = s.trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

async fn wait_for_port(port: u16, timeout_secs: u64) -> Result<(), String> {
    let deadline =
        std::time::Instant::now() + std::time::Duration::from_secs(timeout_secs);
    loop {
        if tokio::net::TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
            return Ok(());
        }
        if std::time::Instant::now() >= deadline {
            return Err("SSH 隧道建立超时，无法连接到本地转发端口".to_string());
        }
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    }
}

fn prepare_key(ssh: &SshConfig) -> Result<Option<String>, String> {
    let key = match &ssh.private_key {
        None => return Ok(None),
        Some(k) => k.clone(),
    };
    if std::path::Path::new(&key).is_file() {
        return Ok(Some(key));
    }
    if key.contains("BEGIN") {
        let path = std::env::temp_dir().join(format!(
            "dbm_ssh_{}.pem",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::write(&path, &key).map_err(|e| format!("写入私钥失败: {}", e))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
        return Ok(Some(path.to_string_lossy().to_string()));
    }
    Err("SSH 私钥无效：请提供密钥文件路径或 PEM 内容".to_string())
}

pub async fn establish_tunnel(
    ssh: &SshConfig,
    remote_host: &str,
    remote_port: u16,
) -> Result<SshTunnel, String> {
    let local_port = free_local_port()?;
    let key_path = prepare_key(ssh)?;
    let use_password = ssh.auth_type == "password";

    let mut cmd = if use_password {
        match sshpass_path() {
            Some(sp) => {
                let mut c = tokio::process::Command::new(sp);
                if let Some(pw) = &ssh.password {
                    c.arg("-p").arg(pw);
                }
                c.arg("ssh");
                c
            }
            None => {
                return Err(
                    "未检测到 sshpass，无法用密码方式建立 SSH 隧道。请安装 sshpass，或改用密钥方式。"
                        .to_string(),
                )
            }
        }
    } else {
        tokio::process::Command::new("ssh")
    };

    cmd.arg("-N")
        .arg("-o")
        .arg("StrictHostKeyChecking=accept-new")
        .arg("-o")
        .arg("ExitOnForwardFailure=yes")
        .arg("-o")
        .arg("ServerAliveInterval=30")
        .arg("-o")
        .arg("ServerAliveCountMax=3");

    if use_password {
        // sshpass feeds the password; allow ssh to prompt for it.
    } else {
        cmd.arg("-o").arg("BatchMode=yes");
    }

    if let Some(kp) = &key_path {
        cmd.arg("-i").arg(kp);
    }
    if ssh.port != 22 {
        cmd.arg("-p").arg(ssh.port.to_string());
    }
    cmd.arg("-L")
        .arg(format!("{}:{}:{}", local_port, remote_host, remote_port))
        .arg(format!("{}@{}", ssh.user, ssh.host))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("无法启动 ssh 进程: {}", e))?;
    match wait_for_port(local_port, 15).await {
        Ok(()) => Ok(SshTunnel { local_port, child }),
        Err(e) => {
            let _ = child.start_kill();
            Err(e)
        }
    }
}
