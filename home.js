/* ============================================================
 * home.js — 首页架构 v4 编排层
 * 由 index.html 内联脚本迁出，职责：
 *   1) 主内容 / 互动区 Tab 切换（hash 直达、键盘导航、前进后退）
 *   2) 折叠区开合状态记忆
 *   3) 导航抽屉、首屏统计、悬浮入口、后台入口联动
 * 说明：渲染与鉴权逻辑仍由 auth.js 负责，本文件只做视图编排，
 *       不触碰 pullKey / writeQueue / 登录态链路。
 * ============================================================ */
(function () {
    'use strict';

    var doc = document;
    var root = doc.querySelector('.home-v4');
    if (!root) return;

    var FOLD_PREFIX = 'hv4Fold:';
    var groups = {};
    var groupOfTab = {};

    /* ---------------- 通用工具 ---------------- */
    function smoothScrollTo(top) {
        try {
            window.scrollTo({ top: top, behavior: 'smooth' });
        } catch (e) {
            window.scrollTo(0, top);
        }
    }

    function scrollToElement(el, offset) {
        if (!el) return;
        var top = el.getBoundingClientRect().top + (window.pageYOffset || doc.documentElement.scrollTop || 0) - (offset || 72);
        smoothScrollTo(top < 0 ? 0 : top);
    }

    /* ---------------- Tab 组 ---------------- */
    function setupGroup(container, name) {
        var tabs = Array.prototype.slice.call(container.querySelectorAll('[data-hv4-tab]'));
        /* 面板与 tablist 是兄弟节点，统一在父容器内查找 */
        var panels = Array.prototype.slice.call((container.parentNode || container).querySelectorAll('[data-hv4-panel]'));
        if (!tabs.length || !panels.length) return;

        var idByName = {};
        panels.forEach(function (p) {
            idByName[p.getAttribute('data-hv4-panel')] = p.id;
        });

        function activate(target, options) {
            options = options || {};
            var matched = null;
            tabs.forEach(function (tab) {
                var on = tab.getAttribute('data-hv4-tab') === target;
                if (on) matched = tab;
                tab.setAttribute('aria-selected', on ? 'true' : 'false');
                tab.tabIndex = on ? 0 : -1;
            });
            if (!matched) return false;

            panels.forEach(function (panel) {
                var on = panel.getAttribute('data-hv4-panel') === target;
                panel.hidden = !on;
                if (on) {
                    panel.classList.remove('hv4-enter');
                    if (!options.silent) {
                        void panel.offsetWidth;
                        panel.classList.add('hv4-enter');
                    }
                }
            });

            if (options.syncHash !== false && idByName[target]) {
                var nextHash = '#' + idByName[target];
                if (window.location.hash !== nextHash) {
                    try {
                        window.history.replaceState({ hv4: target }, '', nextHash);
                    } catch (e) {
                        /* file:// 等场景忽略 */
                    }
                }
            }

            try {
                doc.dispatchEvent(new CustomEvent('hv4:tabchange', { detail: { group: name, tab: target } }));
            } catch (e) {
                /* 老浏览器忽略 */
            }
            return true;
        }

        /* 点击切换 */
        tabs.forEach(function (tab, index) {
            tab.addEventListener('click', function () {
                activate(tab.getAttribute('data-hv4-tab'));
            });
            tab.addEventListener('keydown', function (e) {
                var next = null;
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = tabs[(index + 1) % tabs.length];
                else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = tabs[(index - 1 + tabs.length) % tabs.length];
                else if (e.key === 'Home') next = tabs[0];
                else if (e.key === 'End') next = tabs[tabs.length - 1];
                if (next) {
                    e.preventDefault();
                    next.focus();
                    activate(next.getAttribute('data-hv4-tab'));
                }
            });
            groupOfTab[tab.getAttribute('data-hv4-tab')] = name;
        });

        groups[name] = {
            container: container,
            activate: activate,
            idByName: idByName,
            current: tabs[0].getAttribute('data-hv4-tab')
        };
    }

    var mainTabs = root.querySelector('[data-hv4-tabs="main"]');
    var interactTabs = root.querySelector('[data-hv4-tabs="interact"]');
    if (mainTabs) setupGroup(mainTabs, 'main');
    if (interactTabs) setupGroup(interactTabs, 'interact');

    /* ---------------- 统一跳转入口 ---------------- */
    function goto(tabName, options) {
        options = options || {};
        var groupName = groupOfTab[tabName];
        var group = groupName && groups[groupName];
        if (!group) return false;
        group.current = tabName;
        group.activate(tabName, { silent: options.silent, syncHash: options.syncHash });

        var panel = doc.getElementById(group.idByName[tabName]);
        if (panel) {
            if (options.align === 'panel') scrollToElement(panel, options.offset);
            else if (options.align !== false) scrollToElement(panel, options.offset);
        }
        if (options.focusId) {
            var field = doc.getElementById(options.focusId);
            if (field) {
                setTimeout(function () {
                    try {
                        field.focus();
                    } catch (e) {
                        /* ignore */
                    }
                }, options.focusDelay || 380);
            }
        }
        return true;
    }

    window.hv4 = { goto: goto, groups: groups };

    /* ---------------- 锚点映射 ----------------
     * tabAnchors：需要先切换互动区 Tab 再定位的锚点
     * scrollAnchors：常驻区块，直接滚动定位
     * focusMap：定位后需要聚焦的输入框
     */
    var tabAnchors = {
        '#panel-moment': 'moment',
        '#momentFeed': 'moment',
        '#homeMomentInput': 'moment',
        '#panel-vote': 'vote',
        '#pollList': 'vote',
        '#panel-album': 'album',
        '#albumMasonry': 'album',
        '#panel-feedback': 'feedback',
        '#feedbackList': 'feedback'
    };

    var scrollAnchors = {
        '#homeHero': 'homeHero',
        '#contentSection': 'contentSection',
        '#contentList': 'contentSection',
        '#guestbookSection': 'guestbookSection',
        '#guestbookList': 'guestbookSection',
        '#guestbookInput': 'guestbookSection',
        '#sideAnnounce': 'sideAnnounce',
        '#announcementList': 'sideAnnounce',
        '#sideDaily': 'sideDaily',
        '#interactSection': 'interactSection'
    };

    var focusMap = {
        '#guestbookInput': 'guestbookInput',
        '#homeMomentInput': 'homeMomentInput'
    };

    function scrollToSection(id) {
        var el = doc.getElementById(id);
        if (!el) return false;
        scrollToElement(el);
        if (focusMap['#' + id]) {
            var field = doc.getElementById(focusMap['#' + id]);
            if (field) {
                setTimeout(function () {
                    try {
                        field.focus();
                    } catch (e) {
                        /* ignore */
                    }
                }, 400);
            }
        }
        return true;
    }

    function applyHash(scroll) {
        var hash = window.location.hash;
        if (!hash) return false;
        if (tabAnchors[hash]) {
            return goto(tabAnchors[hash], {
                syncHash: false,
                align: scroll ? 'panel' : false,
                focusId: focusMap[hash] || null
            });
        }
        if (scrollAnchors[hash]) {
            if (scroll) scrollToSection(scrollAnchors[hash]);
            if (focusMap[hash]) {
                var field = doc.getElementById(focusMap[hash]);
                if (field) {
                    setTimeout(function () {
                        try {
                            field.focus();
                        } catch (e) {
                            /* ignore */
                        }
                    }, 400);
                }
            }
            return true;
        }
        return false;
    }

    /* 首屏按 hash 还原（不滚动，避免冷启动跳动） */
    applyHash(false);
    window.addEventListener('hashchange', function () {
        applyHash(true);
    });

    /* 带 data-hv4-goto 的链接（底部导航 / 抽屉 / 快捷入口） */
    Array.prototype.slice.call(doc.querySelectorAll('[data-hv4-goto]')).forEach(function (link) {
        link.addEventListener('click', function (e) {
            var target = link.getAttribute('data-hv4-goto');
            if (!target || !groupOfTab[target]) return;
            e.preventDefault();
            goto(target, {
                focusId: link.getAttribute('data-hv4-focus') || null
            });
        });
    });

    /* ---------------- 首屏按钮 ----------------
     * auth.js 给 heroContentBtn / heroGuestbookBtn 绑定了 scrollIntoView('contentList' / 'guestbookList')，
     * 冷启动时列表可能尚未渲染导致滚到页面顶部。这里在捕获阶段接管并阻断旧监听器，
     * 改为滚动到常驻区块（内容主栏 / 留言板），并支持聚焦输入框。
     */
    root.addEventListener('click', function (e) {
        var node = e.target;
        var btn = null;
        while (node && node !== root) {
            if (node.id === 'heroContentBtn' || node.id === 'heroGuestbookBtn') {
                btn = node;
                break;
            }
            node = node.parentNode;
        }
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        if (btn.id === 'heroContentBtn') {
            scrollToSection('contentSection');
        } else {
            scrollToSection('guestbookSection');
            var input = doc.getElementById('guestbookInput');
            if (input) {
                setTimeout(function () {
                    try {
                        input.focus();
                    } catch (err) {
                        /* ignore */
                    }
                }, 400);
            }
        }
    }, true);

    /* ---------------- 折叠区状态记忆 ---------------- */
    Array.prototype.slice.call(root.querySelectorAll('details.hv4-fold[id]')).forEach(function (box) {
        var key = FOLD_PREFIX + box.id;
        try {
            if (localStorage.getItem(key) === '1') box.open = true;
        } catch (e) {
            /* 隐私模式忽略 */
        }
        box.addEventListener('toggle', function () {
            try {
                localStorage.setItem(key, box.open ? '1' : '0');
            } catch (e) {
                /* ignore */
            }
            if (box.open) {
                var body = box.querySelector('.hv4-fold-body');
                if (body) {
                    body.classList.remove('hv4-enter');
                    void body.offsetWidth;
                    body.classList.add('hv4-enter');
                }
            }
        });
    });

    /* ---------------- 底部导航高亮 ---------------- */
    var bottomNav = doc.getElementById('bottomNav');
    var navItems = bottomNav ? Array.prototype.slice.call(bottomNav.querySelectorAll('.bottom-nav-item')) : [];
    var navByTab = {};
    navItems.forEach(function (item) {
        var target = item.getAttribute('data-hv4-goto');
        if (target) navByTab[target] = item;
    });

    function setNavActive(tabName) {
        if (!navItems.length) return;
        var target = navByTab[tabName];
        if (!target) return;
        navItems.forEach(function (item) {
            item.classList.toggle('active', item === target);
        });
    }

    doc.addEventListener('hv4:tabchange', function (e) {
        setNavActive(e.detail.tab);
    });

    /* 底部导航「首页」：滚回页面顶部并恢复高亮 */
    var bottomHomeLink = doc.getElementById('bottomHomeLink');
    if (bottomHomeLink) {
        bottomHomeLink.addEventListener('click', function (e) {
            e.preventDefault();
            navItems.forEach(function (item) {
                item.classList.toggle('active', item === bottomHomeLink);
            });
            try {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            } catch (err) {
                window.scrollTo(0, 0);
            }
        });
    }

    /* ---------------- 动态空态兜底 ----------------
     * auth.js 未引用 momentFeedEmpty，无动态时面板会恒为空白。
     * 这里按 momentFeed 的实际渲染结果同步空态提示，数据变化时重算。
     */
    (function initMomentEmpty() {
        var feed = doc.getElementById('momentFeed');
        var empty = doc.getElementById('momentFeedEmpty');
        if (!feed || !empty) return;

        function sync() {
            empty.style.display = feed.childElementCount ? 'none' : 'block';
        }

        sync();
        if (window.MutationObserver) {
            new window.MutationObserver(sync).observe(feed, { childList: true });
        }
        window.addEventListener('site-data-refreshed', function () {
            setTimeout(sync, 300);
        });
    })();

    /* ---------------- 首屏统计 ----------------
     * 数值由 auth.js 的 window.renderHeroStats 负责（含匿名访客 '—' 占位与登录后刷新），
     * 此处不重复实现，避免覆盖其占位逻辑。多端刷新由 auth.js 的 refreshHome 驱动。
     */

    /* ---------------- 导航抽屉 ---------------- */
    (function initDrawer() {
        var drawer = doc.getElementById('navDrawer');
        var overlay = doc.getElementById('sidebarOverlay');
        var toggleBtn = doc.getElementById('navToggle');
        var closeBtn = doc.getElementById('drawerCloseBtn');
        if (!drawer || !overlay || !toggleBtn) return;

        function openDrawer() {
            drawer.classList.add('open');
            overlay.classList.add('show');
        }

        function closeDrawer() {
            drawer.classList.remove('open');
            overlay.classList.remove('show');
        }

        toggleBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            var navRight = doc.querySelector('.top-nav .nav-right');
            if (navRight) navRight.classList.remove('nav-open');
            if (drawer.classList.contains('open')) closeDrawer();
            else openDrawer();
        });
        overlay.addEventListener('click', closeDrawer);
        if (closeBtn) closeBtn.addEventListener('click', closeDrawer);

        Array.prototype.slice.call(drawer.querySelectorAll('.drawer-link')).forEach(function (link) {
            link.addEventListener('click', function () {
                var href = this.getAttribute('href') || '';
                if (href.charAt(0) === '#') closeDrawer();
            });
        });

        var themeBtn = doc.getElementById('drawerThemeBtn');
        if (themeBtn) {
            themeBtn.addEventListener('click', function (e) {
                e.preventDefault();
                var t = doc.getElementById('themeToggle');
                if (t) t.click();
            });
        }

        var logoutBtn = doc.getElementById('drawerLogoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', function (e) {
                e.preventDefault();
                var l = doc.getElementById('logoutBtn');
                if (l) l.click();
            });
        }

        var drawerSearchBtn = doc.getElementById('drawerSearchBtn');
        var drawerSearchInput = doc.getElementById('drawerSearchInput');

        function runDrawerSearch() {
            if (!drawerSearchInput) return;
            var val = drawerSearchInput.value.trim();
            if (!val) {
                drawerSearchInput.focus();
                return;
            }
            var input = doc.getElementById('globalSearchInput');
            if (input) input.value = val;
            if (window.doGlobalSearch) window.doGlobalSearch();
        }

        if (drawerSearchBtn) drawerSearchBtn.addEventListener('click', runDrawerSearch);
        if (drawerSearchInput) {
            drawerSearchInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') runDrawerSearch();
            });
        }
    })();

    /* ---------------- 后台入口 / 悬浮入口联动 ---------------- */
    (function initAdminSync() {
        var adminLink = doc.getElementById('adminLink');
        var drawerAdmin = doc.getElementById('drawerAdminLink');
        var fabAdmin = doc.getElementById('fabAdminLink');
        if (!adminLink) return;

        function sync() {
            var visible = adminLink.style.display === 'block';
            if (drawerAdmin) drawerAdmin.style.display = visible ? 'flex' : 'none';
            if (fabAdmin) fabAdmin.style.display = visible ? 'inline-flex' : 'none';
        }

        sync();
        setTimeout(sync, 300);
        if (window.MutationObserver) {
            new MutationObserver(sync).observe(adminLink, { attributes: true, attributeFilter: ['style'] });
        } else {
            setInterval(sync, 2000);
        }
    })();

    /* ---------------- 悬浮快捷入口 ---------------- */
    (function initFab() {
        var fabMain = doc.getElementById('fabMain');
        var fabGroup = doc.getElementById('fabGroup');
        var fabPublish = doc.getElementById('fabPublishBtn');

        if (fabMain && fabGroup) {
            fabMain.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                fabGroup.classList.toggle('expanded');
            });
            doc.addEventListener('click', function (e) {
                if (fabGroup.classList.contains('expanded') && !fabGroup.contains(e.target)) {
                    fabGroup.classList.remove('expanded');
                }
            });
        }

        if (fabPublish) {
            fabPublish.addEventListener('click', function (e) {
                e.preventDefault();
                goto('moment', { focusId: 'homeMomentInput', focusDelay: 420 });
                if (fabGroup) fabGroup.classList.remove('expanded');
            });
        }
    })();

    /* ---------------- 快捷反馈入口 ----------------
     * #quickFeedback 的点击由 auth.js 绑定（openFeedback，负责弹窗 display 与 modal-in），
     * 此处不再重复绑定。
     */
})();
