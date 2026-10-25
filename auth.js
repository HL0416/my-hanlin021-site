// 登录注册系统 - localStorage 前端模拟 + 超级管理员系统 + 管理后台增强

(function () {
    // ========== 统一数据层 dataStore（云端 Netlify Blobs + 本地 localStorage 双写）==========
    // get/set/remove 保持同步语义：读写本地即时生效，云端后台同步；
    // 读取优先云端：首次访问某键时异步拉取云端值，云端有值且本地为空则回填本地，下次读取生效。
    var dataStore = (function () {
        var CLOUD_URL = '/.netlify/functions/data';
        var cloudSynced = {};   // 已从云端拉取过（或已标记）的键
        var memory = {};        // 内存缓存，避免每次读取都解析 localStorage

        function readLocal(key) {
            if (Object.prototype.hasOwnProperty.call(memory, key)) { return memory[key]; }
            var v = null;
            try { v = localStorage.getItem(key); } catch (e) { v = null; }
            memory[key] = v;
            return v;
        }

        function writeLocal(key, value) {
            memory[key] = value;
            try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
        }

        function removeLocal(key) {
            delete memory[key];
            try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
        }

        function isEmptyLocalValue(v) {
            if (v === null || v === undefined) { return true; }
            var s = String(v);
            return s === '' || s === 'null' || s === 'undefined' || s === '[]' || s === '{}' || s === '""';
        }

        function pullKey(key) {
            if (cloudSynced[key]) { return; }
            cloudSynced[key] = true;
            if (typeof fetch !== 'function') { return; }
            fetch(CLOUD_URL + '?key=' + encodeURIComponent(key))
                .then(function (r) { return r.json(); })
                .then(function (res) {
                    if (res && res.ok && res.value !== null && res.value !== undefined) {
                        if (isEmptyLocalValue(readLocal(key))) {
                            writeLocal(key, typeof res.value === 'string' ? res.value : JSON.stringify(res.value));
                        }
                    }
                })
                .catch(function () { /* 云端不可用时静默回退本地 */ });
        }

        // 启动时对全站已知键做一轮云端预取，实现跨设备数据回填
        function init() {
            if (typeof fetch !== 'function') { return; }
            var keys = ['users', 'currentUser', 'adminLogs', 'siteTheme', 'announcements',
                'siteGuestbook', 'siteVisitLog', 'siteContents', 'siteSettings', 'siteAlbums',
                'siteChats', 'siteChatOpenWith', 'siteDiary_', 'siteFeedbacks', 'siteGrowth_',
                'siteMoments', 'siteNotes_', 'sitePolls', 'siteReadLater_', 'siteNotifications',
                'siteOnline', 'siteFollows_', 'siteSigninDates_', 'siteAchievements_', 'siteHistory_',
                'taskCenter_', 'userActivity_', 'userDevices_', 'userFavorites_', 'managedFiles',
                'messages', 'forgotCode', 'forgotTarget', 'forgotTargetUsername', 'smsCode',
                'contentInteractions', 'siteFriendRequests', 'siteDailyWord'];
            keys.forEach(function (k) {
                pullKey(k);
            });
        }

        return {
            get: function (key) {
                if (!cloudSynced[key]) { pullKey(key); }
                return readLocal(key);
            },
            set: function (key, value) {
                writeLocal(key, value);
                if (typeof fetch !== 'function') { return; }
                try {
                    fetch(CLOUD_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ key: key, value: value })
                    }).catch(function () { /* 云端写入失败不影响本地 */ });
                } catch (e) { /* ignore */ }
            },
            remove: function (key) {
                removeLocal(key);
                if (typeof fetch !== 'function') { return; }
                try {
                    fetch(CLOUD_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ key: key, value: null })
                    }).catch(function () { /* ignore */ });
                } catch (e) { /* ignore */ }
            },
            init: init
        };
    })();

    // 暴露统一数据层，供其它页面脚本使用；保留原 IIFE/window 架构
    window.dataStore = dataStore;

    // 页面加载完成后启动云端预取（不阻塞首屏渲染）
    if (typeof window.addEventListener === 'function') {
        window.addEventListener('load', function () { dataStore.init(); });
    }

    // ========== 工具函数 ==========
    function showError(msg) {
        var el = document.getElementById('errorMsg');
        if (el) { el.textContent = msg; el.style.display = 'block'; }
        else console.error(msg);
    }

    function clearError() {
        var el = document.getElementById('errorMsg');
        if (el) { el.textContent = ''; el.style.display = 'none'; }
    }

    function getUsers() {
        try { return JSON.parse(dataStore.get('users') || '[]'); } catch (e) { return []; }
    }

    function saveUsers(users) {
        dataStore.set('users', JSON.stringify(users));
    }

    function setSession(user) {
        // 会话快照：与用户表最新数据同步记录资料字段，保证各页面读取一致
        var snapshot = {
            username: user.username,
            role: user.role || 'user',
            loginTime: Date.now()
        };
        if (user.accountId) snapshot.accountId = user.accountId;
        if (user.nickname) snapshot.nickname = user.nickname;
        if (user.avatarUrl) snapshot.avatarUrl = user.avatarUrl;
        if (user.email) snapshot.email = user.email;
        if (user.phone) snapshot.phone = user.phone;
        dataStore.set('currentUser', JSON.stringify(snapshot));
    }

    function getSession() {
        try { return JSON.parse(dataStore.get('currentUser')); } catch (e) { return null; }
    }

    function clearSession() {
        dataStore.remove('currentUser');
    }

    // ========== 操作日志 ==========
    function addLog(action, detail) {
        var logs = JSON.parse(dataStore.get('adminLogs') || '[]');
        var session = getSession();
        logs.unshift({
            time: new Date().toLocaleString('zh-CN'),
            admin: (session && session.username) || '未登录',
            action: action,
            detail: detail
        });
        if (logs.length > 500) logs = logs.slice(0, 500);
        dataStore.set('adminLogs', JSON.stringify(logs));
    }

    // ========== 主题切换（浅色 / 深色）==========
    function getTheme() {
        try { return dataStore.get('siteTheme') || 'light'; } catch (e) { return 'light'; }
    }

    function applyTheme(theme) {
        if (!theme) theme = getTheme();
        document.documentElement.setAttribute('data-theme', theme);
        try { dataStore.set('siteTheme', theme); } catch (e) { /* ignore */ }
        var toggleBtn = document.getElementById('themeToggle');
        if (toggleBtn) toggleBtn.textContent = theme === 'dark' ? '浅色模式' : '深色模式';
    }

    function toggleTheme() {
        applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
    }

    var themeToggleBtn = document.getElementById('themeToggle');
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', toggleTheme);
    }
    applyTheme();

    // ========== 日期格式化 ==========
    function todayStr() {
        var d = new Date();
        var week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
        return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 星期' + week;
    }

    // ========== 公告数据 ==========
    function getAnnouncements() {
        var list = null;
        try { list = JSON.parse(dataStore.get('announcements')); } catch (e) { list = null; }
        if (!list || !list.length) {
            list = [
                { id: 1, title: '欢迎使用新版个人中心', content: '主页新增欢迎横幅、快捷功能与公告通知区域，个人资料支持头像上传与完成度提示，快去完善你的资料吧。', time: '2026-10-20', status: 'published' },
                { id: 2, title: '登录方式升级', content: '现在可以使用用户名、手机号或邮箱三种方式登录，忘记密码可通过手机号/邮箱找回。', time: '2026-10-18', status: 'published' },
                { id: 3, title: '深色模式已上线', content: '点击右上角按钮可在浅色 / 深色主题间切换，主题偏好会自动保存。', time: '2026-10-15', status: 'published' }
            ];
            try { dataStore.set('announcements', JSON.stringify(list)); } catch (e) { /* ignore */ }
        }
        return list;
    }

    function saveAnnouncements(list) {
        try { dataStore.set('announcements', JSON.stringify(list)); } catch (e) { /* ignore */ }
    }

    // 暴露给后台公告管理使用
    window.getAnnouncements = getAnnouncements;
    window.saveAnnouncements = saveAnnouncements;

    // ========== 访客留言板 ==========
    function getGuestbook() {
        try { return JSON.parse(dataStore.get('siteGuestbook') || '[]'); } catch (e) { return []; }
    }
    function saveGuestbook(list) {
        dataStore.set('siteGuestbook', JSON.stringify(list));
    }

    // ========== 访客足迹 ==========
    function getVisitLog() {
        try { return JSON.parse(dataStore.get('siteVisitLog') || '[]'); } catch (e) { return []; }
    }
    function saveVisitLog(list) {
        dataStore.set('siteVisitLog', JSON.stringify(list.slice(0, 200)));
    }
    function recordVisit() {
        var session = getSession();
        if (!session || !session.username) return;
        var list = getVisitLog();
        var d = new Date();
        var now = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + ' ' + d.getHours() + ':' + d.getMinutes() + ':' + d.getSeconds();
        // 同一用户 10 分钟内只记录一次，避免刷新刷屏
        var last = list.length ? list[0] : null;
        if (last && last.username === session.username) {
            var diff = (Date.now() - (last.ts || 0));
            if (diff < 10 * 60 * 1000) return;
        }
        list.unshift({ username: session.username, time: now, ts: Date.now(), page: location.pathname.split('/').pop() || 'index.html' });
        saveVisitLog(list);
    }

    // ========== 成长体系（积分 / 等级 / 签到）==========
    var GROWTH_LEVELS = [
        { min: 0, name: '新手' },
        { min: 100, name: '青铜' },
        { min: 300, name: '白银' },
        { min: 600, name: '黄金' },
        { min: 1000, name: '钻石' },
        { min: 2000, name: '大师' }
    ];
    function getGrowth(username) {
        if (!username) return null;
        try { return JSON.parse(dataStore.get('siteGrowth_' + username) || '{"points":0,"streak":0,"lastSignin":""}'); } catch (e) { return { points: 0, streak: 0, lastSignin: '' }; }
    }
    function saveGrowth(username, data) {
        dataStore.set('siteGrowth_' + username, JSON.stringify(data));
    }
    function growthLevel(points) {
        var idx = 0;
        for (var i = 0; i < GROWTH_LEVELS.length; i++) {
            if (points >= GROWTH_LEVELS[i].min) idx = i;
        }
        var cur = GROWTH_LEVELS[idx];
        var next = GROWTH_LEVELS[idx + 1] || null;
        var pct = next ? Math.min(100, Math.round((points - cur.min) / (next.min - cur.min) * 100)) : 100;
        return { level: idx + 1, name: cur.name, next: next, pct: pct };
    }
    function addPoints(username, n, reason) {
        if (!username) return;
        var data = getGrowth(username);
        data.points = (data.points || 0) + n;
        saveGrowth(username, data);
        addLog('points', '用户 ' + username + ' 积分 +' + n + (reason ? '（' + reason + '）' : ''));
    }

    // ========== 用户内容（留言 / 动态）==========
    function getContents() {
        try { return JSON.parse(dataStore.get('siteContents') || '[]'); } catch (e) { return []; }
    }

    function saveContents(list) {
        dataStore.set('siteContents', JSON.stringify(list));
    }

    // ========== 内容互动（点赞 / 评论 / 收藏）==========
    function getInteractions() {
        try { return JSON.parse(dataStore.get('contentInteractions') || '{}'); } catch (e) { return {}; }
    }
    function saveInteractions(map) {
        dataStore.set('contentInteractions', JSON.stringify(map));
    }
    function getFavorites(username) {
        try { return JSON.parse(dataStore.get('userFavorites_' + username) || '[]'); } catch (e) { return []; }
    }
    function saveFavorites(username, list) {
        dataStore.set('userFavorites_' + username, JSON.stringify(list));
    }

    function findUserByUsername(users, username) {
        for (var i = 0; i < users.length; i++) {
            if (users[i].username === username) return users[i];
        }
        return null;
    }

    // ========== 手机号 / 邮箱 / 密码强度校验 ==========
    function isValidPhone(phone) {
        return /^1[3-9]\d{9}$/.test(phone);
    }

    function isValidEmail(email) {
        return /^[\w.-]+@[\w-]+(\.[\w-]+)+$/.test(email);
    }

    // 密码强度：返回 { ok, level, tip }
    function checkPasswordStrength(password) {
        var score = 0;
        if (password.length >= 8) score++;
        if (/[a-z]/.test(password)) score++;
        if (/[A-Z]/.test(password)) score++;
        if (/\d/.test(password)) score++;
        if (/[^a-zA-Z0-9]/.test(password)) score++;
        var level = score >= 5 ? '强' : (score >= 3 ? '中' : '弱');
        // 基础要求：至少6位且同时包含字母和数字
        var ok = password.length >= 6 && /[a-zA-Z]/.test(password) && /\d/.test(password);
        var tip = ok ? '密码强度：' + level : '密码强度：弱（至少6位，且需同时包含字母和数字）';
        return { ok: ok, level: level, tip: tip };
    }

    // 按账号类型查找用户：手机号 -> 邮箱 -> 用户名
    function findUserByAccount(users, account) {
        account = String(account || '').trim();
        if (!account) return null;
        var i;
        if (isValidPhone(account)) {
            for (i = 0; i < users.length; i++) {
                if (users[i].phone === account) return users[i];
            }
        }
        if (isValidEmail(account)) {
            for (i = 0; i < users.length; i++) {
                if (users[i].email && users[i].email.toLowerCase() === account.toLowerCase()) return users[i];
            }
        }
        for (i = 0; i < users.length; i++) {
            if (users[i].username === account) return users[i];
        }
        return null;
    }


    // 检查手机号/邮箱是否已被其它用户占用（excludeUsername 用于编辑资料时排除自己）
    function isPhoneTaken(users, phone, excludeUsername) {
        for (var i = 0; i < users.length; i++) {
            if (users[i].phone && users[i].phone === phone && users[i].username !== excludeUsername) return true;
        }
        return false;
    }

    function isEmailTaken(users, email, excludeUsername) {
        for (var i = 0; i < users.length; i++) {
            if (users[i].email && users[i].email.toLowerCase() === email.toLowerCase() && users[i].username !== excludeUsername) return true;
        }
        return false;
    }

    // ========== 账号ID ==========
    // 生成唯一账号：纯数字，按角色区分起始值
    function genAccountId(users, role) {
        var id = '';
        var exists = false;
        do {
            if (role === 'admin') {
                // 管理员：从2001开始递增
                var maxAdmin = 2000;
                for (var i = 0; i < users.length; i++) {
                    var uId = parseInt(users[i].accountId, 10);
                    if (!isNaN(uId) && uId > 999 && uId < 10000 && users[i].role === 'admin') {
                        if (uId > maxAdmin) maxAdmin = uId;
                    }
                }
                id = (maxAdmin + 1).toString();
            } else {
                // 普通用户：从10000001开始递增
                var maxUser = 10000000;
                for (var j = 0; j < users.length; j++) {
                    var uId2 = parseInt(users[j].accountId, 10);
                    if (!isNaN(uId2) && users[j].role !== 'admin') {
                        if (uId2 > maxUser) maxUser = uId2;
                    }
                }
                id = (maxUser + 1).toString();
            }
            exists = false;
            for (var k = 0; k < users.length; k++) {
                if (users[k].accountId === id) { exists = true; break; }
            }
        } while (exists);
        return id;
    }

    // 老用户兼容：登录/访问个人中心时若无账号则自动补发并保存
    function ensureAccountId(user) {
        if (!user) return null;
        if (user.accountId) return user.accountId;
        var users = getUsers();
        for (var i = 0; i < users.length; i++) {
            if (users[i].username === user.username) {
                users[i].accountId = genAccountId(users, users[i].role);
                user.accountId = users[i].accountId; // 同步回调用方对象，保证会话快照与用户表一致
                saveUsers(users);
                return users[i].accountId;
            }
        }
        return null;
    }

    // ========== 初始化：创建默认超级管理员账号 ==========
    (function initDefaultAdmin() {
        var users = getUsers();
        for (var i = 0; i < users.length; i++) {
            if (users[i].username === 'admin') {
                // 老数据兼容：若 admin 已存在但 accountId 不是目标值，则修正
                if (users[i].accountId !== '1000') {
                    users[i].accountId = '1000';
                    saveUsers(users);
                }
                return;
            }
        }
        users.push({ username: 'admin', password: 'admin123', role: 'super_admin', createdAt: Date.now(), accountId: '1000' });
        saveUsers(users);
    })();

    // ========== 注册页面 ==========
    var regForm = document.getElementById('registerForm');
    if (regForm) {
        regForm.addEventListener('submit', function (e) {
            e.preventDefault();
            clearError();

            var username = document.getElementById('regUsername').value.trim();
            var password = document.getElementById('regPassword').value;
            var confirm = document.getElementById('confirmPassword').value;
            var phone = document.getElementById('regPhone') ? document.getElementById('regPhone').value.trim() : '';
            var email = document.getElementById('regEmail') ? document.getElementById('regEmail').value.trim() : '';

            if (username.length > 6) { showError('用户名最多6个字符'); return; }
            if (/^1[3-9]\d{9}$/.test(username)) { showError('用户名不能使用手机号格式，请更换用户名'); return; }
            if (isValidEmail(username)) { showError('用户名不能使用邮箱格式，请更换用户名'); return; }
            if (phone && !isValidPhone(phone)) { showError('手机号格式不正确（11位，1开头）'); return; }
            if (email && !isValidEmail(email)) { showError('邮箱格式不正确'); return; }

            var strength = checkPasswordStrength(password);
            if (!strength.ok) { showError(strength.tip); return; }
            if (password !== confirm) { showError('两次输入的密码不一致'); return; }

            var users = getUsers();
            for (var i = 0; i < users.length; i++) {
                if (users[i].username === username) {
                    showError('该用户名已被注册');
                    return;
                }
            }
            if (phone && isPhoneTaken(users, phone)) { showError('该手机号已被注册'); return; }
            if (email && isEmailTaken(users, email)) { showError('该邮箱已被注册'); return; }

            var newAccountId = genAccountId(users);
            users.push({
                username: username,
                password: password,
                role: 'user',
                createdAt: Date.now(),
                accountId: newAccountId,
                phone: phone,
                email: email
            });
            saveUsers(users);
            addLog('register', '新用户注册：' + username + '，账号ID：' + newAccountId);
            alert('注册成功！您的账号ID：' + newAccountId + '\n请妥善保存，返回登录页面登录。');
            window.location.href = 'login.html';
        });
    }

    // 注册页密码强度实时提示
    var regPasswordInput = document.getElementById('regPassword');
    if (regPasswordInput) {
        regPasswordInput.addEventListener('input', function () {
            var strengthEl = document.getElementById('passwordStrength');
            if (!strengthEl) return;
            var val = this.value;
            if (!val) { strengthEl.textContent = ''; return; }
            var strength = checkPasswordStrength(val);
            strengthEl.textContent = strength.tip;
            strengthEl.className = 'password-hint strength-' + strength.level;
        });
    }

    // ========== 登录页面 ==========
    var loginMode = 'password';
    var loginModeSwitch = document.getElementById('loginModeSwitch');
    var passwordGroup = document.getElementById('passwordGroup');
    var codeGroup = document.getElementById('codeGroup');
    var verifyCodeInput = document.getElementById('verifyCode');
    var sendCodeBtn = document.getElementById('sendCodeBtn');

    // 页面内展示验证码发送结果（避免 alert 被拦截导致看不到验证码）
    function showCodeNotice(msg) {
        var el = document.getElementById('codeNotice');
        if (el) { el.textContent = msg; el.style.display = 'block'; }
    }
    function hideCodeNotice() {
        var el = document.getElementById('codeNotice');
        if (el) { el.textContent = ''; el.style.display = 'none'; }
    }

    function setLoginMode(mode) {
        loginMode = mode;
        var btns = loginModeSwitch ? loginModeSwitch.querySelectorAll('.mode-btn') : [];
        for (var i = 0; i < btns.length; i++) {
            btns[i].className = btns[i].getAttribute('data-mode') === mode ? 'mode-btn active' : 'mode-btn';
        }
        var usernameEl = document.getElementById('username');
        var passwordEl = document.getElementById('password');
        if (usernameEl) usernameEl.value = '';
        if (passwordEl) passwordEl.value = '';
        if (verifyCodeInput) verifyCodeInput.value = '';
        clearError();
        hideCodeNotice();
        if (mode === 'code') {
            if (passwordGroup) passwordGroup.style.display = 'none';
            if (codeGroup) codeGroup.style.display = '';
            if (usernameEl) usernameEl.placeholder = '请输入手机号或邮箱';
        } else {
            if (codeGroup) codeGroup.style.display = 'none';
            if (passwordGroup) passwordGroup.style.display = '';
            if (usernameEl) usernameEl.placeholder = '请输入用户名、手机号或邮箱';
        }
    }
    if (loginModeSwitch) {
        loginModeSwitch.addEventListener('click', function (e) {
            var btn = e.target.closest ? e.target.closest('.mode-btn') : null;
            if (btn && btn.getAttribute('data-mode') && btn.getAttribute('data-mode') !== loginMode) {
                setLoginMode(btn.getAttribute('data-mode'));
            }
        });
    }

    // 获取验证码：校验账号为已注册手机号/邮箱，生成6位数字验证码并存入 localStorage，页面提示模拟发送
    if (sendCodeBtn) {
        sendCodeBtn.addEventListener('click', function () {
            clearError();
            hideCodeNotice();
            var account = document.getElementById('username').value.trim();
            if (!account) { showError('请先输入手机号或邮箱'); return; }
            if (!isValidPhone(account) && !isValidEmail(account)) {
                showError('请输入正确的手机号或邮箱');
                return;
            }
            var users = getUsers();
            var found = null;
            var i;
            if (isValidPhone(account)) {
                for (i = 0; i < users.length; i++) {
                    if (users[i].phone === account) { found = users[i]; break; }
                }
            } else {
                for (i = 0; i < users.length; i++) {
                    if (users[i].email && users[i].email.toLowerCase() === account.toLowerCase()) { found = users[i]; break; }
                }
            }
            if (!found) { showError('该手机号或邮箱未注册'); return; }
            var code = String(Math.floor(100000 + Math.random() * 900000));
            var smsData = { code: code, target: account, expireAt: Date.now() + 5 * 60 * 1000 };
            dataStore.set('smsCode', JSON.stringify(smsData));
            showCodeNotice('验证码已发送至 ' + account + '：' + code + '（5分钟内有效）');
            if (typeof alert === 'function') { alert('验证码已发送至 ' + account + '：' + code + '（5分钟内有效）'); }
        });
    }

    var loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', function (e) {
            e.preventDefault();
            clearError();
            hideCodeNotice();

            var account = document.getElementById('username').value.trim();
            var users = getUsers();
            var found = null;
            var i;

            // ===== 验证码登录模式 =====
            if (loginMode === 'code') {
                var codeInput = verifyCodeInput ? verifyCodeInput.value.trim() : '';
                if (!account || !codeInput) { showError('请输入账号和验证码'); return; }
                if (isValidPhone(account)) {
                    for (i = 0; i < users.length; i++) {
                        if (users[i].phone === account) { found = users[i]; break; }
                    }
                } else if (isValidEmail(account)) {
                    for (i = 0; i < users.length; i++) {
                        if (users[i].email && users[i].email.toLowerCase() === account.toLowerCase()) { found = users[i]; break; }
                    }
                }
                if (!found) {
                    addLog('login_fail', '验证码登录失败：' + account + '（账号未注册）');
                    showError('该手机号或邮箱未注册');
                    return;
                }
                var stored = null;
                try { stored = JSON.parse(dataStore.get('smsCode') || 'null'); } catch (err) { stored = null; }
                if (!stored || stored.code !== codeInput) {
                    addLog('login_fail', '验证码登录失败：' + account + '（验证码错误）');
                    showError('验证码错误');
                    return;
                }
                if (Date.now() > stored.expireAt) {
                    showError('验证码已过期，请重新获取');
                    return;
                }
                if (stored.target.toLowerCase() !== account.toLowerCase()) {
                    showError('验证码与账号不匹配，请重新获取');
                    return;
                }
                // 先确保账号补发，再写入会话快照，保证会话中的账号ID与用户表一致
                ensureAccountId(found);
                setSession(found);
                var isAdminUser = found.role === 'super_admin' || found.role === 'admin';
                addLog('login', '验证码登录成功：' + found.username + (isAdminUser ? '（管理员）' : ''));
                window.location.href = isAdminUser ? 'admin.html' : 'index.html';
                return;
            }

            // ===== 密码登录模式 =====
            var password = document.getElementById('password').value;
            if (!account || !password) { showError('请输入账号和密码'); return; }

            // 自动识别：精确匹配 username -> phone -> email(忽略大小写)
            for (i = 0; i < users.length; i++) {
                if (users[i].username === account) { found = users[i]; break; }
            }
            if (!found) {
                for (i = 0; i < users.length; i++) {
                    if (users[i].phone === account) { found = users[i]; break; }
                }
            }
            if (!found) {
                for (i = 0; i < users.length; i++) {
                    if (users[i].email && users[i].email.toLowerCase() === account.toLowerCase()) { found = users[i]; break; }
                }
            }
            if (!found || found.password !== password) {
                addLog('login_fail', '登录失败：' + account);
                showError('账号或密码错误');
                return;
            }

            // 先确保账号补发，再写入会话快照，保证会话中的账号ID与用户表一致
            ensureAccountId(found);
            setSession(found);
            var isAdminUser = found.role === 'super_admin' || found.role === 'admin';
            addLog('login', '登录成功：' + found.username + (isAdminUser ? '（管理员）' : ''));
            window.location.href = isAdminUser ? 'admin.html' : 'index.html';
        });
    }

    // ========== 主页（index.html）==========
    var welcomeEl = document.getElementById('welcomeUser');
    var logoutBtn = document.getElementById('logoutBtn');
    var adminLink = document.getElementById('adminLink');

    // 渲染欢迎横幅：始终从最新用户表读取，保证昵称/头像/账号/角色实时一致
    function renderWelcomeBanner(session, fullUser) {
        if (!welcomeEl) return;
        ensureAccountId(fullUser);
        var displayName = (fullUser && fullUser.nickname) || session.username;
        welcomeEl.textContent = '欢迎回来，' + displayName + '！';
        var dateEl = document.getElementById('welcomeDate');
        if (dateEl) dateEl.textContent = '今天是 ' + todayStr();
        var accountEl = document.getElementById('welcomeAccount');
        if (accountEl) accountEl.textContent = '账号：' + (fullUser && fullUser.accountId ? fullUser.accountId : '未分配');
        // 头像与个人资料页同步展示
        var avatarEl = document.getElementById('welcomeAvatar');
        if (avatarEl) {
            var avatarUrl = fullUser && fullUser.avatarUrl;
            if (avatarUrl) {
                avatarEl.innerHTML = '<img src="' + escapeHtml(avatarUrl) + '" alt="头像" onerror="this.style.display=\'none\'">';
            } else {
                var initials = displayName ? displayName.substring(0, 2).toUpperCase() : '?';
                avatarEl.innerHTML = '<span class="welcome-avatar-text">' + escapeHtml(initials) + '</span>';
            }
        }
        // 管理员入口以最新用户表角色为准（管理员后台变更角色后无需重新登录即可同步）
        var isAdmin = fullUser && (fullUser.role === 'super_admin' || fullUser.role === 'admin');
        if (adminLink) adminLink.style.display = isAdmin ? 'block' : 'none';
    }

    if (welcomeEl && logoutBtn) {
        var session = getSession();
        if (!session) {
            window.location.href = 'login.html';
        } else {
            var fullUser = findUserByUsername(getUsers(), session.username);
            renderWelcomeBanner(session, fullUser);
            logoutBtn.addEventListener('click', function () {
                clearSession();
                window.location.href = 'login.html';
            });
            initHomePage(session, fullUser);
        }
    }

    function initHomePage(session, fullUser) {
        applySiteSettings();
        initCarousel();
        renderAnnouncements();
        renderContentCards(session.username);
        renderFeedbacks();
        recordVisit();
        renderGuestbook();
        initBackTop();

        // 全局搜索
        var searchBtn = document.getElementById('globalSearchBtn');
        var searchInput = document.getElementById('globalSearchInput');
        if (searchBtn) searchBtn.addEventListener('click', function () { window.doGlobalSearch(); });
        if (searchInput) searchInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') window.doGlobalSearch(); });

        // 留言板
        var guestbookBtn = document.getElementById('guestbookSubmitBtn');
        var guestbookInput = document.getElementById('guestbookInput');
        if (guestbookBtn) guestbookBtn.addEventListener('click', function () { window.submitGuestbook(); });
        if (guestbookInput) guestbookInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') window.submitGuestbook(); });

        // 反馈弹窗
        var quickFeedback = document.getElementById('quickFeedback');
        var feedbackModal = document.getElementById('feedbackModal');
        var feedbackClose = document.getElementById('feedbackClose');
        var feedbackCancel = document.getElementById('feedbackCancel');
        var feedbackSubmit = document.getElementById('feedbackSubmit');

        function openFeedback() {
            if (!feedbackModal) return;
            feedbackModal.style.display = 'flex';
            feedbackModal.classList.add('modal-in');
        }
        function closeFeedback() {
            if (!feedbackModal) return;
            feedbackModal.style.display = 'none';
        }
        if (quickFeedback) quickFeedback.addEventListener('click', openFeedback);
        if (feedbackClose) feedbackClose.addEventListener('click', closeFeedback);
        if (feedbackCancel) feedbackCancel.addEventListener('click', closeFeedback);
        if (feedbackModal) feedbackModal.addEventListener('click', function (e) {
            if (e.target === feedbackModal) closeFeedback();
        });

        if (feedbackSubmit) {
            feedbackSubmit.addEventListener('click', function () {
                var title = document.getElementById('feedbackTitle').value.trim();
                var body = document.getElementById('feedbackBody').value.trim();
                if (!title || !body) { alert('标题和内容都不能为空'); return; }
                var feedbacks = getFeedbacks();
                feedbacks.unshift({
                    id: Date.now(),
                    title: title,
                    body: body,
                    author: session.username,
                    time: new Date().toLocaleString('zh-CN'),
                    status: 'pending'
                });
                saveFeedbacks(feedbacks);
                addLog('feedback', '用户 ' + session.username + ' 提交反馈：' + title);
                closeFeedback();
                document.getElementById('feedbackTitle').value = '';
                document.getElementById('feedbackBody').value = '';
                renderFeedbacks();
                alert('反馈提交成功！');
            });
        }
    }

    // 首页 Hero 轮播
    function initCarousel() {
        var slidesWrap = document.getElementById('heroSlides');
        var dotsWrap = document.getElementById('heroDots');
        var prevBtn = document.getElementById('heroPrev');
        var nextBtn = document.getElementById('heroNext');
        var carousel = document.getElementById('heroCarousel');
        if (!slidesWrap) return;
        var slides = slidesWrap.querySelectorAll('.hero-slide');
        if (!slides.length) return;
        var current = 0;
        var timer = null;

        function buildDots() {
            if (!dotsWrap) return;
            var html = '';
            for (var i = 0; i < slides.length; i++) {
                html += '<span class="hero-dot' + (i === 0 ? ' active' : '') + '" data-index="' + i + '"></span>';
            }
            dotsWrap.innerHTML = html;
        }

        function goTo(index) {
            current = (index + slides.length) % slides.length;
            for (var i = 0; i < slides.length; i++) {
                if (i === current) { slides[i].classList.add('active'); } else { slides[i].classList.remove('active'); }
            }
            if (dotsWrap) {
                var dots = dotsWrap.querySelectorAll('.hero-dot');
                for (var j = 0; j < dots.length; j++) {
                    if (j === current) { dots[j].classList.add('active'); } else { dots[j].classList.remove('active'); }
                }
            }
        }

        function next() { goTo(current + 1); }
        function prev() { goTo(current - 1); }
        function startAuto() {
            if (timer) stopAuto();
            timer = setInterval(next, 5000);
        }
        function stopAuto() {
            if (timer) { clearInterval(timer); timer = null; }
        }

        buildDots();
        if (nextBtn) nextBtn.addEventListener('click', function () { stopAuto(); next(); startAuto(); });
        if (prevBtn) prevBtn.addEventListener('click', function () { stopAuto(); prev(); startAuto(); });
        if (dotsWrap) {
            dotsWrap.addEventListener('click', function (e) {
                var dot = e.target;
                if (dot && dot.classList && dot.classList.contains('hero-dot') && dot.dataset) {
                    stopAuto();
                    goTo(parseInt(dot.dataset.index, 10) || 0);
                    startAuto();
                }
            });
        }
        if (carousel) {
            carousel.addEventListener('mouseenter', stopAuto);
            carousel.addEventListener('mouseleave', startAuto);
        }
        startAuto();
    }

    // 首页站点数据统计（实时读取 localStorage）
    function renderSiteStats() {
        var userCountEl = document.getElementById('statUserCount');
        var contentCountEl = document.getElementById('statContentCount');
        var noticeCountEl = document.getElementById('statNoticeCount');
        var logCountEl = document.getElementById('statLogCount');
        if (userCountEl) userCountEl.textContent = getUsers().length;
        if (contentCountEl) contentCountEl.textContent = getContents().length;
        if (noticeCountEl) noticeCountEl.textContent = getAnnouncements().length;
        if (logCountEl) logCountEl.textContent = (JSON.parse(dataStore.get('adminLogs') || '[]')).length;
    }

    function renderAnnouncements() {
        var listEl = document.getElementById('announcementList');
        var emptyEl = document.getElementById('announcementEmpty');
        var countEl = document.getElementById('announcementCount');
        if (!listEl) return;
        var list = getAnnouncements();
        // 首页仅展示已发布公告（后台公告管理可存草稿），置顶优先
        var visible = [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].status !== 'draft') visible.push(list[i]);
        }
        visible.sort(function (a, b) {
            return ((b.top ? 1 : 0) - (a.top ? 1 : 0)) || 0;
        });
        if (countEl) countEl.textContent = visible.length;
        if (emptyEl) emptyEl.style.display = visible.length ? 'none' : 'block';
        var html = '';
        for (var j = 0; j < visible.length; j++) {
            var item = visible[j];
            html += '<div class="announcement-item' + (item.top ? ' pinned' : '') + '"><div class="announcement-head">' +
                '<span class="announcement-title">' + escapeHtml(item.title) + (item.top ? '<span class="pin-badge">置顶</span>' : '') + '</span>' +
                '<span class="announcement-time">' + escapeHtml(item.time || '') + '</span></div>' +
                '<p class="announcement-content">' + escapeHtml(item.content || '') + '</p></div>';
        }
        listEl.innerHTML = html;
    }

    // ========== Toast 提示 ==========
    function showToast(msg, type) {
        var container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        var toast = document.createElement('div');
        toast.className = 'toast' + (type ? ' toast-' + type : '');
        toast.textContent = msg;
        container.appendChild(toast);
        setTimeout(function () {
            toast.classList.add('show');
        }, 10);
        setTimeout(function () {
            toast.classList.remove('show');
            setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 350);
        }, 2600);
    }
    window.showToast = showToast;

    // ========== 返回顶部按钮 ==========
    function initBackTop() {
        var btn = document.getElementById('backTopBtn');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'backTopBtn';
            btn.className = 'back-top';
            btn.title = '返回顶部';
            btn.textContent = '↑';
            document.body.appendChild(btn);
        }
        btn.addEventListener('click', function () {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        function onScroll() {
            if (window.scrollY > 400) { btn.classList.add('show'); } else { btn.classList.remove('show'); }
        }
        window.addEventListener('scroll', onScroll);
        onScroll();
    }

    // ========== 反馈管理 ==========
    function getFeedbacks() {
        return JSON.parse(dataStore.get('siteFeedbacks') || '[]');
    }
    window.getFeedbacks = getFeedbacks;

    function saveFeedbacks(list) {
        dataStore.set('siteFeedbacks', JSON.stringify(list));
    }
    window.saveFeedbacks = saveFeedbacks;

    function renderFeedbacks() {
        var listEl = document.getElementById('feedbackList');
        var emptyEl = document.getElementById('feedbackEmpty');
        var countEl = document.getElementById('feedbackCount');
        if (!listEl) return;
        var list = getFeedbacks();
        if (countEl) countEl.textContent = list.length;
        if (emptyEl) emptyEl.style.display = list.length ? 'none' : 'block';
        var html = '';
        for (var i = 0; i < list.length; i++) {
            var item = list[i];
            var statusBadge = '';
            if (item.status === 'pending') statusBadge = '<span class="status-badge status-pending">待处理</span>';
            else if (item.status === 'resolved') statusBadge = '<span class="status-badge status-resolved">已解决</span>';
            else if (item.status === 'rejected') statusBadge = '<span class="status-badge status-rejected">已驳回</span>';
            html += '<div class="feedback-item"><div class="feedback-head">' +
                '<span class="feedback-author">' + escapeHtml(item.author || '匿名') + '</span>' +
                '<span class="feedback-time">' + escapeHtml(item.time || '') + '</span>' +
                statusBadge + '</div>' +
                '<h4 class="feedback-title">' + escapeHtml(item.title) + '</h4>' +
                '<p class="feedback-body">' + escapeHtml(item.body) + '</p></div>';
        }
        listEl.innerHTML = html;
    }
    window.renderFeedbacks = renderFeedbacks;

    // ========== 访客足迹展示 ==========
    function renderVisitInfo() {
        var el = document.getElementById('visitInfo');
        if (!el) return;
        var list = getVisitLog();
        var session = getSession();
        if (!list.length) {
            el.innerHTML = '<span class="visit-label">访客足迹</span> 暂无访问记录，登录后自动记录';
            return;
        }
        var unique = [];
        var seen = {};
        for (var i = 0; i < list.length; i++) {
            if (!seen[list[i].username]) { seen[list[i].username] = true; unique.push(list[i].username); }
            if (unique.length >= 6) break;
        }
        var avatars = '';
        for (var j = 0; j < unique.length; j++) {
            avatars += '<span class="visit-avatar" title="' + escapeHtml(unique[j]) + '">' + escapeHtml(unique[j].charAt(0).toUpperCase()) + '</span>';
        }
        var total = getVisitLog().length;
        el.innerHTML = '<span class="visit-info"><span class="visit-label">访客足迹</span> 累计 ' + total + ' 次访问' +
            (session && session.username ? '，欢迎回来，' + escapeHtml(session.username) : '，登录可记录你的足迹') +
            '<span class="visit-avatars">' + avatars + '</span></span>';
    }

    // ========== 留言板 ==========
    function renderGuestbook() {
        var listEl = document.getElementById('guestbookList');
        var emptyEl = document.getElementById('guestbookEmpty');
        if (!listEl) return;
        var list = getGuestbook();
        if (emptyEl) emptyEl.style.display = list.length ? 'none' : 'block';
        var html = '';
        for (var i = 0; i < list.length; i++) {
            var item = list[i];
            html += '<div class="guestbook-item"><span class="guestbook-avatar">' + escapeHtml((item.author || '客').charAt(0).toUpperCase()) + '</span>' +
                '<div class="guestbook-main"><div class="guestbook-head">' +
                '<span class="guestbook-author">' + escapeHtml(item.author || '匿名') + '</span>' +
                '<span class="guestbook-time">' + escapeHtml(item.time || '') + '</span></div>' +
                '<div class="guestbook-text">' + escapeHtml(item.text || '') + '</div></div></div>';
        }
        listEl.innerHTML = html;
    }

    window.submitGuestbook = function () {
        var session = getSession();
        if (!session || !session.username) {
            showToast('请先登录后再留言', 'warning');
            setTimeout(function () { location.href = 'login.html'; }, 800);
            return;
        }
        var input = document.getElementById('guestbookInput');
        if (!input) return;
        var text = input.value.trim();
        if (!text) { showToast('留言内容不能为空', 'warning'); return; }
        var list = getGuestbook();
        list.unshift({
            id: Date.now(),
            author: session.username,
            text: text,
            time: new Date().toLocaleString('zh-CN')
        });
        saveGuestbook(list);
        input.value = '';
        renderGuestbook();
        if (window.markTaskDone) window.markTaskDone('guestbook');
        addPoints(session.username, 2, '发布留言');
        showToast('留言发布成功，积分 +2', 'success');
    };

    // ========== 热门排行榜 ==========
    function renderTopRank() {
        var wrap = document.getElementById('topRankList');
        if (!wrap) return;
        var contents = getContents();
        var interactions = getInteractions();
        var likesMap = (interactions.likers || {});
        var scored = [];
        for (var i = 0; i < contents.length; i++) {
            var id = contents[i].id;
            scored.push({
                title: contents[i].title,
                author: contents[i].author,
                likes: (likesMap[id] || []).length,
                comments: ((interactions.comments || {})[id] || []).length
            });
        }
        scored.sort(function (a, b) { return (b.likes + b.comments) - (a.likes + a.comments); });
        var topContents = scored.slice(0, 5);

        // 活跃用户：内容数 + 留言数 + 点赞互动数
        var users = getUsers();
        var guestbook = getGuestbook();
        var userScore = {};
        for (var u = 0; u < users.length; u++) userScore[users[u].username] = 0;
        for (var c = 0; c < contents.length; c++) {
            if (userScore[contents[c].author] != null) userScore[contents[c].author] += 2;
        }
        for (var g = 0; g < guestbook.length; g++) {
            if (userScore[guestbook[g].author] != null) userScore[guestbook[g].author] += 1;
        }
        var likeUsers = interactions.likers || {};
        for (var lid in likeUsers) {
            if (Object.prototype.hasOwnProperty.call(likeUsers, lid)) {
                for (var k = 0; k < likeUsers[lid].length; k++) {
                    if (userScore[likeUsers[lid][k]] != null) userScore[likeUsers[lid][k]] += 1;
                }
            }
        }
        var topUsers = Object.keys(userScore).map(function (name) {
            return { name: name, score: userScore[name] };
        }).filter(function (it) { return it.score > 0; }).sort(function (a, b) { return b.score - a.score; }).slice(0, 5);

        var emptyEl = document.getElementById('rankEmpty');
        if (emptyEl) emptyEl.style.display = (topContents.length || topUsers.length) ? 'none' : 'block';
        if (!topContents.length && !topUsers.length) {
            wrap.className = 'rank-list';
            wrap.innerHTML = '';
            return;
        }
        wrap.className = 'rank-grid';
        var html = '<div class="rank-box"><h4>热门内容</h4><ul class="rank-list">';
        for (var t = 0; t < topContents.length; t++) {
            html += '<li class="rank-item"><span class="rank-badge rank-' + (t + 1) + '">' + (t + 1) + '</span>' +
                '<span class="rank-name">' + escapeHtml(topContents[t].title) + '</span>' +
                '<span class="rank-value">赞 ' + topContents[t].likes + '</span></li>';
        }
        if (!topContents.length) html += '<li class="rank-item" style="color:#a0a8c0;">暂无内容上榜</li>';
        html += '</ul></div>';
        html += '<div class="rank-box"><h4>活跃用户</h4><ul class="rank-list">';
        for (var a = 0; a < topUsers.length; a++) {
            html += '<li class="rank-item"><span class="rank-badge rank-' + (a + 1) + '">' + (a + 1) + '</span>' +
                '<span class="rank-name"><a href="profile.html">' + escapeHtml(topUsers[a].name) + '</a></span>' +
                '<span class="rank-value">' + topUsers[a].score + ' 分</span></li>';
        }
        if (!topUsers.length) html += '<li class="rank-item" style="color:#a0a8c0;">暂无用户上榜</li>';
        html += '</ul></div>';
        wrap.innerHTML = html;
    }

    // ========== 全局搜索 ==========
    window.doGlobalSearch = function () {
        var input = document.getElementById('globalSearchInput');
        if (!input) return;
        var kw = input.value.trim();
        if (!kw) { showToast('请输入搜索关键词', 'warning'); return; }
        var results = [];
        var session = getSession();
        var contents = getContents();
        for (var i = 0; i < contents.length; i++) {
            if ((contents[i].title || '').indexOf(kw) !== -1 || (contents[i].body || '').indexOf(kw) !== -1) {
                results.push({ type: '内容', name: contents[i].title, author: contents[i].author, page: 'index.html' });
            }
        }
        var anns = getAnnouncements();
        for (var j = 0; j < anns.length; j++) {
            if (anns[j].status !== 'draft' && ((anns[j].title || '').indexOf(kw) !== -1 || (anns[j].content || '').indexOf(kw) !== -1)) {
                results.push({ type: '公告', name: anns[j].title, author: '系统', page: 'index.html' });
            }
        }
        var users = getUsers();
        for (var u = 0; u < users.length; u++) {
            if ((users[u].username || '').indexOf(kw) !== -1 || (users[u].nickname || '').indexOf(kw) !== -1) {
                results.push({ type: '用户', name: users[u].nickname || users[u].username, author: users[u].username, page: 'profile.html' });
            }
        }
        var files = getFiles();
        for (var f = 0; f < files.length; f++) {
            if ((files[f].name || '').indexOf(kw) !== -1) {
                results.push({ type: '文件', name: files[f].name, author: files[f].uploader || '', page: 'admin.html' });
            }
        }
        if (!results.length) { showToast('未找到与「' + kw + '」相关的内容', 'error'); return; }
        var lines = [];
        for (var r = 0; r < Math.min(results.length, 6); r++) {
            lines.push('[' + results[r].type + '] ' + results[r].name + '（' + results[r].author + '）→ ' + results[r].page);
        }
        showToast(lines.join('\n'), 'success');
    };

    // ========== 成长中心（个人中心页）==========
    function renderGrowth() {
        var card = document.getElementById('growthCard');
        if (!card) return;
        var session = getSession();
        if (!session || !session.username) return;
        var data = getGrowth(session.username);
        var info = growthLevel(data.points || 0);
        document.getElementById('growthLevelBadge').textContent = 'Lv.' + info.level;
        document.getElementById('growthLevelName').textContent = info.name;
        document.getElementById('growthPoints').textContent = data.points || 0;
        document.getElementById('growthStreak').textContent = data.streak || 0;
        document.getElementById('growthProgressFill').style.width = info.pct + '%';
        var nextMin = info.next ? info.next.min : data.points;
        document.getElementById('growthProgressText').textContent = (data.points || 0) + ' / ' + nextMin + (info.next ? '（下一级 ' + info.next.name + '）' : '（已达最高级）');
        var btn = document.getElementById('growthSigninBtn');
        var tip = document.getElementById('growthSigninTip');
        if (!btn || !tip) return;
        var today = new Date();
        var todayKey = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        if (data.lastSignin === todayKey) {
            btn.disabled = true;
            btn.textContent = '今日已签到';
            tip.textContent = '明天再来吧';
            tip.classList.add('done');
        } else {
            btn.disabled = false;
            btn.textContent = '今日签到 +5';
            tip.textContent = '连续签到奖励更多积分';
            tip.classList.remove('done');
        }
    }

    window.doSignin = function () {
        var session = getSession();
        if (!session || !session.username) { showToast('请先登录', 'warning'); return; }
        var data = getGrowth(session.username);
        var today = new Date();
        var todayKey = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        if (data.lastSignin === todayKey) { showToast('今天已经签到过啦', 'warning'); return; }
        var yesterday = new Date(today.getTime() - 86400000);
        var yKey = yesterday.getFullYear() + '-' + (yesterday.getMonth() + 1) + '-' + yesterday.getDate();
        var bonus = (data.lastSignin === yKey) ? (data.streak + 1) : 1;
        var earn = 5 + Math.min(5, bonus - 1);
        data.streak = (data.lastSignin === yKey) ? (data.streak + 1) : 1;
        data.points = (data.points || 0) + earn;
        data.lastSignin = todayKey;
        saveGrowth(session.username, data);
        addLog('signin', '用户 ' + session.username + ' 签到 +' + earn + ' 积分（连续 ' + data.streak + ' 天）');
        if (window.markTaskDone) window.markTaskDone('signin');
        renderGrowth();
        showToast('签到成功，积分 +' + earn + '，连续签到 ' + data.streak + ' 天', 'success');
    };

    function renderContentCards(excludeAuthor) {
        var listEl = document.getElementById('contentList');
        var emptyEl = document.getElementById('contentEmpty');
        if (!listEl) return;
        var contents = getContents();
        var session = getSession();
        var username = session ? session.username : '';
        if (emptyEl) emptyEl.style.display = contents.length ? 'none' : 'block';
        var html = '';
        for (var i = 0; i < contents.length; i++) {
            var item = contents[i];
            var likes = getContentLikes(item.id);
            var comments = getContentComments(item.id);
            var liked = username ? isContentLikedBy(item.id, username) : false;
            var favs = username ? getFavorites(username) : [];
            var faved = favs.indexOf(item.id) !== -1;
            html += '<div class="content-card" data-content-id="' + item.id + '"><div class="content-card-head">' +
                '<span class="content-card-title">' + escapeHtml(item.title) + '</span>' +
                '<span class="content-card-meta">' + escapeHtml(item.author) + ' · ' + escapeHtml(item.time || '') + '</span></div>' +
                '<p class="content-card-body">' + escapeHtml(item.body) + '</p>' +
                '<div class="content-card-actions">' +
                '<button class="btn btn-secondary btn-xs like-btn" data-id="' + item.id + '">' + (liked ? '已赞' : '点赞') + ' (' + likes + ')</button>' +
                '<button class="btn btn-secondary btn-xs comment-toggle" data-id="' + item.id + '">评论 (' + comments.length + ')</button>' +
                '<button class="btn btn-secondary btn-xs fav-btn" data-id="' + item.id + '">' + (faved ? '取消收藏' : '收藏') + '</button>' +
                '</div>' +
                '<div class="comment-box" style="display:none;" data-comment-id="' + item.id + '">' +
                '<div class="comment-list" data-comment-list="' + item.id + '">' + renderCommentList(item.id) + '</div>' +
                '<div class="comment-input-row">' +
                '<input type="text" class="comment-input" placeholder="说点什么..." maxlength="200">' +
                '<button class="btn btn-primary btn-xs comment-submit" data-id="' + item.id + '">发送</button>' +
                '</div></div></div>';
        }
        listEl.innerHTML = html;
        bindContentCardEvents();
    }

    function getContentLikes(contentId) {
        var map = getInteractions();
        return (map.likes && map.likes[contentId]) || 0;
    }
    function getContentComments(contentId) {
        var map = getInteractions();
        return (map.comments && map.comments[contentId]) || [];
    }
    function isContentLikedBy(contentId, username) {
        var map = getInteractions();
        var arr = (map.likers && map.likers[contentId]) || [];
        return arr.indexOf(username) !== -1;
    }
    function renderCommentList(contentId) {
        var list = getContentComments(contentId);
        if (!list.length) return '<p class="comment-empty">暂无评论，快来抢沙发～</p>';
        var html = '';
        for (var i = 0; i < list.length; i++) {
            html += '<div class="comment-item"><span class="comment-author">' + escapeHtml(list[i].author) + '</span>' +
                '<span class="comment-text">' + escapeHtml(list[i].text) + '</span>' +
                '<span class="comment-time">' + escapeHtml(list[i].time || '') + '</span></div>';
        }
        return html;
    }
    function bindContentCardEvents() {
        var likeBtns = document.querySelectorAll('.like-btn');
        for (var i = 0; i < likeBtns.length; i++) {
            likeBtns[i].addEventListener('click', function (e) {
                var id = this.getAttribute('data-id');
                toggleContentLike(id);
            });
        }
        var favBtns = document.querySelectorAll('.fav-btn');
        for (var j = 0; j < favBtns.length; j++) {
            favBtns[j].addEventListener('click', function (e) {
                var id = this.getAttribute('data-id');
                toggleContentFavorite(id);
            });
        }
        var toggles = document.querySelectorAll('.comment-toggle');
        for (var k = 0; k < toggles.length; k++) {
            toggles[k].addEventListener('click', function (e) {
                var id = this.getAttribute('data-id');
                var box = document.querySelector('.comment-box[data-comment-id="' + id + '"]');
                if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
            });
        }
        var submits = document.querySelectorAll('.comment-submit');
        for (var m = 0; m < submits.length; m++) {
            submits[m].addEventListener('click', function (e) {
                var id = this.getAttribute('data-id');
                var box = this.closest('.comment-box');
                var input = box ? box.querySelector('.comment-input') : null;
                if (input && input.value.trim()) {
                    addContentComment(id, input.value.trim());
                    input.value = '';
                }
            });
        }
    }
    function toggleContentLike(contentId) {
        var session = getSession();
        if (!session) { window.location.href = 'login.html'; return; }
        var map = getInteractions();
        if (!map.likes) map.likes = {};
        if (!map.likers) map.likers = {};
        if (!map.likes[contentId]) map.likes[contentId] = 0;
        if (!map.likers[contentId]) map.likers[contentId] = [];
        var liked = map.likers[contentId].indexOf(session.username) !== -1;
        if (liked) {
            map.likes[contentId] = Math.max(0, map.likes[contentId] - 1);
            map.likers[contentId].splice(map.likers[contentId].indexOf(session.username), 1);
            addActivity(session.username, '点赞', '取消了对一条内容的点赞');
        } else {
            map.likes[contentId] += 1;
            map.likers[contentId].push(session.username);
            addActivity(session.username, '点赞', '点赞了一条内容');
            if (window.markTaskDone) window.markTaskDone('like');
            if (window.notifyContentLike) window.notifyContentLike(contentId);
        }
        saveInteractions(map);
        renderContentCards();
    }
    function toggleContentFavorite(contentId) {
        var session = getSession();
        if (!session) { window.location.href = 'login.html'; return; }
        contentId = Number(contentId);
        var list = getFavorites(session.username);
        var idx = list.indexOf(contentId);
        if (idx !== -1) {
            list.splice(idx, 1);
            addActivity(session.username, '收藏', '取消收藏了一条内容');
        } else {
            list.push(contentId);
            addActivity(session.username, '收藏', '收藏了一条内容');
        }
        saveFavorites(session.username, list);
        renderContentCards();
    }
    function addContentComment(contentId, text) {
        var session = getSession();
        if (!session) { window.location.href = 'login.html'; return; }
        var map = getInteractions();
        if (!map.comments) map.comments = {};
        if (!map.comments[contentId]) map.comments[contentId] = [];
        map.comments[contentId].push({ author: session.username, text: text, time: nowText() });
        saveInteractions(map);
        addActivity(session.username, '评论', '评论了一条内容');
        if (window.markTaskDone) window.markTaskDone('comment');
        if (window.notifyContentComment) window.notifyContentComment(contentId, text);
        renderContentCards();
    }

    function nowText() {
        var d = new Date();
        return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + ' ' + d.getHours() + ':' + d.getMinutes();
    }
    function addActivity(username, type, detail) {
        try {
            var key = 'userActivity_' + username;
            var list = [];
            try { list = JSON.parse(dataStore.get(key) || '[]'); } catch (e) { list = []; }
            list.unshift({ type: type, detail: detail, time: nowText() });
            if (list.length > 100) list.length = 100;
            dataStore.set(key, JSON.stringify(list));
        } catch (e) { /* ignore */ }
    }

    // ========== 个人信息页新增面板渲染（消息中心 / 收藏 / 动态）==========
    function renderUserMessages() {
        var listEl = document.getElementById('userMessagesList');
        if (!listEl) return;
        var session = getSession();
        if (!session) return;
        var messages = getMessages();
        var mine = [];
        for (var i = 0; i < messages.length; i++) {
            var m = messages[i];
            if (m.recipient === 'all' || m.recipient === session.username) mine.push(m);
        }
        var emptyEl = document.getElementById('userMessagesEmpty');
        if (emptyEl) emptyEl.style.display = mine.length ? 'none' : 'block';
        var html = '';
        for (var j = 0; j < mine.length; j++) {
            var item = mine[j];
            html += '<div class="message-item' + (item.status === 'unread' ? ' unread' : '') + '">' +
                '<div class="message-head"><span class="message-title">' + escapeHtml(item.subject) + '</span>' +
                '<span class="message-time">' + escapeHtml(item.sentAt ? new Date(item.sentAt).toLocaleString('zh-CN') : (item.time || '')) + '</span></div>' +
                '<p class="message-body">' + escapeHtml(item.body) + '</p>' +
                '<div class="message-actions">' +
                (item.status === 'unread' ? '<button class="btn btn-secondary btn-xs msg-read-btn" data-id="' + item.id + '">标记已读</button>' : '<span class="message-read-tag">已读</span>') +
                '</div></div>';
        }
        listEl.innerHTML = html;
        var readBtns = listEl.querySelectorAll('.msg-read-btn');
        for (var k = 0; k < readBtns.length; k++) {
            readBtns[k].addEventListener('click', function () {
                var id = parseInt(this.getAttribute('data-id'), 10);
                var messages = getMessages();
                for (var x = 0; x < messages.length; x++) {
                    if (messages[x].id === id) messages[x].status = 'read';
                }
                saveMessages(messages);
                renderUserMessages();
            });
        }
    }

    function renderFavorites() {
        var listEl = document.getElementById('favoriteList');
        if (!listEl) return;
        var session = getSession();
        if (!session) return;
        var favIds = getFavorites(session.username).map(function (x) { return Number(x); });
        var contents = getContents();
        var matched = [];
        for (var i = 0; i < contents.length; i++) {
            if (favIds.indexOf(contents[i].id) !== -1) matched.push(contents[i]);
        }
        var emptyEl = document.getElementById('favoriteEmpty');
        if (emptyEl) emptyEl.style.display = matched.length ? 'none' : 'block';
        var html = '';
        for (var j = 0; j < matched.length; j++) {
            var item = matched[j];
            html += '<div class="favorite-item"><div class="content-card-head">' +
                '<span class="content-card-title">' + escapeHtml(item.title) + '</span>' +
                '<span class="content-card-meta">' + escapeHtml(item.author) + ' · ' + escapeHtml(item.time || '') + '</span></div>' +
                '<p class="content-card-body">' + escapeHtml(item.body) + '</p>' +
                '<button class="btn btn-danger btn-xs fav-remove-btn" data-id="' + item.id + '">取消收藏</button></div>';
        }
        listEl.innerHTML = html;
        var removeBtns = listEl.querySelectorAll('.fav-remove-btn');
        for (var k = 0; k < removeBtns.length; k++) {
            removeBtns[k].addEventListener('click', function () {
                var id = parseInt(this.getAttribute('data-id'), 10);
                var list = getFavorites(session.username);
                var idx = list.indexOf(id);
                if (idx !== -1) list.splice(idx, 1);
                saveFavorites(session.username, list);
                renderFavorites();
            });
        }
    }

    function renderActivityTimeline() {
        var listEl = document.getElementById('activityTimeline');
        if (!listEl) return;
        var session = getSession();
        if (!session) return;
        var list = [];
        try { list = JSON.parse(dataStore.get('userActivity_' + session.username) || '[]'); } catch (e) { list = []; }
        var emptyEl = document.getElementById('timelineEmpty');
        if (emptyEl) emptyEl.style.display = list.length ? 'none' : 'block';
        var html = '';
        for (var i = 0; i < list.length; i++) {
            var item = list[i];
            html += '<div class="activity-item"><span class="activity-time">' + escapeHtml(item.time || '') + '</span>' +
                '<span class="activity-type">' + escapeHtml(item.type || '') + '</span>' +
                '<span class="activity-detail">' + escapeHtml(item.detail || '') + '</span></div>';
        }
        listEl.innerHTML = html;
    }

    // ========== 个人信息页面（profile.html）==========
    var profileForm = document.getElementById('profileForm');
    if (profileForm) {
        var session = getSession();
        if (!session) {
            window.location.href = 'login.html';
        } else {
            loadProfile(session.username);
            renderGrowth();
            initBackTop();
            var signinBtn = document.getElementById('growthSigninBtn');
            if (signinBtn) signinBtn.addEventListener('click', function () { window.doSignin(); });
        }
    }

    function loadProfile(username) {
        var users = getUsers();
        var user = null;
        for (var i = 0; i < users.length; i++) {
            if (users[i].username === username) { user = users[i]; break; }
        }
        if (!user) { window.location.href = 'login.html'; return; }

        ensureAccountId(user);
        if (document.getElementById('profileAccountId')) {
            document.getElementById('profileAccountId').value = user.accountId || '未分配';
        }
        document.getElementById('profileUsername').value = user.username;
        document.getElementById('profileNickname').value = user.nickname || '';
        document.getElementById('profileAvatarUrl').value = user.avatarUrl || '';
        document.getElementById('profileBio').value = user.bio || '';
        document.getElementById('profileEmail').value = user.email || '';
        if (document.getElementById('profilePhone')) {
            document.getElementById('profilePhone').value = user.phone || '';
        }
        if (document.getElementById('profileGender')) {
            document.getElementById('profileGender').value = user.gender || '';
        }
        if (document.getElementById('profileBirthday')) {
            document.getElementById('profileBirthday').value = user.birthday || '';
        }
        if (document.getElementById('profileLocation')) {
            document.getElementById('profileLocation').value = user.location || '';
        }

        updateAvatarPreview(user.avatarUrl);
        updateProfileCompletion(user);
    }

    function updateAvatarPreview(avatarUrl) {
        var preview = document.getElementById('avatarPreview');
        if (!preview) return;
        if (avatarUrl) {
            preview.innerHTML = '<img src="' + escapeHtml(avatarUrl) + '" alt="头像" onerror="this.style.display=\'none\'">';
        } else {
            preview.innerHTML = '<div class="avatar-placeholder">' + getInitials() + '</div>';
        }
    }

    function getInitials() {
        var nickname = document.getElementById('profileNickname').value.trim();
        if (!nickname) {
            var username = document.getElementById('profileUsername').value;
            return username.substring(0, 2).toUpperCase();
        }
        return nickname.substring(0, 2).toUpperCase();
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    if (profileForm) {
        profileForm.addEventListener('submit', function (e) {
            e.preventDefault();
            clearError();

            var nickname = document.getElementById('profileNickname').value.trim();
            var avatarUrl = document.getElementById('profileAvatarUrl').value.trim();
            var bio = document.getElementById('profileBio').value.trim();
            var email = document.getElementById('profileEmail').value.trim();
            var phone = document.getElementById('profilePhone') ? document.getElementById('profilePhone').value.trim() : '';
            var gender = document.getElementById('profileGender') ? document.getElementById('profileGender').value : '';
            var birthday = document.getElementById('profileBirthday') ? document.getElementById('profileBirthday').value : '';
            var location = document.getElementById('profileLocation') ? document.getElementById('profileLocation').value.trim() : '';

            if (nickname.length > 20) { showError('昵称最多20个字符'); return; }
            if (phone && !isValidPhone(phone)) { showError('手机号格式不正确（11位，1开头）'); return; }
            if (email && !isValidEmail(email)) { showError('邮箱格式不正确'); return; }

            var users = getUsers();
            var session = getSession();
            var currentUsername = session.username;
            if (phone && isPhoneTaken(users, phone, currentUsername)) { showError('该手机号已被其它账号使用'); return; }
            if (email && isEmailTaken(users, email, currentUsername)) { showError('该邮箱已被其它账号使用'); return; }
            var savedProfileUser = null;
            for (var i = 0; i < users.length; i++) {
                if (users[i].username === currentUsername) {
                    users[i].nickname = nickname;
                    users[i].avatarUrl = avatarUrl;
                    users[i].bio = bio;
                    users[i].email = email;
                    users[i].phone = phone;
                    users[i].gender = gender;
                    users[i].birthday = birthday;
                    users[i].location = location;
                    savedProfileUser = users[i];
                    break;
                }
            }
            saveUsers(users);
            addLog('profile', '用户资料更新：' + currentUsername);
            alert('个人信息保存成功！');
            updateAvatarPreview(avatarUrl);
            updateProfileCompletion(savedProfileUser);
        });
    }

    var avatarInput = document.getElementById('profileAvatarUrl');
    if (avatarInput) {
        avatarInput.addEventListener('input', function () {
            updateAvatarPreview(this.value.trim());
        });
    }

    // 头像本地上传：压缩为 dataURL 后写入 URL 输入框
    var avatarFileInput = document.getElementById('avatarFileInput');
    if (avatarFileInput) {
        avatarFileInput.addEventListener('change', function () {
            var file = this.files && this.files[0];
            if (!file) return;
            if (!/^image\//.test(file.type)) { alert('请选择图片文件'); this.value = ''; return; }
            if (file.size > 5 * 1024 * 1024) { alert('图片过大，请选择 5MB 以内的图片'); this.value = ''; return; }
            var reader = new FileReader();
            reader.onload = function (ev) {
                var img = new Image();
                img.onload = function () {
                    var maxSize = 240;
                    var scale = Math.min(1, maxSize / Math.max(img.width, img.height));
                    var w = Math.max(1, Math.round(img.width * scale));
                    var h = Math.max(1, Math.round(img.height * scale));
                    var canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    var ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    var dataUrl = canvas.toDataURL('image/jpeg', 0.82);
                    var urlInput = document.getElementById('profileAvatarUrl');
                    if (urlInput) urlInput.value = dataUrl;
                    updateAvatarPreview(dataUrl);
                };
                img.onerror = function () { alert('图片读取失败，请换一张试试'); };
                img.src = ev.target.result;
            };
            reader.onerror = function () { alert('图片读取失败，请重试'); };
            reader.readAsDataURL(file);
            this.value = '';
        });
    }

    // ========== 内置头像库 ==========
    var AVATAR_LIBRARY = [
        { emoji: '😀', bg: '#667eea' },
        { emoji: '😎', bg: '#764ba2' },
        { emoji: '🐱', bg: '#f0932b' },
        { emoji: '🐶', bg: '#6ab04c' },
        { emoji: '🌸', bg: '#eb4d4b' },
        { emoji: '🚀', bg: '#0984e3' },
        { emoji: '🌟', bg: '#fdcb6e' },
        { emoji: '🎯', bg: '#e17055' }
    ];
    function makeAvatarSvg(emoji, bg) {
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">' +
            '<rect width="240" height="240" rx="120" fill="' + bg + '"/>' +
            '<text x="120" y="150" font-size="110" text-anchor="middle">' + emoji + '</text></svg>';
        return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    }
    function renderAvatarLibrary() {
        var grid = document.getElementById('avatarLibraryGrid');
        if (!grid) return;
        var html = '';
        for (var i = 0; i < AVATAR_LIBRARY.length; i++) {
            var item = AVATAR_LIBRARY[i];
            html += '<div class="avatar-lib-item" data-index="' + i + '" title="选择此头像">' +
                '<img src="' + makeAvatarSvg(item.emoji, item.bg) + '" alt="内置头像"></div>';
        }
        grid.innerHTML = html;
    }
    function openAvatarLibrary() {
        renderAvatarLibrary();
        var modal = document.getElementById('avatarLibraryModal');
        if (modal) modal.style.display = 'flex';
    }
    function closeAvatarLibrary() {
        var modal = document.getElementById('avatarLibraryModal');
        if (modal) modal.style.display = 'none';
    }
    var avatarLibraryBtn = document.getElementById('avatarLibraryBtn');
    var avatarLibraryClose = document.getElementById('avatarLibraryClose');
    var avatarLibraryCancel = document.getElementById('avatarLibraryCancel');
    var avatarLibraryGrid = document.getElementById('avatarLibraryGrid');
    var avatarLibraryModal = document.getElementById('avatarLibraryModal');
    if (avatarLibraryBtn) avatarLibraryBtn.addEventListener('click', openAvatarLibrary);
    if (avatarLibraryClose) avatarLibraryClose.addEventListener('click', closeAvatarLibrary);
    if (avatarLibraryCancel) avatarLibraryCancel.addEventListener('click', closeAvatarLibrary);
    if (avatarLibraryModal) {
        avatarLibraryModal.addEventListener('click', function (e) {
            if (e.target === avatarLibraryModal) closeAvatarLibrary();
        });
    }
    if (avatarLibraryGrid) {
        avatarLibraryGrid.addEventListener('click', function (e) {
            var target = e.target;
            var itemEl = null;
            while (target && target !== avatarLibraryGrid) {
                if (target.classList && target.classList.contains('avatar-lib-item')) { itemEl = target; break; }
                target = target.parentNode;
            }
            if (!itemEl) return;
            var idx = parseInt(itemEl.getAttribute('data-index'), 10) || 0;
            var item = AVATAR_LIBRARY[idx];
            var dataUrl = makeAvatarSvg(item.emoji, item.bg);
            var urlInput = document.getElementById('profileAvatarUrl');
            if (urlInput) urlInput.value = dataUrl;
            updateAvatarPreview(dataUrl);
            closeAvatarLibrary();
        });
    }

    // 资料完成度：统计已填字段比例
    function updateProfileCompletion(user) {
        if (!user) return;
        var fields = ['nickname', 'avatarUrl', 'bio', 'phone', 'email', 'gender', 'birthday', 'location'];
        var filled = 0;
        for (var i = 0; i < fields.length; i++) {
            if (user[fields[i]]) filled++;
        }
        var percent = Math.round(filled / fields.length * 100);
        var barEl = document.getElementById('completionBar');
        var percentEl = document.getElementById('completionPercent');
        if (barEl) barEl.style.width = percent + '%';
        if (percentEl) percentEl.textContent = percent + '%';
    }

    var nicknameInput = document.getElementById('profileNickname');
    if (nicknameInput) {
        nicknameInput.addEventListener('input', function () {
            var currentAvatar = document.getElementById('profileAvatarUrl').value.trim();
            if (!currentAvatar) {
                updateAvatarPreview(currentAvatar);
            }
        });
    }

    // ========== 帮助中心 FAQ 手风琴 ==========
    var faqList = document.getElementById('faqList');
    if (faqList) {
        faqList.addEventListener('click', function (e) {
            var q = e.target.closest ? e.target.closest('.faq-question') : null;
            if (!q) return;
            var item = q.parentNode;
            if (!item || !item.classList) return;
            if (item.classList.contains('open')) {
                item.classList.remove('open');
            } else {
                var items = faqList.querySelectorAll('.faq-item');
                for (var i = 0; i < items.length; i++) {
                    items[i].classList.remove('open');
                }
                item.classList.add('open');
            }
        });
    }

    // ========== 账号与安全 ==========
    var securityForm = document.getElementById('changePasswordForm');
    if (securityForm) {
        securityForm.addEventListener('submit', function (e) {
            e.preventDefault();
            clearError();

            var currentPwd = document.getElementById('currentPassword').value;
            var newPwd = document.getElementById('newPassword').value;
            var confirmPwd = document.getElementById('confirmNewPassword').value;

            if (!currentPwd || !newPwd || !confirmPwd) { showError('请填写所有密码字段'); return; }

            var session = getSession();
            var users = getUsers();
            var found = null;
            for (var i = 0; i < users.length; i++) {
                if (users[i].username === session.username) { found = users[i]; break; }
            }
            if (!found || found.password !== currentPwd) { showError('原密码错误'); return; }

            var strength = checkPasswordStrength(newPwd);
            if (!strength.ok) { showError(strength.tip); return; }
            if (newPwd !== confirmPwd) { showError('两次输入的新密码不一致'); return; }

            found.password = newPwd;
            saveUsers(users);
            addLog('change_password', '修改密码成功');
            alert('密码修改成功！请使用新密码登录。');
            window.location.href = 'login.html';
        });
    }

    // 绑定/解绑手机/邮箱
    function updateSecurityBindings() {
        var session = getSession();
        var users = getUsers();
        var user = null;
        for (var i = 0; i < users.length; i++) {
            if (users[i].username === session.username) { user = users[i]; break; }
        }
        if (!user) return;

        var phoneEl = document.getElementById('secPhoneDisplay');
        var emailEl = document.getElementById('secEmailDisplay');
        var bindPhoneBtn = document.getElementById('secBindPhoneBtn');
        var unbindPhoneBtn = document.getElementById('secUnbindPhoneBtn');
        var bindEmailBtn = document.getElementById('secBindEmailBtn');
        var unbindEmailBtn = document.getElementById('secUnbindEmailBtn');

        if (phoneEl) phoneEl.textContent = user.phone ? user.phone : '未绑定';
        if (emailEl) emailEl.textContent = user.email ? user.email : '未绑定';

        if (bindPhoneBtn && unbindPhoneBtn) {
            bindPhoneBtn.style.display = user.phone ? 'none' : '';
            unbindPhoneBtn.style.display = user.phone ? '' : 'none';
        }
        if (bindEmailBtn && unbindEmailBtn) {
            bindEmailBtn.style.display = user.email ? 'none' : '';
            unbindEmailBtn.style.display = user.email ? '' : 'none';
        }
    }

    // 标签页切换
    var tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            var tabName = this.getAttribute('data-tab');
            tabBtns.forEach(function(b) { b.classList.remove('active'); });
            this.classList.add('active');
            document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
            var panel = document.getElementById('panel-' + tabName);
            if (panel) panel.classList.add('active');
            if (tabName === 'security') {
                updateSecurityBindings();
                renderDeviceTable();
                renderUserLogs();
            }
            if (tabName === 'messages') renderUserMessages();
            if (tabName === 'favorites') renderFavorites();
            if (tabName === 'timeline') renderActivityTimeline();
        });
    });

    // 绑定手机弹窗
    var bindPhoneModal = document.getElementById('bindPhoneModal');
    var bindPhoneClose = document.getElementById('bindPhoneClose');
    var bindPhoneCancel = document.getElementById('bindPhoneCancel');
    var bindPhoneSubmit = document.getElementById('bindPhoneSubmit');
    var bindPhoneInput = document.getElementById('bindPhoneInput');

    if (document.getElementById('secBindPhoneBtn')) {
        document.getElementById('secBindPhoneBtn').addEventListener('click', function() {
            if (!bindPhoneModal) return;
            bindPhoneModal.style.display = 'flex';
            bindPhoneInput.value = '';
        });
    }
    if (bindPhoneClose) bindPhoneClose.addEventListener('click', function() { bindPhoneModal.style.display = 'none'; });
    if (bindPhoneCancel) bindPhoneCancel.addEventListener('click', function() { bindPhoneModal.style.display = 'none'; });
    if (bindPhoneModal) bindPhoneModal.addEventListener('click', function(e) { if (e.target === bindPhoneModal) bindPhoneModal.style.display = 'none'; });
    if (bindPhoneSubmit) {
        bindPhoneSubmit.addEventListener('click', function() {
            var phone = bindPhoneInput.value.trim();
            if (!phone) { alert('请输入手机号'); return; }
            if (!isValidPhone(phone)) { alert('手机号格式不正确'); return; }
            var session = getSession();
            var users = getUsers();
            if (isPhoneTaken(users, phone, session.username)) { alert('该手机号已被其它账号使用'); return; }
            for (var i = 0; i < users.length; i++) {
                if (users[i].username === session.username) {
                    users[i].phone = phone;
                    break;
                }
            }
            saveUsers(users);
            addLog('bind_phone', '绑定手机：' + phone + ' (' + session.username + ')');
            bindPhoneModal.style.display = 'none';
            updateSecurityBindings();
            alert('手机绑定成功！');
        });
    }

    // 解绑手机
    if (document.getElementById('secUnbindPhoneBtn')) {
        document.getElementById('secUnbindPhoneBtn').addEventListener('click', function() {
            if (!confirm('确定要解绑手机号吗？')) return;
            var session = getSession();
            var users = getUsers();
            for (var i = 0; i < users.length; i++) {
                if (users[i].username === session.username) {
                    users[i].phone = '';
                    break;
                }
            }
            saveUsers(users);
            addLog('unbind_phone', '解绑手机 (' + session.username + ')');
            updateSecurityBindings();
            alert('手机已解绑！');
        });
    }

    // 绑定邮箱弹窗
    var bindEmailModal = document.getElementById('bindEmailModal');
    var bindEmailClose = document.getElementById('bindEmailClose');
    var bindEmailCancel = document.getElementById('bindEmailCancel');
    var bindEmailSubmit = document.getElementById('bindEmailSubmit');
    var bindEmailInput = document.getElementById('bindEmailInput');

    if (document.getElementById('secBindEmailBtn')) {
        document.getElementById('secBindEmailBtn').addEventListener('click', function() {
            if (!bindEmailModal) return;
            bindEmailModal.style.display = 'flex';
            bindEmailInput.value = '';
        });
    }
    if (bindEmailClose) bindEmailClose.addEventListener('click', function() { bindEmailModal.style.display = 'none'; });
    if (bindEmailCancel) bindEmailCancel.addEventListener('click', function() { bindEmailModal.style.display = 'none'; });
    if (bindEmailModal) bindEmailModal.addEventListener('click', function(e) { if (e.target === bindEmailModal) bindEmailModal.style.display = 'none'; });
    if (bindEmailSubmit) {
        bindEmailSubmit.addEventListener('click', function() {
            var email = bindEmailInput.value.trim();
            if (!email) { alert('请输入邮箱地址'); return; }
            if (!isValidEmail(email)) { alert('邮箱格式不正确'); return; }
            var session = getSession();
            var users = getUsers();
            if (isEmailTaken(users, email, session.username)) { alert('该邮箱已被其它账号使用'); return; }
            for (var i = 0; i < users.length; i++) {
                if (users[i].username === session.username) {
                    users[i].email = email;
                    break;
                }
            }
            saveUsers(users);
            addLog('bind_email', '绑定邮箱：' + email + ' (' + session.username + ')');
            bindEmailModal.style.display = 'none';
            updateSecurityBindings();
            alert('邮箱绑定成功！');
        });
    }

    // 解绑邮箱
    if (document.getElementById('secUnbindEmailBtn')) {
        document.getElementById('secUnbindEmailBtn').addEventListener('click', function() {
            if (!confirm('确定要解绑邮箱吗？')) return;
            var session = getSession();
            var users = getUsers();
            for (var i = 0; i < users.length; i++) {
                if (users[i].username === session.username) {
                    users[i].email = '';
                    break;
                }
            }
            saveUsers(users);
            addLog('unbind_email', '解绑邮箱 (' + session.username + ')');
            updateSecurityBindings();
            alert('邮箱已解绑！');
        });
    }

    // 登录设备管理
    function getDevices() {
        try { return JSON.parse(dataStore.get('userDevices_' + (getSession().username || '')) || '[]'); } catch(e) { return []; }
    }
    function saveDevices(devices) {
        dataStore.set('userDevices_' + (getSession().username || ''), JSON.stringify(devices));
    }
    function renderDeviceTable() {
        var devices = getDevices();
        var tbody = document.getElementById('deviceTableBody');
        var emptyEl = document.getElementById('deviceEmpty');
        if (!tbody) return;
        if (devices.length === 0) {
            tbody.innerHTML = '';
            if (emptyEl) emptyEl.style.display = 'block';
            return;
        }
        if (emptyEl) emptyEl.style.display = 'none';
        var html = '';
        for (var i = 0; i < devices.length; i++) {
            var d = devices[i];
            var isCurrent = d.isCurrent ? '<span style="color:#667eea;font-weight:bold;">当前设备</span>' : '<span style="color:#999;">已踢出</span>';
            html += '<tr><td>' + escapeHtml(d.type) + '</td><td>' + escapeHtml(d.ip) + '</td><td>' + escapeHtml(d.time) + '</td><td>' + isCurrent + '</td><td>' + (d.isCurrent ? '-' : '<button class="btn btn-danger btn-sm" onclick="kickDevice(\'' + d.id + '\')">踢出</button>') + '</td></tr>';
        }
        tbody.innerHTML = html;
    }
    window.kickDevice = function(deviceId) {
        if (!confirm('确定踢出该设备？')) return;
        var devices = getDevices();
        for (var i = 0; i < devices.length; i++) {
            if (devices[i].id === deviceId) {
                devices[i].isCurrent = false;
                break;
            }
        }
        saveDevices(devices);
        addLog('kick_device', '踢出设备：' + deviceId);
        renderDeviceTable();
    };

    // 操作日志查看
    function renderUserLogs() {
        var allLogs = JSON.parse(dataStore.get('adminLogs') || '[]');
        var session = getSession();
        var myLogs = allLogs.filter(function(log) { return log.admin === session.username; });
        var tbody = document.getElementById('userLogTableBody');
        var emptyEl = document.getElementById('logEmpty');
        if (!tbody) return;
        if (myLogs.length === 0) {
            tbody.innerHTML = '';
            if (emptyEl) emptyEl.style.display = 'block';
            return;
        }
        if (emptyEl) emptyEl.style.display = 'none';
        var actionLabels = {
            login: '登录', register: '注册', delete_user: '删除用户', change_role: '角色变更',
            update_profile: '更新资料', update_settings: '系统设置', create_content: '创建内容',
            edit_content: '编辑内容', delete_content: '删除内容', upload_file: '上传文件',
            download_file: '下载文件', delete_file: '删除文件', send_message: '发送消息',
            export_users: '导出用户', reset_password: '找回密码', change_password: '修改密码',
            bind_phone: '绑定手机', unbind_phone: '解绑手机', bind_email: '绑定邮箱',
            unbind_email: '解绑邮箱', kick_device: '踢出设备', delete_account: '注销账号'
        };
        var html = '';
        for (var i = 0; i < myLogs.length; i++) {
            var log = myLogs[i];
            html += '<tr><td>' + escapeHtml(log.time) + '</td><td>' + escapeHtml(actionLabels[log.action] || log.action) + '</td><td>' + escapeHtml(log.detail) + '</td></tr>';
        }
        tbody.innerHTML = html;
    }

    // 初始化设备记录（首次访问时添加当前设备）
    (function initDeviceRecord() {
        var session = getSession();
        if (!session) return;
        var devices = getDevices();
        var hasCurrent = false;
        for (var i = 0; i < devices.length; i++) {
            if (devices[i].isCurrent) { hasCurrent = true; break; }
        }
        if (!hasCurrent) {
            var now = new Date().toLocaleString('zh-CN');
            devices.unshift({
                id: Date.now(),
                type: navigator.userAgent.indexOf('Mobile') !== -1 ? '移动设备' : '电脑浏览器',
                ip: '127.0.0.1',
                time: now,
                isCurrent: true
            });
            saveDevices(devices);
            addLog('login_device', '新设备登录：' + (navigator.userAgent.indexOf('Mobile') !== -1 ? '移动设备' : '电脑浏览器'));
        }
    })();

    // ========== 注销账号 ==========
    var deleteAccountModal = document.getElementById('deleteAccountModal');
    var deleteAccountClose = document.getElementById('deleteAccountClose');
    var deleteAccountCancel = document.getElementById('deleteAccountCancel');
    var deleteAccountConfirm = document.getElementById('deleteAccountConfirm');
    var deleteAccountInput = document.getElementById('deleteAccountPassword');

    // 仅普通用户展示注销入口（超级管理员不提供注销，避免系统失去管理员）
    (function initDeleteAccountZone() {
        var dangerZone = document.getElementById('dangerZone');
        var deleteAccountBtn = document.getElementById('deleteAccountBtn');
        if (!dangerZone || !deleteAccountBtn) return;
        var session = getSession();
        var users = getUsers();
        var user = session ? findUserByUsername(users, session.username) : null;
        if (!user || user.role === 'super_admin') {
            dangerZone.style.display = 'none';
            return;
        }
        deleteAccountBtn.addEventListener('click', function () {
            if (!deleteAccountModal) return;
            deleteAccountModal.style.display = 'flex';
            deleteAccountModal.classList.add('modal-in');
            deleteAccountInput.value = '';
            deleteAccountInput.focus();
        });
    })();

    if (deleteAccountClose) deleteAccountClose.addEventListener('click', function () { deleteAccountModal.style.display = 'none'; });
    if (deleteAccountCancel) deleteAccountCancel.addEventListener('click', function () { deleteAccountModal.style.display = 'none'; });
    if (deleteAccountModal) deleteAccountModal.addEventListener('click', function (e) { if (e.target === deleteAccountModal) deleteAccountModal.style.display = 'none'; });

    if (deleteAccountConfirm) {
        deleteAccountConfirm.addEventListener('click', function () {
            var session = getSession();
            if (!session) { window.location.href = 'login.html'; return; }
            var pwd = deleteAccountInput.value;
            if (!pwd) { alert('请输入登录密码以确认身份'); return; }
            var users = getUsers();
            var user = findUserByUsername(users, session.username);
            if (!user) { alert('账号不存在或已被删除'); window.location.href = 'login.html'; return; }
            if (user.password !== pwd) { alert('密码错误，无法注销账号'); deleteAccountInput.value = ''; deleteAccountInput.focus(); return; }
            if (user.role === 'super_admin') { alert('超级管理员账号不允许注销'); deleteAccountModal.style.display = 'none'; return; }

            // 记录注销日志（需在清除会话前调用，addLog 依赖会话取操作人）
            addLog('delete_account', '用户注销账号：' + session.username);

            // 从用户表移除该用户
            var newUsers = [];
            for (var i = 0; i < users.length; i++) {
                if (users[i].username !== session.username) { newUsers.push(users[i]); }
            }
            saveUsers(newUsers);

            // 清理该用户的设备记录与登录会话
            try { dataStore.remove('userDevices_' + session.username); } catch (e) { /* ignore */ }
            clearSession();

            deleteAccountModal.style.display = 'none';
            alert('账号已注销，感谢使用！');
            window.location.href = 'login.html';
        });
    }

    // ========== 找回密码页面（forgot.html）==========
    var forgotForm = document.getElementById('forgotForm');
    if (forgotForm) {
        var sendCodeBtn = document.getElementById('sendCodeBtn');
        var codeTimer = null;
        var codeCountdown = 0;
        var resetCode = '';

        function startCountdown(seconds) {
            if (codeTimer) clearInterval(codeTimer);
            codeCountdown = seconds;
            codeTimer = setInterval(function () {
                if (codeCountdown <= 0) {
                    clearInterval(codeTimer);
                    codeTimer = null;
                    if (sendCodeBtn) {
                        sendCodeBtn.disabled = false;
                        sendCodeBtn.textContent = '获取验证码';
                    }
                    return;
                }
                if (sendCodeBtn) {
                    sendCodeBtn.disabled = true;
                    sendCodeBtn.textContent = '重新获取(' + codeCountdown + 's)';
                }
                codeCountdown--;
            }, 1000);
        }

        if (sendCodeBtn) {
            sendCodeBtn.addEventListener('click', function () {
                var account = document.getElementById('forgotAccount').value.trim();
                var accountTip = document.getElementById('forgotAccountTip');
                var accountInput = document.getElementById('forgotAccount');
                if (accountTip) accountTip.textContent = '';

                if (!account) {
                    if (accountTip) accountTip.textContent = '请输入手机号或邮箱';
                    if (accountInput) accountInput.focus();
                    return;
                }
                if (!isValidPhone(account) && !isValidEmail(account)) {
                    if (accountTip) accountTip.textContent = '请输入正确的手机号（11位）或邮箱地址';
                    if (accountInput) accountInput.focus();
                    return;
                }

                var users = getUsers();
                var target = findUserByAccount(users, account);
                if (!target) {
                    if (accountTip) accountTip.textContent = '该手机号/邮箱未注册，无法找回密码';
                    if (accountInput) accountInput.focus();
                    return;
                }

                resetCode = String(Math.floor(100000 + Math.random() * 900000));
                dataStore.set('forgotCode', resetCode);
                dataStore.set('forgotTarget', account);
                dataStore.set('forgotTargetUsername', target.username);
                // 前端模拟发送验证码（真实项目中这里应调用短信/邮件服务）
                alert('验证码已发送至 ' + account + '（模拟）\n验证码：' + resetCode);
                startCountdown(60);
                if (accountTip) accountTip.textContent = '验证码已发送，请注意查收（模拟环境显示在弹窗中）';
            });
        }

        forgotForm.addEventListener('submit', function (e) {
            e.preventDefault();
            clearError();

            var account = document.getElementById('forgotAccount').value.trim();
            var code = document.getElementById('forgotCode').value.trim();
            var newPassword = document.getElementById('forgotNewPassword').value;
            var confirmPassword = document.getElementById('forgotConfirmPassword').value;

            if (!account) { showError('请输入手机号或邮箱'); return; }
            if (!code) { showError('请输入验证码'); return; }
            if (dataStore.get('forgotTarget') !== account) { showError('请先对当前账号发送验证码'); return; }
            if (dataStore.get('forgotCode') !== code) { showError('验证码错误或已过期'); return; }

            var strength = checkPasswordStrength(newPassword);
            if (!strength.ok) { showError(strength.tip); return; }
            if (newPassword !== confirmPassword) { showError('两次输入的密码不一致'); return; }

            var username = dataStore.get('forgotTargetUsername');
            var users = getUsers();
            var updated = false;
            for (var i = 0; i < users.length; i++) {
                if (users[i].username === username) {
                    users[i].password = newPassword;
                    updated = true;
                    break;
                }
            }
            if (!updated) { showError('账号不存在，请重新操作'); return; }

            saveUsers(users);
            dataStore.remove('forgotCode');
            dataStore.remove('forgotTarget');
            dataStore.remove('forgotTargetUsername');
            addLog('reset_password', '找回密码：' + username);
            alert('密码重置成功！请使用新密码登录。');
            window.location.href = 'login.html';
        });
    }

