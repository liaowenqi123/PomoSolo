"""WebSocket 服务器（同步版，纯标准库 RFC6455）

提供两种接入方式：
1. `/ws` 路径：由主 HTTP 服务器在 Upgrade 时直接接管连接（80 端口同源）
2. 独立端口 3001：单独监听线程（备用直连）

协议（与客户端 server-planning/API-implementation.md 对齐）：
- 连接: ws://SERVER/ws?token=<access_token>
- 请求-响应：客户端消息带 `id`，服务端响应回显同名 `id`；事件不带 id
- 事件：room:xxx / music:xxx / pong 等推送
"""
import base64
import hashlib
import json
import socket
import struct
import sys
import threading
import time
import urllib.parse
from auth import verify_jwt

MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

# ── 全局状态（线程安全）──
_lock = threading.RLock()
# connections: user_id -> {"sock", "wfile", "username", "room_id", "status"}
connections = {}
# rooms: room_id -> {"name", "description", "members": set, "dj", "music_state"}
rooms = {}
# 在线种子表（P2P 安装包分享，Phase 2）: user_id -> {"version", "file", "size", "last_seen"}
# 客户端开启"分享安装包"后注册，30s 心跳保活，SEED_TTL 秒无心跳自动清理；断连即注销
p2p_seeds = {}
SEED_TTL = 60  # 秒：超过该时长无心跳视为离线（客户端心跳间隔 30s）


# ── RFC6455 底层 ──

def recv_exact(rfile, n):
    buf = b""
    while len(buf) < n:
        chunk = rfile.read(n - len(buf))
        if not chunk:
            raise ConnectionError("连接关闭")
        buf += chunk
    return buf


def ws_handshake(sock, rfile, headers):
    """执行 WebSocket 握手，返回是否成功"""
    key = ""
    for k, v in headers.items():
        if k.lower() == "sec-websocket-key":
            key = v
    if not key:
        return False
    accept = base64.b64encode(hashlib.sha1((key.strip() + MAGIC).encode()).digest()).decode()
    response = (
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
    )
    sock.sendall(response.encode())
    return True


def ws_recv_message(rfile):
    """接收一条完整消息，返回 (opcode, payload bytes)；连接关闭返回 None"""
    header = recv_exact(rfile, 2)
    opcode = header[0] & 0x0F
    masked = header[1] & 0x80
    length = header[1] & 0x7F
    if length == 126:
        length = struct.unpack(">H", recv_exact(rfile, 2))[0]
    elif length == 127:
        length = struct.unpack(">Q", recv_exact(rfile, 8))[0]
    mask_key = recv_exact(rfile, 4) if masked else None
    payload = recv_exact(rfile, length)
    if mask_key:
        payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
    return opcode, payload


def ws_send_frame(sock, payload, opcode=0x1):
    header = bytes([0x80 | opcode])
    n = len(payload)
    if n < 126:
        header += bytes([n])
    elif n < 65536:
        header += bytes([126]) + struct.pack(">H", n)
    else:
        header += bytes([127]) + struct.pack(">Q", n)
    try:
        sock.sendall(header + payload)
    except Exception:
        pass


def ws_send_json(sock, data):
    ws_send_frame(sock, json.dumps(data, ensure_ascii=False).encode())


def ws_send_close(sock, code=1000, reason=""):
    """发送 WebSocket 关闭帧（含状态码），随后由调用方关闭 TCP。

    - 4001：同一账号异地登录被踢（PWA 约定：仅此码停止自动重连）
    - 1008：鉴权失败（token 无效/过期），客户端据此区分"被踢"与"token 过期"
    否则浏览器只报 1006（异常关闭），客户端无法区分原因。"""
    payload = struct.pack(">H", code)
    if reason:
        payload += reason.encode("utf-8")[:120]  # 控制帧负载上限 125 字节
    ws_send_frame(sock, payload, opcode=0x8)


# ── 工具函数 ──

def _sock_lock(conn):
    return conn["lock"] if conn else None


def send_to_user(user_id, data):
    """给单个用户发消息（每连接发送锁，防多线程并发 sendall 帧交错）"""
    with _lock:
        conn = connections.get(user_id)
        sock = conn["sock"] if conn else None
        slock = conn["lock"] if conn else None
    if sock and slock:
        with slock:
            ws_send_json(sock, data)


def broadcast_room(room_id, data, exclude=None):
    with _lock:
        room = rooms.get(room_id)
        if not room:
            return
        targets = [(uid, connections.get(uid)) for uid in list(room["members"])]
    for uid, conn in targets:
        if conn and (not exclude or uid != exclude):
            slock = conn.get("lock")
            if slock:
                with slock:
                    ws_send_json(conn["sock"], data)


def get_room_members(room_id):
    """返回房间成员列表（camelCase，与客户端 StudyRoomMember 对齐）"""
    with _lock:
        room = rooms.get(room_id)
        if not room:
            return []
        result = []
        for uid in room["members"]:
            conn = connections.get(uid)
            if conn:
                result.append({
                    "userId": uid,
                    "username": conn["username"],
                    "online": True,
                })
        return result


def _delete_room_db(room_id):
    """删除 DB 中的房间行（最后一个成员离开/房主删除时调用，防僵尸房挂列表）"""
    try:
        from db import get_conn
        pg = get_conn()
        pg.run("DELETE FROM study_rooms WHERE id = :rid", rid=room_id)
    except Exception as e:
        print(f"[ws] 清理房间 {room_id} 失败: {e}", file=sys.stderr)


def close_room(room_id):
    """房主删除房间：清理内存态并通知在线成员房间已关闭（room:closed）"""
    with _lock:
        closed = rooms.pop(room_id, None)
        if not closed:
            return
        for uid in list(closed["members"]):
            conn = connections.get(uid)
            if conn:
                conn["room_id"] = None
    for uid in list(closed["members"]):
        send_to_user(uid, {"type": "room:closed", "room_id": room_id})


def _move_user_to_room(user_id, new_room_id):
    """把用户移入新房间；若用户已在别的房间，先从旧房间成员位移除（防旧房残留成僵尸房）"""
    conn = connections.get(user_id)
    if not conn:
        return
    old_room_id = conn["room_id"]
    if old_room_id and old_room_id != new_room_id:
        old = rooms.get(old_room_id)
        if old:
            old["members"].discard(user_id)
            if not old["members"]:
                del rooms[old_room_id]
                _delete_room_db(old_room_id)
    conn["room_id"] = new_room_id


# ── 消息处理 ──

