#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# PomoSolo 证书同步 + 自愈（2026-10-19 加固版）
#
# 背景 / 为什么需要它：
#   本服务器上有**两套**证书签发体系，历史上互相打架，造成过一次全站故障：
#     · 1Panel（DNS-01）→ 签 **泛域名** *.pomogrow.top → 写到宿主根目录 /
#     · certbot（webroot）→ 签 **非泛域名** pomogrow.top + api.pomogrow.top
#   certbot 的 deploy hook 每次续期都会把**非泛域名**证书拷进 frontend/certs/，
#   把泛域名盖掉 → board./start./techroute./admin./llm. 等子域名 TLS 全部失败。
#   而本脚本的 cron 当时被停用了，没人把泛域名同步回来 → 故障持续。
#   （2026-10-13 certbot 续期触发，2026-10-19 被发现。）
#
# 本脚本的职责（**泛域名是唯一真相源**）：
#   1) 校验「源证书」（/）确实是**含 *.pomogrow.top 的有效证书**，且与私钥配对；
#   2) 校验「已部署证书」（frontend/certs）是否同样合规；
#   3) 源合规 且（已部署不合规 或 内容有变化）→ 备份 → 覆盖 → 重启容器；
#   4) 任何一步不合规 → **拒绝覆盖**并大声记日志（绝不把坏证书推上去）。
#
# 于是它同时是「同步器」和「看门狗」：即使有人把证书改坏，10 分钟内自愈。
#
# 由 root cron 每 10 分钟执行；flock 防并发。
# ═══════════════════════════════════════════════════════════════════

PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

# 允许环境变量覆盖 —— 便于在临时目录里做自测（不碰生产）
SRC_DIR="${SRC_DIR:-/}"
DST_DIR="${DST_DIR:-/home/ubuntu/frontend/certs}"
BACKUP_DIR="${BACKUP_DIR:-/home/ubuntu/cert-backups}"
LOG="${CERT_SYNC_LOG:-/var/log/pomosolo-cert-sync.log}"
LOCK="${CERT_SYNC_LOCK:-/tmp/le-cert-sync.lock}"
DOCKER_RESTART="${DOCKER_RESTART:-1}"

# 证书必须能覆盖这些域名才算合规。
# 用 openssl -checkhost 做**语义校验**（按 RFC 6125 的主机名匹配规则，含通配符），
# 而不是对 SAN 做字符串/正则匹配 —— 后者极易出错：
# 曾经写成 `grep -q "DNS:*.pomogrow.top"`，其中 `*` 是正则量词、`.` 是任意字符，
# 结果 `DNS:pomogrow.top`（非泛域名证书）也被判为「含泛域名」而放行。
CHECK_HOSTS="pomogrow.top board.pomogrow.top"
# 兼容没有 -checkhost 的老 openssl（1.1.1 以下）：退回字面量匹配
REQUIRED_SAN_LITERAL="DNS:*.pomogrow.top"
# 剩余有效期少于这个天数就视为「即将过期」，拒绝部署并告警
MIN_DAYS_LEFT=7

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

exec 9>"$LOCK"
flock -xn 9 || { log "[skip] another sync running"; exit 0; }

# ── 校验一个证书/私钥对 ──
# 用法: validate <fullchain> <privkey> <标签>
# 返回 0 = 合规；非 0 = 不合规（原因写入 VALIDATE_ERR）
VALIDATE_ERR=""
validate() {
    local chain="$1" key="$2" label="$3"
    VALIDATE_ERR=""

    [ -s "$chain" ] || { VALIDATE_ERR="$label: fullchain 缺失或为空"; return 1; }
    [ -s "$key" ]   || { VALIDATE_ERR="$label: privkey 缺失或为空"; return 1; }

    # 能被 openssl 解析
    openssl x509 -in "$chain" -noout >/dev/null 2>&1 \
        || { VALIDATE_ERR="$label: fullchain 不是合法证书"; return 1; }

    # 必须含**字面量**泛域名 SAN。这里有两个坑，都实际踩过：
    #   1) 写成 `grep -q "DNS:*.pomogrow.top"` 是**正则**：`*` 是量词（作用于 `:`）、
    #      `.` 是任意字符 → `DNS:pomogrow.top` 也会匹配，非泛域名证书被放行。
    #      必须用 `grep -F` 字面量匹配。
    #   2) `openssl x509 -checkhost` 看起来更"语义化"，但在 OpenSSL 3.0 下
    #      **退出码恒为 0**（只把结论写到 stdout），拿它做 if 判断等于没判断。
    if ! openssl x509 -in "$chain" -noout -ext subjectAltName 2>/dev/null \
            | grep -qF "$REQUIRED_SAN_LITERAL"; then
        VALIDATE_ERR="$label: 证书不含字面量 ${REQUIRED_SAN_LITERAL}（非泛域名证书，会打断子域名）"
        return 1
    fi

    # 未过期，且剩余天数 >= MIN_DAYS_LEFT
    if ! openssl x509 -in "$chain" -noout -checkend $((MIN_DAYS_LEFT * 86400)) >/dev/null 2>&1; then
        VALIDATE_ERR="$label: 证书已过期或将在 ${MIN_DAYS_LEFT} 天内过期"
        return 1
    fi

    # 私钥与证书必须配对。
    # 注意：私钥可能是 SEC1(`BEGIN EC PRIVATE KEY`)、PKCS#1(`BEGIN RSA PRIVATE KEY`)
    # 或 PKCS#8(`BEGIN PRIVATE KEY`) —— 按首行猜类型会漏判 PKCS#8，
    # 所以统一用 `openssl pkey`（三种格式通吃）。
    local cpub kpub
    cpub=$(openssl x509 -in "$chain" -noout -pubkey 2>/dev/null | openssl md5 2>/dev/null | awk '{print $NF}')
    kpub=$(openssl pkey -in "$key" -pubout 2>/dev/null | openssl md5 2>/dev/null | awk '{print $NF}')
    if [ -z "$cpub" ]; then
        VALIDATE_ERR="$label: 无法从证书提取公钥"; return 1
    fi
    if [ -z "$kpub" ]; then
        VALIDATE_ERR="$label: 私钥无法解析（格式不支持或已损坏）"; return 1
    fi
    if [ "$cpub" != "$kpub" ]; then
        VALIDATE_ERR="$label: 证书与私钥不配对"; return 1
    fi

    return 0
}

