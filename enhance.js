/* ============================================================
 * enhance.js — 站点增强模块
 *  1. 文件中心：上传 / 下载 / 删除（与后台文件管理共用 managedFiles）
 *  2. 发帖系统：发布 / 列表 / 详情 / 删除（sitePosts）
 *  3. 管理员模块权限：超管可分配（adminPermissions）
 *  4. 账号展示一键复制
 *  5. 站点自动备份（siteBackupConfig / siteBackups / siteBackup_<id>）
 *  6. 用户名字符数校验（≤6，中文与 emoji 均按 1 位计）
 * 依赖：auth.js 暴露的 window.dataStore / getSession / showToast / getUsers / addLog
 * ============================================================ */
(function () {
    'use strict';

    var LIMITS = {
        FILE_MAX: 2 * 1024 * 1024,          // 单文件上限 2MB
        POST_IMG_MAX: 1.5 * 1024 * 1024,    // 单张配图上限 1.5MB（压缩前）
        POST_ATTACH_MAX: 1024 * 1024,       // 单个附件上限 1MB
        POST_IMG_COUNT: 3,                  // 每帖最多 3 张配图
        POST_ATTACH_COUNT: 2,               // 每帖最多 2 个附件
        BACKUP_CLOUD_MAX: 800 * 1024        // 云端单份备份 JSON 上限（超出则省略二进制内容）
    };

    var KEY = {
        FILES: 'managedFiles',
        POSTS: 'sitePosts',
        PERMS: 'adminPermissions',
        BACKUP_CFG: 'siteBackupConfig',
        BACKUP_IDX: 'siteBackups',
        BACKUP_DATA: 'siteBackup_',
        USERS: 'users'
    };

    var PREFIX_KEYS = [
        'siteFollows_', 'siteNotes_', 'siteDiary_', 'siteReadLater_',
        'siteHistory_', 'userFavorites_', 'userActivity_', 'userDevices_'
    ];

    var CYCLE_MS = { daily: 24 * 3600 * 1000, weekly: 7 * 24 * 3600 * 1000, monthly: 30 * 24 * 3600 * 1000 };
    var CYCLE_NAME = { daily: '每天', weekly: '每周', monthly: '每月' };

    /* ---------------- 基础工具 ---------------- */

    function ds() { return window.dataStore || null; }

    function dsGet(k) {
        try { var d = ds(); return d && d.get ? d.get(k) : null; } catch (e) { return null; }
    }

    function dsSet(k, v) {
        try { var d = ds(); if (d && d.set) return d.set(k, v); } catch (e) { return null; }
    }

    function dsRemove(k) {
        try { var d = ds(); if (d && d.remove) return d.remove(k); } catch (e) { return null; }
    }

    function readJSON(k, def) {
        var raw = dsGet(k);
        if (raw === null || raw === undefined || raw === '') return def;
        try {
            var v = JSON.parse(raw);
            return v === null || v === undefined ? def : v;
        } catch (e) { return def; }
    }

    function readArr(k) {
        var v = readJSON(k, []);
        return Array.isArray(v) ? v : [];
    }

    function writeArr(k, arr) { return dsSet(k, JSON.stringify(arr || [])); }

    function session() {
        try { return window.getSession ? window.getSession() : null; } catch (e) { return null; }
    }

    function currentUser() {
        var s = session();
        if (!s || !s.username) return null;
        var users = getCleanUsers();
        for (var i = 0; i < users.length; i++) {
            if (users[i].username === s.username) return users[i];
        }
        return { username: s.username, role: s.role || 'user' };
    }

    function currentName() {
        var u = currentUser();
        return u && u.username ? u.username : '';
    }

    function isSuper() {
        var u = currentUser();
        return !!(u && u.role === 'super_admin');
    }

    function isAdminUser() {
        var u = currentUser();
        return !!(u && (u.role === 'super_admin' || u.role === 'admin'));
    }

    function getCleanUsers() {
        var arr = [];
        try { arr = window.getUsers ? window.getUsers() : readArr(KEY.USERS); } catch (e) { arr = readArr(KEY.USERS); }
        if (!Array.isArray(arr)) return [];
        var out = [];
        for (var i = 0; i < arr.length; i++) {
            var u = arr[i];
            if (u && typeof u === 'object' && u.username) out.push(u);
        }
        return out;
    }

    function esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function toast(msg, type) {
        if (typeof window.showToast === 'function') { window.showToast(msg, type || 'info'); }
        else { window.alert(msg); }
    }

    function log(action, detail) {
        if (typeof window.addLog === 'function') {
            try { window.addLog(action, detail); } catch (e) { /* ignore */ }
        }
    }

    function pad(n) { return n < 10 ? '0' + n : '' + n; }

    function fmtTime(ts) {
        if (!ts) return '-';
        var d = new Date(ts);
        if (isNaN(d.getTime())) return '-';
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
            ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function fmtSize(bytes) {
        var b = Number(bytes) || 0;
        if (b < 1024) return b + ' B';
        if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
        return (b / 1024 / 1024).toFixed(2) + ' MB';
    }

    function uid(prefix) {
        return (prefix || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    function stampNow() {
        var d = new Date();
        return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' +
            pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    }

    function readDataURL(file) {
        return new Promise(function (resolve) {
            var r = new FileReader();
            r.onload = function (e) { resolve(e.target.result); };
            r.onerror = function () { resolve(null); };
            r.readAsDataURL(file);
        });
    }

    function compressImage(file, maxSide, quality) {
        return readDataURL(file).then(function (dataUrl) {
            if (!dataUrl) return null;
            if (dataUrl.length < 500 * 1024) return dataUrl;
            return new Promise(function (resolve) {
                var img = new Image();
                img.onload = function () {
                    try {
                        var w = img.width, h = img.height;
                        var scale = Math.min(1, (maxSide || 1280) / Math.max(w, h));
                        var c = document.createElement('canvas');
                        c.width = Math.max(1, Math.round(w * scale));
                        c.height = Math.max(1, Math.round(h * scale));
                        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                        resolve(c.toDataURL('image/jpeg', quality || 0.82));
                    } catch (e) { resolve(dataUrl); }
                };
                img.onerror = function () { resolve(dataUrl); };
                img.src = dataUrl;
            });
        });
    }

    /* ---------------- 用户名长度（≤6，中文/emoji 均计 1 位） ---------------- */

    function charLen(str) {
        var s = String(str === null || str === undefined ? '' : str);
        if (typeof Array.from === 'function') return Array.from(s).length;
        return s.length;
    }

    function usernameTooLong(name) { return charLen(name) > 6; }

    /**
     * 校验用户名长度；超长时给出提示。
     * @param {string} name 用户名
     * @param {function} [showErr] 自定义提示函数
     * @returns {boolean} true 表示通过
     */
    function checkUsernameLength(name, showErr) {
        if (!usernameTooLong(name)) return true;
        var tip = '用户名最多 6 个字符（当前 ' + charLen(name) + ' 个）';
        if (typeof showErr === 'function') showErr(tip);
        else toast(tip, 'error');
        return false;
    }

    /** 为输入框绑定长度提示：输入即校验，超长显示红字提示 */
    function bindUsernameLength(input, hint) {
        if (!input) return;
        var hintEl = hint || null;
        function update() {
            var over = usernameTooLong(input.value);
            if (hintEl) {
                hintEl.textContent = over ? ('已超出 ' + (charLen(input.value) - 6) + ' 个字符，最多 6 个') : '';
                hintEl.style.display = over ? 'block' : 'none';
                hintEl.className = over ? 'len-hint len-hint-error' : 'len-hint';
            }
            input.classList.toggle('input-invalid', over);
        }
        input.addEventListener('input', update);
        update();
    }

    /* ---------------- 账号复制 ---------------- */

    function copyText(text) {
        var value = String(text || '');
        if (!value) { toast('账号为空，无法复制', 'warning'); return false; }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(value).then(function () {
                toast('账号已复制：' + value, 'success');
            }).catch(function () { fallbackCopy(value); });
            return true;
        }
        return fallbackCopy(value);
    }

    function fallbackCopy(value) {
        try {
            var ta = document.createElement('textarea');
            ta.value = value;
            ta.setAttribute('readonly', 'readonly');
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            var ok = document.execCommand('copy');
            document.body.removeChild(ta);
            toast(ok ? ('账号已复制：' + value) : '复制失败，请手动选择复制', ok ? 'success' : 'error');
            return ok;
        } catch (e) {
            toast('复制失败，请手动选择复制', 'error');
            return false;
        }
    }

    function copyAccountOf(username) {
        var name = username || currentName();
        if (!name) { toast('请先登录', 'warning'); return; }
        var users = getCleanUsers();
        var target = null;
        for (var i = 0; i < users.length; i++) { if (users[i].username === name) { target = users[i]; break; } }
        if (!target) { toast('账号信息不存在', 'error'); return; }
        if (!target.accountId && window.ensureAccountId) {
            try { window.ensureAccountId(target); } catch (e) { /* ignore */ }
        }
        copyText(target.accountId || '');
    }

    /* ---------------- 文件中心 ---------------- */

    function getManagedFiles() { return readArr(KEY.FILES); }

    function saveManagedFiles(list) { return writeArr(KEY.FILES, list); }

    function fileKind(f) {
        var type = (f && f.type) || '';
        var name = (f && f.name) || '';
        var ext = name.indexOf('.') > -1 ? name.split('.').pop().toLowerCase() : '';
        if (type.indexOf('image/') === 0 || /^(jpg|jpeg|png|gif|webp|bmp|svg)$/.test(ext)) return 'image';
        if (type.indexOf('video/') === 0 || /^(mp4|mov|avi|mkv|webm)$/.test(ext)) return 'video';
        if (type.indexOf('audio/') === 0 || /^(mp3|wav|flac|aac|ogg)$/.test(ext)) return 'audio';
        if (/^(pdf)$/.test(ext)) return 'pdf';
        if (/^(doc|docx)$/.test(ext)) return 'doc';
        if (/^(xls|xlsx|csv)$/.test(ext)) return 'excel';
        if (/^(ppt|pptx)$/.test(ext)) return 'ppt';
        if (/^(zip|rar|7z|gz)$/.test(ext)) return 'zip';
        return 'file';
    }

    var KIND_ICON = { image: '🖼️', video: '🎬', audio: '🎵', pdf: '📕', doc: '📄', excel: '📊', ppt: '📽️', zip: '🗜️', file: '📎' };

    /**
     * 批量上传文件到文件中心。
     * @param {FileList|Array} fileList 文件列表
     * @param {function} [onProgress] (done, total, name)
     * @returns {Promise<{ok:Array, failed:Array}>}
     */
    function uploadFiles(fileList, onProgress) {
        var arr = Array.prototype.slice.call(fileList || []);
        var ok = [], failed = [];
        if (!arr.length) return Promise.resolve({ ok: ok, failed: failed });
        var name = currentName();
        if (!name) return Promise.resolve({ ok: ok, failed: [{ name: '-', reason: '请先登录后再上传文件' }] });

        var list = getManagedFiles();
        var idx = 0;

        function step() {
            if (idx >= arr.length) {
                saveManagedFiles(list);
                if (ok.length) log('upload_file', '上传文件 ' + ok.length + ' 个：' + ok.join('、').slice(0, 200));
                return Promise.resolve({ ok: ok, failed: failed });
            }
            var f = arr[idx];
            if (f.size > LIMITS.FILE_MAX) {
                failed.push({ name: f.name, reason: '文件大小 ' + fmtSize(f.size) + '，超出单文件 2MB 上限' });
                idx++; if (onProgress) onProgress(idx, arr.length, f.name);
                return step();
            }
            return readDataURL(f).then(function (dataUrl) {
                if (!dataUrl) {
                    failed.push({ name: f.name, reason: '文件读取失败' });
                } else {
                    list.push({
                        id: uid('f'),
                        name: f.name,
                        type: f.type || '',
                        kind: fileKind(f),
                        size: f.size,
                        data: dataUrl,
                        uploader: name,
                        uploadedAt: Date.now()
                    });
                    ok.push(f.name);
                }
                idx++;
                if (onProgress) onProgress(idx, arr.length, f.name);
                return step();
            });
        }
        return step();
    }

    function findFile(id) {
        var list = getManagedFiles();
        for (var i = 0; i < list.length; i++) { if (list[i] && list[i].id === id) return list[i]; }
        return null;
    }

    function downloadFileById(id) {
        var f = findFile(id);
        if (!f) { toast('文件不存在或已被删除', 'error'); return; }
        var data = f.data || f.dataUrl || '';
        if (!data) { toast('文件内容缺失，无法下载', 'error'); return; }
        try {
            var a = document.createElement('a');
            a.href = data;
            a.download = f.name || 'download';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            toast('已开始下载：' + f.name, 'success');
        } catch (e) {
            toast('下载失败：' + (e.message || '未知错误'), 'error');
        }
    }

    function canManageFile(f) {
        var u = currentUser();
        if (!u) return false;
        if (u.role === 'super_admin' || u.role === 'admin') return true;
        return f && f.uploader === u.username;
    }

    function deleteFileById(id, silent) {
        var f = findFile(id);
        if (!f) { toast('文件不存在', 'error'); return false; }
        if (!canManageFile(f)) { toast('只能删除自己上传的文件', 'error'); return false; }
        if (!silent && !window.confirm('确定删除文件「' + f.name + '」吗？删除后不可恢复。')) return false;
        var list = getManagedFiles().filter(function (x) { return x && x.id !== id; });
        saveManagedFiles(list);
        log('delete_file', '删除文件：' + f.name);
        toast('文件已删除', 'success');
        return true;
    }

    function renderFileList() {
        var box = document.getElementById('fileList');
        if (!box) return;
        var kw = (document.getElementById('fileSearchInput') || {}).value || '';
        kw = kw.trim().toLowerCase();
        var kind = (document.getElementById('fileKindFilter') || {}).value || '';
        var list = getManagedFiles().filter(function (f) {
            if (!f) return false;
            if (kind && fileKind(f) !== kind) return false;
            if (kw && String(f.name || '').toLowerCase().indexOf(kw) === -1 &&
                String(f.uploader || '').toLowerCase().indexOf(kw) === -1) return false;
            return true;
        }).sort(function (a, b) { return (b.uploadedAt || 0) - (a.uploadedAt || 0); });

        var countEl = document.getElementById('fileCount');
        if (countEl) countEl.textContent = '共 ' + list.length + ' 个文件（单文件上限 2MB）';

        if (!list.length) {
            box.innerHTML = '<p class="empty-tip">暂无文件，选择本地文件上传即可在列表中下载。</p>';
            return;
        }

        var html = '<div class="file-grid">';
        for (var i = 0; i < list.length; i++) {
            var f = list[i];
            var k = fileKind(f);
            var canDel = canManageFile(f);
            html += '<div class="file-card">' +
                '<div class="file-card-icon">' + (KIND_ICON[k] || '📎') + '</div>' +
                '<div class="file-card-main">' +
                '<div class="file-card-name" title="' + esc(f.name) + '">' + esc(f.name) + '</div>' +
                '<div class="file-card-meta">' + fmtSize(f.size) + ' · ' + esc(f.uploader || '-') + ' · ' + fmtTime(f.uploadedAt) + '</div>' +
                '</div>' +
                '<div class="file-card-actions">' +
                '<button class="btn btn-primary btn-sm" onclick="SiteEnhance.downloadFile(\'' + esc(f.id) + '\')">下载</button>' +
                (canDel ? '<button class="btn btn-danger btn-sm" onclick="SiteEnhance.removeFile(\'' + esc(f.id) + '\')">删除</button>' : '') +
                '</div></div>';
        }
        html += '</div>';
        box.innerHTML = html;
    }

    function bindFileCenter() {
        var input = document.getElementById('fileInput');
        var pickBtn = document.getElementById('filePickBtn');
        var drop = document.getElementById('fileDropArea');
        var progress = document.getElementById('fileProgress');
        if (pickBtn && input) pickBtn.addEventListener('click', function () { input.click(); });
        if (input) {
            input.addEventListener('change', function () { handlePicked(input.files); input.value = ''; });
        }
        if (drop) {
            ['dragenter', 'dragover'].forEach(function (ev) {
                drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('dragover'); });
            });
            ['dragleave', 'drop'].forEach(function (ev) {
                drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('dragover'); });
            });
            drop.addEventListener('drop', function (e) {
                if (e.dataTransfer && e.dataTransfer.files) handlePicked(e.dataTransfer.files);
            });
        }
        function handlePicked(files) {
            if (!files || !files.length) return;
            if (progress) { progress.textContent = '正在上传…'; progress.style.display = 'block'; }
            uploadFiles(files, function (done, total, name) {
                if (progress) progress.textContent = '已处理 ' + done + '/' + total + '：' + name;
            }).then(function (res) {
                if (progress) {
                    var msg = [];
                    if (res.ok.length) msg.push('成功上传 ' + res.ok.length + ' 个文件');
                    if (res.failed.length) msg.push('失败 ' + res.failed.length + ' 个：' + res.failed.map(function (x) { return x.name + '（' + x.reason + '）'; }).join('；'));
                    progress.textContent = msg.join('；') || '没有可上传的文件';
                }
                if (res.ok.length) toast('成功上传 ' + res.ok.length + ' 个文件', 'success');
                if (res.failed.length) toast(res.failed[0].name + '：' + res.failed[0].reason, 'error');
                renderFileList();
            });
        }
        var search = document.getElementById('fileSearchInput');
        if (search) search.addEventListener('input', renderFileList);
        var filter = document.getElementById('fileKindFilter');
        if (filter) filter.addEventListener('change', renderFileList);
        renderFileList();
    }

    /* ---------------- 发帖系统 ---------------- */

    function getPosts() {
        return readArr(KEY.POSTS).filter(function (p) { return p && p.id; });
    }

    function savePosts(list) { return writeArr(KEY.POSTS, list); }

    function canManagePost(p) {
        var u = currentUser();
        if (!u) return false;
        if (u.role === 'super_admin' || u.role === 'admin') return true;
        return p && p.author === u.username;
    }

    function createPost(payload) {
        var u = currentUser();
        if (!u) { toast('请先登录后再发帖', 'warning'); return null; }
        var title = String(payload.title || '').trim();
        var content = String(payload.content || '').trim();
        if (!title) { toast('请填写帖子标题', 'warning'); return null; }
        if (charLen(title) > 60) { toast('标题最多 60 个字符', 'warning'); return null; }
        if (!content && !(payload.images && payload.images.length) && !(payload.attachments && payload.attachments.length)) {
            toast('请填写正文或添加图片/附件', 'warning'); return null;
        }
        var post = {
            id: uid('p'),
            title: title,
            content: content,
            images: payload.images || [],
            attachments: payload.attachments || [],
            author: u.username,
            accountId: u.accountId || '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            pinned: false,
            likes: [],
            comments: []
        };
        var list = getPosts();
        list.unshift(post);
        savePosts(list);
        log('create_post', '发布帖子：' + title);
        toast('帖子发布成功', 'success');
        return post;
    }

    function deletePostById(id) {
        var list = getPosts();
        var post = null;
        for (var i = 0; i < list.length; i++) { if (list[i].id === id) { post = list[i]; break; } }
        if (!post) { toast('帖子不存在', 'error'); return false; }
        if (!canManagePost(post)) { toast('只能删除自己发布的帖子', 'error'); return false; }
        if (!window.confirm('确定删除帖子「' + post.title + '」吗？')) return false;
        savePosts(list.filter(function (p) { return p.id !== id; }));
        log('delete_post', '删除帖子：' + post.title);
        toast('帖子已删除', 'success');
        return true;
    }

    function togglePinPost(id) {
        if (!isAdminUser()) { toast('无权限操作', 'error'); return; }
        var list = getPosts();
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === id) {
                list[i].pinned = !list[i].pinned;
                savePosts(list);
                toast(list[i].pinned ? '已置顶' : '已取消置顶', 'success');
                if (typeof renderPostsAdmin === 'function') renderPostsAdmin();
                return;
            }
        }
    }

    function togglePostLike(id) {
        var u = currentUser();
        if (!u) { toast('请先登录', 'warning'); return; }
        var list = getPosts();
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === id) {
                var likes = Array.isArray(list[i].likes) ? list[i].likes : [];
                var pos = likes.indexOf(u.username);
                if (pos > -1) likes.splice(pos, 1); else likes.push(u.username);
                list[i].likes = likes;
                savePosts(list);
                renderPosts();
                if (document.getElementById('postDetailModal') && document.getElementById('postDetailModal').style.display === 'flex') {
                    openPostDetail(id);
                }
                return;
            }
        }
    }

    function fmtPostTime(ts) {
        var diff = Date.now() - (ts || 0);
        if (diff < 60 * 1000) return '刚刚';
        if (diff < 3600 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
        if (diff < 24 * 3600 * 1000) return Math.floor(diff / 3600000) + ' 小时前';
        return fmtTime(ts);
    }

    function renderPosts() {
        var box = document.getElementById('postList');
        if (!box) return;
        var kw = ((document.getElementById('postSearchInput') || {}).value || '').trim().toLowerCase();
        var mineOnly = !!(document.getElementById('postMineOnly') || {}).checked;
        var me = currentName();
        var list = getPosts().filter(function (p) {
            if (mineOnly && p.author !== me) return false;
            if (!kw) return true;
            return String(p.title || '').toLowerCase().indexOf(kw) > -1 ||
                String(p.content || '').toLowerCase().indexOf(kw) > -1 ||
                String(p.author || '').toLowerCase().indexOf(kw) > -1;
        });
        list.sort(function (a, b) {
            if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
            return (b.createdAt || 0) - (a.createdAt || 0);
        });
        var cnt = document.getElementById('postCount');
        if (cnt) cnt.textContent = '共 ' + list.length + ' 篇帖子';
        if (!list.length) {
            box.innerHTML = '<p class="empty-tip">还没有帖子，来发布第一篇吧。</p>';
            return;
        }
        var html = '';
        for (var i = 0; i < list.length; i++) {
            var p = list[i];
            var imgs = Array.isArray(p.images) ? p.images : [];
            var atts = Array.isArray(p.attachments) ? p.attachments : [];
            var likes = Array.isArray(p.likes) ? p.likes : [];
            var liked = me && likes.indexOf(me) > -1;
            html += '<article class="post-card" data-id="' + esc(p.id) + '">' +
                '<div class="post-card-head">' +
                (p.pinned ? '<span class="post-pin-tag">置顶</span>' : '') +
                '<h3 class="post-card-title" onclick="SiteEnhance.openPost(\'' + esc(p.id) + '\')">' + esc(p.title) + '</h3>' +
                '</div>' +
                '<div class="post-card-meta">' + esc(p.author || '-') + ' · ' + fmtPostTime(p.createdAt) +
                (atts.length ? ' · 附件 ' + atts.length : '') + (imgs.length ? ' · 图片 ' + imgs.length : '') + '</div>' +
                (p.content ? '<p class="post-card-body">' + esc(String(p.content).slice(0, 160)) + (charLen(p.content) > 160 ? '…' : '') + '</p>' : '') +
                (imgs.length ? '<div class="post-card-imgs">' + imgs.slice(0, 3).map(function (src, idx) {
                    return '<img src="' + esc(src) + '" alt="配图' + (idx + 1) + '" onclick="SiteEnhance.openPost(\'' + esc(p.id) + '\')">';
                }).join('') + '</div>' : '') +
                '<div class="post-card-foot">' +
                '<button class="btn btn-ghost btn-sm' + (liked ? ' active' : '') + '" onclick="SiteEnhance.likePost(\'' + esc(p.id) + '\')">赞 ' + likes.length + '</button>' +
                '<button class="btn btn-ghost btn-sm" onclick="SiteEnhance.openPost(\'' + esc(p.id) + '\')">查看详情</button>' +
                (canManagePost(p) ? '<button class="btn btn-danger btn-sm" onclick="SiteEnhance.removePost(\'' + esc(p.id) + '\')">删除</button>' : '') +
                '</div></article>';
        }
        box.innerHTML = html;
    }

    function openPostDetail(id) {
        var list = getPosts();
        var p = null;
        for (var i = 0; i < list.length; i++) { if (list[i].id === id) { p = list[i]; break; } }
        if (!p) { toast('帖子不存在', 'error'); return; }
        var modal = document.getElementById('postDetailModal');
        var body = document.getElementById('postDetailBody');
        if (!modal || !body) return;
        var imgs = Array.isArray(p.images) ? p.images : [];
        var atts = Array.isArray(p.attachments) ? p.attachments : [];
        var likes = Array.isArray(p.likes) ? p.likes : [];
        var html = '<h3 class="post-detail-title">' + (p.pinned ? '<span class="post-pin-tag">置顶</span>' : '') + esc(p.title) + '</h3>' +
            '<div class="post-card-meta">' + esc(p.author || '-') + ' · ' + fmtTime(p.createdAt) + '</div>' +
            '<div class="post-detail-body">' + esc(p.content || '').replace(/\n/g, '<br>') + '</div>';
        if (imgs.length) {
            html += '<div class="post-detail-imgs">' + imgs.map(function (src, idx) {
                return '<img src="' + esc(src) + '" alt="配图' + (idx + 1) + '">';
            }).join('') + '</div>';
        }
        if (atts.length) {
            html += '<div class="post-detail-atts"><div class="atts-title">附件（' + atts.length + '）</div><ul>';
            for (var a = 0; a < atts.length; a++) {
                var att = atts[a];
                html += '<li><a href="' + esc(att.data || '') + '" download="' + esc(att.name || '') + '">📎 ' + esc(att.name || '附件') +
                    '</a> <span class="att-size">' + fmtSize(att.size) + '</span></li>';
            }
            html += '</ul></div>';
        }
        html += '<div class="post-detail-foot">' +
            '<button class="btn btn-ghost btn-sm" onclick="SiteEnhance.likePost(\'' + esc(p.id) + '\')">赞 ' + likes.length + '</button>' +
            (canManagePost(p) ? '<button class="btn btn-danger btn-sm" onclick="SiteEnhance.removePost(\'' + esc(p.id) + '\')">删除帖子</button>' : '') +
            '</div>';
        body.innerHTML = html;
        modal.style.display = 'flex';
        modal.classList.add('modal-in');
    }

    function closePostDetail() {
        var modal = document.getElementById('postDetailModal');
        if (modal) modal.style.display = 'none';
    }

    function bindPostComposer() {
        var form = document.getElementById('postComposer');
        if (!form) { renderPosts(); return; }
        var imgInput = document.getElementById('postImageInput');
        var attInput = document.getElementById('postAttachInput');
        var imgPreview = document.getElementById('postImagePreview');
        var attPreview = document.getElementById('postAttachPreview');
        var submitBtn = document.getElementById('postSubmitBtn');
        var pendingImages = [];
        var pendingAtts = [];

        function refreshPreview() {
            if (imgPreview) {
                imgPreview.innerHTML = pendingImages.map(function (src, i) {
                    return '<span class="preview-thumb"><img src="' + esc(src) + '" alt="配图"><button type="button" data-img="' + i + '" class="preview-del">×</button></span>';
                }).join('');
                imgPreview.querySelectorAll('.preview-del').forEach(function (b) {
                    b.addEventListener('click', function () {
                        pendingImages.splice(Number(this.getAttribute('data-img')), 1);
                        refreshPreview();
                    });
                });
            }
            if (attPreview) {
                attPreview.innerHTML = pendingAtts.map(function (a, i) {
                    return '<span class="preview-att">📎 ' + esc(a.name) + ' <span class="att-size">' + fmtSize(a.size) + '</span>' +
                        '<button type="button" data-att="' + i + '" class="preview-del">×</button></span>';
                }).join('');
                attPreview.querySelectorAll('.preview-del').forEach(function (b) {
                    b.addEventListener('click', function () {
                        pendingAtts.splice(Number(this.getAttribute('data-att')), 1);
                        refreshPreview();
                    });
                });
            }
        }

        if (imgInput) {
            imgInput.addEventListener('change', function () {
                var files = Array.prototype.slice.call(imgInput.files || []);
                if (!files.length) return;
                if (pendingImages.length + files.length > LIMITS.POST_IMG_COUNT) {
                    toast('每篇帖子最多 ' + LIMITS.POST_IMG_COUNT + ' 张图片', 'warning');
                    files = files.slice(0, Math.max(0, LIMITS.POST_IMG_COUNT - pendingImages.length));
                }
                var chain = Promise.resolve();
                files.forEach(function (f) {
                    chain = chain.then(function () {
                        if (f.size > LIMITS.POST_IMG_MAX) {
                            toast(f.name + '：图片超过 1.5MB，已跳过', 'error');
                            return null;
                        }
                        return compressImage(f, 1280, 0.82).then(function (url) {
                            if (url) pendingImages.push(url);
                        });
                    });
                });
                chain.then(function () { refreshPreview(); imgInput.value = ''; });
            });
        }

        if (attInput) {
            attInput.addEventListener('change', function () {
                var files = Array.prototype.slice.call(attInput.files || []);
                if (!files.length) return;
                if (pendingAtts.length + files.length > LIMITS.POST_ATTACH_COUNT) {
                    toast('每篇帖子最多 ' + LIMITS.POST_ATTACH_COUNT + ' 个附件', 'warning');
                    files = files.slice(0, Math.max(0, LIMITS.POST_ATTACH_COUNT - pendingAtts.length));
                }
                var chain = Promise.resolve();
                files.forEach(function (f) {
                    chain = chain.then(function () {
                        if (f.size > LIMITS.POST_ATTACH_MAX) {
                            toast(f.name + '：附件超过 1MB，已跳过', 'error');
                            return null;
                        }
                        return readDataURL(f).then(function (url) {
                            if (url) pendingAtts.push({ name: f.name, size: f.size, type: f.type || '', data: url });
                        });
                    });
                });
                chain.then(function () { refreshPreview(); attInput.value = ''; });
            });
        }

        if (submitBtn) {
            submitBtn.addEventListener('click', function () {
                if (!currentUser()) { toast('请先登录后再发帖', 'warning'); return; }
                var titleEl = document.getElementById('postTitleInput');
                var bodyEl = document.getElementById('postBodyInput');
                var post = createPost({
                    title: titleEl ? titleEl.value : '',
                    content: bodyEl ? bodyEl.value : '',
                    images: pendingImages.slice(),
                    attachments: pendingAtts.slice()
                });
                if (!post) return;
                if (titleEl) titleEl.value = '';
                if (bodyEl) bodyEl.value = '';
                pendingImages = [];
                pendingAtts = [];
                refreshPreview();
                renderPosts();
            });
        }

        var search = document.getElementById('postSearchInput');
        if (search) search.addEventListener('input', renderPosts);
        var mine = document.getElementById('postMineOnly');
        if (mine) mine.addEventListener('change', renderPosts);
        var modal = document.getElementById('postDetailModal');
        if (modal) modal.addEventListener('click', function (e) { if (e.target === modal) closePostDetail(); });

        renderPosts();
    }

    /* ---------------- 管理员模块权限 ---------------- */

    var MODULES = [
        { key: 'dashboard', name: '仪表盘' },
        { key: 'users', name: '用户管理' },
        { key: 'content', name: '内容管理' },
        { key: 'announcements', name: '公告管理' },
        { key: 'files', name: '文件管理' },
        { key: 'posts', name: '帖子管理' },
        { key: 'guestbook', name: '留言管理' },
        { key: 'feedback', name: '反馈管理' },
        { key: 'albums', name: '相册管理' },
        { key: 'polls', name: '投票管理' },
        { key: 'messages', name: '消息通知' },
        { key: 'loginSettings', name: '登录设置' },
        { key: 'settings', name: '系统设置' },
        { key: 'logs', name: '操作日志' },
        { key: 'autoBackup', name: '自动备份' },
        { key: 'adminPerms', name: '管理员权限' }
    ];

    var DEFAULT_ADMIN_MODULES = ['dashboard', 'users', 'content', 'announcements', 'files', 'posts',
        'guestbook', 'feedback', 'albums', 'polls', 'messages', 'autoBackup'];

    var SUPER_ONLY = ['loginSettings', 'settings', 'logs', 'adminPerms'];

    function allModuleKeys() {
        return MODULES.map(function (m) { return m.key; });
    }

    function getPermissions() {
        var v = readJSON(KEY.PERMS, {});
        return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    }

    function savePermissions(obj) {
        dsSet(KEY.PERMS, JSON.stringify(obj || {}));
    }

    function getAllowedModules(username, role) {
        if (role === 'super_admin') return allModuleKeys();
        var perms = getPermissions();
        var item = perms[username];
        if (item && Array.isArray(item.modules)) {
            return item.modules.filter(function (m) { return allModuleKeys().indexOf(m) > -1; });
        }
        return DEFAULT_ADMIN_MODULES.slice();
    }

    function canAccessModule(moduleKey) {
        var u = currentUser();
        if (!u) return false;
        if (u.role === 'super_admin') return true;
        if (u.role !== 'admin') return false;
        return getAllowedModules(u.username, u.role).indexOf(moduleKey) > -1;
    }

    function setAdminModules(username, modules) {
        if (!isSuper()) { toast('仅超级管理员可分配模块权限', 'error'); return false; }
        var perms = getPermissions();
        perms[username] = {
            modules: (modules || []).filter(function (m) { return allModuleKeys().indexOf(m) > -1; }),
            updatedAt: Date.now(),
            updatedBy: currentName()
        };
        savePermissions(perms);
        log('update_admin_perms', '设置管理员 ' + username + ' 的模块权限：' + perms[username].modules.join(','));
        return true;
    }

    function applyAdminPermissions() {
        var u = currentUser();
        if (!u) return;
        var role = u.role || 'user';
        var allowed = getAllowedModules(u.username, role);

        // 仅超管可见的导航项（新增模块 + 系统类模块）
        document.querySelectorAll('.sidebar-nav li').forEach(function (li) {
            var a = li.querySelector('a[data-tab]');
            if (!a) return;
            var tab = a.getAttribute('data-tab');
            var superOnly = li.getAttribute('data-super-only') === '1' || SUPER_ONLY.indexOf(tab) > -1;
            if (role !== 'super_admin' && superOnly) { li.style.display = 'none'; return; }
            if (role === 'admin' && allowed.indexOf(tab) === -1) { li.style.display = 'none'; return; }
            li.style.display = '';
            // 「备份恢复」旧导航与系统设置共用 tab，普通管理员保持原样
        });

        // 抽屉内 tab 链接同步隐藏
        document.querySelectorAll('.drawer-link[data-tab]').forEach(function (a) {
            var tab = a.getAttribute('data-tab');
            var li = a.closest ? a.closest('li') : a.parentElement;
            if (!li) return;
            if (role === 'admin' && allowed.indexOf(tab) === -1) li.style.display = 'none';
            else li.style.display = '';
        });

        // 非超管：直接隐藏超管专属面板
        if (role !== 'super_admin') {
            ['adminPerms'].forEach(function (tab) {
                var panel = document.getElementById('tab-' + tab);
                if (panel) panel.style.display = 'none';
            });
        }

        // 当前激活 tab 无权限时，切到第一个可访问模块
        var active = document.querySelector('.sidebar-nav li.active a[data-tab]');
        var activeTab = active ? active.getAttribute('data-tab') : 'dashboard';
        if (role !== 'super_admin' && allowed.indexOf(activeTab) === -1) {
            var target = allowed.length ? allowed[0] : 'dashboard';
            var link = document.querySelector('.sidebar-nav a[data-tab="' + target + '"]');
            if (link) link.click();
            else {
                document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); p.style.display = 'none'; });
                var panel = document.getElementById('tab-' + target);
                if (panel) { panel.classList.add('active'); panel.style.display = 'block'; }
            }
        }
    }

    function guardModuleClicks() {
        document.addEventListener('click', function (e) {
            var a = e.target && e.target.closest ? e.target.closest('a[data-tab]') : null;
            if (!a) return;
            var tab = a.getAttribute('data-tab');
            if (!tab || tab === 'settings') return; // 备份恢复旧入口与系统设置同名，交给原逻辑
            if (!canAccessModule(tab)) {
                e.preventDefault();
                e.stopPropagation();
                toast('您没有访问该模块的权限，请联系超级管理员', 'error');
            }
        }, true);
    }

    function renderAdminPermsPanel() {
        var box = document.getElementById('adminPermsList');
        if (!box) return;
        if (!isSuper()) {
            box.innerHTML = '<p class="empty-tip">仅超级管理员可管理管理员权限。</p>';
            return;
        }
        var admins = getCleanUsers().filter(function (u) { return u.role === 'admin' || u.role === 'super_admin'; });
        if (!admins.length) {
            box.innerHTML = '<p class="empty-tip">暂无管理员账号。</p>';
            return;
        }
        var perms = getPermissions();
        var html = '<table class="data-table admin-perms-table"><thead><tr><th>管理员</th><th>角色</th><th>可访问模块</th><th>操作</th></tr></thead><tbody>';
        admins.forEach(function (u) {
            var isSuperRow = u.role === 'super_admin';
            var allowed = getAllowedModules(u.username, u.role);
            var cells = MODULES.map(function (m) {
                var checked = isSuperRow || allowed.indexOf(m.key) > -1;
                return '<label class="perm-check"><input type="checkbox" data-user="' + esc(u.username) + '" value="' + m.key + '"' +
                    (checked ? ' checked' : '') + (isSuperRow ? ' disabled' : '') + '> ' + m.name + '</label>';
            }).join('');
            html += '<tr><td><strong>' + esc(u.username) + '</strong><div class="perm-account">账号：' + esc(u.accountId || '未分配') + '</div></td>' +
                '<td>' + (isSuperRow ? '<span class="role-tag role-super">超级管理员</span>' : '<span class="role-tag role-admin">管理员</span>') + '</td>' +
                '<td><div class="perm-grid">' + cells + '</div></td>' +
                '<td>' + (isSuperRow
                    ? '<span class="page-tip">不可修改</span>'
                    : '<button class="btn btn-primary btn-sm" onclick="SiteEnhance.saveAdminPerms(\'' + esc(u.username) + '\')">保存权限</button> ' +
                      '<button class="btn btn-danger btn-sm" onclick="SiteEnhance.removeAdmin(\'' + esc(u.username) + '\')">删除管理员</button>') +
                '</td></tr>';
        });
        html += '</tbody></table>';
        html += '<p class="page-tip">说明：勾选的模块即该管理员登录后台后可访问的功能；未勾选的模块导航会被隐藏且无法进入。新增管理员请使用「用户管理 → 新建管理员」。</p>';
        box.innerHTML = html;
    }

    function saveAdminPermsOf(username) {
        var boxes = document.querySelectorAll('#adminPermsList input[type="checkbox"][data-user="' + username + '"]');
        var modules = [];
        boxes.forEach(function (b) { if (b.checked) modules.push(b.value); });
        if (!modules.length) { toast('请至少勾选一个模块，否则该管理员登录后将无可用功能', 'warning'); return; }
        if (setAdminModules(username, modules)) {
            toast('已保存 ' + username + ' 的模块权限', 'success');
            renderAdminPermsPanel();
        }
    }

    function removeAdmin(username) {
        if (!isSuper()) { toast('仅超级管理员可删除管理员', 'error'); return; }
        var users = getCleanUsers();
        var target = null;
        for (var i = 0; i < users.length; i++) { if (users[i].username === username) { target = users[i]; break; } }
        if (!target) { toast('管理员不存在', 'error'); return; }
        if (target.role === 'super_admin') { toast('不能删除超级管理员', 'error'); return; }
        if (!window.confirm('确定取消「' + username + '」的管理员权限吗？该账号将降级为普通用户，账号与内容保留。')) return;
        target.role = 'user';
        target.roleUpdatedAt = Date.now();
        dsSet(KEY.USERS, JSON.stringify(users));
        var perms = getPermissions();
        if (perms[username]) { delete perms[username]; savePermissions(perms); }
        log('remove_admin', '取消管理员权限：' + username);
        toast('已将该账号降级为普通用户', 'success');
        renderAdminPermsPanel();
        if (typeof window.renderUsersTable === 'function') { try { window.renderUsersTable(); } catch (e) { /* ignore */ } }
    }

    /* ---------------- 自动备份 ---------------- */

    function getBackupConfig() {
        var cfg = readJSON(KEY.BACKUP_CFG, {});
        cfg = (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) ? cfg : {};
        return {
            enabled: cfg.enabled !== false,
            cycle: CYCLE_MS[cfg.cycle] ? cfg.cycle : 'daily',
            keep: Math.max(1, Math.min(30, parseInt(cfg.keep, 10) || 5)),
            lastRun: Number(cfg.lastRun) || 0,
            lastBackupId: cfg.lastBackupId || '',
            updatedAt: cfg.updatedAt || 0
        };
    }

    function saveBackupConfig(cfg) {
        var next = getBackupConfig();
        ['enabled', 'cycle', 'keep', 'lastRun', 'lastBackupId'].forEach(function (k) {
            if (cfg[k] !== undefined) next[k] = cfg[k];
        });
        next.updatedAt = Date.now();
        dsSet(KEY.BACKUP_CFG, JSON.stringify(next));
        return next;
    }

    function getBackupIndex() {
        return readArr(KEY.BACKUP_IDX).filter(function (b) { return b && b.id; });
    }

    function saveBackupIndex(list) { return writeArr(KEY.BACKUP_IDX, list); }

    function collectPrefixData() {
        var out = {};
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (!key) continue;
                for (var p = 0; p < PREFIX_KEYS.length; p++) {
                    if (key.indexOf(PREFIX_KEYS[p]) === 0) { out[key] = localStorage.getItem(key); break; }
                }
            }
        } catch (e) { /* ignore */ }
        return out;
    }

    /**
     * 构建备份数据。
     * @param {boolean} slim true 时省略文件二进制内容（用于云端体积受限场景）
     */
    function buildBackupPayload(slim) {
        var files = getManagedFiles();
        var posts = getPosts();
        var payload = {
            exportedAt: new Date().toISOString(),
            exportedAtText: fmtTime(Date.now()),
            version: 2,
            slim: !!slim,
            users: getCleanUsers(),
            contents: readArr('siteContents'),
            announcements: readArr('announcements'),
            messages: readArr('messages'),
            files: files,
            posts: posts,
            interactions: readArr('contentInteractions'),
            logs: readArr('adminLogs'),
            settings: readJSON('siteSettings', {}),
            loginSettings: readJSON('loginSettings', {}),
            guestbook: readArr('siteGuestbook'),
            feedbacks: readArr('siteFeedbacks'),
            polls: readArr('sitePolls'),
            albums: readArr('siteAlbums'),
            moments: readArr('siteMoments'),
            dailyWord: readJSON('siteDailyWord', null),
            notifications: readArr('siteNotifications'),
            visitLog: readArr('siteVisitLog'),
            chats: readArr('siteChats'),
            permissions: getPermissions(),
            userScopeData: collectPrefixData()
        };
        if (slim) {
            payload.files = files.map(function (f) {
                return { id: f.id, name: f.name, type: f.type, kind: fileKind(f), size: f.size, uploader: f.uploader, uploadedAt: f.uploadedAt, data: '' };
            });
            payload.posts = posts.map(function (p) {
                var copy = {};
                for (var k in p) { if (Object.prototype.hasOwnProperty.call(p, k)) copy[k] = p[k]; }
                copy.images = (Array.isArray(p.images) ? p.images : []).map(function () { return ''; });
                copy.attachments = (Array.isArray(p.attachments) ? p.attachments : []).map(function (a) {
                    return { name: a.name, size: a.size, type: a.type, data: '' };
                });
                return copy;
            });
        }
        return payload;
    }

    function runBackup(trigger) {
        var u = currentUser();
        if (!u || u.role !== 'super_admin') {
            return { ok: false, message: '仅超级管理员可执行站点备份' };
        }
        var payload = buildBackupPayload(false);
        var json = JSON.stringify(payload);
        var slim = false;
        if (json.length > LIMITS.BACKUP_CLOUD_MAX) {
            payload = buildBackupPayload(true);
            json = JSON.stringify(payload);
            slim = true;
        }
        var id = 'bak_' + stampNow();
        // 同一秒内连续备份会产生相同 id，导致后一次覆盖前一次的备份数据键；
        // 这里检查索引与数据键，冲突则追加序号，保证每次备份独立可恢复。
        var existIds = getBackupIndex().map(function (x) { return x && x.id; });
        var seq = 0;
        while (existIds.indexOf(id) > -1 || readJSON(KEY.BACKUP_DATA + id, null) !== null) {
            seq += 1;
            id = 'bak_' + stampNow() + '_' + seq;
        }
        var record = {
            id: id,
            createdAt: Date.now(),
            trigger: trigger || 'manual',
            cycle: getBackupConfig().cycle,
            size: json.length,
            slim: slim,
            counts: {
                users: payload.users.length,
                contents: payload.contents.length,
                posts: payload.posts.length,
                files: payload.files.length,
                guestbook: payload.guestbook.length,
                feedbacks: payload.feedbacks.length,
                messages: payload.messages.length
            },
            operator: u.username
        };
        dsSet(KEY.BACKUP_DATA + id, json);
        var index = getBackupIndex();
        index.unshift(record);
        var keep = getBackupConfig().keep;
        var removed = [];
        while (index.length > keep) {
            var old = index.pop();
            if (old && old.id) { dsRemove(KEY.BACKUP_DATA + old.id); removed.push(old.id); }
        }
        saveBackupIndex(index);
        saveBackupConfig({ lastRun: Date.now(), lastBackupId: id });
        log('auto_backup', '生成站点备份 ' + id + '（' + (trigger === 'auto' ? '自动' : '手动') +
            '，' + fmtSize(json.length) + (slim ? '，已省略文件二进制' : '') + '）');
        return { ok: true, id: id, record: record, removed: removed, slim: slim };
    }

    function checkAutoBackup(force) {
        var cfg = getBackupConfig();
        if (!cfg.enabled && !force) return;
        var u = currentUser();
        if (!u || u.role !== 'super_admin') return;
        var due = force || (Date.now() - (cfg.lastRun || 0) >= CYCLE_MS[cfg.cycle]);
        if (!due) return;
        var res = runBackup(force ? 'manual' : 'auto');
        if (res.ok) {
            toast(force ? '备份完成：' + res.id : '已按计划完成自动备份：' + res.id, 'success');
            if (document.getElementById('backupHistoryBody')) renderBackupPanel();
        }
    }

    function restoreBackup(id) {
        if (!isSuper()) { toast('仅超级管理员可恢复备份', 'error'); return; }
        var raw = dsGet(KEY.BACKUP_DATA + id);
        if (!raw) { toast('备份内容不存在或已被清理', 'error'); return; }
        var data = null;
        try { data = JSON.parse(raw); } catch (e) { toast('备份解析失败', 'error'); return; }
        if (!window.confirm('恢复备份「' + id + '」将覆盖现有用户、内容、帖子、文件、留言等数据，确定继续？')) return;
        dsSet(KEY.USERS, JSON.stringify(data.users || []));
        dsSet('siteContents', JSON.stringify(data.contents || []));
        dsSet('announcements', JSON.stringify(data.announcements || []));
        dsSet('messages', JSON.stringify(data.messages || []));
        dsSet('managedFiles', JSON.stringify(data.files || []));
        dsSet('sitePosts', JSON.stringify(data.posts || []));
        dsSet('contentInteractions', JSON.stringify(data.interactions || []));
        dsSet('adminLogs', JSON.stringify(data.logs || []));
        dsSet('siteSettings', JSON.stringify(data.settings || {}));
        if (data.loginSettings) dsSet('loginSettings', JSON.stringify(data.loginSettings));
        dsSet('siteGuestbook', JSON.stringify(data.guestbook || []));
        dsSet('siteFeedbacks', JSON.stringify(data.feedbacks || []));
        if (data.polls) dsSet('sitePolls', JSON.stringify(data.polls));
        if (data.albums) dsSet('siteAlbums', JSON.stringify(data.albums));
        if (data.moments) dsSet('siteMoments', JSON.stringify(data.moments));
        if (data.notifications) dsSet('siteNotifications', JSON.stringify(data.notifications));
        if (data.visitLog) dsSet('siteVisitLog', JSON.stringify(data.visitLog));
        if (data.chats) dsSet('siteChats', JSON.stringify(data.chats));
        if (data.permissions) dsSet(KEY.PERMS, JSON.stringify(data.permissions));
        if (data.userScopeData) {
            for (var k in data.userScopeData) {
                if (Object.prototype.hasOwnProperty.call(data.userScopeData, k) && data.userScopeData[k] !== null) {
                    try { localStorage.setItem(k, data.userScopeData[k]); } catch (e) { /* ignore */ }
                }
            }
        }
        log('restore_backup', '恢复站点备份：' + id);
        toast('备份恢复完成', 'success');
        setTimeout(function () { window.location.reload(); }, 800);
    }

    function downloadBackup(id) {
        var raw = dsGet(KEY.BACKUP_DATA + id);
        if (!raw) { toast('备份内容不存在或已被清理', 'error'); return; }
        try {
            var blob = new Blob([raw], { type: 'application/json;charset=utf-8;' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = '站点备份_' + id + '.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
            toast('备份文件已开始下载', 'success');
        } catch (e) { toast('下载失败：' + (e.message || '未知错误'), 'error'); }
    }

    function deleteBackup(id) {
        if (!isSuper()) { toast('仅超级管理员可删除备份', 'error'); return; }
        if (!window.confirm('确定删除备份「' + id + '」吗？')) return;
        dsRemove(KEY.BACKUP_DATA + id);
        saveBackupIndex(getBackupIndex().filter(function (b) { return b.id !== id; }));
        log('delete_backup', '删除站点备份：' + id);
        toast('备份已删除', 'success');
        renderBackupPanel();
    }

    function renderBackupPanel() {
        var cfg = getBackupConfig();
        var enableEl = document.getElementById('autoBackupEnabled');
        var cycleEl = document.getElementById('autoBackupCycle');
        var keepEl = document.getElementById('autoBackupKeep');
        if (enableEl) enableEl.checked = !!cfg.enabled;
        if (cycleEl) cycleEl.value = cfg.cycle;
        if (keepEl) keepEl.value = cfg.keep;
        var stateEl = document.getElementById('autoBackupState');
        if (stateEl) {
            stateEl.innerHTML = '当前设置：' + (cfg.enabled ? '已开启' : '已关闭') +
                '，周期「' + (CYCLE_NAME[cfg.cycle] || '每天') + '」，保留最近 ' + cfg.keep + ' 份；' +
                '上次备份：' + (cfg.lastRun ? fmtTime(cfg.lastRun) : '尚未执行');
        }
        var body = document.getElementById('backupHistoryBody');
        if (!body) return;
        if (!isSuper()) {
            body.innerHTML = '<tr><td colspan="6" class="empty-tip">仅超级管理员可查看与操作备份历史。</td></tr>';
            return;
        }
        var list = getBackupIndex();
        if (!list.length) {
            body.innerHTML = '<tr><td colspan="6" class="empty-tip">暂无备份记录。</td></tr>';
            return;
        }
        var html = '';
        list.forEach(function (b) {
            var c = b.counts || {};
            html += '<tr>' +
                '<td><code>' + esc(b.id) + '</code></td>' +
                '<td>' + fmtTime(b.createdAt) + '</td>' +
                '<td>' + (b.trigger === 'auto' ? '自动' : '手动') + '</td>' +
                '<td>' + fmtSize(b.size) + (b.slim ? '<div class="page-tip">已省略文件二进制</div>' : '') + '</td>' +
                '<td class="backup-counts">用户 ' + (c.users || 0) + ' / 内容 ' + (c.contents || 0) +
                ' / 帖子 ' + (c.posts || 0) + ' / 文件 ' + (c.files || 0) + '</td>' +
                '<td>' +
                '<button class="btn btn-ghost btn-sm" onclick="SiteEnhance.downloadBackup(\'' + esc(b.id) + '\')">下载</button> ' +
                '<button class="btn btn-secondary btn-sm" onclick="SiteEnhance.restoreBackup(\'' + esc(b.id) + '\')">恢复</button> ' +
                '<button class="btn btn-danger btn-sm" onclick="SiteEnhance.deleteBackup(\'' + esc(b.id) + '\')">删除</button>' +
                '</td></tr>';
        });
        body.innerHTML = html;
    }

    function bindBackupPanel() {
        var enableEl = document.getElementById('autoBackupEnabled');
        var cycleEl = document.getElementById('autoBackupCycle');
        var keepEl = document.getElementById('autoBackupKeep');
        var saveBtn = document.getElementById('autoBackupSaveBtn');
        var nowBtn = document.getElementById('autoBackupNowBtn');

        function persist() {
            if (!isSuper()) { toast('仅超级管理员可修改备份设置', 'error'); return; }
            saveBackupConfig({
                enabled: !!(enableEl && enableEl.checked),
                cycle: (cycleEl && cycleEl.value) || 'daily',
                keep: parseInt((keepEl && keepEl.value) || 5, 10) || 5
            });
            toast('自动备份设置已保存', 'success');
            log('update_backup_config', '更新自动备份设置');
            renderBackupPanel();
        }
        if (saveBtn) saveBtn.addEventListener('click', persist);
        if (nowBtn) nowBtn.addEventListener('click', function () {
            var res = runBackup('manual');
            if (!res.ok) { toast(res.message, 'error'); return; }
            toast('备份完成：' + res.id + (res.slim ? '（已省略文件二进制）' : ''), 'success');
            renderBackupPanel();
        });
        renderBackupPanel();
    }

    /* ---------------- 后台：帖子管理 ---------------- */

    function renderPostsAdmin() {
        var body = document.getElementById('adminPostsBody');
        if (!body) return;
        var kw = ((document.getElementById('adminPostSearch') || {}).value || '').trim().toLowerCase();
        var list = getPosts().filter(function (p) {
            if (!kw) return true;
            return String(p.title || '').toLowerCase().indexOf(kw) > -1 ||
                String(p.author || '').toLowerCase().indexOf(kw) > -1;
        }).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });

        var cnt = document.getElementById('adminPostCount');
        if (cnt) cnt.textContent = '共 ' + list.length + ' 篇帖子';

        if (!list.length) {
            body.innerHTML = '<tr><td colspan="6" class="empty-tip">暂无帖子。</td></tr>';
            return;
        }
        var html = '';
        list.forEach(function (p) {
            var imgs = Array.isArray(p.images) ? p.images.length : 0;
            var atts = Array.isArray(p.attachments) ? p.attachments.length : 0;
            html += '<tr>' +
                '<td>' + (p.pinned ? '<span class="post-pin-tag">置顶</span>' : '') + esc(p.title) + '</td>' +
                '<td>' + esc(p.author || '-') + '</td>' +
                '<td>' + fmtTime(p.createdAt) + '</td>' +
                '<td>' + imgs + ' 图 / ' + atts + ' 附件</td>' +
                '<td>' + esc(String(p.content || '').slice(0, 40)) + (charLen(p.content) > 40 ? '…' : '') + '</td>' +
                '<td>' +
                '<button class="btn btn-ghost btn-sm" onclick="SiteEnhance.openPost(\'' + esc(p.id) + '\',\'admin.html\')">查看</button> ' +
                '<button class="btn btn-secondary btn-sm" onclick="SiteEnhance.pinPost(\'' + esc(p.id) + '\')">' + (p.pinned ? '取消置顶' : '置顶') + '</button> ' +
                '<button class="btn btn-danger btn-sm" onclick="SiteEnhance.removePost(\'' + esc(p.id) + '\',true)">删除</button>' +
                '</td></tr>';
        });
        body.innerHTML = html;
    }

    /* ---------------- 页面初始化 ---------------- */

    function initPostPage() {
        bindPostComposer();
    }

    function initFilesPage() {
        bindFileCenter();
    }

    function initAdminEnhance() {
        guardModuleClicks();
        applyAdminPermissions();
        renderPostsAdmin();
        var search = document.getElementById('adminPostSearch');
        if (search) search.addEventListener('input', renderPostsAdmin);
        var permsNav = document.querySelector('.sidebar-nav a[data-tab="adminPerms"]');
        if (permsNav) permsNav.addEventListener('click', function () { setTimeout(renderAdminPermsPanel, 30); });
        var backupNav = document.querySelector('.sidebar-nav a[data-tab="autoBackup"]');
        if (backupNav) backupNav.addEventListener('click', function () { setTimeout(renderBackupPanel, 30); });
        var postsNav = document.querySelector('.sidebar-nav a[data-tab="posts"]');
        if (postsNav) postsNav.addEventListener('click', function () { setTimeout(renderPostsAdmin, 30); });
        renderAdminPermsPanel();
        bindBackupPanel();
    }

    function autoSyncAfterReady() {
        // initAdminPage 在 DOMContentLoaded 之后执行，权限应用需排在其后
        setTimeout(function () {
            if (document.getElementById('tab-adminPerms')) initAdminEnhance();
            else if (document.getElementById('postList')) initPostPage();
            else if (document.getElementById('fileList')) initFilesPage();
            // 账号复制按钮（个人信息页/首页）
            document.querySelectorAll('[data-copy-account]').forEach(function (btn) {
                if (btn.getAttribute('data-bound') === '1') return;
                btn.setAttribute('data-bound', '1');
                btn.addEventListener('click', function () {
                    copyAccountOf(btn.getAttribute('data-copy-account') || '');
                });
            });
            // 用户名长度校验（注册页 / 新建管理员弹窗）：实时红框提示，提交另由 auth.js 拦截
            ['regUsername', 'adminUsername'].forEach(function (id) {
                var el = document.getElementById(id);
                if (!el || el.getAttribute('data-len-bound') === '1') return;
                el.setAttribute('data-len-bound', '1');
                bindUsernameLength(el);
            });
            // 超级管理员：自动备份到期检查（仅在后台打开时触发）
            if (document.getElementById('tab-autoBackup')) {
                try { checkAutoBackup(false); } catch (e) { /* ignore */ }
            }
        }, 60);
    }

    /* ---------------- 对外接口 ---------------- */

    var API = {
        limits: LIMITS,
        modules: MODULES,
        charLen: charLen,
        checkUsernameLength: checkUsernameLength,
        usernameTooLong: usernameTooLong,
        bindUsernameLength: bindUsernameLength,
        copyAccount: function (v) { return copyText(v); },
        copyCurrentAccount: function () { copyAccountOf(); },
        // 文件
        uploadFiles: uploadFiles,
        downloadFile: downloadFileById,
        removeFile: function (id) {
            if (deleteFileById(id)) renderFileList();
        },
        getFiles: getManagedFiles,
        renderFiles: renderFileList,
        fmtSize: fmtSize,
        fmtTime: fmtTime,
        // 帖子
        publishPost: createPost,
        removePost: function (id, fromAdmin) {
            if (!deletePostById(id)) return;
            if (fromAdmin) renderPostsAdmin(); else renderPosts();
        },
        likePost: togglePostLike,
        pinPost: togglePinPost,
        openPost: openPostDetail,
        closePost: closePostDetail,
        getPosts: getPosts,
        // 管理员权限
        getPermissions: getPermissions,
        getAllowedModules: getAllowedModules,
        saveAdminPerms: saveAdminPermsOf,
        removeAdmin: removeAdmin,
        renderAdminPerms: renderAdminPermsPanel,
        // 备份
        getBackupConfig: getBackupConfig,
        saveBackupConfig: function (cfg) { saveBackupConfig(cfg); renderBackupPanel(); },
        runBackup: runBackup,
        checkAutoBackup: checkAutoBackup,
        restoreBackup: restoreBackup,
        downloadBackup: downloadBackup,
        deleteBackup: deleteBackup,
        renderBackupPanel: renderBackupPanel,
        config: KEY
    };

    window.SiteEnhance = API;
    window.USERNAME_MAX_LEN = 6;
    window.usernameCharLen = charLen;
    window.usernameTooLong = usernameTooLong;
    window.checkUsernameLength = checkUsernameLength;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoSyncAfterReady);
    } else {
        autoSyncAfterReady();
    }
})();