def handle_message(user_id, msg):
    """处理客户端消息；返回响应 dict（None = 无响应，纯广播）"""
    mtype = msg.get("type", "")

    # 请求-响应类
    if mtype == "room:create":
        return handle_room_create(user_id, msg)

    if mtype == "room:join":
        return handle_room_join(user_id, msg)

    if mtype == "p2p:online":
        return handle_p2p_online(user_id, msg)

    # fire-and-forget 类（广播）
    handlers = {
        "room:leave": handle_room_leave,
        "presence:update": handle_presence_update,
        "room:chat": handle_room_chat,
        "room:pomo_done": handle_pomo_done,
        "music:play": handle_music_play,
        "music:pause": handle_music_pause,
        "music:seek": handle_music_seek,
        "music:next": handle_music_next,
        "music:volume": handle_music_volume,
        "music:add_song": handle_music_add_song,
        "music:request_dj": handle_music_request_dj,
        "music:sync_state": handle_music_sync_state,
        "music:sync_config": handle_music_sync_config,
        "music:request_state": handle_music_request_state,
        "music:request_song": handle_music_request_song,
        "music:offer_song": handle_music_offer_song,
        "music:transfer_done": handle_music_transfer_done,
        "music:transfer_failed": handle_music_transfer_failed,
        "peer:offer": handle_peer_signal,
        "peer:answer": handle_peer_signal,
        "peer:ice": handle_peer_signal,
        "peer:bye": handle_peer_signal,
        # P2P 连通性测试工具（Phase 1.2+）
        "p2p:test_request": handle_p2p_test_request,
        "p2p:test_result": handle_p2p_test_result,
        "p2p:reverse_test_request": handle_p2p_reverse_test_request,
        "p2p:bidir_test_request": handle_p2p_bidir_test_request,
        # Phase 2 安装包种子：注册/心跳/注销/查询/通知发起
        "p2p:seed_register": handle_p2p_seed_register,
        "p2p:seed_heartbeat": handle_p2p_seed_heartbeat,
        "p2p:seed_unregister": handle_p2p_seed_unregister,
        "p2p:seed_list": handle_p2p_seed_list,
        "p2p:seed_fetch": handle_p2p_seed_fetch,
        "p2p:reverse_transfer_request": handle_p2p_reverse_transfer_request,
        "ping": handle_ping,
    }
    handler = handlers.get(mtype)
    if handler:
        handler(user_id, msg)
        return None
    return {"type": "error", "error": f"未知消息类型: {mtype}"}


# ── 自习室 ──

def handle_room_create(user_id, msg):
    """创建房间，返回 {type, room} 响应"""
    from db import get_conn
    pg = get_conn()
    name = msg.get("name", "未命名房间")
    max_members = msg.get("max_members", 50)
    password = msg.get("password", "")
    description = msg.get("description", "")

    rows = pg.run("""
        INSERT INTO study_rooms (name, owner_id, max_members, is_public, password, description)
        VALUES (:name, :uid, :max, :pub, :pw, :desc)
        RETURNING id, name
    """, name=name, uid=user_id, max=max_members, pub=(not password), pw=password, desc=description)
    room_id = str(rows[0][0])
    room_name = rows[0][1]

    with _lock:
        rooms[room_id] = {
            "name": room_name,
            "description": description,
            "members": {user_id},
            "dj": None,
            "music_state": {"action": "stop", "song_id": None, "position_ms": 0, "timestamp": 0},
            "sync_state": None,
            "transfer_mode": "immediate",
            "song_holders": {},
            "song_requests": {},
            "song_waiting": {},
        }
        _move_user_to_room(user_id, room_id)

    return {
        "type": "room:created",
        "room": {"id": room_id, "name": room_name, "description": description, "is_public": (not password)},
    }


def handle_room_join(user_id, msg):
    from db import get_conn
    pg = get_conn()
    room_id = msg.get("room_id", "")
    password = msg.get("password", "")

    rows = pg.run("SELECT id, name, password, description FROM study_rooms WHERE id = :rid", rid=room_id)
    if not rows:
        return {"type": "error", "error": "房间不存在"}
    db_pw = rows[0][2]
    if db_pw and db_pw != password:
        return {"type": "error", "error": "房间密码错误"}

    with _lock:
        if room_id not in rooms:
            rooms[room_id] = {
                "name": rows[0][1],
                "description": rows[0][3],
                "members": set(),
                "dj": None,
                "music_state": {"action": "stop", "song_id": None, "position_ms": 0, "timestamp": 0},
                "sync_state": None,
                "transfer_mode": "immediate",
                "song_holders": {},
                "song_requests": {},
                "song_waiting": {},
            }
        rooms[room_id]["members"].add(user_id)
        _move_user_to_room(user_id, room_id)
        username = (connections.get(user_id) or {}).get("username", "")

    try:
        pg.run("INSERT INTO room_members_history (room_id, user_id) VALUES (:rid, :uid)",
               rid=room_id, uid=user_id)
    except Exception:
        pass

    # 广播加入事件
    broadcast_room(room_id, {"type": "room:member_joined", "user": {"id": user_id, "username": username}})
    broadcast_room(room_id, {"type": "room:members", "members": get_room_members(room_id)})

    # 若房间有音乐播放，同步给新成员
    with _lock:
        ms = rooms[room_id]["music_state"]
        sync_state = rooms[room_id].get("sync_state")
        dj_id = rooms[room_id].get("dj")
        dj_username = (connections.get(dj_id) or {}).get("username", "") if dj_id else ""
    if ms["action"] != "stop":
        send_to_user(user_id, {
            "type": "music:state",
            "action": ms["action"],
            "song_id": ms["song_id"],
            "position_ms": ms["position_ms"],
            "timestamp_server": ms["timestamp"],
        })
    if sync_state:
        # v4.5.4：新成员补发最近一次全量状态快照
        send_to_user(user_id, sync_state)
    if dj_id:
        # v4.5.8：新成员补发 DJ 信息（解决听众"能听歌但显示 DJ 暂无"）
        send_to_user(user_id, {"type": "music:dj_changed", "dj_user_id": dj_id, "dj_username": dj_username})

    return {"type": "room:joined"}


