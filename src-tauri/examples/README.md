# `src-tauri/examples/` —— Rust 临时调试 example 的落脚点

## 约定（来自 `TEAM_GUIDE.md` §6.3 / `AGENTS.md` §5）

需要跑 `cargo run --example xxx` 的调试代码**不要直接写在这里**，
而是放在根目录 `temp-debug/`（已 gitignore），**运行时再拷进来**：

```powershell
# 1) 拷进来
Copy-Item temp-debug\test_download.rs src-tauri\examples\

# 2) 跑
cd src-tauri
cargo run --example test_download

# 3) 用完移回去（保持本目录干净）
Move-Item src-tauri\examples\test_download.rs temp-debug\
```

## 为什么这样做

- `examples/` 里的每个 `.rs` 都会被 `cargo test` 编译 → 遗留的调试代码会拖慢 CI、甚至编译失败；
- 调试代码常含本地路径、临时 API Key、一次性数据 → 属于 `temp-debug/` 的语义，不该入库；
- 本目录**只保留本说明文件**。除 `README.md` 外不应有其他文件（除非你正在临时调试）。

## 本目录与 `.local/` 的区别

| 目录 | 放什么 |
|------|--------|
| `temp-debug/` | 一次性调试脚本/数据（**含** example 源码），用完即弃 |
| `.local/` | 本机/服务器**长期有效**的专属事实（路径、账号、密钥位置） |
| `src-tauri/examples/` | **空的落脚点** —— 只在"正在跑某个 example"期间短暂存在文件 |

详见 [`.local/README.md`](../../.local/README.md) 与 [`AGENTS.md`](../../AGENTS.md) §1。
