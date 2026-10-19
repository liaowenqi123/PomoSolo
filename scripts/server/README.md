# `scripts/server/` —— 服务器基础设施脚本

> **范围**：只在**服务器**上运行的运维脚本。应用代码见 [`../../src/README.md`](../../src/README.md)。
> 服务器**业务代码**（`server.py` / `board.py` 等）不在本仓库，只活在服务器上；
> 这里放的是**必须版本化的基础设施**（改错了会全站故障，必须能追溯和回滚）。

---

## 1. 为什么有这一节：一次全站 HTTPS 故障

**2026-10-19：所有子域名浏览器报「不安全」，HTTPS 不可用。**

根因是**两套证书签发体系互相打架**：

| 体系 | 覆盖范围 | 产物落点 |
|---|---|---|
| **1Panel**（阿里云 DNS-01） | `*.pomogrow.top` + `pomogrow.top`（**泛域名**，覆盖所有子域名） | 宿主根目录 `/fullchain.pem` + `/privkey.pem` |
| **certbot**（webroot） | `pomogrow.top` + `api.pomogrow.top`（**非泛域名**） | `/etc/letsencrypt/live/pomogrow.top/` |

容器实际加载的是 `/home/ubuntu/frontend/certs/`。问题出在：

1. certbot 的 **deploy hook** 每次续期都把**非泛域名**证书拷进 `frontend/certs/`，
   把泛域名盖掉 → `board.` / `start.` / `techroute.` / `admin.` / `llm.` / `eartest.`
   等**不在该 SAN 里**的子域名 TLS 握手全部失败；
2. 本该把泛域名同步回去的 `sync-le-cert.sh`，其 **cron 在 2026-08-13 被注释停用**
   （当时的判断是"证书改由 certbot 管理"）→ 没有任何东西能自愈。

时间线：`2026-08-13` 停用同步 → `2026-10-13 05:10` certbot 续期触发覆盖 →
`2026-10-19` 被发现，故障持续 **6 天**。

---

## 2. 现在的架构（单一真相源）

```
1Panel（每天 00:00 检查续期，auto_renew=1）
    └─ 签发 *.pomogrow.top（DNS-01，阿里云）
    └─ 「证书推送到目录 /」→ /fullchain.pem + /privkey.pem
                                    │
                                    │  sync-le-cert.sh（cron 每 10 分钟）
                                    │  · 校验源证书：含字面量 DNS:*.pomogrow.top
                                    │               未临近过期、与私钥配对
                                    │  · 不合规 → 拒绝覆盖 + 告警（绝不推坏证书）
                                    │  · 已部署的不合规 → 自动修复（自愈）
                                    ▼
                        /home/ubuntu/frontend/certs/
                                    │  bind mount → 容器 /app/certs
                                    ▼
                        frontend-web（server.py 启动时加载，需重启才生效）
```

**关键约定**：

- **泛域名是唯一真相源**，非泛域名那条 certbot lineage 是**冗余的**；
- **永远不要**从 `/etc/letsencrypt/live/pomogrow.top/` 拷证书到 `frontend/certs/`；
- 改证书相关脚本后，**必须**跑 `test-sync-le-cert.sh`（见下）。

---

## 3. 文件

| 文件 | 作用 |
|---|---|
| `sync-le-cert.sh` | ★ 同步 + **自愈**脚本。校验源证书 → 同步 → 重启容器。部署到 `/home/ubuntu/sync-le-cert.sh` |
| `certbot-deploy-hook.sh` | certbot 续期钩子。**只调用同步脚本**，绝不自己拷证书。部署到 `/etc/letsencrypt/renewal-hooks/deploy/frontend-web.sh` |
| `test-sync-le-cert.sh` | 自测套件（6 个场景 17 项断言），在临时目录里跑，**不碰生产** |
| `e2e-cert-heal.sh` | 端到端复现 + 自愈验证（**会短暂打断线上 HTTPS**，仅用于排障确认） |

---

## 4. 部署

