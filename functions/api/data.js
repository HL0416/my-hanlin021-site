// 通用 JSON KV 读写端点（Cloudflare Pages Functions + Workers KV）
// 与 netlify/functions/data.js 行为完全等价，客户端无需区分平台。
//
// GET     /api/data?key=xxx   -> { ok: true, value: <json|null> }（缺失返回 value: null）
// POST    /api/data           body { key, value } -> { ok: true }（value 为 null/undefined 视为删除该键）
// PUT     /api/data           body { key, value } -> { ok: true }
// OPTIONS 预检，返回 CORS 头
//
// KV 命名空间通过环境变量绑定访问：env.SITE_DATA
// 绑定配置见仓库根目录 wrangler.toml 中的 [[kv_namespaces]]（binding = "SITE_DATA"）

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
};

function jsonResponse(body, status) {
    return new Response(JSON.stringify(body), {
        status: status || 200,
        headers: Object.assign({
            'Content-Type': 'application/json; charset=utf-8',
            // 数据接口禁止任何中间层/浏览器缓存，保证跨设备看到最新数据
            'Cache-Control': 'no-store, no-cache, must-revalidate'
        }, corsHeaders)
    });
}

export async function onRequest(context) {
    const { request, env } = context;
    const method = request.method.toUpperCase();

    // OPTIONS 预检：直接放行
    if (method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    const store = env && env.SITE_DATA;
    if (!store) {
        return jsonResponse({ ok: false, error: 'KV binding SITE_DATA missing (check wrangler.toml)' }, 500);
    }

    try {
        if (method === 'GET') {
            const url = new URL(request.url);
            const key = url.searchParams.get('key');
            if (!key) {
                return jsonResponse({ ok: false, error: 'missing key' }, 400);
            }
            const value = await store.get(key, { type: 'json' });
            // 缺失返回 null（而非报错），与 Netlify Blobs 版本保持一致
            return jsonResponse({ ok: true, value: value === undefined ? null : value }, 200);
        }

        if (method === 'POST' || method === 'PUT') {
            let payload;
            try {
                payload = await request.json();
            } catch (e) {
                return jsonResponse({ ok: false, error: 'invalid JSON body' }, 400);
            }
            const writeKey = payload && payload.key;
            if (!writeKey) {
                return jsonResponse({ ok: false, error: 'missing key' }, 400);
            }
            const writeValue = payload.value;
            if (writeValue === null || writeValue === undefined) {
                await store.delete(writeKey);
            } else {
                await store.put(writeKey, JSON.stringify(writeValue));
            }
            return jsonResponse({ ok: true }, 200);
        }

        return jsonResponse({ ok: false, error: 'method not allowed' }, 405);
    } catch (err) {
        return jsonResponse({ ok: false, error: String((err && err.message) || err) }, 500);
    }
}
