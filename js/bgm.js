// ============================================================
// bgm.js — 背景音乐管理（纯客户端版）
// 音乐文件通过上传按钮加载，播放列表存储在内存中
// ============================================================

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
        // 主界面不再有音乐入口，播放器由「网站管理 → 背景音乐」打开；
        // 因此按钮缺失时仍要绑定弹窗与音频事件。
        this.btn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openPopup();
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

    // ========== 加载音乐列表（扫描 music/ 目录） ==========
    async _loadMusicList(autoPlay = true) {
        // 从 music/index.json 加载文件列表
        try {
            const res = await fetch('music/index.json?' + Date.now());
            if (res.ok) {
                const data = await res.json();
                if (data.files && data.files.length > 0) {
                    this.playlist = data.files;
                    this._renderTracks();
                    this._updateBtn();
                    // 自动播放第一首
                    if (autoPlay && this.playlist.length > 0) {
                        setTimeout(() => this._playIndex(0), 3000);
                    }
                    return;
                }
            }
        } catch (e) {
            console.warn('[BGM] 无法加载音乐列表:', e.message);
        }
        // 回退：从 localStorage 恢复
        try {
            const saved = localStorage.getItem('bgm_playlist');
            if (saved) {
                this.playlist = JSON.parse(saved);
                if (this.playlist.length > 0) {
                    this._renderTracks();
                    this._updateBtn();
                }
            }
        } catch (e) {}
        this._updateBtn();
    }

    // ========== 播放控制 ==========
    _playIndex(idx) {
        if (idx < 0 || idx >= this.playlist.length) return;
        const name = this.playlist[idx];
        // 优先使用 localStorage 中的数据，其次尝试 music/ 目录
        const stored = localStorage.getItem('bgm_' + name);
        if (stored) {
            this.audio.src = stored;
        } else {
            this.audio.src = 'music/' + encodeURIComponent(name);
        }
        this.audio.play().then(() => {
            this.playing = true;
            this.currentIdx = idx;
            this.currentName = name;
            this._updateBtn();
            this._renderTracks();
        }).catch((err) => {
            this.playing = false;
            // 自动播放被浏览器拦截时保留曲目，等待用户主动点击播放
            if (err && err.name === 'NotAllowedError') {
                this._updateBtn();
                return;
            }
            // 文件不存在 / 解码失败才从列表中移除
            this.playlist.splice(idx, 1);
            this._renderTracks();
            this._updateBtn();
        });
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
        // 图标固定为 buttons/音乐.svg，只切换标题与播放高亮状态
        if (this.playlist.length === 0) {
            this.btn.title = '无音乐';
            this.btn.classList.remove('is-playing');
        } else if (this.playing) {
            this.btn.title = '播放中：' + this.currentName;
            this.btn.classList.add('is-playing');
        } else {
            this.btn.title = this.playlist.length + ' 首';
            this.btn.classList.remove('is-playing');
        }
    }

    // ========== 弹窗 ==========
    /** 打开播放器（网站管理 → 背景音乐的「🎵 打开播放器」入口） */
    openPopup() {
        if (!this.popup) return;
        this._renderTracks();
        // 需要盖在网站管理面板（z-index 1300）之上
        this.popup.style.zIndex = '1500';
        this.popup.classList.remove('hidden');
        this._updateBtn();
    }
    _closePopup() { this.popup?.classList.add('hidden'); }

    _renderTracks() {
        if (!this.popupBody) return;
        if (this.playlist.length === 0) {
            this.popupBody.innerHTML = '<div style="color:#667;font-size:12px;text-align:center;padding:20px;">🎶 暂无音乐<br><br>音乐由开发者统一上传</div>';
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
    }

    // ========== 上传（客户端本地加载） ==========
    async _uploadFile(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const name = file.name;
                const dataUrl = e.target.result;
                // 存储到内存 + localStorage（保存文件名）
                if (!this.playlist.includes(name)) {
                    this.playlist.push(name);
                    localStorage.setItem('bgm_playlist', JSON.stringify(this.playlist));
                    // 存储文件数据到 localStorage（小于5MB的文件）
                    if (dataUrl.length < 5 * 1024 * 1024) {
                        try {
                            localStorage.setItem('bgm_' + name, dataUrl);
                        } catch (e) {}
                    }
                }
                this._renderTracks();
                if (this.currentIdx < 0) this._playIndex(this.playlist.length - 1);
                this._updateBtn();
                resolve();
            };
            reader.readAsDataURL(file);
        });
    }

    triggerUpload() { this.uploadInput.click(); }

    /** 网站管理上传 / 删除音乐后刷新播放列表（不自动切歌） */
    reloadPlaylist() { return this._loadMusicList(false); }

    // ========== 删除 ==========
    async _deleteTrack(idx) {
        if (idx < 0 || idx >= this.playlist.length) return;
        const name = this.playlist[idx];
        const wasCurrent = idx === this.currentIdx;

        // 从 localStorage 中移除
        localStorage.removeItem('bgm_' + name);
        this.playlist.splice(idx, 1);
        localStorage.setItem('bgm_playlist', JSON.stringify(this.playlist));
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
