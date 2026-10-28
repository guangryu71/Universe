// ============================================================
// DetailTreeEditor.js — 详情数据文件夹式文本编译器
// 星体（恒星/行星/卫星）的详情由文件夹树 + .txt/.png/.jpg 文件构成。
// 树结构保存在各星体的 detailTree 字段中，文件本体上传到服务器
// /detail_files/ 目录，实现数据持久化。
// ============================================================

import { showToast } from './toast.js?v=1';

const MAX_FOLDER_LEVEL = 5;

/** 节点结构：
 *  { type:'folder', name, children:[...] }
 *  { type:'text',   name, url?, content?, dirty? }
 *  { type:'image',  name, url }
 */

export class DetailTreeEditor {
    /**
     * @param {object} options
     * @param {function} options.onSave - (tree) => void 保存回调
     */
    constructor(options = {}) {
        this.onSave = options.onSave || (() => {});
        this._tree = [];
        this._title = '';
        this._mode = 'detail';
        this._activeNode = null;
        this._uid = 0;
        this._dom = null;
    }

    /**
     * 打开编辑器并载入一棵树（会深拷贝，不直接修改入参）
     * @param {Array|null} tree
     * @param {string} title
     * @param {{mode?: 'detail'|'surface'}} [options] - surface：仅一个地表图片文件夹
     */
    open(tree, title = '', options = {}) {
        this._ensureDom();
        this._mode = options.mode === 'surface' ? 'surface' : 'detail';
        this._tree = this._cloneTree(tree);
        this._title = title;
        this._activeNode = null;

        if (this._mode === 'surface') {
            this._normalizeSurfaceTree();
        } else {
            this._ensureDefaultFolder();
        }

        // 地表模式：隐藏“新建一级文件夹”，改提示文案
        this._dom.addRootBtn.style.display = this._mode === 'surface' ? 'none' : '';
        this._dom.hint.innerHTML = this._mode === 'surface'
            ? '右键图片：重命名 / 删除<br>右键文件夹：上传地表图片（.png / .jpg，单张不超过 10MB）'
            : '右键文件夹：重命名 / 新建子文件夹 / 新建文本 / 上传文件 / 删除<br>文件夹最多 5 级，支持 .txt 与 .png / .jpg；点击右上角“＋ 一级文件夹”可再建顶层文件夹';
        this._dom.fileInput.accept = this._mode === 'surface' ? '.png,.jpg,.jpeg' : '.txt,.png,.jpg,.jpeg';
        this._dom.titleLabel.textContent = this._mode === 'surface' ? '🖼 地表图片' : '📁 详情编译器';
        this._dom.viewPlaceholder.textContent = this._mode === 'surface'
            ? '点击左侧图片查看大图'
            : '点击左侧 .txt 或图片文件查看内容';

        this._dom.target.textContent = title ? '· ' + title : '';
        this._dom.overlay.classList.add('show');
        this._renderTree();
        this._clearView();
    }

    /** 地表模式：只保留一个文件夹，内部全部是图片 */
    _normalizeSurfaceTree() {
        const images = [];
        const walk = (nodes) => {
            for (const n of nodes || []) {
                if (!n) continue;
                if (n.type === 'folder') walk(n.children);
                else if (n.type === 'image' && n.url) {
                    images.push({ type: 'image', name: n.name || '地表图片', url: n.url });
                }
            }
        };
        walk(Array.isArray(this._tree) ? this._tree : []);

        const findFolder = (nodes) => {
            for (const n of nodes || []) if (n?.type === 'folder') return n;
            return null;
        };
        let folder = findFolder(Array.isArray(this._tree) ? this._tree : []);
        if (!folder) {
            folder = { type: 'folder', name: '地表图片', children: [] };
        }
        folder.name = folder.name || '地表图片';
        folder.children = images;
        folder._open = true;
        this._tree = [folder];
    }

    close() {
        if (this._dom) this._dom.overlay.classList.remove('show');
        this._hideContextMenu();
        this._activeNode = null;
    }

