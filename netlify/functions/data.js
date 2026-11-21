// 通用 JSON KV 读写端点（Netlify Functions v2 + Blobs 云端存储）
// GET   /.netlify/functions/data?key=xxx   -> { ok: true, value: <json|null> }（缺失返回 value: null）
// POST  /.netlify/functions/data            body { key, value } -> { ok: true }（value 为 null 视为删除该键）
// PUT   /.netlify/functions/data            body { key, value } -> { ok: true }
// OPTIONS 预检，返回 CORS 头
//
// 鉴权策略：
//   公开只读键：announcements / siteGuestbook / siteContents / siteMoments / siteTheme / siteSettings
//   其余键需登录态（x-site-token 或 Authorization: Bearer <token>）
//   users 对非管理员返回脱敏数据（剔除 password/phone/email 等敏感字段）
//   adminLogs / siteVisitLog / siteDeletedUsers / userDevices_* 仅管理员可读
//   写操作一律需要登录态；users 写仅管理员（注册请走 /api/auth 的 register）
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-site-token'
};

const PUBLIC_READ_KEYS = new Set([
    'announcements', 'siteGuestbook', 'siteContents', 'siteMoments', 'siteTheme'
]);
// 读公开、写受限的键：登录页需要读取注册开关等配置，但修改必须由管理员发起
// siteSubsiteConfig：附属站点(/sub/)配置，匿名可读用于前端渲染，仅超级管理员可写
const READ_PUBLIC_WRITE_ADMIN_KEYS = new Set(['siteSettings', 'siteSubsiteConfig']);
const ADMIN_ONLY_KEYS = new Set([
    'adminLogs', 'siteVisitLog', 'siteDeletedUsers', 'siteSettings', 'managedFiles'
]);
// 超级管理员专属写键：附属站点(/sub/)配置仅超级管理员可改，普通管理员不可写
const SUPER_ONLY_WRITE_KEYS = new Set(['siteSubsiteConfig']);
const SENSITIVE_USER_FIELDS = ['password', 'passwordHash', 'phone', 'email', 'securityQuestion', 'securityAnswer'];

function getSecret() {
    return process.env.SITE_ADMIN_TOKEN || 'PLEASE_SET_SITE_ADMIN_TOKEN_ENV';
}

function b64urlEncode(str) {
    return Buffer.from(str, 'utf8').toString('base64url');
}
function signPayload(payloadStr) {
    return crypto.createHmac('sha256', getSecret()).update(payloadStr).digest('base64url');
}

function readToken(req) {
    const direct = req.headers.get('x-site-token');
    if (direct) return String(direct).trim();
    const auth = req.headers.get('authorization') || '';
    if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
    return '';
}

// 校验签名与过期时间；失败返回 null
function verifyToken(token) {
    if (!token) return null;
    const parts = String(token).split('.');
    if (parts.length !== 2) return null;
    const expected = signPayload(parts[0]);
    const got = Buffer.from(parts[1]);
    const exp = Buffer.from(expected);
    if (got.length !== exp.length) return null;
    let ok = false;
    try { ok = crypto.timingSafeEqual(got, exp); } catch (e) { ok = false; }
    if (!ok) return null;
    let data = null;
    try {
        data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    } catch (e) {
        return null;
    }
    if (!data || !data.u) return null;
    if (data.exp && Date.now() > Number(data.exp)) return null;
    return data;
}

function isAdmin(session) {
    return !!session && (session.r === 'super_admin' || session.r === 'admin');
}

// 管理员读取 users 时只剔除口令类字段（password/passwordHash），保留手机号/邮箱等联系方式以支撑后台管理
const SECRET_USER_FIELDS = ['password', 'passwordHash'];

function stripUserSecrets(value) {
    let list = value;
    if (typeof list === 'string') {
        try { list = JSON.parse(list); } catch (e) { return value; }
    }
    if (!Array.isArray(list)) return value;
    return list.map(function (u) {
        const copy = {};
        Object.keys(u || {}).forEach(function (k) {
            if (SECRET_USER_FIELDS.indexOf(k) === -1) copy[k] = u[k];
        });
        copy.hasPassword = !!(u && (u.passwordHash || u.password));
        return copy;
    });
}

