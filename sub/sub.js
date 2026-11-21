/* 附属站点前端：配置与成员数据均来自主站（同源 /api，或由 SUB_API_BASE 指向独立主站域名） */
(function () {
    'use strict';

    var API_BASE = (window.SUB_API_BASE || '').replace(/\/$/, '');
    var KEY_CONFIG = 'siteSubsiteConfig';

    var DEFAULTS = {
        enabled: true,
        name: '附属站点',
        subtitle: '与主站成员信息同步',
        intro: '这里是主站的小型附属站点，成员名录、公告与留言均实时同步自主站，无需另行注册账号。',
        accent: '#2f6fed',
        notice: '',
        modules: { members: true, notices: true, guestbook: true }
    };

    function $(id) { return document.getElementById(id); }

    function token() {
        try { return localStorage.getItem('siteAuthToken') || ''; } catch (e) { return ''; }
    }

    function localSession() {
        try {
            var raw = localStorage.getItem('currentUser');
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    function apiGet(key) {
        var url = API_BASE + '/api/data?key=' + encodeURIComponent(key);
        var headers = {};
        var t = token();
        if (t) headers['x-site-token'] = t;
        return fetch(url, { headers: headers, cache: 'no-store' })
            .then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
            .then(function (j) { return j && j.ok ? j.value : null; })
            .catch(function () { return null; });
    }

    function localUsers() {
        try {
            var raw = localStorage.getItem('users');
            var v = raw ? JSON.parse(raw) : null;
            return Array.isArray(v) ? v : null;
        } catch (e) { return null; }
    }

    function esc(s) {
        return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function roleLabel(role) {
        if (role === 'super_admin') return { text: '超级管理员', cls: 'is-super' };
        if (role === 'admin') return { text: '管理员', cls: 'is-admin' };
        return { text: '成员', cls: '' };
    }

    function fmtDate(v) {
        if (!v) return '';
        var d = new Date(v);
        if (isNaN(d.getTime())) return '';
        var p = function (n) { return n < 10 ? '0' + n : '' + n; };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }

    function initial(name) {
        var s = String(name || '?').trim();
        return s ? s.slice(0, 1).toUpperCase() : '?';
    }

    function normalizeAccent(v) {
        var s = String(v || '').trim();
        if (/^#[0-9a-fA-F]{3}$/.test(s)) {
            s = '#' + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2) + s.charAt(3) + s.charAt(3);
        }
        if (!/^#[0-9a-fA-F]{6}$/.test(s)) { return DEFAULTS.accent; }
        return s.toLowerCase();
    }

    function accentSoft(hex, alpha) {
        var h = normalizeAccent(hex).slice(1);
        var r = parseInt(h.slice(0, 2), 16);
        var g = parseInt(h.slice(2, 4), 16);
        var b = parseInt(h.slice(4, 6), 16);
        return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
    }

    function applyConfig(cfg) {
        var c = cfg && typeof cfg === 'object' ? cfg : null;
        var merged = {
            enabled: c && c.enabled === false ? false : DEFAULTS.enabled,
            name: (c && c.name) || DEFAULTS.name,
            subtitle: (c && c.subtitle) || DEFAULTS.subtitle,
            intro: (c && c.intro) || DEFAULTS.intro,
            accent: normalizeAccent(c && c.accent),
            notice: (c && c.notice) || '',
            modules: {
                members: !(c && c.modules && c.modules.members === false),
                notices: !(c && c.modules && c.modules.notices === false),
                guestbook: !(c && c.modules && c.modules.guestbook === false)
            }
        };

        document.documentElement.style.setProperty('--sub-accent', merged.accent);
        document.documentElement.style.setProperty('--sub-accent-soft', accentSoft(merged.accent, 0.12));
        var themeMeta = document.querySelector('meta[name="theme-color"]');
        if (themeMeta) { themeMeta.setAttribute('content', merged.accent); }
        document.title = merged.name + ' · 成员同步门户';
        $('subSiteName').textContent = merged.name;
        $('subSiteSubtitle').textContent = merged.subtitle;
        $('subEyebrow').textContent = merged.name;
        $('subHeroTitle').textContent = merged.name;
        $('subHeroIntro').textContent = merged.intro;
        $('subBrandMark').textContent = initial(merged.name);
        $('subFootNote').textContent = merged.name + ' · 成员数据实时同步自主站';

        $('subDisabled').hidden = merged.enabled;
        $('notices').hidden = !merged.enabled || !merged.modules.notices;
        $('members').hidden = !merged.enabled || !merged.modules.members;
        $('guestbook').hidden = !merged.enabled || !merged.modules.guestbook;

        if (!merged.enabled) {
            hideAll(['notices', 'members', 'guestbook']);
            var tipEl = $('subDisabled').querySelector('.sub-empty');
            if (tipEl) {
                tipEl.textContent = merged.notice || ('超级管理员已暂时停用「' + merged.name + '」，请稍后访问主站。');
            }
        }
        return merged;
    }

    function hideAll(ids) { ids.forEach(function (id) { var el = $(id); if (el) el.hidden = true; }); }

    function renderSession() {
        var s = localSession();
        var chip = $('subUserChip');
        var link = $('subLoginLink');
        if (s && s.username) {
            chip.hidden = false;
            chip.textContent = '已登录 · ' + (s.nickname || s.username);
            link.hidden = true;
        } else {
            chip.hidden = true;
            link.hidden = false;
        }
        return s;
    }

    function renderMembers(list, session) {
        var box = $('subMembers');
        var hint = $('subMemberHint');
        if (!list || !list.length) {
            var msg = session
                ? '主站暂无可显示的成员记录。'
                : '登录主站账号后，这里会同步显示全部成员名录（未登录不展示成员隐私数据）。';
            var tip = document.createElement('p');
            tip.className = 'sub-empty';
            tip.textContent = msg;
            if (!session) {
                var a = document.createElement('a');
                a.href = '../login.html?next=/sub/index.html';
                a.textContent = ' 前往登录 →';
                tip.appendChild(a);
            }
            box.innerHTML = '';
            box.appendChild(tip);
            hint.textContent = '未同步';
            return;
        }

        hint.textContent = '共 ' + list.length + ' 位成员';

        var rows = list.slice().sort(function (a, b) {
            var rank = { super_admin: 0, admin: 1 };
            var ra = rank[a.role] === undefined ? 2 : rank[a.role];
            var rb = rank[b.role] === undefined ? 2 : rank[b.role];
            if (ra !== rb) return ra - rb;
            return String(a.username).localeCompare(String(b.username));
        });

        box.innerHTML = '';
        rows.forEach(function (u) {
            var role = roleLabel(u.role);
            var el = document.createElement('div');
            el.className = 'sub-member';
            el.setAttribute('data-search', (u.nickname || '') + ' ' + (u.username || '') + ' ' + (u.accountId || ''));

            var avatar = document.createElement('div');
            avatar.className = 'sub-avatar';
            if (u.avatar || u.avatarUrl) {
                var img = document.createElement('img');
                img.src = u.avatar || u.avatarUrl;
                img.alt = u.nickname || u.username || '';
                avatar.appendChild(img);
            } else {
                avatar.textContent = initial(u.nickname || u.username);
            }

            var info = document.createElement('div');
            info.className = 'sub-member-info';
            var strong = document.createElement('strong');
            strong.textContent = u.nickname || u.username || '未命名成员';
            var small = document.createElement('small');
            small.textContent = '账号 ' + (u.accountId || u.username || '—');
            info.appendChild(strong);
            info.appendChild(small);

            var roleEl = document.createElement('span');
            roleEl.className = 'sub-role ' + role.cls;
            roleEl.textContent = role.text;

            el.appendChild(avatar);
            el.appendChild(info);
            el.appendChild(roleEl);
            box.appendChild(el);
        });

        bindSearch(rows);
    }

    function bindSearch(rows) {
        var input = $('subMemberSearch');
        var hint = $('subMemberHint');
        if (!input) return;
        input.oninput = function () {
            var q = input.value.trim().toLowerCase();
            var shown = 0;
            Array.prototype.forEach.call(document.querySelectorAll('.sub-member'), function (el) {
                var hit = !q || (el.getAttribute('data-search') || '').toLowerCase().indexOf(q) !== -1;
                el.style.display = hit ? '' : 'none';
                if (hit) shown++;
            });
            hint.textContent = q ? '匹配 ' + shown + ' / ' + rows.length + ' 位' : '共 ' + rows.length + ' 位成员';
        };
    }

    function renderNotices(list) {
        var box = $('subNotices');
        if (!list || !list.length) {
            box.innerHTML = '<li class="sub-empty">主站暂未发布公告。</li>';
            $('mNotices').textContent = String((list || []).length);
            return;
        }
        $('mNotices').textContent = String(list.length);
        box.innerHTML = '';
        list.slice(0, 6).forEach(function (n) {
            var li = document.createElement('li');
            var h3 = document.createElement('h3');
            h3.textContent = n.title || n.name || '未命名公告';
            var p = document.createElement('p');
            p.textContent = n.content || n.summary || '';
            var meta = document.createElement('span');
            meta.className = 'sub-meta';
            meta.textContent = [fmtDate(n.createdAt || n.date || n.time), n.author || n.publisher || ''].filter(Boolean).join(' · ');
            li.appendChild(h3);
            li.appendChild(p);
            if (meta.textContent) li.appendChild(meta);
            box.appendChild(li);
        });
    }

    function renderGuestbook(list) {
        var box = $('subGuestbookList');
        $('mGuestbook').textContent = String((list || []).length);
        if (!list || !list.length) {
            box.innerHTML = '<li class="sub-empty">主站暂无留言。</li>';
            return;
        }
        box.innerHTML = '';
        list.slice(-6).reverse().forEach(function (g) {
            var li = document.createElement('li');
            var h3 = document.createElement('h3');
            h3.textContent = g.nickname || g.username || '匿名访客';
            var p = document.createElement('p');
            p.textContent = g.content || g.message || '';
            var meta = document.createElement('span');
            meta.className = 'sub-meta';
            meta.textContent = fmtDate(g.createdAt || g.time || g.date);
            li.appendChild(h3);
            li.appendChild(p);
            if (meta.textContent) li.appendChild(meta);
            box.appendChild(li);
        });
    }

    function renderMetrics(users, notices, guestbook) {
        var list = users || [];
        var admins = list.filter(function (u) { return u.role === 'admin' || u.role === 'super_admin'; }).length;
        $('mMembers').textContent = String(list.length);
        $('mAdmins').textContent = String(admins);
        $('mNotices').textContent = String((notices || []).length);
        $('mGuestbook').textContent = String((guestbook || []).length);
    }

    function boot() {
        var session = renderSession();
        var cfg = null;
        $('subState').textContent = '正在读取主站数据…';

        apiGet(KEY_CONFIG).then(function (v) {
            cfg = applyConfig(v);
            if (!cfg.enabled) { $('subState').textContent = '附属站点已被超级管理员停用。'; return null; }

            var jobs = [];
            jobs.push(apiGet('announcements').then(function (n) {
                cfg.modules.notices && renderNotices(n);
                return n || [];
            }));
            jobs.push(apiGet('siteGuestbook').then(function (g) {
                cfg.modules.guestbook && renderGuestbook(g);
                return g || [];
            }));
            jobs.push(apiGet('users').then(function (u) {
                var list = u;
                var source = '云端';
                if (!list) { list = localUsers(); source = list ? '本地缓存' : '无数据'; }
                renderMetrics(list, null, null);
                if (cfg.modules.members) renderMembers(list, session);
                return list || [];
            }));

            return Promise.all(jobs).then(function (res) {
                var users = res[2] || [], notices = res[0] || [], guest = res[1] || [];
                renderMetrics(users, notices, guest);
                var hasCloud = !!(token() && session);
                var stamp = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
                $('subState').textContent = hasCloud
                    ? '数据源：主站云端 · 成员 ' + users.length + ' 位 · 更新于 ' + stamp
                    : '成员名录与公告实时同步自主站 · 登录主站后可查看完整成员信息';
            });
        }).catch(function () {
            applyConfig(null);
            if (token() && session) {
                $('subState').textContent = '配置读取失败，暂按默认样式展示。';
            }
            if (window.console && console.warn) { console.warn('[subsite] siteSubsiteConfig 读取失败，已回退默认配置'); }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
