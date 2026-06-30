"""
Universe 一键启动器（含星系持久化 API）
    python start.py

Ctrl+C → 全部退出
"""

import os, sys, time, subprocess

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))

def kill_port(port):
    try:
        out = os.popen(f'netstat -ano | findstr :{port}').read()
        for line in out.strip().split('\n'):
            parts = line.strip().split()
            if parts and parts[-1].isdigit():
                os.system(f'taskkill /F /PID {parts[-1]} >nul 2>&1')
    except Exception:
        pass

def main():
    os.chdir(PROJECT_DIR)

    venv_python = os.path.join(PROJECT_DIR, '.venv', 'Scripts', 'python.exe')
    python_exe = venv_python if os.path.exists(venv_python) else sys.executable

    print('[init] 清理旧端口…')
    kill_port(8000)
    time.sleep(0.8)

    # 启动 HTTP 服务器（使用独立文件避免 f-string 冲突）
    server_script = os.path.join(PROJECT_DIR, 'server.py')
    if not os.path.exists(server_script):
        print('[init] 生成 server.py…')
        _write_server_py(server_script)

    print('[start] HTTP :8000 (含星系持久化 API)')
    http = subprocess.Popen(
        [python_exe, '-u', server_script],
        cwd=PROJECT_DIR,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )

    print()
    print('=' * 50)
    print('  Universe 就绪')
    print('  HTTP : http://127.0.0.1:8000')
    print('  星系: 持久化存储到 Galaxy/custom/')
    print('  Ctrl+C 全部退出')
    print('=' * 50)
    print()

    def cleanup():
        print('\n[exit] 正在关闭…')
        try:
            http.terminate()
            http.wait(timeout=3)
        except Exception:
            pass
        print('[exit] 再见')

    try:
        http.wait()
    except KeyboardInterrupt:
        cleanup()
    except Exception:
        cleanup()


def _write_server_py(path):
    """生成独立的 HTTP 服务器脚本"""
    with open(path, 'w', encoding='utf-8') as f:
        f.write(r'''import os, sys, json, http.server, socketserver, shutil, urllib.parse, io, time

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
        body = self.rfile.read(length).decode('utf-8') if length else '{}'
        data = json.loads(body) if body else {}

        if self.path == '/api/list-galaxies':
            self._json({'galaxies': self._scan_custom()})
        elif self.path == '/api/create-galaxy':
            result = self._create_galaxy(data)
            self._json(result)
        elif self.path == '/api/delete-galaxy':
            result = self._delete_galaxy(data)
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
        folder = os.path.join(CUSTOM_DIR, galaxy_id)
        if os.path.exists(folder):
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
''')

if __name__ == '__main__':
    main()
