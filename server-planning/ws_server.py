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
        # Phase 2 安装包种子：注册/心跳/注销/查询
        "p2p:seed_register": handle_p2p_seed_register,
        "p2p:seed_heartbeat": handle_p2p_seed_heartbeat,
        "p2p:seed_unregister": handle_p2p_seed_unregister,
        "p2p:seed_list": handle_p2p_seed_list,
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

def _maybe_wait_all(room_id, song_id):
    """wait_all 协调：有缺歌成员 → 广播 music:song_waiting；全员就绪 → music:songs_ready"""
    with _lock:
        room = rooms.get(room_id)
        if not room or not song_id or room.get("transfer_mode") != "wait_all":
            return
        st = room["song_waiting"].get(song_id, {"waiting": False, "ready": False, "started": 0})
        req = room["song_requests"].get(song_id)
        missing = bool(req and req["uids"])
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
    """传输状态清理：持有者超过 30s 未回传分片 → 广播 transfer_failed 给请求者并清理，
    避免同一首歌传输状态永久卡死（覆盖客户端 12s×3 重试窗口，重试后能拿到结果而非干等）。
    同时检查 wait_all 超时（60s）强制广播 music:songs_ready。"""
    with _lock:
        overdue = []
        ready = []
        now = time.time()
        for rid, room in rooms.items():
            for sid, req in list(room["song_requests"].items()):
                if now - req["started"] > 30:
                    overdue.append((rid, sid, set(req["uids"])))
                    del room["song_requests"][sid]
            for sid, st in room["song_waiting"].items():
                if st["waiting"] and not st["ready"] and now - st["started"] > 60:
                    st.update(waiting=False, ready=True)
                    ready.append((rid, sid))
    for rid, sid, uids in overdue:
        for uid in uids:
            send_to_user(uid, {"type": "music:transfer_failed", "song_id": sid})
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
    """听众请求缺失歌曲：记录请求者（重置传输超时），选持有者并发 music:song_requested。
    - 重复请求（客户端 12s×3 重试 / v4.5.9 断点续传）会重新选持有者并重新触发传输
    - 请求携带 `from_chunk`（已保存分片数）时，透传给持有者（续传，非从头重传）
    - 已有传输状态会被接管/重置（重发 song_requested + 重置超时），不会被旧状态挡掉"""
    room_id = (connections.get(user_id) or {}).get("room_id")
    song_id = msg.get("song_id")
    if not room_id or room_id not in rooms or not song_id:
        return
    with _lock:
        room = rooms[room_id]
        req = room["song_requests"].setdefault(song_id, {"uids": set(), "started": 0})
        req["uids"].add(user_id)
        req["started"] = time.time()  # 重复请求重置超时计时
        holder = _pick_song_holder(room, song_id, exclude=user_id)
    if holder:
        data = {"type": "music:song_requested", "song_id": song_id, "requester_user_id": user_id}
        if msg.get("from_chunk") is not None:
            data["from_chunk"] = msg["from_chunk"]  # v4.5.9 断点续传
        if msg.get("p2p"):
            data["p2p"] = True  # Phase 1：请求方支持 WebRTC 直连，持有者优先尝试 P2P 直传
        send_to_user(holder, data)


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
            req["started"] = time.time()  # 传输活跃中，重置超时
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
    """传输结束（完成/失败）：转发给请求者，清空等待集合并检查 wait_all"""
    room_id = (connections.get(user_id) or {}).get("room_id")
    song_id = msg.get("song_id")
    if not room_id or room_id not in rooms or not song_id:
        return
    with _lock:
        room = rooms[room_id]
        req = room["song_requests"].pop(song_id, None)
        requesters = set(req["uids"]) if req else set()
        requesters.discard(user_id)
    for uid in requesters:
        send_to_user(uid, {"type": "music:transfer_done" if done else "music:transfer_failed", "song_id": song_id})
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
    return {"type": "p2p:online", "users": users}


def handle_p2p_test_request(user_id, msg):
    """P2P 测试请求：转发给目标客户端，目标自动挂起 WebRTC 接收并回传结果。
    - 目标离线静默丢弃，发起端 8s 超时判定失败
    - 仅在线用户即可互测（调试工具，测试数据量小，自动关闭）"""
    to_user_id = msg.get("to_user_id")
    if not to_user_id or to_user_id == user_id:
        return
    with _lock:
        target = connections.get(to_user_id)
        if not target:
            return
        from_name = (connections.get(user_id) or {}).get("username", "")
    send_to_user(to_user_id, {
        "type": "p2p:test_request",
        "from_user_id": user_id,
        "from_username": from_name,
    })


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
    """查询在线种子：返回持有指定版本安装包的种子 user_id 列表（不含自己）。
    顺便清理超时未心跳的僵尸种子。"""
    version = msg.get("version")
    now = time.time()
    with _lock:
        expired = [u for u, s in p2p_seeds.items() if now - s["last_seen"] > SEED_TTL]
        for u in expired:
            p2p_seeds.pop(u, None)
        if version:
            peers = [u for u, s in p2p_seeds.items() if s["version"] == version and u != user_id]
        else:
            peers = [u for u in p2p_seeds.keys() if u != user_id]
    resp = {"type": "p2p:seed_list", "peers": peers, "version": version or ""}
    if msg.get("id") is not None:
        resp["id"] = msg["id"]  # 请求-响应：回显 id 供客户端 ws::request 匹配
    send_to_user(user_id, resp)

# ── 心跳 ──

def handle_ping(user_id, msg):
    send_to_user(user_id, {"type": "pong", "server_time": int(time.time() * 1000)})


# ── 连接生命周期 ──

def handle_ws_connection(sock, rfile, headers, query):
    """处理一条 WebSocket 连接（握手 → 认证 → 消息循环），阻塞直到断开"""
    if not ws_handshake(sock, rfile, headers):
        return

    params = urllib.parse.parse_qs(query)
    token = params.get("token", [None])[0]
    payload = verify_jwt(token) if token else None
    if not payload:
        ws_send_json(sock, {"type": "error", "error": "认证失败"})
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
                old["sock"].close()
            except Exception:
                pass

    with _lock:
        connections[user_id] = {"sock": sock, "wfile": rfile, "username": username,
                                "room_id": None, "status": "idle", "lock": threading.Lock()}

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
