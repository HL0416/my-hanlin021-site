// 通用 JSON KV 读写端点（Netlify Functions v2 + Blobs 云端存储）
// GET   /.netlify/functions/data?key=xxx   -> { ok: true, value: <json|null> }（缺失返回 value: null）
// POST  /.netlify/functions/data            body { key, value } -> { ok: true }（value 为 null 视为删除该键）
// PUT   /.netlify/functions/data            body { key, value } -> { ok: true }
// OPTIONS 预检，返回 CORS 头
import { getStore } from '@netlify/blobs';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
};

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

    try {
        if (req.method === 'GET') {
            const url = new URL(req.url);
            const key = url.searchParams.get('key');
            if (!key) {
                return Response.json({ ok: false, error: 'missing key' }, { status: 400, headers: corsHeaders });
            }
            const value = await store.get(key, { type: 'json' });
            // 缺失返回 null（而非报错）
            return Response.json({ ok: true, value: value === undefined ? null : value }, { status: 200, headers: corsHeaders });
        }

        if (req.method === 'POST' || req.method === 'PUT') {
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
            if (writeValue === null || writeValue === undefined) {
                await store.delete(writeKey);
            } else {
                await store.setJSON(writeKey, writeValue);
            }
            return Response.json({ ok: true }, { status: 200, headers: corsHeaders });
        }

        return Response.json({ ok: false, error: 'method not allowed' }, { status: 405, headers: corsHeaders });
    } catch (err) {
        return Response.json({ ok: false, error: String(err && err.message || err) }, { status: 500, headers: corsHeaders });
    }
}