def handle_room_leave(user_id, msg):
    from db import get_conn
    pg = get_conn()
    room_id = msg.get("room_id") or (connections.get(user_id) or {}).get("room_id")
    if not room_id:
        return
    closed_room = None
    with _lock:
        room = rooms.get(room_id)
        if not room:
            return
        room["members"].discard(user_id)
        conn = connections.get(user_id)
        if conn:
            conn["room_id"] = None
            conn["status"] = "idle"
        if not room["members"]:
            del rooms[room_id]
            closed_room = room_id
    if closed_room:
        # 僵尸房清理：最后一个成员离开，删除 DB 房间行
        _delete_room_db(closed_room)
        return
    try:
        pg.run("UPDATE room_members_history SET left_at = NOW() WHERE room_id = :rid AND user_id = :uid AND left_at IS NULL",
               rid=room_id, uid=user_id)
    except Exception:
        pass
    broadcast_room(room_id, {"type": "room:member_left", "user_id": user_id})
    broadcast_room(room_id, {"type": "room:members", "members": get_room_members(room_id)})


def handle_presence_update(user_id, msg):
    status = msg.get("status", "idle")
    room_id = msg.get("room_id")
    with _lock:
        conn = connections.get(user_id)
        if conn:
            conn["status"] = status
            if room_id:
                conn["room_id"] = room_id
    if room_id and room_id in rooms:
        broadcast_room(room_id, {"type": "room:member_status", "user_id": user_id, "status": status})


def handle_room_chat(user_id, msg):
    room_id = (connections.get(user_id) or {}).get("room_id")
    if not room_id:
        return
    username = (connections.get(user_id) or {}).get("username", "")
    broadcast_room(room_id, {
        "type": "room:chat",
        "user_id": user_id,
        "username": username,
        "message": msg.get("message", ""),
        "time": int(time.time() * 1000),
    })


def handle_pomo_done(user_id, msg):
    room_id = msg.get("room_id") or (connections.get(user_id) or {}).get("room_id")
    if not room_id:
        return
    username = (connections.get(user_id) or {}).get("username", "")
    broadcast_room(room_id, {
        "type": "room:pomo_done",
        "user_id": user_id,
        "username": username,
        "mode": msg.get("mode", "focus"),
    })


# ── 同步听歌 ──

def _music_broadcast(user_id, msg, action):
    room_id = (connections.get(user_id) or {}).get("room_id")
    if not room_id or room_id not in rooms:
        return
    ts = int(time.time() * 1000)
    with _lock:
        state = rooms[room_id]["music_state"]
    data = {"type": "music:state", "action": action, "timestamp_server": ts}
    if action == "play":
        data["song_id"] = msg.get("song_id")
        data["position_ms"] = msg.get("position_ms", 0)
        state.update({"action": "play", "song_id": msg.get("song_id"), "position_ms": msg.get("position_ms", 0), "timestamp": ts})
    elif action == "pause":
        data["position_ms"] = msg.get("position_ms", 0)
        state.update({"action": "pause", "position_ms": msg.get("position_ms", 0), "timestamp": ts})
    elif action == "seek":
        data["position_ms"] = msg.get("position_ms", 0)
        state.update({"position_ms": msg.get("position_ms", 0), "timestamp": ts})
    elif action == "next":
        data["song_id"] = msg.get("song_id")
        data["position_ms"] = 0
        state.update({"action": "play", "song_id": msg.get("song_id"), "position_ms": 0, "timestamp": ts})
    broadcast_room(room_id, data)


def handle_music_play(user_id, msg):
    _music_broadcast(user_id, msg, "play")


def handle_music_pause(user_id, msg):
    _music_broadcast(user_id, msg, "pause")


def handle_music_seek(user_id, msg):
    _music_broadcast(user_id, msg, "seek")


def handle_music_next(user_id, msg):
    _music_broadcast(user_id, msg, "next")


def handle_music_volume(user_id, msg):
    room_id = (connections.get(user_id) or {}).get("room_id")
    if not room_id:
        return
    broadcast_room(room_id, {"type": "music:volume", "user_id": user_id, "volume": msg.get("volume", 0.8)},
                   exclude=user_id)


def handle_music_add_song(user_id, msg):
    room_id = (connections.get(user_id) or {}).get("room_id")
    if not room_id:
        return
    broadcast_room(room_id, {"type": "music:playlist_updated", "songs": [msg]})


# ── v4.5.4 全量状态同步 + P2P 传歌 ──

# ── v4.11 多听众传歌去重（"持有者只上行一份，服务器扇出给多人"）──
#
# EXTERNAL-INTERFACES.md §5 规定服务器"可同时转发给房间内所有缺歌者，减少重复传输，
# 由服务器实现取舍"。转发端本来就有（handle_music_offer_song 把每个分片扇出给本轮全体），
# 缺的是**不要重复要求持有者再传一遍** —— 实测 1 DJ → 3 听众时持有者被要求服务 3 次，
# 而上行正是家庭宽带最紧的一段。本版把同一首歌的传输组织成"轮次（round）"：
#
#   · 一轮 = 一次 music:song_requested + 持有者随后回传的一串分片；
#     该轮分片扇出给本轮 uids 里的所有听众 → 持有者只上行一份。
#   · 只有"本轮尚未回传任何分片"且"路径（p2p）与起点（from_chunk）一致"时才允许
#     新听众并入本轮（真去重）。已开始回传才加入的听众会缺前面那些分片：不能塞进
#     uids（会拿到缺头文件），也不能让它从当前进度续传（from_chunk 的语义是
#     "我已保存 N 片"，新听众是 0 片，从中间开始只会写出缺头文件）。
#   · 带 p2p 标志的请求必须独立成轮：P2P 是持有者与单个请求者之间的 DataChannel，
#     点对点、无法扇出；把它并进别人的轮会让它一直收不到数据（直到超时）。
#     所以只有"中转轮"参与合并 —— 生产端默认 p2p=true，其行为与本版之前一致。
#   · 同一时刻只允许一轮在飞：同一首歌并发多轮会互相串流（同一位听众收到别人那一轮
#     的重复分片），而且任一轮的 transfer_done 会把整个请求状态 pop 掉 → 另一轮的
#     分片被丢弃、听众收到过早的 transfer_done（合并出残缺文件）。
#     故不能并入者先排队（pending），本轮结束后再为它们单独开一轮。
REREQUEST_STALL_SEC = 8.0  # 同一听众重复请求：距上次进展不足该秒数即忽略（客户端 12s×3 重试）


def _song_requested_msg(song_id, requester, p2p, from_chunk):
    """构造 music:song_requested（字段名与 v4.5.9 / Phase 1 完全一致，仅按需携带）"""
    data = {"type": "music:song_requested", "song_id": song_id, "requester_user_id": requester}
    if from_chunk:  # v4.5.9 断点续传：仅续传时携带（0 与不携带对持有者等价）
        data["from_chunk"] = from_chunk
    if p2p:  # Phase 1：请求方支持 WebRTC 直连，持有者优先尝试 P2P 直传
        data["p2p"] = True
    return data


