/* admin-kb.js —— 后台「学科知识库」管理面板（超管专属）
 * 管理两个云端键：
 *   siteKbConfig —— /kb/ 站点配置（启用、名称、副标题、简介、主题色、公告、学科列表）
 *   kbEntries    —— 知识条目数组（前台匿名可读，写入仅超级管理员）
 */
(function () {
    'use strict';

    var API_DATA = '/api/data';
    var K_CONFIG = 'siteKbConfig';
    var K_ENTRIES = 'kbEntries';
    var DEFAULT_SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物'];

    var state = {
        cfg: null,
        entries: [],
        currentId: '',
        loaded: false,
        loading: false
    };

    function token() {
        try { return localStorage.getItem('siteAuthToken') || ''; } catch (e) { return ''; }
    }

    function headers() {
        var h = { 'Content-Type': 'application/json' };
        var t = token();
        if (t) { h['x-site-token'] = t; }
        return h;
    }

    function el(id) { return document.getElementById(id); }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function pad(n) { return n < 10 ? '0' + n : '' + n; }

    function fmtTime(ts) {
        if (!ts) { return '—'; }
        var d = new Date(ts);
        if (isNaN(d.getTime())) { return String(ts); }
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
            pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function tip(msg, type) {
        if (typeof window.toast === 'function') { window.toast(msg, type || 'info'); }
    }

    function store() { return window.dataStore || null; }

    function dsSet(key, value) {
        var s = store();
        if (s && typeof s.set === 'function') {
            try { s.set(key, value); return; } catch (e) { /* fallthrough */ }
        }
        try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
    }

    function currentName() {
        try {
            var u = JSON.parse(localStorage.getItem('currentUser') || 'null');
            return u && (u.username || u.nickname) ? (u.username || u.nickname) : '';
        } catch (e) { return ''; }
    }

    function apiGet(key) {
        return fetch(API_DATA + '?key=' + encodeURIComponent(key), {
            method: 'GET',
            headers: headers(),
            cache: 'no-store'
        }).then(function (r) {
            return r.text().then(function (text) {
                var body = null;
                try { body = JSON.parse(text); } catch (e) { body = null; }
                return { ok: r.ok, status: r.status, body: body };
            });
        }).catch(function () {
            return { ok: false, status: 0, body: null };
        });
    }

    function apiSave(key, value) {
        return fetch(API_DATA, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ key: key, value: value })
        }).then(function (r) {
            return r.json().catch(function () { return { ok: false }; });
        });
    }

    function cfgDefaults() {
        return {
            enabled: true,
            name: '学科知识库',
            subtitle: '按学科整理知识点 · 公式 · 易错点',
            intro: '这里是主站的第二个附属站点，用于沉淀各学科知识点、公式与解题模型。条目由超级管理员在后台维护，前台无需登录即可浏览。',
            accent: '#0d9488',
            notice: '',
            subjects: DEFAULT_SUBJECTS.slice()
        };
    }

    function normalizeCfg(raw) {
        var d = cfgDefaults();
        var c = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
        return {
            enabled: c.enabled !== false,
            name: c.name || d.name,
            subtitle: c.subtitle || d.subtitle,
            intro: c.intro || d.intro,
            accent: /^#[0-9a-fA-F]{6}$/.test(String(c.accent || '')) ? c.accent : d.accent,
            notice: String(c.notice || ''),
            subjects: (Array.isArray(c.subjects) && c.subjects.length) ? c.subjects.filter(Boolean).map(String) : d.subjects.slice(),
            updatedAt: c.updatedAt || '',
            updatedBy: c.updatedBy || ''
        };
    }

    function tagList(tags) {
        if (!tags) { return []; }
        if (Array.isArray(tags)) { return tags.filter(Boolean).map(String); }
        return String(tags).split(/[,，;；\s]+/).filter(Boolean);
    }

    function normalizeEntries(list) {
        if (!Array.isArray(list)) { return []; }
        return list.filter(function (e) { return e && (e.title || e.name); }).map(function (e, i) {
            return {
                id: String(e.id || ('kb-' + i)),
                subject: String(e.subject || e.category || '综合'),
                title: String(e.title || e.name || '未命名条目'),
                tags: tagList(e.tags).join(','),
                summary: String(e.summary || e.desc || ''),
                body: String(e.body || e.content || ''),
                createdAt: e.createdAt || e.updatedAt || '',
                updatedAt: e.updatedAt || e.createdAt || '',
                author: String(e.author || '')
            };
        });
    }

    function newId() {
        return 'kb-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    }

    /* ---------- 渲染 ---------- */

    function renderConfig() {
        var c = state.cfg || cfgDefaults();
        if (el('kbEnabled')) { el('kbEnabled').checked = c.enabled !== false; }
        if (el('kbName')) { el('kbName').value = c.name; }
        if (el('kbSubtitle')) { el('kbSubtitle').value = c.subtitle; }
        if (el('kbAccent')) { el('kbAccent').value = c.accent; }
        if (el('kbNotice')) { el('kbNotice').value = c.notice; }
        if (el('kbIntro')) { el('kbIntro').value = c.intro; }
        if (el('kbSubjects')) { el('kbSubjects').value = (c.subjects || []).join(','); }
        if (el('kbUrlText')) {
            var base = location.origin + location.pathname.replace(/[^/]*$/, '');
            el('kbUrlText').textContent = base + 'kb/';
        }
        if (el('kbSaveState')) {
            el('kbSaveState').textContent = c.updatedAt
                ? ('最近保存 · ' + fmtTime(c.updatedAt) + (c.updatedBy ? ' · ' + c.updatedBy : ''))
                : '尚未保存';
        }
        renderSubjectSelect();
    }

    function renderSubjectSelect() {
        var sel = el('kbEntrySubject');
        if (!sel) { return; }
        var subjects = (state.cfg && state.cfg.subjects && state.cfg.subjects.length)
            ? state.cfg.subjects : DEFAULT_SUBJECTS;
        var keep = sel.value;
        sel.innerHTML = subjects.map(function (s) {
            return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
        }).join('');
        if (keep && subjects.indexOf(keep) > -1) { sel.value = keep; }
    }

    function renderEntries() {
        var body = el('kbEntryList');
        var list = state.entries.slice().sort(function (a, b) {
            return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
        });
        renderStats();
        if (!body) { return; }
        if (!list.length) {
            body.innerHTML = '<tr><td colspan="5" class="empty-tip">云端暂无条目（此状态下前台 /kb/ 会展示内置示例数据）。请在上方填写学科、标题与正文后保存</td></tr>';
            return;
        }
        body.innerHTML = list.map(function (e) {
            return '<tr data-id="' + esc(e.id) + '">' +
                '<td>' + esc(e.subject) + '</td>' +
                '<td>' + esc(e.title) + '</td>' +
                '<td>' + esc(e.tags || '—') + '</td>' +
                '<td>' + esc(fmtTime(e.updatedAt)) + '</td>' +
                '<td class="kb-row-actions">' +
                '<button type="button" class="btn btn-ghost btn-sm" data-act="edit">编辑</button>' +
                '<button type="button" class="btn btn-danger btn-sm" data-act="del">删除</button>' +
                '</td></tr>';
        }).join('');
    }

    function renderStats() {
        var n = state.entries.length;
        var subs = {};
        state.entries.forEach(function (e) { subs[e.subject] = 1; });
        var latest = '';
        state.entries.forEach(function (e) {
            var t = e.updatedAt || e.createdAt || '';
            if (t && String(t) > String(latest)) { latest = t; }
        });
        if (el('kbStatEntries')) { el('kbStatEntries').textContent = String(n); }
        if (el('kbStatSubjects')) { el('kbStatSubjects').textContent = String(Object.keys(subs).length); }
        if (el('kbStatLatest')) { el('kbStatLatest').textContent = latest ? fmtTime(latest) : '—'; }
    }

    function fillEntry(e) {
        if (!e) { return; }
        state.currentId = e.id;
        if (el('kbEntrySubject')) {
            var sel = el('kbEntrySubject');
            if (!Array.prototype.some.call(sel.options, function (o) { return o.value === e.subject; })) {
                var opt = document.createElement('option');
                opt.value = e.subject;
                opt.textContent = e.subject;
                sel.appendChild(opt);
            }
            sel.value = e.subject;
        }
        if (el('kbEntryTitle')) { el('kbEntryTitle').value = e.title; }
        if (el('kbEntryTags')) { el('kbEntryTags').value = e.tags || ''; }
        if (el('kbEntrySummary')) { el('kbEntrySummary').value = e.summary || ''; }
        if (el('kbEntryContent')) { el('kbEntryContent').value = e.body || ''; }
        if (el('kbEntryState')) {
            el('kbEntryState').textContent = '正在编辑：' + e.title + ' · 更新于 ' + fmtTime(e.updatedAt);
        }
    }

    function clearEntryForm() {
        state.currentId = '';
        if (el('kbEntryTitle')) { el('kbEntryTitle').value = ''; }
        if (el('kbEntryTags')) { el('kbEntryTags').value = ''; }
        if (el('kbEntrySummary')) { el('kbEntrySummary').value = ''; }
        if (el('kbEntryContent')) { el('kbEntryContent').value = ''; }
        if (el('kbEntryState')) { el('kbEntryState').textContent = '新建条目：填写后可另起一条'; }
    }

    /* ---------- 收集 ---------- */

    function collectCfg() {
        var subjectsRaw = el('kbSubjects') ? el('kbSubjects').value : '';
        var subjects = String(subjectsRaw).split(/[,，;；\s]+/).filter(Boolean);
        return {
            enabled: el('kbEnabled') ? !!el('kbEnabled').checked : true,
            name: el('kbName') ? String(el('kbName').value || '').trim() || '学科知识库' : '学科知识库',
            subtitle: el('kbSubtitle') ? String(el('kbSubtitle').value || '').trim() : '',
            intro: el('kbIntro') ? String(el('kbIntro').value || '').trim() : '',
            accent: el('kbAccent') ? String(el('kbAccent').value || '#0d9488') : '#0d9488',
            notice: el('kbNotice') ? String(el('kbNotice').value || '').trim() : '',
            subjects: subjects.length ? subjects : DEFAULT_SUBJECTS.slice(),
            updatedAt: new Date().toISOString(),
            updatedBy: currentName()
        };
    }

    function collectEntry() {
        var subject = el('kbEntrySubject') ? String(el('kbEntrySubject').value || '') : '';
        var title = el('kbEntryTitle') ? String(el('kbEntryTitle').value || '').trim() : '';
        var body = el('kbEntryContent') ? String(el('kbEntryContent').value || '').trim() : '';
        return {
            id: state.currentId || newId(),
            subject: subject || '综合',
            title: title,
            tags: el('kbEntryTags') ? String(el('kbEntryTags').value || '').trim() : '',
            summary: el('kbEntrySummary') ? String(el('kbEntrySummary').value || '').trim() : '',
            body: body,
            updatedAt: new Date().toISOString(),
            author: currentName()
        };
    }

    /* ---------- 保存 ---------- */

    function saveConfig() {
        var cfg = collectCfg();
        var s = el('kbSaveState');
        if (s) { s.textContent = '正在保存到云端…'; }
        return apiSave(K_CONFIG, cfg).then(function (j) {
            if (!j || !j.ok) {
                if (s) { s.textContent = '保存失败：' + ((j && j.error) || '云端拒绝或未登录'); }
                tip('知识库配置保存失败', 'error');
                return j;
            }
            state.cfg = cfg;
            dsSet(K_CONFIG, JSON.stringify(cfg));
            if (s) { s.textContent = '已保存 · ' + fmtTime(cfg.updatedAt) + ' · 前台下次访问即刻生效'; }
            tip('知识库配置已保存', 'success');
            renderSubjectSelect();
            return j;
        }).catch(function (err) {
            if (s) { s.textContent = '保存失败：' + String((err && err.message) || err); }
            tip('知识库配置保存失败', 'error');
        });
    }

    function persistEntries(list, okMsg) {
        return apiSave(K_ENTRIES, list).then(function (j) {
            if (!j || !j.ok) {
                tip('知识条目保存失败：' + ((j && j.error) || '云端拒绝或未登录'), 'error');
                return j;
            }
            state.entries = normalizeEntries(list);
            dsSet(K_ENTRIES, JSON.stringify(state.entries));
            renderEntries();
            tip(okMsg || '知识条目已保存', 'success');
            return j;
        }).catch(function (err) {
            tip('知识条目保存失败：' + String((err && err.message) || err), 'error');
        });
    }

    function saveEntry() {
        var e = collectEntry();
        if (!e.title) { tip('请先填写条目标题', 'error'); if (el('kbEntryTitle')) { el('kbEntryTitle').focus(); } return; }
        if (!e.body && !e.summary) { tip('请填写摘要或正文', 'error'); return; }

        var list = state.entries.slice();
        var idx = -1;
        for (var i = 0; i < list.length; i++) { if (list[i].id === e.id) { idx = i; break; } }
        var isNew = idx < 0;
        if (isNew) {
            e.createdAt = e.updatedAt;
            list.unshift(e);
        } else {
            e.createdAt = list[idx].createdAt || e.updatedAt;
            list[idx] = e;
        }
        if (el('kbEntryState')) { el('kbEntryState').textContent = '正在保存条目…'; }
        return persistEntries(list, isNew ? '条目已新增' : '条目已更新').then(function (j) {
            if (j && j.ok) {
                state.currentId = e.id;
                if (el('kbEntryState')) {
                    el('kbEntryState').textContent = '已保存：' + e.title + ' · ' + fmtTime(e.updatedAt);
                }
            }
        });
    }

    function deleteEntry(id) {
        var target = null;
        state.entries.forEach(function (e) { if (e.id === id) { target = e; } });
        if (!target) { return; }
        if (!window.confirm('确认删除条目「' + target.title + '」？删除后前台立即不再显示。')) { return; }
        var list = state.entries.filter(function (e) { return e.id !== id; });
        persistEntries(list, '条目已删除').then(function (j) {
            if (j && j.ok && state.currentId === id) { clearEntryForm(); }
        });
    }

    /* ---------- 载入 ---------- */

    function loadAll() {
        if (state.loading) { return; }
        state.loading = true;
        var cfgP = apiGet(K_CONFIG);
        var entP = apiGet(K_ENTRIES);
        Promise.all([cfgP, entP]).then(function (res) {
            state.loading = false;
            state.loaded = true;
            var cfgBody = res[0] && res[0].body;
            var entBody = res[1] && res[1].body;
            var rawCfg = (cfgBody && typeof cfgBody === 'object' && cfgBody.value !== undefined) ? cfgBody.value : cfgBody;
            var rawEnt = (entBody && typeof entBody === 'object' && entBody.value !== undefined) ? entBody.value : entBody;
            if (typeof rawCfg === 'string') { try { rawCfg = JSON.parse(rawCfg); } catch (e) { rawCfg = null; } }
            if (typeof rawEnt === 'string') { try { rawEnt = JSON.parse(rawEnt); } catch (e) { rawEnt = null; } }

            state.cfg = normalizeCfg(rawCfg);
            state.entries = normalizeEntries(rawEnt);
            renderConfig();
            renderEntries();
            if (state.entries.length) {
                if (el('kbEntryState')) { el('kbEntryState').textContent = '共 ' + state.entries.length + ' 条，点击列表「编辑」载入'; }
            } else {
                clearEntryForm();
            }
        }).catch(function () {
            state.loading = false;
            renderConfig();
            renderEntries();
            tip('知识库数据读取失败，请检查登录状态', 'error');
        });
    }

    /* ---------- 事件 ---------- */

    function bind() {
        if (el('btnKbSave')) { el('btnKbSave').addEventListener('click', saveConfig); }
        if (el('btnKbReload')) {
            el('btnKbReload').addEventListener('click', function () {
                if (el('kbSaveState')) { el('kbSaveState').textContent = '正在重新载入…'; }
                loadAll();
                tip('已重新载入', 'info');
            });
        }
        if (el('btnKbOpen')) {
            el('btnKbOpen').addEventListener('click', function () {
                window.open('kb/', '_blank');
            });
        }
        if (el('btnKbCopy')) {
            el('btnKbCopy').addEventListener('click', function () {
                var text = el('kbUrlText') ? el('kbUrlText').textContent : (location.origin + '/kb/');
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(function () { tip('链接已复制：' + text, 'success'); })
                        .catch(function () { tip(text, 'info'); });
                } else {
                    tip(text, 'info');
                }
            });
        }
        if (el('btnKbEntrySave')) { el('btnKbEntrySave').addEventListener('click', saveEntry); }
        if (el('btnKbEntryNew')) {
            el('btnKbEntryNew').addEventListener('click', function () {
                clearEntryForm();
                if (el('kbEntryTitle')) { el('kbEntryTitle').focus(); }
            });
        }
        if (el('btnKbEntryDelete')) {
            el('btnKbEntryDelete').addEventListener('click', function () {
                if (!state.currentId) { tip('请先从列表中选择要删除的条目', 'error'); return; }
                deleteEntry(state.currentId);
            });
        }
        var tbody = el('kbEntryList');
        if (tbody) {
            tbody.addEventListener('click', function (ev) {
                var btn = ev.target && ev.target.closest ? ev.target.closest('button[data-act]') : null;
                if (!btn) { return; }
                var tr = btn.closest('tr');
                var id = tr ? tr.getAttribute('data-id') : '';
                if (!id) { return; }
                if (btn.getAttribute('data-act') === 'del') {
                    deleteEntry(id);
                    return;
                }
                var found = null;
                state.entries.forEach(function (e) { if (e.id === id) { found = e; } });
                if (found) {
                    fillEntry(found);
                    if (el('kbEntryTitle') && el('kbEntryTitle').scrollIntoView) {
                        el('kbEntryTitle').scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
            });
        }
    }

    function init() {
        if (!el('kbEnabled') && !el('kbEntryList')) { return; }
        bind();
        loadAll();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
