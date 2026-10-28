import os, re, json, http.server, socketserver, shutil, urllib.parse, time, zipfile
import base64, random, mimetypes, http.cookies

import db

DIR = os.path.dirname(os.path.abspath(__file__))
CUSTOM_DIR = os.path.join(DIR, 'Galaxy', 'custom')
DETAIL_DIR = os.path.join(DIR, 'detail_files')
MUSIC_DIR = os.path.join(DIR, 'music')
MUSIC_INDEX = os.path.join(MUSIC_DIR, 'index.json')
MAX_BODY = 64 * 1024 * 1024
MAX_BGM = 25 * 1024 * 1024
SESSION_COOKIE = 'universe_session'
AUDIO_EXT = {'.mp3', '.wav', '.ogg', '.flac', '.m4a'}

os.chdir(DIR)
os.makedirs(CUSTOM_DIR, exist_ok=True)
os.makedirs(DETAIL_DIR, exist_ok=True)
os.makedirs(MUSIC_DIR, exist_ok=True)
db.init_db()

# 简单的登录失败限速（进程内；单机开发服务器足够）
_LOGIN_FAILS = {}
LOGIN_WINDOW = 10 * 60
LOGIN_MAX_FAILS = 10


def _safe_folder(value):
    """文件夹名 / id 净化：去掉路径分隔符/控制字符，拒绝 . 与 ..，防止目录穿越。"""
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', '_', str(value or '')).strip().strip('.')
    return '' if name in ('', '.', '..') else name


def _safe_audio_name(value):
    raw = os.path.basename(str(value or '').replace('\\', '/')).strip()
    ext = os.path.splitext(raw)[1].lower()
    if ext not in AUDIO_EXT:
        return ''
    stem = re.sub(r'[^\w一-鿿.\-]+', '_', os.path.splitext(raw)[0]).strip('._')[:120]
    return (stem or 'track') + ext


def _too_many_fails(key):
    now = time.time()
    arr = [t for t in _LOGIN_FAILS.get(key, []) if now - t < LOGIN_WINDOW]
    _LOGIN_FAILS[key] = arr
    return len(arr) >= LOGIN_MAX_FAILS


def _record_fail(key):
    _LOGIN_FAILS.setdefault(key, []).append(time.time())