def _new_song_round(uid, p2p, from_chunk, now):
    """新开一轮传歌：uids = 本轮要服务的听众（分片会扇出给他们全部）"""
    return {
        "uids": {uid},             # 本轮听众（分片扇出给全体）
        "requester": uid,          # 本轮 music:song_requested 的 requester_user_id
        "p2p": bool(p2p),          # 本轮是否带 p2p 标志（带则持有者可能走 P2P，不能合并）
        "from_chunk": from_chunk,  # 本轮起始分片（起点不同的听众不能并入同一轮）
        "chunks": 0,               # 本轮已被转发的分片数（0 = 尚未开始，可安全合并）
        "last_chunk_at": 0.0,      # 最近一次收到本组分片的时刻（停滞判定）
        "asked_at": now,           # 本轮 song_requested 发出时刻（停滞判定）
        "started": now,            # 活动时钟（_check_transfer_timeouts 的 30s 超时用）
        "pending": [],             # 本轮开始后才请求的听众 [{uid, p2p, from_chunk}]，排队另起一轮
    }


def _promote_pending_round(req, now):
    """本轮结束/超时：把排队中的听众提升为下一轮（就地改写 req）。

    中转轮可以继续吸收"路径与起点一致"的排队者（它们同样需要从起点开始的整份数据，
    合成一轮仍只是一次上行）；带 p2p 的轮不行 —— P2P 是点对点连接，一轮只能服务一个请求者。
    返回 True 表示还有下一轮（调用方需为新一轮发 music:song_requested）；
    False 表示无人等待（调用方应删除该歌的请求状态）。"""
    pending = req["pending"]
    if not pending:
        return False
    head = pending.pop(0)
    uids = {head["uid"]}
    if not head["p2p"]:
        rest = []
        for p in pending:
            if not p["p2p"] and p["from_chunk"] == head["from_chunk"]:
                uids.add(p["uid"])
            else:
                rest.append(p)
        req["pending"] = rest
    req["uids"] = uids
    req["requester"] = head["uid"]
    req["p2p"] = head["p2p"]
    req["from_chunk"] = head["from_chunk"]
    req["chunks"] = 0
    req["last_chunk_at"] = 0.0
    req["asked_at"] = now
    req["started"] = now
    return True


def _maybe_wait_all(room_id, song_id):
    """wait_all 协调：有缺歌成员 → 广播 music:song_waiting；全员就绪 → music:songs_ready"""
    with _lock:
        room = rooms.get(room_id)
        if not room or not song_id or room.get("transfer_mode") != "wait_all":
            return
        st = room["song_waiting"].get(song_id, {"waiting": False, "ready": False, "started": 0})
        req = room["song_requests"].get(song_id)
        # v4.11：pending（本轮结束后才另起一轮的排队听众）同样算"缺歌"，
        # 否则还有人在等待时会误广播 songs_ready（"全员就绪"）
        missing = bool(req and (req["uids"] or req["pending"]))
        broadcast = None
        if missing:
            if not st["waiting"]:
                st.update(waiting=True, ready=False, started=time.time())
                broadcast = {"type": "music:song_waiting", "song_id": song_id}
        elif st["waiting"] and not st["ready"]:
            st.update(waiting=False, ready=True)
            broadcast = {"type": "music:songs_ready", "song_id": song_id}
        room["song_waiting"][song_id] = st
    if broadcast:
        broadcast_room(room_id, broadcast)


def _check_transfer_timeouts():
    """传输状态清理：持有者超过 30s 未回传分片 → 广播 transfer_failed 给本轮听众；
    若还有排队中的听众，改为把本轮作废并为它们开下一轮（避免它们一直干等）。
    避免同一首歌传输状态永久卡死（覆盖客户端 12s×3 重试窗口，重试后能拿到结果而非干等）。
    同时检查 wait_all 超时（60s）强制广播 music:songs_ready。"""
    with _lock:
        overdue = []
        restarted = []
        ready = []
        now = time.time()
        for rid, room in rooms.items():
            for sid, req in list(room["song_requests"].items()):
                if now - req["started"] > 30:
                    overdue.append((rid, sid, set(req["uids"])))
                    if _promote_pending_round(req, now):
                        # 本轮作废，但排队的听众还没被服务过 → 立刻为它们开下一轮
                        holder = _pick_song_holder(room, sid)
                        if holder:
                            restarted.append((holder, _song_requested_msg(
                                sid, req["requester"], req["p2p"], req["from_chunk"])))
                    else:
                        del room["song_requests"][sid]
            for sid, st in room["song_waiting"].items():
                if st["waiting"] and not st["ready"] and now - st["started"] > 60:
                    st.update(waiting=False, ready=True)
                    ready.append((rid, sid))
    for rid, sid, uids in overdue:
        for uid in uids:
            send_to_user(uid, {"type": "music:transfer_failed", "song_id": sid})
    for holder, data in restarted:
        send_to_user(holder, data)
    for rid, sid in ready:
        broadcast_room(rid, {"type": "music:songs_ready", "song_id": sid})


def handle_music_sync_state(user_id, msg):
    """DJ 全量状态快照：原样广播给房间全体 + timestamp_server，并保存为房间最近快照"""
    room_id = (connections.get(user_id) or {}).get("room_id")
    if not room_id or room_id not in rooms:
        return
    ts = int(time.time() * 1000)
    song_id = msg.get("song_id")
    data = dict(msg)
    data["timestamp_server"] = ts
    with _lock:
        room = rooms[room_id]
        room["sync_state"] = data
        room["transfer_mode"] = msg.get("transfer_mode", room["transfer_mode"])
        if song_id:
            room["song_holders"].setdefault(song_id, set()).add(user_id)  # DJ 视为歌曲持有者
    broadcast_room(room_id, data)
    if song_id:
        _maybe_wait_all(room_id, song_id)


def handle_music_sync_config(user_id, msg):
    """DJ 切换传歌方案：透传给房间全体"""
    room_id = (connections.get(user_id) or {}).get("room_id")
    if not room_id or room_id not in rooms:
        return
    mode = msg.get("transfer_mode", "immediate")
    with _lock:
        rooms[room_id]["transfer_mode"] = mode
    broadcast_room(room_id, {"type": "music:sync_config", "transfer_mode": mode})


