// 登录注册系统 - localStorage 前端模拟 + 超级管理员系统 + 管理后台增强

(function () {
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
        try { return JSON.parse(localStorage.getItem('users') || '[]'); } catch (e) { return []; }
    }

    function saveUsers(users) {
        localStorage.setItem('users', JSON.stringify(users));
    }

    function setSession(user) {
        localStorage.setItem('currentUser', JSON.stringify({ username: user.username, role: user.role || 'user', loginTime: Date.now() }));
    }

    function getSession() {
        try { return JSON.parse(localStorage.getItem('currentUser')); } catch (e) { return null; }
    }

    function clearSession() {
        localStorage.removeItem('currentUser');
    }

    // ========== 操作日志 ==========
    function addLog(action, detail) {
        var logs = JSON.parse(localStorage.getItem('adminLogs') || '[]');
        logs.unshift({
            time: new Date().toLocaleString('zh-CN'),
            admin: getSession().username,
            action: action,
            detail: detail
        });
        if (logs.length > 500) logs = logs.slice(0, 500);
        localStorage.setItem('adminLogs', JSON.stringify(logs));
    }

    // ========== 初始化：创建默认超级管理员账号 ==========
    (function initDefaultAdmin() {
        var users = getUsers();
        for (var i = 0; i < users.length; i++) {
            if (users[i].username === 'admin') { return; }
        }
        users.push({ username: 'admin', password: 'admin123', role: 'super_admin', createdAt: Date.now() });
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

            if (username.length < 3) { showError('用户名至少需要3个字符'); return; }
            if (password.length < 6) { showError('密码至少需要6个字符'); return; }
            if (password !== confirm) { showError('两次输入的密码不一致'); return; }

            var users = getUsers();
            for (var i = 0; i < users.length; i++) {
                if (users[i].username === username) {
                    showError('该用户名已被注册');
                    return;
                }
            }

            users.push({ username: username, password: password, role: 'user', createdAt: Date.now() });
            saveUsers(users);
            alert('注册成功！请返回登录页面登录。');
            window.location.href = 'login.html';
        });
    }

    // ========== 登录页面 ==========
    var loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', function (e) {
            e.preventDefault();
            clearError();

            var username = document.getElementById('username').value.trim();
            var password = document.getElementById('password').value;

            if (!username || !password) { showError('请填写用户名和密码'); return; }

            var users = getUsers();
            var found = false;
            for (var i = 0; i < users.length; i++) {
                if (users[i].username === username && users[i].password === password) {
                    found = true;
                    setSession(users[i]);
                    window.location.href = 'index.html';
                    break;
                }
            }

            if (!found) { showError('用户名或密码错误'); }
        });
    }

    // ========== 主页（index.html）==========
    var welcomeEl = document.getElementById('welcomeUser');
    var logoutBtn = document.getElementById('logoutBtn');
    var adminLink = document.getElementById('adminLink');
    if (welcomeEl && logoutBtn) {
        var session = getSession();
        if (!session) {
            window.location.href = 'login.html';
        } else {
            welcomeEl.textContent = '欢迎回来，' + session.username + '！';
            if (session.role === 'super_admin' && adminLink) {
                adminLink.style.display = 'block';
            }
            logoutBtn.addEventListener('click', function () {
                clearSession();
                window.location.href = 'login.html';
            });
        }
    }

    // ========== 个人信息页面（profile.html）==========
    var profileForm = document.getElementById('profileForm');
    if (profileForm) {
        var session = getSession();
        if (!session) {
            window.location.href = 'login.html';
        } else {
            loadProfile(session.username);
        }
    }

    function loadProfile(username) {
        var users = getUsers();
        var user = null;
        for (var i = 0; i < users.length; i++) {
            if (users[i].username === username) { user = users[i]; break; }
        }
        if (!user) { window.location.href = 'login.html'; return; }

        document.getElementById('profileUsername').value = user.username;
        document.getElementById('profileNickname').value = user.nickname || '';
        document.getElementById('profileAvatarUrl').value = user.avatarUrl || '';
        document.getElementById('profileBio').value = user.bio || '';
        document.getElementById('profileEmail').value = user.email || '';

        updateAvatarPreview(user.avatarUrl);
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

            if (nickname.length > 20) { showError('昵称最多20个字符'); return; }

            var users = getUsers();
            var session = getSession();
            for (var i = 0; i < users.length; i++) {
                if (users[i].username === session.username) {
                    users[i].nickname = nickname;
                    users[i].avatarUrl = avatarUrl;
                    users[i].bio = bio;
                    users[i].email = email;
                    break;
                }
            }
            saveUsers(users);
            alert('个人信息保存成功！');
            updateAvatarPreview(avatarUrl);
        });
    }

    var avatarInput = document.getElementById('profileAvatarUrl');
    if (avatarInput) {
        avatarInput.addEventListener('input', function () {
            updateAvatarPreview(this.value.trim());
        });
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

    // ========== 管理后台（admin.html）==========
    var adminContainer = document.getElementById('adminContainer');
    if (adminContainer) {
        var session = getSession();
        if (!session || session.role !== 'super_admin') {
            alert('无权限访问管理后台！');
            window.location.href = 'index.html';
        } else {
            initAdminPage(session.username);
        }
    }
})();

