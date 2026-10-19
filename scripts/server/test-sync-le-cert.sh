#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# sync-le-cert.sh 自测套件
#
# 在临时目录里模拟各种证书状态，验证同步脚本「该修就修、该拒就拒」。
# 全程 DOCKER_RESTART=0 —— **不碰生产证书、不重启容器**，可安全反复运行。
#
# 用法（在服务器上跑）：
#     bash scripts/server/test-sync-le-cert.sh
# 或覆盖路径：
#     SCRIPT=/path/to/sync-le-cert.sh GOOD_CHAIN=... BAD_CHAIN=... bash test-sync-le-cert.sh
#
# 前置：
#   · GOOD_CHAIN/GOOD_KEY  = 一份**泛域名**证书及其私钥（默认取 1Panel 推送的 /）
#   · BAD_CHAIN/BAD_KEY    = 一份**非泛域名**证书（默认自动从备份目录里找最新的）
# ═══════════════════════════════════════════════════════════════════
set -u

SCRIPT="${SCRIPT:-/home/ubuntu/sync-le-cert.sh}"
T="${T:-/tmp/certtest}"
BK="${BK:-/home/ubuntu/cert-backups}"

GOOD_CHAIN="${GOOD_CHAIN:-/fullchain.pem}"
GOOD_KEY="${GOOD_KEY:-/privkey.pem}"

# 「非泛域名」素材：优先用显式指定的，否则自动找备份目录里最新的一份
if [ -z "${BAD_CHAIN:-}" ]; then
    BAD_CHAIN=$(ls -1t "$BK"/fullchain.pem.bad-* 2>/dev/null | head -1)
    BAD_KEY=$(ls -1t "$BK"/privkey.pem.bad-*   2>/dev/null | head -1)
fi

for f in "$SCRIPT" "$GOOD_CHAIN" "$GOOD_KEY" "$BAD_CHAIN" "$BAD_KEY"; do
    if [ ! -s "$f" ]; then
        echo "缺少素材：$f"
        echo
        echo "BAD_* 是「非泛域名证书」样本，用于验证脚本会拒绝它。"
        echo "若备份里没有，可临时造一份："
        echo "    sudo certbot certonly --webroot -w /home/ubuntu/frontend -d pomogrow.top -d api.pomogrow.top"
        echo "或直接把 BAD_CHAIN/BAD_KEY 指向任意非泛域名证书。"
        exit 2
    fi
done

pass=0; fail=0
chk() {  # chk <描述> <实际> <期望>
  if [ "$2" = "$3" ]; then echo "    ✔ $1"; pass=$((pass+1))
  else echo "    ✘ $1  实际=[$2] 期望=[$3]"; fail=$((fail+1)); fi
}

san_of() { openssl x509 -in "$1" -noout -ext subjectAltName 2>/dev/null | grep -o 'DNS:[^,]*' | tr '\n' ' '; }

setup() { rm -rf "$T"; mkdir -p "$T/src" "$T/dst" "$T/bk"; }
runit() {
  CERT_SYNC_LOG="$T/log" SRC_DIR="$T/src" DST_DIR="$T/dst" BACKUP_DIR="$T/bk" \
  CERT_SYNC_LOCK="$T/lock" DOCKER_RESTART=0 bash "$SCRIPT" >/dev/null 2>&1
  echo $?
}

echo "素材确认："
echo "    泛域名证书 SAN : $(san_of $GOOD_CHAIN)"
echo "    非泛域名证书 SAN: $(san_of $BAD_CHAIN)"
echo

# ─────────────────────────────────────────────────────────────
echo "【A】已部署证书被污染成非泛域名，源是好的 → 应自愈"
setup
cp "$GOOD_CHAIN" "$T/src/fullchain.pem"; cp "$GOOD_KEY" "$T/src/privkey.pem"
cp "$BAD_CHAIN"  "$T/dst/fullchain.pem"; cp "$BAD_KEY"  "$T/dst/privkey.pem"
rc=$(runit)
chk "退出码为 0" "$rc" "0"
chk "已部署证书已恢复成泛域名" "$(san_of $T/dst/fullchain.pem)" "DNS:*.pomogrow.top DNS:pomogrow.top "
chk "备份了被污染的旧证书" "$(ls $T/bk/fullchain.pem.bak-* 2>/dev/null | wc -l)" "1"
grep -q '\[heal\]' "$T/log" && echo "    ✔ 日志记录了自愈动作" && pass=$((pass+1)) || { echo "    ✘ 日志未记录自愈"; fail=$((fail+1)); }
echo