def handle_music_request_state(user_id, msg):
    """听众请求补发状态快照。
    v4.5.8：房间有 DJ → 向 DJ 单发 music:state_request（DJ 广播一次实时 music:sync_state，请求者拿到实时进度）；
    无 DJ → 回发保存的快照；无论有无 DJ 都补发 dj_changed（若有 DJ）。"""
    room_id = (connections.get(user_id) or {}).get("room_id")
    if not room_id or room_id not in rooms:
        return
    with _lock:
        room = rooms[room_id]
        sync_state = room.get("sync_state")
        dj_id = room.get("dj")
        dj_username = (connections.get(dj_id) or {}).get("username", "") if dj_id else ""
    if dj_id:
        # 有 DJ：让 DJ 立即广播实时状态（请求者拿到 DJ 广播时刻的实时进度）
        send_to_user(dj_id, {"type": "music:state_request"})
        send_to_user(user_id, {"type": "music:dj_changed", "dj_user_id": dj_id, "dj_username": dj_username})
    else:
        # 无 DJ：回发保存的快照
        if sync_state:
            send_to_user(user_id, sync_state)


def _pick_song_holder(room, song_id, exclude=None):
    """选择歌曲持有者：优先 DJ，其次登记过的持有者，最后房间任一成员"""
    dj = room.get("dj")
    if dj and dj != exclude:
        return dj
    for uid in room["song_holders"].get(song_id, set()):
        if uid != exclude:
            return uid
    for uid in list(room["members"]):
        if uid != exclude:
            return uid
    return None


def handle_music_request_song(user_id, msg):
    """听众请求缺失歌曲：选持有者并发 music:song_requested（v4.11 起按"轮次"去重）。

    - 本轮尚未回传任何分片、且路径（p2p）与起点（from_chunk）一致 → 新听众只并入本轮 uids，
      不重复要求持有者再传一遍（服务器转发端本来就会把分片扇出给本轮全体）
    - 本轮已开始回传 / 带 p2p / 起点不同 → 排队（pending），本轮结束后单独开一轮，保证数据完整
    - 同一听众重复请求（客户端 12s×3 重试）：传输有进展即忽略，停滞 REREQUEST_STALL_SEC 才重新触发
    - 请求携带 `from_chunk`（已保存分片数）时，透传给持有者（续传，非从头重传）"""
    room_id = (connections.get(user_id) or {}).get("room_id")
    song_id = msg.get("song_id")
    if not room_id or room_id not in rooms or not song_id:
        return
    try:
        from_chunk = int(msg.get("from_chunk") or 0)
    except (TypeError, ValueError):
        from_chunk = 0
    p2p = bool(msg.get("p2p"))
    now = time.time()
    trigger = None  # 非 None 表示本轮需要（重新）向持有者发 music:song_requested
    with _lock:
        room = rooms[room_id]
        req = room["song_requests"].get(song_id)
        if req is None:
            # 本轮第一位请求者：记录本轮并向持有者发起传输
            req = _new_song_round(user_id, p2p, from_chunk, now)
            room["song_requests"][song_id] = req
            trigger = req
        elif user_id in req["uids"]:
            # 同一听众的重复请求（客户端 12s×3 重试）：有进展就忽略（否则持有者上行被放大），
            # 停滞超过 REREQUEST_STALL_SEC 才重新触发 —— 保留"重试能自愈"的能力。
            # 若本轮只有它一个人且它报的 from_chunk 更靠后，按它的续传点重开本轮（等价旧行为）。
            if now - max(req["last_chunk_at"], req["asked_at"]) > REREQUEST_STALL_SEC:
                if req["uids"] == {user_id} and from_chunk != req["from_chunk"]:
                    req["from_chunk"] = from_chunk
                req["asked_at"] = now
                req["started"] = now
                trigger = req
        elif any(p["uid"] == user_id for p in req["pending"]):
            req["started"] = now  # 已在本轮之后的队列里：等本轮结束，不重复排队
        elif (req["chunks"] == 0 and not req["p2p"] and not p2p
              and req["from_chunk"] == from_chunk):
            # ★ 去重：本轮尚未回传任何分片、且路径与起点一致 → 只并入 uids。
            # 持有者不再被要求重传一遍，本轮分片会扇出给全体（含新加入者）。
            req["uids"].add(user_id)
            req["started"] = now
        else:
            # 本轮已开始回传（新加入者会缺前面那些分片）／路径或起点不同 → 排队另起一轮
            req["pending"].append({"uid": user_id, "p2p": p2p, "from_chunk": from_chunk})
            req["started"] = now
        holder = _pick_song_holder(room, song_id, exclude=user_id) if trigger else None
    # v4.10：请求落库即触发 wait_all 协调（此处条件必然满足）。
    # 原先只在 handle_music_sync_state / _forward_transfer_result 里触发，而这两处
    # 在现实中都不会命中：持有者发送循环只花 ~20ms（分片交给 socket 缓冲即返回），
    # 真正耗时的是服务器中转（实测 11.6s），所以「传歌期间每 5s 广播」根本不会发生；
    # 传输结束时请求又已被 pop。结果 song_waiting 从未发出，wait_all 静默退化成 immediate。
    _maybe_wait_all(room_id, song_id)
    if holder:
        # 与 _forward_transfer_result / _check_transfer_timeouts 用同一个构造函数，
        # 避免三处各写一遍字段导致漂移（from_chunk=0 与不携带对持有者等价）
        send_to_user(holder, _song_requested_msg(song_id, user_id, p2p, from_chunk))


def handle_music_offer_song(user_id, msg):
    """持有者回传分片：登记持有者，转发 music:song_chunk 给所有请求该歌的成员（分片到达即重置超时）"""
    room_id = (connections.get(user_id) or {}).get("room_id")
    song_id = msg.get("song_id")
    if not room_id or room_id not in rooms or not song_id:
        return
    with _lock:
        room = rooms[room_id]
        room["song_holders"].setdefault(song_id, set()).add(user_id)
        req = room["song_requests"].get(song_id)
        requesters = set(req["uids"]) if req else set()
        requesters.discard(user_id)
        if req:
            now = time.time()
            req["started"] = now  # 传输活跃中，重置超时
            # ★ 去重的关键判据：本轮一旦开始回传分片，后续请求者就**不可再并入**
            # （它拿不到已转发过的前半段，只会拼出残缺文件）。handle_music_request_song
            # 靠 `req["chunks"] == 0` 判断"本轮尚未开始" —— 不在这里递增，该判据恒为真，
            # 任何中途加入者都会被并进来并收到残缺数据（实测：只拿到 12/27 片）。
            req["chunks"] += 1
            req["last_chunk_at"] = now  # 停滞判定（REREQUEST_STALL_SEC）用
    if not requesters:
        return
    data = {
        "type": "music:song_chunk",
        "song_id": song_id,
        "chunk_index": msg.get("chunk_index", 0),
        "total_chunks": msg.get("total_chunks", 0),
        "chunk_size": msg.get("chunk_size", 0),
        "data_base64": msg.get("data_base64", ""),
    }
    for uid in requesters:
        send_to_user(uid, data)


