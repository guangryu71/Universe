# ============================================================
# tts_server.py — 机械电子音合成 HTTP 服务器
# 启动: python tts_server.py --port 8765
# ============================================================
import sys, os, json, io, wave as _wave, base64, shutil
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler

sys.path.insert(0, str(Path(__file__).parent))
from voice import RoboticVoiceSynthesizer, PRESETS, RoboticVoiceConfig

# ---- Galaxy 模块路径 ----
GALAXY_DIR = Path(__file__).parent.parent / 'Galaxy'

SYNTH = RoboticVoiceSynthesizer()

class TTSHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[TTS] {args[0]}" if args else fmt)

    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_wav(self, filepath):
        try:
            with open(filepath, 'rb') as f:
                data = f.read()
            self.send_response(200)
            self.send_header('Content-Type', 'audio/wav')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except FileNotFoundError:
            self._send_json({'error': 'file not found'}, 404)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        if self.path == '/presets':
            data = {}
            for name, cfg in PRESETS.items():
                data[name] = {
                    'ring_mod_freq': cfg.ring_mod_freq,
                    'ring_mod_mix': cfg.ring_mod_mix,
                    'bit_depth': cfg.bit_depth,
                    'sample_rate_reduction': cfg.sample_rate_reduction,
                    'bandpass_low': cfg.bandpass_low,
                    'bandpass_high': cfg.bandpass_high,
                    'distortion_gain': cfg.distortion_gain,
                    'vibrato_rate': cfg.vibrato_rate,
                    'vibrato_depth': cfg.vibrato_depth,
                    'echo_delay': cfg.echo_delay,
                    'echo_decay': cfg.echo_decay,
                    'pitch_semitones': cfg.pitch_semitones,
                }
            self._send_json({'presets': data, 'default': 'ai_assistant'})
        elif self.path == '/health':
            self._send_json({'status': 'ok', 'presets': list(PRESETS.keys())})
        elif self.path == '/list-music':
            music_dir = Path(__file__).parent.parent / 'music'
            music_dir.mkdir(exist_ok=True)
            files = []
            for f in sorted(music_dir.iterdir()):
                if f.is_file() and f.suffix.lower() in ('.mp3', '.wav', '.ogg', '.flac', '.m4a', '.webm'):
                    files.append(f.name)
            self._send_json({'files': files})
        elif self.path == '/list-galaxies':
            """扫描 Galaxy/ 目录，列出所有包含 index.js 的星系模块"""
            galaxies = []
            if GALAXY_DIR.exists():
                for sub in sorted(GALAXY_DIR.iterdir()):
                    if sub.is_dir() and (sub / 'index.js').exists():
                        # 尝试读取 index.js 第一行的 SYSTEM_INFO（简单启发式）
                        # 返回基本目录信息，详细数据由前端动态 import 获取
                        galaxies.append({
                            'id': sub.name,
                            'path': str(sub.relative_to(GALAXY_DIR.parent)),
                            'modulePath': f'Galaxy/{sub.name}/index.js',
                        })
            self._send_json({'galaxies': galaxies})
        else:
            self._send_json({'error': 'not found'}, 404)

    def do_POST(self):
        if self.path == '/synthesize':
            content_len = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(content_len).decode('utf-8'))
            text = body.get('text', '')
            preset = body.get('preset', 'ai_assistant')
            custom_params = body.get('params', None)

            output = str(Path(__file__).parent / 'robotic_voice_output.wav')

            try:
                if preset == 'custom' and custom_params:
                    cfg = RoboticVoiceConfig(**custom_params)
                    SYNTH.synthesize(text, output_path=output, config=cfg, verbose=False)
                elif preset in PRESETS:
                    SYNTH.synthesize(text, output_path=output, preset=preset, verbose=False)
                else:
                    SYNTH.synthesize(text, output_path=output, preset='ai_assistant', verbose=False)
                self._send_wav(output)
            except Exception as e:
                print(f"[TTS] 合成失败: {e}")
                self._send_json({'error': str(e)}, 500)
        elif self.path == '/upload-music':
            content_type = self.headers.get('Content-Type', '')
            if 'multipart/form-data' not in content_type:
                length = int(self.headers.get('Content-Length', 0))
                import cgi, io as _io
                raw_data = self.rfile.read(length)
                # 简单处理: 直接在 body 中找文件名
                try:
                    body = json.loads(raw_data.decode('utf-8'))
                    fname = body.get('name', '')
                except:
                    fname = ''
                self._send_json({'ok': False, 'error': 'use multipart'})
                return

            # 解析 multipart
            content_type_full = self.headers.get('Content-Type', '')
            import cgi
            from io import BytesIO
            length = int(self.headers.get('Content-Length', 0))
            raw_data = self.rfile.read(length)

            # 简单文件提取
            music_dir = Path(__file__).parent.parent / 'music'
            music_dir.mkdir(exist_ok=True)

            field_name = 'file'
            try:
                import email.parser
                # 手动解析 multipart
                idx = raw_data.find(b'\r\n\r\n')
                if idx < 0:
                    self._send_json({'ok': False, 'error': 'bad multipart'})
                    return

                # 从 header 提取文件名
                header = raw_data[:idx].decode('utf-8', errors='replace')
                fname = None
                for line in header.split('\r\n'):
                    if 'filename=' in line:
                        fname = line.split('filename=')[1].strip('"\'')
                        break

                if not fname:
                    self._send_json({'ok': False, 'error': 'no filename'})
                    return

                # 提取文件内容
                start = idx + 4
                end = raw_data.rfind(b'\r\n--')
                if end < 0:
                    end = len(raw_data)
                file_data = raw_data[start:end]

                # 去掉尾部 boundary
                boundary_end = file_data.rfind(b'\r\n-')
                if boundary_end > 0:
                    file_data = file_data[:boundary_end]

                dest = music_dir / fname
                with open(dest, 'wb') as f:
                    f.write(file_data)

                self._send_json({'ok': True, 'name': fname})
            except Exception as e:
                self._send_json({'ok': False, 'error': str(e)})
        elif self.path == '/delete-music':
            content_len = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(content_len).decode('utf-8'))
            fname = body.get('name', '')
            if not fname:
                self._send_json({'ok': False, 'error': 'no name'})
                return
            music_dir = Path(__file__).parent.parent / 'music'
            fpath = music_dir / fname
            if fpath.exists() and fpath.is_file():
                fpath.unlink()
                self._send_json({'ok': True})
            else:
                self._send_json({'ok': False, 'error': 'not found'})
        elif self.path == '/create-galaxy':
            """创建新的星系文件夹模块"""
            content_len = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(content_len).decode('utf-8'))
            try:
                name = body.get('name', '').strip()
                if not name:
                    self._send_json({'ok': False, 'error': 'name required'})
                    return

                # 生成文件夹 ID（字母数字 + 连字符）
                import re
                folder_id = re.sub(r'[^a-zA-Z0-9一-鿿\-]', '', name)
                folder_id = re.sub(r'[一-鿿]', '', folder_id).lower()[:30] or 'galaxy'
                # 确保唯一
                base_id = folder_id
                counter = 1
                while (GALAXY_DIR / folder_id).exists():
                    folder_id = f'{base_id}-{counter}'
                    counter += 1

                galaxy_path = GALAXY_DIR / folder_id
                galaxy_path.mkdir(parents=True, exist_ok=True)

                import json as _json
                star = body.get('star', {})
                planets = body.get('planets', [])
                description = body.get('description', f'{name} 恒星系统')
                sys_id = folder_id

                def _js_str(s):
                    """安全地将字符串转为 JS 单引号字符串字面量"""
                    return _json.dumps(str(s), ensure_ascii=False).replace('"', "'")

                star_color = star.get('color', '#ffcc00')
                star_name = star.get('name', name + ' 主星')
                star_mass = float(star.get('mass', 1.989e30))
                star_radius = float(star.get('radius', 6.9634e8))
                star_visual = float(star.get('visualRadius', 4.0))
                pos_x = float(star.get('x', 50))
                pos_y = float(star.get('y', 0))
                pos_z = float(star.get('z', 0))

                AU_VAL = 1.495978707e11
                class_name_star = f'{sys_id}_star_class'

                # ---- 1) 生成恒星独立文件 ----
                star_lines = [
                    f'// ============================================================',
                    f'// {class_name_star}.js — {star_name}（{name}的中心恒星）',
                    f'// ============================================================',
                    f'',
                    f'import {{ CelestialBody }} from \'../../js/CelestialBody.js\';',
                    f'',
                    f'export class {class_name_star} extends CelestialBody {{',
                    f'',
                    f'    static KEY           = \'{sys_id}_star\';',
                    f'    static NAME          = {_js_str(star_name)};',
                    f'    static NAME_CN       = {_js_str(star_name)};',
                    f'    static MASS          = {star_mass};',
                    f'    static RADIUS        = {star_radius};',
                    f'    static ORBIT_RADIUS  = 0;',
                    f'    static VISUAL_RADIUS = {star_visual};',
                    f'    static COLOR         = 0x{star_color.lstrip("#")[:6]};',
                    f'    static TEXTURE       = None;',
                    f'',
                    f'    static DETAILS = {_js_str(f"{name}的中心恒星。\\n质量：{star_mass:.2e} kg\\n半径：{star_radius:.2e} m")};',
                    f'    static VOICE_INTRO = {_js_str(f"{name}，一颗新发现的恒星系统。")};',
                    f'',
                    f'    constructor(scene) {{',
                    f'        super({{',
                    f'            key: {class_name_star}.KEY,',
                    f'            name: {class_name_star}.NAME,',
                    f'            nameCN: {class_name_star}.NAME_CN,',
                    f'            mass: {class_name_star}.MASS,',
                    f'            radius: {class_name_star}.RADIUS,',
                    f'            orbitRadius: {class_name_star}.ORBIT_RADIUS,',
                    f'            visualRadius: {class_name_star}.VISUAL_RADIUS,',
                    f'            color: {class_name_star}.COLOR,',
                    f'            texturePath: {class_name_star}.TEXTURE,',
                    f'            details: {class_name_star}.DETAILS,',
                    f'            voiceIntro: {class_name_star}.VOICE_INTRO,',
                    f'            rotationSpeed: 0.15,',
                    f'            scene,',
                    f'        }});',
                    f'        this.position.set(0, 0, 0);',
                    f'    }}',
                    f'}}',
                ]
                star_js = '\n'.join(star_lines) + '\n'
                star_file = galaxy_path / f'{class_name_star}.js'
                with open(star_file, 'w', encoding='utf-8') as f:
                    f.write(star_js)

                # ---- 2) 生成各行星独立文件（格式与恒星一致） ----
                planet_class_names = []
                for i, p in enumerate(planets):
                    p_color = p.get('color', '#4488ff')
                    p_mass = float(p.get('mass', 5.97e24))
                    p_radius = float(p.get('radius', 6371000))
                    p_orbit = float(p.get('orbitRadius', (i + 1) * AU_VAL))
                    p_visual = float(p.get('visualRadius', 0.5))
                    p_name = p.get('name', f'行星{i+1}')
                    cls_name = f'{sys_id}_planet_{i}_class'
                    planet_class_names.append(cls_name)
                    p_key = f'{sys_id}_planet_{i}'

                    tex_path_str = 'None'
                    tex_data = p.get('textureData')
                    tex_name = p.get('textureName')
                    if tex_data and tex_name:
                        tex_dir = galaxy_path / 'planets' / '2k'
                        tex_dir.mkdir(parents=True, exist_ok=True)
                        tex_dest = tex_dir / tex_name
                        import base64 as _b64
                        try:
                            raw = _b64.b64decode(tex_data)
                            with open(tex_dest, 'wb') as tf:
                                tf.write(raw)
                            tex_path_str = f'\'Galaxy/{folder_id}/planets/2k/{tex_name}\''
                        except Exception:
                            tex_path_str = 'None'

                    planet_lines = [
                        f'// ============================================================',
                        f'// {cls_name}.js — {p_name}（{name}的行星）',
                        f'// ============================================================',
                        f'',
                        f'import {{ CelestialBody }} from \'../../js/CelestialBody.js\';',
                        f'',
                        f'export class {cls_name} extends CelestialBody {{',
                        f'',
                        f'    static KEY           = \'{p_key}\';',
                        f'    static NAME          = {_js_str(p_name)};',
                        f'    static NAME_CN       = {_js_str(p_name)};',
                        f'    static MASS          = {p_mass};',
                        f'    static RADIUS        = {p_radius};',
                        f'    static ORBIT_RADIUS  = {p_orbit};',
                        f'    static VISUAL_RADIUS = {p_visual};',
                        f'    static COLOR         = 0x{p_color.lstrip("#")[:6]};',
                        f'    static TEXTURE       = {tex_path_str};',
                        f'',
                        f'    static DETAILS = {_js_str(f"{p_name} — {name}的行星。")};',
                        f'    static VOICE_INTRO = {_js_str(f"{p_name}，{name}的一颗行星。")};',
                        f'',
                        f'    constructor(scene) {{',
                        f'        super({{',
                        f'            key: {cls_name}.KEY,',
                        f'            name: {cls_name}.NAME,',
                        f'            nameCN: {cls_name}.NAME_CN,',
                        f'            mass: {cls_name}.MASS,',
                        f'            radius: {cls_name}.RADIUS,',
                        f'            orbitRadius: {cls_name}.ORBIT_RADIUS,',
                        f'            visualRadius: {cls_name}.VISUAL_RADIUS,',
                        f'            color: {cls_name}.COLOR,',
                        f'            texturePath: {cls_name}.TEXTURE,',
                        f'            details: {cls_name}.DETAILS,',
                        f'            voiceIntro: {cls_name}.VOICE_INTRO,',
                        f'            rotationSpeed: 1.0,',
                        f'            scene,',
                        f'        }});',
                        f'        this.position.set({cls_name}.ORBIT_RADIUS, 0, 0);',
                        f'    }}',
                        f'}}',
                    ]
                    planet_js = '\n'.join(planet_lines) + '\n'
                    with open(galaxy_path / f'{cls_name}.js', 'w', encoding='utf-8') as f:
                        f.write(planet_js)

                # ---- 3) 生成 index.js（标准化模块格式） ----
                all_class_names = [class_name_star] + planet_class_names
                import_lines = [f'import {{ {cn} }} from \'./{cn}.js\';' for cn in all_class_names]
                class_list = ', '.join(all_class_names)

                idx_lines = [
                    f'// ============================================================',
                    f'// Galaxy/{folder_id}/index.js — {name}',
                    f'// 由星语系统在前端创建（标准化格式）',
                    f'// ============================================================',
                    f'',
                ] + import_lines + [
                    f'',
                    f'const AU = {AU_VAL};',
                    f'',
                    f'export const SYSTEM_INFO = {{',
                    f'    id: {_js_str(sys_id)},',
                    f'    name: {_js_str(name)},',
                    f'    nameCN: {_js_str(body.get("nameCN", name))},',
                    f'    description: {_js_str(description)},',
                    f'    icon: \'🌟\',',
                    f'}};',
                    f'',
                    f'export const PLANET_CLASSES = [{class_list}];',
                    f'',
                    f'export const SYSTEM_POS = {{ x: {pos_x} * AU, y: {pos_y} * AU, z: {pos_z} * AU }};',
                    f'',
                    f'function _classToInfo(cls) {{',
                    f'    return {{',
                    f'        KEY: cls.KEY, NAME: cls.NAME, NAME_CN: cls.NAME_CN,',
                    f'        MASS: cls.MASS, RADIUS: cls.RADIUS, ORBIT_RADIUS: cls.ORBIT_RADIUS,',
                    f'        VISUAL_RADIUS: cls.VISUAL_RADIUS, COLOR: cls.COLOR,',
                    f'        TEX_PATH: cls.TEXTURE || null,',
                    f'        DETAILS: cls.DETAILS || \'\',',
                    f'        VOICE_INTRO: cls.VOICE_INTRO || \'\',',
                    f'        IS_STAR: cls.KEY === \'{sys_id}_star\',',
                    f'    }};',
                    f'}}',
                    f'',
                    f'export const PLANET_DATA = PLANET_CLASSES.map(_classToInfo);',
                    f'',
                    f'export function createPlanets(scene, existingPlanets = {{}}) {{',
                    f'    const bodies = {{}};',
                    f'    for (const Cls of PLANET_CLASSES) {{',
                    f'        const key = Cls.KEY;',
                    f'        if (existingPlanets[key]) continue;',
                    f'        const body = new Cls(scene);',
                    f'        body.position.x += SYSTEM_POS.x;',
                    f'        body.position.y += SYSTEM_POS.y;',
                    f'        body.position.z += SYSTEM_POS.z;',
                    f'        body._syncMeshPosition();',
                    f'        bodies[key] = body;',
                    f'    }}',
                    f'    const star = bodies[\'{sys_id}_star\'];',
                    f'    if (star) {{',
                    f'        for (const key of Object.keys(bodies)) {{',
                    f'            if (key === \'{sys_id}_star\') continue;',
                    f'            bodies[key].setCircularOrbitVelocity(star.mass);',
                    f'        }}',
                    f'    }}',
                    f'    return bodies;',
                    f'}}',
                ]
                idx_js = '\n'.join(idx_lines) + '\n'
                with open(galaxy_path / 'index.js', 'w', encoding='utf-8') as f:
                    f.write(idx_js)

                print(f'[Galaxy] 创建星系模块: {folder_id} ({name})')
                self._send_json({'ok': True, 'id': folder_id, 'name': name, 'path': f'Galaxy/{folder_id}/index.js'})
            except Exception as e:
                print(f'[Galaxy] 创建失败: {e}')
                self._send_json({'ok': False, 'error': str(e)})

        elif self.path == '/delete-galaxy':
            """删除星系文件夹模块"""
            content_len = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(content_len).decode('utf-8'))
            galaxy_id = body.get('id', '')
            if not galaxy_id:
                self._send_json({'ok': False, 'error': 'id required'})
                return
            galaxy_path = GALAXY_DIR / galaxy_id
            if galaxy_path.exists() and galaxy_path.is_dir():
                # 内置星系不允许删除
                built_in = ['solar-system', 'hd-219134']
                if galaxy_id in built_in:
                    self._send_json({'ok': False, 'error': 'cannot delete built-in galaxy'})
                    return
                shutil.rmtree(galaxy_path)
                print(f'[Galaxy] 删除星系: {galaxy_id}')
                self._send_json({'ok': True})
            else:
                self._send_json({'ok': False, 'error': 'not found'})
        else:
            self._send_json({'error': 'not found'}, 404)


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--host', default='127.0.0.1')
    args = parser.parse_args()

    server = HTTPServer((args.host, args.port), TTSHandler)
    print(f'[TTS Server] 机械电子音合成服务 :{args.port}')
    print(f'  端点: POST /synthesize  GET /presets  GET /health')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('[TTS] 关闭')
        server.shutdown()


if __name__ == '__main__':
    main()
