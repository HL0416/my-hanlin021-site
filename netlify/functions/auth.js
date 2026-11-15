// 登录 / 注册 / 会话校验端点（Netlify Functions v2 + Blobs）
// POST /.netlify/functions/auth
//   { action: 'login',    account, password }  -> { ok, token, user:{username,role,accountId,nickname}, expiresAt }
//   { action: 'register', username, password, nickname? } -> { ok, token, user }
//   { action: 'verify',   token }              -> { ok, user }
// token 为 HMAC-SHA256 签名的无状态令牌，密钥取环境变量 SITE_ADMIN_TOKEN
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-site-token'
};

const TOKEN_TTL = 1000 * 60 * 60 * 12; // 12 小时

// ——— 口令存储：PBKDF2-SHA256 加盐哈希（禁止再落明文口令）———
const PBKDF2_ITERATIONS = 210000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';
const MIN_PASSWORD_LENGTH = 8;
const SUPER_ADMIN_USERNAME = 'admin';
function isWeakPolicyExempt(username) {
    return String(username == null ? '' : username).trim().toLowerCase() === SUPER_ADMIN_USERNAME;
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const dk = crypto.pbkdf2Sync(String(password), salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
    return 'pbkdf2$' + PBKDF2_ITERATIONS + '$' + salt.toString('base64url') + '$' + dk.toString('base64url');
}

function verifyHash(password, stored) {
    const parts = String(stored || '').split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
    const iter = Number(parts[1]);
    if (!Number.isFinite(iter) || iter <= 0) return false;
    let salt;
    let expected;
    try {
        salt = Buffer.from(parts[2], 'base64url');
        expected = Buffer.from(parts[3], 'base64url');
    } catch (e) {
        return false;
    }
    if (expected.length !== PBKDF2_KEYLEN) return false;
    let dk;
    try {
        dk = crypto.pbkdf2Sync(String(password), salt, iter, expected.length, PBKDF2_DIGEST);
    } catch (e) {
        return false;
    }
    try {
        return crypto.timingSafeEqual(dk, expected);
    } catch (e) {
        return false;
    }
}

// 返回 { ok, legacy }：legacy=true 表示命中的是尚未升级的旧明文口令
function checkPassword(user, password) {
    if (!user) return { ok: false, legacy: false };
    const stored = String(user.passwordHash || '');
    if (stored) {
        return { ok: verifyHash(password, stored), legacy: false };
    }
    const plain = user.password == null ? '' : String(user.password);
    if (plain && plain === String(password == null ? '' : password)) {
        return { ok: true, legacy: true };
    }
    return { ok: false, legacy: false };
}

function isStrongPassword(p) {
    const s = String(p || '');
    if (s.length < MIN_PASSWORD_LENGTH) return false;
    if (/^\d+$/.test(s)) return false;
    if (/^[A-Za-z]+$/.test(s)) return false;
    return true;
}

// 写入哈希并彻底清除明文口令字段
function applyPassword(user, password) {
    user.passwordHash = hashPassword(password);
    delete user.password;
    user.passwordUpdatedAt = Date.now();
}

function getSecret() {
    return process.env.SITE_ADMIN_TOKEN || 'PLEASE_SET_SITE_ADMIN_TOKEN_ENV';
}

function signPayload(payloadStr) {
    return crypto.createHmac('sha256', getSecret()).update(payloadStr).digest('base64url');
}

function issueToken(user) {
    const payload = {
        u: user.username,
        r: user.role || 'user',
        exp: Date.now() + TOKEN_TTL
    };
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return body + '.' + signPayload(body);
}

function verifyToken(token) {
    if (!token) return null;
    const parts = String(token).split('.');
    if (parts.length !== 2) return null;
    const expected = Buffer.from(signPayload(parts[0]));
    const got = Buffer.from(parts[1]);
    if (expected.length !== got.length) return null;
    let ok = false;
    try { ok = crypto.timingSafeEqual(expected, got); } catch (e) { ok = false; }
    if (!ok) return null;
    let data = null;
    try { data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch (e) { return null; }
    if (!data || !data.u) return null;
    if (data.exp && Date.now() > Number(data.exp)) return null;
    return data;
}

function openStore() {
    const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN;
    if (token) {
        return getStore({ name: 'site-data', consistency: 'strong', siteID: process.env.NETLIFY_SITE_ID, token: token });
    }
    return getStore({ name: 'site-data', consistency: 'strong' });
}

async function readUsers(store) {
    let value = await store.get('users', { type: 'json' });
    if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch (e) { value = []; }
    }
    return Array.isArray(value) ? value : [];
}

function findUser(users, account) {
    const acc = String(account || '').trim();
    if (!acc) return null;
    const lower = acc.toLowerCase();
    let found = users.find(function (u) { return u && u.username === acc; });
    if (found) return found;
    found = users.find(function (u) { return u && u.accountId && String(u.accountId).toLowerCase() === lower; });
    if (found) return found;
    found = users.find(function (u) { return u && u.phone && String(u.phone) === acc; });
    if (found) return found;
    found = users.find(function (u) { return u && u.email && String(u.email).toLowerCase() === lower; });
    return found || null;
}

function publicUser(u) {
    return {
        username: u.username,
        role: u.role || 'user',
        accountId: u.accountId || '',
        nickname: u.nickname || ''
    };
}

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (req.method !== 'POST') {
        return Response.json({ ok: false, error: 'method not allowed' }, { status: 405, headers: corsHeaders });
    }
    let body;
    try {
        body = await req.json();
    } catch (e) {
        return Response.json({ ok: false, error: 'invalid JSON body' }, { status: 400, headers: corsHeaders });
    }
    const action = body && body.action;
    const store = openStore();

    try {
        if (action === 'verify') {
            const data = verifyToken(body.token);
            if (!data) {
                return Response.json({ ok: false, error: 'invalid token' }, { status: 401, headers: corsHeaders });
            }
            return Response.json({ ok: true, user: { username: data.u, role: data.r } }, { status: 200, headers: corsHeaders });
        }

        if (action === 'login') {
            const users = await readUsers(store);

            // 首次部署引导：云端用户表中没有管理员时，用环境变量建立初始超管（口令同样以哈希存储）
            const bootstrapPwd = process.env.SITE_BOOTSTRAP_ADMIN_PASSWORD || '';
            if (bootstrapPwd && !users.some(function (u) { return u && u.username === 'admin'; })) {
                const bootAdmin = {
                    username: 'admin',
                    role: 'super_admin',
                    accountId: '1000',
                    createdAt: Date.now()
                };
                applyPassword(bootAdmin, bootstrapPwd);
                users.push(bootAdmin);
                await store.setJSON('users', users);
            }

            const user = findUser(users, body.account);
            const check = checkPassword(user, body.password);
            if (!user || !check.ok) {
                return Response.json({ ok: false, error: '账号或密码错误' }, { status: 401, headers: corsHeaders });
            }

            // 旧明文口令首次登录即自动升级为哈希，并抹掉明文
            let migrated = false;
            if (check.legacy || !user.passwordHash) {
                applyPassword(user, body.password);
                await store.setJSON('users', users);
                migrated = true;
            }

            // 弱口令（旧默认 admin / 纯数字 / 纯字母 / 少于 8 位）要求登录后立即改密
            const mustChangePassword = !isWeakPolicyExempt(user && user.username) && !isStrongPassword(body.password);
            return Response.json({
                ok: true,
                token: issueToken(user),
                user: publicUser(user),
                expiresAt: Date.now() + TOKEN_TTL,
                passwordMigrated: migrated,
                mustChangePassword: mustChangePassword
            }, { status: 200, headers: corsHeaders });
        }

        if (action === 'register') {
            const username = String(body.username || '').trim();
            const password = String(body.password || '');
            if (!username || username.length > 6) {
                return Response.json({ ok: false, error: '用户名需为 1-6 个字符' }, { status: 400, headers: corsHeaders });
            }
            if (/^\d{6,}$/.test(username) || username.indexOf('@') !== -1) {
                return Response.json({ ok: false, error: '用户名不能是手机号或邮箱格式' }, { status: 400, headers: corsHeaders });
            }
            if (!isStrongPassword(password)) {
                return Response.json({ ok: false, error: '密码至少 8 位，且不能是纯数字或纯字母' }, { status: 400, headers: corsHeaders });
            }
            const users = await readUsers(store);
            if (users.some(function (u) { return u && u.username === username; })) {
                return Response.json({ ok: false, error: '该用户名已存在' }, { status: 409, headers: corsHeaders });
            }
            const phone = String(body.phone || '').trim();
            const email = String(body.email || '').trim();
            if (phone && users.some(function (u) { return u && u.phone === phone; })) {
                return Response.json({ ok: false, error: '该手机号已被注册' }, { status: 409, headers: corsHeaders });
            }
            if (email && users.some(function (u) { return u && u.email && String(u.email).toLowerCase() === email.toLowerCase(); })) {
                return Response.json({ ok: false, error: '该邮箱已被注册' }, { status: 409, headers: corsHeaders });
            }
            const maxId = users.reduce(function (m, u) {
                const n = Number(u && u.accountId);
                return Number.isFinite(n) && n > m ? n : m;
            }, 1000);
            const newUser = {
                username: username,
                nickname: String(body.nickname || '').trim(),
                role: 'user',
                accountId: String(maxId + 1),
                phone: phone,
                email: email,
                createdAt: Date.now()
            };
            applyPassword(newUser, password);
            users.push(newUser);
            await store.setJSON('users', users);
            return Response.json({
                ok: true,
                token: issueToken(newUser),
                user: publicUser(newUser),
                expiresAt: Date.now() + TOKEN_TTL
            }, { status: 200, headers: corsHeaders });
        }

        // 管理员创建账号：口令由服务端加盐哈希后入库，前端不再向 users 表直写 password
        if (action === 'admin-create-user') {
            const data = verifyToken(body.token);
            if (!data) {
                return Response.json({ ok: false, error: '登录状态已失效，请重新登录' }, { status: 401, headers: corsHeaders });
            }
            if (data.r !== 'super_admin' && data.r !== 'admin') {
                return Response.json({ ok: false, error: '无权限创建账号' }, { status: 403, headers: corsHeaders });
            }
            const username = String(body.username || '').trim();
            const password = String(body.password || '');
            const nickname = String(body.nickname || '').trim();
            let role = String(body.role || 'user');
            if (role !== 'super_admin' && role !== 'admin' && role !== 'user') role = 'user';
            if (role === 'super_admin' && data.r !== 'super_admin') {
                return Response.json({ ok: false, error: '仅超级管理员可创建超级管理员' }, { status: 403, headers: corsHeaders });
            }
            if (!username || username.length > 6) {
                return Response.json({ ok: false, error: '用户名需为 1-6 个字符' }, { status: 400, headers: corsHeaders });
            }
            if (/^\d{6,}$/.test(username) || username.indexOf('@') !== -1) {
                return Response.json({ ok: false, error: '用户名不能是手机号或邮箱格式' }, { status: 400, headers: corsHeaders });
            }
            if (!isStrongPassword(password)) {
                return Response.json({ ok: false, error: '密码至少 8 位，且不能是纯数字或纯字母' }, { status: 400, headers: corsHeaders });
            }
            const users = await readUsers(store);
            if (users.some(function (u) { return u && u.username === username; })) {
                return Response.json({ ok: false, error: '该用户名已存在' }, { status: 409, headers: corsHeaders });
            }
            const maxId = users.reduce(function (m, u) {
                const n = Number(u && u.accountId);
                return Number.isFinite(n) && n > m ? n : m;
            }, 1000);
            const newUser = {
                username: username,
                nickname: nickname,
                role: role,
                accountId: String(maxId + 1),
                createdAt: Date.now()
            };
            applyPassword(newUser, password);
            users.push(newUser);
            await store.setJSON('users', users);
            return Response.json({ ok: true, user: publicUser(newUser) }, { status: 200, headers: corsHeaders });
        }

        // 登录用户改密：旧口令校验 + 新口令强度校验，成功后就地升级为哈希
        if (action === 'change-password') {
            const data = verifyToken(body.token);
            if (!data) {
                return Response.json({ ok: false, error: '登录状态已失效，请重新登录' }, { status: 401, headers: corsHeaders });
            }
            const users = await readUsers(store);
            const user = users.find(function (u) { return u && u.username === data.u; });
            if (!user) {
                return Response.json({ ok: false, error: '账号不存在' }, { status: 404, headers: corsHeaders });
            }
            const check = checkPassword(user, body.oldPassword);
            if (!check.ok) {
                return Response.json({ ok: false, error: '原密码错误' }, { status: 401, headers: corsHeaders });
            }
            const newPassword = String(body.newPassword || '');
            if (isWeakPolicyExempt(data && data.u) ? (newPassword.length < 3) : !isStrongPassword(newPassword)) {
                return Response.json({ ok: false, error: '新口令至少 8 位，且不能是纯数字或纯字母' }, { status: 400, headers: corsHeaders });
            }
            if (String(body.oldPassword || '') === newPassword) {
                return Response.json({ ok: false, error: '新口令不能与旧口令相同' }, { status: 400, headers: corsHeaders });
            }
            applyPassword(user, newPassword);
            await store.setJSON('users', users);
            return Response.json({
                ok: true,
                token: issueToken(user),
                user: publicUser(user),
                expiresAt: Date.now() + TOKEN_TTL
            }, { status: 200, headers: corsHeaders });
        }

        // 二次身份确认（如注销账号前验证当前登录用户的密码）
        if (action === 'verify-password') {
            const data = verifyToken(body.token);
            if (!data) {
                return Response.json({ ok: false, error: '登录状态已失效，请重新登录' }, { status: 401, headers: corsHeaders });
            }
            const users = await readUsers(store);
            const user = users.find(function (u) { return u && u.username === data.u; });
            const check = checkPassword(user, body.password);
            return Response.json({ ok: check.ok }, { status: check.ok ? 200 : 401, headers: corsHeaders });
        }

        // 管理员重置他人口令（忘记密码的唯一入口，需管理员会话）
        if (action === 'admin-reset-password') {
            const data = verifyToken(body.token);
            const isAdmin = !!(data && (data.r === 'super_admin' || data.r === 'admin'));
            if (!isAdmin) {
                return Response.json({ ok: false, error: '需要管理员权限' }, { status: 403, headers: corsHeaders });
            }
            const target = String(body.username || '').trim();
            const newPassword = String(body.newPassword || '');
            if (isWeakPolicyExempt(target) ? (newPassword.length < 3) : !isStrongPassword(newPassword)) {
                return Response.json({ ok: false, error: '新口令至少 8 位，且不能是纯数字或纯字母' }, { status: 400, headers: corsHeaders });
            }
            const users = await readUsers(store);
            const user = users.find(function (u) { return u && u.username === target; });
            if (!user) {
                return Response.json({ ok: false, error: '账号不存在' }, { status: 404, headers: corsHeaders });
            }
            applyPassword(user, newPassword);
            await store.setJSON('users', users);
            return Response.json({ ok: true }, { status: 200, headers: corsHeaders });
        }

        return Response.json({ ok: false, error: 'unknown action' }, { status: 400, headers: corsHeaders });
    } catch (err) {
        return Response.json({ ok: false, error: String((err && err.message) || err) }, { status: 500, headers: corsHeaders });
    }
}
