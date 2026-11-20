/**
 * comix.to reverse proxy for the Paperback key sync.
 *
 * GitHub Actions egresses from Azure ranges, which comix.to answers with a
 * Cloudflare "Just a moment..." challenge. Deploying this Worker gives the sync
 * a transport that it controls, instead of relying on public readers.
 *
 * Contract (see scripts/sync-comix-key.js):
 *   https://<worker>/?url=<encoded comix.to url>      (recommended, keeps query strings)
 *   https://<worker>/<https://comix.to/path>          (prefix form, drops the target query)
 *
 * Safeguards: GET/HEAD only, comix.to hosts only, no cookies, no caching, and an
 * optional shared token (PROXY_TOKEN) compared against `?token=` or
 * `x-proxy-token`.
 */

const ALLOWED_HOST = /(^|\.)comix\.to$/i;
const BROWSER_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const CORS_HEADERS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS'
};

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return new Response('method not allowed', { status: 405, headers: CORS_HEADERS });
        }
        if (env.PROXY_TOKEN) {
            const inbound = new URL(request.url);
            const provided = request.headers.get('x-proxy-token') || inbound.searchParams.get('token');
            if (provided !== env.PROXY_TOKEN) {
                return new Response('forbidden', { status: 403, headers: CORS_HEADERS });
            }
        }

        let target;
        try {
            target = resolveTarget(new URL(request.url));
        } catch (err) {
            return new Response(`bad target: ${err.message}`, { status: 400, headers: CORS_HEADERS });
        }

        let upstream;
        try {
            upstream = await fetch(target, {
                method: request.method,
                headers: {
                    'User-Agent': BROWSER_UA,
                    Accept: request.headers.get('accept') || '*/*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    Referer: 'https://comix.to/',
                    // Identity keeps the relayed body and headers consistent;
                    // the sync decompresses archived bodies itself anyway.
                    'Accept-Encoding': 'identity'
                },
                redirect: 'follow',
                cf: { cacheTtl: 0, cacheEverything: false }
            });
        } catch (err) {
            return new Response(`upstream error: ${err.message}`, { status: 502, headers: CORS_HEADERS });
        }

        const headers = new Headers(upstream.headers);
        headers.delete('content-encoding');
        headers.delete('content-length');
        headers.delete('set-cookie');
        headers.set('x-comix-proxy', '1');
        for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);

        return new Response(request.method === 'HEAD' ? null : upstream.body, {
            status: upstream.status,
            headers
        });
    }
};

function resolveTarget(inbound) {
    let raw = inbound.searchParams.get('url') || inbound.searchParams.get('u');
    if (!raw) {
        // Prefix form: https://<worker>/https://comix.to/assets/...
        raw = inbound.pathname.replace(/^\/+/, '');
        try {
            raw = decodeURIComponent(raw);
        } catch (_) {
            throw new Error('path is not valid percent-encoding');
        }
    }
    raw = String(raw).trim();
    if (!raw) throw new Error('missing target url');
    if (raw.startsWith('//')) raw = 'https:' + raw;
    if (!/^https:\/\//i.test(raw)) throw new Error('only absolute https targets are allowed');

    const parsed = new URL(raw);
    if (!ALLOWED_HOST.test(parsed.hostname)) throw new Error(`host not allowed: ${parsed.hostname}`);
    return parsed.href;
}
