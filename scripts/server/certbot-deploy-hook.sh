#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# certbot deploy hook（2026-10-19 修正）
#
# 🔴 绝对不要在这里从 /etc/letsencrypt/live/pomogrow.top/ 拷贝证书！
#
# 那条 lineage 是**非泛域名**的，SAN 只有：
#     pomogrow.top, api.pomogrow.top
# 一旦拷进 /home/ubuntu/frontend/certs/，就会盖掉 1Panel 签发的**泛域名**证书，
# 于是 board. / start. / techroute. / admin. / llm. / eartest. 等所有
# 不在该 SAN 里的子域名 TLS 握手全部失败 —— 2026-10-13 就是这么造成
# 一次全站「不安全」故障的（10-19 才发现）。
#
# 本服务器上泛域名的**唯一真相源**是 1Panel（DNS-01）写出的宿主根目录 /fullchain.pem，
# 由 /home/ubuntu/sync-le-cert.sh 负责校验 + 同步 + 自愈。
# 该脚本自带合规校验：源证书必须是含 *.pomogrow.top 的有效证书，否则拒绝覆盖。
#
# 所以本 hook 只做一件事：触发一次同步（顺带让容器重新加载）。
exec /home/ubuntu/sync-le-cert.sh