    // ---------------- DOM ----------------
    _ensureDom() {
        if (this._dom) return;
        const overlay = document.createElement('div');
        overlay.id = 'detail-tree-editor';
        overlay.className = 'dte-overlay';
        overlay.innerHTML = `
            <div class="dte-panel">
                <div class="dte-header">
                    <div class="dte-title"><span class="dte-title-label">📁 详情编译器</span> <span class="dte-target"></span></div>
                    <div class="dte-header-actions">
                        <button class="dte-btn dte-add-root" title="新建一级文件夹">＋ 一级文件夹</button>
                        <button class="dte-btn dte-save" title="保存详情数据">💾 保存</button>
                        <button class="dte-close" title="关闭">&times;</button>
                    </div>
                </div>
                <div class="dte-body">
                    <div class="dte-tree-pane">
                        <div class="dte-tree"></div>
                        <div class="dte-hint">右键文件夹：重命名 / 新建子文件夹 / 新建文本 / 上传文件 / 删除<br>文件夹最多 5 级，支持 .txt 与 .png / .jpg；点击右上角“＋ 一级文件夹”可再建顶层文件夹</div>
                    </div>
                    <div class="dte-view-pane">
                        <div class="dte-view-placeholder">点击左侧 .txt 或图片文件查看内容</div>
                        <div class="dte-view-content"></div>
                    </div>
                </div>
            </div>
            <div class="dte-context-menu"></div>
            <input type="file" class="dte-file-input" accept=".txt,.png,.jpg,.jpeg" style="display:none">
        `;
        document.body.appendChild(overlay);

        this._dom = {
            overlay,
            titleLabel: overlay.querySelector('.dte-title-label'),
            target: overlay.querySelector('.dte-target'),
            tree: overlay.querySelector('.dte-tree'),
            hint: overlay.querySelector('.dte-hint'),
            viewPlaceholder: overlay.querySelector('.dte-view-placeholder'),
            viewContent: overlay.querySelector('.dte-view-content'),
            contextMenu: overlay.querySelector('.dte-context-menu'),
            fileInput: overlay.querySelector('.dte-file-input'),
            saveBtn: overlay.querySelector('.dte-save'),
            addRootBtn: overlay.querySelector('.dte-add-root'),
            closeBtn: overlay.querySelector('.dte-close'),
        };

        overlay.addEventListener('mousedown', (e) => {
            if (e.target === overlay) this.close();
            if (!e.target.closest('.dte-context-menu')) this._hideContextMenu();
        });
        this._dom.closeBtn.addEventListener('click', () => this.close());
        this._dom.saveBtn.addEventListener('click', () => this._save());
        this._dom.addRootBtn.addEventListener('click', () => this._addFolder(this._tree, 1, true));

        // 树节点事件委托
        this._dom.tree.addEventListener('click', (e) => this._onTreeClick(e));
        this._dom.tree.addEventListener('contextmenu', (e) => this._onTreeContextMenu(e));

        // 右键菜单事件委托
        this._dom.contextMenu.addEventListener('click', (e) => {
            const item = e.target.closest('[data-action]');
            if (!item) return;
            const action = item.dataset.action;
            const node = this._ctxNode;
            this._hideContextMenu();
            if (node) this._runAction(action, node);
        });

        // 上传文件
        this._dom.fileInput.addEventListener('change', () => {
            const file = this._dom.fileInput.files?.[0];
            const folder = this._uploadTarget;
            this._dom.fileInput.value = '';
            if (file && folder) this._uploadFile(folder, file);
        });
    }

    // ---------------- 树数据 ----------------
    _cloneTree(tree) {
        if (!Array.isArray(tree)) return [];
        try {
            return JSON.parse(JSON.stringify(tree));
        } catch {
            return [];
        }
    }