// ==================== [扩展] 社交关系链：好友 + 私信 + 在线状态 ====================
function fmtTime(ts) {
    var d = new Date(ts);
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function fmtDate(ts) {
    var d = new Date(ts);
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function _fbKey(u) { return 'siteFriends_' + u; }
function _getFriendList(u) { try { return JSON.parse(dataStore.get(_fbKey(u)) || '[]'); } catch (e) { return []; } }
function _saveFriendList(u, list) { dataStore.set(_fbKey(u), JSON.stringify(list)); }
function getFriendRequests() { try { return JSON.parse(dataStore.get('siteFriendRequests') || '[]'); } catch (e) { return []; } }
function saveFriendRequests(list) { dataStore.set('siteFriendRequests', JSON.stringify(list)); }
function getChats() { try { return JSON.parse(dataStore.get('siteChats') || '[]'); } catch (e) { return []; } }
function saveChats(list) { dataStore.set('siteChats', JSON.stringify(list)); }

function markOnline() {
    var s = getSession();
    if (!s || !s.username) return;
    var m = {}; try { m = JSON.parse(dataStore.get('siteOnline') || '{}'); } catch (e) { m = {}; }
    m[s.username] = Date.now();
    dataStore.set('siteOnline', JSON.stringify(m));
}
function isOnline(u) {
    var m = {}; try { m = JSON.parse(dataStore.get('siteOnline') || '{}'); } catch (e) { m = {}; }
    return m[u] && (Date.now() - m[u]) < 5 * 60 * 1000;
}
function lastSeenText(u) {
    var m = {}; try { m = JSON.parse(dataStore.get('siteOnline') || '{}'); } catch (e) { m = {}; }
    if (!m[u]) return '未在线';
    var diff = Date.now() - m[u];
    if (diff < 60 * 1000) return '刚刚在线';
    if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前在线';
    return Math.floor(diff / 3600000) + ' 小时前在线';
}

function sendFriendRequest(username, msg) {
    var s = getSession();
    if (!s || !s.username) { showToast('请先登录', 'warning'); return; }
    var me = s.username;
    if (me === username) { showToast('不能添加自己为好友', 'warning'); return; }
    if (_getFriendList(me).indexOf(username) !== -1) { showToast('你们已经是好友了', 'warning'); return; }
    var reqs = getFriendRequests();
    if (reqs.some(function (r) { return r.from === me && r.to === username && r.status === 'pending'; })) { showToast('已发送过申请，等待对方处理', 'warning'); return; }
    reqs.push({ id: Date.now(), from: me, to: username, msg: msg || '我想加你为好友', ts: Date.now(), status: 'pending' });
    saveFriendRequests(reqs);
    addLog('friend_req', '用户 ' + me + ' 向 ' + username + ' 发送好友申请');
    showToast('好友申请已发送', 'success');
    renderFriendRequests();
}
function respondFriendRequest(id, accept) {
    var s = getSession();
    if (!s || !s.username) return;
    var reqs = getFriendRequests();
    var idx = -1;
    for (var i = 0; i < reqs.length; i++) { if (reqs[i].id === id) { idx = i; break; } }
    if (idx === -1) return;
    var req = reqs[idx];
    if (req.to !== s.username) return;
    if (accept) {
        var myF = _getFriendList(req.to); if (myF.indexOf(req.from) === -1) { myF.push(req.from); _saveFriendList(req.to, myF); }
        var hisF = _getFriendList(req.from); if (hisF.indexOf(req.to) === -1) { hisF.push(req.to); _saveFriendList(req.from, hisF); }
        addLog('friend_add', '用户 ' + req.to + ' 与 ' + req.from + ' 成为好友');
        showToast('已接受 ' + req.from + ' 的好友申请', 'success');
    } else {
        addLog('friend_reject', '用户 ' + req.to + ' 拒绝了 ' + req.from + ' 的好友申请');
        showToast('已拒绝该好友申请', 'warning');
    }
    reqs.splice(idx, 1);
    saveFriendRequests(reqs);
    renderFriendRequests();
}
function removeFriend(friend) {
    var s = getSession();
    if (!s || !s.username) return;
    var myF = _getFriendList(s.username).filter(function (u) { return u !== friend; });
    _saveFriendList(s.username, myF);
    var hisF = _getFriendList(friend).filter(function (u) { return u !== s.username; });
    _saveFriendList(friend, hisF);
    addLog('friend_remove', '用户 ' + s.username + ' 删除了好友 ' + friend);
    showToast('已删除好友 ' + friend, 'success');
    renderFriendList();
    renderChatList();
}
function renderFriendRequests() {
    var el = document.getElementById('friendRequests');
    var emptyEl = document.getElementById('friendRequestsEmpty');
    if (!el) return;
    var s = getSession(); if (!s) return;
    var reqs = getFriendRequests().filter(function (r) { return r.to === s.username; });
    if (emptyEl) emptyEl.style.display = reqs.length ? 'none' : 'block';
    if (!reqs.length) { el.innerHTML = ''; return; }
    var html = '';
    reqs.forEach(function (r) {
        html += '<div class="friend-req-item"><div class="friend-req-info"><b>' + escapeHtml(r.from) + '</b>' +
            '<span>' + escapeHtml(r.msg || '') + '</span><em>' + fmtTime(r.ts) + '</em></div>' +
            '<div class="friend-req-actions">' +
            '<button class="btn btn-primary btn-xs" onclick="window.respondFriendRequest(' + r.id + ',true)">接受</button> ' +
            '<button class="btn btn-secondary btn-xs" onclick="window.respondFriendRequest(' + r.id + ',false)">拒绝</button>' +
            '</div></div>';
    });
    el.innerHTML = html;
}
function renderFriendList() {
    var el = document.getElementById('friendList');
    var emptyEl = document.getElementById('friendListEmpty');
    if (!el) return;
    var s = getSession(); if (!s) return;
    var friends = _getFriendList(s.username);
    if (emptyEl) emptyEl.style.display = friends.length ? 'none' : 'block';
    if (!friends.length) { el.innerHTML = ''; return; }
    var users = getUsers();
    var html = '';
    friends.forEach(function (f) {
        var fu = findUserByUsername(users, f);
        var nick = fu && fu.nickname ? fu.nickname : f;
        var avatar = fu && fu.avatar ? fu.avatar : '';
        html += '<div class="friend-item">' +
            '<div class="friend-avatar">' + (avatar ? '<img src="' + escapeHtml(avatar) + '" alt="">' : '<span>' + escapeHtml(nick.charAt(0)) + '</span>') + '</div>' +
            '<div class="friend-info"><b>' + escapeHtml(nick) + '</b><span>' + (isOnline(f) ? '<i class="online-dot"></i>在线' : lastSeenText(f)) + '</span></div>' +
            '<div class="friend-actions">' +
            '<button class="btn btn-primary btn-xs" onclick="window.openChatWith(\'' + f + '\')">私信</button> ' +
            '<a class="btn btn-secondary btn-xs" href="profile_view.html?u=' + encodeURIComponent(f) + '">主页</a> ' +
            '<button class="btn btn-danger btn-xs" onclick="window.removeFriend(\'' + f + '\')">删除</button>' +
            '</div></div>';
    });
    el.innerHTML = html;
}
function openChatWith(username) {
    var el = document.getElementById('chatView');
    var panel = document.getElementById('panel-friends');
    if (panel) { panel.setAttribute('data-chat-with', username); }
    if (el && el.classList) el.classList.add('active');
    var input = document.getElementById('chatInput');
    if (input) input.value = '';
    renderChatView();
    var ta = document.getElementById('chatList');
    if (ta) ta.setAttribute('data-active', username);
    renderChatList();
}
function sendChatMessage(to, text) {
    var s = getSession();
    if (!s || !s.username) { showToast('请先登录', 'warning'); return; }
    if (!text || !text.trim()) { showToast('请输入消息内容', 'warning'); return; }
    if (_getFriendList(s.username).indexOf(to) === -1) { showToast('请先添加对方为好友', 'warning'); return; }
    var chats = getChats();
    chats.push({ id: Date.now(), from: s.username, to: to, text: text.trim(), ts: Date.now(), read: false });
    saveChats(chats);
    addLog('chat', '用户 ' + s.username + ' 向 ' + to + ' 发送私信');
    renderChatView();
    renderChatList();
    if (window.refreshFriendBadge) window.refreshFriendBadge();
    var input = document.getElementById('chatInput');
    if (input) input.value = '';
}
function renderChatView() {
    var el = document.getElementById('chatView');
    var panel = document.getElementById('panel-friends');
    if (!el) return;
    var s = getSession(); if (!s) return;
    var me = s.username;
    var other = panel ? (panel.getAttribute('data-chat-with') || '') : '';
    var chats = getChats().filter(function (c) {
        var a = c.from, b = c.to;
        return (a === me && b === other) || (a === other && b === me);
    }).sort(function (x, y) { return x.ts - y.ts; });
    var changed = false;
    chats.forEach(function (c) { if (c.to === me && !c.read) { c.read = true; changed = true; } });
    if (changed) saveChats(getChats());
    var users = getUsers();
    var otherUser = findUserByUsername(users, other);
    var nick = otherUser && otherUser.nickname ? otherUser.nickname : other;
    var head = '<div class="chat-head"><b>' + escapeHtml(nick) + '</b>' +
        (other ? (isOnline(other) ? '<span class="chat-online">在线</span>' : '<span class="chat-offline">' + lastSeenText(other) + '</span>') : '') +
        '<button class="btn btn-secondary btn-xs chat-back" onclick="window.closeChatView()">返回会话列表</button></div>';
    if (!other) { el.innerHTML = head + '<div class="chat-empty">选择左侧好友开始私信聊天</div>'; return; }
    var body = '<div class="chat-body">';
    if (!chats.length) body += '<div class="chat-empty">还没有聊天记录，发条消息打个招呼吧</div>';
    chats.forEach(function (c) {
        body += '<div class="chat-msg ' + (c.from === me ? 'mine' : 'theirs') + '">' +
            '<div class="chat-bubble">' + escapeHtml(c.text) + '</div>' +
            '<span class="chat-time">' + fmtTime(c.ts) + '</span></div>';
    });
    body += '</div>';
    el.innerHTML = head + body +
        '<div class="chat-input-row">' +
        '<input type="text" id="chatInput" placeholder="输入消息内容..." maxlength="500">' +
        '<button class="btn btn-primary btn-sm" onclick="window.sendChatMessage(\'' + other + '\',document.getElementById(\'chatInput\').value)">发送</button>' +
        '</div>';
    var bodyEl = el.querySelector('.chat-body');
    if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight;
}
function closeChatView() {
    var el = document.getElementById('chatView');
    if (el) el.classList.remove('active');
    var panel = document.getElementById('panel-friends');
    if (panel) panel.removeAttribute('data-chat-with');
}
function renderChatList() {
    var el = document.getElementById('chatList');
    if (!el) return;
    var s = getSession(); if (!s) return;
    var me = s.username;
    var chats = getChats();
    var pairs = {};
    chats.forEach(function (c) {
        var other = c.from === me ? c.to : c.from;
        if (!pairs[other] || pairs[other].ts < c.ts) {
            pairs[other] = { ts: c.ts, text: c.text, from: c.from };
        }
    });
    var keys = Object.keys(pairs).sort(function (a, b) { return pairs[b].ts - pairs[a].ts; });
    var active = el.getAttribute('data-active') || '';
    var users = getUsers();
    if (!keys.length) { el.innerHTML = '<div class="chat-empty">暂无会话</div>'; return; }
    var html = '';
    keys.forEach(function (k) {
        var u = findUserByUsername(users, k);
        var nick = u && u.nickname ? u.nickname : k;
        var unread = getChats().filter(function (c) { return c.to === me && c.from === k && !c.read; }).length;
        html += '<div class="chat-item' + (active === k ? ' active' : '') + '" onclick="window.openChatWith(\'' + k + '\')">' +
            '<div class="friend-avatar"><span>' + escapeHtml(nick.charAt(0)) + '</span></div>' +
            '<div class="friend-info"><b>' + escapeHtml(nick) + (unread ? ' <span class="chat-unread">' + unread + '</span>' : '') + '</b><span>' + escapeHtml(pairs[k].text) + '</span></div>' +
            '</div>';
    });
    el.innerHTML = html;
}
function renderFriendsPanel() {
    renderFriendRequests();
    renderFriendList();
    renderChatList();
    if (window.refreshFriendBadge) window.refreshFriendBadge();
}

// ==================== [扩展] 日记与心情：每日一言 + 心情日记 + 随手记 ====================
var DAILY_QUOTES = [
    '生活明朗，万物可爱。', '所有的努力都会开花结果。', '保持热爱，奔赴山海。',
    '愿你眼里有光，心中有暖。', '今天的努力，是明天的底气。', '慢慢来，比较快。',
    '心怀希望，所向披靡。', '每一次坚持，都离梦想更近一步。', '简单一点，快乐一点。',
    '把日子过成诗，把心情酿成酒。', '凡是过往，皆为序章。', '你若盛开，清风自来。',
    '脚踏实地，仰望星空。', '每一天都是新的开始。', '温柔坚定，落落大方。',
    '读书、健身、早睡，是最便宜的增值方式。', '世界那么大，我想去看看。', '心之所向，素履以往。',
    '与其抱怨，不如改变。', '做自己的太阳，无需凭借谁的光。'
];
function getDailyWord() {
    var d = dataStore.get('siteDailyWord');
    try { if (d) return JSON.parse(d); } catch (e) { /* ignore */ }
    var now = new Date();
    var todayKey = now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate();
    var q = DAILY_QUOTES[Math.floor(Math.random() * DAILY_QUOTES.length)];
    var obj = { date: todayKey, text: q, author: '每日一言' };
    dataStore.set('siteDailyWord', JSON.stringify(obj));
    return obj;
}
function setDailyWord(text, author) {
    var now = new Date();
    var todayKey = now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate();
    var obj = { date: todayKey, text: text || '今日无话', author: author || '每日一言' };
    dataStore.set('siteDailyWord', JSON.stringify(obj));
    renderDailyWord();
}
function renderDailyWord(targetId) {
    var el = document.getElementById(targetId || 'dailyWordBox');
    if (!el) return;
    var w = getDailyWord();
    el.innerHTML = '<div class="daily-word-quote">' + escapeHtml(w.text) + '</div>' +
        '<div class="daily-word-author">—— ' + escapeHtml(w.author) + '</div>';
}
function _getDiary(u) { try { return JSON.parse(dataStore.get('siteDiary_' + u) || '[]'); } catch (e) { return []; } }
function _saveDiary(u, list) { dataStore.set('siteDiary_' + u, JSON.stringify(list)); }
function addDiary(date, mood, title, text) {
    var s = getSession();
    if (!s || !s.username) { showToast('请先登录', 'warning'); return; }
    if (!text || !text.trim()) { showToast('日记内容不能为空', 'warning'); return; }
    var list = _getDiary(s.username);
    list.unshift({ id: Date.now(), date: date || fmtDate(Date.now()), mood: mood || 'normal', title: title || '', text: text.trim(), ts: Date.now() });
    _saveDiary(s.username, list);
    addLog('diary', '用户 ' + s.username + ' 写下一篇日记');
    if (window.checkAchievements) window.checkAchievements();
    renderDiaryPanel();
    renderMyNotes();
    showToast('日记已保存', 'success');
}
function updateDiary(id, date, mood, title, text) {
    var s = getSession();
    if (!s) return;
    var list = _getDiary(s.username);
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) {
            list[i].date = date || list[i].date;
            list[i].mood = mood || list[i].mood;
            list[i].title = title || list[i].title;
            list[i].text = text;
            break;
        }
    }
    _saveDiary(s.username, list);
    renderDiaryPanel();
    showToast('日记已更新', 'success');
}
function deleteDiary(id) {
    var s = getSession();
    if (!s) return;
    var list = _getDiary(s.username).filter(function (d) { return d.id !== id; });
    _saveDiary(s.username, list);
    renderDiaryPanel();
    showToast('日记已删除', 'warning');
}
function editDiary(id) {
    var s = getSession();
    if (!s) return;
    var list = _getDiary(s.username);
    var d = null;
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { d = list[i]; break; } }
    if (!d) return;
    var el = document.getElementById('diaryEditBox');
    if (!el) return;
    var moods = ['happy', 'sad', 'angry', 'tired', 'love', 'normal'];
    var opts = '';
    moods.forEach(function (m) { opts += '<option value="' + m + '"' + (d.mood === m ? ' selected' : '') + '>' + moodLabel(m) + '</option>'; });
    el.innerHTML = '<h4>编辑日记</h4>' +
        '<div class="form-row"><div class="form-group"><label>日期</label><input type="date" id="diaryEditDate" value="' + escapeHtml(d.date) + '"></div>' +
        '<div class="form-group"><label>心情</label><select id="diaryEditMood">' + opts + '</select></div></div>' +
        '<div class="form-group"><label>标题</label><input type="text" id="diaryEditTitle" value="' + escapeHtml(d.title || '') + '" maxlength="50"></div>' +
        '<div class="form-group"><label>内容</label><textarea id="diaryEditText" rows="4">' + escapeHtml(d.text) + '</textarea></div>' +
        '<div class="form-row"><button class="btn btn-primary btn-sm" onclick="window.saveDiaryEdit(' + d.id + ')">保存</button> ' +
        '<button class="btn btn-secondary btn-sm" onclick="window.cancelDiaryEdit()">取消</button></div>';
    el.style.display = 'block';
}
function saveDiaryEdit(id) {
    var date = document.getElementById('diaryEditDate');
    var mood = document.getElementById('diaryEditMood');
    var title = document.getElementById('diaryEditTitle');
    var text = document.getElementById('diaryEditText');
    updateDiary(id, date ? date.value : '', mood ? mood.value : '', title ? title.value : '', text ? text.value : '');
    cancelDiaryEdit();
}
function cancelDiaryEdit() {
    var el = document.getElementById('diaryEditBox');
    if (el) { el.style.display = 'none'; el.innerHTML = ''; }
}
function renderDiaryPanel() {
    var listEl = document.getElementById('diaryList');
    var emptyEl = document.getElementById('diaryEmpty');
    if (!listEl) return;
    var s = getSession(); if (!s) return;
    var list = _getDiary(s.username);
    if (emptyEl) emptyEl.style.display = list.length ? 'none' : 'block';
    if (!list.length) { listEl.innerHTML = ''; return; }
    var html = '';
    list.forEach(function (d) {
        html += '<div class="diary-item">' +
            '<div class="diary-head"><span class="diary-mood mood-' + escapeHtml(d.mood) + '">' + moodLabel(d.mood) + '</span>' +
            '<b>' + escapeHtml(d.title || '无标题') + '</b><em>' + escapeHtml(d.date) + '</em></div>' +
            '<p class="diary-text">' + escapeHtml(d.text) + '</p>' +
            '<div class="diary-actions"><button class="btn btn-secondary btn-xs" onclick="window.editDiary(' + d.id + ')">编辑</button> ' +
            '<button class="btn btn-danger btn-xs" onclick="window.deleteDiary(' + d.id + ')">删除</button></div></div>';
    });
    listEl.innerHTML = html;
    renderDailyWord();
}
function moodLabel(m) {
    var map = { happy: '开心', sad: '难过', angry: '生气', tired: '疲惫', love: '心动', normal: '平静' };
    return map[m] || '平静';
}
function _getNotes(u) { try { return JSON.parse(dataStore.get('siteNotes_' + u) || '[]'); } catch (e) { return []; } }
function _saveNotes(u, list) { dataStore.set('siteNotes_' + u, JSON.stringify(list)); }
function addNote(text) {
    var s = getSession();
    if (!s || !s.username) { showToast('请先登录', 'warning'); return; }
    if (!text || !text.trim()) { showToast('请输入随手记内容', 'warning'); return; }
    var list = _getNotes(s.username);
    list.unshift({ id: Date.now(), text: text.trim(), ts: Date.now() });
    _saveNotes(s.username, list);
    if (window.checkAchievements) window.checkAchievements();
    renderMyNotes();
    showToast('随手记已保存', 'success');
}
function deleteNote(id) {
    var s = getSession();
    if (!s) return;
    var list = _getNotes(s.username).filter(function (n) { return n.id !== id; });
    _saveNotes(s.username, list);
    renderMyNotes();
    showToast('随手记已删除', 'warning');
}
function renderMyNotes() {
    var listEl = document.getElementById('notesList');
    var emptyEl = document.getElementById('notesEmpty');
    if (!listEl) return;
    var s = getSession(); if (!s) return;
    var list = _getNotes(s.username);
    if (emptyEl) emptyEl.style.display = list.length ? 'none' : 'block';
    if (!list.length) { listEl.innerHTML = ''; return; }
    var html = '';
    list.forEach(function (n) {
        html += '<div class="note-item"><span class="note-text">' + escapeHtml(n.text) + '</span>' +
            '<span class="note-time">' + fmtTime(n.ts) + '</span>' +
            '<button class="btn btn-danger btn-xs" onclick="window.deleteNote(' + n.id + ')">删除</button></div>';
    });
    listEl.innerHTML = html;
}
function renderDiaryPanelAll() {
    renderDailyWord();
    renderDiaryPanel();
    renderMyNotes();
}

