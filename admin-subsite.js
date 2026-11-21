/* admin-subsite.js —— 后台「附属站点」管理面板（超管专属）。仅包含附属站配置读写与成员同步，不含其它运维模块。 */
(function () {
    'use strict';
    var API_DATA = '/api/data';
    var K_SUB = 'siteSubsiteConfig';

    function token() {
            try { return localStorage.getItem('siteAuthToken') || ''; } catch (e) { return ''; }
        }

    function headers() {
            var h = { 'Content-Type': 'application/json' };
            var t = token();
            if (t) { h['x-site-token'] = t; }
            return h;
        }

    function pad(n) { return n < 10 ? '0' + n : '' + n; }

    function fmtTime(ts) {
            if (!ts) { return '—'; }
            var d = new Date(ts);
            return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
                pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
        }

    function esc(s) {
            return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
            });
        }

    function store() { return window.dataStore || null; }

    function dsGet(key) {
            var s = store();
            if (s && typeof s.get === 'function') {
                try { return s.get(key); } catch (e) { /* fallthrough */ }
            }
            try { return localStorage.getItem(key); } catch (e) { return null; }
        }

    function dsSet(key, value) {
            var s = store();
            if (s && typeof s.set === 'function') {
                try { return s.set(key, value); } catch (e) { /* fallthrough */ }
            }
            try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
            return null;
        }

    function apiGet(key) {
            var started = Date.now();
            return fetch(API_DATA + '?key=' + encodeURIComponent(key), {
                method: 'GET',
                headers: headers(),
                cache: 'no-store'
            }).then(function (r) {
                return r.text().then(function (text) {
                    var body = null;
                    try { body = JSON.parse(text); } catch (e) { body = null; }
                    return { status: r.status, ok: r.ok, body: body, ms: Date.now() - started };
                });
            }).catch(function (e) {
                return { status: 0, ok: false, body: null, ms: Date.now() - started, error: String(e && e.message || e) };
            });
        }

    function tip(msg, type) {
            if (typeof window.toast === 'function') { window.toast(msg, type || 'info'); }
        }

    function el(id) { return document.getElementById(id); }

    function subDefaults() {
            return {
                enabled: true,
                name: '附属站点',
                subtitle: '与主站成员信息同步',
                intro: '这里是主站的小型附属站点，成员名录、公告与留言均实时同步自主站，无需另行注册账号。',
                accent: '#2f6fed',
                notice: '',
                modules: { members: true, notices: true, guestbook: true }
            };
        }
    
        function readSubConfig() {
            var cfg = null;
            try { cfg = JSON.parse(dsGet(K_SUB) || 'null'); } catch (e) { cfg = null; }
            var d = subDefaults();
            var c = (cfg && typeof cfg === 'object') ? cfg : {};
            var m = (c.modules && typeof c.modules === 'object') ? c.modules : {};
            return {
                enabled: c.enabled === false ? false : d.enabled,
                name: c.name || d.name,
                subtitle: c.subtitle || d.subtitle,
                intro: c.intro || d.intro,
                accent: c.accent || d.accent,
                notice: c.notice || '',
                modules: {
                    members: m.members === false ? false : true,
                    notices: m.notices === false ? false : true,
                    guestbook: m.guestbook === false ? false : true
                }
            };
        }
    
        function el(id) { return document.getElementById(id); }
    
        function fillSubForm(cfg) {
            if (!el('subName')) { return; }
            el('subEnabled').checked = cfg.enabled !== false;
            el('subName').value = cfg.name;
            el('subSubtitle').value = cfg.subtitle;
            el('subIntro').value = cfg.intro;
            el('subAccent').value = cfg.accent;
            el('subNotice').value = cfg.notice || '';
            el('subModuleMembers').checked = cfg.modules.members;
            el('subModuleNotices').checked = cfg.modules.notices;
            el('subModuleGuestbook').checked = cfg.modules.guestbook;
        }
    
        function collectSubForm() {
            var accent = String(el('subAccent').value || '').trim();
            if (!/^#[0-9a-fA-F]{6}$/.test(accent)) { accent = '#2f6fed'; }
            return {
                enabled: !!el('subEnabled').checked,
                name: String(el('subName').value || '').trim() || '附属站点',
                subtitle: String(el('subSubtitle').value || '').trim() || '与主站成员信息同步',
                intro: String(el('subIntro').value || '').trim(),
                accent: accent,
                notice: String(el('subNotice').value || '').trim(),
                modules: {
                    members: !!el('subModuleMembers').checked,
                    notices: !!el('subModuleNotices').checked,
                    guestbook: !!el('subModuleGuestbook').checked
                },
                updatedAt: new Date().toISOString(),
                updatedBy: (function () {
                    try {
                        var u = JSON.parse(localStorage.getItem('currentUser') || 'null');
                        return u && u.username ? u.username : '';
                    } catch (e) { return ''; }
                })()
            };
        }
    
        function saveSubConfig() {
            var cfg = collectSubForm();
            var state = el('subSaveState');
            if (state) { state.textContent = '正在保存到云端…'; }
            return fetch(API_DATA, {
                method: 'POST',
                headers: Object.assign({ 'Content-Type': 'application/json' }, headers()),
                body: JSON.stringify({ key: K_SUB, value: cfg })
            }).then(function (r) {
                return r.json().catch(function () { return { ok: false }; });
            }).then(function (j) {
                if (!j || !j.ok) {
                    if (state) { state.textContent = '保存失败：' + ((j && j.error) || '云端拒绝或未登录'); }
                    tip('附属站点配置保存失败', 'error');
                    return j;
                }
                try { dsSet(K_SUB, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
                if (state) { state.textContent = '已保存 · ' + fmtTime(cfg.updatedAt) + ' · 附属站下次访问即刻生效'; }
                tip('附属站点配置已保存', 'success');
                return j;
            }).catch(function (err) {
                if (state) { state.textContent = '保存失败：' + String((err && err.message) || err); }
                tip('附属站点配置保存失败', 'error');
            });
        }
    
        function renderSubMembers(list) {
            var body = el('subMemberBody');
            var state = el('subMemberState');
            var arr = Array.isArray(list) ? list : [];
            var superN = arr.filter(function (u) { return u.role === 'super_admin'; }).length;
            var adminN = arr.filter(function (u) { return u.role === 'admin'; }).length;
            var normalN = arr.length - superN - adminN;
    
            if (el('subStatTotal')) { el('subStatTotal').textContent = String(arr.length); }
            if (el('subStatAdmin')) { el('subStatAdmin').textContent = String(adminN + superN); }
            if (el('subStatNormal')) { el('subStatNormal').textContent = String(normalN); }
    
            if (state) {
                state.textContent = arr.length
                    ? '已同步主站成员 ' + arr.length + ' 位（超级管理员 ' + superN + ' · 管理员 ' + adminN + ' · 成员 ' + normalN + '）'
                    : '主站暂无成员数据，附属站将显示空名录。';
            }
            if (!body) { return; }
            if (!arr.length) {
                body.innerHTML = '<tr><td colspan="5" class="empty-tip">暂无成员数据</td></tr>';
                return;
            }
            var rows = arr.slice().sort(function (a, b) {
                var rank = { super_admin: 0, admin: 1 };
                var ra = rank[a.role] === undefined ? 2 : rank[a.role];
                var rb = rank[b.role] === undefined ? 2 : rank[b.role];
                if (ra !== rb) { return ra - rb; }
                return String(a.username).localeCompare(String(b.username));
            }).slice(0, 50);
            body.innerHTML = rows.map(function (u) {
                var roleText = u.role === 'super_admin' ? '超级管理员' : (u.role === 'admin' ? '管理员' : '普通成员');
                return '<tr>' +
                    '<td>' + esc(u.accountId || '—') + '</td>' +
                    '<td>' + esc(u.username || '—') + '</td>' +
                    '<td>' + esc(u.nickname || '—') + '</td>' +
                    '<td>' + esc(roleText) + '</td>' +
                    '<td>' + (u.createdAt ? esc(String(u.createdAt).slice(0, 10)) : '—') + '</td>' +
                    '</tr>';
            }).join('');
        }
    
        function refreshSubMembers() {
            if (!el('subMemberState')) { return; }
            el('subMemberState').textContent = '正在同步主站成员…';
            apiGet('users').then(function (r) {
                if (!r || !r.ok) {
                    var local = [];
                    try { local = JSON.parse(dsGet('users') || '[]'); } catch (e) { local = []; }
                    renderSubMembers(local);
                    if (el('subMemberState')) {
                        el('subMemberState').textContent = '云端成员接口不可用（HTTP ' + ((r && r.status) || '—') + '），' +
                            '当前展示本地缓存 ' + (Array.isArray(local) ? local.length : 0) + ' 位成员。';
                    }
                    return;
                }
                // apiGet 返回 { status, ok, body }，成员表在 body.value 里
                var list = r && r.body && Array.isArray(r.body.value) ? r.body.value : null;
                if (list) {
                    renderSubMembers(list);
                    return;
                }
                var cached = [];
                try { cached = JSON.parse(dsGet('users') || '[]'); } catch (e) { cached = []; }
                renderSubMembers(Array.isArray(cached) ? cached : []);
                if (el('subMemberState')) {
                    el('subMemberState').textContent = '云端返回格式异常，当前展示本地缓存 ' +
                        (Array.isArray(cached) ? cached.length : 0) + ' 位成员。';
                }
            });
        }
    
        function subUrl() {
            try {
                var u = new URL('../sub/', location.href);
                return u.href;
            } catch (e) { return 'sub/'; }
        }
    
        function initSubsite() {
            if (!el('subName')) { return; }
            fillSubForm(readSubConfig());
            if (el('subUrlText')) { el('subUrlText').textContent = subUrl(); }
    
            var btnSave = el('btnSubSave');
            if (btnSave) { btnSave.addEventListener('click', function () { saveSubConfig(); }); }
    
            var btnReload = el('btnSubReload');
            if (btnReload) {
                btnReload.addEventListener('click', function () {
                    fillSubForm(readSubConfig());
                    if (el('subSaveState')) { el('subSaveState').textContent = '已重新载入云端配置。'; }
                    refreshSubMembers();
                });
            }
    
            var btnRefresh = el('btnSubRefreshMembers');
            if (btnRefresh) { btnRefresh.addEventListener('click', refreshSubMembers); }
    
            var btnOpen = el('btnSubOpen');
            if (btnOpen) { btnOpen.addEventListener('click', function () { window.open(subUrl(), '_blank', 'noopener'); }); }
    
            var btnCopy = el('btnSubCopy');
            if (btnCopy) {
                btnCopy.addEventListener('click', function () {
                    var link = subUrl();
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(link).then(function () { tip('附属站链接已复制', 'success'); })
                            .catch(function () { tip('复制失败，请手动选择链接', 'error'); });
                    } else {
                        tip('当前浏览器不支持自动复制：' + link, 'info');
                    }
                });
            }
    
            // 打开面板时先显示本地配置，再以云端配置覆盖，避免多端改了看不到
            apiGet(K_SUB).then(function (r) {
                var cfg = r && r.body ? r.body.value : null;
                if (cfg && typeof cfg === 'object') { fillSubForm(cfg); }
            }).catch(function () { /* 忽略：保持本地值 */ });
    
            refreshSubMembers();
        }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSubsite);
    } else {
        initSubsite();
    }
})();