def _forward_transfer_result(user_id, msg, done):
    """传输结束（完成/失败）：通知本轮听众；若还有排队者则为它们开下一轮；再检查 wait_all。

    v4.11：**不再无条件 pop 掉整首歌的请求状态**。本轮结束后若还有排队听众
    （传输已开始才请求的人 —— 他们缺前面那些分片，不能并入本轮），就地提升为下一轮
    并向持有者重新发起；否则他们会被永久卡住：既拿不到分片，也没有下一轮，
    而本轮结束的 transfer_done 还会告诉他们"已完成"（客户端只能靠分片校验发现残缺再续传）。
    """
    room_id = (connections.get(user_id) or {}).get("room_id")
    song_id = msg.get("song_id")
    if not room_id or room_id not in rooms or not song_id:
        return
    now = time.time()
    restarted = None
    with _lock:
        room = rooms[room_id]
        req = room["song_requests"].get(song_id)
        # 先取本轮听众（_promote_pending_round 会就地覆盖 req["uids"]，必须先拷贝）
        requesters = set(req["uids"]) if req else set()
        requesters.discard(user_id)
        if req is not None:
            if _promote_pending_round(req, now):
                holder = _pick_song_holder(room, song_id, exclude=req["requester"])
                if holder:
                    restarted = (holder, _song_requested_msg(
                        song_id, req["requester"], req["p2p"], req["from_chunk"]))
                else:
                    # 没有可用持有者：不留无人服务的空轮，直接清掉（否则会卡到 30s 超时）
                    del room["song_requests"][song_id]
            else:
                del room["song_requests"][song_id]
    for uid in requesters:
        send_to_user(uid, {"type": "music:transfer_done" if done else "music:transfer_failed", "song_id": song_id})
    if restarted:
        send_to_user(restarted[0], restarted[1])
    _maybe_wait_all(room_id, song_id)


def handle_music_transfer_done(user_id, msg):
    _forward_transfer_result(user_id, msg, done=True)


def handle_music_transfer_failed(user_id, msg):
    _forward_transfer_result(user_id, msg, done=False)


def handle_music_request_dj(user_id, msg):
    room_id = (connections.get(user_id) or {}).get("room_id")
    if not room_id or room_id not in rooms:
        return
    with _lock:
        rooms[room_id]["dj"] = user_id
        username = (connections.get(user_id) or {}).get("username", "")
        sync_state = rooms[room_id].get("sync_state")
    broadcast_room(room_id, {"type": "music:dj_changed", "dj_user_id": user_id, "dj_username": username})
    if sync_state:
        # DJ 切换后补发最近状态快照，让新 DJ/听众快速对齐
        send_to_user(user_id, sync_state)


# ── P2P 信令（Phase 0：WebRTC 牵线）──

def handle_peer_signal(user_id, msg):
    """P2P 信令中转：peer:offer / peer:answer / peer:ice / peer:bye。

    服务器只转发 KB 级信令（SDP/ICE 候选）到目标用户，**不碰媒体数据**；
    两端随后经 NAT 打洞建立的 WebRTC DataChannel 直连传输（音乐传歌 / 安装包种子）。
    - 定向：按 `to_user_id` 发给目标，回传时附加 `from_user_id`
    - 失败（目标不在线）静默丢弃，由发起端超时回退
    """
    to_user_id = msg.get("to_user_id")
    if not to_user_id or to_user_id == user_id:
        return
    forward = {k: v for k, v in msg.items() if k not in ("type", "to_user_id")}
    forward["from_user_id"] = user_id
    send_to_user(to_user_id, {"type": msg["type"], **forward})


# ── P2P 连通性测试工具（Phase 1.2+，2026-08-07）──
# 设置面板"P2P 测试工具"：客户端列出在线用户 → 选目标发起 WebRTC 建连测试。
# 仅做 KB 级信令转发 + 在线目录，媒体数据仍走两端 WebRTC 直连（同 peer:*）。

def handle_p2p_online(user_id, msg):
    """P2P 测试：返回在线用户列表（请求-响应，回显 id）。
    排除自己；仅返回已登录且 WS 在线的用户（供发起方选测试目标）。"""
    with _lock:
        users = [
            {"userId": uid, "username": conn["username"]}
            for uid, conn in connections.items()
            if uid != user_id
        ]
    print(f"[ws] p2p:online from {user_id} -> {len(users)} others: {[u['username'] for u in users]}", file=sys.stderr)
    return {"type": "p2p:online", "users": users}


def handle_p2p_test_request(user_id, msg):
    """P2P 测试请求：转发给目标客户端，目标自动挂起 WebRTC 接收并回传结果。
    - 目标离线静默丢弃，发起端 8s 超时判定失败
    - 仅在线用户即可互测（调试工具，测试数据量小，自动关闭）
    - `tag`（v4.7.7）：测试工具 3 种打洞方式用不同 tag 区分多条并发连接"""
    to_user_id = msg.get("to_user_id")
    if not to_user_id or to_user_id == user_id:
        return
    with _lock:
        target = connections.get(to_user_id)
        if not target:
            return
        from_name = (connections.get(user_id) or {}).get("username", "")
    forward = {
        "type": "p2p:test_request",
        "from_user_id": user_id,
        "from_username": from_name,
    }
    tag = msg.get("tag")
    if tag:
        forward["tag"] = tag
    send_to_user(to_user_id, forward)


def handle_p2p_test_result(user_id, msg):
    """P2P 测试结果回传：目标端测试完成后，把结果发给发起方（发起方 UI 显示双方视角）。"""
    to_user_id = msg.get("to_user_id")
    if not to_user_id or to_user_id == user_id:
        return
    with _lock:
        from_name = (connections.get(user_id) or {}).get("username", "")
    send_to_user(to_user_id, {
        "type": "p2p:test_result",
        "from_user_id": user_id,
        "from_username": from_name,
        "ok": bool(msg.get("ok")),
        "ms": msg.get("ms"),
        "speed_bps": msg.get("speed_bps"),
        "bytes": msg.get("bytes"),
        "error": msg.get("error") if msg.get("error") else None,
    })