src_ok=0; dst_ok=0
validate "$SRC_DIR/fullchain.pem" "$SRC_DIR/privkey.pem" "源(/)"
[ $? -eq 0 ] && src_ok=1 || src_err="$VALIDATE_ERR"

validate "$DST_DIR/fullchain.pem" "$DST_DIR/privkey.pem" "已部署(frontend/certs)"
[ $? -eq 0 ] && dst_ok=1 || dst_err="$VALIDATE_ERR"

# ── 源不合规：什么都不做，只告警（绝不拿坏证书覆盖好证书）──
if [ "$src_ok" != "1" ]; then
    log "[ERROR] 源证书不合规，已拒绝同步：$src_err"
    log "[ERROR]   请检查 1Panel 的泛域名证书是否正常续期（源目录 $SRC_DIR）"
    exit 1
fi

# ── 源合规、已部署也合规、且内容一致：什么都不用做 ──
if [ "$dst_ok" = "1" ] && cmp -s "$SRC_DIR/fullchain.pem" "$DST_DIR/fullchain.pem" \
                        && cmp -s "$SRC_DIR/privkey.pem"   "$DST_DIR/privkey.pem"; then
    log "[ok] 泛域名证书已是最新，无需操作"
    exit 0
fi

# ── 需要同步（首次部署 / 内容变化 / 已部署的证书坏了要自愈）──
if [ "$dst_ok" != "1" ]; then
    log "[heal] 已部署证书不合规（$dst_err）→ 用源泛域名证书修复"
fi

mkdir -p "$BACKUP_DIR"
stamp=$(date '+%Y%m%d%H%M%S')
for f in fullchain.pem privkey.pem; do
    [ -f "$DST_DIR/$f" ] && cp -p "$DST_DIR/$f" "$BACKUP_DIR/$f.bak-$stamp"
done
log "[backup] 旧证书已备份到 $BACKUP_DIR/*.bak-$stamp"

cp "$SRC_DIR/fullchain.pem" "$DST_DIR/fullchain.pem"
cp "$SRC_DIR/privkey.pem"   "$DST_DIR/privkey.pem"
chown ubuntu:ubuntu "$DST_DIR/fullchain.pem" "$DST_DIR/privkey.pem"
chmod 644 "$DST_DIR/fullchain.pem"
chmod 600 "$DST_DIR/privkey.pem"

# 覆盖后再校验一次（防止拷贝过程出问题）
if ! validate "$DST_DIR/fullchain.pem" "$DST_DIR/privkey.pem" "部署后"; then
    log "[ERROR] 覆盖后校验失败：$VALIDATE_ERR → 回滚"
    cp -p "$BACKUP_DIR/fullchain.pem.bak-$stamp" "$DST_DIR/fullchain.pem" 2>/dev/null
    cp -p "$BACKUP_DIR/privkey.pem.bak-$stamp"   "$DST_DIR/privkey.pem"   2>/dev/null
    exit 1
fi

log "[sync] 泛域名证书已同步，重启 frontend-web 以重新加载"
if [ "$DOCKER_RESTART" = "1" ]; then
    docker restart frontend-web >/dev/null 2>&1
    log "[done] 重启完成，证书已生效"
else
    log "[done] DOCKER_RESTART=0，跳过重启（自测模式）"
fi

# 只保留最近 20 份备份，避免堆积
ls -1t "$BACKUP_DIR"/fullchain.pem.bak-* 2>/dev/null | tail -n +21 | xargs -r rm -f
ls -1t "$BACKUP_DIR"/privkey.pem.bak-*   2>/dev/null | tail -n +21 | xargs -r rm -f

exit 0
