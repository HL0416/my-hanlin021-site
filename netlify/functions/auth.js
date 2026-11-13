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

            // 首次部署引导：云端用户表中没有管理员时，用环境变量建立初始超管（避免源码写死口令）
            const bootstrapPwd = process.env.SITE_BOOTSTRAP_ADMIN_PASSWORD || '';
            if (bootstrapPwd && !users.some(function (u) { return u && u.username === 'admin'; })) {
                users.push({
                    username: 'admin',
                    password: bootstrapPwd,
                    role: 'super_admin',
                    accountId: '1000',
                    createdAt: Date.now()
                });
                await store.setJSON('users', users);
            }
            const user = findUser(users, body.account);
            if (!user || user.password !== body.password) {
                return Response.json({ ok: false, error: '账号或密码错误' }, { status: 401, headers: corsHeaders });
            }
            return Response.json({
                ok: true,
                token: issueToken(user),
                user: publicUser(user),
                expiresAt: Date.now() + TOKEN_TTL
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
            if (password.length < 4) {
                return Response.json({ ok: false, error: '密码至少 4 位' }, { status: 400, headers: corsHeaders });
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
                password: password,
                nickname: String(body.nickname || '').trim(),
                role: 'user',
                accountId: String(maxId + 1),
                phone: phone,
                email: email,
                createdAt: Date.now()
            };
            users.push(newUser);
            await store.setJSON('users', users);
            return Response.json({
                ok: true,
                token: issueToken(newUser),
                user: publicUser(newUser),
                expiresAt: Date.now() + TOKEN_TTL
            }, { status: 200, headers: corsHeaders });
        }

        return Response.json({ ok: false, error: 'unknown action' }, { status: 400, headers: corsHeaders });
    } catch (err) {
        return Response.json({ ok: false, error: String((err && err.message) || err) }, { status: 500, headers: corsHeaders });
    }
}