// 管理员整表写 users 时的口令保护：
// 前端口令一律拿不到，因此写回值里不可能带 passwordHash，这里逐条沿用云端原值，避免整表写把口令抹掉
async function preserveUserSecrets(store, incoming) {
    let list = incoming;
    if (typeof list === 'string') {
        try { list = JSON.parse(list); } catch (e) { return incoming; }
    }
    if (!Array.isArray(list)) return incoming;
    const existingRaw = await store.get('users', { type: 'json' });
    const existing = Array.isArray(existingRaw) ? existingRaw : [];
    const byName = {};
    existing.forEach(function (u) { if (u && u.username) byName[u.username] = u; });
    return list.map(function (u) {
        if (!u || !u.username) return u;
        const prev = byName[u.username];
        const next = Object.assign({}, u);
        delete next.password;
        if (prev && prev.passwordHash) {
            next.passwordHash = prev.passwordHash;
            if (prev.passwordUpdatedAt !== undefined) next.passwordUpdatedAt = prev.passwordUpdatedAt;
        } else if (next.passwordHash === undefined) {
            // 云端本就没有口令（如历史异常数据），不下发空哈希
            delete next.passwordHash;
        }
        next.hasPassword = !!next.passwordHash;
        return next;
    });
}

function sanitizeUsers(value) {
    let list = value;
    if (typeof list === 'string') {
        try { list = JSON.parse(list); } catch (e) { return value; }
    }
    if (!Array.isArray(list)) return value;
    const out = list.map(function (u) {
        const copy = {};
        Object.keys(u || {}).forEach(function (k) {
            if (SENSITIVE_USER_FIELDS.indexOf(k) === -1) copy[k] = u[k];
        });
        copy.hasPassword = !!(u && (u.passwordHash || u.password));
        return copy;
    });
    return out;
}

// 普通用户自助可改的字段白名单（role / accountId / createdAt 一律不可自改）
// 口令不在此列：口令只能通过 /api/auth 的 change-password 端点按哈希写入
const SELF_EDITABLE_USER_FIELDS = [
    'nickname', 'avatar', 'avatarUrl', 'phone', 'email', 'bio', 'gender', 'birthday',
    'signature', 'securityQuestion', 'securityAnswer', 'lastLogin', 'profileCompleted', 'updatedAt'
];

// 普通用户整表写 users 时的服务端字段级降级：
// 只允许把"自己"那条记录的白名单字段写进去，其它账号与敏感字段全部沿用云端原值。
// 返回 null 表示请求不合法（拒绝）；返回数组表示合并后的完整用户表。
async function mergeSelfOnlyUsers(store, session, incoming) {
    if (!session || !session.u) return null;
    let list = incoming;
    if (typeof list === 'string') {
        try { list = JSON.parse(list); } catch (e) { return null; }
    }
    if (!Array.isArray(list)) return null;
    const existingRaw = await store.get('users', { type: 'json' });
    const existing = Array.isArray(existingRaw) ? existingRaw : [];
    let mine = null;
    for (let i = 0; i < list.length; i++) {
        if (list[i] && list[i].username === session.u) { mine = list[i]; break; }
    }
    if (!mine) return null;
    let found = false;
    const merged = existing.map(function (u) {
        if (!u || u.username !== session.u) return u;
        found = true;
        const next = Object.assign({}, u);
        SELF_EDITABLE_USER_FIELDS.forEach(function (k) {
            if (Object.prototype.hasOwnProperty.call(mine, k) && mine[k] !== undefined && mine[k] !== '' && mine[k] !== null) {
                next[k] = mine[k];
            }
        });
        next.username = u.username;
        next.role = u.role;
        next.accountId = u.accountId;
        if (u.createdAt !== undefined) next.createdAt = u.createdAt;
        return next;
    });
    if (!found) return null;
    return merged;
}

function isAdminOnlyKey(key) {
    if (ADMIN_ONLY_KEYS.has(key)) return true;
    if (key.indexOf('userDevices_') === 0) return true;
    return false;
}

// 读侧的额外限制键：siteSettings 需要被登录页匿名读取（注册开关/密码规则），
// 因此读取时不要求管理员，但写入仍由 isAdminOnlyKey 拦住（只有管理员能改）
function isAdminOnlyReadKey(key) {
    if (READ_PUBLIC_WRITE_ADMIN_KEYS.has(key)) return false;
    return isAdminOnlyKey(key);
}