// ==================== [扩展] 收藏与足迹增强：浏览历史 + 稍后阅读 + 收藏管理 ====================
function _getHistory(u) { try { return JSON.parse(dataStore.get('siteHistory_' + u) || '[]'); } catch (e) { return []; } }
function _saveHistory(u, list) { dataStore.set('siteHistory_' + u, JSON.stringify(list)); }
function _getReadLater(u) { try { return JSON.parse(dataStore.get('siteReadLater_' + u) || '[]'); } catch (e) { return []; } }
function _saveReadLater(u, list) { dataStore.set('siteReadLater_' + u, JSON.stringify(list)); }

function recordHistory(contentId, title) {
    var s = getSession();
    if (!s || !s.username) return;
    var list = _getHistory(s.username).filter(function (h) { return h.contentId !== contentId; });
    list.unshift({ id: Date.now(), contentId: contentId, title: title || '', ts: Date.now() });
    if (list.length > 50) list = list.slice(0, 50);
    _saveHistory(s.username, list);
}
function clearHistory() {
    var s = getSession();
    if (!s) return;
    _saveHistory(s.username, []);
    renderHistoryList();
    showToast('浏览历史已清空', 'warning');
}
function removeHistoryRecord(id) {
    var s = getSession();
    if (!s) return;
    var list = _getHistory(s.username).filter(function (h) { return h.id !== id; });
    _saveHistory(s.username, list);
    renderHistoryList();
}
function renderHistoryList() {
    var el = document.getElementById('historyList');
    var emptyEl = document.getElementById('historyEmpty');
    if (!el) return;
    var s = getSession(); if (!s) return;
    var list = _getHistory(s.username);
    if (emptyEl) emptyEl.style.display = list.length ? 'none' : 'block';
    if (!list.length) { el.innerHTML = ''; return; }
    var html = '';
    list.forEach(function (h) {
        html += '<div class="history-item">' +
            '<a class="history-title" href="javascript:void(0)" onclick="window.openContentDetail(' + Number(h.contentId) + ')">' + escapeHtml(h.title || ('内容 #' + h.contentId)) + '</a>' +
            '<span class="history-time">' + fmtTime(h.ts) + '</span>' +
            '<button class="btn btn-secondary btn-xs" onclick="window.toggleReadLater(' + Number(h.contentId) + ')">稍后读</button> ' +
            '<button class="btn btn-danger btn-xs" onclick="window.removeHistoryRecord(' + h.id + ')">删除</button></div>';
    });
    el.innerHTML = html;
}
function toggleReadLater(contentId) {
    var s = getSession();
    if (!s || !s.username) { showToast('请先登录', 'warning'); return; }
    var list = _getReadLater(s.username);
    var contents = getContents();
    var item = null;
    for (var i = 0; i < contents.length; i++) { if (contents[i].id === Number(contentId)) { item = contents[i]; break; } }
    var exist = null;
    for (var j = 0; j < list.length; j++) { if (list[j].contentId === Number(contentId)) { exist = list[j]; break; } }
    if (exist) {
        list = list.filter(function (r) { return r.contentId !== Number(contentId); });
        _saveReadLater(s.username, list);
        showToast('已从稍后读移除', 'warning');
    } else {
        list.unshift({ id: Date.now(), contentId: Number(contentId), title: item ? item.title : '', ts: Date.now() });
        _saveReadLater(s.username, list);
        showToast('已加入稍后读', 'success');
    }
    renderReadLaterList();
    if (window.checkAchievements) window.checkAchievements();
}
function removeReadLater(id) {
    var s = getSession();
    if (!s) return;
    var list = _getReadLater(s.username).filter(function (r) { return r.id !== id; });
    _saveReadLater(s.username, list);
    renderReadLaterList();
}
function renderReadLaterList() {
    var el = document.getElementById('readLaterList');
    var emptyEl = document.getElementById('readLaterEmpty');
    if (!el) return;
    var s = getSession(); if (!s) return;
    var list = _getReadLater(s.username);
    if (emptyEl) emptyEl.style.display = list.length ? 'none' : 'block';
    if (!list.length) { el.innerHTML = ''; return; }
    var html = '';
    list.forEach(function (r) {
        html += '<div class="readlater-item">' +
            '<a class="history-title" href="javascript:void(0)" onclick="window.openContentDetail(' + Number(r.contentId) + ')">' + escapeHtml(r.title || ('内容 #' + r.contentId)) + '</a>' +
            '<span class="history-time">' + fmtTime(r.ts) + '</span>' +
            '<button class="btn btn-secondary btn-xs" onclick="window.toggleReadLater(' + Number(r.contentId) + ')">取消稍后读</button> ' +
            '<button class="btn btn-danger btn-xs" onclick="window.removeReadLater(' + r.id + ')">删除</button></div>';
    });
    el.innerHTML = html;
}
function renderFavoritesEx() {
    var el = document.getElementById('favoriteListEx');
    var emptyEl = document.getElementById('favoriteExEmpty');
    if (!el) return;
    var s = getSession(); if (!s) return;
    var favs = getFavorites(s.username);
    if (emptyEl) emptyEl.style.display = favs.length ? 'none' : 'block';
    if (!favs.length) { el.innerHTML = ''; return; }
    var contents = getContents();
    var html = '';
    favs.forEach(function (cid) {
        var item = null;
        for (var i = 0; i < contents.length; i++) { if (contents[i].id === Number(cid)) { item = contents[i]; break; } }
        if (!item) return;
        var liked = isContentLikedBy(item.id, s.username);
        html += '<div class="favorite-ex-item">' +
            '<div class="favorite-ex-main"><a class="history-title" href="javascript:void(0)" onclick="window.openContentDetail(' + item.id + ')">' + escapeHtml(item.title) + '</a>' +
            '<span class="history-time">' + escapeHtml(item.author) + ' · ' + escapeHtml(item.time || '') + '</span></div>' +
            '<div class="favorite-ex-actions">' +
            '<button class="btn btn-secondary btn-xs" onclick="window.toggleReadLater(' + item.id + ')">稍后读</button> ' +
            '<button class="btn btn-danger btn-xs" onclick="window.removeFavoriteContent(' + item.id + ')">取消收藏</button>' +
            '</div></div>';
    });
    el.innerHTML = html;
}
function removeFavoriteContent(contentId) {
    var s = getSession();
    if (!s || !s.username) return;
    var favs = getFavorites(s.username).filter(function (f) { return f !== Number(contentId); });
    saveFavorites(s.username, favs);
    renderFavoritesEx();
    showToast('已取消收藏', 'warning');
}
function renderTrackPanel() {
    renderFavoritesEx();
    renderReadLaterList();
    renderHistoryList();
}

