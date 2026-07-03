import os, re, sys, json, http.server, socketserver, shutil, urllib.parse, io, time, zipfile

DIR = os.path.dirname(os.path.abspath(__file__))
CUSTOM_DIR = os.path.join(DIR, 'Galaxy', 'custom')
os.chdir(DIR)
os.makedirs(CUSTOM_DIR, exist_ok=True)

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/':
            self.path = '/index_font/heidong.html'
        return super().do_GET()

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        raw = self.rfile.read(length) if length else b''

        if self.path == '/api/import-galaxy':
            # 导入是二进制 zip 数据，不按 JSON 解析
            result = self._import_galaxy(raw)
            self._json(result)
            return

        # 其余接口按 JSON 解析
        body = raw.decode('utf-8') if raw else '{}'
        data = json.loads(body) if body else {}

        if self.path == '/api/list-galaxies':
            self._json({'galaxies': self._scan_custom()})
        elif self.path == '/api/create-galaxy':
            result = self._create_galaxy(data)
            self._json(result)
        elif self.path == '/api/delete-galaxy':
            result = self._delete_galaxy(data)
            self._json(result)
        elif self.path == '/api/export-galaxies':
            result = self._export_galaxies(data)
            self._json(result)
        else:
            self._json({'ok': False, 'error': 'unknown endpoint'}, 404)

    def _scan_custom(self):
        galaxies = []
        if not os.path.exists(CUSTOM_DIR):
            return galaxies
        for name in sorted(os.listdir(CUSTOM_DIR)):
            folder = os.path.join(CUSTOM_DIR, name)
            data_file = os.path.join(folder, 'data.json')
            if os.path.isdir(folder) and os.path.exists(data_file):
                try:
                    with open(data_file, 'r', encoding='utf-8') as gf:
                        g = json.load(gf)
                        g['id'] = name
                        galaxies.append(g)
                except Exception:
                    pass
        return galaxies

    def _create_galaxy(self, data):
        name = data.get('name', '新星系')
        galaxy_id = data.get('id') or 'galaxy_' + str(int(time.time() * 1000))
        # 确保文件夹名不含非法字符
        galaxy_id = re.sub(r'[<>:"/\\|?*]+', '_', galaxy_id)
        folder = os.path.join(CUSTOM_DIR, galaxy_id)
        # 检查 Galaxy/ 和 Galaxy/custom/ 下是否已存在同名文件夹
        existing_ids = set()
        if os.path.exists(CUSTOM_DIR):
            existing_ids.update(os.listdir(CUSTOM_DIR))
        builtin_dir = os.path.join(DIR, 'Galaxy')
        if os.path.exists(builtin_dir):
            for d in os.listdir(builtin_dir):
                if os.path.isdir(os.path.join(builtin_dir, d)):
                    existing_ids.add(d)
        if galaxy_id in existing_ids:
            return {'ok': False, 'error': '星系已存在', 'id': galaxy_id}
        try:
            os.makedirs(folder, exist_ok=True)
            galaxy_data = {
                'name': name,
                'nameCN': data.get('nameCN', ''),
                'description': data.get('description', ''),
                'icon': data.get('icon', 'star'),
                'star': data.get('star', {}),
                'planets': data.get('planets', []),
                'createdAt': int(time.time() * 1000),
            }
            with open(os.path.join(folder, 'data.json'), 'w', encoding='utf-8') as gf:
                json.dump(galaxy_data, gf, ensure_ascii=False, indent=2)
            self._create_module_file(folder, galaxy_id, galaxy_data)
            return {'ok': True, 'id': galaxy_id}
        except Exception as e:
            return {'ok': False, 'error': str(e)}

    def _delete_galaxy(self, data):
        gid = data.get('id', '')
        folder = os.path.join(CUSTOM_DIR, gid)
        if not os.path.exists(folder):
            return {'ok': False, 'error': 'not found'}
        try:
            shutil.rmtree(folder)
            return {'ok': True}
        except Exception as e:
            return {'ok': False, 'error': str(e)}

    def _export_galaxies(self, data):
        ids = data.get('ids', [])
        if not ids:
            return {'ok': False, 'error': '未选择星系'}
        output_dir = os.path.join(DIR, 'output')
        os.makedirs(output_dir, exist_ok=True)
        zip_name = 'galaxies_export_' + str(int(time.time())) + '.zip'
        zip_path = os.path.join(output_dir, zip_name)
        try:
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
                for gid in ids:
                    folder = os.path.join(CUSTOM_DIR, gid)
                    if not os.path.isdir(folder):
                        continue
                    for root, dirs, files in os.walk(folder):
                        for fn in files:
                            file_path = os.path.join(root, fn)
                            arcname = os.path.relpath(file_path, CUSTOM_DIR)
                            zf.write(file_path, arcname)
            return {'ok': True, 'filename': zip_name, 'path': zip_path}
        except Exception as e:
            return {'ok': False, 'error': str(e)}

    def _import_galaxy(self, raw_data):
        raw = raw_data
        if not raw:
            return {'ok': False, 'error': '未收到文件数据'}
        tmp_path = os.path.join(CUSTOM_DIR, '_import_temp.zip')
        try:
            with open(tmp_path, 'wb') as f:
                f.write(raw)
            imported = []
            with zipfile.ZipFile(tmp_path, 'r') as zf:
                # 先解压到临时目录
                extract_dir = os.path.join(CUSTOM_DIR, '_import_temp')
                os.makedirs(extract_dir, exist_ok=True)
                zf.extractall(extract_dir)
                # 遍历提取的文件夹，移动到 Galaxy/custom/
                for item in os.listdir(extract_dir):
                    src = os.path.join(extract_dir, item)
                    dst = os.path.join(CUSTOM_DIR, item)
                    if os.path.isdir(src) and not os.path.exists(dst):
                        shutil.move(src, dst)
                        imported.append(item)
                shutil.rmtree(extract_dir, ignore_errors=True)
            os.remove(tmp_path)
            return {'ok': True, 'imported': imported}
        except Exception as e:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            return {'ok': False, 'error': str(e)}

    def _create_module_file(self, folder, gid, gdata):
        lines = []
        lines.append('// Auto-generated galaxy module - ' + gdata.get('name', 'unknown'))
        lines.append('export const SYSTEM_INFO = { id: ' + json.dumps(gid) + ', name: ' + json.dumps(gdata.get('name','')) + ' };')
        lines.append('export const MOON_CLASSES = {};')
        lines.append('export function createPlanets(scene, ep) { return {}; }')
        lines.append('export const PLANET_DATA = ' + json.dumps(gdata, ensure_ascii=False, indent=2) + ';')
        with open(os.path.join(folder, 'index.js'), 'w', encoding='utf-8') as mf:
            mf.write('\n'.join(lines))

    def _json(self, obj, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(obj).encode('utf-8'))

    def log_message(self, *a): pass

with socketserver.TCPServer(("", 8000), Handler) as httpd:
    httpd.serve_forever()