// 优先自动注入（官方零配置）；若运行时未注入 siteID/token，则用环境变量兜底
function openStore() {
    const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN;
    if (token) {
        return getStore({ name: 'site-data', consistency: 'strong', siteID: process.env.NETLIFY_SITE_ID, token: token });
    }
    return getStore({ name: 'site-data', consistency: 'strong' });
}

export default async function handler(req) {
    // OPTIONS 预检：直接放行
    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    const store = openStore();
    const session = verifyToken(readToken(req));

    try {
        if (req.method === 'GET') {
            const url = new URL(req.url);
            const key = url.searchParams.get('key');
            if (!key) {
                return Response.json({ ok: false, error: 'missing key' }, { status: 400, headers: corsHeaders });
            }
            const isPublic = PUBLIC_READ_KEYS.has(key) || READ_PUBLIC_WRITE_ADMIN_KEYS.has(key);
            if (!isPublic && !session) {
                return Response.json({ ok: false, error: 'unauthorized', needLogin: true }, { status: 401, headers: corsHeaders });
            }
            if (isAdminOnlyReadKey(key) && !isAdmin(session)) {
                return Response.json({ ok: false, error: 'forbidden' }, { status: 403, headers: corsHeaders });
            }
            const value = await store.get(key, { type: 'json' });
            let out = value === undefined ? null : value;
            // users：管理员只去掉口令字段，其他人一律脱敏，防止密码外泄
            if (key === 'users' && out !== null) {
                out = isAdmin(session) ? stripUserSecrets(out) : sanitizeUsers(out);
            }
            return Response.json({ ok: true, value: out }, { status: 200, headers: corsHeaders });
        }

        if (req.method === 'POST' || req.method === 'PUT') {
            if (!session) {
                return Response.json({ ok: false, error: 'unauthorized', needLogin: true }, { status: 401, headers: corsHeaders });
            }
            let payload;
            try {
                payload = await req.json();
            } catch (e) {
                return Response.json({ ok: false, error: 'invalid JSON body' }, { status: 400, headers: corsHeaders });
            }
            const writeKey = payload.key;
            if (!writeKey) {
                return Response.json({ ok: false, error: 'missing key' }, { status: 400, headers: corsHeaders });
            }
            const writeValue = payload.value;
            // 用户表：管理员可整表写；普通用户只能改动自己那条记录的白名单字段，
            // 其余记录沿用云端原值，防止越权改角色/改他人密码/植入新账号
            if (writeKey === 'users' && !isAdmin(session)) {
                const merged = await mergeSelfOnlyUsers(store, session, writeValue);
                if (!merged) {
                    return Response.json({ ok: false, error: 'forbidden' }, { status: 403, headers: corsHeaders });
                }
                if (merged.length === 0) {
                    await store.delete('users');
                } else {
                    await store.setJSON('users', merged);
                }
                return Response.json({ ok: true, value: { restricted: 'self-only' } }, { status: 200, headers: corsHeaders });
            }
            // 审计与设备类键的写入仅限管理员
            if (isAdminOnlyKey(writeKey) && !isAdmin(session)) {
                return Response.json({ ok: false, error: 'forbidden' }, { status: 403, headers: corsHeaders });
            }
            // 附属站点配置：仅超级管理员可写
            if (SUPER_ONLY_WRITE_KEYS.has(writeKey) && (!session || session.r !== 'super_admin')) {
                return Response.json({ ok: false, error: 'super admin required' }, { status: 403, headers: corsHeaders });
            }
            // 管理员整表写 users：口令列一律沿用云端原值（前端拿不到口令，整表写不得成为改口令或抹口令的旁路）
            let finalValue = writeValue;
            if (writeKey === 'users' && isAdmin(session) && writeValue !== null && writeValue !== undefined) {
                finalValue = await preserveUserSecrets(store, writeValue);
            }
            if (finalValue === null || finalValue === undefined) {
                await store.delete(writeKey);
            } else {
                await store.setJSON(writeKey, finalValue);
            }
            return Response.json({ ok: true }, { status: 200, headers: corsHeaders });
        }

        return Response.json({ ok: false, error: 'method not allowed' }, { status: 405, headers: corsHeaders });
    } catch (err) {
        return Response.json({ ok: false, error: String((err && err.message) || err) }, { status: 500, headers: corsHeaders });
    }
}
