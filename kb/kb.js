/* 学科知识库附属站点（/kb/）
 * 数据源：主站 Functions /api/data
 *   - siteKbConfig：知识库站点配置（启用、名称、副标题、主题色、公告、学科列表）
 *   - kbEntries：知识条目数组（公开只读，仅管理员可在后台维护）
 */
(function () {
    'use strict';

    var API_BASE = (window.KB_API_BASE || '').replace(/\/$/, '');
    var K_CONFIG = 'siteKbConfig';
    var K_ENTRIES = 'kbEntries';

    var DEFAULTS = {
        enabled: true,
        name: '学科知识库',
        subtitle: '按学科整理知识点 · 公式 · 易错点',
        intro: '这里是主站的第二个附属站点，用于沉淀各学科知识点、公式与解题模型。条目由超级管理员在后台维护，前台无需登录即可浏览。',
        accent: '#0d9488',
        notice: '',
        subjects: ['语文', '数学', '英语', '物理', '化学', '生物']
    };

    /* 无云端数据时的示例条目，便于首次访问就有内容可看 */
    var SAMPLE = [
        {
            id: 'sample-chem-redox',
            subject: '化学',
            title: '氧化还原反应：配平顺序与四个高频陷阱',
            tags: '氧化还原,配平,电子守恒',
            summary: '配平按“标价态—列升降—定总数—补守恒”四步走，多数失分点集中在介质条件与电子得失总数上。',
            body: '## 配平四步法\n- 标变价：只标注实际发生化合价变化的元素，不参与反应的元素不动\n- 列升降：每升（降）1 价 × 原子个数 = 该物质得失电子数\n- 定总数：使得电子总数 = 失电子总数，先配氧化剂与还原剂系数\n- 补守恒：补介质（H⁺/OH⁻/H₂O），再用原子守恒收尾\n\n## 高频陷阱\n- 酸性介质用 `H⁺` 配氢、用水配氧；碱性介质必须改用 `OH⁻`，两侧不能同时出现 H⁺ 与 OH⁻\n- 同一元素既被氧化又被还原（歧化）时，升降都算在同一物质内部，不能漏项\n- 离子方程式配平后，须同时校验电荷守恒，这一步能抓出大部分系数错误\n- 部分氧化还原反应中，酸（如浓盐酸、稀硫酸）既作介质又被消耗，系数不能只按电子守恒定\n\n> 检查口诀：电子守恒、原子守恒、电荷守恒，三关都过再下笔。',
            createdAt: '2026-11-01T09:00:00.000Z',
            updatedAt: '2026-11-01T09:00:00.000Z',
            author: '示例数据'
        },
        {
            id: 'sample-phy-momentum',
            subject: '物理',
            title: '动量守恒的适用条件与三类常考模型',
            tags: '动量守恒,碰撞,反冲',
            summary: '判断动量是否守恒，看的是“系统所受合外力是否为零”，不是“有没有力做负功”。',
            body: '## 适用条件\n- 系统不受外力，或所受合外力为零：动量严格守恒\n- 内力远大于外力（碰撞、爆炸、反冲的瞬间）：近似守恒，可先按守恒列式\n- 某一方向合外力为零：该方向动量守恒，可单方向列式\n\n## 三类常考模型\n- 弹性碰撞：动量守恒 + 动能守恒，等质量正碰后交换速度\n- 完全非弹性碰撞：碰后共速，动能损失最大，损失量 `ΔE = ½·(m₁m₂/(m₁+m₂))·v_rel²`\n- 人船模型：系统初动量为零，位移与质量成反比，`m₁x₁ = m₂x₂`\n\n## 易错点\n- 动量是矢量，一维问题必须先规定正方向，符号错是最常见失分\n- 碰撞过程还要校验结果合理性：碰后总动能不得增加，且不能出现“穿过对方”的速度关系\n- 与动量定理混用：动量定理对应的是“合外力的冲量”，研究对象是单个物体或系统均可，但要看题目给的是时间还是位移。',
            createdAt: '2026-11-02T10:00:00.000Z',
            updatedAt: '2026-11-02T10:00:00.000Z',
            author: '示例数据'
        },
        {
            id: 'sample-bio-photo',
            subject: '生物',
            title: '光合作用与细胞呼吸：物质与能量的对应关系',
            tags: '光合作用,细胞呼吸,净光合',
            summary: '把两套过程的场所、原料、产物列成一张对齐表，净光合速率的判断就不会再绕。',
            body: '## 过程定位\n- 光反应：类囊体薄膜，水的光解产生 O₂ 与 NADPH，同时合成 ATP\n- 暗反应（碳反应）：叶绿体基质，CO₂ 经固定、还原生成糖类，消耗 ATP 与 NADPH\n- 有氧呼吸：第一阶段细胞质基质，第二、三阶段线粒体（第三阶段在内膜）\n\n## 关键对应\n- 光合作用消耗 CO₂、释放 O₂；有氧呼吸消耗 O₂、释放 CO₂\n- 净光合速率 = 真光合速率 − 呼吸速率，密闭容器中可直接用 CO₂ 变化量或 O₂ 变化量度量\n- 光补偿点：净光合为零，此时真光合 = 呼吸\n- 光饱和点：再增光强，光合速率不再上升，限制因素转为 CO₂ 浓度或温度\n\n## 易错点\n- “叶肉细胞释放 O₂”表述的是净光合，不等于真光合\n- 夜间只进行呼吸作用，此时测得的 CO₂ 释放量就是呼吸速率\n- 温度影响的是酶活性，对光反应与暗反应的影响并不等价，答题要落到具体环节。',
            createdAt: '2026-11-03T11:00:00.000Z',
            updatedAt: '2026-11-03T11:00:00.000Z',
            author: '示例数据'
        },
        {
            id: 'sample-math-conic',
            subject: '数学',
            title: '圆锥曲线：焦点弦与通径的常用结论',
            tags: '圆锥曲线,焦点弦,通径',
            summary: '通径、焦半径、焦点弦长这三组结论，几乎覆盖选填题的绝大多数设问角度。',
            body: '## 通用结论\n- 椭圆与双曲线的通径（过焦点且垂直于长轴/实轴的弦）长为 `2b²/a`\n- 抛物线的通径长为 `2p`\n- 椭圆焦半径：到左焦点 `a + ex₀`，到右焦点 `a − ex₀`（x₀ 为横坐标）\n\n## 焦点弦\n- 抛物线 `y² = 2px` 的焦点弦，若两端点横坐标为 x₁、x₂，则 `x₁x₂ = p²/4`，弦长 `= x₁ + x₂ + p`\n- 椭圆过焦点的弦长，用第二定义转成到准线距离更快\n\n## 使用建议\n- 选填题优先用结论直接代入，省去联立\n- 解答题必须写出推导起点（设点、设线、联立），结论只能作为检验手段\n- 出现“中点”“垂直平分”等条件时，先考虑点差法，再考虑联立。',
            createdAt: '2026-11-04T12:00:00.000Z',
            updatedAt: '2026-11-04T12:00:00.000Z',
            author: '示例数据'
        },
        {
            id: 'sample-chinese-wenyan',
            subject: '语文',
            title: '文言文实词：一词多义的判断顺序',
            tags: '文言文,实词,推断',
            summary: '先定词性、再看搭配、最后验文意，三步筛掉大部分错误义项。',
            body: '## 判断顺序\n- 第一步定词性：看该词在句中的位置，主语宾语多为名词，谓语多为动词\n- 第二步看搭配：结合前后成分判断能否带宾语、能否被副词修饰\n- 第三步验文意：把候选义项代回原句，读得通且与上下文逻辑一致才成立\n\n## 常考推断法\n- 字形推断：从偏旁推本义，如“贝”旁多与财货相关\n- 结构推断：对偶句中对应位置词义相近或相反\n- 成语印证：用现代成语中的保留义反推，如“赴汤蹈火”的“汤”为热水\n\n## 注意\n- 通假字优先于引申义，遇到讲不通的字先想通假\n- 词类活用会改变词性，判断活用要先确认原词性\n- 翻译题按“字字落实”给分，省略成分需补出并加括号。',
            createdAt: '2026-11-05T13:00:00.000Z',
            updatedAt: '2026-11-05T13:00:00.000Z',
            author: '示例数据'
        },
        {
            id: 'sample-english-clause',
            subject: '英语',
            title: '定语从句：关系词选择的三步判定',
            tags: '定语从句,关系词,语法填空',
            summary: '先看先行词、再看从句缺什么成分、最后看限制性或非限制性，三步定关系词。',
            body: '## 三步判定\n- 第一步看先行词：指人、指物、还是整句内容\n- 第二步看从句缺什么：缺主语/宾语用关系代词，缺状语用关系副词\n- 第三步看逗号：有逗号是非限制性定语从句，不能用 `that`\n\n## 易混点\n- `where` 与 `which`：从句缺主宾用 which，缺地点状语才用 where（先行词是 place 不代表一定用 where）\n- `whose` 后必须接名词，表示所属关系\n- `as` 引导非限制性定语从句可置于句首，`which` 不能\n- 介词 + 关系代词：介词由从句中的动词搭配决定，不能凭先行词猜\n\n## 答题动作\n- 语法填空先数从句成分，再定关系词，最后检查是否有逗号\n- 短文改错重点看 that/which 混用、关系副词与关系代词错位。',
            createdAt: '2026-11-06T14:00:00.000Z',
            updatedAt: '2026-11-06T14:00:00.000Z',
            author: '示例数据'
        }
    ];

    var state = { cfg: DEFAULTS, entries: [], subject: 'all', q: '', sort: 'updated', loading: true };

    function $(id) { return document.getElementById(id); }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function token() {
        try { return localStorage.getItem('siteAuthToken') || ''; } catch (e) { return ''; }
    }

    function apiGet(key) {
        var url = (API_BASE || '..') + '/api/data?key=' + encodeURIComponent(key);
        var headers = { 'accept': 'application/json' };
        var t = token();
        if (t) headers['x-site-token'] = t;
        return fetch(url, { headers: headers, cache: 'no-store' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).then(function (j) {
            if (!j || j.ok === false) throw new Error((j && j.error) || 'bad payload');
            return j.value;
        });
    }

    function fmtDate(v) {
        if (!v) return '';
        var d = new Date(v);
        if (isNaN(d.getTime())) return String(v).slice(0, 10);
        var p = function (n) { return n < 10 ? '0' + n : '' + n; };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }

    function tagList(tags) {
        if (!tags) return [];
        if (Array.isArray(tags)) return tags.filter(Boolean).map(String);
        return String(tags).split(/[,，;；\s]+/).filter(Boolean);
    }

    function applyConfig(cfg) {
        var c = cfg && typeof cfg === 'object' ? cfg : {};
        state.cfg = {
            enabled: c.enabled !== false,
            name: c.name || DEFAULTS.name,
            subtitle: c.subtitle || DEFAULTS.subtitle,
            intro: c.intro || DEFAULTS.intro,
            accent: /^#[0-9a-fA-F]{6}$/.test(c.accent || '') ? c.accent : DEFAULTS.accent,
            notice: c.notice || '',
            subjects: (Array.isArray(c.subjects) && c.subjects.length ? c.subjects.filter(Boolean) : DEFAULTS.subjects).map(String)
        };
    state.tag = '';
        var cfgRoot = document.documentElement.style;
        cfgRoot.setProperty('--kb-accent', state.cfg.accent);
        cfgRoot.setProperty('--kb-accent-soft', hexSoft(state.cfg.accent));

        $('kbName').textContent = state.cfg.name;
        $('kbSubtitle').textContent = state.cfg.subtitle;
        $('kbIntro').textContent = state.cfg.intro;
        document.title = state.cfg.name + ' · 我的站点';

        var notice = $('kbNotice');
        if (state.cfg.notice) { notice.textContent = state.cfg.notice; notice.hidden = false; }
        else notice.hidden = true;
    }

    function hexSoft(hex) {
        var h = hex.replace('#', '');
        var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
        return 'rgba(' + r + ',' + g + ',' + b + ',0.12)';
    }

    function normalizeEntries(list) {
        if (!Array.isArray(list)) return [];
        return list.filter(function (e) { return e && (e.title || e.name); }).map(function (e, i) {
            return {
                id: e.id || 'kb-' + i,
                subject: e.subject || e.category || '综合',
                title: e.title || e.name || '未命名条目',
                tags: tagList(e.tags),
                summary: e.summary || e.desc || '',
                body: e.body || e.content || '',
                createdAt: e.createdAt || e.updatedAt || '',
                updatedAt: e.updatedAt || e.createdAt || '',
                author: e.author || ''
            };
        });
    }

    function subjectList() {
        var set = [], seen = {};
        state.cfg.subjects.forEach(function (s) { if (!seen[s]) { seen[s] = 1; set.push(s); } });
        state.entries.forEach(function (e) { if (!seen[e.subject]) { seen[e.subject] = 1; set.push(e.subject); } });
        return set;
    }

    function counts() {
        var map = {};
        state.entries.forEach(function (e) { map[e.subject] = (map[e.subject] || 0) + 1; });
        return map;
    }

    function renderSubjects() {
        var box = $('kbSubjects');
        var map = counts();
        var subs = subjectList();
        var html = '<li><button type="button" data-subject="all" class="' + (state.subject === 'all' ? 'is-active' : '') + '">'
            + '<span>全部学科</span><span class="kb-count">' + state.entries.length + '</span></button></li>';
        subs.forEach(function (s) {
            html += '<li><button type="button" data-subject="' + esc(s) + '" class="' + (state.subject === s ? 'is-active' : '') + '">'
                + '<span>' + esc(s) + '</span><span class="kb-count">' + (map[s] || 0) + '</span></button></li>';
        });
        box.innerHTML = html;
        box.querySelectorAll('button[data-subject]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                state.subject = btn.getAttribute('data-subject');
                renderSubjects();
                renderList();
            });
        });
    }

    function renderStats() {
        var tags = {}, sub = {};
        state.entries.forEach(function (e) {
            sub[e.subject] = 1;
            e.tags.forEach(function (t) { tags[t] = 1; });
        });
        $('kbStatTotal').textContent = state.entries.length;
        $('kbStatSubject').textContent = Object.keys(sub).length;
        $('kbStatTag').textContent = Object.keys(tags).length;
    }

    /* ===== 自然排序 + 下载导出 ===== */
    function natCompare(a, b) {
        var re = /(\d+)|(\D+)/g;
        var pa = String(a).match(re) || [], pb = String(b).match(re) || [];
        var n = Math.min(pa.length, pb.length);
        for (var i = 0; i < n; i++) {
            var x = pa[i], y = pb[i];
            if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
                var d = parseInt(x, 10) - parseInt(y, 10);
                if (d) return d;
            } else {
                var c = x.localeCompare(y, 'zh-Hans-CN');
                if (c) return c;
            }
        }
        return pa.length - pb.length;
    }

    function safeName(v) {
        return String(v == null ? '' : v).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'entry';
    }

    function downloadText(name, text) {
        var blob = new Blob(['\ufeff' + text], { type: 'text/markdown;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 1500);
    }

    function entryToMd(e) {
        var out = '# ' + (e.title || '未命名条目') + '\n\n';
        out += '- 学科：' + (e.subject || '未分类') + '\n';
        out += '- 标签：' + ((e.tags && e.tags.length ? e.tags.join('、') : '无')) + '\n';
        out += '- 更新于：' + fmtDate(e.updatedAt) + '\n';
        if (e.createdAt) out += '- 创建于：' + fmtDate(e.createdAt) + '\n';
        if (e.author) out += '- 维护者：' + e.author + '\n';
        if (e.summary) out += '\n> ' + e.summary + '\n';
        return out + '\n' + String(e.body || '') + '\n';
    }

    function kbSetStatus(msg) {
        var st = document.getElementById('kbStatus');
        if (st) { st.hidden = false; st.textContent = msg; }
    }

    function downloadEntry() {
        var e = state.current;
        if (!e) { kbSetStatus('请先打开一条条目再下载'); return; }
        downloadText(safeName(e.subject + '-' + e.title) + '.md', entryToMd(e));
        kbSetStatus('已开始下载：' + (e.title || '条目') + '.md');
    }

    function downloadList() {
        var list = filtered();
        if (!list.length) { kbSetStatus('当前筛选没有可导出的条目'); return; }
        var d = new Date();
        var stamp = d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
        var scope = state.tag ? ('标签：' + state.tag) : (state.subject === 'all' ? '全部学科' : state.subject);
        var head = '# 学科知识库导出\n\n- 导出时间：' + stamp
            + '\n- 范围：' + scope
            + (state.q ? '（关键词：' + state.q + '）' : '')
            + '\n- 条目数：' + list.length + '\n\n---\n\n';
        downloadText('知识库_' + (state.tag ? safeName(state.tag) : (state.subject === 'all' ? '全部' : safeName(state.subject))) + '_' + stamp + '.md',
            head + list.map(entryToMd).join('\n---\n\n'));
        kbSetStatus('已导出 ' + list.length + ' 条为 Markdown');
    }

    function filtered() {
        var q = state.q.trim().toLowerCase();
        var list = state.entries.filter(function (e) {
            if (state.subject !== 'all' && e.subject !== state.subject) return false;
            if (!q) return true;
            var hay = [e.title, e.subject, e.summary, e.body, e.tags.join(' ')].join(' ').toLowerCase();
            return hay.indexOf(q) >= 0;
        });
        if (state.sort === 'title') {
            list.sort(function (a, b) { return a.title.localeCompare(b.title, 'zh-Hans-CN'); });
        } else if (state.sort === 'subject') {
            list.sort(function (a, b) {
                if (a.subject === b.subject) return (b.updatedAt || '').localeCompare(a.updatedAt || '');
                return a.subject.localeCompare(b.subject, 'zh-Hans-CN');
            });
        } else {
            list.sort(function (a, b) { return (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
        }
        if (state.tag) {
            list = list.filter(function (e) { return (e.tags || []).indexOf(state.tag) !== -1; });
        }
        if (state.sort === 'title') {
            list.sort(function (a, b) { return natCompare(a.title, b.title); });
        }
        return list;
    }

    function renderList() {
        var list = filtered();
        var wrap = $('kbList');
        var empty = $('kbEmpty');
        $('kbListTitle').textContent = state.subject === 'all' ? '全部条目' : state.subject + ' · 条目';

        if (!list.length) {
            wrap.hidden = true;
            wrap.innerHTML = '';
            empty.hidden = false;
            return;
        }
        empty.hidden = true;
        wrap.hidden = false;

        wrap.innerHTML = list.map(function (e) {
            var tags = e.tags.slice(0, 4).map(function (t) { return '<span class="kb-tag kb-tag-btn' + (state.tag === t ? ' is-on' : '') + '" data-tag="' + esc(t) + '">' + esc(t) + '</span>'; }).join('');
            return '<button type="button" class="kb-card" data-id="' + esc(e.id) + '">'
                + '<div class="kb-card-head"><span class="kb-badge">' + esc(e.subject) + '</span>'
                + '<span class="kb-card-meta" style="margin:0">更新于 ' + esc(fmtDate(e.updatedAt)) + '</span></div>'
                + '<h3 class="kb-card-title">' + esc(e.title) + '</h3>'
                + (e.summary ? '<p class="kb-card-summary">' + esc(e.summary) + '</p>' : '')
                + (tags ? '<div class="kb-tags">' + tags + '</div>' : '')
                + '</button>';
        }).join('');

        wrap.querySelectorAll('.kb-tag-btn').forEach(function (tagEl) {
            tagEl.addEventListener('click', function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                var t = tagEl.getAttribute('data-tag') || '';
                state.tag = (state.tag === t) ? '' : t;
                renderList();
            });
        });

        wrap.querySelectorAll('.kb-card').forEach(function (card) {
            card.addEventListener('click', function () { openDetail(card.getAttribute('data-id')); });
        });
        if (state.tag) {
            kbSetStatus('已按标签筛选：' + state.tag + '（再次点击该标签可取消）· 共 ' + list.length + ' 条');
        }
    }

    function inlineMd(s) {
        return esc(s)
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/`([^`]+)`/g, '<code>$1</code>');
    }

    function splitRow(line) {
        var s = line.trim();
        if (s.charAt(0) === '|') s = s.slice(1);
        if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
        return s.split('|').map(function (c) { return c.trim(); });
    }

    function isTableSep(line) {
        return /^\|?[\s:\-|]+\|[\s:\-|]*$/.test(line.trim()) && line.indexOf('-') !== -1;
    }

    function renderTable(rows) {
        var head = '', body = '', start = 0;
        if (rows.length > 1 && isTableSep(rows[1])) {
            head = '<thead><tr>' + splitRow(rows[0]).map(function (c) { return '<th>' + inlineMd(c) + '</th>'; }).join('') + '</tr></thead>';
            start = 2;
        }
        for (var i = start; i < rows.length; i++) {
            if (isTableSep(rows[i])) continue;
            body += '<tr>' + splitRow(rows[i]).map(function (c) { return '<td>' + inlineMd(c) + '</td>'; }).join('') + '</tr>';
        }
        if (!body) return '';
        return '<div class="kb-table-wrap"><table class="kb-table">' + head + '<tbody>' + body + '</tbody></table></div>';
    }

    function renderBody(text) {
        var lines = String(text || '').split(/\r?\n/);
        var html = '', buf = [], mode = null;

        function flush() {
            if (!buf.length) return;
            if (mode === 'ul') html += '<ul>' + buf.map(function (t) { return '<li>' + inlineMd(t) + '</li>'; }).join('') + '</ul>';
            else if (mode === 'ol') html += '<ol>' + buf.map(function (t) { return '<li>' + inlineMd(t) + '</li>'; }).join('') + '</ol>';
            else if (mode === 'quote') html += '<blockquote>' + buf.map(inlineMd).join('<br>') + '</blockquote>';
            else html += '<p>' + buf.map(inlineMd).join('<br>') + '</p>';
            buf = [];
            mode = null;
        }

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].replace(/\s+$/, '');
            if (!line.trim()) { flush(); continue; }

            if (line.trim().charAt(0) === '|') {
                var rows = [];
                while (i < lines.length && lines[i].trim().charAt(0) === '|') {
                    rows.push(lines[i]);
                    i++;
                }
                i--;
                flush();
                html += renderTable(rows);
                continue;
            }

            var h = line.match(/^(#{1,4})\s+(.*)$/);
            if (h) {
                flush();
                var tag = h[1].length <= 2 ? 'h4' : 'h5';
                html += '<' + tag + '>' + inlineMd(h[2]) + '</' + tag + '>';
                continue;
            }
            var ul = line.match(/^[-*]\s+(.*)$/);
            if (ul) {
                if (mode !== 'ul') { flush(); mode = 'ul'; }
                buf.push(ul[1]); continue;
            }
            var ol = line.match(/^\d+[.、)]\s+(.*)$/);
            if (ol) {
                if (mode !== 'ol') { flush(); mode = 'ol'; }
                buf.push(ol[1]); continue;
            }
            if (/^>\s?/.test(line)) {
                if (mode !== 'quote') { flush(); mode = 'quote'; }
                buf.push(line.replace(/^>\s?/, '')); continue;
            }
            if (mode && mode !== 'p') flush();
            mode = 'p';
            buf.push(line);
        }
        flush();
        return html || '<p>该条目暂无正文内容。</p>';
    }

    function openDetail(id) {
        state.current = null;
        (state.entries || []).forEach(function (x) {
            if (String(x.id) === String(id)) { state.current = x; }
        });
        var e = state.entries.filter(function (x) { return String(x.id) === String(id); })[0];
        if (!e) return;
        $('kbDetailSubject').textContent = e.subject;
        $('kbDetailTitle').textContent = e.title;
        var meta = [];
        if (e.updatedAt) meta.push('更新于 ' + fmtDate(e.updatedAt));
        if (e.createdAt) meta.push('创建于 ' + fmtDate(e.createdAt));
        if (e.author) meta.push('维护者 ' + e.author);
        $('kbDetailMeta').textContent = meta.join(' · ');
        $('kbDetailTags').innerHTML = e.tags.map(function (t) { return '<span class="kb-tag">' + esc(t) + '</span>'; }).join('');
        $('kbDetailBody').innerHTML = renderBody(e.body);
        $('kbDetailBody').scrollTop = 0;
        $('kbDetail').hidden = false;
        document.body.style.overflow = 'hidden';
        try { history.replaceState(null, '', '#entry=' + encodeURIComponent(e.id)); } catch (err) {}
    }

    function closeDetail() {
        $('kbDetail').hidden = true;
        document.body.style.overflow = '';
        try { history.replaceState(null, '', location.pathname + location.search); } catch (err) {}
    }

    function renderSession() {
        var user = null;
        try { user = JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch (e) {}
        var session = $('kbSession');
        var login = $('kbLoginLink');
        var adminLink = $('kbAdminLink');
        if (user && (user.nickname || user.username)) {
            session.textContent = '已登录 · ' + (user.nickname || user.username);
            session.hidden = false;
            login.hidden = true;
            if (user.role === 'admin' || user.role === 'super_admin') adminLink.hidden = false;
        } else {
            session.hidden = true;
            login.hidden = false;
            adminLink.hidden = true;
        }
    }

    function bind() {
        var _dl = document.getElementById('kbDetailDownload');
        if (_dl) _dl.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); downloadEntry(); });
        var _ex = document.getElementById('kbExportBtn');
        if (_ex) _ex.addEventListener('click', function (ev) { ev.preventDefault(); downloadList(); });

        var search = $('kbSearch');
        var timer = null;
        search.addEventListener('input', function () {
            $('kbSearchClear').hidden = !search.value;
            clearTimeout(timer);
            timer = setTimeout(function () {
                state.q = search.value;
                renderList();
            }, 160);
        });
        $('kbSearchClear').addEventListener('click', function () {
            search.value = '';
            state.q = '';
            $('kbSearchClear').hidden = true;
            renderList();
            search.focus();
        });
        $('kbSort').addEventListener('change', function () {
            state.sort = $('kbSort').value;
            renderList();
        });
        $('kbDetailClose').addEventListener('click', closeDetail);
        $('kbDetail').querySelector('[data-close]').addEventListener('click', closeDetail);
        document.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape' && !$('kbDetail').hidden) closeDetail();
        });
        $('kbSearchJump').addEventListener('click', function (ev) {
            ev.preventDefault();
            search.focus();
            search.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        window.addEventListener('hashchange', function () {
            var m = location.hash.match(/^#entry=(.+)$/);
            if (m) openDetail(decodeURIComponent(m[1]));
        });
    }

    var LOCAL_DATA = 'data/entries.json';
    var LOCAL_DATA_URL = LOCAL_DATA + '?t=' + Date.now(); // 破缓存：始终取最新同步数据

    function loadLocal() {
        return fetch(LOCAL_DATA_URL, { cache: 'no-cache' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        });
    }

    function boot() {
        bind();
        renderSession();

        var cfgPromise = apiGet(K_CONFIG).catch(function () { return null; });
        var entriesPromise = apiGet(K_ENTRIES).catch(function () { return null; });
        var localPromise = loadLocal().catch(function () { return null; });

        Promise.all([cfgPromise, entriesPromise, localPromise]).then(function (res) {
            applyConfig(res[0]);

            var cloud = normalizeEntries(res[1]);
            var localData = res[2];
            var local = normalizeEntries(localData && localData.entries ? localData.entries : localData);

            if (cloud.length) {
                state.entries = cloud;
                state.srcNote = '内容来自云端后台条目，共 ' + cloud.length + ' 条。';
            } else if (local.length) {
                state.entries = local;
                var stamp = localData && localData.generatedAt ? fmtDate(localData.generatedAt) : '';
                state.srcNote = '内容与原文件同步，共 ' + local.length + ' 条' + (stamp ? '，同步时间 ' + stamp : '') + '（原文件更新后同步刷新）。';
            } else {
                state.entries = normalizeEntries(SAMPLE);
                state.srcNote = '暂未读取到同步数据，当前展示内置示例内容。';
            }
            var fromSample = !cloud.length && !local.length;
            state.loading = false;

            if (!state.cfg.enabled) {
                $('kbStatus').hidden = true;
                $('kbList').hidden = true;
                $('kbEmpty').hidden = true;
                $('kbDisabled').hidden = false;
                $('kbSubjects').innerHTML = '';
                return;
            }

            $('kbStatus').textContent = state.srcNote;
            $('kbStatus').hidden = false;
            $('kbStatus').classList.toggle('is-muted', fromSample);

            renderSubjects();
            renderStats();
            renderList();

            var m = location.hash.match(/^#entry=(.+)$/);
            if (m) {
                var id = decodeURIComponent(m[1]);
                if (state.entries.some(function (e) { return String(e.id) === id; })) openDetail(id);
            }
        }).catch(function (err) {
            $('kbStatus').textContent = '知识库读取失败：' + (err && err.message ? err.message : '未知错误');
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