# ─────────────────────────────────────────────────────────────
echo "【B】源被污染成非泛域名，已部署是好的 → 应拒绝覆盖、保持原样"
setup
cp "$BAD_CHAIN"  "$T/src/fullchain.pem"; cp "$BAD_KEY"  "$T/src/privkey.pem"
cp "$GOOD_CHAIN" "$T/dst/fullchain.pem"; cp "$GOOD_KEY" "$T/dst/privkey.pem"
before=$(md5sum "$T/dst/fullchain.pem" | awk '{print $1}')
rc=$(runit)
chk "退出码为 1（明确失败）" "$rc" "1"
chk "已部署证书未被改动" "$(md5sum $T/dst/fullchain.pem | awk '{print $1}')" "$before"
grep -q '源证书不合规' "$T/log" && echo "    ✔ 日志告警了源不合规" && pass=$((pass+1)) || { echo "    ✘ 未告警"; fail=$((fail+1)); }
echo

# ─────────────────────────────────────────────────────────────
echo "【C】源与已部署一致且都合规 → 应无事发生"
setup
cp "$GOOD_CHAIN" "$T/src/fullchain.pem"; cp "$GOOD_KEY" "$T/src/privkey.pem"
cp "$GOOD_CHAIN" "$T/dst/fullchain.pem"; cp "$GOOD_KEY" "$T/dst/privkey.pem"
before=$(md5sum "$T/dst/fullchain.pem" | awk '{print $1}')
rc=$(runit)
chk "退出码为 0" "$rc" "0"
chk "证书未被动过" "$(md5sum $T/dst/fullchain.pem | awk '{print $1}')" "$before"
chk "未产生多余备份" "$(ls $T/bk/ 2>/dev/null | wc -l)" "0"
echo

# ─────────────────────────────────────────────────────────────
echo "【D】已部署证书文件损坏 → 应自愈"
setup
cp "$GOOD_CHAIN" "$T/src/fullchain.pem"; cp "$GOOD_KEY" "$T/src/privkey.pem"
echo "----- 损坏的内容 -----" > "$T/dst/fullchain.pem"
cp "$GOOD_KEY" "$T/dst/privkey.pem"
rc=$(runit)
chk "退出码为 0" "$rc" "0"
chk "已部署证书已修复" "$(san_of $T/dst/fullchain.pem)" "DNS:*.pomogrow.top DNS:pomogrow.top "
echo

# ─────────────────────────────────────────────────────────────
echo "【E】源证书与私钥不配对 → 应拒绝"
setup
cp "$GOOD_CHAIN" "$T/src/fullchain.pem"; cp "$BAD_KEY" "$T/src/privkey.pem"
cp "$GOOD_CHAIN" "$T/dst/fullchain.pem"; cp "$GOOD_KEY" "$T/dst/privkey.pem"
before=$(md5sum "$T/dst/fullchain.pem" | awk '{print $1}')
rc=$(runit)
chk "退出码为 1" "$rc" "1"
chk "已部署证书未被改动" "$(md5sum $T/dst/fullchain.pem | awk '{print $1}')" "$before"
grep -q '不配对' "$T/log" && echo "    ✔ 日志指出了不配对" && pass=$((pass+1)) || { echo "    ✘ 未指出不配对"; fail=$((fail+1)); }
echo

# ─────────────────────────────────────────────────────────────
echo "【F】源私钥是 PKCS#8（BEGIN PRIVATE KEY）且与证书配对 → 应通过并自愈"
echo "     （回归用例：曾经因为按首行猜密钥类型而误判「格式无法识别」）"
setup
cp "$GOOD_CHAIN" "$T/src/fullchain.pem"
openssl pkey -in "$GOOD_KEY" -out "$T/src/privkey.pem" 2>/dev/null   # 转成 PKCS#8
echo "    源私钥首行: $(head -1 $T/src/privkey.pem)"
cp "$BAD_CHAIN"  "$T/dst/fullchain.pem"; cp "$BAD_KEY" "$T/dst/privkey.pem"
rc=$(runit)
chk "退出码为 0（PKCS#8 被正确识别）" "$rc" "0"
chk "已部署证书已恢复成泛域名" "$(san_of $T/dst/fullchain.pem)" "DNS:*.pomogrow.top DNS:pomogrow.top "
echo

rm -rf "$T"
echo "════════════════════════════════════"
echo "  通过 $pass  失败 $fail"
echo "════════════════════════════════════"
[ "$fail" -eq 0 ] && exit 0 || exit 1