    _ensureDefaultFolder() {
        if (!Array.isArray(this._tree)) this._tree = [];
        // 只保留合法节点
        this._tree = this._tree.filter(n => n && (n.type === 'folder' || n.type === 'text' || n.type === 'image'));
        if (this._tree.length === 0) {
            this._tree.push({ type: 'folder', name: '新建文件夹', children: [], _open: true });
        }
    }

    _walk(nodes, fn, level = 1, parent = null) {
        for (const node of nodes) {
            fn(node, level, parent, nodes);
            if (node.type === 'folder' && Array.isArray(node.children)) {
                this._walk(node.children, fn, level + 1, node);
            }
        }
    }

    _findParent(nodes, target) {
        for (const node of nodes) {
            if (node === target) return nodes;
            if (node.type === 'folder' && Array.isArray(node.children)) {
                const found = this._findParent(node.children, target);
                if (found) return found;
            }
        }
        return null;
    }

    _folderLevel(folder) {
        let level = 0;
        const search = (nodes, current) => {
            for (const node of nodes) {
                if (node === folder) { level = current; return true; }
                if (node.type === 'folder' && Array.isArray(node.children)) {
                    if (search(node.children, current + 1)) return true;
                }
            }
            return false;
        };
        search(this._tree, 1);
        return level || 1;
    }

    _uniqueName(siblings, base) {
        const names = new Set(siblings.map(n => n.name));
        if (!names.has(base)) return base;
        const dot = base.lastIndexOf('.');
        const stem = dot > 0 ? base.slice(0, dot) : base;
        const ext = dot > 0 ? base.slice(dot) : '';
        let i = 2;
        while (names.has(`${stem} (${i})${ext}`)) i++;
        return `${stem} (${i})${ext}`;
    }

    // ---------------- 渲染 ----------------
    _renderTree() {
        const treeEl = this._dom.tree;
        treeEl.innerHTML = '';
        if (this._tree.length === 0) {
            treeEl.innerHTML = this._mode === 'surface'
                ? '<div class="dte-empty">暂无地表图片</div>'
                : '<div class="dte-empty">暂无内容，点击右上角“＋ 一级文件夹”</div>';
            return;
        }
        this._tree.forEach(node => treeEl.appendChild(this._buildNode(node, 1)));
    }

    _buildNode(node, level) {
        const wrap = document.createElement('div');
        wrap.className = 'dte-node';

        const row = document.createElement('div');
        row.className = 'dte-row';
        row.style.paddingLeft = (6 + (level - 1) * 16) + 'px';
        row.dataset.uid = this._nodeUid(node);
        if (node === this._activeNode) row.classList.add('active');

        if (node.type === 'folder') {
            const isOpen = node._open !== false;
            const arrow = document.createElement('span');
            arrow.className = 'dte-arrow';
            arrow.textContent = isOpen ? '▾' : '▸';
            row.appendChild(arrow);
            const icon = document.createElement('span');
            icon.className = 'dte-icon';
            icon.textContent = isOpen ? '📂' : '📁';
            row.appendChild(icon);
        } else {
            const spacer = document.createElement('span');
            spacer.className = 'dte-arrow';
            spacer.textContent = '';
            row.appendChild(spacer);
            const icon = document.createElement('span');
            icon.className = 'dte-icon';
            icon.textContent = node.type === 'image' ? '🖼' : '📄';
            row.appendChild(icon);
        }

        const name = document.createElement('span');
        name.className = 'dte-name';
        name.textContent = node.name;
        row.appendChild(name);

        if (node.type === 'folder' && Array.isArray(node.children) && node.children.length)
            row.dataset.hasChildren = '1';

        wrap.appendChild(row);

        if (node.type === 'folder' && Array.isArray(node.children)) {
            const childrenEl = document.createElement('div');
            childrenEl.className = 'dte-children';
            if (node._open === false) childrenEl.style.display = 'none';
            node.children.forEach(child => childrenEl.appendChild(this._buildNode(child, level + 1)));
            wrap.appendChild(childrenEl);
        }

        return wrap;
    }