class Handler(http.server.SimpleHTTPRequestHandler):
    server_version = 'StarrySky/1.0'
    sys_version = ''

    # ==================== 请求基础 ====================

    def _session_token(self):
        raw = self.headers.get('Cookie')
        if not raw:
            return None
        try:
            jar = http.cookies.SimpleCookie(raw)
            morsel = jar.get(SESSION_COOKIE)
            return morsel.value if morsel else None
        except Exception:
            return None

    def _current_user(self):
        if hasattr(self, '_user_cache'):
            return self._user_cache
        token = self._session_token()
        self._user_cache = db.get_user_by_session(token) if token else None
        return self._user_cache

    def _json(self, obj, status=200, set_cookie=None, clear_cookie=False):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Access-Control-Allow-Origin', '*')
        if set_cookie:
            self.send_header(
                'Set-Cookie',
                f'{SESSION_COOKIE}={set_cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000',
            )
        elif clear_cookie:
            self.send_header(
                'Set-Cookie',
                f'{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
            )
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _need_user(self):
        user = self._current_user()
        if not user:
            self._json({'ok': False, 'error': '请先登录'}, 401)
            return None
        return user

    def _need_staff(self):
        user = self._need_user()
        if not user:
            return None
        if user.get('role') not in ('developer', 'admin'):
            self._json({'ok': False, 'error': '需要网站管理权限'}, 403)
            return None
        return user

    def _need_developer(self):
        user = self._need_user()
        if not user:
            return None
        if user.get('role') != 'developer':
            self._json({'ok': False, 'error': '该操作仅限开发者'}, 403)
            return None
        return user

    def _origin_ok(self):
        origin = self.headers.get('Origin')
        if not origin:
            return True
        host = self.headers.get('Host') or ''
        try:
            return urllib.parse.urlsplit(origin).netloc == host
        except Exception:
            return False

    # ==================== GET ====================

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        if path == '/':
            self.path = '/index_font/heidong.html'
        elif path.startswith('/detail_files/'):
            return self._serve_detail(path[len('/detail_files/'):])
        elif path == '/api/auth/me':
            user = self._current_user()
            return self._json({'ok': True, 'user': db.get_me(user['id']) if user else None})
        return super().do_GET()

    # ==================== POST ====================

    def do_POST(self):
        if not self._origin_ok():
            self._json({'ok': False, 'error': '跨站请求被拒绝'}, 403)
            return
        length = int(self.headers.get('Content-Length', 0) or 0)
        if length > MAX_BODY:
            self._json({'ok': False, 'error': '请求体过大'}, 413)
            return
        raw = self.rfile.read(length) if length else b''

        if self.path == '/api/import-galaxy':
            user = self._need_staff()
            if not user:
                return
            self._json(self._import_galaxy(raw, user))
            return

        try:
            body = raw.decode('utf-8') if raw else '{}'
            data = json.loads(body) if body else {}
            if not isinstance(data, dict):
                raise ValueError('body must be an object')
        except Exception:
            self._json({'ok': False, 'error': '无效的 JSON'}, 400)
            return

        path = self.path
        user = self._current_user()

        # ---------- 账号 ----------
        if path == '/api/auth/register':
            return self._register(data)
        if path == '/api/auth/login':
            return self._login(data)
        if path == '/api/auth/logout':
            token = self._session_token()
            db.delete_session(token)
            return self._json({'ok': True}, clear_cookie=True)
        if path == '/api/auth/me':
            return self._json({'ok': True, 'user': db.get_me(user['id']) if user else None})
        if path == '/api/auth/profile':
            user = self._need_user()
            if not user:
                return
            result = db.update_profile(
                user['id'],
                display_name=data.get('displayName'),
                password=data.get('newPassword') or None,
                current_password=data.get('currentPassword') or '',
            )
            if result.get('ok'):
                result['user'] = db.get_me(user['id'])
            return self._json(result)

        # ---------- 星体系统 ----------
        if path == '/api/list-galaxies':
            return self._json({'galaxies': db.list_systems('custom', viewer=user)})
        if path == '/api/my-systems':
            user = self._need_user()
            if not user:
                return
            return self._json({'galaxies': db.list_owned_systems(user['id'])})
        if path == '/api/create-galaxy':
            user = self._need_user()
            if not user:
                return
            return self._json(self._create_galaxy(data, user))
        if path == '/api/update-galaxy':
            user = self._need_user()
            if not user:
                return
            return self._json(self._update_galaxy(data, user))
        if path == '/api/publish-system':
            user = self._need_user()
            if not user:
                return
            gid = _safe_folder(data.get('id') or '')
            if not gid:
                return self._json({'ok': False, 'error': '缺少星系 id'})
            record = db.get_system(gid, 'custom')
            if not record:
                return self._json({'ok': False, 'error': '星系不存在'})
            if user['role'] == 'admin':
                return self._json({'ok': False, 'error': '管理员不能修改星体系统'})
            if user['role'] != 'developer' and record.get('ownerUserId') != user['id']:
                return self._json({'ok': False, 'error': '只能发布自己创建的星体系统'})
            if user['role'] == 'citizen' and not db.is_galaxy_member(
                    record.get('universeGalaxyId') or 'milky-way', user['id']):
                return self._json({'ok': False, 'error': '请先加入该星系，再发布星体系统'})
            status = 'approved' if user['role'] == 'developer' else 'pending'
            result = db.publish_system(gid, status)
            if result.get('ok'):
                result['galaxy'] = db.get_system(gid, 'custom')
                if status == 'pending':
                    result['message'] = '已提交，等待开发者审核'
            return self._json(result)
        if path == '/api/delete-galaxy':
            user = self._need_user()
            if not user:
                return
            return self._json(self._delete_galaxy(data, user))
        if path == '/api/export-galaxies':
            user = self._need_user()
            if not user:
                return
            return self._json(self._export_galaxies(data, user))
        if path == '/api/upload-detail-file':
            user = self._need_user()
            if not user:
                return
            return self._json(self._upload_detail_file(data))

        # ---------- 审核 / 网站管理 ----------
        if path == '/api/admin/systems':
            user = self._need_staff()
            if not user:
                return
            return self._json({'galaxies': db.list_systems('custom', viewer=user)})
        if path == '/api/review-system':
            user = self._need_developer()
            if not user:
                return
            action = str(data.get('action') or '')
            status = {'approve': 'approved', 'reject': 'rejected'}.get(action)
            if not status:
                return self._json({'ok': False, 'error': 'action 必须是 approve / reject'}, 400)
            return self._json(db.set_system_status(
                _safe_folder(data.get('id')), status, user['id'], data.get('note') or ''
            ))
        if path == '/api/admin/users':
            user = self._need_staff()
            if not user:
                return
            return self._json({'ok': True, 'users': db.list_users()})
        if path == '/api/admin/set-role':
            user = self._need_developer()
            if not user:
                return
            return self._json(db.set_user_role(user['id'], data.get('userId'), data.get('role')))
        if path == '/api/admin/set-banned':
            user = self._need_staff()
            if not user:
                return
            return self._json(db.set_user_banned(
                user['id'], data.get('userId'), bool(data.get('banned'))
            ))
        if path == '/api/admin/delete-user':
            user = self._need_developer()
            if not user:
                return
            return self._json(db.delete_user(user['id'], data.get('userId')))

        # ---------- 宇宙星系 / 社区 ----------
        if path == '/api/list-universe-galaxies':
            return self._json({
                'galaxies': db.list_universe_galaxies(user['id'] if user else None)
            })
        if path == '/api/save-universe-galaxy':
            user = self._need_user()
            if not user:
                return
            return self._json(self._save_universe_galaxy(data, user))
        if path == '/api/delete-universe-galaxy':
            user = self._need_developer()
            if not user:
                return
            return self._json(db.delete_universe_galaxy(_safe_folder(data.get('id'))))
        if path == '/api/admin/set-commander':
            user = self._need_developer()
            if not user:
                return
            uid = data.get('userId') or None
            return self._json(db.set_galaxy_commander(
                user['id'], _safe_folder(data.get('galaxyId')), uid
            ))
        if path == '/api/galaxy/join':
            user = self._need_user()
            if not user:
                return
            return self._json(db.join_galaxy(user['id'], _safe_folder(data.get('galaxyId'))))
        if path == '/api/galaxy/leave':
            user = self._need_user()
            if not user:
                return
            return self._json(db.leave_galaxy(user['id'], _safe_folder(data.get('galaxyId'))))
        if path == '/api/galaxy/members':
            user = self._need_user()
            if not user:
                return
            return self._json(db.list_galaxy_members(_safe_folder(data.get('galaxyId'))))
        if path == '/api/galaxy/kick':
            user = self._need_user()
            if not user:
                return
            return self._json(db.kick_galaxy_member(
                user['id'], _safe_folder(data.get('galaxyId')), data.get('userId')
            ))
        if path == '/api/my-memberships':
            user = self._need_user()
            if not user:
                return
            me = db.get_me(user['id'])
            return self._json({'ok': True, 'memberships': me['memberships'] if me else []})

        # ---------- 新星系资格 / 消息 ----------
        if path == '/api/offers/list':
            include_inactive = bool(data.get('includeInactive')) and (
                user and user.get('role') in ('developer', 'admin')
            )
            return self._json({
                'ok': True,
                'offers': db.list_galaxy_offers(
                    user['id'] if user else None, include_inactive=include_inactive
                ),
            })
        if path == '/api/offers/publish':
            user = self._need_staff()
            if not user:
                return
            return self._json(db.publish_galaxy_offer(user['id'], data))
        if path == '/api/offers/claim':
            user = self._need_user()
            if not user:
                return
            return self._json(db.claim_galaxy_offer(user['id'], data.get('offerId')))
        if path == '/api/offers/cancel':
            user = self._need_staff()
            if not user:
                return
            return self._json(db.cancel_galaxy_offer(user['id'], data.get('offerId')))
        if path == '/api/messages':
            user = self._need_user()
            if not user:
                return
            return self._json({
                'ok': True,
                'messages': db.list_messages(user['id'], data.get('limit') or 100),
                'unread': db.unread_count(user['id']),
            })
        if path == '/api/messages/read':
            user = self._need_user()
            if not user:
                return
            ids = data.get('ids')
            result = db.mark_messages_read(user['id'], ids if isinstance(ids, list) else None)
            result['unread'] = db.unread_count(user['id'])
            return self._json(result)

        # ---------- 星体关联 ----------
        if path == '/api/list-body-relations':
            return self._json({'relations': db.list_body_relations(user)})
        if path == '/api/save-body-relations':
            user = self._need_user()
            if not user:
                return
            return self._json(self._save_body_relations(data, user))

        # ---------- 数据迁移 ----------
        if path == '/api/migrate-local-data':
            user = self._need_user()
            if not user:
                return
            return self._json(db.migrate_local_payload(data, viewer=user))

        # ---------- 背景音乐（开发者） ----------
        if path == '/api/admin/list-bgm':
            user = self._need_developer()
            if not user:
                return
            return self._json({'ok': True, 'files': self._read_bgm_index()})
        if path == '/api/admin/upload-bgm':
            user = self._need_developer()
            if not user:
                return
            return self._json(self._upload_bgm(data))
        if path == '/api/admin/delete-bgm':
            user = self._need_developer()
            if not user:
                return
            return self._json(self._delete_bgm(data))

        return self._json({'ok': False, 'error': 'unknown endpoint'}, 404)

    # ==================== 账号 ====================

    def _register(self, data):
        username = str(data.get('username') or '').strip()
        key = f'{self.client_address[0]}|{username.lower()}'
        if _too_many_fails(key):
            return self._json({'ok': False, 'error': '尝试次数过多，请稍后再试'}, 429)
        result = db.register_user(
            username, data.get('password') or '', data.get('displayName') or ''
        )
        if not result.get('ok'):
            return self._json(result, 400)
        token = db.create_session(result['user']['id'])
        result['user'] = db.get_me(result['user']['id'])
        self._json(result, 200, set_cookie=token)

    def _login(self, data):
        username = str(data.get('username') or '').strip()
        key = f'{self.client_address[0]}|{username.lower()}'
        if _too_many_fails(key):
            return self._json({'ok': False, 'error': '尝试次数过多，请 10 分钟后再试'}, 429)
        result = db.authenticate(username, data.get('password') or '')
        if not result.get('ok'):
            _record_fail(key)
            return self._json(result, 401)
        _LOGIN_FAILS.pop(key, None)
        token = db.create_session(result['user']['id'])
        result['user'] = db.get_me(result['user']['id'])
        self._json(result, 200, set_cookie=token)

    # ==================== 星体系统 ====================

    def _create_galaxy(self, data, user):
        name = data.get('name', '新星系')
        as_draft = bool(data.get('draft'))
        galaxy_id = _safe_folder(data.get('id') or 'galaxy_' + str(int(time.time() * 1000)))
        if not galaxy_id:
            return {'ok': False, 'error': '无效的星系 id'}

        existing_ids = set()
        if os.path.exists(CUSTOM_DIR):
            existing_ids.update(os.listdir(CUSTOM_DIR))
        builtin_dir = os.path.join(DIR, 'Galaxy')
        if os.path.exists(builtin_dir):
            for d in os.listdir(builtin_dir):
                if os.path.isdir(os.path.join(builtin_dir, d)):
                    existing_ids.add(d)
        if galaxy_id in existing_ids or db.system_exists(galaxy_id):
            return {'ok': False, 'error': '星系已存在', 'id': galaxy_id}

        universe = data.get('universe') if isinstance(data.get('universe'), dict) else {}
        universe_id = str(universe.get('galaxyId') or 'milky-way').strip()
        if not db.get_universe_galaxy(universe_id):
            return {'ok': False, 'error': '所属星系不存在'}
        if user['role'] == 'citizen' and not db.is_galaxy_member(universe_id, user['id']):
            return {'ok': False, 'error': '请先加入该星系，再发布星体系统'}

        if as_draft:
            status = 'draft'
        else:
            status = 'approved' if user['role'] in ('developer', 'admin') else 'pending'
        try:
            created = int(time.time() * 1000)
            payload = dict(data)
            payload['name'] = name
            payload['universe'] = {**universe, 'galaxyId': universe_id}
            payload['createdAt'] = created
            payload['updatedAt'] = created
            db.upsert_system(
                galaxy_id, payload, 'custom', created_at=created,
                owner_id=user['id'], universe_galaxy_id=universe_id, status=status,
                submitted_at=created,
            )
            db.ensure_module_stub(galaxy_id, db.get_system(galaxy_id) or payload)
            result = {
                'ok': True, 'id': galaxy_id,
                'status': status,
                'galaxy': db.get_system(galaxy_id),
            }
            if status == 'pending':
                result['message'] = '已提交，等待开发者审核'
            elif status == 'draft':
                result['message'] = '已暂存到草稿箱，可在个人中心发布'
            return result
        except Exception as e:
            return {'ok': False, 'error': str(e)}

    def _update_galaxy(self, data, user):
        as_draft = bool(data.get('draft'))
        galaxy_id = _safe_folder(data.get('id') or '')
        if not galaxy_id:
            return {'ok': False, 'error': '缺少星系 id'}
        existing = db.get_system(galaxy_id, 'custom')
        if not existing:
            return {'ok': False, 'error': '星系不存在'}
        if user['role'] == 'admin':
            return {'ok': False, 'error': '管理员不能修改星体系统'}
        is_dev = user['role'] == 'developer'
        if not is_dev and existing.get('ownerUserId') != user['id']:
            return {'ok': False, 'error': '只能修改自己发布的星体系统'}

        universe = data.get('universe') if isinstance(data.get('universe'), dict) else {}
        universe_id = str(universe.get('galaxyId') or existing.get('universeGalaxyId') or 'milky-way')
        if not db.get_universe_galaxy(universe_id):
            return {'ok': False, 'error': '所属星系不存在'}
        publishing = (not as_draft) and (existing.get('status') or 'approved') == 'draft'
        if (not is_dev and universe_id != existing.get('universeGalaxyId')
                and not db.is_galaxy_member(universe_id, user['id'])):
            return {'ok': False, 'error': '请先加入目标星系'}
        if publishing and not is_dev and not db.is_galaxy_member(universe_id, user['id']):
            return {'ok': False, 'error': '请先加入目标星系，再发布星体系统'}
        try:
            payload = dict(data)
            payload['universe'] = {**universe, 'galaxyId': universe_id}
            if as_draft:
                status = 'draft'
            else:
                status = 'approved' if is_dev else 'pending'
            db.upsert_system(
                galaxy_id, payload, 'custom',
                owner_id=existing.get('ownerUserId') or user['id'],
                universe_galaxy_id=universe_id,
                status=status,
            )
            if as_draft:
                message = '草稿已保存'
            else:
                message = None if is_dev else '修改已保存，重新进入审核'
            return {
                'ok': True, 'id': galaxy_id, 'status': status,
                'galaxy': db.get_system(galaxy_id),
                'message': message,
            }
        except Exception as e:
            return {'ok': False, 'error': str(e)}

    def _delete_galaxy(self, data, user):
        gid = _safe_folder(data.get('id', ''))
        if not gid:
            return {'ok': False, 'error': 'missing id'}
        record = db.get_system(gid, 'custom')
        if not record:
            return {'ok': False, 'error': 'not found'}
        allowed = (
            user['role'] in ('developer', 'admin')
            or record.get('ownerUserId') == user['id']
        )
        if not allowed:
            return {'ok': False, 'error': '没有删除权限'}
        removed = db.delete_system(gid)
        folder = os.path.join(CUSTOM_DIR, gid)
        if os.path.exists(folder):
            try:
                shutil.rmtree(folder)
                removed = True
            except Exception as e:
                return {'ok': False, 'error': str(e)}
        return {'ok': True} if removed else {'ok': False, 'error': 'not found'}

    def _export_galaxies(self, data, user):
        ids = data.get('ids', [])
        if not isinstance(ids, list) or not ids:
            return {'ok': False, 'error': '未选择星系'}
        allowed = []
        for raw in ids[:200]:
            gid = _safe_folder(raw)
            if not gid:
                continue
            rec = db.get_system(gid, 'custom')
            if not rec:
                continue
            if user['role'] not in ('developer', 'admin') and rec.get('ownerUserId') != user['id']:
                continue
            allowed.append(gid)
        if not allowed:
            return {'ok': False, 'error': '没有可导出的星体系统'}
        output_dir = os.path.join(DIR, 'output')
        os.makedirs(output_dir, exist_ok=True)
        zip_name = 'galaxies_export_' + str(int(time.time())) + '.zip'
        zip_path = os.path.join(output_dir, zip_name)
        try:
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
                for gid in allowed:
                    record = db.get_system(gid, 'custom')
                    if not record:
                        continue
                    folder = os.path.join(CUSTOM_DIR, gid)
                    if os.path.isdir(folder):
                        for root, dirs, files in os.walk(folder):
                            for fn in files:
                                if fn == 'data.json':
                                    continue
                                file_path = os.path.join(root, fn)
                                arcname = os.path.relpath(file_path, CUSTOM_DIR)
                                zf.write(file_path, arcname)
                    export_record = {k: v for k, v in record.items() if k != 'kind'}
                    zf.writestr(
                        f'{gid}/data.json',
                        json.dumps(export_record, ensure_ascii=False, indent=2),
                    )
            return {'ok': True, 'filename': zip_name, 'path': zip_path}
        except Exception as e:
            return {'ok': False, 'error': str(e)}

    def _import_galaxy(self, raw_data, user):
        if not raw_data:
            return {'ok': False, 'error': '未收到文件数据'}
        tmp_path = os.path.join(CUSTOM_DIR, '_import_temp.zip')
        extract_dir = os.path.join(CUSTOM_DIR, '_import_temp_' + str(int(time.time() * 1000)))
        try:
            with open(tmp_path, 'wb') as f:
                f.write(raw_data)
            imported = []
            skipped = []
            with zipfile.ZipFile(tmp_path, 'r') as zf:
                os.makedirs(extract_dir, exist_ok=True)
                base_real = os.path.realpath(extract_dir)
                for member in zf.infolist():
                    target = os.path.realpath(os.path.join(extract_dir, member.filename))
                    if target != base_real and not target.startswith(base_real + os.sep):
                        continue  # 阻止 zip slip
                    zf.extract(member, extract_dir)

                for item in os.listdir(extract_dir):
                    src = os.path.join(extract_dir, item)
                    if not os.path.isdir(src) or item.startswith('_'):
                        continue
                    gid = _safe_folder(item)
                    if not gid:
                        skipped.append(item)
                        continue
                    data_file = os.path.join(src, 'data.json')
                    if not os.path.exists(data_file):
                        skipped.append(gid)
                        continue
                    if db.system_exists(gid) or os.path.exists(os.path.join(CUSTOM_DIR, gid)):
                        skipped.append(gid)
                        continue
                    try:
                        with open(data_file, 'r', encoding='utf-8') as df:
                            content = json.load(df)
                    except Exception:
                        content = None
                    if not isinstance(content, dict):
                        skipped.append(gid)
                        continue
                    record = db.normalize_system_record(content, gid)
                    record = db.materialize_images(record, gid, base_dir=extract_dir)
                    os.remove(data_file)
                    universe_id = str(
                        (record.get('universe') or {}).get('galaxyId') or 'milky-way'
                    )
                    db.upsert_system(
                        gid, record, 'custom', owner_id=user['id'],
                        universe_galaxy_id=universe_id,
                        status='approved' if user['role'] in ('developer', 'admin') else 'pending',
                    )
                    dst = os.path.join(CUSTOM_DIR, gid)
                    shutil.move(src, dst)
                    db.ensure_module_stub(gid, record)
                    imported.append(gid)

            shutil.rmtree(extract_dir, ignore_errors=True)
            os.remove(tmp_path)
            return {'ok': True, 'imported': imported, 'skipped': skipped}
        except Exception as e:
            shutil.rmtree(extract_dir, ignore_errors=True)
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            return {'ok': False, 'error': str(e)}

    # ==================== 详情文件 ====================

    def _upload_detail_file(self, data):
        raw_name = os.path.basename(str(data.get('filename', ''))).strip()
        safe_name = re.sub(r'[^\w一-鿿.\-]', '_', raw_name).strip('._') or 'file'
        ext = os.path.splitext(safe_name)[1].lower()
        if ext not in ('.txt', '.png', '.jpg', '.jpeg'):
            return {'ok': False, 'error': '仅支持 .txt / .png / .jpg / .jpeg'}

        stored = f'{int(time.time() * 1000)}_{random.randint(1000, 9999)}_{safe_name}'
        if len(stored) > 140:
            stored = stored[:120] + ext
        path = os.path.join(DETAIL_DIR, stored)

        try:
            if ext == '.txt':
                text = data.get('text', '')
                if not isinstance(text, str):
                    text = str(text)
                db.add_detail_text(stored, text)
            else:
                data_url = str(data.get('dataUrl', ''))
                match = re.match(r'^data:image/[a-zA-Z0-9.+-]+;base64,(.+)$', data_url, re.S)
                if not match:
                    return {'ok': False, 'error': '无效的图片数据'}
                raw = base64.b64decode(match.group(1))
                if len(raw) > 10 * 1024 * 1024:
                    return {'ok': False, 'error': '图片过大（上限 10MB）'}
                os.makedirs(DETAIL_DIR, exist_ok=True)
                with open(path, 'wb') as f:
                    f.write(raw)
                mime = mimetypes.guess_type(stored)[0] or 'image/png'
                db.add_detail_image(stored, f'detail_files/{stored}', mime)
            return {
                'ok': True,
                'filename': stored,
                'url': '/detail_files/' + urllib.parse.quote(stored),
            }
        except Exception as e:
            return {'ok': False, 'error': str(e)}

    # ==================== 星系 / 社区 ====================

    def _save_universe_galaxy(self, data, user):
        gid = _safe_folder(data.get('id'))
        if not gid:
            return {'ok': False, 'error': '缺少星系 id'}
        existing = db.get_universe_galaxy(gid)
        is_dev = user['role'] == 'developer'
        is_admin = user['role'] == 'admin'

        if existing:
            allowed = is_dev or is_admin or existing.get('commanderUserId') == user['id']
            if not allowed:
                return {'ok': False, 'error': '只有该星系指挥官、管理员或开发者可以编辑'}
            commander_id = None
            if is_dev and data.get('commanderUserId'):
                commander_id = data.get('commanderUserId')
        else:
            if user['role'] not in ('developer', 'admin'):
                return {'ok': False, 'error': '只有开发者或管理员可以创建星系'}
            commander_id = data.get('commanderUserId') if is_dev else user['id']
            commander_id = commander_id or user['id']

        payload = dict(data)
        payload['id'] = gid
        if not is_dev:
            payload.pop('commanderUserId', None)
            payload.pop('isDefault', None)
        result = db.save_universe_galaxy(
            payload, commander_id=commander_id, created_by=user['id']
        )
        return result

    def _save_body_relations(self, data, user):
        raw = data.get('relations')
        if not isinstance(raw, list):
            return {'ok': False, 'error': '缺少 relations 列表'}
        try:
            if user['role'] == 'developer':
                return db.replace_body_relations(raw, user)
            if user['role'] == 'admin':
                return {'ok': False, 'error': '管理员不能修改星体关联'}

            owned = {rec['id'] for rec in db.list_owned_systems(user['id'])}
            current = db.list_body_relations()
            proposed = [rec for rec in raw if isinstance(rec, dict)]
            keep = [rec for rec in current if rec.get('fromSystemId') not in owned]
            merged = keep + proposed
            # 只允许以自己拥有的系统为起点的新关联
            filtered = []
            for rec in merged:
                norm = db.normalize_relation(rec)
                if not norm:
                    continue
                if norm['fromSystemId'] in owned or norm in keep:
                    filtered.append(norm)
            return db.replace_body_relations(filtered, user)
        except Exception as e:
            return {'ok': False, 'error': str(e)}

    # ==================== 背景音乐 ====================

    def _read_bgm_index(self):
        files = []
        try:
            with open(MUSIC_INDEX, 'r', encoding='utf-8') as f:
                payload = json.load(f)
            raw = payload.get('files') if isinstance(payload, dict) else payload
            if isinstance(raw, list):
                files = [str(x) for x in raw if _safe_audio_name(x)]
        except Exception:
            files = []
        if not files and os.path.isdir(MUSIC_DIR):
            files = sorted(
                n for n in os.listdir(MUSIC_DIR)
                if os.path.splitext(n)[1].lower() in AUDIO_EXT
            )
        return files

    def _write_bgm_index(self, files):
        with open(MUSIC_INDEX, 'w', encoding='utf-8') as f:
            json.dump({'files': files}, f, ensure_ascii=False, indent=2)

    def _upload_bgm(self, data):
        raw_name = str(data.get('filename') or '')
        name = _safe_audio_name(raw_name)
        if not name:
            return {'ok': False, 'error': '仅支持 mp3 / wav / ogg / flac / m4a'}
        data_url = str(data.get('dataUrl') or '')
        match = re.match(r'^data:audio/[a-zA-Z0-9.+-]+;base64,(.+)$', data_url, re.S)
        if not match:
            return {'ok': False, 'error': '无效的音频数据'}
        try:
            raw = base64.b64decode(match.group(1))
        except Exception:
            return {'ok': False, 'error': '音频解码失败'}
        if len(raw) > MAX_BGM:
            return {'ok': False, 'error': '音频不能超过 25MB'}
        os.makedirs(MUSIC_DIR, exist_ok=True)
        with open(os.path.join(MUSIC_DIR, name), 'wb') as f:
            f.write(raw)
        files = self._read_bgm_index()
        if name not in files:
            files.append(name)
        self._write_bgm_index(files)
        return {'ok': True, 'filename': name, 'files': files}

    def _delete_bgm(self, data):
        name = _safe_audio_name(data.get('filename'))
        if not name:
            return {'ok': False, 'error': '无效的文件名'}
        files = [f for f in self._read_bgm_index() if f != name]
        self._write_bgm_index(files)
        path = os.path.join(MUSIC_DIR, name)
        if os.path.isfile(path):
            try:
                os.remove(path)
            except Exception as e:
                return {'ok': False, 'error': str(e)}
        return {'ok': True, 'files': files}

    # ==================== 详情文件读取 ====================

    def _serve_detail(self, raw_name):
        name = os.path.basename(urllib.parse.unquote(raw_name or ''))
        if not name:
            self.send_error(404)
            return

        record = db.get_detail_file(name)
        body = None
        ctype = 'application/octet-stream'
        if record:
            if record.get('kind') == 'text':
                body = (record.get('content') or '').encode('utf-8')
                ctype = record.get('mime') or 'text/plain; charset=utf-8'
            else:
                rel_path = record.get('rel_path') or f'detail_files/{name}'
                abs_path = os.path.join(DIR, rel_path)
                if os.path.isfile(abs_path):
                    try:
                        with open(abs_path, 'rb') as f:
                            body = f.read()
                        ctype = record.get('mime') or mimetypes.guess_type(name)[0] or ctype
                    except Exception:
                        body = None

        if body is None:
            abs_path = os.path.join(DETAIL_DIR, name)
            if os.path.isfile(abs_path):
                try:
                    with open(abs_path, 'rb') as f:
                        body = f.read()
                    ctype = mimetypes.guess_type(name)[0] or ctype
                except Exception:
                    body = None

        if body is None:
            self.send_error(404)
            return

        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, *a):
        pass


class ThreadedServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    with ThreadedServer(('', 8000), Handler) as httpd:
        httpd.serve_forever()
