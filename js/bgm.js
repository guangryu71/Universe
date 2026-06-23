// ============================================================
// bgm.js — 背景音乐管理
// 通过 Python 服务器扫描 music/ 文件夹获取音乐列表
// 支持暂停/继续/切歌/删除/上传
// ============================================================

const TTS_SERVER = 'http://127.0.0.1:8765';

export class BGMManager {
    constructor() {
        this.audio = new Audio();
        this.audio.volume = 0.35;
        this.playing = false;
        this.currentName = '';
        this.playlist = [];
        this.currentIdx = -1;
        this.btn = document.getElementById('bgm-control');
        this.popup = document.getElementById('music-popup');
        this.popupBody = document.getElementById('music-popup-body');
        this.popupClose = document.getElementById('music-popup-close');
        this.volumeSlider = document.getElementById('music-volume-slider');
        this.uploadInput = null;
        this._autoPlayTimer = null;

        this._initUploadInput();
        this._bindEvents();
        this._loadMusicList();
    }

    // ========== 上传控件 ==========
    _initUploadInput() {
        this.uploadInput = document.createElement('input');
        this.uploadInput.type = 'file';
        this.uploadInput.accept = '.mp3,.wav,.ogg,.flac,.m4a';
        this.uploadInput.style.display = 'none';
        document.body.appendChild(this.uploadInput);
        this.uploadInput.addEventListener('change', () => {
            const file = this.uploadInput.files[0];
            if (!file) return;
            this._uploadFile(file);
        });
    }

    // ========== 事件 ==========
    _bindEvents() {
        if (!this.btn) return;
        this.btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._openPopup();
        });
        this.popupClose?.addEventListener('click', () => this._closePopup());
        this.popup?.addEventListener('click', (e) => {
            if (e.target === this.popup) this._closePopup();
        });
        if (this.volumeSlider) {
            this.volumeSlider.value = Math.round(this.audio.volume * 100);
            this.volumeSlider.addEventListener('input', () => {
                this.audio.volume = this.volumeSlider.value / 100;
            });
            this.popup?.addEventListener('wheel', (e) => {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -3 : 3;
                let v = Math.round(this.audio.volume * 100) + delta;
                v = Math.max(0, Math.min(100, v));
                this.audio.volume = v / 100;
                this.volumeSlider.value = v;
            }, { passive: false });
        }
        this.audio.addEventListener('ended', () => this._next());
        this.audio.addEventListener('error', () => this._next());
    }

    // ========== 从服务器扫描 music/ 文件夹 ==========
    async _loadMusicList() {
        try {
            const res = await fetch(TTS_SERVER + '/list-music');
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            this.playlist = data.files || [];
            this._updateBtn();

            if (this.playlist.length > 0) {
                this._autoPlayTimer = setTimeout(() => {
                    const idx = Math.floor(Math.random() * this.playlist.length);
                    this._playIndex(idx);
                }, 10000);
            }
        } catch (e) {
            console.warn('[BGM] 无法连接 TTS 服务器获取音乐列表:', e.message);
            this._updateBtn();
        }
    }

    // ========== 播放控制 ==========
    _playIndex(idx) {
        if (idx < 0 || idx >= this.playlist.length) return;
        const name = this.playlist[idx];
        this.audio.src = 'music/' + encodeURIComponent(name);
        this.audio.play().then(() => {
            this.playing = true;
            this.currentIdx = idx;
            this.currentName = name;
            this._updateBtn();
            this._renderTracks();
        }).catch(() => {});
    }

    _togglePlay() {
        if (this.playing) {
            this.audio.pause();
            this.playing = false;
        } else {
            this.audio.play().then(() => { this.playing = true; }).catch(() => {});
        }
        this._updateBtn();
        this._renderTracks();
    }

    _next() {
        if (this.playlist.length === 0) return;
        const next = (this.currentIdx + 1) % this.playlist.length;
        this._playIndex(next);
    }

    _updateBtn() {
        if (!this.btn) return;
        if (this.playlist.length === 0) {
            this.btn.textContent = '🚫'; this.btn.title = '无音乐';
        } else if (this.playing) {
            this.btn.textContent = '🔊'; this.btn.title = '播放中：' + this.currentName;
        } else {
            this.btn.textContent = '🎵'; this.btn.title = this.playlist.length + ' 首';
        }
    }

    // ========== 弹窗 ==========
    _openPopup() { this._renderTracks(); this.popup.classList.remove('hidden'); }
    _closePopup() { this.popup.classList.add('hidden'); }

    _renderTracks() {
        if (!this.popupBody) return;
        if (this.playlist.length === 0) {
            this.popupBody.innerHTML = '<div style="color:#667;font-size:12px;text-align:center;padding:20px;">🎶 暂无音乐<br><br>点击下方「上传音乐」添加</div>';
            return;
        }
        this.popupBody.innerHTML = this.playlist.map((f, i) => {
            const isActive = i === this.currentIdx;
            const icon = isActive ? (this.playing ? '🔊' : '⏸') : '🎵';
            const cls = isActive ? 'music-track active' : 'music-track';
            return `
                <div class="music-track ${cls}">
                    <span class="music-track-play" data-idx="${i}">${icon}</span>
                    <span class="music-track-name" data-idx="${i}" title="${f}">${f}</span>
                    <button class="music-track-pause" data-idx="${i}">${isActive && this.playing ? '⏸' : '▶'}</button>
                    <button class="music-track-del" data-idx="${i}" title="删除">🗑</button>
                </div>`;
        }).join('');

        this.popupBody.querySelectorAll('.music-track-name').forEach(el => {
            el.addEventListener('click', () => {
                const idx = parseInt(el.dataset.idx);
                if (idx !== this.currentIdx) this._playIndex(idx);
            });
        });
        this.popupBody.querySelectorAll('.music-track-pause').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(el.dataset.idx);
                if (idx === this.currentIdx) this._togglePlay();
                else this._playIndex(idx);
            });
        });
        this.popupBody.querySelectorAll('.music-track-del').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this._deleteTrack(parseInt(el.dataset.idx));
            });
        });
    }

    // ========== 上传 ==========
    async _uploadFile(file) {
        const formData = new FormData();
        formData.append('file', file);
        try {
            const res = await fetch(TTS_SERVER + '/upload-music', { method: 'POST', body: formData });
            if (res.ok) {
                const data = await res.json();
                if (data.ok && !this.playlist.includes(data.name)) {
                    this.playlist.push(data.name);
                    this._renderTracks();
                    if (this.currentIdx < 0) this._playIndex(this.playlist.length - 1);
                    this._updateBtn();
                }
            }
        } catch (e) {
            alert('上传失败：TTS 服务器未启动 (127.0.0.1:8765)');
        }
    }

    triggerUpload() { this.uploadInput.click(); }

    // ========== 删除 ==========
    async _deleteTrack(idx) {
        if (idx < 0 || idx >= this.playlist.length) return;
        const name = this.playlist[idx];
        const wasCurrent = idx === this.currentIdx;

        try {
            await fetch(TTS_SERVER + '/delete-music', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
        } catch (e) {
            console.warn('[BGM] 删除文件失败:', e.message);
        }

        this.playlist.splice(idx, 1);
        if (wasCurrent) {
            this.audio.pause();
            this.playing = false;
            this.currentIdx = -1;
            this.currentName = '';
            this.audio.src = '';
            if (this.playlist.length > 0) {
                const next = Math.min(idx, this.playlist.length - 1);
                this._playIndex(next);
            }
        } else if (idx < this.currentIdx) {
            this.currentIdx--;
        }
        this._renderTracks();
        this._updateBtn();
    }
}