```bash
# 同步脚本（cron 每 10 分钟）
scp sync-le-cert.sh ubuntu-tencent:/tmp/
ssh ubuntu-tencent 'sudo cp /tmp/sync-le-cert.sh /home/ubuntu/sync-le-cert.sh && sudo chmod 755 /home/ubuntu/sync-le-cert.sh'

# certbot 钩子
scp certbot-deploy-hook.sh ubuntu-tencent:/tmp/
ssh ubuntu-tencent 'sudo cp /tmp/certbot-deploy-hook.sh /etc/letsencrypt/renewal-hooks/deploy/frontend-web.sh && sudo chmod 755 /etc/letsencrypt/renewal-hooks/deploy/frontend-web.sh'

# cron（root）
ssh ubuntu-tencent 'sudo crontab -l | grep -v sync-le-cert > /tmp/c; echo "*/10 * * * * /home/ubuntu/sync-le-cert.sh" >> /tmp/c; sudo crontab /tmp/c'
```

---

## 5. 验证

```bash
# ① 自测套件（安全，随时可跑）
ssh ubuntu-tencent 'bash /tmp/test-sync-le-cert.sh'
#   期望：通过 17  失败 0

# ② 手动跑一次同步（幂等）
ssh ubuntu-tencent 'sudo /home/ubuntu/sync-le-cert.sh; sudo tail -3 /var/log/pomosolo-cert-sync.log'

# ③ 公网实测（严格校验证书，不加 -k）
for h in pomogrow.top api.pomogrow.top board.pomogrow.top start.pomogrow.top \
         techroute.pomogrow.top admin.pomogrow.top llm.pomogrow.top eartest.pomogrow.top; do
  curl -sS -o /dev/null -w "%{http_code} $h\n" "https://$h/"
done

# ④ 端到端复现自愈（会短暂打断 HTTPS，确认过再做）
ssh ubuntu-tencent 'bash /tmp/e2e-cert-heal.sh'
```

---

## 6. 两个必须知道的 openssl 陷阱

写这段逻辑时踩过，**别再踩第二次**：

1. **`grep -q "DNS:*.pomogrow.top"` 是正则，不是字面量。**
   `*` 是量词（作用于 `:`）、`.` 是任意字符 → `DNS:pomogrow.top`（非泛域名证书）
   也会匹配，于是**把坏证书判成合规**。必须用 `grep -qF`。
2. **`openssl x509 -checkhost` 的退出码恒为 0**（OpenSSL 3.0，只把结论写到 stdout），
   拿它做 `if` 判断等于没判断。不要用它做校验。

另外：私钥首行可能是 `BEGIN EC PRIVATE KEY`（SEC1）、`BEGIN RSA PRIVATE KEY`（PKCS#1）
或 `BEGIN PRIVATE KEY`（PKCS#8）—— **按首行猜类型会漏判 PKCS#8**。
统一用 `openssl pkey`（三种格式通吃）。

---

## 7. 已知遗留

- **certbot 那条非泛域名 lineage 仍然存在**（`certbot.timer` 每天两次检查）。
  现在它无害（钩子不再拷证书），但属于冗余：
  浪费 Let's Encrypt 配额，且**下次有人看到它时会再次误以为"证书归 certbot 管"**。
  建议在确认无副作用后 `certbot delete --cert-name pomogrow.top` 清掉。
- **1Panel 的 `website_ssls.message` 里残留一条 2026-10-13 的 ACME 报错**
  （`No such authorization`，瞬时错误）。`status` 已是 `ready`、10-15 已成功重签，
  属陈旧信息，不影响续期。
- 泛域名证书 2027-01-12 到期；1Panel `auto_renew=1`，每天 00:00 检查。
  若 1Panel 停止工作，`sync-le-cert.sh` 会在剩余有效期 < 7 天时**拒绝部署并告警**
  （日志 `/var/log/pomosolo-cert-sync.log`）—— **但没人会主动看到日志**，
  建议另行接一个告警。
