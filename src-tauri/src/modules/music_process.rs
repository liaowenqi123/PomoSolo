//! 音乐播放器模块
//! 
//! 第一阶段：保留 Python 子进程（music.exe），通过 stdin/stdout 通信
//! 第二阶段：评估 Rust 音频库（rodio/cpal）替代

use serde_json::Value;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

pub struct MusicProcess {
    child: Option<Child>,
    stdin: Option<tokio::process::ChildStdin>,
}

impl MusicProcess {
    pub async fn spawn(exe_path: &str) -> Result<(Self, mpsc::UnboundedReceiver<Value>), String> {
        let mut child = Command::new(exe_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn music process: {}", e))?;
        
        let stdin = child.stdin.take().ok_or("Failed to capture stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        
        let (tx, rx) = mpsc::unbounded_channel();
        
        // 读取 stdout 行
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) => break, // EOF
                    Ok(_) => {
                        let trimmed = line.trim();
                        if !trimmed.is_empty() {
                            if let Ok(json) = serde_json::from_str::<Value>(trimmed) {
                                let _ = tx.send(json);
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
        });
        
        Ok((
            Self {
                child: Some(child),
                stdin: Some(stdin),
            },
            rx,
        ))
    }
    
    pub async fn send_command(&mut self, cmd: &Value) -> Result<(), String> {
        if let Some(stdin) = &mut self.stdin {
            let mut msg = serde_json::to_string(cmd).map_err(|e| e.to_string())?;
            msg.push('\n');
            stdin.write_all(msg.as_bytes()).await.map_err(|e| e.to_string())?;
            stdin.flush().await.map_err(|e| e.to_string())?;
            Ok(())
        } else {
            Err("Music process stdin not available".to_string())
        }
    }
    
    pub async fn kill(&mut self) {
        if let Some(child) = &mut self.child {
            let _ = child.kill().await;
        }
    }
}

impl Drop for MusicProcess {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            // 同步环境下尝试 kill
            let _ = child.start_kill();
        }
    }
}
