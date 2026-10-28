# ============================================================
# db.py — 项目数据层（SQLite）
#
# 设计约定：
#   * 文本数据（星体系统、宇宙星系、星体关联、SVG 图标、详情 .txt）
#     全部存在 Galaxy/universe.db 里；
#   * 图片（贴图、详情图片）仍以文件形式放在磁盘上，
#     数据库只保存相对仓库根目录的路径文本（texturePath / rel_path）；
#   * 旧版 JSON / 文件在首次启动时自动迁移进数据库，
#     之后数据库是唯一事实来源（旧文件保留作备份，不再读取）。
# ============================================================

import base64
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import time

DIR = os.path.dirname(os.path.abspath(__file__))
AU = 1.495978707e11
CUSTOM_DIR = os.path.join(DIR, 'Galaxy', 'custom')
DETAIL_DIR = os.path.join(DIR, 'detail_files')
UNIVERSE_FILE = os.path.join(DIR, 'Galaxy', 'universes.json')
BODY_RELATIONS_FILE = os.path.join(DIR, 'Galaxy', 'body_relations.json')
BUILTIN_DATA_FILES = {
    'solar system': os.path.join(DIR, 'Galaxy', 'solar system', 'data.json'),
    'hd-219134': os.path.join(DIR, 'Galaxy', 'hd-219134', 'data.json'),
}
DB_FILE = os.path.join(DIR, 'Galaxy', 'universe.db')