    _nodeUid(node) {
        if (!node._uid) node._uid = 'n' + (++this._uid);
        return node._uid;
    }

    _findNodeByUid(uid) {
        let found = null;
        this._walk(this._tree, (node) => {
            if (!found && this._nodeUid(node) === uid) found = node;
        });
        return found;
    }

    _onTreeClick(e) {
        const row = e.target.closest('.dte-row');
        if (!row) return;
        const node = this._findNodeByUid(row.dataset.uid);
        if (!node) return;

        if (node.type === 'folder') {
            node._open = node._open === false;
            this._activeNode = node;
            this._renderTree();
            return;
        }
        this._activeNode = node;
        this._renderTree();
        this._showFile(node);
    }

    // ---------------- 右键菜单 ----------------
    _onTreeContextMenu(e) {
        e.preventDefault();
        const row = e.target.closest('.dte-row');
        if (!row) return;
        const node = this._findNodeByUid(row.dataset.uid);
        if (!node) return;

        this._ctxNode = node;
        const menu = this._dom.contextMenu;
        const isFolder = node.type === 'folder';
        const level = isFolder ? this._folderLevel(node) : 0;
        const canAddSub = isFolder && level < MAX_FOLDER_LEVEL;
        // 地表模式只有一个专用文件夹，不允许删除它
        const canDelete = this._mode === 'surface'
            ? !isFolder
            : !(isFolder && this._tree.length === 1 && this._tree[0] === node);

        const items = this._mode === 'surface'
            ? [
                { action: 'rename', label: '✏️ 重命名', enabled: true },
                { action: 'upload', label: '⬆️ 上传地表图片 (.png / .jpg)', enabled: isFolder },
                { action: 'sep', label: '', enabled: false },
                { action: 'delete', label: '🗑 删除', enabled: canDelete, danger: true },
            ]
            : [
                { action: 'rename', label: '✏️ 重命名', enabled: true },
                { action: 'new-folder', label: '📁 新建子文件夹', enabled: canAddSub },
                { action: 'new-text', label: '📄 新建文本 (.txt)', enabled: isFolder },
                { action: 'upload', label: '⬆️ 上传文件 (.txt / .png / .jpg)', enabled: isFolder },
                { action: 'sep', label: '', enabled: false },
                { action: 'delete', label: '🗑 删除', enabled: canDelete, danger: true },
            ];
        menu.innerHTML = items.map(it => {
            if (it.action === 'sep') return '<div class="dte-menu-sep"></div>';
            return `<div class="dte-menu-item${it.danger ? ' danger' : ''}${it.enabled ? '' : ' disabled'}" data-action="${it.action}">${it.label}</div>`;
        }).join('');

        menu.classList.add('show');
        const rect = menu.getBoundingClientRect();
        let x = e.clientX;
        let y = e.clientY;
        if (x + rect.width > window.innerWidth - 8) x = window.innerWidth - rect.width - 8;
        if (y + rect.height > window.innerHeight - 8) y = window.innerHeight - rect.height - 8;
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
    }

    _hideContextMenu() {
        if (this._dom) this._dom.contextMenu.classList.remove('show');
        this._ctxNode = null;
    }

    _runAction(action, node) {
        switch (action) {
            case 'rename': this._renameNode(node); break;
            case 'new-folder':
                if (this._mode !== 'surface') this._addFolder(node.children, this._folderLevel(node) + 1);
                break;
            case 'new-text':
                if (this._mode !== 'surface') this._addText(node);
                break;
            case 'upload': this._pickUpload(node); break;
            case 'delete': this._deleteNode(node); break;
        }
    }

    _renameNode(node) {
        const name = window.prompt('重命名', node.name);
        if (name === null) return;
        const trimmed = name.trim();
        if (!trimmed) return;
        const parentList = this._findParent(this._tree, node);
        const siblings = (parentList || []).filter(n => n !== node);
        node.name = this._uniqueName(siblings, trimmed);
        // 文本文件改名后需要重新上传，让服务器文件名与显示名一致
        if (node.type === 'text' && node.content !== undefined) node.dirty = true;
        this._renderTree();
        if (this._activeNode === node && node.type !== 'folder') this._showFile(node);
    }