// ==================== [扩展] 成长体系升级：签到日历 + 成就徽章 + 等级经验条 ====================
var ACHIEVEMENTS = [
    { id: 'register', name: '初来乍到', desc: '完成注册', icon: '🎉' },
    { id: 'first_signin', name: '初次签到', desc: '完成首次签到', icon: '☀️' },
    { id: 'streak3', name: '持之以恒', desc: '连续签到3天', icon: '🔥' },
    { id: 'streak7', name: '七日之约', desc: '连续签到7天', icon: '💪' },
    { id: 'points100', name: '小有所成', desc: '积分达到100', icon: '🌟' },
    { id: 'points500', name: '声名鹊起', desc: '积分达到500', icon: '💎' },
    { id: 'points1000', name: '千分达人', desc: '积分达到1000', icon: '👑' },
    { id: 'diary1', name: '日记初体验', desc: '写下第一篇日记', icon: '📔' },
    { id: 'diary10', name: '生活记录者', desc: '累计写下10篇日记', icon: '📚' },
    { id: 'note1', name: '灵感速记', desc: '写下第一条随手记', icon: '💡' },
    { id: 'fav5', name: '慧眼识珠', desc: '收藏5条内容', icon: '⭐' },
    { id: 'read10', name: '博闻多识', desc: '累计浏览10条内容', icon: '📖' },
    { id: 'friend1', name: '广交益友', desc: '添加第一个好友', icon: '🤝' },
    { id: 'follow1', name: '初见倾心', desc: '第一次关注他人', icon: '👋' },
    { id: 'moment1', name: '动态首发', desc: '发布第一条动态', icon: '📣' },
    { id: 'moment10', name: '活跃达人', desc: '累计发布10条动态', icon: '📢' },
    { id: 'chat1', name: '畅所欲言', desc: '发出第一条私信', icon: '💬' },
    { id: 'album1', name: '光影记录', desc: '创建第一个相册', icon: '🖼️' },
    { id: 'poll1', name: '发起讨论', desc: '发起第一个投票', icon: '🗳️' }
];
function _getSigninDates(u) { try { return JSON.parse(dataStore.get('siteSigninDates_' + u) || '[]'); } catch (e) { return []; } }
function _saveSigninDates(u, list) { dataStore.set('siteSigninDates_' + u, JSON.stringify(list)); }
function _getAchievements(u) { try { return JSON.parse(dataStore.get('siteAchievements_' + u) || '{}'); } catch (e) { return {}; } }
function _saveAchievements(u, map) { dataStore.set('siteAchievements_' + u, JSON.stringify(map)); }

(function () {
    var base = window.doSignin;
    window.doSignin = function () {
        var ret = base ? base.apply(this, arguments) : undefined;
        var s = getSession();
        if (s && s.username) {
            var g = getGrowth(s.username);
            var todayKey = fmtDate(Date.now());
            var dates = _getSigninDates(s.username);
            if (g && g.lastSignin === todayKey && dates.indexOf(todayKey) === -1) {
                dates.push(todayKey);
                _saveSigninDates(s.username, dates);
            }
        }
        renderSigninCalendar();
        if (window.checkAchievements) window.checkAchievements();
        return ret;
    };
})();

function renderSigninCalendar() {
    var el = document.getElementById('signinCalendar');
    if (!el) return;
    var s = getSession(); if (!s) return;
    var dates = _getSigninDates(s.username);
    var now = new Date();
    var y = now.getFullYear();
    var m = now.getMonth();
    var first = new Date(y, m, 1);
    var startDow = first.getDay();
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var today = now.getDate();
    var html = '<div class="cal-head">' + y + ' 年 ' + (m + 1) + ' 月</div><div class="cal-grid">';
    var weekNames = ['日', '一', '二', '三', '四', '五', '六'];
    weekNames.forEach(function (w) { html += '<div class="cal-week">' + w + '</div>'; });
    for (var i = 0; i < startDow; i++) html += '<div class="cal-cell empty"></div>';
    for (var d = 1; d <= daysInMonth; d++) {
        var key = y + '-' + (m + 1) + '-' + d;
        var signed = dates.indexOf(key) !== -1;
        var isToday = d === today;
        html += '<div class="cal-cell' + (signed ? ' signed' : '') + (isToday ? ' today' : '') + '">' + d + (signed ? '<i>✓</i>' : '') + '</div>';
    }
    html += '</div>';
    el.innerHTML = html;
    var g = getGrowth(s.username);
    var tipEl = document.getElementById('signinStreakTip');
    if (tipEl) tipEl.textContent = g && g.streak ? '当前连续签到 ' + g.streak + ' 天，明天继续可获得额外积分奖励' : '每天签到可累积连续天数，获得额外积分';
}

function renderGrowthExPanel() {
    var el = document.getElementById('growthExPanel');
    if (!el) return;
    var s = getSession(); if (!s) return;
    var g = getGrowth(s.username);
    var info = growthLevel(g ? g.points : 0);
    var exp = g ? (g.points || 0) : 0;
    var nextMin = info.next ? info.next.min : exp;
    var html =
        '<div class="growth-ex-card">' +
        '<div class="growth-ex-head"><span class="growth-ex-level">Lv.' + info.level + ' · ' + escapeHtml(info.name) + '</span>' +
        '<span class="growth-ex-points">' + exp + ' 经验值</span></div>' +
        '<div class="growth-progress-track"><div class="growth-progress-fill" style="width:' + info.pct + '%"></div></div>' +
        '<div class="growth-progress-text">' + exp + ' / ' + nextMin + (info.next ? '（距下一级 ' + escapeHtml(info.next.name) + '）' : '（已达最高等级）') + '</div>' +
        '</div>';
    el.innerHTML = html;
}

function checkAchievements(username) {
    var u = username || (getSession() ? getSession().username : '');
    if (!u) return;
    var g = getGrowth(u);
    var unlocked = _getAchievements(u);
    var changed = false;
    var newly = [];
    var condition = {
        register: function () { return true; },
        first_signin: function () { return g && !!g.lastSignin; },
        streak3: function () { return g && (g.streak || 0) >= 3; },
        streak7: function () { return g && (g.streak || 0) >= 7; },
        points100: function () { return g && (g.points || 0) >= 100; },
        points500: function () { return g && (g.points || 0) >= 500; },
        points1000: function () { return g && (g.points || 0) >= 1000; },
        diary1: function () { return _getDiary(u).length >= 1; },
        diary10: function () { return _getDiary(u).length >= 10; },
        note1: function () { return _getNotes(u).length >= 1; },
        fav5: function () { return getFavorites(u).length >= 5; },
        read10: function () { return _getHistory(u).length >= 10; },
        friend1: function () { return _getFriendList(u).length >= 1; },
        follow1: function () { return _getFollows(u).length >= 1; },
        moment1: function () { return _getMomentsBy(u).length >= 1; },
        moment10: function () { return _getMomentsBy(u).length >= 10; },
        chat1: function () { return getChats().filter(function (c) { return c.from === u; }).length >= 1; },
        album1: function () { return getSiteAlbums().filter(function (a) { return a.owner === u; }).length >= 1; },
        poll1: function () { return getSitePolls().filter(function (p) { return p.author === u; }).length >= 1; }
    };
    ACHIEVEMENTS.forEach(function (a) {
        if (!unlocked[a.id] && condition[a.id] && condition[a.id]()) {
            unlocked[a.id] = Date.now();
            changed = true;
            newly.push(a);
        }
    });
    if (changed) {
        _saveAchievements(u, unlocked);
        var reward = newly.length * 10;
        var g2 = getGrowth(u);
        g2.points = (g2.points || 0) + reward;
        saveGrowth(u, g2);
        addLog('achievement', '用户 ' + u + ' 解锁成就 ' + newly.map(function (a) { return a.name; }).join('、') + '，积分 +' + reward);
        showToast('成就解锁！' + newly.map(function (a) { return a.name; }).join('、') + '（+10 积分）', 'success');
    }
    renderAchievements();
    renderGrowthExPanel();
}
function renderAchievements() {
    var el = document.getElementById('achievementWall');
    if (!el) return;
    var s = getSession(); if (!s) return;
    var unlocked = _getAchievements(s.username);
    var unlockedCount = 0;
    var html = '<div class="ach-grid">';
    ACHIEVEMENTS.forEach(function (a) {
        var isUnlocked = !!unlocked[a.id];
        if (isUnlocked) unlockedCount++;
        html += '<div class="ach-item' + (isUnlocked ? ' unlocked' : ' locked') + '">' +
            '<div class="ach-icon">' + a.icon + '</div>' +
            '<div class="ach-name">' + escapeHtml(a.name) + '</div>' +
            '<div class="ach-desc">' + escapeHtml(a.desc) + '</div>' +
            (isUnlocked ? '<div class="ach-status">已解锁</div>' : '<div class="ach-status locked">未解锁</div>') +
            '</div>';
    });
    html += '</div>';
    var head = document.getElementById('achievementSummary');
    if (head) head.textContent = '已解锁 ' + unlockedCount + ' / ' + ACHIEVEMENTS.length + ' 项成就';
    el.innerHTML = html;
}
function renderGrowthPanelAll() {
    renderGrowthExPanel();
    renderSigninCalendar();
    renderAchievements();
}

// ==================== [扩展] 个人主页与动态：关注/粉丝 + 动态广场 + 公开主页 ====================
function _getFollows(u) { try { return JSON.parse(dataStore.get('siteFollows_' + u) || '[]'); } catch (e) { return []; } }
function _saveFollows(u, list) { dataStore.set('siteFollows_' + u, JSON.stringify(list)); }
function _getMoments() { try { return JSON.parse(dataStore.get('siteMoments') || '[]'); } catch (e) { return []; } }
function _saveMoments(list) { dataStore.set('siteMoments', JSON.stringify(list)); }
function _getMomentsBy(u) { return _getMoments().filter(function (m) { return m.author === u; }); }
function _getFansOf(u) {
    var fans = [];
    getUsers().forEach(function (user) {
        if (_getFollows(user.username).indexOf(u) !== -1) fans.push(user.username);
    });
    return fans;
}
function isFollowing(me, target) {
    return me === target || _getFollows(me).indexOf(target) !== -1;
}
function getFollowCounts(u) {
    return { follows: _getFollows(u).length, fans: _getFansOf(u).length };
}
function toggleFollow(target) {
    var s = getSession();
    if (!s || !s.username) { showToast('请先登录', 'warning'); return; }
    var me = s.username;
    if (me === target) { showToast('不能关注自己', 'warning'); return; }
    var list = _getFollows(me);
    var idx = list.indexOf(target);
    if (idx !== -1) {
        list.splice(idx, 1);
        _saveFollows(me, list);
        showToast('已取消关注 ' + target, 'warning');
    } else {
        list.push(target);
        _saveFollows(me, list);
        addLog('follow', '用户 ' + me + ' 关注了 ' + target);
        showToast('已关注 ' + target, 'success');
    }
    if (window.checkAchievements) window.checkAchievements();
    renderFollowPanel();
    if (window.refreshFriendBadge) window.refreshFriendBadge();
}
function publishMoment(text) {
    var s = getSession();
    if (!s || !s.username) { showToast('请先登录', 'warning'); return; }
    if (!text || !text.trim()) { showToast('动态内容不能为空', 'warning'); return; }
    var moments = _getMoments();
    moments.unshift({ id: Date.now(), author: s.username, text: text.trim(), ts: Date.now(), likes: [], comments: [] });
    _saveMoments(moments);
    addLog('moment', '用户 ' + s.username + ' 发布了一条动态');
    if (window.checkAchievements) window.checkAchievements();
    renderMomentFeed();
    renderMyMoments();
    var ta = document.getElementById('momentInput');
    if (ta) ta.value = '';
    var ta2 = document.getElementById('homeMomentInput');
    if (ta2) ta2.value = '';
    showToast('动态已发布', 'success');
}
function deleteMoment(id) {
    var s = getSession();
    if (!s) return;
    var moments = _getMoments().filter(function (m) { return m.id !== id; });
    _saveMoments(moments);
    renderMomentFeed();
    renderMyMoments();
    showToast('动态已删除', 'warning');
}
function toggleMomentLike(id) {
    var s = getSession();
    if (!s || !s.username) { showToast('请先登录', 'warning'); return; }
    var moments = _getMoments();
    var m = null;
    for (var i = 0; i < moments.length; i++) { if (moments[i].id === id) { m = moments[i]; break; } }
    if (!m) return;
    var idx = m.likes.indexOf(s.username);
    if (idx !== -1) { m.likes.splice(idx, 1); } else { m.likes.push(s.username); }
    _saveMoments(moments);
    renderMomentFeed();
    renderMyMoments();
}
function addMomentComment(id, text) {
    var s = getSession();
    if (!s || !s.username) { showToast('请先登录', 'warning'); return; }
    if (!text || !text.trim()) { showToast('请输入评论内容', 'warning'); return; }
    var moments = _getMoments();
    var m = null;
    for (var i = 0; i < moments.length; i++) { if (moments[i].id === id) { m = moments[i]; break; } }
    if (!m) return;
    m.comments.push({ id: Date.now(), author: s.username, text: text.trim(), ts: Date.now() });
    _saveMoments(moments);
    renderMomentFeed();
    renderMyMoments();
}
function renderMomentItem(m) {
    var users = getUsers();
    var u = findUserByUsername(users, m.author);
    var nick = u && u.nickname ? u.nickname : m.author;
    var avatar = u && u.avatar ? u.avatar : '';
    var s = getSession();
    var me = s ? s.username : '';
    var liked = me && m.likes.indexOf(me) !== -1;
    var html = '<div class="moment-item">' +
        '<div class="moment-head">' +
        (avatar ? '<img class="moment-avatar" src="' + escapeHtml(avatar) + '" alt="">' : '<div class="moment-avatar"><span>' + escapeHtml(nick.charAt(0)) + '</span></div>') +
        '<div class="moment-user"><a class="moment-user-link" href="profile_view.html?u=' + encodeURIComponent(m.author) + '"><b>' + escapeHtml(nick) + '</b></a><span>' + fmtTime(m.ts) + '</span></div>' +
        (me === m.author ? '<button class="btn btn-danger btn-xs" onclick="window.deleteMoment(' + m.id + ')">删除</button>' : '') +
        '</div>' +
        '<p class="moment-text">' + escapeHtml(m.text) + '</p>' +
        '<div class="moment-actions">' +
        '<button class="btn btn-xs ' + (liked ? 'btn-primary' : 'btn-secondary') + '" onclick="window.toggleMomentLike(' + m.id + ')">👍 ' + m.likes.length + '</button> ' +
        '<button class="btn btn-secondary btn-xs" onclick="window.toggleMomentComments(' + m.id + ')">💬 ' + m.comments.length + '</button>' +
        (me && me !== m.author ? ' <button class="btn btn-xs ' + (isFollowing(me, m.author) ? 'btn-secondary' : 'btn-primary') + '" onclick="window.toggleFollow(\'' + m.author + '\')">' + (isFollowing(me, m.author) ? '已关注' : '关注') + '</button>' : '') +
        '</div>' +
        '<div class="moment-comments" id="momentComments_' + m.id + '" style="display:none">' +
        '<div class="comment-list">';
    if (m.comments.length) {
        m.comments.forEach(function (c) {
            var cu = findUserByUsername(users, c.author);
            var cn = cu && cu.nickname ? cu.nickname : c.author;
            html += '<div class="comment-item"><b>' + escapeHtml(cn) + '</b>：' + escapeHtml(c.text) + '<em>' + fmtTime(c.ts) + '</em></div>';
        });
    } else {
        html += '<div class="comment-empty">还没有评论</div>';
    }
    html += '</div><div class="comment-input-row">' +
        '<input type="text" id="momentCommentInput_' + m.id + '" placeholder="写评论..." maxlength="200">' +
        '<button class="btn btn-primary btn-xs" onclick="window.addMomentComment(' + m.id + ',document.getElementById(\'momentCommentInput_' + m.id + '\').value)">评论</button>' +
        '</div></div></div>';
    return html;
}
function toggleMomentComments(id) {
    var el = document.getElementById('momentComments_' + id);
    if (el) el.style.display = (el.style.display === 'none') ? 'block' : 'none';
}
function renderMomentFeed() {
    var el = document.getElementById('momentFeed');
    if (!el) return;
    var moments = _getMoments();
    var html = '';
    moments.forEach(function (m) { html += renderMomentItem(m); });
    el.innerHTML = html || '<div class="empty-tip">还没有动态，快来发布第一条吧</div>';
    var badge = document.getElementById('momentCount');
    if (badge) badge.textContent = moments.length;
}
function renderMyMoments() {
    var el = document.getElementById('myMomentsList');
    if (!el) return;
    var s = getSession(); if (!s) return;
    var moments = _getMomentsBy(s.username);
    var html = '';
    moments.forEach(function (m) { html += renderMomentItem(m); });
    el.innerHTML = html || '<div class="empty-tip">你还没有发布过动态</div>';
}
function renderFollowPanel() {
    var followsEl = document.getElementById('followList');
    var fansEl = document.getElementById('fansList');
    if (!followsEl && !fansEl) return;
    var s = getSession(); if (!s) return;
    var me = s.username;
    var follows = _getFollows(me);
    var fans = _getFansOf(me);
    var users = getUsers();
    function renderList(el, list, emptyId) {
        if (!el) return;
        var emptyEl = emptyId ? document.getElementById(emptyId) : null;
        if (emptyEl) emptyEl.style.display = list.length ? 'none' : 'block';
        if (!list.length) { el.innerHTML = ''; return; }
        var html = '';
        list.forEach(function (name) {
            var u = findUserByUsername(users, name);
            var nick = u && u.nickname ? u.nickname : name;
            var avatar = u && u.avatar ? u.avatar : '';
            html += '<div class="follow-item">' +
                (avatar ? '<img class="moment-avatar" src="' + escapeHtml(avatar) + '" alt="">' : '<div class="moment-avatar"><span>' + escapeHtml(nick.charAt(0)) + '</span></div>') +
                '<div class="friend-info"><b>' + escapeHtml(nick) + '</b><span>' + (isOnline(name) ? '在线' : lastSeenText(name)) + '</span></div>' +
                '<div class="friend-actions">' +
                '<a class="btn btn-secondary btn-xs" href="profile_view.html?u=' + encodeURIComponent(name) + '">主页</a> ' +
                '<button class="btn btn-xs ' + (isFollowing(me, name) ? 'btn-secondary' : 'btn-primary') + '" onclick="window.toggleFollow(\'' + name + '\')">' + (isFollowing(me, name) ? '取消关注' : '关注') + '</button>' +
                '</div></div>';
        });
        el.innerHTML = html;
    }
    renderList(followsEl, follows, 'followEmpty');
    renderList(fansEl, fans, 'fansEmpty');
    var fc = document.getElementById('followCount');
    if (fc) fc.textContent = follows.length;
    var fnc = document.getElementById('fansCount');
    if (fnc) fnc.textContent = fans.length;
}
function renderSocialPanel() {
    renderFollowPanel();
    renderMyMoments();
    if (window.refreshFriendBadge) window.refreshFriendBadge();
}
function getPublicProfile(username) {
    var users = getUsers();
    var u = findUserByUsername(users, username);
    if (!u) return null;
    var g = getGrowth(username);
    var info = g ? growthLevel(g.points || 0) : growthLevel(0);
    var unlocked = _getAchievements(username);
    var achList = [];
    ACHIEVEMENTS.forEach(function (a) { if (unlocked[a.id]) achList.push(a); });
    var moments = _getMomentsBy(username).slice(0, 20);
    var albums = getSiteAlbums().filter(function (al) { return al.owner === username; }).slice(0, 6);
    return {
        user: u,
        nickname: u.nickname || username,
        bio: u.bio || '这个人很懒，什么都没写~',
        avatar: u.avatar || '',
        level: info.level,
        levelName: info.name,
        points: g ? g.points : 0,
        streak: g ? g.streak : 0,
        follows: getFollowCounts(username).follows,
        fans: getFollowCounts(username).fans,
        friends: _getFriendList(username).length,
        achievements: achList,
        moments: moments,
        albums: albums
    };
}
function renderProfileView(username) {
    var root = document.getElementById('profileViewRoot');
    if (!root) return;
    var data = getPublicProfile(username);
    if (!data) {
        root.innerHTML = '<div class="empty-tip">用户不存在或已被删除</div>';
        return;
    }
    var s = getSession();
    var me = s ? s.username : '';
    var isMe = me === username;
    var achHtml = '';
    if (data.achievements.length) {
        data.achievements.slice(0, 12).forEach(function (a) {
            achHtml += '<span class="pv-ach" title="' + escapeHtml(a.desc) + '">' + a.icon + ' ' + escapeHtml(a.name) + '</span>';
        });
    } else {
        achHtml = '<span class="pv-none">暂无徽章</span>';
    }
    var albumHtml = '';
    if (data.albums.length) {
        data.albums.forEach(function (al) {
            albumHtml += '<div class="pv-album"><b>' + escapeHtml(al.name) + '</b><span>' + (al.count || 0) + ' 张</span></div>';
        });
    } else {
        albumHtml = '<span class="pv-none">暂无相册</span>';
    }
    var momentHtml = '';
    if (data.moments.length) {
        data.moments.forEach(function (m) { momentHtml += renderMomentItem(m); });
    } else {
        momentHtml = '<div class="empty-tip">暂无动态</div>';
    }
    root.innerHTML =
        '<div class="pv-header">' +
        (data.avatar ? '<img class="pv-avatar" src="' + escapeHtml(data.avatar) + '" alt="">' : '<div class="pv-avatar pv-avatar-text"><span>' + escapeHtml(data.nickname.charAt(0)) + '</span></div>') +
        '<div class="pv-userinfo"><h2>' + escapeHtml(data.nickname) + '</h2>' +
        '<p class="pv-bio">' + escapeHtml(data.bio) + '</p>' +
        '<p class="pv-tags">Lv.' + data.level + ' ' + escapeHtml(data.levelName) + ' · 积分 ' + data.points + ' · 连续签到 ' + data.streak + ' 天</p>' +
        '<div class="pv-stats"><span>关注 ' + data.follows + '</span><span>粉丝 ' + data.fans + '</span><span>好友 ' + data.friends + '</span></div></div>' +
        '<div class="pv-actions">' +
        (isMe ? '' : '<button class="btn btn-primary btn-sm" onclick="window.toggleFollow(\'' + username + '\');window.renderProfileView(\'' + username + '\')">' + (isFollowing(me, username) ? '已关注' : '关注') + '</button> ') +
        (isMe ? '' : (_getFriendList(me).indexOf(username) !== -1 ? '<button class="btn btn-secondary btn-sm" disabled>已是好友</button> ' : '<button class="btn btn-primary btn-sm" onclick="window.sendFriendRequest(\'' + username + '\');window.renderProfileView(\'' + username + '\')">加好友</button> ')) +
        (isMe ? '' : '<button class="btn btn-secondary btn-sm" onclick="dataStore.set(\'siteChatOpenWith\',\'' + username + '\');window.location.href=\'profile.html#friends\'">私信</button>') +
        '</div></div>' +
        '<div class="pv-section"><h3>🏅 徽章墙</h3><div class="pv-ach-grid">' + achHtml + '</div></div>' +
        '<div class="pv-section"><h3>📷 相册</h3><div class="pv-album-grid">' + albumHtml + '</div></div>' +
        '<div class="pv-section"><h3>📣 动态</h3><div class="pv-moments">' + momentHtml + '</div></div>';
}