def handle_p2p_reverse_test_request(user_id, msg):
    """P2P 反向测试请求（v4.7.3）：发起方首个方向打洞失败后，请求目标端反向发起。

    目标端收到后作为 offerer 推测试数据回发起方——双向打洞容错：
    只要有一边能打通即判为成功，两边都失败才判失败。
    `tag`（v4.7.7）：目标端按 tag 发起对应连接。
    """
    to_user_id = msg.get("to_user_id")
    if not to_user_id or to_user_id == user_id:
        return
    with _lock:
        target = connections.get(to_user_id)
        if not target:
            return
        from_name = (connections.get(user_id) or {}).get("username", "")
    forward = {
        "type": "p2p:reverse_test_request",
        "from_user_id": user_id,
        "from_username": from_name,
    }
    tag = msg.get("tag")
    if tag:
        forward["tag"] = tag
    send_to_user(to_user_id, forward)


def handle_p2p_bidir_test_request(user_id, msg):
    """AB 互相打洞测试请求（v4.7.7）：目标端收到后**同时**挂起 answerer（tag1，
    接发起方 offer）与发起 offerer（tag2，发起方挂起接）——两条连接同时打洞，
    双向同时打通测速，验证"双方同时狂暴发包"打出的洞是否比单向更稳定。"""
    to_user_id = msg.get("to_user_id")
    if not to_user_id or to_user_id == user_id:
        return
    tag1 = msg.get("tag1")
    tag2 = msg.get("tag2")
    if not tag1 or not tag2:
        return
    with _lock:
        target = connections.get(to_user_id)
        if not target:
            return
        from_name = (connections.get(user_id) or {}).get("username", "")
    send_to_user(to_user_id, {
        "type": "p2p:bidir_test_request",
        "from_user_id": user_id,
        "from_username": from_name,
        "tag1": tag1,
        "tag2": tag2,
    })


# ── 安装包种子（Phase 2，P2P 分享安装包）──

def handle_p2p_seed_register(user_id, msg):
    """种子注册：客户端开启"分享安装包"后上报持有的安装包（版本 + 文件名 + 大小）。
    同一用户重复注册直接覆盖（重新开启分享 / 分享文件变化）。"""
    version = msg.get("version")
    file_name = msg.get("file")
    if not version or not file_name:
        return
    with _lock:
        p2p_seeds[user_id] = {
            "version": version,
            "file": file_name,
            "size": int(msg.get("size") or 0),
            "last_seen": time.time(),
        }


def handle_p2p_seed_heartbeat(user_id, msg):
    """种子心跳保活（客户端每 30s 发一次，SEED_TTL 秒无心跳视为离线）"""
    with _lock:
        if user_id in p2p_seeds:
            p2p_seeds[user_id]["last_seen"] = time.time()


def handle_p2p_seed_unregister(user_id, msg):
    """种子注销：用户主动关闭分享时调用"""
    with _lock:
        p2p_seeds.pop(user_id, None)


def handle_p2p_seed_list(user_id, msg):
    """查询在线种子：返回持有指定版本安装包的种子列表（不含自己），
    每项含 userId + username（v4.7.3 起附 username，供下载端 UI 显示来源）。
    顺便清理超时未心跳的僵尸种子。"""
    version = msg.get("version")
    now = time.time()
    with _lock:
        expired = [u for u, s in p2p_seeds.items() if now - s["last_seen"] > SEED_TTL]
        for u in expired:
            p2p_seeds.pop(u, None)
        if version:
            seed_ids = [u for u, s in p2p_seeds.items() if s["version"] == version and u != user_id]
        else:
            seed_ids = [u for u in p2p_seeds.keys() if u != user_id]
        peers = [
            {
                "userId": uid,
                "username": (connections.get(uid) or {}).get("username", ""),
            }
            for uid in seed_ids
        ]
    resp = {"type": "p2p:seed_list", "peers": peers, "version": version or ""}
    if msg.get("id") is not None:
        resp["id"] = msg["id"]  # 请求-响应：回显 id 供客户端 ws::request 匹配
    send_to_user(user_id, resp)


def handle_p2p_seed_fetch(user_id, msg):
    """下载端请求种子端发起 P2P 传输（v4.6.6 补齐种子端后新增）。

    向种子端（to_user_id）转发 `p2p:seed_request`（带发起者 user_id），
    种子端收到后发起 WebRTC offer 推安装包分片——此前种子端从不主动发起，
    下载端只能挂 10s 超时回退服务器/GitHub 下载。"""
    to_user_id = msg.get("to_user_id")
    version = msg.get("version")
    if not to_user_id or not version or to_user_id == user_id:
        return
    send_to_user(to_user_id, {
        "type": "p2p:seed_request",
        "from_user_id": user_id,
        "version": version,
    })


def handle_p2p_reverse_transfer_request(user_id, msg):
    """P2P 反向传输请求（v4.7.5 反向打洞）：下载端通知持有端挂起 answerer+sender。

    下载端正常方向（持有端作 offerer）建连失败后发送，向持有端（to_user_id）转发：
    持有端挂起 answerer+sender（DataChannel 全双工，在收到的 channel 上发数据），
    下载端随后作 offerer 反向发起协商。音乐传歌带 song_id；安装包分享带 version。
    `parallel`（v4.7.7）：下载端请求 N 条并行连接分片传输；0/缺省 = 单连接。"""
    to_user_id = msg.get("to_user_id")
    song_id = msg.get("song_id") or ""
    version = msg.get("version") or ""
    if not to_user_id or to_user_id == user_id or (not song_id and not version):
        return
    forward = {
        "type": "p2p:reverse_transfer_request",
        "from_user_id": user_id,
        "song_id": song_id,
        "version": version,
    }
    parallel = msg.get("parallel")
    if parallel and int(parallel) > 1:
        forward["parallel"] = int(parallel)
    send_to_user(to_user_id, forward)

# ── 心跳 ──

def handle_ping(user_id, msg):
    resp = {"type": "pong", "server_time": int(time.time() * 1000)}
    if msg.get("id") is not None:
        resp["id"] = msg["id"]  # 请求-响应：回显 id 供客户端 ws::request 匹配（v4.6.6 时钟对齐用）
    send_to_user(user_id, resp)


# ── 连接生命周期 ──