// ========== 初始化管理后台 ==========
function initAdminPage(currentUsername) {
    document.getElementById('currentAdmin').textContent = '当前管理员：' + currentUsername;

    // 标签页切换
    var navLinks = document.querySelectorAll('.sidebar-nav a[data-tab]');
    navLinks.forEach(function(link) {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            var tabName = this.getAttribute('data-tab');
            switchTab(tabName);
        });
    });

    // 退出登录
    var logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function () {
            localStorage.removeItem('currentUser');
            window.location.href = 'login.html';
        });
    }

    // 侧边栏折叠
    var sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', function () {
            document.querySelector('.admin-sidebar').classList.toggle('collapsed');
        });
    }

    // 加载数据
    loadDashboardStats();
    renderUsersTable();
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

    // 日志筛选
    var logFilter = document.getElementById('logFilter');
    if (logFilter) logFilter.addEventListener('change', renderLogs);

    // 设置表单提交
    var settingsForm = document.getElementById('settingsForm');
    if (settingsForm) {
        settingsForm.addEventListener('submit', function(e) {
            e.preventDefault();
            saveSettings();
        });
    }

    // 弹窗关闭
    var modalClose = document.querySelector('.modal-close');
    if (modalClose) modalClose.addEventListener('click', closeModal);
}

// ========== 标签页切换 ==========
function switchTab(tabName) {
    // 更新导航状态
    document.querySelectorAll('.sidebar-nav li').forEach(function(li) {
        li.classList.remove('active');
    });
    document.querySelector('.sidebar-nav a[data-tab="' + tabName + '"]').parentElement.classList.add('active');

    // 更新内容显示
    document.querySelectorAll('.tab-panel').forEach(function(panel) {
        panel.classList.remove('active');
    });
    document.getElementById('tab-' + tabName).classList.add('active');

    // 更新标题
    var titles = { dashboard: '数据统计', users: '用户管理', settings: '系统设置', logs: '操作日志' };
    document.getElementById('pageTitle').textContent = titles[tabName] || '';

    // 加载对应数据
    if (tabName === 'dashboard') loadDashboardStats();
    if (tabName === 'users') renderUsersTable();
    if (tabName === 'logs') renderLogs();
}

// ========== 数据统计 ==========
function loadDashboardStats() {
    var users = getUsers();
    var now = new Date();
    var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).getTime();

    var totalUsers = users.length;
    var onlineUsers = Math.floor(totalUsers * 0.3); // 模拟在线人数
    var todayUsers = 0;
    var weekUsers = 0;

    for (var i = 0; i < users.length; i++) {
        if (users[i].createdAt >= todayStart) todayUsers++;
        if (users[i].createdAt >= weekStart) weekUsers++;
    }

    document.getElementById('totalUsers').textContent = totalUsers;
    document.getElementById('onlineUsers').textContent = onlineUsers;
    document.getElementById('todayUsers').textContent = todayUsers;
    document.getElementById('weekUsers').textContent = weekUsers;

    drawChart(users, todayStart, weekStart);
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

    // 筛选
    var filtered = users.filter(function(u) {
        var matchSearch = !searchTerm || u.username.toLowerCase().indexOf(searchTerm) !== -1 || 
                         (u.nickname && u.nickname.toLowerCase().indexOf(searchTerm) !== -1);
        var matchRole = !roleFilter || u.role === roleFilter;
        return matchSearch && matchRole;
    });

    // 排序
    filtered.sort(function(a, b) {
        return sortOrder === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt;
    });

    var tbody = document.getElementById('usersTableBody');
    if (!tbody) return;

    var html = '';
    for (var i = 0; i < filtered.length; i++) {
        var u = filtered[i];
        var dateStr = new Date(u.createdAt).toLocaleDateString('zh-CN');
        var roleLabel = u.role === 'super_admin' ? '<span class="role-badge super-admin">超级管理员</span>' : '<span class="role-badge user">普通用户</span>';
        var actionBtns = '';
        if (u.username !== 'admin') {
            actionBtns = '<button class="btn-small btn-primary" onclick="viewUserDetail(\'' + u.username + '\')">详情</button>' +
                        '<button class="btn-small" onclick="changeRole(\'' + u.username + '\')">降级</button>' +
                        '<button class="btn-small btn-danger" onclick="deleteUser(\'' + u.username + '\')">删除</button>';
        } else {
            actionBtns = '<span style="color:#999">本人</span>';
        }
        html += '<tr><td><input type="checkbox" class="user-checkbox"></td><td>' + (i + 1) + '</td><td>' + u.username + '</td><td>' + (u.nickname || '-') + '</td><td>' + roleLabel + '</td><td>' + dateStr + '</td><td>' + (u.email || '-') + '</td><td>' + actionBtns + '</td></tr>';
    }
    tbody.innerHTML = html;
}