// ==================== [扩展] PWA + 响应式导航 + 通用跳转 ====================
function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    var scopeBase = location.pathname.substring(0, location.pathname.lastIndexOf('/') + 1);
    navigator.serviceWorker.register(scopeBase + 'service-worker.js', { scope: scopeBase }).catch(function () { /* 忽略离线注册失败 */ });
}
function viewUserHome(username) {
    window.location.href = 'profile_view.html?u=' + encodeURIComponent(username);
}
function initResponsiveNav() {
    var toggler = document.querySelector('.nav-toggle, #navToggle');
    var nav = document.querySelector('.nav-links, .main-nav, .topbar-nav, .nav-right');
    if (toggler && nav) {
        toggler.addEventListener('click', function () {
            nav.classList.toggle('nav-open');
            toggler.classList.toggle('active');
        });
    }
    var dropdownToggles = document.querySelectorAll('.user-dropdown-toggle, .dropdown-toggle');
    dropdownToggles.forEach(function (t) {
        t.addEventListener('click', function (e) {
            e.stopPropagation();
            var d = t.parentElement;
            if (d) d.classList.toggle('open');
        });
    });
}
function initPwaEnhance() {
    if (window.markOnline) window.markOnline();
    if (window.initResponsiveNav) window.initResponsiveNav();
    if (window.registerServiceWorker) window.registerServiceWorker();
}

// ========== [扩展] 暴露新函数到 window（必须在 admin 初始化分支之前） ==========
window.fmtTime = fmtTime;
window.fmtDate = fmtDate;
window.markOnline = markOnline;
window.isOnline = isOnline;
window.sendFriendRequest = sendFriendRequest;
window.respondFriendRequest = respondFriendRequest;
window.removeFriend = removeFriend;
window.renderFriendRequests = renderFriendRequests;
window.renderFriendList = renderFriendList;
window.openChatWith = openChatWith;
window.closeChatView = closeChatView;
window.sendChatMessage = sendChatMessage;
window.renderChatView = renderChatView;
window.renderChatList = renderChatList;
window.renderFriendsPanel = renderFriendsPanel;
window.getDailyWord = getDailyWord;
window.setDailyWord = setDailyWord;
window.renderDailyWord = renderDailyWord;
window.addDiary = addDiary;
window.updateDiary = updateDiary;
window.deleteDiary = deleteDiary;
window.editDiary = editDiary;
window.saveDiaryEdit = saveDiaryEdit;
window.cancelDiaryEdit = cancelDiaryEdit;
window.renderDiaryPanel = renderDiaryPanel;
window.addNote = addNote;
window.deleteNote = deleteNote;
window.renderMyNotes = renderMyNotes;
window.renderDiaryPanelAll = renderDiaryPanelAll;
window.recordHistory = recordHistory;
window.clearHistory = clearHistory;
window.removeHistoryRecord = removeHistoryRecord;
window.renderHistoryList = renderHistoryList;
window.toggleReadLater = toggleReadLater;
window.removeReadLater = removeReadLater;
window.renderReadLaterList = renderReadLaterList;
window.renderFavoritesEx = renderFavoritesEx;
window.removeFavoriteContent = removeFavoriteContent;
window.renderTrackPanel = renderTrackPanel;
window.renderSigninCalendar = renderSigninCalendar;
window.renderGrowthExPanel = renderGrowthExPanel;
window.checkAchievements = checkAchievements;
window.renderAchievements = renderAchievements;
window.renderGrowthPanelAll = renderGrowthPanelAll;
window.toggleFollow = toggleFollow;
window.isFollowing = isFollowing;
window.getFollowCounts = getFollowCounts;
window.publishMoment = publishMoment;
window.deleteMoment = deleteMoment;
window.toggleMomentLike = toggleMomentLike;
window.addMomentComment = addMomentComment;
window.toggleMomentComments = toggleMomentComments;
window.renderMomentFeed = renderMomentFeed;
window.renderMyMoments = renderMyMoments;
window.renderFollowPanel = renderFollowPanel;
window.renderSocialPanel = renderSocialPanel;
window.getPublicProfile = getPublicProfile;
window.renderProfileView = renderProfileView;
window.registerServiceWorker = registerServiceWorker;
window.viewUserHome = viewUserHome;
window.initResponsiveNav = initResponsiveNav;
window.initPwaEnhance = initPwaEnhance;

// ========== 管理后台（admin.html）==========
var isAdminPage = document.body && document.body.classList && document.body.classList.contains('admin-page');
// 暴露 admin 渲染函数与数据工具函数（必须在 admin 初始化分支之前执行：
// initAdminPage → renderUsersTable/loadDashboardStats 会立即调用 getUsers()，
// 若暴露晚于初始化，首次渲染必然 ReferenceError 中断）
window.renderUsersTable = renderUsersTable;
window.loadDashboardStats = loadDashboardStats;
window.getUsers = getUsers;
window.saveUsers = saveUsers;
window.saveAdminEmail = function () {
    var input = document.getElementById('newEmailInput');
    if (!input) return;
    var email = input.value.trim();
    if (!email) { showToast('请输入邮箱地址'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('邮箱格式不正确'); return; }
    var settings = JSON.parse(dataStore.get('siteSettings') || '{}');
    settings.supportEmail = email;
    dataStore.set('siteSettings', JSON.stringify(settings));
    var modal = document.getElementById('changeEmailModal');
    if (modal) modal.style.display = 'none';
    showToast('支持邮箱已更新');
};

// 帮助中心：动态填充支持邮箱（配置后立即生效）
(function () {
    var el = document.getElementById('supportEmail');
    if (el) {
        var settings = JSON.parse(dataStore.get('siteSettings') || '{}');
        if (settings.supportEmail) el.textContent = settings.supportEmail;
    }
})();
window.addLog = addLog;
window.getSession = getSession;
window.checkPasswordStrength = checkPasswordStrength;
window.genAccountId = genAccountId;
window.initBackTop = initBackTop;
window.getContents = getContents;
window.saveContents = saveContents;
window.getInteractions = getInteractions;
window.saveInteractions = saveInteractions;
window.getGuestbook = getGuestbook;
window.saveGuestbook = saveGuestbook;
window.getVisitLog = getVisitLog;
window.saveVisitLog = saveVisitLog;
window.getGrowth = getGrowth;
window.saveGrowth = saveGrowth;
if (isAdminPage) {
    var session = getSession();
    if (!session || (session.role !== 'super_admin' && session.role !== 'admin')) {
        alert('无权限访问管理后台！');
        window.location.href = 'index.html';
    } else {
        initAdminPage(session.username);
    }
}

// ========== 跨标签页实时同步 ==========
// 其它标签页修改 users / currentUser 时，本页自动刷新用户信息，保证实时一致
window.addEventListener('storage', function (e) {
    if (!e || (e.key !== 'users' && e.key !== 'currentUser')) return;
    var session = getSession();
    if (!session) return;
    // index.html 首页横幅同步
    if (welcomeEl) {
        var fullUser = findUserByUsername(getUsers(), session.username);
        renderWelcomeBanner(session, fullUser);
    }
    // profile.html 个人资料页同步
    if (profileForm) {
        var activeEl = document.activeElement;
        var isEditing = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT');
        if (isEditing) {
            console.log('用户信息已在其它页面更新，为避免覆盖当前输入，请保存后刷新查看最新资料');
        } else {
            loadProfile(session.username);
            updateSecurityBindings();
        }
    }
    // admin.html 管理后台同步：刷新用户列表与仪表盘统计
    if (isAdminPage) {
        renderUsersTable();
        loadDashboardStats();
    }
});
})();
function getContents() {
    try { return JSON.parse(dataStore.get('siteContents') || '[]'); } catch (e) { return []; }
}

function saveContents(contents) {
    dataStore.set('siteContents', JSON.stringify(contents));
}

// ========== 文件管理数据 ==========
function getFiles() {
    try { return JSON.parse(dataStore.get('managedFiles') || '[]'); } catch (e) { return []; }
}

function saveFiles(files) {
    dataStore.set('managedFiles', JSON.stringify(files));
}

// ========== 消息通知数据 ==========
function getMessages() {
    try { return JSON.parse(dataStore.get('messages') || '[]'); } catch (e) { return []; }
}

function saveMessages(messages) {
    dataStore.set('messages', JSON.stringify(messages));
}

// ========== 初始化管理后台 ==========
function initAdminPage(currentUsername) {
    document.getElementById('currentAdmin').textContent = '当前管理员：' + currentUsername;
    initBackTop();

    var session = getSession();
    var isSuper = session && session.role === 'super_admin';

    // 新建管理员按钮：仅超级管理员可见
    var createAdminBtn = document.getElementById('createAdminBtn');
    if (createAdminBtn) createAdminBtn.style.display = isSuper ? 'inline-block' : 'none';

    // 查看首页按钮：仅超级管理员可见
    var viewHomeLi = document.getElementById('viewHomeLi');
    if (viewHomeLi) viewHomeLi.style.display = isSuper ? 'block' : 'none';

    // 普通管理员隐藏系统设置 / 操作日志导航项（仅保留数据统计、用户管理、内容、文件、消息等部分功能）
    if (!isSuper) {
        var settingsNav = document.querySelector('.sidebar-nav a[data-tab="settings"]');
        if (settingsNav) settingsNav.parentElement.style.display = 'none';
        var logsNav = document.querySelector('.sidebar-nav a[data-tab="logs"]');
        if (logsNav) logsNav.parentElement.style.display = 'none';
    }

    // 标签页切换
    var navLinks = document.querySelectorAll('.sidebar-nav a[data-tab]');
    navLinks.forEach(function(link) {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            var tabName = this.getAttribute('data-tab');
            switchTab(tabName);
            // 手机端切换后自动收起抽屉
            if (typeof closeAdminSidebar === 'function') closeAdminSidebar();
            // 备份恢复导航：切到系统设置后滚动到备份区
            if (this.classList && this.classList.contains('backup-nav-item')) {
                setTimeout(function() {
                    var backupSec = document.getElementById('backupSection');
                    if (backupSec) backupSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 60);
            }
        });
    });

    // 退出登录
    var logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function () {
            dataStore.remove('currentUser');
            window.location.href = 'login.html';
        });
    }

    // 修改邮箱（超级管理员/管理员）
    var changeEmailBtn = document.getElementById('changeEmailBtn');
    if (changeEmailBtn) {
        changeEmailBtn.addEventListener('click', function () {
            var settings = JSON.parse(dataStore.get('siteSettings') || '{}');
            var input = document.getElementById('newEmailInput');
            if (input) input.value = settings.supportEmail || 'support@mysite.local';
            var modal = document.getElementById('changeEmailModal');
            if (modal) {
                modal.style.display = 'flex';
                modal.classList.remove('modal-in');
                void modal.offsetWidth;
                modal.classList.add('modal-in');
            }
        });
    }
    var changeEmailClose = document.querySelector('#changeEmailModal .modal-close');
    if (changeEmailClose) {
        changeEmailClose.addEventListener('click', function () {
            var modal = document.getElementById('changeEmailModal');
            if (modal) modal.style.display = 'none';
        });
    }
    var changeEmailModal = document.getElementById('changeEmailModal');
    if (changeEmailModal) {
        changeEmailModal.addEventListener('click', function (e) {
            if (e.target === changeEmailModal) changeEmailModal.style.display = 'none';
        });
    }

    // 侧边栏折叠
    var sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', function () {
            document.querySelector('.admin-sidebar').classList.toggle('collapsed');
        });
    }

    // 手机端顶部工具栏：汉堡展开/收起侧边栏抽屉 + 遮罩
    var mobileToggle = document.getElementById('adminMobileToggle');
    var adminSidebar = document.getElementById('adminSidebar');
    var adminOverlay = document.getElementById('adminSidebarOverlay');
    function openAdminSidebar() {
        if (adminSidebar) adminSidebar.classList.add('open');
        if (adminOverlay) adminOverlay.classList.add('show');
    }
    function closeAdminSidebar() {
        if (adminSidebar) adminSidebar.classList.remove('open');
        if (adminOverlay) adminOverlay.classList.remove('show');
    }
    if (mobileToggle) {
        mobileToggle.addEventListener('click', function (e) {
            e.stopPropagation();
            if (adminSidebar && adminSidebar.classList.contains('open')) {
                closeAdminSidebar();
            } else {
                openAdminSidebar();
            }
        });
    }
    if (adminOverlay) adminOverlay.addEventListener('click', closeAdminSidebar);
    var adminMobileAdmin = document.getElementById('adminMobileAdmin');
    if (adminMobileAdmin) {
        var sess = getSession();
        if (sess && sess.username) adminMobileAdmin.textContent = sess.username;
    }

    // 加载数据
    loadDashboardStats();
    renderCssCharts();
    renderUsersTable();
    renderContentTable();
    renderAnnouncementsTable();
    renderFeedbackTable();
    renderFilesTable();
    renderMessagesTable();
    loadSettings();
    renderLogs();

    // 搜索/筛选事件
    var searchInput = document.getElementById('userSearch');
    if (searchInput) searchInput.addEventListener('input', renderUsersTable);
    
    var roleFilter = document.getElementById('roleFilter');
    if (roleFilter) roleFilter.addEventListener('change', renderUsersTable);
    
    var sortOrder = document.getElementById('sortOrder');
    if (sortOrder) sortOrder.addEventListener('change', renderUsersTable);

    // 全选复选框
    var selectAll = document.getElementById('selectAll');
    if (selectAll) selectAll.addEventListener('change', toggleSelectAll);

    // 内容管理事件
    var contentSearch = document.getElementById('contentSearch');
    if (contentSearch) contentSearch.addEventListener('input', renderContentTable);
    var contentTypeFilter = document.getElementById('contentTypeFilter');
    if (contentTypeFilter) contentTypeFilter.addEventListener('change', renderContentTable);
    var contentStatusFilter = document.getElementById('contentStatusFilter');
    if (contentStatusFilter) contentStatusFilter.addEventListener('change', renderContentTable);

    // 文件管理事件
    var fileSearch = document.getElementById('fileSearch');
    if (fileSearch) fileSearch.addEventListener('input', renderFilesTable);
    var fileTypeFilter = document.getElementById('fileTypeFilter');
    if (fileTypeFilter) fileTypeFilter.addEventListener('change', renderFilesTable);

    // 反馈管理事件
    var feedbackStatusFilter = document.getElementById('feedbackStatusFilter');
    if (feedbackStatusFilter) feedbackStatusFilter.addEventListener('change', renderFeedbackTable);

    // 消息管理事件
    var messageStatusFilter = document.getElementById('messageStatusFilter');
    if (messageStatusFilter) messageStatusFilter.addEventListener('change', renderMessagesTable);

    // 日志筛选
    var logFilter = document.getElementById('logFilter');
    if (logFilter) logFilter.addEventListener('change', renderLogs);
    var logSearch = document.getElementById('logSearch');
    if (logSearch) logSearch.addEventListener('input', renderLogs);

    // 设置表单提交
    var settingsForm = document.getElementById('settingsForm');
    if (settingsForm) {
        settingsForm.addEventListener('submit', function(e) {
            e.preventDefault();
            saveSettings();
        });
    }

    // 内容表单提交
    var contentForm = document.getElementById('contentForm');
    if (contentForm) {
        contentForm.addEventListener('submit', function(e) {
            e.preventDefault();
            saveContent();
        });
    }

    // 消息表单提交
    var messageForm = document.getElementById('messageForm');
    if (messageForm) {
        messageForm.addEventListener('submit', function(e) {
            e.preventDefault();
            sendMessage();
        });
    }

    // 公告表单提交
    var announcementForm = document.getElementById('announcementForm');
    if (announcementForm) {
        announcementForm.addEventListener('submit', function(e) {
            e.preventDefault();
            saveAnnouncement();
        });
    }

    // 弹窗关闭
    var modalClose = document.querySelectorAll('.modal-close');
    modalClose.forEach(function(btn) {
        btn.addEventListener('click', closeModal);
    });
}

// ========== 标签页切换 ==========
function switchTab(tabName) {
    // 更新导航状态
    document.querySelectorAll('.sidebar-nav li').forEach(function(li) {
        li.classList.remove('active');
    });
    var navItem = document.querySelector('.sidebar-nav a[data-tab="' + tabName + '"]');
    if (navItem) navItem.parentElement.classList.add('active');

    // 更新内容显示
    document.querySelectorAll('.tab-panel').forEach(function(panel) {
        panel.classList.remove('active');
    });
    var panel = document.getElementById('tab-' + tabName);
    if (panel) {
        panel.classList.add('active');
        panel.classList.remove('fade-in');
        void panel.offsetWidth;
        panel.classList.add('fade-in');
    }

    // 更新标题
    var titles = { dashboard: '数据统计', users: '用户管理', content: '内容管理', announcements: '公告管理', feedback: '反馈管理', files: '文件管理', messages: '消息通知', settings: '系统设置', logs: '操作日志', albums: '相册管理', polls: '投票管理', guestbook: '留言管理' };
    document.getElementById('pageTitle').textContent = titles[tabName] || '';

    // 手机端工具栏标题同步
    var mobileTitle = document.getElementById('adminMobileTitle');
    if (mobileTitle) mobileTitle.textContent = titles[tabName] || '';

    // 加载对应数据
    if (tabName === 'dashboard') {
        loadDashboardStats();
        renderCssCharts();
    }
    if (tabName === 'users') renderUsersTable();
    if (tabName === 'content') renderContentTable();
    if (tabName === 'announcements') renderAnnouncementsTable();
    if (tabName === 'feedback') renderFeedbackTable();
    if (tabName === 'guestbook') renderGuestbookAdmin();
    if (tabName === 'files') renderFilesTable();
    if (tabName === 'messages') renderMessagesTable();
    if (tabName === 'albums') renderAlbumsAdmin();
    if (tabName === 'polls') renderPollsAdmin();
    if (tabName === 'logs') renderLogs();
}

// ========== 数据统计 ==========
function loadDashboardStats() {
    var users = getUsers();
    var contents = getContents();
    var files = getFiles();
    var guestbook = getGuestbookList();
    var feedback = window.getFeedbacks ? getFeedbacks() : [];
    var now = new Date();
    var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).getTime();

    var totalUsers = users.length;
    var onlineUsers = Math.floor(totalUsers * 0.3); // 模拟在线人数
    var todayUsers = 0;
    var weekUsers = 0;
    var todayActive = 0;
    for (var i = 0; i < users.length; i++) {
        var u = users[i];
        if (u.createdAt >= todayStart) todayUsers++;
        if (u.createdAt >= weekStart) weekUsers++;
        if ((u.lastLoginAt || 0) >= todayStart) todayActive++;
    }
    var totalContents = contents.length;
    var totalFiles = files.length;
    var totalGuestbook = guestbook.length;
    var totalFeedback = feedback.length;

    // 趋势提示
    var todayContents = 0;
    for (var i = 0; i < contents.length; i++) { if ((contents[i].createdAt || 0) >= todayStart) todayContents++; }
    var guestbookPending = 0;
    for (var i = 0; i < guestbook.length; i++) { if ((guestbook[i].status || 'approved') === 'pending') guestbookPending++; }
    var feedbackPending = 0;
    for (var i = 0; i < feedback.length; i++) { if (!feedback[i].status || feedback[i].status === 'pending') feedbackPending++; }

    document.getElementById('totalUsers').textContent = totalUsers;
    document.getElementById('onlineUsers').textContent = onlineUsers;
    document.getElementById('todayUsers').textContent = todayUsers;
    document.getElementById('weekUsers').textContent = weekUsers;
    document.getElementById('totalContents').textContent = totalContents;
    document.getElementById('totalFiles').textContent = totalFiles;
    document.getElementById('totalGuestbook').textContent = totalGuestbook;
    document.getElementById('totalFeedback').textContent = totalFeedback;
    var activeEl = document.getElementById('todayActive');
    if (activeEl) activeEl.textContent = todayActive;

    setStatTrend('totalUsersTrend', totalUsers ? '累计注册 ' + totalUsers + ' 人' : '暂无用户，快去注册吧');
    setStatTrend('onlineUsersTrend', '模拟在线率约 30%');
    setStatTrend('todayUsersTrend', todayUsers > 0 ? '今日新增 ' + todayUsers + ' 人 ↑' : '今日暂无新增');
    setStatTrend('weekUsersTrend', '近7日新增 ' + weekUsers + ' 人');
    setStatTrend('totalContentsTrend', todayContents > 0 ? '今日新增内容 ' + todayContents + ' 篇' : '今日暂无新内容');
    setStatTrend('totalFilesTrend', '含图片/文档/其他');
    setStatTrend('totalGuestbookTrend', guestbookPending > 0 ? '待处理 ' + guestbookPending + ' 条' : '留言已全部处理');
    setStatTrend('totalFeedbackTrend', feedbackPending > 0 ? '待处理 ' + feedbackPending + ' 条' : '反馈已全部处理');
    var activeTrendEl = document.getElementById('todayActiveTrend');
    if (activeTrendEl) activeTrendEl.textContent = todayActive > 0 ? '今日活跃用户 ' + todayActive + ' 人' : '今日暂无活跃';

    drawChart(users, todayStart, weekStart);
}

function setStatTrend(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
}

