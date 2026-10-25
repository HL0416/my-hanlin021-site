// 通用 JSON KV 读写端点（Netlify Functions + Blobs 云端存储）
// GET   /.netlify/functions/data?key=xxx   -> { ok: true, value: <json|null> }（缺失返回 value: null）
// POST  /.netlify/functions/data            body { key, value } -> { ok: true }（value 为 null 视为删除该键）
// PUT   /.netlify/functions/data            body { key, value } -> { ok: true }
// OPTIONS 预检，返回 CORS 头
import { getStore } from '@netlify/blobs';

const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8'
};

export const handler = async function (event) {
    // OPTIONS 预检：直接放行
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: headers, body: '' };
    }

    // Functions 内 siteID/token 自动注入，无需手传
    const store = getStore({ name: 'site-data', consistency: 'strong' });

    try {
        if (event.httpMethod === 'GET') {
            const key = event.queryStringParameters && event.queryStringParameters.key;
            if (!key) {
                return { statusCode: 400, headers: headers, body: JSON.stringify({ ok: false, error: 'missing key' }) };
            }
            const value = await store.get(key, { type: 'json' });
            // 缺失返回 null（而非报错）
            return { statusCode: 200, headers: headers, body: JSON.stringify({ ok: true, value: value === undefined ? null : value }) };
        }

        if (event.httpMethod === 'POST' || event.httpMethod === 'PUT') {
            let payload;
            try {
                payload = JSON.parse(event.body || '{}');
            } catch (e) {
                return { statusCode: 400, headers: headers, body: JSON.stringify({ ok: false, error: 'invalid JSON body' }) };
            }
            const writeKey = payload.key;
            if (!writeKey) {
                return { statusCode: 400, headers: headers, body: JSON.stringify({ ok: false, error: 'missing key' }) };
            }
            const writeValue = payload.value;
            if (writeValue === null || writeValue === undefined) {
                await store.delete(writeKey);
            } else {
                await store.setJSON(writeKey, writeValue);
            }
            return { statusCode: 200, headers: headers, body: JSON.stringify({ ok: true }) };
        }

        return { statusCode: 405, headers: headers, body: JSON.stringify({ ok: false, error: 'method not allowed' }) };
    } catch (err) {
        return { statusCode: 500, headers: headers, body: JSON.stringify({ ok: false, error: String(err && err.message || err) }) };
    }
};