def handle_ws_connection(sock, rfile, headers, query):
    """处理一条 WebSocket 连接（握手 → 认证 → 消息循环），阻塞直到断开"""
    if not ws_handshake(sock, rfile, headers):
        return

    params = urllib.parse.parse_qs(query)
    token = params.get("token", [None])[0]
    payload = verify_jwt(token) if token else None
    if not payload:
        # 鉴权失败：发关闭帧 1008（token 无效/过期），区别于"被踢 4001"
        print("[ws] 鉴权失败，关闭连接 (code=1008)", file=sys.stderr)
        ws_send_close(sock, 1008, "token invalid or expired")
        time.sleep(0.2)
        sock.close()
        return

    user_id = payload["sub"]
    username = payload.get("email", "user")

    # 降低小帧（心跳/控制消息）延迟，避免 Nagle 算法累积
    try:
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    except Exception:
        pass

    # 同用户已有旧连接（断线重连/多端）：先清理旧连接，保证单连接语义
    with _lock:
        old = connections.get(user_id)
        if old and old["sock"] is not sock:
            old_room = old["room_id"]
            if old_room and old_room in rooms:
                rooms[old_room]["members"].discard(user_id)
                if not rooms[old_room]["members"]:
                    del rooms[old_room]
                    _delete_room_db(old_room)
            try:
                # 踢人关闭码 4001（PWA 约定：被踢即停止自动重连，避免双端互踢死循环）
                print("[ws] 同账号新连接，踢旧连接 (code=4001)", file=sys.stderr)
                ws_send_close(old["sock"], 4001, "logged in elsewhere")
                time.sleep(0.2)  # 确保关闭帧先送达旧连接
                old["sock"].close()
            except Exception:
                pass

    with _lock:
        connections[user_id] = {"sock": sock, "wfile": rfile, "username": username,
                                "room_id": None, "status": "idle", "lock": threading.Lock()}
    try:
        peer = sock.getpeername()[0]
    except Exception:
        peer = "?"
    print(f"[ws] 连接建立: user={user_id} ip={peer}", file=sys.stderr)

    try:
        while True:
            result = ws_recv_message(rfile)
            if result is None:
                break
            opcode, payload_bytes = result
            if opcode == 0x8:  # close
                break
            if opcode == 0x9:  # ping
                with _lock:
                    conn = connections.get(user_id)
                    slock = conn["lock"] if conn else None
                if slock:
                    with slock:
                        ws_send_frame(sock, payload_bytes, opcode=0xA)
                continue
            if opcode == 0xA:  # pong
                continue
            if opcode not in (0x1, 0x2):  # 只处理 text/binary
                continue
            try:
                msg = json.loads(payload_bytes.decode())
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue
            if not isinstance(msg, dict):
                continue

            try:
                response = handle_message(user_id, msg)
            except Exception as e:
                print(f"[ws] 处理消息异常: {e}", file=sys.stderr)
                response = {"type": "error", "error": "服务器内部错误"}

            # 请求-响应：回显同名 id（加锁，防与广播线程并发 sendall 交错）
            if response is not None:
                resp = dict(response)
                if msg.get("id") is not None:
                    resp["id"] = msg["id"]
                with _lock:
                    conn = connections.get(user_id)
                    slock = conn["lock"] if conn else None
                if slock:
                    with slock:
                        ws_send_json(sock, resp)
    except (ConnectionError, socket.error, OSError):
        pass
    finally:
        cleanup_user(user_id, sock)
        try:
            sock.close()
        except Exception:
            pass


def cleanup_user(user_id, sock=None):
    """连接断开时清理：只清理 sock 匹配的当前连接（同用户新连接已替换旧连接时，旧连接在此直接跳过）"""
    closed_room = None
    with _lock:
        conn = connections.get(user_id)
        if sock is not None and (conn is None or conn["sock"] is not sock):
            return  # 当前连接已被新连接替换，旧连接的房间清理在替换时已完成
        if conn:
            connections.pop(user_id, None)
        # 断连即注销种子（P2P 安装包分享，Phase 2）
        p2p_seeds.pop(user_id, None)
        room_id = conn["room_id"] if conn else None
        if room_id and room_id in rooms:
            rooms[room_id]["members"].discard(user_id)
            if not rooms[room_id]["members"]:
                del rooms[room_id]
                closed_room = room_id
    if closed_room:
        # 僵尸房清理：最后一个成员断开，删除 DB 房间行
        _delete_room_db(closed_room)
        return
    if room_id and room_id in rooms:
        broadcast_room(room_id, {"type": "room:member_left", "user_id": user_id})
        broadcast_room(room_id, {"type": "room:members", "members": get_room_members(room_id)})


# ── 独立端口监听（3001，备用直连）──

def start_ws_server(port=3001):
    """在后台线程启动独立 WS 监听"""
    def accept_loop():
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind(("0.0.0.0", port))
        srv.listen(32)
        srv.settimeout(1.0)
        print(f"[ws] WebSocket 服务器启动: ws://0.0.0.0:{port}", file=sys.stderr)
        while True:
            try:
                conn, _ = srv.accept()
            except socket.timeout:
                continue
            except Exception:
                break
            threading.Thread(target=handle_standalone_conn, args=(conn,), daemon=True).start()

    def handle_standalone_conn(conn):
        try:
            # 读 HTTP 请求头
            f = conn.makefile("rb")
            request_line = f.readline().decode(errors="ignore")
            headers = {}
            while True:
                line = f.readline().decode(errors="ignore")
                if line in ("\r\n", "\n", ""):
                    break
                if ":" in line:
                    k, v = line.split(":", 1)
                    headers[k.strip().lower()] = v.strip()
            query = ""
            try:
                parsed = urllib.parse.urlparse(request_line.split(" ")[1])
                query = parsed.query
            except Exception:
                pass
            handle_ws_connection(conn, f, headers, query)
        except Exception:
            try:
                conn.close()
            except Exception:
                pass

    t = threading.Thread(target=accept_loop, daemon=True)
    t.start()

    # 成员状态校准：每 30s 给每个房间补发一次 room:members（客户端只靠 join 快照，定期校准）
    def members_sync_loop():
        while True:
            time.sleep(30)
            with _lock:
                room_ids = list(rooms.keys())
            for rid in room_ids:
                broadcast_room(rid, {"type": "room:members", "members": get_room_members(rid)})
            _check_transfer_timeouts()  # 传输状态清理 + wait_all 超时兜底

    tsync = threading.Thread(target=members_sync_loop, daemon=True)
    tsync.start()
    return t