// ========== 绘制趋势图 ==========
function drawChart(users, todayStart, weekStart) {
    var canvas = document.getElementById('userTrendChart');
    if (!canvas) return;

    var ctx = canvas.getContext('2d');
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = 300;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 计算近7天每天的新增用户数
    var dailyCounts = [];
    for (var d = 6; d >= 0; d--) {
        var dayStart = new Date(todayStart - d * 24 * 60 * 60 * 1000).getTime();
        var dayEnd = dayStart + 24 * 60 * 60 * 1000;
        var count = 0;
        for (var i = 0; i < users.length; i++) {
            if (users[i].createdAt >= dayStart && users[i].createdAt < dayEnd) count++;
        }
        dailyCounts.push(count);
    }

    var maxCount = Math.max.apply(null, dailyCounts) || 1;
    var padding = 40;
    var chartWidth = canvas.width - padding * 2;
    var chartHeight = canvas.height - padding * 2;

    // 绘制网格线
    ctx.strokeStyle = '#eee';
    ctx.lineWidth = 1;
    for (var i = 0; i <= 4; i++) {
        var y = padding + (chartHeight / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(canvas.width - padding, y);
        ctx.stroke();
    }

    // 绘制折线图
    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (var i = 0; i < dailyCounts.length; i++) {
        var x = padding + (chartWidth / (dailyCounts.length - 1)) * i;
        var y = padding + chartHeight - (dailyCounts[i] / maxCount) * chartHeight;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 绘制点
    ctx.fillStyle = '#667eea';
    for (var i = 0; i < dailyCounts.length; i++) {
        var x = padding + (chartWidth / (dailyCounts.length - 1)) * i;
        var y = padding + chartHeight - (dailyCounts[i] / maxCount) * chartHeight;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
    }

    // 绘制X轴标签
    ctx.fillStyle = '#999';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    for (var i = 0; i < dailyCounts.length; i++) {
        var x = padding + (chartWidth / (dailyCounts.length - 1)) * i;
        var date = new Date(todayStart - i * 24 * 60 * 60 * 1000);
        ctx.fillText((date.getMonth() + 1) + '/' + date.getDate(), x, canvas.height - 10);
    }
}

// ========== 用户管理 ==========
function renderUsersTable() {
    var users = getUsers();
    var searchTerm = document.getElementById('userSearch') ? document.getElementById('userSearch').value.toLowerCase() : '';
    var roleFilter = document.getElementById('roleFilter') ? document.getElementById('roleFilter').value : '';
    var sortOrder = document.getElementById('sortOrder') ? document.getElementById('sortOrder').value : 'newest';

    // 筛选：用户名/昵称/手机号/邮箱/账号ID
    var filtered = users.filter(function(u) {
        if (!searchTerm) return true;
        var hay = (u.username || '').toLowerCase() + ' ' + (u.nickname || '').toLowerCase() + ' ' + (u.phone || u.mobile || '').toLowerCase() + ' ' + (u.email || '').toLowerCase() + ' ' + String(u.accountId || '');
        return hay.indexOf(searchTerm) !== -1;
    }).filter(function(u) {
        return !roleFilter || u.role === roleFilter;
    });

    // 排序
    filtered.sort(function(a, b) {
        return sortOrder === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt;
    });

    var tbody = document.getElementById('usersTableBody');
    if (!tbody) return;

    var _session = getSession();
    var _isSuper = _session && _session.role === 'super_admin';
    var html = '';
    for (var i = 0; i < filtered.length; i++) {
        var u = filtered[i];
        var dateStr = new Date(u.createdAt).toLocaleDateString('zh-CN');
        var lastLogin = u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('zh-CN') : (u.lastLogin || '未登录');
        var roleLabel = u.role === 'super_admin' ? '<span class="role-badge super-admin">超级管理员</span>' : (u.role === 'admin' ? '<span class="role-badge admin">管理员</span>' : '<span class="role-badge user">普通用户</span>');
        var statusLabel = u.disabled ? '<span class="role-badge rejected">已禁用</span>' : '<span class="role-badge ok">正常</span>';
        var actionBtns = '';
        if (u.username === (_session && _session.username)) {
            actionBtns = '<span style="color:#999">本人</span>';
        } else if ((u.role === 'super_admin' || u.role === 'admin') && !_isSuper) {
            // 普通管理员不能修改或删除其他管理员账号
            actionBtns = '<button class="btn-small btn-primary" onclick="viewUserDetail(\'' + u.username + '\')">详情</button>';
        } else {
            actionBtns = '<button class="btn-small btn-primary" onclick="viewUserDetail(\'' + u.username + '\')">详情</button>' +
                        '<button class="btn-small" onclick="toggleUserStatus(\'' + u.username + '\')">' + (u.disabled ? '启用' : '禁用') + '</button>' +
                        '<button class="btn-small" onclick="changeRole(\'' + u.username + '\')">降级</button>' +
                        '<button class="btn-small btn-danger" onclick="deleteUser(\'' + u.username + '\')">删除</button>';
        }
        html += '<tr><td><input type="checkbox" class="user-checkbox" value="' + u.username + '"></td><td>' + String(u.accountId || (i + 1)) + '</td><td>' + u.username + '</td><td>' + (u.nickname || '-') + '</td><td>' + (u.accountId || '-') + '</td><td>' + roleLabel + '</td><td>' + statusLabel + '</td><td>' + dateStr + '</td><td>' + lastLogin + '</td><td>' + (u.phone || u.mobile || '-') + '</td><td>' + (u.email || '-') + '</td><td>' + actionBtns + '</td></tr>';
    }
    tbody.innerHTML = html || '<tr><td colspan="12" style="text-align:center;color:#999;">暂无匹配用户</td></tr>';
}

// ========== 全选/取消全选 ==========
function toggleSelectAll() {
    var checkboxes = document.querySelectorAll('.user-checkbox');
    var allChecked = document.getElementById('selectAll').checked;
    checkboxes.forEach(function(cb) { cb.checked = allChecked; });
}

// ========== 导出用户列表CSV ==========
function exportUserList() {
    var users = getUsers();
    var rows = [['用户名', '昵称', '账号', '角色', '注册时间', '邮箱', '个人简介']];
    for (var i = 0; i < users.length; i++) {
        var u = users[i];
        var roleText = u.role === 'super_admin' ? '超级管理员' : (u.role === 'admin' ? '管理员' : '普通用户');
        rows.push([u.username, u.nickname || '', u.accountId || '', roleText, new Date(u.createdAt).toLocaleString('zh-CN'), u.email || '', u.bio || '']);
    }
    var csv = rows.map(function(r) {
        return r.map(function(cell) {
            var s = String(cell).replace(/"/g, '""');
            return /[",\n]/.test(s) ? '"' + s + '"' : s;
        }).join(',');
    }).join('\n');
    // 添加 BOM 以便 Excel 正确识别 UTF-8
    var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = '用户列表_' + new Date().toISOString().slice(0, 10) + '.csv';
    link.click();
    URL.revokeObjectURL(link.href);
    addLog('export_users', '导出用户列表 CSV');
}

// ========== 批量删除用户 ==========
window.deleteSelectedUsers = function () {
    var session = getSession();
    if (!session || session.role === 'user') {
        showToast('无权限执行批量删除', 'error');
        return;
    }
    var checkboxes = document.querySelectorAll('.user-checkbox:checked');
    if (!checkboxes.length) {
        showToast('请先勾选要删除的用户', 'warning');
        return;
    }
    var names = [];
    for (var i = 0; i < checkboxes.length; i++) names.push(checkboxes[i].value);
    if (!confirm('确定删除选中的 ' + names.length + ' 个用户？\n' + names.join('、'))) return;
    var users = getUsers();
    var remain = users.filter(function (u) {
        if (names.indexOf(u.username) !== -1) {
            if (u.username === session.username) return true; // 不能删除自己
            if (u.role === 'super_admin') return true; // 不能删除超级管理员
            return false;
        }
        return true;
    });
    var skipped = users.length - remain.length;
    saveUsers(remain);
    addLog('delete_user', '批量删除用户 ' + skipped + ' 个：' + names.join('、'));
    var btns = document.querySelectorAll('.user-checkbox');
    for (var k = 0; k < btns.length; k++) btns[k].checked = false;
    var selAll = document.getElementById('selectAll');
    if (selAll) selAll.checked = false;
    renderUsersTable();
    showToast('已删除 ' + skipped + ' 个用户（自己/超级管理员自动跳过）', 'success');
};

// ========== 站点备份导出 ==========
window.exportSiteData = function () {
    var session = getSession();
    if (!session || session.role === 'user') { showToast('无权限导出备份', 'error'); return; }
    var data = {
        exportedAt: new Date().toLocaleString('zh-CN'),
        users: getUsers(),
        contents: getContents(),
        announcements: window.getAnnouncements(),
        messages: getMessages(),
        files: getFiles(),
        interactions: getInteractions(),
        logs: JSON.parse(dataStore.get('adminLogs') || '[]'),
        settings: JSON.parse(dataStore.get('siteSettings') || '{}'),
        guestbook: getGuestbook(),
        feedbacks: window.getFeedbacks(),
        visitLog: getVisitLog(),
        growth: (function () {
            var map = {};
            var users = getUsers();
            for (var i = 0; i < users.length; i++) {
                var g = getGrowth(users[i].username);
                if (g) map[users[i].username] = g;
            }
            return map;
        })()
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = '站点备份_' + new Date().toISOString().slice(0, 10) + '.json';
    link.click();
    URL.revokeObjectURL(link.href);
    addLog('update_settings', '导出站点备份（' + data.users.length + ' 用户 / ' + data.contents.length + ' 内容）');
    showToast('站点备份已导出', 'success');
};

// ========== 备份文件选择 ==========
window.importSiteData = function (files) {
    if (!files || !files.length) return;
    var label = document.getElementById('siteBackupFileLabel');
    if (label) label.value = files[0].name;
};

// ========== 备份导入恢复 ==========
window.doImportSiteData = function () {
    var session = getSession();
    if (!session || session.role === 'user') { showToast('无权限恢复备份', 'error'); return; }
    var fileInput = document.getElementById('siteBackupFile');
    if (!fileInput || !fileInput.files || !fileInput.files.length) {
        showToast('请先选择备份文件', 'warning');
        return;
    }
    var file = fileInput.files[0];
    var reader = new FileReader();
    reader.onload = function (e) {
        var data = null;
        try { data = JSON.parse(e.target.result); } catch (err) { showToast('备份文件解析失败，请检查文件格式', 'error'); return; }
        if (!data || !Array.isArray(data.users)) { showToast('不是有效的站点备份文件', 'error'); return; }
        if (!confirm('恢复备份将覆盖现有用户、内容、公告等全部数据，且恢复后需重新登录。确定继续？')) return;
        dataStore.set('users', JSON.stringify(data.users || []));
        dataStore.set('siteContents', JSON.stringify(data.contents || []));
        dataStore.set('announcements', JSON.stringify(data.announcements || []));
        if (data.messages) dataStore.set('messages', JSON.stringify(data.messages));
        if (data.files) dataStore.set('managedFiles', JSON.stringify(data.files));
        if (data.interactions) dataStore.set('contentInteractions', JSON.stringify(data.interactions));
        if (data.logs) dataStore.set('adminLogs', JSON.stringify(data.logs));
        if (data.settings) dataStore.set('siteSettings', JSON.stringify(data.settings));
        if (data.guestbook) dataStore.set('siteGuestbook', JSON.stringify(data.guestbook));
        if (data.feedbacks) dataStore.set('siteFeedbacks', JSON.stringify(data.feedbacks));
        if (data.visitLog) dataStore.set('siteVisitLog', JSON.stringify(data.visitLog));
        if (data.growth) {
            for (var name in data.growth) {
                if (Object.prototype.hasOwnProperty.call(data.growth, name)) {
                    dataStore.set('siteGrowth_' + name, JSON.stringify(data.growth[name]));
                }
            }
        }
        dataStore.remove('currentUser');
        showToast('恢复成功，请重新登录', 'success');
        setTimeout(function () { location.href = 'login.html'; }, 900);
    };
    reader.readAsText(file);
};

// ========== 查看用户详情 ==========
window.viewUserDetail = function(username) {
    var users = getUsers();
    var user = null;
    for (var i = 0; i < users.length; i++) {
        if (users[i].username === username) { user = users[i]; break; }
    }
    if (!user) return;

    document.getElementById('userDetailModal').querySelector('h3').textContent = '用户详情';
    var body = document.getElementById('userDetailBody');
    body.innerHTML = '<p><strong>用户名：</strong>' + user.username + '</p>' +
                    '<p><strong>昵称：</strong>' + (user.nickname || '-') + '</p>' +
                    '<p><strong>角色：</strong>' + (user.role === 'super_admin' ? '超级管理员' : (user.role === 'admin' ? '管理员' : '普通用户')) + '</p>' +
                    '<p><strong>账号：</strong>' + (user.accountId || '未分配') + '</p>' +
                    '<p><strong>注册时间：</strong>' + new Date(user.createdAt).toLocaleString('zh-CN') + '</p>' +
                    '<p><strong>邮箱：</strong>' + (user.email || '-') + '</p>' +
                    '<p><strong>个人简介：</strong>' + (user.bio || '-') + '</p>' +
                    '<p><strong>头像URL：</strong>' + (user.avatarUrl || '-') + '</p>';
    openModal('userDetailModal');
};

// ========== 弹窗控制 ==========
function openModal(modalId) {
    var modal = document.getElementById(modalId || 'userDetailModal');
    if (modal) {
        modal.style.display = 'flex';
        modal.classList.remove('modal-in');
        void modal.offsetWidth;
        modal.classList.add('modal-in');
    }
}

function closeModal() {
    document.querySelectorAll('.modal-overlay').forEach(function(modal) {
        modal.style.display = 'none';
    });
}

window.closeModal = closeModal;

// ========== 新建管理员（仅超级管理员）==========
window.openCreateAdminModal = function () {
    var session = getSession();
    if (!session || session.role !== 'super_admin') {
        alert('无权限创建管理员！');
        return;
    }
    document.getElementById('adminUsername').value = '';
    document.getElementById('adminPassword').value = '';
    document.getElementById('adminNickname').value = '';
    openModal('createAdminModal');
};

window.createAdmin = function () {
    var session = getSession();
    if (!session || session.role !== 'super_admin') {
        alert('无权限创建管理员！');
        return;
    }
    var username = document.getElementById('adminUsername').value.trim();
    var password = document.getElementById('adminPassword').value;
    var nickname = document.getElementById('adminNickname').value.trim();

    if (!username) { alert('请输入管理员用户名'); return; }
    if (username.length > 6) { alert('用户名最多6个字符'); return; }
    if (/^1[3-9]\d{9}$/.test(username)) { alert('用户名不能使用手机号格式'); return; }
    if (/^[\w.-]+@[\w-]+(\.[\w-]+)+$/.test(username)) { alert('用户名不能使用邮箱格式'); return; }
    var strength = checkPasswordStrength(password);
    if (!strength.ok) { alert(strength.tip); return; }

    var users = getUsers();
    for (var i = 0; i < users.length; i++) {
        if (users[i].username === username) {
            alert('该用户名已存在，请更换');
            return;
        }
    }

    users.push({
        username: username,
        password: password,
        role: 'admin',
        nickname: nickname || '',
        createdAt: Date.now(),
        accountId: genAccountId(users, 'admin')
    });
    saveUsers(users);
    addLog('create_admin', '创建管理员账号：' + username);
    closeModal();
    renderUsersTable();
    alert('管理员账号 "' + username + '" 创建成功！');
};

// ========== 角色变更 ==========
window.changeRole = function (username) {
    var session = getSession();
    var users = getUsers();
    var target = null;
    for (var i = 0; i < users.length; i++) {
        if (users[i].username === username) { target = users[i]; break; }
    }
    if (!target) return;
    // 普通管理员无权降级任何管理员账号
    if (session && session.role !== 'super_admin' && (target.role === 'super_admin' || target.role === 'admin')) {
        alert('普通管理员无权修改其他管理员账号！');
        return;
    }
    if (!confirm('确定将 "' + username + '" 降级为普通用户？')) return;
    for (var j = 0; j < users.length; j++) {
        if (users[j].username === username) {
            users[j].role = 'user';
            break;
        }
    }
    saveUsers(users);
    addLog('change_role', '将 ' + username + ' 降级为普通用户');
    renderUsersTable();
};

// ========== 删除用户 ==========
window.deleteUser = function (username) {
    var session = getSession();
    var users = getUsers();
    var target = null;
    for (var i = 0; i < users.length; i++) {
        if (users[i].username === username) { target = users[i]; break; }
    }
    if (!target) return;
    // 不能删除当前登录账号
    if (session && session.username === username) {
        alert('不能删除当前登录的账号！');
        return;
    }
    // 普通管理员无权删除任何管理员账号
    if (session && session.role !== 'super_admin' && (target.role === 'super_admin' || target.role === 'admin')) {
        alert('普通管理员无权删除其他管理员账号！');
        return;
    }
    if (!confirm('确定删除用户 "' + username + '"？此操作不可恢复！')) return;
    var newUsers = [];
    for (var j = 0; j < users.length; j++) {
        if (users[j].username !== username) {
            newUsers.push(users[j]);
        }
    }
    saveUsers(newUsers);
    addLog('delete_user', '删除用户 ' + username);
    renderUsersTable();
};

// ========== 系统设置 ==========
function loadSettings() {
    var settings = JSON.parse(dataStore.get('siteSettings') || '{}');
    document.getElementById('siteName').value = settings.siteName || '';
    document.getElementById('siteDescription').value = settings.siteDescription || '';
    document.getElementById('siteEmail').value = settings.supportEmail || '';
    document.getElementById('announcement').value = settings.announcement || '';
    document.getElementById('showAnnouncement').checked = settings.showAnnouncement || false;
    var themeColorEl = document.getElementById('themeColor');
    if (themeColorEl) themeColorEl.value = settings.themeColor || '#667eea';
    
    var themeRadio = document.querySelector('input[name="theme"][value="' + (settings.theme || 'light') + '"]');
    if (themeRadio) themeRadio.checked = true;
}

function saveSettings() {
    var themeColor = document.getElementById('themeColor') ? document.getElementById('themeColor').value : '#667eea';
    var settings = {
        siteName: document.getElementById('siteName').value,
        siteDescription: document.getElementById('siteDescription').value,
        supportEmail: document.getElementById('siteEmail') ? document.getElementById('siteEmail').value : '',
        announcement: document.getElementById('announcement').value,
        showAnnouncement: document.getElementById('showAnnouncement').checked,
        theme: document.querySelector('input[name="theme"]:checked').value,
        themeColor: themeColor
    };
    dataStore.set('siteSettings', JSON.stringify(settings));
    applySiteSettings();
    addLog('update_settings', '更新系统设置（站点信息/公告/主题色）');
    alert('设置已保存！');
}

// 将站点配置应用到前台各页面（站点名称/描述/公告/主题）
function applySiteSettings() {
    var settings = JSON.parse(dataStore.get('siteSettings') || '{}');
    // 站点名称：导航品牌 + 页面标题
    if (settings.siteName) {
        var brand = document.querySelector('.site-brand');
        if (brand) brand.textContent = settings.siteName;
        document.title = (document.title.indexOf(' - ') >= 0 ? document.title.split(' - ')[0] + ' - ' : '') + settings.siteName;
    }
    // 站点描述
    if (settings.siteDescription) {
        var descEl = document.getElementById('siteDescriptionText');
        if (descEl) descEl.textContent = settings.siteDescription;
    }
    // 公告
    var annBar = document.getElementById('announcementBar');
    var annText = document.getElementById('announcementText');
    if (annBar && annText) {
        if (settings.announcement) {
            annText.textContent = settings.announcement;
            annBar.style.display = 'block';
        } else {
            annBar.style.display = 'none';
        }
    }
    // 主题
    if (settings.theme === 'dark') {
        document.body.classList.add('dark-theme');
    } else {
        document.body.classList.remove('dark-theme');
    }
    var themeBtn = document.querySelector('.theme-btn');
    if (themeBtn) themeBtn.textContent = document.body.classList.contains('dark-theme') ? '浅色模式' : '深色模式';

    // 主题色：设置 CSS 变量，全站按钮/链接/强调色生效
    if (settings.themeColor) {
        document.documentElement.style.setProperty('--brand-color', settings.themeColor);
        document.documentElement.style.setProperty('--brand-gradient', 'linear-gradient(135deg, ' + settings.themeColor + ', #764ba2)');
        document.body.setAttribute('data-brand-color', settings.themeColor);
    }
    // 支持邮箱：更新前台页脚/帮助入口
    if (settings.supportEmail) {
        var emailEls = document.querySelectorAll('[data-support-email]');
        for (var ei = 0; ei < emailEls.length; ei++) emailEls[ei].textContent = settings.supportEmail;
        var mailLinks = document.querySelectorAll('a[href^="mailto:"]');
        for (var mi = 0; mi < mailLinks.length; mi++) mailLinks[mi].setAttribute('href', 'mailto:' + settings.supportEmail);
    }
}

// ========== 内容管理 ==========
function renderContentTable() {
    var contents = getContents();
    var searchTerm = document.getElementById('contentSearch') ? document.getElementById('contentSearch').value.toLowerCase() : '';
    var typeFilter = document.getElementById('contentTypeFilter') ? document.getElementById('contentTypeFilter').value : '';
    var statusFilter = document.getElementById('contentStatusFilter') ? document.getElementById('contentStatusFilter').value : '';

    var filtered = contents.filter(function(c) {
        var matchSearch = !searchTerm || (c.title || '').toLowerCase().indexOf(searchTerm) !== -1 || (c.body && c.body.toLowerCase().indexOf(searchTerm) !== -1);
        var matchType = !typeFilter || c.type === typeFilter;
        var matchStatus = !statusFilter || c.status === statusFilter;
        return matchSearch && matchType && matchStatus;
    });

    var tbody = document.getElementById('contentTableBody');
    if (!tbody) return;

    var html = '';
    for (var i = 0; i < filtered.length; i++) {
        var c = filtered[i];
        var typeLabel = c.type === 'article' ? '文章' : '页面';
        var statusLabel = '';
        if (c.status === 'published') statusLabel = '<span class="role-badge user">已发布</span>';
        else if (c.status === 'pinned') statusLabel = '<span class="role-badge super-admin">已置顶</span>';
        else if (c.status === 'offline') statusLabel = '<span class="role-badge rejected">已下线</span>';
        else statusLabel = '<span class="role-badge admin">草稿</span>';
        html += '<tr><td><input type="checkbox" class="content-checkbox" value="' + c.id + '"></td><td>' + c.id + '</td><td>' + (c.title || '') + '</td><td>' + typeLabel + '</td><td>' + statusLabel + '</td><td>' + (c.author || 'admin') + '</td><td>' + new Date(c.createdAt).toLocaleDateString('zh-CN') + '</td>' +
            '<td><button class="btn-small btn-primary" onclick="editContent(' + c.id + ')">编辑</button>' +
            (c.status !== 'pinned' ? '<button class="btn-small" onclick="pinContent(' + c.id + ')">置顶</button>' : '') +
            (c.status !== 'offline' ? '<button class="btn-small btn-secondary" onclick="offlineContent(' + c.id + ')">下线</button>' : '') +
            '<button class="btn-small btn-danger" onclick="deleteContent(' + c.id + ')">删除</button></td></tr>';
    }
    tbody.innerHTML = html || '<tr><td colspan="8" style="text-align:center;color:#999;">暂无匹配内容</td></tr>';
}

function openContentModal(id) {
    document.getElementById('contentModalTitle').textContent = id ? '编辑内容' : '新建内容';
    if (id) {
        var contents = getContents();
        var item = null;
        for (var i = 0; i < contents.length; i++) {
            if (contents[i].id === id) { item = contents[i]; break; }
        }
        if (item) {
            document.getElementById('contentTitle').value = item.title;
            document.getElementById('contentType').value = item.type;
            document.getElementById('contentStatus').value = item.status;
            document.getElementById('contentBody').value = item.body || '';
            document.getElementById('contentForm').dataset.editId = id;
        }
    } else {
        document.getElementById('contentTitle').value = '';
        document.getElementById('contentType').value = 'article';
        document.getElementById('contentStatus').value = 'draft';
        document.getElementById('contentBody').value = '';
        delete document.getElementById('contentForm').dataset.editId;
    }
    openModal('contentModal');
}

window.openContentModal = openContentModal;

function saveContent() {
    var title = document.getElementById('contentTitle').value.trim();
    var type = document.getElementById('contentType').value;
    var status = document.getElementById('contentStatus').value;
    var body = document.getElementById('contentBody').value.trim();

    if (!title) { alert('请输入标题'); return; }

    var contents = getContents();
    var editId = document.getElementById('contentForm').dataset.editId;

    if (editId) {
        for (var i = 0; i < contents.length; i++) {
            if (contents[i].id === parseInt(editId)) {
                contents[i].title = title;
                contents[i].type = type;
                contents[i].status = status;
                contents[i].body = body;
                contents[i].updatedAt = Date.now();
                break;
            }
        }
        addLog('edit_content', '编辑内容: ' + title);
    } else {
        contents.push({
            id: contents.length ? Math.max.apply(null, contents.map(function(c) { return c.id; })) + 1 : 1,
            title: title,
            type: type,
            status: status,
            body: body,
            author: getSession().username,
            createdAt: Date.now(),
            updatedAt: Date.now()
        });
        addLog('create_content', '创建内容: ' + title);
    }
    saveContents(contents);
    closeModal();
    renderContentTable();
    alert('内容已保存！');
}

function editContent(id) {
    openContentModal(id);
}

window.editContent = editContent;

window.deleteContent = function(id) {
    if (!confirm('确定删除该内容？')) return;
    var contents = getContents();
    var item = null;
    for (var i = 0; i < contents.length; i++) {
        if (contents[i].id === id) { item = contents[i]; break; }
    }
    var newContents = contents.filter(function(c) { return c.id !== id; });
    saveContents(newContents);
    addLog('delete_content', '删除内容: ' + (item ? item.title : id));
    renderContentTable();
};

// ========== 文件管理 ==========
function handleFileUpload(files) {
    if (!files || !files.length) return;
    var managedFiles = getFiles();
    var session = getSession();
    var pending = Array.prototype.slice.call(files);

    function processNext() {
        if (!pending.length) {
            saveFiles(managedFiles);
            addLog('upload_file', '上传文件 ' + files.length + ' 个');
            renderFilesTable();
            alert('文件上传成功！');
            return;
        }
        var file = pending.shift();
        var reader = new FileReader();
        reader.onload = function(e) {
            var size = file.size;
            var type = 'other';
            if (/image\/(png|jpe?g|gif|webp|svg|bmp)/i.test(file.type)) type = 'image';
            else if (/text|document|pdf|word|excel|sheet|json|xml/i.test(file.type)) type = 'document';
            managedFiles.push({
                id: managedFiles.length ? Math.max.apply(null, managedFiles.map(function(f) { return f.id; })) + 1 : 1,
                name: file.name,
                size: size,
                type: type,
                mime: file.type || 'application/octet-stream',
                data: e.target.result,
                uploader: session.username,
                uploadedAt: Date.now()
            });
            processNext();
        };
        reader.readAsDataURL(file);
    }
    processNext();
}

window.handleFileUpload = handleFileUpload;

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function renderFilesTable() {
    var files = getFiles();
    var searchTerm = document.getElementById('fileSearch') ? document.getElementById('fileSearch').value.toLowerCase() : '';
    var typeFilter = document.getElementById('fileTypeFilter') ? document.getElementById('fileTypeFilter').value : '';

    var filtered = files.filter(function(f) {
        var matchSearch = !searchTerm || f.name.toLowerCase().indexOf(searchTerm) !== -1;
        var matchType = !typeFilter || f.type === typeFilter;
        return matchSearch && matchType;
    });

    var tbody = document.getElementById('filesTableBody');
    if (!tbody) return;

    var html = '';
    for (var i = 0; i < filtered.length; i++) {
        var f = filtered[i];
        var typeLabel = f.type === 'image' ? '图片' : (f.type === 'document' ? '文档' : '其他');
        html += '<tr><td><input type="checkbox" class="file-checkbox" value="' + f.id + '"></td><td>' + f.id + '</td><td>' + f.name + '</td><td>' + typeLabel + '</td><td>' + formatFileSize(f.size) + '</td><td>' + f.uploader + '</td><td>' + new Date(f.uploadedAt).toLocaleString('zh-CN') + '</td>' +
            '<td><button class="btn-small btn-primary" onclick="downloadFile(' + f.id + ')">下载</button>' +
            '<button class="btn-small btn-danger" onclick="deleteFile(' + f.id + ')">删除</button></td></tr>';
    }
    tbody.innerHTML = html || '<tr><td colspan="8" style="text-align:center;color:#999;">暂无文件</td></tr>';
}

window.downloadFile = function(id) {
    var files = getFiles();
    var item = null;
    for (var i = 0; i < files.length; i++) {
        if (files[i].id === id) { item = files[i]; break; }
    }
    if (!item) return;
    var link = document.createElement('a');
    link.href = item.data;
    link.download = item.name;
    link.click();
    addLog('download_file', '下载文件: ' + item.name);
};

window.deleteFile = function(id) {
    if (!confirm('确定删除该文件？')) return;
    var files = getFiles();
    var item = null;
    for (var i = 0; i < files.length; i++) {
        if (files[i].id === id) { item = files[i]; break; }
    }
    saveFiles(files.filter(function(f) { return f.id !== id; }));
    addLog('delete_file', '删除文件: ' + (item ? item.name : id));
    renderFilesTable();
};

// ========== 公告管理 ==========
function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderAnnouncementsTable() {
    var list = window.getAnnouncements();
    var tbody = document.getElementById('announcementsTableBody');
    if (!tbody) return;
    // 置顶公告优先展示
    list = list.slice().sort(function (a, b) {
        return ((b.top ? 1 : 0) - (a.top ? 1 : 0)) || 0;
    });
    var html = '';
    for (var i = 0; i < list.length; i++) {
        var item = list[i];
        var statusLabel = item.status === 'draft' ? '<span class="role-badge user">草稿</span>' : '<span class="role-badge super-admin">已发布</span>';
        var pinLabel = item.top ? '<span class="pin-badge">置顶</span>' : '';
        html += '<tr><td>' + item.id + '</td><td>' + esc(item.title) + pinLabel + '</td><td>' + esc(item.content) + '</td><td>' + esc(item.time || '') + '</td><td>' + statusLabel + '</td>' +
            '<td><button class="btn-small btn-primary" onclick="editAnnouncement(' + item.id + ')">编辑</button>' +
            (item.top ? '<button class="btn-small btn-secondary" onclick="toggleAnnouncementTop(' + item.id + ')">取消置顶</button>' : '<button class="btn-small btn-secondary" onclick="toggleAnnouncementTop(' + item.id + ')">置顶</button>') +
            '<button class="btn-small btn-danger" onclick="deleteAnnouncement(' + item.id + ')">删除</button></td></tr>';
    }
    tbody.innerHTML = html;
}

// ========== 公告置顶切换 ==========
window.toggleAnnouncementTop = function (id) {
    var list = window.getAnnouncements();
    var item = null;
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) { item = list[i]; break; }
    }
    if (!item) return;
    item.top = !item.top;
    window.saveAnnouncements(list);
    addLog('update_settings', (item.top ? '置顶' : '取消置顶') + '公告: ' + item.title);
    renderAnnouncementsTable();
};

function openAnnouncementModal() {
    document.getElementById('announcementModalTitle').textContent = '发布公告';
    document.getElementById('announcementTitle').value = '';
    document.getElementById('announcementContent').value = '';
    document.getElementById('announcementStatus').value = 'published';
    openModal('announcementModal');
}

function saveAnnouncement() {
    var title = document.getElementById('announcementTitle').value.trim();
    var content = document.getElementById('announcementContent').value.trim();
    if (!title) { alert('请输入公告标题'); return; }
    if (!content) { alert('请输入公告内容'); return; }
    var status = document.getElementById('announcementStatus').value;
    var list = window.getAnnouncements();
    var editingId = parseInt(document.getElementById('announcementModalTitle').getAttribute('data-edit-id') || '0', 10);
    if (editingId) {
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === editingId) {
                list[i].title = title;
                list[i].content = content;
                list[i].status = status;
                break;
            }
        }
    } else {
        var d = new Date();
        var time = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + ' ' + d.getHours() + ':' + d.getMinutes();
        list.unshift({
            id: list.length ? Math.max.apply(null, list.map(function(a) { return a.id; })) + 1 : 1,
            title: title,
            content: content,
            status: status,
            time: time
        });
    }
    window.saveAnnouncements(list);
    document.getElementById('announcementModalTitle').removeAttribute('data-edit-id');
    addLog('edit_content', '保存公告: ' + title);
    closeModal();
    renderAnnouncementsTable();
}

window.editAnnouncement = function(id) {
    var list = window.getAnnouncements();
    var item = null;
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) { item = list[i]; break; }
    }
    if (!item) return;
    document.getElementById('announcementModalTitle').textContent = '编辑公告';
    document.getElementById('announcementModalTitle').setAttribute('data-edit-id', id);
    document.getElementById('announcementTitle').value = item.title;
    document.getElementById('announcementContent').value = item.content;
    document.getElementById('announcementStatus').value = item.status || 'published';
    openModal('announcementModal');
};

window.deleteAnnouncement = function(id) {
    if (!confirm('确定删除该公告？')) return;
    var list = window.getAnnouncements();
    var item = null;
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) { item = list[i]; break; }
    }
    window.saveAnnouncements(list.filter(function(a) { return a.id !== id; }));
    addLog('delete_content', '删除公告: ' + (item ? item.title : id));
    renderAnnouncementsTable();
};

// ========== 反馈管理 ==========
function renderFeedbackTable() {
    var list = window.getFeedbacks();
    var statusFilter = document.getElementById('feedbackStatusFilter') ? document.getElementById('feedbackStatusFilter').value : '';
    var filtered = statusFilter ? list.filter(function(f) { return f.status === statusFilter; }) : list;
    var tbody = document.getElementById('feedbackTableBody');
    if (!tbody) return;
    var html = '';
    for (var i = 0; i < filtered.length; i++) {
        var item = filtered[i];
        var statusLabel = '';
        if (item.status === 'resolved') statusLabel = '<span class="role-badge super-admin">已解决</span>';
        else if (item.status === 'rejected') statusLabel = '<span class="role-badge user">已驳回</span>';
        else statusLabel = '<span class="role-badge admin">待处理</span>';
        html += '<tr><td><input type="checkbox" class="feedback-checkbox" value="' + item.id + '"></td><td>' + item.id + '</td><td>' + esc(item.title) + '</td><td>' + esc(item.body) + '</td><td>' + esc(item.author || '匿名') + '</td><td>' + esc(item.time || '') + '</td><td>' + statusLabel + '</td>' +
            '<td><button class="btn-small btn-primary" onclick="resolveFeedback(' + item.id + ')">标记解决</button>' +
            '<button class="btn-small btn-secondary" onclick="rejectFeedback(' + item.id + ')">驳回</button>' +
            '<button class="btn-small btn-danger" onclick="deleteFeedback(' + item.id + ')">删除</button></td></tr>';
    }
    tbody.innerHTML = html || '<tr><td colspan="8" style="text-align:center;color:#999;">暂无反馈</td></tr>';
}

window.resolveFeedback = function(id) {
    var list = window.getFeedbacks();
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) { list[i].status = 'resolved'; break; }
    }
    window.saveFeedbacks(list);
    addLog('update_settings', '标记反馈已解决: ' + id);
    renderFeedbackTable();
};

window.rejectFeedback = function(id) {
    var list = window.getFeedbacks();
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) { list[i].status = 'rejected'; break; }
    }
    window.saveFeedbacks(list);
    addLog('update_settings', '驳回反馈: ' + id);
    renderFeedbackTable();
};

window.deleteFeedback = function(id) {
    if (!confirm('确定删除该反馈？')) return;
    var list = window.getFeedbacks();
    window.saveFeedbacks(list.filter(function(f) { return f.id !== id; }));
    addLog('delete_content', '删除反馈: ' + id);
    renderFeedbackTable();
};

