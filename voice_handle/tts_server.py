# ============================================================
# tts_server.py — 机械电子音合成 HTTP 服务器
# 启动: python tts_server.py --port 8765
# ============================================================
import sys, os, json, io, wave as _wave, base64
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler

sys.path.insert(0, str(Path(__file__).parent))
from voice import RoboticVoiceSynthesizer, PRESETS, RoboticVoiceConfig

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