    _addFolder(children, level, forceOpen = false) {
        if (this._mode === 'surface') return;
        if (!Array.isArray(children)) return;
        if (level > MAX_FOLDER_LEVEL) {
            alert('文件夹最多 5 级');
            return;
        }
        const node = {
            type: 'folder',
            name: this._uniqueName(children, '新建文件夹'),
            children: [],
            _open: true,
        };
        children.push(node);
        this._activeNode = node;
        if (forceOpen) this._renderTree();
        else this._renderTree();
    }

    _addText(folder) {
        if (this._mode === 'surface') return;
        if (!folder || folder.type !== 'folder') return;
        const node = {
            type: 'text',
            name: this._uniqueName(folder.children, '新建文本.txt'),
            content: '',
            dirty: true,
        };
        folder.children.push(node);
        folder._open = true;
        this._activeNode = node;
        this._renderTree();
        this._showFile(node);
    }

    _deleteNode(node) {
        if (this._mode === 'surface' && node.type === 'folder') return; // 专用文件夹不可删除
        const parent = this._findParent(this._tree, node);
        if (!parent) return; // 根节点不允许删除
        if (!window.confirm(`确定删除“${node.name}”吗？`)) return;
        const idx = parent.indexOf(node);
        if (idx >= 0) parent.splice(idx, 1);
        // 删除的可能是当前查看文件所在的整个文件夹
        let activeExists = false;
        this._walk(this._tree, (n) => { if (n === this._activeNode) activeExists = true; });
        if (this._activeNode && !activeExists) {
            this._activeNode = null;
            this._clearView();
        }
        this._renderTree();
    }

    // ---------------- 上传 ----------------
    _pickUpload(folder) {
        this._uploadTarget = folder;
        this._dom.fileInput.value = '';
        this._dom.fileInput.click();
    }

    async _uploadFile(folder, file) {
        const lower = file.name.toLowerCase();
        const isImage = /\.(png|jpe?g)$/.test(lower);

        if (this._mode === 'surface' && !isImage) {
            alert('地表图片仅支持 .png / .jpg');
            return;
        }
        if (isImage && file.size > 10 * 1024 * 1024) {
            alert('图片大小不能超过 10MB');
            return;
        }

        if (lower.endsWith('.txt')) {
            const text = await file.text();
            const node = {
                type: 'text',
                name: this._uniqueName(folder.children, file.name),
                content: text,
                dirty: true,
            };
            folder.children.push(node);
            folder._open = true;
            this._activeNode = node;
            this._renderTree();
            this._showFile(node);
            return;
        }
        if (/\.(png|jpe?g)$/.test(lower)) {
            try {
                const dataUrl = await this._readAsDataURL(file);
                const res = await this._upload({ filename: file.name, dataUrl });
                if (!res.ok) throw new Error(res.error || '上传失败');
                const node = {
                    type: 'image',
                    name: this._uniqueName(folder.children, file.name),
                    url: res.url,
                };
                folder.children.push(node);
                folder._open = true;
                this._activeNode = node;
                this._renderTree();
                this._showFile(node);
            } catch (err) {
                alert('图片上传失败：' + err.message);
            }
            return;
        }
        alert('仅支持 .txt 与 .png / .jpg 文件');
    }