window.exportFeedbackList = function() {
    var list = window.getFeedbacks();
    if (!list.length) { alert('暂无反馈可导出'); return; }
    var rows = [['ID', '标题', '内容', '提交人', '时间', '状态']];
    var statusMap = { pending: '待处理', resolved: '已解决', rejected: '已驳回' };
    list.forEach(function(f) {
        rows.push([f.id, f.title, f.body, f.author || '匿名', f.time || '', statusMap[f.status] || f.status || '待处理']);
    });
    var csv = rows.map(function(r) {
        return r.map(function(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');
    var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = '反馈列表_' + new Date().toISOString().slice(0, 10) + '.csv';
    link.click();
    URL.revokeObjectURL(link.href);
    addLog('export_users', '导出反馈列表');
};

// ========== 仪表盘 CSS 图表 ==========
function renderCssCharts() {
    var users = [];
    var barEl = document.getElementById('cssBarChart');
    if (barEl) {
        users = getUsers();
        var contents = getContents();
        var files = getFiles();
        var messages = getMessages();
        var labels = ['用户', '内容', '文件', '消息'];
        var values = [users.length, contents.length, files.length, messages.length];
        var max = Math.max.apply(null, values.concat([1]));
        var html = '';
        for (var i = 0; i < labels.length; i++) {
            var pct = Math.round(values[i] / max * 100);
            html += '<div class="css-bar-row"><span class="css-bar-label">' + labels[i] + '</span>' +
                '<div class="css-bar-track"><div class="css-bar-fill" style="width:' + pct + '%"></div></div>' +
                '<span class="css-bar-value">' + values[i] + '</span></div>';
        }
        barEl.innerHTML = html;
    }
    var ringEl = document.getElementById('donutRing');
    if (ringEl) {
        var roles = { super_admin: 0, admin: 0, user: 0 };
        users.forEach(function(u) { roles[u.role] = (roles[u.role] || 0) + 1; });
        var total = users.length || 1;
        var segs = [
            { label: '超级管理员', value: roles.super_admin || 0, color: '#667eea' },
            { label: '管理员', value: roles.admin || 0, color: '#764ba2' },
            { label: '普通用户', value: roles.user || 0, color: '#a78bfa' }
        ];
        var acc = 0;
        var stopPts = [];
        for (var j = 0; j < segs.length; j++) {
            acc += segs[j].value;
            stopPts.push(Math.round(acc / total * 100));
        }
        var pct1 = stopPts[0], pct2 = stopPts[1], pct3 = 100;
        var grad = 'conic-gradient(' + segs[0].color + ' 0% ' + pct1 + '%, ' + segs[1].color + ' ' + pct1 + '% ' + pct2 + '%, ' + segs[2].color + ' ' + pct2 + '% ' + pct3 + '%)';
        ringEl.style.background = grad;
        var legend = document.getElementById('donutLegend');
        if (legend) {
            var lhtml = '';
            for (var k = 0; k < segs.length; k++) {
                lhtml += '<div class="donut-legend-item"><span class="donut-dot" style="background:' + segs[k].color + '"></span>' + segs[k].label + ' <b>' + segs[k].value + '</b></div>';
            }
            legend.innerHTML = lhtml;
        }
    }
}

// ========== 消息通知 ==========
function renderMessagesTable() {
    var messages = getMessages();
    var statusFilter = document.getElementById('messageStatusFilter') ? document.getElementById('messageStatusFilter').value : '';

    var filtered = messages.filter(function(m) {
        return !statusFilter || m.status === statusFilter;
    });

    var tbody = document.getElementById('messagesTableBody');
    if (!tbody) return;

    var html = '';
    for (var i = 0; i < filtered.length; i++) {
        var m = filtered[i];
        var statusLabel = m.status === 'unread' ? '<span class="role-badge super-admin">未读</span>' : '<span class="role-badge user">已读</span>';
        html += '<tr><td>' + m.id + '</td><td>' + m.subject + '</td><td>' + (m.sender || 'admin') + '</td><td>' + (m.recipient === 'all' ? '所有用户' : m.recipient) + '</td><td>' + new Date(m.sentAt).toLocaleString('zh-CN') + '</td><td>' + statusLabel + '</td>' +
            '<td><button class="btn-small btn-primary" onclick="viewMessage(' + m.id + ')">查看</button></td></tr>';
    }
    tbody.innerHTML = html;
}

function openMessageModal() {
    var users = getUsers();
    var select = document.getElementById('messageRecipient');
    if (select) {
        select.innerHTML = '<option value="all">所有用户</option>';
        users.forEach(function(u) {
            if (u.username !== getSession().username) {
                select.innerHTML += '<option value="' + u.username + '">' + u.username + '</option>';
            }
        });
    }
    document.getElementById('messageSubject').value = '';
    document.getElementById('messageBody').value = '';
    openModal('messageModal');
}

window.openMessageModal = openMessageModal;

function sendMessage() {
    var recipient = document.getElementById('messageRecipient').value;
    var subject = document.getElementById('messageSubject').value.trim();
    var body = document.getElementById('messageBody').value.trim();

    if (!subject || !body) { alert('请填写主题和内容'); return; }

    var messages = getMessages();
    messages.unshift({
        id: messages.length ? Math.max.apply(null, messages.map(function(m) { return m.id; })) + 1 : 1,
        recipient: recipient,
        subject: subject,
        body: body,
        sender: getSession().username,
        sentAt: Date.now(),
        status: 'unread'
    });
    saveMessages(messages);
    addLog('send_message', '发送站内信: ' + subject);
    closeModal();
    renderMessagesTable();
    alert('消息已发送！');
}

window.viewMessage = function(id) {
    var messages = getMessages();
    var item = null;
    for (var i = 0; i < messages.length; i++) {
        if (messages[i].id === id) { item = messages[i]; break; }
    }
    if (!item) return;
    item.status = 'read';
    saveMessages(messages);

    var body = document.getElementById('userDetailBody');
    document.getElementById('userDetailModal').querySelector('h3').textContent = '站内信详情';
    body.innerHTML = '<p><strong>主题：</strong>' + item.subject + '</p>' +
                    '<p><strong>发件人：</strong>' + item.sender + '</p>' +
                    '<p><strong>收件人：</strong>' + (item.recipient === 'all' ? '所有用户' : item.recipient) + '</p>' +
                    '<p><strong>时间：</strong>' + new Date(item.sentAt).toLocaleString('zh-CN') + '</p>' +
                    '<hr><p>' + item.body.replace(/\n/g, '<br>') + '</p>';
    openModal('userDetailModal');
    renderMessagesTable();
};

// ========== 操作日志 ==========
function renderLogs() {
    var logs = JSON.parse(dataStore.get('adminLogs') || '[]');
    var filterType = document.getElementById('logFilter') ? document.getElementById('logFilter').value : '';
    var searchText = document.getElementById('logSearch') ? document.getElementById('logSearch').value.trim().toLowerCase() : '';

    if (filterType) {
        logs = logs.filter(function(log) { return log.action === filterType; });
    }
    if (searchText) {
        logs = logs.filter(function(log) {
            return (log.admin || '').toLowerCase().indexOf(searchText) !== -1 ||
                   (log.detail || '').toLowerCase().indexOf(searchText) !== -1;
        });
    }

    var tbody = document.getElementById('logsTableBody');
    if (!tbody) return;

    var html = '';
    for (var i = 0; i < logs.length; i++) {
        var log = logs[i];
        var actionLabels = {
            login: '登录', register: '注册', delete_user: '删除用户',
            change_role: '角色变更', update_profile: '更新资料', update_settings: '系统设置',
            create_content: '创建内容', edit_content: '编辑内容', delete_content: '删除内容',
            upload_file: '上传文件', download_file: '下载文件', delete_file: '删除文件',
            send_message: '发送消息', export_users: '导出用户', delete_account: '注销账号',
            toggle_user: '禁用/启用用户', batch_delete_user: '批量删除用户', batch_toggle_user: '批量禁用/启用',
            pin_content: '置顶内容', offline_content: '下线内容', batch_content: '批量内容操作',
            batch_delete_file: '批量删除文件', batch_feedback: '批量处理反馈', export_feedback: '导出反馈',
            approve_guestbook: '通过留言', hide_guestbook: '隐藏留言', delete_guestbook: '删除留言',
            batch_guestbook: '批量留言操作', export_guestbook: '导出留言', export_backup: '导出备份', import_backup: '导入备份'
        };
        html += '<tr><td>' + log.time + '</td><td>' + log.admin + '</td><td>' + (actionLabels[log.action] || log.action) + '</td><td>' + log.detail + '</td></tr>';
    }
    tbody.innerHTML = html;
}

// 前台各页面加载时自动应用站点配置（登录页/注册页/帮助/关于/隐私等均引用本文件）
if (!isAdminPage && typeof applySiteSettings === 'function') {
    applySiteSettings();
}

// ================================================================
// 全局增强模块（IIFE 外部追加）：
// 1. 积分任务中心（每日任务 + 积分流水 + 积分商城）
// 2. 相册画廊（个人相册 + 瀑布流 + 后台相册管理）
// 3. 投票问卷（创建/参与/统计 + 后台管理）
// 4. 个人装扮（签名/头像框/主题色，全站生效）
// 5. 评论互动增强（详情视图/回复/点赞实时更新/互动通知）
// ================================================================

// ---------- 通用工具 ----------
function escHtml(str) {
    if (str == null) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML;
}
function todayKeyStr() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
function nowTextStr() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + ' ' + d.getHours() + ':' + d.getMinutes();
}
function getFullUserByName(username) {
    var users = window.getUsers();
    for (var i = 0; i < users.length; i++) {
        if (users[i].username === username) return users[i];
    }
    return null;
}
function modalOpen(id) {
    var el = document.getElementById(id);
    if (el) { el.style.display = 'flex'; el.classList.add('modal-in'); }
}
function modalClose(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
}
function bindModalClosers(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var closes = el.querySelectorAll('.modal-close');
    for (var i = 0; i < closes.length; i++) {
        closes[i].addEventListener('click', function () { el.style.display = 'none'; });
    }
    el.addEventListener('click', function (e) { if (e.target === el) el.style.display = 'none'; });
}

// ==================== 1. 积分任务中心 ====================
var TASK_DEFS = [
    { id: 'signin', name: '每日签到', desc: '点击个人中心签到按钮完成签到', pts: 5, icon: '签' },
    { id: 'guestbook', name: '发布留言', desc: '在首页留言板发布一条留言', pts: 3, icon: '留' },
    { id: 'comment', name: '发表评论', desc: '为一条内容发表评论', pts: 3, icon: '评' },
    { id: 'like', name: '点赞内容', desc: '为一条内容点赞', pts: 2, icon: '赞' },
    { id: 'browse', name: '浏览内容', desc: '打开一条内容详情进行浏览', pts: 1, icon: '览' }
];
var SHOP_ITEMS = [
    { id: 'badge_bronze', name: '铜质徽章', desc: '个人资料展示铜徽章', price: 150, type: 'badge', value: 'bronze', icon: '铜' },
    { id: 'badge_silver', name: '银质徽章', desc: '个人资料展示银徽章', price: 300, type: 'badge', value: 'silver', icon: '银' },
    { id: 'badge_gold', name: '金质徽章', desc: '个人资料展示金徽章', price: 500, type: 'badge', value: 'gold', icon: '金' },
    { id: 'title_signer', name: '称号：签到狂魔', desc: '首页横幅展示专属称号', price: 400, type: 'title', value: '签到狂魔', icon: '签' },
    { id: 'title_star', name: '称号：互动之星', desc: '首页横幅展示专属称号', price: 600, type: 'title', value: '互动之星', icon: '星' },
    { id: 'title_expert', name: '称号：内容达人', desc: '首页横幅展示专属称号', price: 800, type: 'title', value: '内容达人', icon: '达' }
];

function getTaskData(username) {
    try { return JSON.parse(dataStore.get('taskCenter_' + username) || 'null'); } catch (e) { return null; }
}
function saveTaskData(username, data) {
    dataStore.set('taskCenter_' + username, JSON.stringify(data));
}
function ensureTaskData(username) {
    var data = getTaskData(username);
    var key = todayKeyStr();
    if (!data || data.date !== key) {
        data = { date: key, tasks: {}, logs: [], redeemed: [] };
        for (var i = 0; i < TASK_DEFS.length; i++) {
            data.tasks[TASK_DEFS[i].id] = { done: 0, claimed: 0 };
        }
        saveTaskData(username, data);
    }
    return data;
}
function logTaskPoints(username, pts, desc) {
    if (!username || !pts) return;
    var growth = window.getGrowth(username);
    growth.points = (growth.points || 0) + pts;
    window.saveGrowth(username, growth);
    var data = ensureTaskData(username);
    data.logs.unshift({ time: nowTextStr(), action: desc, pts: pts });
    if (data.logs.length > 200) data.logs.length = 200;
    saveTaskData(username, data);
    window.addLog('points', '用户 ' + username + ' 积分 +' + pts + '（' + desc + '）');
}

window.markTaskDone = function (taskId) {
    var session = window.getSession();
    if (!session || !session.username) return;
    var data = ensureTaskData(session.username);
    if (data.tasks[taskId]) data.tasks[taskId].done = 1;
    saveTaskData(session.username, data);
    if (document.getElementById('taskCenterPanel')) window.renderTaskCenter();
};

window.claimTask = function (taskId) {
    var session = window.getSession();
    if (!session || !session.username) { alert('请先登录'); return; }
    var data = ensureTaskData(session.username);
    var task = data.tasks[taskId];
    var def = null;
    for (var i = 0; i < TASK_DEFS.length; i++) { if (TASK_DEFS[i].id === taskId) def = TASK_DEFS[i]; }
    if (!def) return;
    if (!task || !task.done) { alert('任务尚未完成，先去完成「' + def.name + '」吧'); return; }
    if (task.claimed) { alert('该任务积分已领取'); return; }
    task.claimed = 1;
    saveTaskData(session.username, data);
    logTaskPoints(session.username, def.pts, '完成任务：' + def.name);
    window.renderTaskCenter();
    if (window.showToast) window.showToast('领取成功，积分 +' + def.pts, 'success');
    else alert('领取成功，积分 +' + def.pts);
};

window.renderTaskCenter = function () {
    var panel = document.getElementById('taskCenterPanel');
    if (!panel) return;
    var session = window.getSession();
    if (!session || !session.username) { panel.innerHTML = '<p class="empty-tip">请先登录</p>'; return; }
    var data = ensureTaskData(session.username);
    var html = '<div class="task-grid">';
    for (var i = 0; i < TASK_DEFS.length; i++) {
        var def = TASK_DEFS[i];
        var t = data.tasks[def.id];
        var stateCls = '', btnHtml = '', stateText = '';
        if (t.claimed) { stateCls = 'task-done'; btnHtml = '<span class="task-claimed">已领取</span>'; }
        else if (t.done) { stateCls = 'task-ready'; btnHtml = '<button class="btn btn-primary btn-xs" onclick="window.claimTask(\'' + def.id + '\')">领取 +' + def.pts + '</button>'; }
        else { stateCls = 'task-todo'; btnHtml = '<span class="task-todo-tip">未完成</span>'; }
        html += '<div class="task-card ' + stateCls + '"><div class="task-icon">' + def.icon + '</div>' +
            '<div class="task-info"><div class="task-name">' + escHtml(def.name) + '</div>' +
            '<div class="task-desc">' + escHtml(def.desc) + '</div></div>' +
            '<div class="task-reward">+' + def.pts + ' 积分</div>' +
            '<div class="task-state">' + btnHtml + '</div></div>';
    }
    html += '</div>';

    // 积分流水
    var logs = data.logs || [];
    html += '<div class="task-section-title">积分流水</div>';
    if (!logs.length) html += '<p class="empty-tip">暂无积分流水</p>';
    else {
        html += '<table class="point-log-table"><thead><tr><th>时间</th><th>来源</th><th>积分</th></tr></thead><tbody>';
        for (var l = 0; l < Math.min(logs.length, 30); l++) {
            var lg = logs[l];
            html += '<tr><td>' + escHtml(lg.time) + '</td><td>' + escHtml(lg.action) + '</td><td style="color:#38a169;">+' + lg.pts + '</td></tr>';
        }
        html += '</tbody></table>';
    }

    // 积分商城
    var growth = window.getGrowth(session.username);
    html += '<div class="task-section-title">积分商城 <span class="shop-balance">当前积分：<b>' + (growth.points || 0) + '</b></span></div>';
    html += '<div class="shop-grid">';
    for (var s = 0; s < SHOP_ITEMS.length; s++) {
        var item = SHOP_ITEMS[s];
        var own = (item.type === 'badge' ? (getFullUserByName(session.username).badge === item.value) : (getFullUserByName(session.username).title === item.value));
        html += '<div class="shop-item"><div class="shop-item-icon">' + item.icon + '</div>' +
            '<div class="shop-item-name">' + escHtml(item.name) + '</div>' +
            '<div class="shop-item-desc">' + escHtml(item.desc) + '</div>' +
            '<div class="shop-item-price">' + item.price + ' 积分</div>' +
            (own ? '<span class="shop-owned">已拥有</span>' : '<button class="btn btn-secondary btn-xs" onclick="window.redeemItem(\'' + item.id + '\')">兑换</button>') +
            '</div>';
    }
    html += '</div>';
    panel.innerHTML = html;
};

window.redeemItem = function (itemId) {
    var session = window.getSession();
    if (!session || !session.username) { alert('请先登录'); return; }
    var item = null;
    for (var i = 0; i < SHOP_ITEMS.length; i++) { if (SHOP_ITEMS[i].id === itemId) item = SHOP_ITEMS[i]; }
    if (!item) return;
    var growth = window.getGrowth(session.username);
    if ((growth.points || 0) < item.price) { alert('积分不足，需要 ' + item.price + ' 积分'); return; }
    var users = window.getUsers();
    var user = getFullUserByName(session.username);
    if (!user) { alert('用户不存在'); return; }
    growth.points -= item.price;
    window.saveGrowth(session.username, growth);
    if (item.type === 'badge') user.badge = item.value;
    if (item.type === 'title') user.title = item.value;
    for (var u = 0; u < users.length; u++) { if (users[u].username === session.username) users[u] = user; }
    window.saveUsers(users);
    var data = ensureTaskData(session.username);
    data.redeemed.unshift({ time: nowTextStr(), item: item.name, cost: item.price });
    if (data.redeemed.length > 100) data.redeemed.length = 100;
    data.logs.unshift({ time: nowTextStr(), action: '兑换：' + item.name, pts: -item.price });
    saveTaskData(session.username, data);
    window.addLog('redeem', '用户 ' + session.username + ' 兑换 ' + item.name + '（' + item.price + ' 积分）');
    window.renderTaskCenter();
    window.applyUserDressing && window.applyUserDressing();
    alert('兑换成功！' + item.name + ' 已生效，可在个人资料与首页查看');
};

// ==================== 2. 相册画廊 ====================
function getSiteAlbums() {
    try { return JSON.parse(dataStore.get('siteAlbums') || '[]'); } catch (e) { return []; }
}
function saveSiteAlbums(albums) {
    dataStore.set('siteAlbums', JSON.stringify(albums));
}

window.renderPublicAlbums = function () {
    var wrap = document.getElementById('albumMasonry');
    if (!wrap) return;
    var albums = getSiteAlbums();
    var photos = [];
    for (var i = 0; i < albums.length; i++) {
        for (var j = 0; j < albums[i].photos.length; j++) {
            var p = albums[i].photos[j];
            photos.push({ albumName: albums[i].name, owner: albums[i].owner, photo: p });
        }
    }
    photos.sort(function (a, b) { return (b.photo.uploadedAt || 0) - (a.photo.uploadedAt || 0); });
    photos = photos.slice(0, 30);
    var emptyEl = document.getElementById('albumMasonryEmpty');
    if (emptyEl) emptyEl.style.display = photos.length ? 'none' : 'block';
    if (!photos.length) { wrap.innerHTML = ''; return; }
    var html = '';
    for (var k = 0; k < photos.length; k++) {
        html += '<div class="album-photo-card" title="' + escHtml(photos[k].albumName) + ' - ' + escHtml(photos[k].owner) + '">' +
            '<img src="' + escHtml(photos[k].photo.data) + '" alt="' + escHtml(photos[k].photo.name) + '" loading="lazy">' +
            '<div class="album-photo-meta">' + escHtml(photos[k].albumName) + ' · ' + escHtml(photos[k].owner) + '</div></div>';
    }
    wrap.innerHTML = html;
};

window.createAlbum = function () {
    var session = window.getSession();
    if (!session || !session.username) { alert('请先登录'); return; }
    var nameInput = document.getElementById('albumNameInput');
    var catInput = document.getElementById('albumCategoryInput');
    if (!nameInput) return;
    var name = nameInput.value.trim();
    if (!name) { alert('请填写相册名称'); return; }
    var albums = getSiteAlbums();
    var id = albums.length ? Math.max.apply(null, albums.map(function (a) { return a.id; })) + 1 : 1;
    albums.push({ id: id, owner: session.username, name: name, category: catInput ? catInput.value.trim() : '默认', createdAt: Date.now(), photos: [] });
    saveSiteAlbums(albums);
    nameInput.value = '';
    if (catInput) catInput.value = '';
    window.renderMyAlbums();
    window.renderPublicAlbums();
    window.addLog('album', '用户 ' + session.username + ' 创建相册：' + name);
    alert('相册创建成功！');
};

window.uploadAlbumPhoto = function (albumId) {
    var input = document.getElementById('albumUploadInput_' + albumId);
    if (!input) return;
    var file = input.files && input.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) { alert('请选择图片文件'); input.value = ''; return; }
    if (file.size > 8 * 1024 * 1024) { alert('图片过大，请选择 8MB 以内的图片'); input.value = ''; return; }
    var reader = new FileReader();
    reader.onload = function (ev) {
        var img = new Image();
        img.onload = function () {
            var MAX = 900;
            var scale = Math.min(1, MAX / Math.max(img.width, img.height));
            var w = Math.max(1, Math.round(img.width * scale));
            var h = Math.max(1, Math.round(img.height * scale));
            var canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            var dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            var albums = getSiteAlbums();
            var album = null;
            for (var i = 0; i < albums.length; i++) { if (albums[i].id === Number(albumId)) album = albums[i]; }
            if (!album) { alert('相册不存在'); return; }
            var pid = album.photos.length ? Math.max.apply(null, album.photos.map(function (p) { return p.id; })) + 1 : 1;
            album.photos.push({ id: pid, name: file.name, data: dataUrl, uploadedAt: Date.now(), size: file.size });
            saveSiteAlbums(albums);
            window.renderMyAlbums();
            window.renderPublicAlbums();
            window.addLog('album', '用户 ' + window.getSession().username + ' 上传图片：' + file.name);
            alert('图片上传成功！');
        };
        img.onerror = function () { alert('图片读取失败，请换一张试试'); };
        img.src = ev.target.result;
    };
    reader.onerror = function () { alert('图片读取失败，请重试'); };
    reader.readAsDataURL(file);
    input.value = '';
};

window.deleteAlbumPhoto = function (albumId, photoId) {
    var albums = getSiteAlbums();
    var album = null;
    for (var i = 0; i < albums.length; i++) { if (albums[i].id === Number(albumId)) album = albums[i]; }
    if (!album) return;
    album.photos = album.photos.filter(function (p) { return p.id !== Number(photoId); });
    saveSiteAlbums(albums);
    window.renderMyAlbums();
    window.renderPublicAlbums();
    alert('图片已删除');
};

window.deleteAlbum = function (albumId) {
    if (!confirm('确定删除该相册及其全部图片吗？')) return;
    var albums = getSiteAlbums();
    albums = albums.filter(function (a) { return a.id !== Number(albumId); });
    saveSiteAlbums(albums);
    window.renderMyAlbums();
    window.renderPublicAlbums();
    alert('相册已删除');
};

window.renderMyAlbums = function () {
    var wrap = document.getElementById('myAlbumsList');
    if (!wrap) return;
    var session = window.getSession();
    if (!session || !session.username) { wrap.innerHTML = '<p class="empty-tip">请先登录</p>'; return; }
    var albums = getSiteAlbums().filter(function (a) { return a.owner === session.username; });
    var emptyEl = document.getElementById('myAlbumsEmpty');
    if (emptyEl) emptyEl.style.display = albums.length ? 'none' : 'block';
    if (!albums.length) { wrap.innerHTML = ''; return; }
    var html = '';
    for (var i = 0; i < albums.length; i++) {
        var album = albums[i];
        html += '<div class="album-card"><div class="album-card-head"><b>' + escHtml(album.name) + '</b>' +
            '<span class="album-category">' + escHtml(album.category || '默认') + '</span>' +
            '<span class="album-count">' + album.photos.length + ' 张</span>' +
            '<button class="btn btn-danger btn-xs" onclick="window.deleteAlbum(' + album.id + ')">删除相册</button></div>';
        if (album.photos.length) {
            html += '<div class="album-photo-grid">';
            for (var j = 0; j < album.photos.length; j++) {
                var p = album.photos[j];
                html += '<div class="album-photo-item"><img src="' + escHtml(p.data) + '" alt="' + escHtml(p.name) + '">' +
                    '<button class="album-photo-del" title="删除图片" onclick="window.deleteAlbumPhoto(' + album.id + ',' + p.id + ')">&times;</button></div>';
            }
            html += '</div>';
        } else {
            html += '<p class="empty-tip">相册暂无图片</p>';
        }
        html += '<div class="album-upload-row"><input type="file" id="albumUploadInput_' + album.id + '" accept="image/*" hidden onchange="window.uploadAlbumPhoto(' + album.id + ')">' +
            '<button class="btn btn-primary btn-xs" onclick="document.getElementById(\'albumUploadInput_' + album.id + '\').click()">上传图片</button></div></div>';
    }
    wrap.innerHTML = html;
};

// ==================== 3. 投票问卷 ====================
function getSitePolls() {
    try { return JSON.parse(dataStore.get('sitePolls') || '[]'); } catch (e) { return []; }
}
function saveSitePolls(polls) {
    dataStore.set('sitePolls', JSON.stringify(polls));
}

window.renderPollList = function () {
    var wrap = document.getElementById('pollList');
    if (!wrap) return;
    var polls = getSitePolls().filter(function (p) { return p.status === 'active'; });
    var emptyEl = document.getElementById('pollEmpty');
    if (emptyEl) emptyEl.style.display = polls.length ? 'none' : 'block';
    if (!polls.length) { wrap.innerHTML = ''; return; }
    var session = window.getSession();
    var username = session ? session.username : '';
    var html = '';
    for (var i = 0; i < polls.length; i++) {
        var p = polls[i];
        var voted = p.voters && p.voters[username];
        var total = 0;
        for (var o = 0; o < p.options.length; o++) total += p.options[o].votes;
        var typeLabel = p.type === 'multi' ? '多选' : '单选';
        html += '<div class="poll-card"><div class="poll-card-head"><b>' + escHtml(p.title) + '</b>' +
            '<span class="poll-type">' + typeLabel + '</span></div>' +
            '<p class="poll-desc">' + escHtml(p.desc) + '</p>' +
            '<p class="poll-meta">发起人：' + escHtml(p.author) + ' · 参与 ' + Object.keys(p.voters || {}).length + ' 人</p>' +
            '<button class="btn btn-primary btn-xs" onclick="window.openPollDetail(' + p.id + ')">' + (voted ? '查看结果' : '参与投票') + '</button></div>';
    }
    wrap.innerHTML = html;
};

window.openPollDetail = function (pollId) {
    var el = document.getElementById('pollDetailModal');
    if (!el) return;
    var polls = getSitePolls();
    var poll = null;
    for (var i = 0; i < polls.length; i++) { if (polls[i].id === Number(pollId)) poll = polls[i]; }
    if (!poll) return;
    window._currentPollId = Number(pollId);
    var session = window.getSession();
    var username = session ? session.username : '';
    var myVote = poll.voters && poll.voters[username];
    if (myVote) {
        window.renderPollResult(pollId);
    } else {
        var html = '<div class="poll-detail-head"><b>' + escHtml(poll.title) + '</b></div>' +
            '<p class="poll-desc">' + escHtml(poll.desc) + '</p><div class="poll-options">';
        for (var k = 0; k < poll.options.length; k++) {
            var opt = poll.options[k];
            if (poll.type === 'multi') {
                html += '<label class="poll-option"><input type="checkbox" name="pollOpt" value="' + k + '"> ' + escHtml(opt.text) + '</label>';
            } else {
                html += '<label class="poll-option"><input type="radio" name="pollOpt" value="' + k + '"> ' + escHtml(opt.text) + '</label>';
            }
        }
        html += '</div><div class="modal-footer"><button class="btn btn-primary btn-sm" onclick="window.submitVote(' + poll.id + ')">提交投票</button>' +
            '<button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'pollDetailModal\').style.display=\'none\'">取消</button></div>';
        el.querySelector('.modal-body').innerHTML = html;
    }
    modalOpen('pollDetailModal');
};

window.submitVote = function (pollId) {
    var session = window.getSession();
    if (!session || !session.username) { alert('请先登录后投票'); return; }
    var inputs = document.querySelectorAll('#pollDetailModal input[name="pollOpt"]:checked');
    if (!inputs.length) { alert('请至少选择一个选项'); return; }
    var picks = [];
    for (var i = 0; i < inputs.length; i++) picks.push(Number(inputs[i].value));
    var polls = getSitePolls();
    var poll = null;
    for (var j = 0; j < polls.length; j++) { if (polls[j].id === Number(pollId)) poll = polls[j]; }
    if (!poll) return;
    if (poll.voters && poll.voters[session.username]) { alert('你已经投过票了'); return; }
    if (!poll.voters) poll.voters = {};
    for (var k = 0; k < picks.length; k++) {
        if (poll.options[picks[k]]) poll.options[picks[k]].votes += 1;
    }
    poll.voters[session.username] = picks;
    saveSitePolls(polls);
    window.renderPollResult(pollId);
    window.renderPollList();
    window.renderMyPolls && window.renderMyPolls();
    window.addLog('poll', '用户 ' + session.username + ' 参与投票：' + poll.title);
    alert('投票成功！');
};

window.renderPollResult = function (pollId) {
    var el = document.getElementById('pollDetailModal');
    if (!el) return;
    var polls = getSitePolls();
    var poll = null;
    for (var i = 0; i < polls.length; i++) { if (polls[i].id === Number(pollId)) poll = polls[i]; }
    if (!poll) return;
    var total = 0;
    for (var o = 0; o < poll.options.length; o++) total += poll.options[o].votes;
    var session = window.getSession();
    var username = session ? session.username : '';
    var myVote = poll.voters && poll.voters[username];
    var html = '<div class="poll-detail-head"><b>' + escHtml(poll.title) + '</b></div>' +
        '<p class="poll-desc">' + escHtml(poll.desc) + '</p><p class="poll-meta">共 ' + Object.keys(poll.voters || {}).length + ' 人参与</p><div class="poll-result">';
    for (var i = 0; i < poll.options.length; i++) {
        var opt = poll.options[i];
        var pct = total ? Math.round(opt.votes / total * 100) : 0;
        var mine = myVote && myVote.indexOf(i) !== -1;
        html += '<div class="poll-result-row"><span class="poll-result-label">' + escHtml(opt.text) + (mine ? ' <em class="mine-vote">（我的选择）</em>' : '') + '</span>' +
            '<div class="poll-bar"><div class="poll-bar-fill" style="width:' + pct + '%"></div></div>' +
            '<span class="poll-bar-value">' + opt.votes + ' 票 · ' + pct + '%</span></div>';
    }
    html += '</div><div class="modal-footer"><button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'pollDetailModal\').style.display=\'none\'">关闭</button></div>';
    el.querySelector('.modal-body').innerHTML = html;
};

window.createPoll = function () {
    var session = window.getSession();
    if (!session || !session.username) { alert('请先登录'); return; }
    var title = document.getElementById('pollTitleInput').value.trim();
    var desc = document.getElementById('pollDescInput').value.trim();
    var type = document.getElementById('pollTypeInput') ? document.getElementById('pollTypeInput').value : 'single';
    var optionsText = document.getElementById('pollOptionsInput').value.trim();
    if (!title) { alert('请填写投票标题'); return; }
    if (!optionsText) { alert('请至少填写一个选项（每行一个）'); return; }
    var options = optionsText.split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return s; });
    if (options.length < 2) { alert('投票至少需要 2 个选项'); return; }
    if (options.length > 10) { alert('选项最多 10 个'); return; }
    var polls = getSitePolls();
    var id = polls.length ? Math.max.apply(null, polls.map(function (p) { return p.id; })) + 1 : 1;
    var pollOptions = options.map(function (text) { return { text: text, votes: 0 }; });
    polls.unshift({ id: id, title: title, desc: desc, type: type, options: pollOptions, voters: {}, author: session.username, createdAt: Date.now(), status: 'active' });
    saveSitePolls(polls);
    document.getElementById('pollTitleInput').value = '';
    document.getElementById('pollDescInput').value = '';
    document.getElementById('pollOptionsInput').value = '';
    window.renderMyPolls();
    window.renderPollList();
    window.addLog('poll', '用户 ' + session.username + ' 创建投票：' + title);
    alert('投票创建成功！');
};

window.renderMyPolls = function () {
    var wrap = document.getElementById('myPollsList');
    if (!wrap) return;
    var session = window.getSession();
    if (!session || !session.username) { wrap.innerHTML = '<p class="empty-tip">请先登录</p>'; return; }
    var polls = getSitePolls().filter(function (p) { return p.author === session.username; });
    var emptyEl = document.getElementById('myPollsEmpty');
    if (emptyEl) emptyEl.style.display = polls.length ? 'none' : 'block';
    if (!polls.length) { wrap.innerHTML = ''; return; }
    var html = '';
    for (var i = 0; i < polls.length; i++) {
        var p = polls[i];
        html += '<div class="poll-card"><div class="poll-card-head"><b>' + escHtml(p.title) + '</b>' +
            '<span class="poll-type">' + (p.type === 'multi' ? '多选' : '单选') + '</span>' +
            '<span class="poll-status ' + (p.status === 'active' ? 'status-active' : 'status-closed') + '">' + (p.status === 'active' ? '进行中' : '已下架') + '</span></div>' +
            '<p class="poll-desc">' + escHtml(p.desc) + '</p>' +
            '<p class="poll-meta">参与 ' + Object.keys(p.voters || {}).length + ' 人</p>' +
            '<div class="poll-actions"><button class="btn btn-secondary btn-xs" onclick="window.viewPollResult(' + p.id + ')">查看结果</button>' +
            (p.status === 'active' ? '<button class="btn btn-secondary btn-xs" onclick="window.adminPollStatus(' + p.id + ',\'closed\')">下架</button>' : '<button class="btn btn-secondary btn-xs" onclick="window.adminPollStatus(' + p.id + ',\'active\')">恢复</button>') +
            '<button class="btn btn-danger btn-xs" onclick="window.deletePoll(' + p.id + ')">删除</button></div></div>';
    }
    wrap.innerHTML = html;
};

window.viewPollResult = function (pollId) {
    window._currentPollId = Number(pollId);
    var el = document.getElementById('pollDetailModal');
    if (el) { el.querySelector('.modal-body').innerHTML = '<p class="empty-tip">加载中...</p>'; modalOpen('pollDetailModal'); }
    window.renderPollResult(pollId);
};

window.adminPollStatus = function (pollId, status) {
    var polls = getSitePolls();
    for (var i = 0; i < polls.length; i++) {
        if (polls[i].id === Number(pollId)) { polls[i].status = status; break; }
    }
    saveSitePolls(polls);
    window.renderMyPolls && window.renderMyPolls();
    window.renderPollsAdmin && window.renderPollsAdmin();
    window.renderPollList && window.renderPollList();
    window.addLog('poll', '投票状态变更：' + pollId + ' -> ' + status);
    alert('操作成功');
};

window.deletePoll = function (pollId) {
    if (!confirm('确定删除该投票吗？投票数据不可恢复。')) return;
    var polls = getSitePolls().filter(function (p) { return p.id !== Number(pollId); });
    saveSitePolls(polls);
    window.renderMyPolls && window.renderMyPolls();
    window.renderPollsAdmin && window.renderPollsAdmin();
    window.renderPollList && window.renderPollList();
    alert('投票已删除');
};

// ==================== 4. 个人装扮 ====================
var DRESS_FRAMES = [
    { id: 'none', name: '无边框' },
    { id: 'gold', name: '金色光环' },
    { id: 'rainbow', name: '彩虹渐变' },
    { id: 'star', name: '星光闪耀' }
];
var DRESS_COLORS = [
    { id: 'default', name: '默认主题', v1: '', v2: '' },
    { id: 'blue', name: '海洋蓝', v1: '#2b6cb0', v2: '#3182ce' },
    { id: 'green', name: '森林绿', v1: '#276749', v2: '#38a169' },
    { id: 'orange', name: '落日橙', v1: '#c05621', v2: '#dd6b20' },
    { id: 'purple', name: '梦幻紫', v1: '#6b46c1', v2: '#805ad5' }
];

window.applyUserDressing = function () {
    var session = window.getSession();
    if (!session || !session.username) return;
    var user = getFullUserByName(session.username);
    if (!user) return;
    var root = document.documentElement;
    var color = null;
    for (var i = 0; i < DRESS_COLORS.length; i++) { if (DRESS_COLORS[i].id === user.themeColor) color = DRESS_COLORS[i]; }
    if (color && color.v1) {
        root.style.setProperty('--user-accent1', color.v1);
        root.style.setProperty('--user-accent2', color.v2);
        document.body.classList.add('user-themed');
    } else {
        root.style.removeProperty('--user-accent1');
        root.style.removeProperty('--user-accent2');
        document.body.classList.remove('user-themed');
    }
    // 首页横幅：签名 / 称号 / 头像框
    var sigEl = document.getElementById('welcomeSignature');
    if (sigEl) sigEl.textContent = user.signature || '';
    var avatarEl = document.getElementById('welcomeAvatar');
    if (avatarEl) {
        avatarEl.className = 'welcome-avatar avatar-frame-' + (user.avatarFrame || 'none');
        var initials = (user.nickname || user.username).substring(0, 2).toUpperCase();
        var inner = user.avatarUrl
            ? '<img src="' + escHtml(user.avatarUrl) + '" alt="头像" onerror="this.style.display=\'none\'">'
            : '<span class="welcome-avatar-text">' + escHtml(initials) + '</span>';
        avatarEl.innerHTML = inner;
    }
    var titleEl = document.getElementById('welcomeTitleBadge');
    if (titleEl) {
        if (user.title) titleEl.textContent = user.title;
        titleEl.style.display = user.title ? 'inline-block' : 'none';
    }
    var badgeEl = document.getElementById('welcomeBadgeIcon');
    if (badgeEl) {
        var badgeMap = { bronze: '铜', silver: '银', gold: '金' };
        if (user.badge && badgeMap[user.badge]) badgeEl.textContent = badgeMap[user.badge] + '徽章';
        badgeEl.style.display = (user.badge && badgeMap[user.badge]) ? 'inline-block' : 'none';
    }
};

window.renderDressing = function () {
    var panel = document.getElementById('dressingPanel');
    if (!panel) return;
    var session = window.getSession();
    if (!session || !session.username) { panel.innerHTML = '<p class="empty-tip">请先登录</p>'; return; }
    var user = getFullUserByName(session.username) || {};
    var html = '<div class="form-group"><label for="signatureInput">个性签名</label>' +
        '<input type="text" id="signatureInput" maxlength="50" placeholder="一句话介绍自己（首页横幅展示）" value="' + escHtml(user.signature || '') + '"></div>';
    html += '<div class="form-group"><label>头像框</label><div class="dress-options">';
    for (var i = 0; i < DRESS_FRAMES.length; i++) {
        var f = DRESS_FRAMES[i];
        html += '<label class="dress-option"><input type="radio" name="dressFrame" value="' + f.id + '"' + ((user.avatarFrame || 'none') === f.id ? ' checked' : '') + '> <span class="avatar-frame-demo avatar-frame-' + f.id + '">头</span> ' + f.name + '</label>';
    }
    html += '</div></div>';
    html += '<div class="form-group"><label>首页背景主题色</label><div class="dress-options">';
    for (var j = 0; j < DRESS_COLORS.length; j++) {
        var c = DRESS_COLORS[j];
        var style = c.v1 ? 'background:linear-gradient(135deg,' + c.v1 + ',' + c.v2 + ')' : 'background:#eef1fa';
        html += '<label class="dress-option"><input type="radio" name="dressColor" value="' + c.id + '"' + ((user.themeColor || 'default') === c.id ? ' checked' : '') + '> <span class="dress-color-demo" style="' + style + '"></span> ' + c.name + '</label>';
    }
    html += '</div></div>';
    html += '<button class="btn btn-primary" onclick="window.saveDressing()">保存装扮</button>';
    panel.innerHTML = html;
};