// ========== 全选/取消全选 ==========
function toggleSelectAll() {
    var checkboxes = document.querySelectorAll('.user-checkbox');
    var allChecked = document.getElementById('selectAll').checked;
    checkboxes.forEach(function(cb) { cb.checked = allChecked; });
}

// ========== 查看用户详情 ==========
window.viewUserDetail = function(username) {
    var users = getUsers();
    var user = null;
    for (var i = 0; i < users.length; i++) {
        if (users[i].username === username) { user = users[i]; break; }
    }
    if (!user) return;

    var body = document.getElementById('userDetailBody');
    body.innerHTML = '<p><strong>用户名：</strong>' + user.username + '</p>' +
                    '<p><strong>昵称：</strong>' + (user.nickname || '-') + '</p>' +
                    '<p><strong>角色：</strong>' + (user.role === 'super_admin' ? '超级管理员' : '普通用户') + '</p>' +
                    '<p><strong>注册时间：</strong>' + new Date(user.createdAt).toLocaleString('zh-CN') + '</p>' +
                    '<p><strong>邮箱：</strong>' + (user.email || '-') + '</p>' +
                    '<p><strong>个人简介：</strong>' + (user.bio || '-') + '</p>' +
                    '<p><strong>头像URL：</strong>' + (user.avatarUrl || '-') + '</p>';
    openModal();
};

// ========== 弹窗控制 ==========
function openModal() {
    document.getElementById('userDetailModal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('userDetailModal').style.display = 'none';
}

window.closeModal = closeModal;

// ========== 角色变更 ==========
window.changeRole = function (username) {
    if (!confirm('确定将 "' + username + '" 降级为普通用户？')) return;
    var users = getUsers();
    for (var i = 0; i < users.length; i++) {
        if (users[i].username === username) {
            users[i].role = 'user';
            break;
        }
    }
    saveUsers(users);
    addLog('change_role', '将 ' + username + ' 降级为普通用户');
    renderUsersTable();
};

// ========== 删除用户 ==========
window.deleteUser = function (username) {
    if (!confirm('确定删除用户 "' + username + '"？此操作不可恢复！')) return;
    var users = getUsers();
    var newUsers = [];
    for (var i = 0; i < users.length; i++) {
        if (users[i].username !== username) {
            newUsers.push(users[i]);
        }
    }
    saveUsers(newUsers);
    addLog('delete_user', '删除用户 ' + username);
    renderUsersTable();
};

// ========== 系统设置 ==========
function loadSettings() {
    var settings = JSON.parse(localStorage.getItem('siteSettings') || '{}');
    document.getElementById('siteName').value = settings.siteName || '';
    document.getElementById('siteDescription').value = settings.siteDescription || '';
    document.getElementById('announcement').value = settings.announcement || '';
    document.getElementById('showAnnouncement').checked = settings.showAnnouncement || false;
    
    var themeRadio = document.querySelector('input[name="theme"][value="' + (settings.theme || 'light') + '"]');
    if (themeRadio) themeRadio.checked = true;
}

function saveSettings() {
    var settings = {
        siteName: document.getElementById('siteName').value,
        siteDescription: document.getElementById('siteDescription').value,
        announcement: document.getElementById('announcement').value,
        showAnnouncement: document.getElementById('showAnnouncement').checked,
        theme: document.querySelector('input[name="theme"]:checked').value
    };
    localStorage.setItem('siteSettings', JSON.stringify(settings));
    addLog('update_settings', '更新系统设置');
    alert('设置已保存！');
}

// ========== 操作日志 ==========
function renderLogs() {
    var logs = JSON.parse(localStorage.getItem('adminLogs') || '[]');
    var filterType = document.getElementById('logFilter') ? document.getElementById('logFilter').value : '';

    if (filterType) {
        logs = logs.filter(function(log) { return log.action === filterType; });
    }

    var tbody = document.getElementById('logsTableBody');
    if (!tbody) return;

    var html = '';
    for (var i = 0; i < logs.length; i++) {
        var log = logs[i];
        var actionLabels = {
            login: '登录', register: '注册', delete_user: '删除用户',
            change_role: '角色变更', update_profile: '更新资料', update_settings: '系统设置'
        };
        html += '<tr><td>' + log.time + '</td><td>' + log.admin + '</td><td>' + (actionLabels[log.action] || log.action) + '</td><td>' + log.detail + '</td></tr>';
    }
    tbody.innerHTML = html;
}