    _readAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('读取文件失败'));
            reader.readAsDataURL(file);
        });
    }

    async _upload(payload) {
        try {
            const resp = await fetch('/api/upload-detail-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            return await resp.json();
        } catch (err) {
            return { ok: false, error: '服务器不可用' };
        }
    }

    // ---------------- 右侧查看 / 编辑 ----------------
    _clearView() {
        this._dom.viewPlaceholder.style.display = '';
        this._dom.viewPlaceholder.textContent = this._mode === 'surface'
            ? '点击左侧图片查看大图'
            : '点击左侧 .txt 或图片文件查看内容';
        this._dom.viewContent.innerHTML = '';
    }

    async _showFile(node) {
        const placeholder = this._dom.viewPlaceholder;
        const view = this._dom.viewContent;
        placeholder.style.display = 'none';
        view.innerHTML = '';

        if (node.type === 'image') {
            const img = document.createElement('img');
            img.className = 'dte-view-img';
            img.src = node.url || '';
            img.alt = node.name;
            view.appendChild(img);
            const tip = document.createElement('div');
            tip.className = 'dte-view-tip';
            tip.textContent = node.name;
            view.appendChild(tip);
            return;
        }

        // text：按需从服务器拉取内容
        if (node.content === undefined) {
            view.innerHTML = '<div class="dte-view-loading">加载中…</div>';
            try {
                if (node.url) {
                    const resp = await fetch(node.url);
                    node.content = resp.ok ? await resp.text() : '';
                } else {
                    node.content = '';
                }
            } catch {
                node.content = '';
            }
            if (this._activeNode !== node) return;
            view.innerHTML = '';
        }

        const header = document.createElement('div');
        header.className = 'dte-view-header';
        header.textContent = node.name;
        view.appendChild(header);

        const ta = document.createElement('textarea');
        ta.className = 'dte-view-textarea';
        ta.value = node.content || '';
        ta.placeholder = '输入文本内容…';
        ta.addEventListener('input', () => {
            node.content = ta.value;
            node.dirty = true;
        });
        view.appendChild(ta);

        const footer = document.createElement('div');
        footer.className = 'dte-view-tip';
        footer.textContent = '文本修改会保存为服务器上的 .txt 文件';
        view.appendChild(footer);
    }

    // ---------------- 保存 ----------------
    async _save() {
        const saveBtn = this._dom.saveBtn;
        const texts = [];
        this._walk(this._tree, (node) => {
            if (node.type === 'text') texts.push(node);
        });

        saveBtn.disabled = true;
        saveBtn.textContent = '⏳ 保存中…';
        try {
            for (const node of texts) {
                if (!node.dirty) continue;
                const res = await this._upload({
                    filename: node.name.endsWith('.txt') ? node.name : node.name + '.txt',
                    text: node.content || '',
                });
                if (!res.ok) throw new Error(res.error || '上传失败');
                node.url = res.url;
                if (!node.name.toLowerCase().endsWith('.txt')) node.name += '.txt';
                delete node.dirty;
                delete node.content; // 服务端已有文件，树中只保留 url
            }
            const clean = this._exportTree(this._tree);
            await this.onSave(clean);
            showToast(
                this._mode === 'surface' ? '✅ 地表图片保存成功' : '✅ 详情数据保存成功',
                'success'
            );
            this.close();
        } catch (err) {
            showToast('⚠ 保存失败：' + (err?.message || err), 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = '💾 保存';
        }
    }

    /** 导出纯数据（去掉 _open / _uid / dirty 等临时字段） */
    _exportTree(nodes) {
        return nodes
            .filter(n => n && n.type)
            .map(n => {
                if (n.type === 'folder') {
                    return {
                        type: 'folder',
                        name: n.name,
                        children: this._exportTree(Array.isArray(n.children) ? n.children : []),
                    };
                }
                if (n.type === 'text') {
                    return { type: 'text', name: n.name, url: n.url || '' };
                }
                return { type: 'image', name: n.name, url: n.url || '' };
            });
    }
}

/** 把旧的纯文本详情包装成文件夹树，供详情弹窗统一渲染 */
export function legacyDetailsToTree(details) {
    if (!details) return null;
    return [{
        type: 'folder',
        name: '详情',
        children: [{ type: 'text', name: '简介.txt', url: '', content: String(details) }],
    }];
}
