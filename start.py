"""
Universe 一键启动器
    python start.py

Ctrl+C  →  服务器退出
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

    # ----- venv -----
    venv_python = os.path.join(PROJECT_DIR, '.venv', 'Scripts', 'python.exe')
    python_exe = venv_python if os.path.exists(venv_python) else sys.executable

    # ----- kill stale -----
    print('[init] 清理旧端口…')
    for port in [8000, 8765]:
        kill_port(port)
    time.sleep(0.8)

    # ----- start HTTP -----
    print('[start] HTTP :8000')
    http_cmd = [python_exe, '-m', 'http.server', '8000']
    http = subprocess.Popen(http_cmd, cwd=PROJECT_DIR,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # ----- start TTS -----
    print('[start] TTS :8765')
    tts_cmd = [python_exe, 'voice_handle/tts_server.py', '--port', '8765']
    tts = subprocess.Popen(tts_cmd, cwd=PROJECT_DIR,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    print()
    print('=' * 50)
    print('  Universe 就绪')
    print('  HTTP : http://127.0.0.1:8000')
    print('  TTS  : http://127.0.0.1:8765')
    print('  Ctrl+C 全部退出')
    print('=' * 50)
    print()

    def cleanup():
        print('\n[exit] 正在关闭…')
        for proc in [http, tts]:
            try:
                proc.terminate()
                proc.wait(timeout=3)
            except Exception:
                pass
        print('[exit] 再见')

    try:
        http.wait()
    except KeyboardInterrupt:
        cleanup()
    except Exception:
        cleanup()


if __name__ == '__main__':
    main()