window.saveDressing = function () {
    var session = window.getSession();
    if (!session || !session.username) { alert('请先登录'); return; }
    var signature = document.getElementById('signatureInput').value.trim();
    var frame = null, color = null;
    var frameInputs = document.querySelectorAll('#dressingPanel input[name="dressFrame"]');
    for (var i = 0; i < frameInputs.length; i++) { if (frameInputs[i].checked) frame = frameInputs[i].value; }
    var colorInputs = document.querySelectorAll('#dressingPanel input[name="dressColor"]');
    for (var j = 0; j < colorInputs.length; j++) { if (colorInputs[j].checked) color = colorInputs[j].value; }
    var users = window.getUsers();
    var updated = false;
    for (var k = 0; k < users.length; k++) {
        if (users[k].username === session.username) {
            users[k].signature = signature;
            users[k].avatarFrame = frame || 'none';
            users[k].themeColor = color || 'default';
            updated = true;
            break;
        }
    }
    if (!updated) { alert('用户不存在'); return; }
    window.saveUsers(users);
    // 同步会话快照字段
    var snap = window.getSession();
    if (snap) {
        snap.signature = signature;
        snap.avatarFrame = frame || 'none';
        snap.themeColor = color || 'default';
        dataStore.set('currentUser', JSON.stringify(snap));
    }
    window.addLog('dressing', '用户 ' + session.username + ' 更新个人装扮');
    window.applyUserDressing();
    alert('装扮保存成功，已全站生效！');
};

// ==================== 5. 评论互动增强 ====================
function getContentLikesExt(contentId) {
    var map = window.getInteractions();
    return (map.likes && map.likes[contentId]) || 0;
}
function getContentCommentsExt(contentId) {
    var map = window.getInteractions();
    return (map.comments && map.comments[contentId]) || [];
}
function isContentLikedExt(contentId, username) {
    var map = window.getInteractions();
    var arr = (map.likers && map.likers[contentId]) || [];
    return arr.indexOf(username) !== -1;
}
function updateCardCounts(contentId) {
    var card = document.querySelector('.content-card[data-content-id="' + contentId + '"]');
    if (!card) return;
    var session = window.getSession();
    var username = session ? session.username : '';
    var likes = getContentLikesExt(contentId);
    var comments = getContentCommentsExt(contentId);
    var liked = username ? isContentLikedExt(contentId, username) : false;
    var likeBtn = card.querySelector('.like-btn');
    if (likeBtn) likeBtn.textContent = (liked ? '已赞' : '点赞') + ' (' + likes + ')';
    var comBtn = card.querySelector('.comment-toggle');
    if (comBtn) comBtn.textContent = '评论 (' + comments.length + ')';
}

window.openContentDetail = function (contentId) {
    var session = window.getSession();
    if (!session || !session.username) { window.location.href = 'login.html'; return; }
    contentId = Number(contentId);
    window._detailContentId = contentId;
    if (window.markTaskDone) window.markTaskDone('browse');
    var el = document.getElementById('contentDetailModal');
    if (!el) return;
    el.querySelector('.modal-body').innerHTML = '<p class="empty-tip">加载中...</p>';
    modalOpen('contentDetailModal');
    window.renderContentDetail(contentId);
};

window.renderContentDetail = function (contentId) {
    var el = document.getElementById('contentDetailModal');
    if (!el) return;
    var contents = window.getContents();
    var item = null;
    for (var i = 0; i < contents.length; i++) { if (contents[i].id === Number(contentId)) item = contents[i]; }
    if (!item) { el.querySelector('.modal-body').innerHTML = '<p class="empty-tip">内容不存在或已被删除</p>'; return; }
    var session = window.getSession();
    var username = session ? session.username : '';
    var likes = getContentLikesExt(item.id);
    var comments = getContentCommentsExt(item.id);
    var liked = username ? isContentLikedExt(item.id, username) : false;
    var html = '<div class="detail-title">' + escHtml(item.title) + '</div>' +
        '<div class="detail-meta">' + escHtml(item.author) + ' · ' + escHtml(item.time || '') + '</div>' +
        '<div class="detail-body">' + escHtml(item.body) + '</div>' +
        '<div class="detail-actions"><button class="btn btn-secondary btn-xs" onclick="window.toggleDetailLike(' + item.id + ')">' + (liked ? '已赞' : '点赞') + ' (' + likes + ')</button>' +
        '<span class="detail-comment-count">评论 (' + comments.length + ')</span></div>' +
        '<div class="detail-comments"><div class="detail-comments-title">全部评论</div>';
    if (!comments.length) {
        html += '<p class="empty-tip">还没有评论，快来抢沙发～</p>';
    } else {
        for (var c = 0; c < comments.length; c++) {
            var cm = comments[c];
            html += '<div class="detail-comment"><span class="detail-comment-author">' + escHtml(cm.author) + '</span>' +
                (cm.replyTo ? '<span class="detail-comment-reply"> 回复 @' + escHtml(cm.replyTo) + '</span>' : '') +
                '<span class="detail-comment-time">' + escHtml(cm.time || '') + '</span>' +
                '<div class="detail-comment-text">' + escHtml(cm.text) + '</div>' +
                '<button class="btn btn-ghost btn-xs reply-btn" onclick="window.replyComment(' + item.id + ',\'' + escHtml(cm.author) + '\')">回复</button></div>';
        }
    }
    html += '</div><div class="detail-comment-input"><input type="text" id="detailCommentInput" placeholder="' + (window._replyTarget ? '回复 @' + window._replyTarget + '：' : '说点什么...') + '" maxlength="200">' +
        '<button class="btn btn-primary btn-xs" onclick="window.submitDetailComment(' + item.id + ')">发送</button></div>';
    el.querySelector('.modal-body').innerHTML = html;
    if (el.querySelector('#detailCommentInput')) el.querySelector('#detailCommentInput').focus();
};

window.replyComment = function (contentId, author) {
    window._replyTarget = author;
    var input = document.getElementById('detailCommentInput');
    if (input) input.placeholder = '回复 @' + author + '：';
    input && input.focus();
};

window.submitDetailComment = function (contentId) {
    var session = window.getSession();
    if (!session || !session.username) { alert('请先登录'); return; }
    var input = document.getElementById('detailCommentInput');
    if (!input) return;
    var text = input.value.trim();
    if (!text) { alert('评论内容不能为空'); return; }
    var map = window.getInteractions();
    if (!map.comments) map.comments = {};
    if (!map.comments[contentId]) map.comments[contentId] = [];
    var comment = { author: session.username, text: text, time: nowTextStr() };
    if (window._replyTarget) { comment.replyTo = window._replyTarget; }
    map.comments[contentId].push(comment);
    window.saveInteractions(map);
    if (window.markTaskDone) window.markTaskDone('comment');
    if (window.notifyContentComment) window.notifyContentComment(contentId, text, window._replyTarget);
    window._replyTarget = null;
    window.renderContentDetail(contentId);
    updateCardCounts(contentId);
};

window.toggleDetailLike = function (contentId) {
    var session = window.getSession();
    if (!session || !session.username) { alert('请先登录'); return; }
    contentId = Number(contentId);
    var map = window.getInteractions();
    if (!map.likes) map.likes = {};
    if (!map.likers) map.likers = {};
    if (!map.likes[contentId]) map.likes[contentId] = 0;
    if (!map.likers[contentId]) map.likers[contentId] = [];
    var liked = map.likers[contentId].indexOf(session.username) !== -1;
    if (liked) {
        map.likes[contentId] = Math.max(0, map.likes[contentId] - 1);
        map.likers[contentId].splice(map.likers[contentId].indexOf(session.username), 1);
    } else {
        map.likes[contentId] += 1;
        map.likers[contentId].push(session.username);
        if (window.markTaskDone) window.markTaskDone('like');
        if (window.notifyContentLike) window.notifyContentLike(contentId);
    }
    window.saveInteractions(map);
    window.renderContentDetail(contentId);
    updateCardCounts(contentId);
};

// 互动通知
function getNotifications() {
    try { return JSON.parse(dataStore.get('siteNotifications') || '[]'); } catch (e) { return []; }
}
function saveNotifications(list) {
    dataStore.set('siteNotifications', JSON.stringify(list));
}
function pushNotification(to, type, actor, contentId, text) {
    if (!to || !actor || to === actor) return;
    var list = getNotifications();
    list.unshift({ id: Date.now() + Math.floor(Math.random() * 1000), to: to, type: type, actor: actor, contentId: contentId || null, text: text || '', time: nowTextStr(), read: 0 });
    if (list.length > 300) list.length = 300;
    saveNotifications(list);
    window.renderNotifyBadge && window.renderNotifyBadge();
}
window.notifyContentLike = function (contentId) {
    var session = window.getSession();
    if (!session || !session.username) return;
    var contents = window.getContents();
    for (var i = 0; i < contents.length; i++) { if (contents[i].id === Number(contentId)) { pushNotification(contents[i].author, 'like', session.username, contentId, '赞了你的内容「' + contents[i].title + '」'); break; } }
};
window.notifyContentComment = function (contentId, text, replyTo) {
    var session = window.getSession();
    if (!session || !session.username) return;
    var contents = window.getContents();
    for (var i = 0; i < contents.length; i++) {
        if (contents[i].id === Number(contentId)) {
            var prefix = replyTo ? '回复了你在「' + contents[i].title + '」中的评论' : '评论了你的内容「' + contents[i].title + '」';
            pushNotification(contents[i].author, 'comment', session.username, contentId, prefix + '：' + (text.length > 30 ? text.substring(0, 30) + '...' : text));
            break;
        }
    }
};
window.renderNotifyBadge = function () {
    var bell = document.getElementById('notifyBell');
    if (!bell) return;
    var session = window.getSession();
    if (!session || !session.username) return;
    var list = getNotifications().filter(function (n) { return n.to === session.username && !n.read; });
    var badge = bell.querySelector('.notify-count');
    if (badge) badge.textContent = list.length > 99 ? '99+' : String(list.length);
    if (badge) badge.style.display = list.length ? 'flex' : 'none';
};
// ========== [扩展] 全局增强：浏览历史记录 + 通知角标叠加（置于原函数定义之后） ==========
(function () {
    var _baseOpenDetail = window.openContentDetail;
    if (_baseOpenDetail) {
        window.openContentDetail = function (contentId) {
            var ret = _baseOpenDetail.apply(this, arguments);
            var session = window.getSession();
            if (session && session.username && window.recordHistory) {
                var contents = window.getContents();
                var item = null;
                for (var i = 0; i < contents.length; i++) { if (contents[i].id === Number(contentId)) { item = contents[i]; break; } }
                window.recordHistory(Number(contentId), item ? item.title : '');
                if (window.renderTrackPanel) window.renderTrackPanel();
                if (window.checkAchievements) window.checkAchievements();
            }
            return ret;
        };
    }
    var _baseNotifyBadge = window.renderNotifyBadge;
    if (_baseNotifyBadge) {
        window.renderNotifyBadge = function () {
            var ret = _baseNotifyBadge.apply(this, arguments);
            try {
                var bell = document.getElementById('notifyBell');
                var session = window.getSession();
                if (bell && session && session.username) {
                    var reqs = (JSON.parse(dataStore.get('siteFriendRequests') || '[]') || []).filter(function (r) { return r.to === session.username && r.status === 'pending'; }).length;
                    var chats = (JSON.parse(dataStore.get('siteChats') || '[]') || []).filter(function (c) { return c.to === session.username && !c.read; }).length;
                    var badge = bell.querySelector('.notify-count');
                    if (badge && (reqs + chats)) {
                        var cur = parseInt(badge.textContent, 10) || 0;
                        badge.textContent = (cur + reqs + chats) > 99 ? '99+' : String(cur + reqs + chats);
                        badge.style.display = 'flex';
                    }
                }
            } catch (e) { /* ignore */ }
            return ret;
        };
    }
    window.refreshFriendBadge = function () {
        if (window.renderNotifyBadge) window.renderNotifyBadge();
    };
})();
window.renderNotifications = function () {
    var wrap = document.getElementById('notificationsList');
    if (!wrap) return;
    var session = window.getSession();
    if (!session || !session.username) { wrap.innerHTML = '<p class="empty-tip">请先登录</p>'; return; }
    var list = getNotifications().filter(function (n) { return n.to === session.username; });
    var emptyEl = document.getElementById('notificationsEmpty');
    if (emptyEl) emptyEl.style.display = list.length ? 'none' : 'block';
    if (!list.length) { wrap.innerHTML = ''; return; }
    var html = '';
    for (var i = 0; i < list.length; i++) {
        var n = list[i];
        var typeLabel = n.type === 'like' ? '<span class="notify-type notify-type-like">点赞</span>' : '<span class="notify-type notify-type-comment">评论</span>';
        html += '<div class="notify-item' + (n.read ? ' notify-read' : '') + '">' + typeLabel +
            '<div class="notify-body"><b>' + escHtml(n.actor) + '</b> ' + escHtml(n.text) + '</div>' +
            '<span class="notify-time">' + escHtml(n.time) + '</span></div>';
    }
    html += '<div class="notify-actions"><button class="btn btn-secondary btn-xs" onclick="window.markNotificationsRead()">全部标记已读</button></div>';
    wrap.innerHTML = html;
};
window.markNotificationsRead = function () {
    var session = window.getSession();
    if (!session || !session.username) return;
    var list = getNotifications();
    for (var i = 0; i < list.length; i++) { if (list[i].to === session.username) list[i].read = 1; }
    saveNotifications(list);
    window.renderNotifications();
    window.renderNotifyBadge();
};

// ==================== 后台：相册管理 ====================
window.renderAlbumsAdmin = function () {
    var tbody = document.getElementById('albumsTableBody');
    if (!tbody) return;
    var albums = getSiteAlbums();
    if (!albums.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-tip">暂无相册数据</td></tr>';
        return;
    }
    var html = '';
    for (var i = 0; i < albums.length; i++) {
        var a = albums[i];
        html += '<tr><td>' + a.id + '</td><td>' + escHtml(a.name) + '</td><td>' + escHtml(a.category || '默认') + '</td>' +
            '<td>' + escHtml(a.owner) + '</td><td>' + a.photos.length + '</td>' +
            '<td>' + new Date(a.createdAt).toLocaleString('zh-CN') + '</td>' +
            '<td><button class="btn-small btn-primary" onclick="window.viewAlbumAdmin(' + a.id + ')">查看</button> ' +
            '<button class="btn-small btn-danger" onclick="window.adminDeleteAlbum(' + a.id + ')">删除</button></td></tr>';
    }
    tbody.innerHTML = html;
};

window.viewAlbumAdmin = function (albumId) {
    var el = document.getElementById('albumAdminModal');
    if (!el) return;
    var albums = getSiteAlbums();
    var album = null;
    for (var i = 0; i < albums.length; i++) { if (albums[i].id === Number(albumId)) album = albums[i]; }
    if (!album) return;
    var html = '<div class="detail-title">' + escHtml(album.name) + '</div>' +
        '<div class="detail-meta">拥有者：' + escHtml(album.owner) + ' · 分类：' + escHtml(album.category || '默认') + ' · 共 ' + album.photos.length + ' 张</div>';
    if (!album.photos.length) {
        html += '<p class="empty-tip">相册暂无图片</p>';
    } else {
        html += '<div class="album-photo-grid">';
        for (var j = 0; j < album.photos.length; j++) {
            var p = album.photos[j];
            html += '<div class="album-photo-item"><img src="' + escHtml(p.data) + '" alt="' + escHtml(p.name) + '">' +
                '<button class="album-photo-del" title="删除违规图片" onclick="window.adminDeletePhoto(' + album.id + ',' + p.id + ')">&times;</button></div>';
        }
        html += '</div>';
    }
    html += '<div class="modal-footer"><button class="btn btn-secondary btn-sm" onclick="document.getElementById(\'albumAdminModal\').style.display=\'none\'">关闭</button></div>';
    el.querySelector('.modal-body').innerHTML = html;
    modalOpen('albumAdminModal');
};

window.adminDeletePhoto = function (albumId, photoId) {
    if (!confirm('确定删除该图片吗？（用户相册中同步删除）')) return;
    var albums = getSiteAlbums();
    var album = null;
    for (var i = 0; i < albums.length; i++) { if (albums[i].id === Number(albumId)) album = albums[i]; }
    if (!album) return;
    album.photos = album.photos.filter(function (p) { return p.id !== Number(photoId); });
    saveSiteAlbums(albums);
    window.addLog('album', '管理员删除相册 ' + albumId + ' 图片 #' + photoId);
    window.renderAlbumsAdmin();
    window.viewAlbumAdmin(albumId);
    alert('图片已删除');
};

window.adminDeleteAlbum = function (albumId) {
    if (!confirm('确定删除该相册吗？相册内全部图片将一并删除。')) return;
    var albums = getSiteAlbums().filter(function (a) { return a.id !== Number(albumId); });
    saveSiteAlbums(albums);
    window.addLog('album', '管理员删除相册 #' + albumId);
    window.renderAlbumsAdmin();
    alert('相册已删除');
};

// ==================== 后台：投票管理 ====================
window.renderPollsAdmin = function () {
    var tbody = document.getElementById('pollsTableBody');
    if (!tbody) return;
    var polls = getSitePolls();
    if (!polls.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-tip">暂无投票数据</td></tr>';
        return;
    }
    var html = '';
    for (var i = 0; i < polls.length; i++) {
        var p = polls[i];
        var statusLabel = p.status === 'active' ? '<span class="role-badge super-admin">进行中</span>' : '<span class="role-badge user">已下架</span>';
        html += '<tr><td>' + p.id + '</td><td>' + escHtml(p.title) + '</td><td>' + (p.type === 'multi' ? '多选' : '单选') + '</td>' +
            '<td>' + escHtml(p.author) + '</td><td>' + Object.keys(p.voters || {}).length + '</td><td>' + statusLabel + '</td>' +
            '<td><button class="btn-small btn-primary" onclick="window.viewPollResult(' + p.id + ')">查看结果</button> ' +
            (p.status === 'active'
                ? '<button class="btn-small btn-secondary" onclick="window.adminPollStatus(' + p.id + ',\'closed\')">下架</button>'
                : '<button class="btn-small btn-secondary" onclick="window.adminPollStatus(' + p.id + ',\'active\')">恢复</button>') + ' ' +
            '<button class="btn-small btn-danger" onclick="window.deletePoll(' + p.id + ')">删除</button></td></tr>';
    }
    tbody.innerHTML = html;
};

// ==================== 页面自动初始化 ====================
(function () {
    function pageReady(fn) {
        if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', fn); }
        else { fn(); }
    }
    pageReady(function () {
        var session = window.getSession();
        if (!session || !session.username) return;

        window.applyUserDressing && window.applyUserDressing();
        if (document.getElementById('pollList')) window.renderPollList();
        if (document.getElementById('albumMasonry')) window.renderPublicAlbums();
        if (document.getElementById('notifyBell')) window.renderNotifyBadge();
        if (document.getElementById('taskCenterPanel')) window.renderTaskCenter();
        if (document.getElementById('myAlbumsList')) window.renderMyAlbums();
        if (document.getElementById('myPollsList')) window.renderMyPolls();
        if (document.getElementById('dressingPanel')) window.renderDressing();
        if (document.getElementById('notificationsList')) window.renderNotifications();
        if (document.getElementById('panel-friends')) window.renderFriendsPanel();
        if (document.getElementById('panel-diary')) window.renderDiaryPanelAll();
        if (document.getElementById('panel-track')) window.renderTrackPanel();
        if (document.getElementById('panel-growth')) window.renderGrowthPanelAll();
        if (document.getElementById('panel-social')) window.renderSocialPanel();
        if (document.getElementById('momentFeed')) window.renderMomentFeed();
        if (document.getElementById('dailyWordHome')) window.renderDailyWord('dailyWordHome');
        var pvRoot = document.getElementById('profileViewRoot');
        if (pvRoot) {
            var pu = new URLSearchParams(location.search).get('u');
            if (pu) window.renderProfileView(pu);
        }
        var chatOpen = dataStore.get('siteChatOpenWith');
        if (chatOpen && document.getElementById('panel-friends')) {
            dataStore.remove('siteChatOpenWith');
            window.openChatWith(chatOpen);
        }
        if (document.getElementById('notifyBell')) {
            var bell = document.getElementById('notifyBell');
            if (bell) bell.addEventListener('click', function () { window.location.href = 'profile.html'; });
        }

        // 内容详情：事件委托（卡片标题/正文点击打开详情）
        document.addEventListener('click', function (e) {
            var t = e.target;
            var hit = null;
            if (t.classList && t.classList.contains('content-card-title')) hit = t;
            else if (t.closest && t.closest('.content-card-title')) hit = t.closest('.content-card-title');
            else if (t.classList && t.classList.contains('content-card-body')) hit = t;
            else if (t.closest && t.closest('.content-card-body')) hit = t.closest('.content-card-body');
            if (!hit) return;
            var card = hit.closest('.content-card');
            if (card && window.openContentDetail) window.openContentDetail(card.getAttribute('data-content-id'));
        });

        // 弹窗关闭按钮绑定
        bindModalClosers('contentDetailModal');
        bindModalClosers('pollDetailModal');
        bindModalClosers('albumAdminModal');

        // hash 路由：支持 profile.html#task / #albums / #polls 等直达标签页
        var hashTab = String(location.hash || '').replace('#', '');
        var allowedTabs = ['personal', 'security', 'task', 'albums', 'polls', 'messages', 'favorites', 'timeline', 'friends', 'diary', 'track', 'growth', 'social'];
        if (allowedTabs.indexOf(hashTab) !== -1) {
            var hashBtn = document.querySelector('.tab-btn[data-tab="' + hashTab + '"]');
            if (hashBtn) hashBtn.click();
        }
    });
})();

// ========== [扩展] 全站 PWA/响应式初始化（登录与否均执行） ==========
(function () {
    function ready(fn) {
        if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', fn); }
        else { fn(); }
    }
    ready(function () {
        if (window.initPwaEnhance) window.initPwaEnhance();
    });
})();

// ========== [扩展] 超级管理员增强模块（批量操作/留言管理/趋势仪表盘/CSV导出） ==========

// ---------- 通用：下载 CSV（带 BOM 防乱码） ----------
window.downloadCsvFile = function(filename, rows) {
    var csv = '\ufeff';
    for (var i = 0; i < rows.length; i++) {
        var cells = rows[i].map(function(v) {
            var s = String(v == null ? '' : v);
            return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        });
        csv += cells.join(',') + '\r\n';
    }
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

// ---------- 用户：禁用 / 启用 ----------
window.toggleUserStatus = function(username) {
    var session = getSession();
    if (!session || session.role !== 'super_admin') { alert('仅超级管理员可执行此操作'); return; }
    if (username === session.username) { alert('不能禁用自己'); return; }
    var users = getUsers();
    var target = null;
    for (var i = 0; i < users.length; i++) {
        if (users[i].username === username) { target = users[i]; break; }
    }
    if (!target) { alert('用户不存在'); return; }
    if (target.role === 'super_admin' && username !== session.username) { alert('不能禁用其他超级管理员'); return; }
    target.disabled = !target.disabled;
    saveUsers(users);
    addLog('toggle_user', (target.disabled ? '禁用' : '启用') + '用户: ' + username);
    renderUsersTable();
};

// ---------- 用户：批量禁用 / 启用 ----------
window.batchToggleUsers = function(disable) {
    var session = getSession();
    if (!session || session.role !== 'super_admin') { alert('仅超级管理员可执行批量操作'); return; }
    var cbs = document.querySelectorAll('.user-checkbox:checked');
    var names = [];
    for (var i = 0; i < cbs.length; i++) names.push(cbs[i].value);
    if (!names.length) { alert('请先勾选用户'); return; }
    var users = getUsers();
    var count = 0;
    for (var i = 0; i < users.length; i++) {
        var u = users[i];
        if (names.indexOf(u.username) === -1) continue;
        if (u.username === session.username) continue;
        if (u.role === 'super_admin') continue;
        u.disabled = disable ? true : false;
        count++;
    }
    if (!count) { alert('未匹配到可操作的用户（跳过自己与其他超级管理员）'); return; }
    saveUsers(users);
    addLog('batch_toggle_user', (disable ? '批量禁用' : '批量启用') + count + ' 个用户');
    renderUsersTable();
};

// ---------- 内容：置顶 / 下线（单条） ----------
window.pinContent = function(id) {
    var list = getContents();
    var item = null;
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { item = list[i]; break; } }
    if (!item) return;
    if (item.status === 'pinned') { item.status = 'published'; } else { item.status = 'pinned'; }
    saveContents(list);
    addLog('pin_content', (item.status === 'pinned' ? '置顶' : '取消置顶') + '内容: ' + id + ' ' + item.title);
    renderContentTable();
};

window.offlineContent = function(id) {
    var list = getContents();
    var item = null;
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { item = list[i]; break; } }
    if (!item) return;
    if (item.status === 'offline') { item.status = 'published'; } else { item.status = 'offline'; }
    saveContents(list);
    addLog('offline_content', (item.status === 'offline' ? '下线' : '恢复') + '内容: ' + id + ' ' + item.title);
    renderContentTable();
};

// ---------- 内容：批量操作 ----------
window.batchContentAction = function(action) {
    var cbs = document.querySelectorAll('.content-checkbox:checked');
    var ids = [];
    for (var i = 0; i < cbs.length; i++) ids.push(parseInt(cbs[i].value, 10));
    if (!ids.length) { alert('请先勾选内容'); return; }
    if (action === 'delete' && !confirm('确定删除选中的 ' + ids.length + ' 条内容？')) return;
    var list = getContents();
    var changed = 0;
    var kept = [];
    for (var i = 0; i < list.length; i++) {
        if (ids.indexOf(list[i].id) === -1) { kept.push(list[i]); continue; }
        if (action === 'pin') { if (list[i].status !== 'pinned') { list[i].status = 'pinned'; changed++; } kept.push(list[i]); }
        else if (action === 'offline') { if (list[i].status !== 'offline') { list[i].status = 'offline'; changed++; } kept.push(list[i]); }
        else if (action === 'delete') { changed++; }
    }
    if (action === 'delete') saveContents(kept); else saveContents(list);
    addLog('batch_content', '批量' + ({ pin: '置顶', offline: '下线', delete: '删除' }[action] || action) + '内容 ' + changed + ' 条');
    renderContentTable();
};

// ---------- 文件：批量删除 ----------
window.batchDeleteFiles = function() {
    var cbs = document.querySelectorAll('.file-checkbox:checked');
    var ids = [];
    for (var i = 0; i < cbs.length; i++) ids.push(parseInt(cbs[i].value, 10));
    if (!ids.length) { alert('请先勾选文件'); return; }
    if (!confirm('确定删除选中的 ' + ids.length + ' 个文件？')) return;
    var files = getFiles();
    saveFiles(files.filter(function(f) { return ids.indexOf(f.id) === -1; }));
    addLog('batch_delete_file', '批量删除文件 ' + ids.length + ' 个');
    renderFilesTable();
};

// ---------- 反馈：批量标记处理 ----------
window.batchFeedbackAction = function(status) {
    var cbs = document.querySelectorAll('.feedback-checkbox:checked');
    var ids = [];
    for (var i = 0; i < cbs.length; i++) ids.push(parseInt(cbs[i].value, 10));
    if (!ids.length) { alert('请先勾选反馈'); return; }
    var list = window.getFeedbacks();
    var changed = 0;
    for (var i = 0; i < list.length; i++) {
        if (ids.indexOf(list[i].id) !== -1 && list[i].status !== status) {
            list[i].status = status;
            changed++;
        }
    }
    window.saveFeedbacks(list);
    addLog('batch_feedback', (status === 'resolved' ? '标记' : '驳回') + changed + ' 条反馈为' + (status === 'resolved' ? '已处理' : status));
    renderFeedbackTable();
};

// ---------- 留言管理（新面板） ----------
function getGuestbookList() {
    try { return JSON.parse(dataStore.get('siteGuestbook') || '[]'); } catch (e) { return []; }
}
function saveGuestbookList(list) {
    dataStore.set('siteGuestbook', JSON.stringify(list));
}
function guestbookItemField(item, keys, def) {
    for (var i = 0; i < keys.length; i++) {
        if (item[keys[i]] != null) return item[keys[i]];
    }
    return def;
}
window.renderGuestbookAdmin = function() {
    var list = getGuestbookList();
    var statusFilter = document.getElementById('guestbookStatusFilter') ? document.getElementById('guestbookStatusFilter').value : '';
    var searchTerm = document.getElementById('guestbookSearch') ? document.getElementById('guestbookSearch').value.toLowerCase() : '';
    var filtered = list.filter(function(g) {
        var st = g.status || 'approved';
        var matchStatus = !statusFilter || st === statusFilter;
        if (!matchStatus) return false;
        if (!searchTerm) return true;
        var name = String(guestbookItemField(g, ['name', 'user', 'author', 'username'], '') || '').toLowerCase();
        var content = String(guestbookItemField(g, ['content', 'message', 'text', 'body'], '') || '').toLowerCase();
        return name.indexOf(searchTerm) !== -1 || content.indexOf(searchTerm) !== -1;
    });
    var tbody = document.getElementById('guestbookTableBody');
    if (!tbody) return;
    var html = '';
    for (var i = 0; i < filtered.length; i++) {
        var g = filtered[i];
        var name = guestbookItemField(g, ['name', 'user', 'author', 'username'], '匿名');
        var content = guestbookItemField(g, ['content', 'message', 'text', 'body'], '');
        var time = guestbookItemField(g, ['time', 'createdAt', 'date'], '');
        var st = g.status || 'approved';
        var statusLabel = st === 'pending' ? '<span class="role-badge admin">待处理</span>' : (st === 'hidden' ? '<span class="role-badge rejected">已隐藏</span>' : '<span class="role-badge ok">已通过</span>');
        var id = g.id || i;
        html += '<tr><td><input type="checkbox" class="guestbook-checkbox" value="' + id + '"></td><td>' + id + '</td><td>' + esc(name) + '</td><td>' + esc(content) + '</td><td>' + esc(time) + '</td><td>' + statusLabel + '</td>' +
            '<td>' +
            (st !== 'approved' ? '<button class="btn-small btn-primary" onclick="approveGuestbook(' + id + ')">通过</button>' : '') +
            (st !== 'hidden' ? '<button class="btn-small btn-secondary" onclick="hideGuestbook(' + id + ')">隐藏</button>' : '') +
            '<button class="btn-small btn-danger" onclick="deleteGuestbook(' + id + ')">删除</button></td></tr>';
    }
    tbody.innerHTML = html || '<tr><td colspan="7" style="text-align:center;color:#999;">暂无留言</td></tr>';
};
window.approveGuestbook = function(id) {
    var list = getGuestbookList();
    for (var i = 0; i < list.length; i++) { if ((list[i].id || i) === id) { list[i].status = 'approved'; break; } }
    saveGuestbookList(list);
    addLog('approve_guestbook', '通过留言: ' + id);
    renderGuestbookAdmin();
};
window.hideGuestbook = function(id) {
    var list = getGuestbookList();
    for (var i = 0; i < list.length; i++) { if ((list[i].id || i) === id) { list[i].status = 'hidden'; break; } }
    saveGuestbookList(list);
    addLog('hide_guestbook', '隐藏留言: ' + id);
    renderGuestbookAdmin();
};
window.deleteGuestbook = function(id) {
    if (!confirm('确定删除该留言？')) return;
    var list = getGuestbookList();
    var kept = [];
    for (var i = 0; i < list.length; i++) { if ((list[i].id || i) !== id) kept.push(list[i]); }
    saveGuestbookList(kept);
    addLog('delete_guestbook', '删除留言: ' + id);
    renderGuestbookAdmin();
};
window.batchGuestbookAction = function(action) {
    var cbs = document.querySelectorAll('.guestbook-checkbox:checked');
    var ids = [];
    for (var i = 0; i < cbs.length; i++) ids.push(parseInt(cbs[i].value, 10));
    if (!ids.length) { alert('请先勾选留言'); return; }
    if (action === 'delete' && !confirm('确定删除选中的 ' + ids.length + ' 条留言？')) return;
    var list = getGuestbookList();
    var changed = 0;
    var kept = [];
    for (var i = 0; i < list.length; i++) {
        var itemId = list[i].id || i;
        if (ids.indexOf(itemId) === -1) { kept.push(list[i]); continue; }
        if (action === 'approve') { if (list[i].status !== 'approved') { list[i].status = 'approved'; changed++; } kept.push(list[i]); }
        else if (action === 'hide') { if (list[i].status !== 'hidden') { list[i].status = 'hidden'; changed++; } kept.push(list[i]); }
        else if (action === 'delete') { changed++; }
    }
    if (action === 'delete') saveGuestbookList(kept); else saveGuestbookList(list);
    addLog('batch_guestbook', '批量' + ({ approve: '通过', hide: '隐藏', delete: '删除' }[action] || action) + '留言 ' + changed + ' 条');
    renderGuestbookAdmin();
};
window.exportGuestbookList = function() {
    var list = getGuestbookList();
    if (!list.length) { alert('暂无留言可导出'); return; }
    var rows = [['ID', '留言人', '内容', '时间', '状态']];
    var statusMap = { pending: '待处理', approved: '已通过', hidden: '已隐藏' };
    for (var i = 0; i < list.length; i++) {
        var g = list[i];
        rows.push([g.id || i, guestbookItemField(g, ['name', 'user', 'author', 'username'], '匿名'), guestbookItemField(g, ['content', 'message', 'text', 'body'], ''), guestbookItemField(g, ['time', 'createdAt', 'date'], ''), statusMap[g.status || 'approved'] || '已通过']);
    }
    downloadCsvFile('留言数据_' + todayKeyStr() + '.csv', rows);
    addLog('export_guestbook', '导出留言 CSV');
};
