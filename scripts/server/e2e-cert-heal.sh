#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# 端到端复现 + 自愈验证（生产环境）
#   1) 把 certbot 的**非泛域名**证书放回 frontend/certs（复现 10-13 的故障）
#   2) 重启容器 → 确认 HTTPS 真的坏了（证明故障可复现）
#   3) 跑同步脚本（cron 每 10 分钟做的就是这件事）
#   4) 确认 HTTPS 自动恢复
# ═══════════════════════════════════════════════════════════════════
set -u
BK=/home/ubuntu/cert-backups
BAD_CHAIN="$BK/fullchain.pem.bad-20261019222200"
BAD_KEY="$BK/privkey.pem.bad-20261019222200"
DST=/home/ubuntu/frontend/certs
HOST=board.pomogrow.top

probe() {
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$HOST/" 2>&1)
  if [ "$code" = "200" ]; then echo "200(证书有效)"; else echo "失败"; fi
}

echo "=== 0. 起始状态 ==="
echo "  已部署证书 SAN: $(openssl x509 -in $DST/fullchain.pem -noout -ext subjectAltName | tail -1 | xargs)"
echo "  https://$HOST/ -> $(probe)"

echo
echo "=== 1. 注入 certbot 的非泛域名证书（复现故障）==="
cp "$BAD_CHAIN" "$DST/fullchain.pem"
cp "$BAD_KEY"   "$DST/privkey.pem"
chown ubuntu:ubuntu "$DST/fullchain.pem" "$DST/privkey.pem"
chmod 644 "$DST/fullchain.pem"; chmod 600 "$DST/privkey.pem"
echo "  已部署证书 SAN: $(openssl x509 -in $DST/fullchain.pem -noout -ext subjectAltName | tail -1 | xargs)"
sudo docker restart frontend-web >/dev/null 2>&1
sleep 5

echo
echo "=== 2. 确认故障已复现（此时 $HOST 应该握手失败）==="
echo "  https://$HOST/ -> $(probe)"
echo "  （这一步必须显示「失败」，否则复现不成立）"

echo
echo "=== 3. 执行同步脚本（等同 cron 的行为）==="
sudo /home/ubuntu/sync-le-cert.sh
echo "  脚本退出码=$?"
sleep 5

echo
echo "=== 4. 确认自愈 ==="
echo "  已部署证书 SAN: $(openssl x509 -in $DST/fullchain.pem -noout -ext subjectAltName | tail -1 | xargs)"
echo "  https://$HOST/ -> $(probe)"

echo
echo "=== 5. 同步日志尾部 ==="
sudo tail -6 /var/log/pomosolo-cert-sync.log