IMAGE_EXT = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/bmp': '.bmp',
    'image/svg+xml': '.svg',
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS systems (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL DEFAULT 'custom',   -- custom | builtin
    name        TEXT NOT NULL DEFAULT '',
    name_cn     TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    data_json   TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS universe_galaxies (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    name_cn          TEXT NOT NULL DEFAULT '',
    description      TEXT NOT NULL DEFAULT '',
    icon_svg         TEXT,
    detail_tree_json TEXT NOT NULL DEFAULT '[]',
    is_default       INTEGER NOT NULL DEFAULT 0,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS body_relations (
    id             TEXT PRIMARY KEY,
    from_system_id TEXT NOT NULL,
    from_key       TEXT NOT NULL,
    from_name      TEXT NOT NULL DEFAULT '',
    to_system_id   TEXT NOT NULL,
    to_key         TEXT NOT NULL,
    to_name        TEXT NOT NULL DEFAULT '',
    updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS detail_files (
    name       TEXT PRIMARY KEY,
    kind       TEXT NOT NULL,                -- text | image
    rel_path   TEXT,                         -- 图片：相对仓库根目录的路径
    content    TEXT,                         -- 文本：文件内容
    mime       TEXT,
    created_at INTEGER NOT NULL
);

-- ==================== 社区 / 账号 ====================

CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'citizen',  -- developer | admin | citizen
    banned        INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS user_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS galaxy_members (
    galaxy_id TEXT NOT NULL,
    user_id   TEXT NOT NULL,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (galaxy_id, user_id)
);

-- 管理员发布的“新星系资格”。每个资格被领取时创建一个新星系并任命领取者为指挥官。
CREATE TABLE IF NOT EXISTS galaxy_offers (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    name_cn          TEXT NOT NULL DEFAULT '',
    description      TEXT NOT NULL DEFAULT '',
    icon_svg         TEXT,
    detail_tree_json TEXT NOT NULL DEFAULT '[]',
    quantity         INTEGER NOT NULL DEFAULT 1,
    remaining        INTEGER NOT NULL DEFAULT 1,
    created_by       TEXT NOT NULL,
    active           INTEGER NOT NULL DEFAULT 1,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS offer_claims (
    offer_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    galaxy_id  TEXT NOT NULL,
    claimed_at INTEGER NOT NULL,
    PRIMARY KEY (offer_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT NOT NULL,
    kind         TEXT NOT NULL DEFAULT 'info',
    title        TEXT NOT NULL DEFAULT '',
    body         TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL DEFAULT '{}',
    is_read      INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_systems_kind ON systems(kind);
CREATE INDEX IF NOT EXISTS idx_relations_from ON body_relations(from_system_id);
CREATE INDEX IF NOT EXISTS idx_relations_to ON body_relations(to_system_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_members_user ON galaxy_members(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_offers_active ON galaxy_offers(active, remaining);
"""


def now_ms():
    return int(time.time() * 1000)


def connect():
    os.makedirs(os.path.dirname(DB_FILE), exist_ok=True)
    conn = sqlite3.connect(DB_FILE, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def _ensure_columns(conn, table, columns):
    existing = {row['name'] for row in conn.execute(f'PRAGMA table_info({table})').fetchall()}
    for name, decl in columns.items():
        if name in existing:
            continue
        conn.execute(f'ALTER TABLE {table} ADD COLUMN {name} {decl}')


def init_db():
    conn = connect()
    try:
        conn.executescript(SCHEMA)
        # 旧库升级：社区字段通过 ALTER TABLE 补齐（CREATE INDEX 放在补列之后）
        _ensure_columns(conn, 'systems', {
            'owner_user_id': 'TEXT',
            'universe_galaxy_id': 'TEXT',
            'status': "TEXT NOT NULL DEFAULT 'approved'",
            'review_note': "TEXT NOT NULL DEFAULT ''",
            'reviewed_by': 'TEXT',
            'reviewed_at': 'INTEGER',
            'submitted_at': 'INTEGER',
        })
        _ensure_columns(conn, 'universe_galaxies', {
            'commander_user_id': 'TEXT',
            'created_by': 'TEXT',
        })
        conn.execute('CREATE INDEX IF NOT EXISTS idx_systems_owner ON systems(owner_user_id)')
        conn.execute('CREATE INDEX IF NOT EXISTS idx_systems_status ON systems(status)')
        conn.execute('CREATE INDEX IF NOT EXISTS idx_systems_galaxy ON systems(universe_galaxy_id)')
        conn.execute(
            'UPDATE systems SET universe_galaxy_id = '
            "json_extract(data_json, '$.universe.galaxyId') "
            'WHERE universe_galaxy_id IS NULL'
        )
        _migrate_legacy(conn)
        # 全新安装也保证默认星系存在；图标为空时前端会使用内置默认 SVG。
        if not conn.execute("SELECT 1 FROM universe_galaxies WHERE id='milky-way'").fetchone():
            now = now_ms()
            conn.execute(
                'INSERT INTO universe_galaxies(id, name, name_cn, description, icon_svg, '
                'detail_tree_json, is_default, created_at, updated_at) '
                'VALUES(?, ?, ?, ?, ?, ?, 1, ?, ?)',
                (
                    'milky-way', '银河系', 'Milky Way',
                    '默认星系。所有尚未指定隶属星系的星体系统都会自动归入这里。',
                    None, '[]', now, now,
                ),
            )
        conn.commit()
    finally:
        conn.close()


# ==================== 通用工具 ====================

def _get_meta(conn, key):
    row = conn.execute('SELECT value FROM meta WHERE key=?', (key,)).fetchone()
    return row['value'] if row else None


def _set_meta(conn, key, value):
    conn.execute(
        'INSERT INTO meta(key, value) VALUES(?, ?) '
        'ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        (key, str(value)),
    )


def _safe_id(value):
    return re.sub(r'[<>:"/\\|?*]+', '_', str(value or '').strip()).strip('._')


def _read_json(path, fallback):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return fallback


def _decode_image_payload(value):
    """把 data URL / 旧版裸 base64 解码为 (bytes, mime)；不是图片数据时返回 None。"""
    if not isinstance(value, str):
        return None
    s = value.strip()
    if s.startswith('data:'):
        match = re.match(r'^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$', s, re.S)
        if not match:
            return None
        try:
            raw = base64.b64decode(match.group(2), validate=False)
        except Exception:
            return None
        return raw, match.group(1).lower()
    # 旧版 localStorage 只存了裸 base64；相对路径一定带 “.”，不会被误判
    if len(s) > 32 and ':' not in s and '.' not in s and re.fullmatch(r'[A-Za-z0-9+/=\s]+', s):
        try:
            raw = base64.b64decode(s, validate=False)
        except Exception:
            return None
        return raw, 'image/png'
    return None


def _write_image_file(raw, mime, gid, hint='tex', base_dir=None):
    ext = IMAGE_EXT.get(mime, '.png')
    digest = hashlib.sha1(raw).hexdigest()[:16]
    root = base_dir or CUSTOM_DIR
    media_dir = os.path.join(root, gid, 'media')
    os.makedirs(media_dir, exist_ok=True)
    filename = f'{hint}_{digest}{ext}'
    abs_path = os.path.join(media_dir, filename)
    if not os.path.exists(abs_path):
        with open(abs_path, 'wb') as f:
            f.write(raw)
    return f'Galaxy/custom/{gid}/media/{filename}'


def materialize_images(record, gid, base_dir=None):
    """遍历星体数据，把图片 data URL 落盘并把字段改写为相对路径文本。"""
    def walk(node):
        if isinstance(node, dict):
            # 先处理 textureData（新建时上传的图片），再处理 texturePath（旧缓存）
            for key in ('textureData', 'texturePath'):
                val = node.get(key)
                decoded = _decode_image_payload(val)
                if decoded:
                    raw, mime = decoded
                    node['texturePath'] = _write_image_file(raw, mime, gid, 'tex', base_dir)
                    node['textureData'] = None
            for value in list(node.values()):
                if isinstance(value, (dict, list)):
                    walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)
    walk(record)
    return record


def normalize_system_record(data, gid=''):
    """把 create-galaxy 数据或旧 localStorage 星系数据统一成数据库记录。"""
    data = data if isinstance(data, dict) else {}

    if isinstance(data.get('star'), dict):
        star = dict(data.get('star') or {})
        planets = [dict(p) for p in (data.get('planets') or []) if isinstance(p, dict)]
    else:
        # 旧 localStorage：planets 是扁平的 body info 列表，isStar 标记恒星
        infos = [dict(p) for p in (data.get('planets') or []) if isinstance(p, dict)]
        star = next((dict(p) for p in infos if p.get('isStar')), {})
        planets = [dict(p) for p in infos if not p.get('isStar')]

    def _clean_body(body):
        # 运行期字段不回写数据库；恒星的 SI 坐标换算回 AU 保存
        pos = body.pop('_siPosition', None)
        if isinstance(pos, dict) and 'x' not in body:
            try:
                body['x'] = float(pos.get('x') or 0) / AU
                body['y'] = float(pos.get('y') or 0) / AU
                body['z'] = float(pos.get('z') or 0) / AU
            except (TypeError, ValueError):
                pass
        body.pop('mesh', None)
        return body

    star = _clean_body(star)
    planets = [_clean_body(p) for p in planets]

    now = now_ms()
    return {
        'name': str(data.get('name') or (star.get('name') if star else '') or '新星系').strip(),
        'nameCN': str(data.get('nameCN') or '').strip(),
        'description': str(data.get('description') or ''),
        'icon': data.get('icon') or '🌟',
        'star': star,
        'planets': planets,
        'universe': data.get('universe') if isinstance(data.get('universe'), dict) else {},
        'createdAt': int(data.get('createdAt') or now),
        'updatedAt': int(data.get('updatedAt') or now),
    }


# ==================== 账号 / 会话 / 角色 ====================

PBKDF2_ITERATIONS = 240_000
SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
USERNAME_RE = re.compile(r'^[A-Za-z0-9_\-一-鿿]{3,24}$')


def _hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        'sha256', str(password).encode('utf-8'), bytes.fromhex(salt), PBKDF2_ITERATIONS
    )
    return f'pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest.hex()}'


def _verify_password(password, stored):
    try:
        algo, iterations, salt, expected = str(stored).split('$', 3)
        if algo != 'pbkdf2_sha256':
            return False
        digest = hashlib.pbkdf2_hmac(
            'sha256', str(password).encode('utf-8'), bytes.fromhex(salt), int(iterations)
        )
        return hmac.compare_digest(digest.hex(), expected)
    except Exception:
        return False


def _hash_token(token):
    return hashlib.sha256(str(token).encode('utf-8')).hexdigest()


def _public_user(row, unread=0):
    if not row:
        return None
    return {
        'id': row['id'],
        'username': row['username'],
        'displayName': row['display_name'] or row['username'],
        'role': row['role'],
        'banned': bool(row['banned']),
        'createdAt': row['created_at'],
        'updatedAt': row['updated_at'],
        'lastLoginAt': row['last_login_at'],
        'unread': int(unread or 0),
    }


def get_user(uid):
    conn = connect()
    try:
        row = conn.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_user_by_username(username):
    conn = connect()
    try:
        row = conn.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def user_count():
    conn = connect()
    try:
        return int(conn.execute('SELECT COUNT(*) AS c FROM users').fetchone()['c'])
    finally:
        conn.close()


def register_user(username, password, display_name=''):
    """注册账号；第一个注册者自动成为开发者，并接管旧版无主数据。"""
    username = str(username or '').strip()
    display_name = str(display_name or '').strip() or username
    if not USERNAME_RE.match(username):
        return {'ok': False, 'error': '用户名需为 3–24 位中文、字母、数字、下划线或短横线'}
    if not isinstance(password, str) or not (8 <= len(password) <= 128):
        return {'ok': False, 'error': '密码长度需为 8–128 位'}
    if len(display_name) > 32:
        return {'ok': False, 'error': '昵称最多 32 个字符'}

    conn = connect()
    try:
        conn.execute('BEGIN IMMEDIATE')
        if conn.execute('SELECT 1 FROM users WHERE username=?', (username,)).fetchone():
            conn.rollback()
            return {'ok': False, 'error': '用户名已被占用'}
        is_first = int(conn.execute('SELECT COUNT(*) AS c FROM users').fetchone()['c']) == 0
        uid = 'u_' + secrets.token_hex(8)
        now = now_ms()
        role = 'developer' if is_first else 'citizen'
        conn.execute(
            'INSERT INTO users(id, username, display_name, password_hash, role, banned, '
            'created_at, updated_at, last_login_at) VALUES(?, ?, ?, ?, ?, 0, ?, ?, ?)',
            (uid, username, display_name, _hash_password(password), role, now, now, now),
        )
        if is_first:
            # 项目原有内容归属于开发者；默认星系也交给开发者管理。
            conn.execute(
                'UPDATE systems SET owner_user_id=? WHERE owner_user_id IS NULL AND kind=?',
                (uid, 'custom'),
            )
            conn.execute(
                "UPDATE universe_galaxies SET commander_user_id=?, created_by=COALESCE(created_by, ?) "
                "WHERE id='milky-way' AND (commander_user_id IS NULL OR commander_user_id='')",
                (uid, uid),
            )
            conn.execute(
                'INSERT OR IGNORE INTO galaxy_members(galaxy_id, user_id, joined_at) VALUES(?, ?, ?)',
                ('milky-way', uid, now),
            )
        conn.commit()
        row = conn.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()
        user = _public_user(row)
        user['isFirstUser'] = is_first
        return {'ok': True, 'user': user}
    except Exception as e:
        conn.rollback()
        return {'ok': False, 'error': str(e)}
    finally:
        conn.close()


def authenticate(username, password):
    conn = connect()
    try:
        row = conn.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()
    finally:
        conn.close()
    if not row or not _verify_password(password, row['password_hash']):
        return {'ok': False, 'error': '用户名或密码错误'}
    if row['banned']:
        return {'ok': False, 'error': '该账号已被封禁'}
    conn = connect()
    try:
        conn.execute('UPDATE users SET last_login_at=?, updated_at=? WHERE id=?', (now_ms(), now_ms(), row['id']))
        conn.commit()
        row = conn.execute('SELECT * FROM users WHERE id=?', (row['id'],)).fetchone()
        return {'ok': True, 'user': _public_user(row)}
    finally:
        conn.close()


def create_session(uid):
    token = secrets.token_urlsafe(32)
    now = now_ms()
    conn = connect()
    try:
        conn.execute('DELETE FROM user_sessions WHERE expires_at < ?', (now,))
        conn.execute(
            'INSERT INTO user_sessions(token_hash, user_id, created_at, expires_at) VALUES(?, ?, ?, ?)',
            (_hash_token(token), uid, now, now + SESSION_TTL_MS),
        )
        conn.commit()
    finally:
        conn.close()
    return token


def get_user_by_session(token):
    if not token:
        return None
    conn = connect()
    try:
        row = conn.execute(
            'SELECT u.* FROM user_sessions s JOIN users u ON u.id=s.user_id '
            'WHERE s.token_hash=? AND s.expires_at>?',
            (_hash_token(token), now_ms()),
        ).fetchone()
        if not row or row['banned']:
            return None
        return dict(row)
    finally:
        conn.close()


def delete_session(token):
    if not token:
        return
    conn = connect()
    try:
        conn.execute('DELETE FROM user_sessions WHERE token_hash=?', (_hash_token(token),))
        conn.commit()
    finally:
        conn.close()


def update_profile(uid, display_name=None, password=None, current_password=None):
    conn = connect()
    try:
        row = conn.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()
        if not row:
            return {'ok': False, 'error': '用户不存在'}
        updates = []
        params = []
        if display_name is not None:
            display_name = str(display_name).strip()
            if not display_name or len(display_name) > 32:
                return {'ok': False, 'error': '昵称需为 1–32 个字符'}
            updates.append('display_name=?')
            params.append(display_name)
        if password:
            if not _verify_password(current_password or '', row['password_hash']):
                return {'ok': False, 'error': '当前密码不正确'}
            if not (8 <= len(str(password)) <= 128):
                return {'ok': False, 'error': '新密码长度需为 8–128 位'}
            updates.append('password_hash=?')
            params.append(_hash_password(password))
        if not updates:
            return {'ok': True, 'user': _public_user(row)}
        updates.append('updated_at=?')
        params.append(now_ms())
        params.append(uid)
        conn.execute(f'UPDATE users SET {", ".join(updates)} WHERE id=?', params)
        conn.commit()
        row = conn.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()
        return {'ok': True, 'user': _public_user(row)}
    finally:
        conn.close()


def _commander_rows(conn, user_id):
    rows = conn.execute(
        'SELECT id, name, name_cn FROM universe_galaxies WHERE commander_user_id=? ORDER BY name',
        (user_id,),
    ).fetchall()
    return [{'id': r['id'], 'name': r['name'], 'nameCN': r['name_cn']} for r in rows]


def _membership_rows(conn, user_id):
    rows = conn.execute(
        'SELECT g.id, g.name, g.name_cn, g.commander_user_id, m.joined_at '
        'FROM galaxy_members m JOIN universe_galaxies g ON g.id=m.galaxy_id '
        'WHERE m.user_id=? ORDER BY m.joined_at DESC',
        (user_id,),
    ).fetchall()
    return [{
        'id': r['id'],
        'name': r['name'],
        'nameCN': r['name_cn'],
        'isCommander': r['commander_user_id'] == user_id,
        'joinedAt': r['joined_at'],
    } for r in rows]


def get_me(user_id):
    """个人中心上下文：账号、已加入星系、担任指挥官的星系、未读数。"""
    conn = connect()
    try:
        row = conn.execute('SELECT * FROM users WHERE id=?', (user_id,)).fetchone()
        if not row:
            return None
        unread = conn.execute(
            'SELECT COUNT(*) AS c FROM messages WHERE user_id=? AND is_read=0', (user_id,)
        ).fetchone()['c']
        user = _public_user(row, unread)
        user['commandedGalaxies'] = _commander_rows(conn, user_id)
        user['memberships'] = _membership_rows(conn, user_id)
        return user
    finally:
        conn.close()


def list_users():
    conn = connect()
    try:
        rows = conn.execute('SELECT * FROM users ORDER BY created_at').fetchall()
        out = []
        for row in rows:
            user = _public_user(row)
            user['commandedGalaxies'] = _commander_rows(conn, row['id'])
            user['memberships'] = _membership_rows(conn, row['id'])
            out.append(user)
        return out
    finally:
        conn.close()


def _actor_row(conn, actor_id):
    return conn.execute('SELECT * FROM users WHERE id=?', (actor_id,)).fetchone()


def set_user_role(actor_id, target_id, role):
    if role not in ('admin', 'citizen'):
        return {'ok': False, 'error': '只能任命管理员或撤销为普通公民'}
    conn = connect()
    try:
        actor = _actor_row(conn, actor_id)
        if not actor or actor['role'] != 'developer':
            return {'ok': False, 'error': '只有开发者可以任命管理员'}
        target = _actor_row(conn, target_id)
        if not target:
            return {'ok': False, 'error': '用户不存在'}
        if target['role'] == 'developer':
            return {'ok': False, 'error': '不能修改开发者角色'}
        conn.execute('UPDATE users SET role=?, updated_at=? WHERE id=?', (role, now_ms(), target_id))
        _notify(
            conn, target_id, 'role',
            '角色变更通知',
            f'你的社区角色已变更为：{"管理员" if role == "admin" else "星际公民"}。',
        )
        conn.commit()
        return {'ok': True}
    finally:
        conn.close()


def set_user_banned(actor_id, target_id, banned):
    conn = connect()
    try:
        actor = _actor_row(conn, actor_id)
        target = _actor_row(conn, target_id)
        if not actor or actor['role'] not in ('developer', 'admin'):
            return {'ok': False, 'error': '没有用户管理权限'}
        if not target:
            return {'ok': False, 'error': '用户不存在'}
        if target['id'] == actor['id']:
            return {'ok': False, 'error': '不能封禁自己'}
        if target['role'] == 'developer':
            return {'ok': False, 'error': '不能封禁开发者'}
        if actor['role'] == 'admin' and target['role'] == 'admin':
            return {'ok': False, 'error': '管理员不能封禁其他管理员'}
        conn.execute(
            'UPDATE users SET banned=?, updated_at=? WHERE id=?',
            (1 if banned else 0, now_ms(), target_id),
        )
        if banned:
            conn.execute('DELETE FROM user_sessions WHERE user_id=?', (target_id,))
        _notify(
            conn, target_id, 'account',
            '账号状态变更',
            '你的账号已被封禁。' if banned else '你的账号已恢复正常。',
        )
        conn.commit()
        return {'ok': True}
    finally:
        conn.close()


def delete_user(actor_id, target_id):
    conn = connect()
    try:
        actor = _actor_row(conn, actor_id)
        target = _actor_row(conn, target_id)
        if not actor or actor['role'] != 'developer':
            return {'ok': False, 'error': '只有开发者可以删除账号'}
        if not target:
            return {'ok': False, 'error': '用户不存在'}
        if target['role'] == 'developer':
            return {'ok': False, 'error': '不能删除开发者账号'}
        conn.execute('UPDATE systems SET owner_user_id=NULL WHERE owner_user_id=?', (target_id,))
        conn.execute('UPDATE universe_galaxies SET commander_user_id=NULL WHERE commander_user_id=?', (target_id,))
        conn.execute('DELETE FROM galaxy_members WHERE user_id=?', (target_id,))
        conn.execute('DELETE FROM user_sessions WHERE user_id=?', (target_id,))
        conn.execute('DELETE FROM messages WHERE user_id=?', (target_id,))
        conn.execute('DELETE FROM users WHERE id=?', (target_id,))
        conn.commit()
        return {'ok': True}
    finally:
        conn.close()


# ==================== 通知 ====================

def _notify(conn, user_id, kind, title, body, payload=None):
    if not user_id:
        return
    try:
        conn.execute(
            'INSERT INTO messages(user_id, kind, title, body, payload_json, is_read, created_at) '
            'VALUES(?, ?, ?, ?, ?, 0, ?)',
            (
                user_id, str(kind or 'info'), str(title or '')[:200], str(body or '')[:2000],
                json.dumps(payload or {}, ensure_ascii=False), now_ms(),
            ),
        )
    except Exception:
        pass


def list_messages(user_id, limit=100):
    conn = connect()
    try:
        rows = conn.execute(
            'SELECT * FROM messages WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT ?',
            (user_id, max(1, min(int(limit or 100), 300))),
        ).fetchall()
        out = []
        for row in rows:
            try:
                payload = json.loads(row['payload_json'] or '{}')
            except Exception:
                payload = {}
            out.append({
                'id': row['id'],
                'kind': row['kind'],
                'title': row['title'],
                'body': row['body'],
                'payload': payload,
                'read': bool(row['is_read']),
                'createdAt': row['created_at'],
            })
        return out
    finally:
        conn.close()


def mark_messages_read(user_id, message_ids=None):
    conn = connect()
    try:
        if message_ids:
            ids = [int(x) for x in message_ids if str(x).isdigit()]
            if ids:
                conn.executemany(
                    'UPDATE messages SET is_read=1 WHERE id=? AND user_id=?',
                    [(mid, user_id) for mid in ids],
                )
        else:
            conn.execute('UPDATE messages SET is_read=1 WHERE user_id=?', (user_id,))
        conn.commit()
        return {'ok': True}
    finally:
        conn.close()


def unread_count(user_id):
    conn = connect()
    try:
        return int(conn.execute(
            'SELECT COUNT(*) AS c FROM messages WHERE user_id=? AND is_read=0', (user_id,)
        ).fetchone()['c'])
    finally:
        conn.close()


# ==================== 星体系统 ====================

def _system_from_row(row):
    try:
        rec = json.loads(row['data_json'])
    except Exception:
        return None
    rec['id'] = row['id']
    rec['kind'] = row['kind']
    rec['createdAt'] = row['created_at']
    rec['updatedAt'] = row['updated_at']
    rec['ownerUserId'] = row['owner_user_id']
    rec['ownerName'] = row['owner_name'] if 'owner_name' in row.keys() else None
    rec['universeGalaxyId'] = row['universe_galaxy_id'] or (
        (rec.get('universe') or {}).get('galaxyId') or ''
    )
    rec['status'] = row['status'] or 'approved'
    rec['reviewNote'] = row['review_note'] or ''
    rec['reviewedBy'] = row['reviewed_by']
    rec['reviewedAt'] = row['reviewed_at']
    rec['submittedAt'] = row['submitted_at']
    return rec


SYSTEM_SELECT = (
    'SELECT s.*, u.display_name AS owner_name FROM systems s '
    'LEFT JOIN users u ON u.id=s.owner_user_id '
)


def list_systems(kind='custom', viewer=None):
    """列出星体系统。

    被驳回的系统只对作者本人和网站管理人员可见；
    草稿（draft）是作者私有的未发布内容，只有作者本人能看到。
    """
    viewer_id = (viewer or {}).get('id')
    is_staff = (viewer or {}).get('role') in ('developer', 'admin')
    conn = connect()
    try:
        rows = conn.execute(
            SYSTEM_SELECT + 'WHERE s.kind=? ORDER BY s.created_at, s.id',
            (kind,),
        ).fetchall()
        out = []
        for row in rows:
            status = row['status'] or 'approved'
            if status == 'draft' and row['owner_user_id'] != viewer_id:
                continue
            if status == 'rejected' and not is_staff and row['owner_user_id'] != viewer_id:
                continue
            rec = _system_from_row(row)
            if rec:
                out.append(rec)
        return out
    finally:
        conn.close()


def get_system(gid, kind=None):
    conn = connect()
    try:
        if kind:
            row = conn.execute(SYSTEM_SELECT + 'WHERE s.id=? AND s.kind=?', (gid, kind)).fetchone()
        else:
            row = conn.execute(SYSTEM_SELECT + 'WHERE s.id=?', (gid,)).fetchone()
        return _system_from_row(row) if row else None
    finally:
        conn.close()


def system_exists(gid, kind='custom'):
    conn = connect()
    try:
        row = conn.execute('SELECT 1 FROM systems WHERE id=? AND kind=?', (gid, kind)).fetchone()
        return bool(row)
    finally:
        conn.close()


def list_owned_systems(uid):
    conn = connect()
    try:
        rows = conn.execute(
            SYSTEM_SELECT + 'WHERE s.kind=? AND s.owner_user_id=? ORDER BY s.updated_at DESC',
            ('custom', uid),
        ).fetchall()
        return [rec for rec in (_system_from_row(r) for r in rows) if rec]
    finally:
        conn.close()


def is_galaxy_member(gid, uid):
    conn = connect()
    try:
        return bool(conn.execute(
            'SELECT 1 FROM galaxy_members WHERE galaxy_id=? AND user_id=?', (gid, uid)
        ).fetchone())
    finally:
        conn.close()


def upsert_system(gid, data, kind='custom', created_at=None,
                  owner_id=None, universe_galaxy_id=None, status=None,
                  submitted_at=None):
    """写入星体系统。

    owner_id / status / universe_galaxy_id 只在显式传入时更新；更新操作
    传 None 会保留原值，避免客户端漏字段导致作者或审核状态被清空。
    """
    record = normalize_system_record(data, gid)
    record = materialize_images(record, gid)
    conn = connect()
    try:
        existing = conn.execute('SELECT * FROM systems WHERE id=?', (gid,)).fetchone()
        created = int(created_at or record.get('createdAt') or (existing['created_at'] if existing else now_ms()))
        updated = now_ms()
        record['createdAt'] = created
        record['updatedAt'] = updated

        galaxy_id = universe_galaxy_id
        if galaxy_id is None:
            galaxy_id = (record.get('universe') or {}).get('galaxyId')
        if not galaxy_id and existing:
            galaxy_id = existing['universe_galaxy_id']
        if not galaxy_id:
            galaxy_id = 'milky-way'

        owner = owner_id if owner_id is not None else (existing['owner_user_id'] if existing else None)
        final_status = status if status is not None else (
            (existing['status'] if existing else 'approved') or 'approved'
        )
        submitted = submitted_at
        if submitted is None:
            submitted = existing['submitted_at'] if existing else updated
        if existing is None:
            submitted = updated

        review_note = existing['review_note'] if existing else ''
        reviewed_by = existing['reviewed_by'] if existing else None
        reviewed_at = existing['reviewed_at'] if existing else None
        if final_status == 'pending' and (not existing or existing['status'] != 'pending'):
            review_note, reviewed_by, reviewed_at = '', None, None
            submitted = updated

        conn.execute(
            'INSERT INTO systems(id, kind, name, name_cn, description, data_json, created_at, updated_at, '
            'owner_user_id, universe_galaxy_id, status, review_note, reviewed_by, reviewed_at, submitted_at) '
            'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) '
            'ON CONFLICT(id) DO UPDATE SET name=excluded.name, name_cn=excluded.name_cn, '
            'description=excluded.description, data_json=excluded.data_json, updated_at=excluded.updated_at, '
            'owner_user_id=excluded.owner_user_id, universe_galaxy_id=excluded.universe_galaxy_id, '
            'status=excluded.status, review_note=excluded.review_note, reviewed_by=excluded.reviewed_by, '
            'reviewed_at=excluded.reviewed_at, submitted_at=excluded.submitted_at',
            (
                gid, kind,
                record.get('name', ''), record.get('nameCN', ''), record.get('description', ''),
                json.dumps(record, ensure_ascii=False, separators=(',', ':')),
                created, updated, owner, galaxy_id, final_status,
                review_note, reviewed_by, reviewed_at, submitted,
            ),
        )
        conn.commit()
        record['id'] = gid
        return record
    finally:
        conn.close()


def set_system_status(gid, status, reviewer_id, note=''):
    if status not in ('approved', 'pending', 'rejected'):
        return {'ok': False, 'error': '无效的审核状态'}
    conn = connect()
    try:
        row = conn.execute('SELECT * FROM systems WHERE id=? AND kind=?', (gid, 'custom')).fetchone()
        if not row:
            return {'ok': False, 'error': '星体系统不存在'}
        now = now_ms()
        conn.execute(
            'UPDATE systems SET status=?, review_note=?, reviewed_by=?, reviewed_at=?, updated_at=? '
            'WHERE id=?',
            (status, str(note or '')[:1000], reviewer_id, now, now, gid),
        )
        if row['owner_user_id']:
            label = {'approved': '审核通过', 'rejected': '审核未通过', 'pending': '重新进入审核'}[status]
            body = f'你的星体系统「{row["name"]}」{label}。'
            if note:
                body += f'\n审核说明：{note}'
            _notify(conn, row['owner_user_id'], 'review', '星体系统审核结果', body, {
                'systemId': gid, 'status': status,
            })
        conn.commit()
        return {'ok': True}
    finally:
        conn.close()


def publish_system(gid, status):
    """把草稿发布为正式提交（等待审核 / 直接通过）。"""
    if status not in ('approved', 'pending'):
        return {'ok': False, 'error': '无效的发布状态'}
    conn = connect()
    try:
        row = conn.execute('SELECT * FROM systems WHERE id=? AND kind=?', (gid, 'custom')).fetchone()
        if not row:
            return {'ok': False, 'error': '星体系统不存在'}
        if (row['status'] or 'approved') != 'draft':
            return {'ok': False, 'error': '只有草稿可以发布'}
        now = now_ms()
        # 条件更新：并发重复发布时只有第一次生效
        cur = conn.execute(
            "UPDATE systems SET status=?, review_note=?, reviewed_by=NULL, reviewed_at=NULL, "
            "submitted_at=?, updated_at=? WHERE id=? AND kind='custom' AND status='draft'",
            (status, '', now, now, gid),
        )
        conn.commit()
        if cur.rowcount == 0:
            return {'ok': False, 'error': '只有草稿可以发布'}
        return {'ok': True, 'id': gid, 'status': status}
    finally:
        conn.close()


def delete_system(gid):
    conn = connect()
    try:
        # 同时清理指向该系统的星体关联，避免留下悬空记录
        conn.execute(
            'DELETE FROM body_relations WHERE from_system_id=? OR to_system_id=?', (gid, gid)
        )
        cur = conn.execute('DELETE FROM systems WHERE id=? AND kind=?', (gid, 'custom'))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def system_updated_at(gid):
    conn = connect()
    try:
        row = conn.execute('SELECT updated_at FROM systems WHERE id=?', (gid,)).fetchone()
        return int(row['updated_at']) if row else 0
    finally:
        conn.close()


# ==================== 宇宙级星系（SVG 以文本形式入库）====================

def _universe_row_to_record(row):
    try:
        detail_tree = json.loads(row['detail_tree_json'] or '[]')
    except Exception:
        detail_tree = []
    keys = row.keys()
    return {
        'id': row['id'],
        'name': row['name'],
        'nameCN': row['name_cn'],
        'description': row['description'],
        'iconSvg': row['icon_svg'],
        'detailTree': detail_tree,
        'isDefault': bool(row['is_default']),
        'createdAt': row['created_at'],
        'updatedAt': row['updated_at'],
        'commanderUserId': row['commander_user_id'] if 'commander_user_id' in keys else None,
        'commanderName': row['commander_name'] if 'commander_name' in keys else None,
        'createdBy': row['created_by'] if 'created_by' in keys else None,
        'memberCount': int(row['member_count']) if 'member_count' in keys else 0,
        'isMember': bool(row['is_member']) if 'is_member' in keys else False,
    }


UNIVERSE_SELECT = (
    'SELECT g.*, c.display_name AS commander_name, '
    '(SELECT COUNT(*) FROM galaxy_members m WHERE m.galaxy_id=g.id) AS member_count '
    'FROM universe_galaxies g LEFT JOIN users c ON c.id=g.commander_user_id '
)


def list_universe_galaxies(viewer_id=None):
    conn = connect()
    try:
        rows = conn.execute(UNIVERSE_SELECT + 'ORDER BY g.created_at, g.id').fetchall()
        member_ids = set()
        if viewer_id:
            member_ids = {
                r['galaxy_id'] for r in conn.execute(
                    'SELECT galaxy_id FROM galaxy_members WHERE user_id=?', (viewer_id,)
                ).fetchall()
            }
        out = []
        for row in rows:
            rec = _universe_row_to_record(row)
            rec['isMember'] = row['id'] in member_ids
            out.append(rec)
        return out
    finally:
        conn.close()


def get_universe_galaxy(gid, viewer_id=None):
    conn = connect()
    try:
        row = conn.execute(UNIVERSE_SELECT + 'WHERE g.id=?', (gid,)).fetchone()
        if not row:
            return None
        rec = _universe_row_to_record(row)
        if viewer_id:
            rec['isMember'] = bool(conn.execute(
                'SELECT 1 FROM galaxy_members WHERE galaxy_id=? AND user_id=?',
                (gid, viewer_id),
            ).fetchone())
        return rec
    finally:
        conn.close()


def save_universe_galaxy(data, commander_id=None, created_by=None):
    """新建/更新星系。commander_id 只在新建或显式任命时传入。"""
    gid = _safe_id(data.get('id'))
    if not gid:
        return {'ok': False, 'error': '缺少星系 id'}
    name = str(data.get('name') or '').strip()
    if not name:
        return {'ok': False, 'error': '缺少星系名称'}

    conn = connect()
    try:
        existing = conn.execute('SELECT * FROM universe_galaxies WHERE id=?', (gid,)).fetchone()
        created = int(existing['created_at']) if existing else int(data.get('createdAt') or now_ms())
        updated = now_ms()
        if 'iconSvg' in data:
            icon_svg = data.get('iconSvg')
            icon_svg = str(icon_svg) if icon_svg is not None else None
        else:
            icon_svg = existing['icon_svg'] if existing else None
        detail_tree = data.get('detailTree') if isinstance(data.get('detailTree'), list) else (
            json.loads(existing['detail_tree_json'] or '[]') if existing else []
        )
        is_default = 1 if (bool(data.get('isDefault')) or (existing and existing['is_default'])) else 0
        if gid == 'milky-way':
            is_default = 1
        commander = commander_id if commander_id is not None else (
            existing['commander_user_id'] if existing else None
        )
        creator = created_by if created_by is not None else (
            existing['created_by'] if existing else None
        )
        conn.execute(
            'INSERT INTO universe_galaxies(id, name, name_cn, description, icon_svg, '
            'detail_tree_json, is_default, created_at, updated_at, commander_user_id, created_by) '
            'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) '
            'ON CONFLICT(id) DO UPDATE SET name=excluded.name, name_cn=excluded.name_cn, '
            'description=excluded.description, icon_svg=excluded.icon_svg, '
            'detail_tree_json=excluded.detail_tree_json, is_default=excluded.is_default, '
            'updated_at=excluded.updated_at, commander_user_id=excluded.commander_user_id, '
            'created_by=COALESCE(universe_galaxies.created_by, excluded.created_by)',
            (
                gid, name, str(data.get('nameCN') or ''), str(data.get('description') or ''),
                icon_svg, json.dumps(detail_tree, ensure_ascii=False), is_default,
                created, updated, commander, creator,
            ),
        )
        if commander:
            conn.execute(
                'INSERT OR IGNORE INTO galaxy_members(galaxy_id, user_id, joined_at) VALUES(?, ?, ?)',
                (gid, commander, updated),
            )
        conn.commit()
    finally:
        conn.close()
    record = get_universe_galaxy(gid)
    return {'ok': True, 'id': gid, 'galaxy': record}


def delete_universe_galaxy(gid):
    if gid == 'milky-way':
        return {'ok': False, 'error': '默认星系不可删除'}
    conn = connect()
    try:
        commander_row = conn.execute(
            'SELECT commander_user_id FROM universe_galaxies WHERE id=?', (gid,)
        ).fetchone()
        cur = conn.execute('DELETE FROM universe_galaxies WHERE id=?', (gid,))
        conn.execute('DELETE FROM galaxy_members WHERE galaxy_id=?', (gid,))
        # 星系内的星体系统归入默认星系：列与 data_json 同步更新，
        # 否则前端读到的 universe.galaxyId 仍指向已删除的星系。
        system_rows = conn.execute(
            'SELECT id, data_json FROM systems WHERE universe_galaxy_id=?', (gid,)
        ).fetchall()
        conn.execute(
            "UPDATE systems SET universe_galaxy_id='milky-way' WHERE universe_galaxy_id=?", (gid,)
        )
        for row in system_rows:
            try:
                data = json.loads(row['data_json'] or '{}')
            except (TypeError, ValueError):
                data = {}
            universe = data.get('universe') if isinstance(data.get('universe'), dict) else {}
            if universe.get('galaxyId') == gid:
                universe['galaxyId'] = 'milky-way'
                data['universe'] = universe
                conn.execute(
                    'UPDATE systems SET data_json=? WHERE id=?',
                    (json.dumps(data, ensure_ascii=False), row['id']),
                )
        conn.commit()
        if commander_row and commander_row['commander_user_id']:
            _notify_simple(
                commander_row['commander_user_id'], 'galaxy',
                '星系已删除', f'你担任指挥官的星系「{gid}」已被开发者删除。',
            )
        return {'ok': True} if cur.rowcount else {'ok': False, 'error': '星系不存在'}
    finally:
        conn.close()


def _notify_simple(user_id, kind, title, body, payload=None):
    conn = connect()
    try:
        _notify(conn, user_id, kind, title, body, payload)
        conn.commit()
    finally:
        conn.close()


# ==================== 星系成员 / 指挥官 ====================

def galaxy_commander_id(gid):
    conn = connect()
    try:
        row = conn.execute(
            'SELECT commander_user_id FROM universe_galaxies WHERE id=?', (gid,)
        ).fetchone()
        return row['commander_user_id'] if row else None
    finally:
        conn.close()


def commanded_galaxy_ids(uid):
    conn = connect()
    try:
        rows = conn.execute(
            'SELECT id FROM universe_galaxies WHERE commander_user_id=?', (uid,)
        ).fetchall()
        return [r['id'] for r in rows]
    finally:
        conn.close()


def set_galaxy_commander(actor_id, gid, user_id):
    conn = connect()
    try:
        actor = conn.execute('SELECT * FROM users WHERE id=?', (actor_id,)).fetchone()
        if not actor or actor['role'] != 'developer':
            return {'ok': False, 'error': '只有开发者可以任命星系指挥官'}
        galaxy = conn.execute('SELECT * FROM universe_galaxies WHERE id=?', (gid,)).fetchone()
        if not galaxy:
            return {'ok': False, 'error': '星系不存在'}
        if user_id:
            target = conn.execute('SELECT * FROM users WHERE id=?', (user_id,)).fetchone()
            if not target:
                return {'ok': False, 'error': '用户不存在'}
            conn.execute(
                'UPDATE universe_galaxies SET commander_user_id=?, updated_at=? WHERE id=?',
                (user_id, now_ms(), gid),
            )
            conn.execute(
                'INSERT OR IGNORE INTO galaxy_members(galaxy_id, user_id, joined_at) VALUES(?, ?, ?)',
                (gid, user_id, now_ms()),
            )
            _notify(conn, user_id, 'galaxy', '指挥官任命',
                    f'你已被任命为星系「{galaxy["name"]}」的星系指挥官。',
                    {'galaxyId': gid})
        else:
            if galaxy['commander_user_id']:
                _notify(conn, galaxy['commander_user_id'], 'galaxy', '指挥官撤销',
                        f'你在星系「{galaxy["name"]}」的星系指挥官职务已被撤销。',
                        {'galaxyId': gid})
            conn.execute(
                'UPDATE universe_galaxies SET commander_user_id=NULL, updated_at=? WHERE id=?',
                (now_ms(), gid),
            )
        conn.commit()
        return {'ok': True}
    finally:
        conn.close()


def join_galaxy(uid, gid):
    conn = connect()
    try:
        if not conn.execute('SELECT 1 FROM universe_galaxies WHERE id=?', (gid,)).fetchone():
            return {'ok': False, 'error': '星系不存在'}
        conn.execute(
            'INSERT OR IGNORE INTO galaxy_members(galaxy_id, user_id, joined_at) VALUES(?, ?, ?)',
            (gid, uid, now_ms()),
        )
        conn.commit()
        return {'ok': True}
    finally:
        conn.close()


def leave_galaxy(uid, gid):
    conn = connect()
    try:
        galaxy = conn.execute('SELECT * FROM universe_galaxies WHERE id=?', (gid,)).fetchone()
        if not galaxy:
            return {'ok': False, 'error': '星系不存在'}
        if galaxy['commander_user_id'] == uid:
            return {'ok': False, 'error': '星系指挥官不能退出自己的星系'}
        conn.execute('DELETE FROM galaxy_members WHERE galaxy_id=? AND user_id=?', (gid, uid))
        conn.commit()
        return {'ok': True}
    finally:
        conn.close()


def list_galaxy_members(gid):
    conn = connect()
    try:
        galaxy = conn.execute('SELECT * FROM universe_galaxies WHERE id=?', (gid,)).fetchone()
        if not galaxy:
            return {'ok': False, 'error': '星系不存在'}
        rows = conn.execute(
            'SELECT u.id, u.username, u.display_name, u.role, u.banned, m.joined_at '
            'FROM galaxy_members m JOIN users u ON u.id=m.user_id '
            'WHERE m.galaxy_id=? ORDER BY m.joined_at',
            (gid,),
        ).fetchall()
        members = [{
            'id': r['id'],
            'username': r['username'],
            'displayName': r['display_name'] or r['username'],
            'role': r['role'],
            'banned': bool(r['banned']),
            'joinedAt': r['joined_at'],
            'isCommander': r['id'] == galaxy['commander_user_id'],
        } for r in rows]
        return {'ok': True, 'members': members, 'commanderUserId': galaxy['commander_user_id']}
    finally:
        conn.close()


def kick_galaxy_member(actor_id, gid, target_id):
    conn = connect()
    try:
        actor = conn.execute('SELECT * FROM users WHERE id=?', (actor_id,)).fetchone()
        galaxy = conn.execute('SELECT * FROM universe_galaxies WHERE id=?', (gid,)).fetchone()
        if not actor or not galaxy:
            return {'ok': False, 'error': '星系或用户不存在'}
        if actor['role'] != 'developer' and galaxy['commander_user_id'] != actor_id:
            return {'ok': False, 'error': '只有该星系指挥官可以踢出成员'}
        if target_id == galaxy['commander_user_id']:
            return {'ok': False, 'error': '不能踢出星系指挥官'}
        row = conn.execute(
            'SELECT 1 FROM galaxy_members WHERE galaxy_id=? AND user_id=?', (gid, target_id)
        ).fetchone()
        if not row:
            return {'ok': False, 'error': '该用户不在星系中'}
        conn.execute('DELETE FROM galaxy_members WHERE galaxy_id=? AND user_id=?', (gid, target_id))
        _notify(conn, target_id, 'galaxy', '已被移出星系',
                f'你已被移出星系「{galaxy["name"]}」。', {'galaxyId': gid})
        conn.commit()
        return {'ok': True}
    finally:
        conn.close()


# ==================== 新星系资格（抢夺） ====================

def publish_galaxy_offer(actor_id, data):
    name = str(data.get('name') or '').strip()
    if not name:
        return {'ok': False, 'error': '缺少星系名称'}
    try:
        quantity = int(data.get('quantity') or 1)
    except (TypeError, ValueError):
        quantity = 1
    quantity = max(1, min(quantity, 20))
    icon_svg = data.get('iconSvg')
    icon_svg = str(icon_svg) if icon_svg else None
    detail_tree = data.get('detailTree') if isinstance(data.get('detailTree'), list) else []
    offer_id = 'offer_' + secrets.token_hex(6)
    conn = connect()
    try:
        actor = conn.execute('SELECT * FROM users WHERE id=?', (actor_id,)).fetchone()
        if not actor or actor['role'] not in ('developer', 'admin'):
            return {'ok': False, 'error': '没有发布资格权限'}
        now = now_ms()
        conn.execute(
            'INSERT INTO galaxy_offers(id, name, name_cn, description, icon_svg, '
            'detail_tree_json, quantity, remaining, created_by, active, created_at, updated_at) '
            'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
            (
                offer_id, name, str(data.get('nameCN') or ''), str(data.get('description') or ''),
                icon_svg, json.dumps(detail_tree, ensure_ascii=False),
                quantity, quantity, actor_id, now, now,
            ),
        )
        citizens = conn.execute(
            "SELECT id FROM users WHERE role='citizen' AND banned=0"
        ).fetchall()
        for row in citizens:
            _notify(
                conn, row['id'], 'offer',
                '新的新星系资格',
                f'管理员发布了 {quantity} 个新星系资格：「{name}」。先到先得，前往个人中心抢夺。',
                {'offerId': offer_id},
            )
        conn.commit()
        return {'ok': True, 'offer': get_galaxy_offer(offer_id, actor_id)}
    finally:
        conn.close()


def get_galaxy_offer(offer_id, viewer_id=None):
    conn = connect()
    try:
        row = conn.execute(
            'SELECT o.*, u.display_name AS creator_name FROM galaxy_offers o '
            'LEFT JOIN users u ON u.id=o.created_by WHERE o.id=?', (offer_id,)
        ).fetchone()
        if not row:
            return None
        claimed = None
        if viewer_id:
            claimed = conn.execute(
                'SELECT galaxy_id FROM offer_claims WHERE offer_id=? AND user_id=?',
                (offer_id, viewer_id),
            ).fetchone()
        return {
            'id': row['id'],
            'name': row['name'],
            'nameCN': row['name_cn'],
            'description': row['description'],
            'iconSvg': row['icon_svg'],
            'detailTree': json.loads(row['detail_tree_json'] or '[]'),
            'quantity': row['quantity'],
            'remaining': row['remaining'],
            'createdBy': row['created_by'],
            'creatorName': row['creator_name'],
            'active': bool(row['active']),
            'createdAt': row['created_at'],
            'updatedAt': row['updated_at'],
            'claimedGalaxyId': claimed['galaxy_id'] if claimed else None,
        }
    finally:
        conn.close()


def list_galaxy_offers(viewer_id=None, include_inactive=False):
    conn = connect()
    try:
        sql = 'SELECT o.*, u.display_name AS creator_name FROM galaxy_offers o ' \
              'LEFT JOIN users u ON u.id=o.created_by '
        if not include_inactive:
            sql += 'WHERE o.remaining>0 AND o.active=1 '
        sql += 'ORDER BY o.created_at DESC'
        rows = conn.execute(sql).fetchall()
        claimed_by_me = {}
        if viewer_id:
            for r in conn.execute('SELECT offer_id, galaxy_id FROM offer_claims WHERE user_id=?', (viewer_id,)).fetchall():
                claimed_by_me[r['offer_id']] = r['galaxy_id']
        out = []
        for row in rows:
            out.append({
                'id': row['id'],
                'name': row['name'],
                'nameCN': row['name_cn'],
                'description': row['description'],
                'iconSvg': row['icon_svg'],
                'detailTree': json.loads(row['detail_tree_json'] or '[]'),
                'quantity': row['quantity'],
                'remaining': row['remaining'],
                'createdBy': row['created_by'],
                'creatorName': row['creator_name'],
                'active': bool(row['active']),
                'createdAt': row['created_at'],
                'updatedAt': row['updated_at'],
                'claimedGalaxyId': claimed_by_me.get(row['id']),
            })
        return out
    finally:
        conn.close()


def claim_galaxy_offer(uid, offer_id):
    conn = connect()
    try:
        conn.execute('BEGIN IMMEDIATE')
        user = conn.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()
        if not user or user['banned']:
            conn.rollback()
            return {'ok': False, 'error': '账号不可用'}
        offer = conn.execute('SELECT * FROM galaxy_offers WHERE id=?', (offer_id,)).fetchone()
        if not offer or not offer['active'] or offer['remaining'] <= 0:
            conn.rollback()
            return {'ok': False, 'error': '该资格已被抢完或已下架'}
        already = conn.execute(
            'SELECT galaxy_id FROM offer_claims WHERE offer_id=? AND user_id=?',
            (offer_id, uid),
        ).fetchone()
        if already:
            conn.rollback()
            return {'ok': False, 'error': '你已经领取过这个资格', 'galaxyId': already['galaxy_id']}

        base = re.sub(r'[^a-z0-9一-鿿]+', '_', (offer['name_cn'] or offer['name']).lower()).strip('_')[:40]
        if not base:
            base = 'community'
        gid = base
        suffix = 2
        while conn.execute('SELECT 1 FROM universe_galaxies WHERE id=?', (gid,)).fetchone():
            gid = f'{base}_{suffix}'
            suffix += 1
            if suffix > 999:
                gid = f'{base}_{secrets.token_hex(3)}'
                break
        now = now_ms()
        conn.execute(
            'INSERT INTO universe_galaxies(id, name, name_cn, description, icon_svg, '
            'detail_tree_json, is_default, created_at, updated_at, commander_user_id, created_by) '
            'VALUES(?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)',
            (
                gid, offer['name'], offer['name_cn'], offer['description'], offer['icon_svg'],
                offer['detail_tree_json'], now, now, uid, offer['created_by'],
            ),
        )
        conn.execute(
            'INSERT OR IGNORE INTO galaxy_members(galaxy_id, user_id, joined_at) VALUES(?, ?, ?)',
            (gid, uid, now),
        )
        conn.execute(
            'UPDATE galaxy_offers SET remaining=remaining-1, updated_at=? WHERE id=?',
            (now, offer_id),
        )
        conn.execute(
            'INSERT INTO offer_claims(offer_id, user_id, galaxy_id, claimed_at) VALUES(?, ?, ?, ?)',
            (offer_id, uid, gid, now),
        )
        _notify(
            conn, uid, 'offer', '抢夺成功',
            f'你已获得星系「{offer["name"]}」并成为其星系指挥官。',
            {'offerId': offer_id, 'galaxyId': gid},
        )
        if offer['created_by'] and offer['created_by'] != uid:
            _notify(
                conn, offer['created_by'], 'offer', '资格已被领取',
                f'你发布的资格「{offer["name"]}」被用户「{user["display_name"] or user["username"]}」领取。',
                {'offerId': offer_id, 'galaxyId': gid},
            )
        conn.commit()
    except Exception as e:
        conn.rollback()
        return {'ok': False, 'error': str(e)}
    finally:
        conn.close()
    return {'ok': True, 'galaxy': get_universe_galaxy(gid, uid)}


def cancel_galaxy_offer(actor_id, offer_id):
    conn = connect()
    try:
        actor = conn.execute('SELECT * FROM users WHERE id=?', (actor_id,)).fetchone()
        offer = conn.execute('SELECT * FROM galaxy_offers WHERE id=?', (offer_id,)).fetchone()
        if not actor or not offer:
            return {'ok': False, 'error': '资格不存在'}
        if actor['role'] != 'developer' and offer['created_by'] != actor_id:
            return {'ok': False, 'error': '没有权限下架该资格'}
        conn.execute(
            'UPDATE galaxy_offers SET active=0, remaining=0, updated_at=? WHERE id=?',
            (now_ms(), offer_id),
        )
        conn.commit()
        return {'ok': True}
    finally:
        conn.close()


# ==================== 星体关联 ====================

def _hidden_draft_system_ids(conn, viewer_id):
    """作者之外的人都不可见的草稿系统 id（草稿是私有的未发布内容）。"""
    rows = conn.execute(
        "SELECT id, owner_user_id FROM systems WHERE status='draft'"
    ).fetchall()
    return {
        row['id'] for row in rows
        if not viewer_id or row['owner_user_id'] != viewer_id
    }


def _relation_row(row):
    return {
        'id': row['id'],
        'fromSystemId': row['from_system_id'],
        'fromKey': row['from_key'],
        'fromName': row['from_name'],
        'toSystemId': row['to_system_id'],
        'toKey': row['to_key'],
        'toName': row['to_name'],
        'updatedAt': row['updated_at'],
    }


def list_body_relations(viewer=None):
    """列出星体关联；指向他人草稿的关联对查看者隐藏。"""
    viewer_id = (viewer or {}).get('id')
    conn = connect()
    try:
        hidden = _hidden_draft_system_ids(conn, viewer_id)
        rows = conn.execute('SELECT * FROM body_relations ORDER BY updated_at DESC').fetchall()
        out = []
        for row in rows:
            if row['from_system_id'] in hidden or row['to_system_id'] in hidden:
                continue
            out.append(_relation_row(row))
        return out
    finally:
        conn.close()


def normalize_relation(item):
    if not isinstance(item, dict):
        return None
    from_sys = str(item.get('fromSystemId') or '').strip()
    to_sys = str(item.get('toSystemId') or '').strip()
    from_key = str(item.get('fromKey') or '').strip()
    to_key = str(item.get('toKey') or '').strip()
    if not (from_sys and to_sys and from_key and to_key):
        return None
    if from_sys == to_sys and from_key == to_key:
        return None
    return {
        'id': f'{from_sys}:{from_key}->{to_sys}:{to_key}',
        'fromSystemId': from_sys,
        'fromKey': from_key,
        'fromName': str(item.get('fromName') or '').strip(),
        'toSystemId': to_sys,
        'toKey': to_key,
        'toName': str(item.get('toName') or '').strip(),
        'updatedAt': int(item.get('updatedAt') or now_ms()),
    }


def replace_body_relations(items, viewer=None):
    viewer_id = (viewer or {}).get('id')
    clean = []
    seen = set()
    for item in (items or [])[:5000]:
        rel = normalize_relation(item)
        if rel and rel['id'] not in seen:
            seen.add(rel['id'])
            clean.append(rel)
    conn = connect()
    try:
        # 整个表被替换，但他人草稿的关联对调用方不可见：
        # 这些记录必须原样保留，否则保存一次就会把它们删掉。
        hidden = _hidden_draft_system_ids(conn, viewer_id)
        preserved = []
        if hidden:
            for row in conn.execute('SELECT * FROM body_relations').fetchall():
                if row['from_system_id'] in hidden or row['to_system_id'] in hidden:
                    preserved.append(_relation_row(row))
        clean = [
            rel for rel in clean
            if rel['fromSystemId'] not in hidden and rel['toSystemId'] not in hidden
        ]
        preserved_ids = {rel['id'] for rel in preserved}
        final = preserved + [rel for rel in clean if rel['id'] not in preserved_ids]

        conn.execute('DELETE FROM body_relations')
        conn.executemany(
            'INSERT INTO body_relations(id, from_system_id, from_key, from_name, '
            'to_system_id, to_key, to_name, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
            [(
                rel['id'], rel['fromSystemId'], rel['fromKey'], rel['fromName'],
                rel['toSystemId'], rel['toKey'], rel['toName'], rel['updatedAt'],
            ) for rel in final],
        )
        conn.commit()
        return {'ok': True, 'count': len(final)}
    finally:
        conn.close()


# ==================== 详情文件（文本入库 / 图片只存相对路径）====================

def add_detail_text(name, content):
    conn = connect()
    try:
        conn.execute(
            'INSERT INTO detail_files(name, kind, rel_path, content, mime, created_at) '
            'VALUES(?, ?, NULL, ?, ?, ?) '
            'ON CONFLICT(name) DO UPDATE SET kind=excluded.kind, rel_path=NULL, '
            'content=excluded.content, mime=excluded.mime',
            (name, 'text', content, 'text/plain; charset=utf-8', now_ms()),
        )
        conn.commit()
    finally:
        conn.close()


def add_detail_image(name, rel_path, mime):
    conn = connect()
    try:
        conn.execute(
            'INSERT INTO detail_files(name, kind, rel_path, content, mime, created_at) '
            'VALUES(?, ?, ?, NULL, ?, ?) '
            'ON CONFLICT(name) DO UPDATE SET kind=excluded.kind, rel_path=excluded.rel_path, '
            'content=NULL, mime=excluded.mime',
            (name, 'image', rel_path, mime, now_ms()),
        )
        conn.commit()
    finally:
        conn.close()


def get_detail_file(name):
    conn = connect()
    try:
        row = conn.execute('SELECT * FROM detail_files WHERE name=?', (name,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


# ==================== 旧数据迁移 ====================

def _migrate_legacy(conn):
    if _get_meta(conn, 'legacy_files_v1') != '1':
        _migrate_universes(conn)
        _migrate_relations(conn)
        _migrate_custom_systems(conn)
        _migrate_builtin_systems(conn)
        _set_meta(conn, 'legacy_files_v1', '1')
    if _get_meta(conn, 'legacy_details_v1') != '1':
        _migrate_detail_files(conn)
        _set_meta(conn, 'legacy_details_v1', '1')
    conn.commit()


def _migrate_universes(conn):
    data = _read_json(UNIVERSE_FILE, [])
    if isinstance(data, dict):
        data = data.get('galaxies', [])
    if not isinstance(data, list):
        return
    for item in data:
        if not isinstance(item, dict):
            continue
        gid = _safe_id(item.get('id'))
        if not gid:
            continue
        existing = conn.execute('SELECT updated_at FROM universe_galaxies WHERE id=?', (gid,)).fetchone()
        incoming = int(item.get('updatedAt') or 0)
        if existing and int(existing['updated_at']) >= incoming:
            continue
        icon_svg = item.get('iconSvg')
        detail_tree = item.get('detailTree') if isinstance(item.get('detailTree'), list) else []
        conn.execute(
            'INSERT INTO universe_galaxies(id, name, name_cn, description, icon_svg, '
            'detail_tree_json, is_default, created_at, updated_at) '
            'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?) '
            'ON CONFLICT(id) DO UPDATE SET name=excluded.name, name_cn=excluded.name_cn, '
            'description=excluded.description, icon_svg=excluded.icon_svg, '
            'detail_tree_json=excluded.detail_tree_json, is_default=excluded.is_default, '
            'updated_at=excluded.updated_at',
            (
                gid, str(item.get('name') or gid), str(item.get('nameCN') or ''),
                str(item.get('description') or ''),
                str(icon_svg) if icon_svg is not None else None,
                json.dumps(detail_tree, ensure_ascii=False),
                1 if (item.get('isDefault') or gid == 'milky-way') else 0,
                int(item.get('createdAt') or now_ms()), incoming or now_ms(),
            ),
        )


def _migrate_relations(conn):
    data = _read_json(BODY_RELATIONS_FILE, [])
    if isinstance(data, dict):
        data = data.get('relations', [])
    if not isinstance(data, list):
        return
    for item in data:
        rel = normalize_relation(item)
        if not rel:
            continue
        conn.execute(
            'INSERT INTO body_relations(id, from_system_id, from_key, from_name, '
            'to_system_id, to_key, to_name, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?) '
            'ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at',
            (
                rel['id'], rel['fromSystemId'], rel['fromKey'], rel['fromName'],
                rel['toSystemId'], rel['toKey'], rel['toName'], rel['updatedAt'],
            ),
        )


def _migrate_custom_systems(conn):
    if not os.path.isdir(CUSTOM_DIR):
        return
    for name in sorted(os.listdir(CUSTOM_DIR)):
        folder = os.path.join(CUSTOM_DIR, name)
        data_file = os.path.join(folder, 'data.json')
        if not os.path.isdir(folder) or not os.path.exists(data_file):
            continue
        gid = _safe_id(name)
        if not gid:
            continue
        existing = conn.execute('SELECT 1 FROM systems WHERE id=?', (gid,)).fetchone()
        if existing:
            continue
        data = _read_json(data_file, None)
        if not isinstance(data, dict):
            continue
        record = normalize_system_record(data, gid)
        record = materialize_images(record, gid)
        created = int(record.get('createdAt') or now_ms())
        updated = int(record.get('updatedAt') or created)
        record['createdAt'] = created
        record['updatedAt'] = updated
        conn.execute(
            'INSERT INTO systems(id, kind, name, name_cn, description, data_json, created_at, updated_at) '
            'VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
            (
                gid, 'custom', record.get('name', ''), record.get('nameCN', ''),
                record.get('description', ''),
                json.dumps(record, ensure_ascii=False, separators=(',', ':')),
                created, updated,
            ),
        )
        _ensure_module_stub(gid, record)


def _migrate_builtin_systems(conn):
    for gid, path in BUILTIN_DATA_FILES.items():
        if not os.path.exists(path):
            continue
        existing = conn.execute('SELECT 1 FROM systems WHERE id=?', (gid,)).fetchone()
        if existing:
            continue
        data = _read_json(path, None)
        if not isinstance(data, dict):
            continue
        record = normalize_system_record(data, gid)
        conn.execute(
            'INSERT INTO systems(id, kind, name, name_cn, description, data_json, created_at, updated_at) '
            'VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
            (
                gid, 'builtin', record.get('name', ''), record.get('nameCN', ''),
                record.get('description', ''),
                json.dumps(record, ensure_ascii=False, separators=(',', ':')),
                now_ms(), now_ms(),
            ),
        )


def _migrate_detail_files(conn):
    if not os.path.isdir(DETAIL_DIR):
        return
    for name in sorted(os.listdir(DETAIL_DIR)):
        path = os.path.join(DETAIL_DIR, name)
        if not os.path.isfile(path) or name.startswith('.'):
            continue
        ext = os.path.splitext(name)[1].lower()
        existing = conn.execute('SELECT 1 FROM detail_files WHERE name=?', (name,)).fetchone()
        if existing:
            continue
        if ext == '.txt':
            try:
                with open(path, 'r', encoding='utf-8', errors='replace') as f:
                    content = f.read()
            except Exception:
                continue
            conn.execute(
                'INSERT INTO detail_files(name, kind, rel_path, content, mime, created_at) '
                'VALUES(?, ?, NULL, ?, ?, ?)',
                (name, 'text', content, 'text/plain; charset=utf-8', now_ms()),
            )
        elif ext in ('.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg'):
            mime = mimetypes.guess_type(name)[0] or 'application/octet-stream'
            conn.execute(
                'INSERT INTO detail_files(name, kind, rel_path, content, mime, created_at) '
                'VALUES(?, ?, ?, NULL, ?, ?)',
                (name, 'image', f'detail_files/{name}', mime, now_ms()),
            )


# ==================== 浏览器 localStorage 迁移 ====================

def migrate_local_payload(payload, viewer=None):
    """把前端 localStorage 里的旧数据并入数据库；已有且更新的记录不覆盖。

    viewer 为当前登录用户：新导入的系统归其所有，普通公民的系统进入待审核状态。
    """
    payload = payload if isinstance(payload, dict) else {}
    systems = payload.get('systems') or []
    universes = payload.get('universes') or []
    relations = payload.get('relations') or []
    counts = {'systems': 0, 'universes': 0, 'relations': 0}
    viewer_id = (viewer or {}).get('id')
    is_staff = (viewer or {}).get('role') in ('developer', 'admin')

    conn = connect()
    try:
        for item in systems[:500]:
            if not isinstance(item, dict):
                continue
            gid = _safe_id(item.get('id'))
            if not gid:
                continue
            incoming = int(item.get('updatedAt') or 0)
            existing = conn.execute('SELECT * FROM systems WHERE id=?', (gid,)).fetchone()
            if existing and int(existing['updated_at']) >= incoming:
                continue
            record = normalize_system_record(item, gid)
            record = materialize_images(record, gid)
            created = int(item.get('createdAt') or record.get('createdAt') or now_ms())
            updated = incoming or now_ms()
            record['createdAt'] = created
            record['updatedAt'] = updated
            owner = (existing['owner_user_id'] if existing else None) or viewer_id
            # 草稿是作者私有状态，迁移时允许保留；其余状态始终由服务器决定
            incoming_draft = str(item.get('status') or '').lower() == 'draft'
            status = (existing['status'] if existing else None) or (
                'draft' if incoming_draft else ('approved' if is_staff else 'pending')
            )
            galaxy_id = (
                (record.get('universe') or {}).get('galaxyId')
                or (existing['universe_galaxy_id'] if existing else None)
                or 'milky-way'
            )
            conn.execute(
                'INSERT INTO systems(id, kind, name, name_cn, description, data_json, created_at, updated_at, '
                'owner_user_id, universe_galaxy_id, status, submitted_at) '
                'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) '
                'ON CONFLICT(id) DO UPDATE SET name=excluded.name, name_cn=excluded.name_cn, '
                'description=excluded.description, data_json=excluded.data_json, updated_at=excluded.updated_at, '
                'owner_user_id=COALESCE(systems.owner_user_id, excluded.owner_user_id), '
                'universe_galaxy_id=excluded.universe_galaxy_id',
                (
                    gid, 'custom', record.get('name', ''), record.get('nameCN', ''),
                    record.get('description', ''),
                    json.dumps(record, ensure_ascii=False, separators=(',', ':')),
                    created, updated, owner, galaxy_id, status, updated,
                ),
            )
            _ensure_module_stub(gid, record)
            counts['systems'] += 1

        for item in universes[:500]:
            if not isinstance(item, dict):
                continue
            gid = _safe_id(item.get('id'))
            if not gid:
                continue
            incoming = int(item.get('updatedAt') or 0)
            existing = conn.execute('SELECT updated_at FROM universe_galaxies WHERE id=?', (gid,)).fetchone()
            if existing and int(existing['updated_at']) >= incoming:
                continue
            icon_svg = item.get('iconSvg')
            detail_tree = item.get('detailTree') if isinstance(item.get('detailTree'), list) else []
            conn.execute(
                'INSERT INTO universe_galaxies(id, name, name_cn, description, icon_svg, '
                'detail_tree_json, is_default, created_at, updated_at, commander_user_id, created_by) '
                'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) '
                'ON CONFLICT(id) DO UPDATE SET name=excluded.name, name_cn=excluded.name_cn, '
                'description=excluded.description, icon_svg=excluded.icon_svg, '
                'detail_tree_json=excluded.detail_tree_json, is_default=excluded.is_default, '
                'updated_at=excluded.updated_at',
                (
                    gid, str(item.get('name') or gid), str(item.get('nameCN') or ''),
                    str(item.get('description') or ''),
                    str(icon_svg) if icon_svg is not None else None,
                    json.dumps(detail_tree, ensure_ascii=False),
                    1 if (item.get('isDefault') or gid == 'milky-way') else 0,
                    int(item.get('createdAt') or now_ms()), incoming or now_ms(),
                    viewer_id if gid != 'milky-way' else None,
                    viewer_id,
                ),
            )
            if viewer_id and gid != 'milky-way':
                conn.execute(
                    'INSERT OR IGNORE INTO galaxy_members(galaxy_id, user_id, joined_at) VALUES(?, ?, ?)',
                    (gid, viewer_id, now_ms()),
                )
            counts['universes'] += 1

        for item in relations[:5000]:
            rel = normalize_relation(item)
            if not rel:
                continue
            conn.execute(
                'INSERT INTO body_relations(id, from_system_id, from_key, from_name, '
                'to_system_id, to_key, to_name, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?) '
                'ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at',
                (
                    rel['id'], rel['fromSystemId'], rel['fromKey'], rel['fromName'],
                    rel['toSystemId'], rel['toKey'], rel['toName'], rel['updatedAt'],
                ),
            )
            counts['relations'] += 1

        conn.commit()
        _set_meta(conn, 'localstorage_migrated_at', now_ms())
        conn.commit()
        return {'ok': True, **counts}
    finally:
        conn.close()


# ==================== 模块桩文件 ====================

def ensure_module_stub(gid, record):
    _ensure_module_stub(gid, record)


def _ensure_module_stub(gid, record):
    """自定义系统仍需要一个静态 index.js 供浏览器 import 注册模块。"""
    folder = os.path.join(CUSTOM_DIR, gid)
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, 'index.js')
    if os.path.exists(path):
        return
    info = {
        'id': gid,
        'name': record.get('name', gid),
        'nameCN': record.get('nameCN', ''),
        'description': record.get('description', ''),
        'icon': record.get('icon', '🌟'),
    }
    text = (
        '// Auto-generated galaxy module stub (data lives in Galaxy/universe.db)\n'
        f'export const SYSTEM_INFO = {json.dumps(info, ensure_ascii=False)};\n'
        'export const MOON_CLASSES = {};\n'
        'export const PLANET_DATA = [];\n'
        'export function createPlanets(scene, ep) { return {}; }\n'
    )
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)
