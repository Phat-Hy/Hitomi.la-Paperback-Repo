#!/usr/bin/env node
/**
 * Comix Signing Key Auto-Sync & Verification
 * ------------------------------------------
 * Workflow:
 *   1. Reads comix_keys.json from the repository root.
 *   2. Tests the current key against https://comix.to/api/v1/manga?limit=20&page=1
 *   3. If the key is retired (or unverifiable and the published build carries a
 *      different key), it scrapes https://comix.to/ -> main-*.js -> apicore-*.js,
 *      runs the obfuscated key generator inside a Node VM and extracts
 *      { VERSION, 1088-byte KEY }.
 *   4. Writes comix_keys.json (+ bundles/comix_keys.json) and emits GitHub
 *      Actions outputs so the workflow can commit and deploy to gh-pages.
 *
 * Transport
 * ---------
 * comix.to sits behind Cloudflare, which serves a "Just a moment..." challenge
 * to datacenter IP ranges (GitHub Actions / Azure). Direct requests therefore
 * fail even though the site is up. Every request goes through a provider chain
 * and the first provider returning a *validated* payload wins:
 *
 *   html : direct -> proxy -> translate -> jina -> wayback
 *   js   : direct -> proxy -> translate -> wayback
 *   json : direct -> translate -> jina -> proxy
 *
 *   direct    Node https, then curl (full HTTP/2 + browser ALPN on runners).
 *   proxy     COMIX_PROXY_URL, a user supplied reverse proxy (Cloudflare
 *             Worker, Vercel function, ...). Supports {url} / {url_encoded}
 *             placeholders, otherwise used as a plain prefix.
 *   translate comix.to -> comix-to.translate.goog (Google fetches server side,
 *             returns byte-identical HTML, JS assets and — with a valid signed
 *             token — the JSON API; origin failures surface as a 400 page).
 *   jina      https://r.jina.ai/<url> reader; rendered HTML or raw JSON text.
 *   wayback   Internet Archive snapshot (archive.org/wayback/available + id_),
 *             last resort; content is byte-identical but may lag a deploy and
 *             is replayed with its original content-encoding.
 *
 * Every response is validated before it is trusted (Cloudflare challenge pages,
 * short bodies and non-JS payloads are rejected), so a broken transport falls
 * through to the next provider instead of corrupting the key.
 *
 * Flags / environment
 * -------------------
 *   --force              Rotate even when the current key still verifies.
 *   --no-direct          Skip the direct provider (simulates an Azure runner).
 *   --selftest           Probe every provider and print a table, then exit.
 *   COMIX_PROXY_URL      Reverse proxy template for the "proxy" provider.
 *   COMIX_PROVIDERS      Comma separated provider override, e.g. "translate,wayback".
 *   COMIX_FORCE_ROTATE=1 Same as --force.
 *   COMIX_NO_DIRECT=1    Same as --no-direct.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const vm = require('vm');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const KEYS_PATH = path.join(ROOT_DIR, 'comix_keys.json');
const BUNDLES_KEYS_PATH = path.join(ROOT_DIR, 'bundles', 'comix_keys.json');
const REPORT_PATH = path.join(ROOT_DIR, 'comix-sync-report.json');

const SITE = 'https://comix.to';
const API_PATH = '/manga?limit=20&page=1';
const PAGES_KEY_URL = 'https://phat-hy.github.io/Hitomi.la-Paperback-Repo/comix_keys.json';
const KEY_LENGTH = 1088;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BASE_HEADERS = {
    'User-Agent': UA,
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://comix.to/'
};

const ARGV = new Set(process.argv.slice(2));
const truthy = (value) => /^(1|true|yes)$/i.test(String(value || '').trim());
const FORCE = ARGV.has('--force') || truthy(process.env.COMIX_FORCE_ROTATE);
const NO_DIRECT = ARGV.has('--no-direct') || truthy(process.env.COMIX_NO_DIRECT);
const SELFTEST = ARGV.has('--selftest');

const transportLog = [];
let sawChallenge = false;
const startedAt = new Date();

// ---------------------------------------------------------------------------
// small utilities
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stripPrefix(value) {
    return String(value).replace(/^\[(?:Sync|Selftest)\]\s*/, '');
}

function log(...args) {
    if (args.length > 0) args[0] = stripPrefix(args[0]);
    console.log('[Sync]', ...args);
}

function warn(...args) {
    if (args.length > 0) args[0] = stripPrefix(args[0]);
    console.warn('[Sync]', ...args);
}

/** Keep signed `_=` tokens out of logs. */
function redact(url) {
    return String(url).replace(/([?&]_=)[^&]+/, '$1<token>');
}

function clip(value, max = 120) {
    return String(value || '').replace(/\s+/g, ' ').slice(0, max);
}

// ---------------------------------------------------------------------------
// raw HTTP
// ---------------------------------------------------------------------------

/**
 * Minimal https GET with redirect support and a hard timeout. Returns
 * { status, data, headers } and never hangs the job on a stalled socket.
 *
 * The body is decoded transparently: the Internet Archive replays archived
 * payloads with their original `content-encoding`, so a snapshot can arrive as
 * raw gzip/brotli bytes even though no Accept-Encoding header was sent.
 */
function httpsGet(url, headers = {}, { timeoutMs = 20000, redirects = 3 } = {}) {
    return new Promise((resolve, reject) => {
        let target;
        try {
            target = new URL(url);
        } catch (err) {
            reject(err);
            return;
        }
        if (target.protocol !== 'https:') {
            reject(new Error(`refusing non-https url: ${target.protocol}`));
            return;
        }

        const req = https.get(
            {
                hostname: target.hostname,
                port: target.port || 443,
                path: target.pathname + target.search,
                headers: { ...BASE_HEADERS, ...headers },
                timeout: timeoutMs
            },
            (res) => {
                const status = res.statusCode || 0;
                if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
                    res.resume();
                    const next = new URL(res.headers.location, target).href;
                    httpsGet(next, headers, { timeoutMs, redirects: redirects - 1 }).then(resolve, reject);
                    return;
                }
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const body = decodeBody(Buffer.concat(chunks), res.headers['content-encoding']);
                    resolve({ status, data: body, headers: res.headers });
                });
                res.on('error', reject);
            }
        );
        req.on('timeout', () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
        req.on('error', reject);
    });
}

/**
 * Transparently inflate gzip/deflate/brotli bodies.
 *
 * The declared `content-encoding` is authoritative; gzip is also sniffed from
 * its magic bytes because the Internet Archive replays archived payloads
 * already-compressed while sometimes dropping the header.
 */
function decodeBody(buffer, contentEncoding) {
    if (!buffer || buffer.length === 0) return '';
    const encoding = String(contentEncoding || '').toLowerCase().trim();

    const gzipped = encoding === 'gzip' || encoding === 'x-gzip' ||
        (buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b);

    try {
        if (gzipped) return zlib.gunzipSync(buffer).toString('utf8');
        if (encoding === 'br') return zlib.brotliDecompressSync(buffer).toString('utf8');
        if (encoding === 'deflate') return zlib.inflateSync(buffer).toString('utf8');
    } catch (err) {
        warn(`[Sync] could not inflate a ${encoding || 'gzip'} body: ${err.message}`);
    }
    return buffer.toString('utf8');
}

/**
 * curl fallback. Uses spawnSync with an argument array (no shell), so URLs can
 * never be interpreted as shell syntax. curl has a modern TLS stack on the
 * GitHub runners, which occasionally clears Cloudflare where Node cannot.
 */
function curlGet(url, headers = {}, { timeoutSec = 20 } = {}) {
    if (/["\r\n]/.test(url)) return null;
    const args = ['-sS', '-L', '--compressed', '--max-time', String(timeoutSec), '-o', '-', '-w', '\n%{http_code}'];
    for (const [key, value] of Object.entries({ ...BASE_HEADERS, ...headers })) {
        if (value === undefined || value === null) continue;
        args.push('-H', `${key}: ${value}`);
    }
    args.push(url);

    const result = spawnSync('curl', args, {
        encoding: 'utf8',
        maxBuffer: 24 * 1024 * 1024,
        timeout: (timeoutSec + 5) * 1000,
        windowsHide: true
    });
    if (result.error || typeof result.stdout !== 'string' || !result.stdout) return null;

    const split = result.stdout.lastIndexOf('\n');
    if (split === -1) return null;
    const status = parseInt(result.stdout.slice(split + 1).trim(), 10);
    if (isNaN(status)) return null;
    return { status, data: result.stdout.slice(0, split), headers: {} };
}

// ---------------------------------------------------------------------------
// response validation
// ---------------------------------------------------------------------------

const CHALLENGE_MARKERS = [
    'Just a moment...',
    'cf-mitigated',
    'Attention Required! | Cloudflare',
    'Enable JavaScript and cookies to continue',
    '__cf_chl_opt',
    'error code: 1020'
];

function isChallenge(res) {
    if (!res) return false;
    if (res.status !== 403 && res.status !== 503 && res.status !== 429) return false;
    return CHALLENGE_MARKERS.some((marker) => res.data.includes(marker));
}

function isRetiredPayload(data) {
    return typeof data === 'string' && (data.includes('key_retired') || data.includes('Invalid token'));
}

/**
 * Returns null when the response is usable for the requested kind, otherwise a
 * short human readable reason.
 */
function validateResponse(kind, res) {
    if (!res) return 'no response';
    if (res.status === 0) return 'network error';
    if (isChallenge(res)) {
        sawChallenge = true;
        return 'cloudflare challenge';
    }

    if (kind === 'json') {
        if (res.status === 200 && /^\s*[{[]/.test(res.data)) return null;
        if (res.status === 403 && isRetiredPayload(res.data)) return null;
        return `unexpected status ${res.status} (${clip(res.data, 60)})`;
    }

    if (res.status !== 200) return `status ${res.status}`;
    if (!res.data) return 'empty body';

    if (kind === 'html') {
        if (res.data.length < 2000) return `html too short (${res.data.length} bytes)`;
        if (!/<script/i.test(res.data)) return 'no <script> tags';
        return null;
    }

    if (kind === 'js') {
        if (res.data.length < 5000) return `js too short (${res.data.length} bytes)`;
        if (!res.data.includes('function') && !res.data.includes('=>')) return 'body is not javascript';
        return null;
    }

    return null;
}

// ---------------------------------------------------------------------------
// providers
// ---------------------------------------------------------------------------

function toTranslateUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch (_) {
        return null;
    }
    if (!/(^|\.)comix\.to$/i.test(parsed.hostname)) return null;

    const proxied = new URL(url);
    proxied.protocol = 'https:';
    proxied.hostname = `${parsed.hostname.replace(/\./g, '-')}.translate.goog`;
    proxied.searchParams.set('_x_tr_sl', 'auto');
    proxied.searchParams.set('_x_tr_tl', 'en');
    proxied.searchParams.set('_x_tr_hl', 'en');
    return proxied.href;
}

function buildProxyUrl(url) {
    const template = (process.env.COMIX_PROXY_URL || '').trim();
    if (!template) return null;
    if (template.includes('{url_encoded}')) return template.replace('{url_encoded}', encodeURIComponent(url));
    if (template.includes('{url}')) return template.replace('{url}', url);
    return template.replace(/\/+$/, '') + '/' + url;
}

/** Reverse proxy URLs back into the original comix.to URL. */
function unwrapArchiveUrl(url) {
    const match = /^https?:\/\/web\.archive\.org\/web\/\d+(?:id_|if_)?\/(.+)$/i.exec(url);
    if (!match) return url;
    const original = match[1];
    return /^https?:\/\//i.test(original) ? original : `https://${original.replace(/^\/+/, '')}`;
}

async function fetchDirect(url, kind, headers) {
    let last = null;
    try {
        last = await httpsGet(url, headers);
    } catch (err) {
        last = { status: 0, data: '', headers: {}, error: err.message };
    }
    if (!validateResponse(kind, last)) return { ...last, note: 'node' };

    const curl = curlGet(url, headers);
    if (curl && !validateResponse(kind, curl)) return { ...curl, note: 'curl' };

    return last || { status: 0, data: '', headers: {} };
}

async function fetchProxy(url, kind, headers) {
    const proxied = buildProxyUrl(url);
    if (!proxied) throw new Error('COMIX_PROXY_URL is not configured');
    return httpsGet(proxied, { ...headers, Accept: headers.Accept || '*/*' }, { timeoutMs: 30000 });
}

async function fetchTranslate(url, kind, headers) {
    const proxied = toTranslateUrl(url);
    if (!proxied) throw new Error('translate.goog only proxies comix.to URLs');
    return httpsGet(proxied, headers, { timeoutMs: 25000 });
}

async function fetchJina(url, kind, headers) {
    const res = await httpsGet(`https://r.jina.ai/${url}`, {
        ...headers,
        // `text` keeps the JSON API byte-identical; `html` returns the rendered
        // DOM, which is the only mode that still carries <script src=...>.
        'X-Return-Format': kind === 'html' ? 'html' : 'text',
        Accept: kind === 'html' ? 'text/html' : 'text/plain'
    }, { timeoutMs: 35000 });
    // The reader wraps failures in a JSON envelope with a 4xx status.
    if (res.status !== 200 && /AssertionFailureError|Failed to interpret/.test(res.data)) {
        return { ...res, status: 502 };
    }
    return res;
}

async function fetchWayback(url, kind, headers) {
    const target = unwrapArchiveUrl(url);
    if (/(^|\.)web\.archive\.org$/i.test(new URL(target).hostname)) {
        throw new Error('already an archive URL');
    }
    const lookup = `https://archive.org/wayback/available?url=${encodeURIComponent(target)}`;
    let availability = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
        const res = await httpsGet(lookup, { Accept: 'application/json' }, { timeoutMs: 20000 });
        if (res.status === 200) {
            availability = res;
            break;
        }
        if (res.status === 429 || res.status >= 500) {
            await sleep(2500 * attempt);
            continue;
        }
        break;
    }
    if (!availability) throw new Error('archive.org availability lookup failed');

    let parsed;
    try {
        parsed = JSON.parse(availability.data);
    } catch (_) {
        throw new Error('archive.org returned non-JSON');
    }
    const closest = parsed && parsed.archived_snapshots && parsed.archived_snapshots.closest;
    if (!closest || !closest.available || !closest.url) throw new Error('no Wayback snapshot available');

    const rawUrl = String(closest.url)
        .replace(/^http:/, 'https:')
        .replace(/^(https:\/\/web\.archive\.org\/web\/\d+)(?!id_|if_)\/?/, '$1id_/');
    const res = await httpsGet(rawUrl, headers, { timeoutMs: 40000 });
    return { ...res, note: `snapshot ${closest.timestamp || ''}`.trim() };
}

const PROVIDERS = {
    direct: { label: 'direct', fetch: fetchDirect },
    proxy: { label: 'proxy', fetch: fetchProxy },
    translate: { label: 'translate', fetch: fetchTranslate },
    jina: { label: 'jina', fetch: fetchJina },
    wayback: { label: 'wayback', fetch: fetchWayback }
};

const CHAINS = {
    html: ['direct', 'proxy', 'translate', 'jina', 'wayback'],
    js: ['direct', 'proxy', 'translate', 'wayback'],
    json: ['direct', 'translate', 'jina', 'proxy']
};

function resolveChain(kind) {
    const override = (process.env.COMIX_PROVIDERS || '')
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);

    let chain = override.length > 0 ? override : CHAINS[kind] || CHAINS.html;
    chain = chain.filter((name) => {
        if (!PROVIDERS[name]) {
            warn(`unknown provider "${name}" ignored`);
            return false;
        }
        if (name === 'direct' && NO_DIRECT) return false;
        if (name === 'proxy' && !process.env.COMIX_PROXY_URL) return false;
        return true;
    });

    if (chain.length === 0) {
        if (NO_DIRECT) throw new Error('no transport provider enabled (direct is disabled)');
        chain = ['direct'];
    }
    return chain;
}

function recordAttempt({ provider, kind, label, url, status, bytes, ms, ok, note }) {
    transportLog.push({
        provider,
        kind,
        resource: label,
        url: redact(url),
        status,
        bytes,
        ms,
        ok,
        note: note || ''
    });
    const verdict = ok ? 'ok' : 'fail';
    const detail = ok ? `${bytes} bytes` : note;
    log(`transport ${verdict.padEnd(4)} ${provider.padEnd(9)} ${kind.padEnd(4)} ${label} status=${status} ${detail} (${ms}ms)`);
}

/**
 * Fetches a resource through the provider chain until one returns a validated
 * payload. Throws { reason: 'unreachable' } when every provider fails.
 */
async function fetchResource(url, kind, options = {}) {
    const { headers = {}, chain, label = 'resource', accept } = options;
    const order = chain || resolveChain(kind);
    const failures = [];

    for (const name of order) {
        const provider = PROVIDERS[name];
        for (let attempt = 1; attempt <= 2; attempt++) {
            const started = Date.now();
            let res = null;
            let error = null;
            try {
                res = await provider.fetch(url, kind, headers);
            } catch (err) {
                error = err;
            }
            const ms = Date.now() - started;

            let problem = error ? error.message : validateResponse(kind, res);
            if (!problem && accept && res && !accept(res)) problem = 'content check failed';

            recordAttempt({
                provider: name,
                kind,
                label,
                url,
                status: res ? res.status : 0,
                bytes: res && res.data ? res.data.length : 0,
                ms,
                ok: !problem,
                note: problem || (res && res.note) || ''
            });

            if (!problem) return { ...res, provider: name };

            failures.push(`${name}#${attempt}: ${problem}`);
            if (attempt === 1) await sleep(700);
        }
    }

    const error = new Error(
        `all transports failed for ${kind} ${label} (${redact(url)}): ${failures.join(' | ')}`
    );
    error.reason = sawChallenge ? 'waf_blocked' : 'unreachable';
    throw error;
}

// ---------------------------------------------------------------------------
// Signing primitives — byte-for-byte port of src/Comix/ComixCrypto.ts.
// Keep both files in sync: a mismatch produces tokens comix.to rejects.
// ---------------------------------------------------------------------------

const Hj = new Uint32Array([
    1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221,
    3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580,
    3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986,
    2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895,
    666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037,
    2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344,
    430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779,
    1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298
]);
const Nj = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function Ij(Z, n) {
    return (Z >>> n) | (Z << (32 - n));
}

function Jj(Z, U, x) {
    const E = new Uint32Array(64);
    for (let P = 0; P < 16; P++) {
        const R = x + 4 * P;
        E[P] = (U[R] << 24) | (U[R + 1] << 16) | (U[R + 2] << 8) | U[R + 3];
    }
    for (let o = 16; o < 64; o++) {
        const W = E[o - 15];
        const M = Ij(W, 7) ^ Ij(W, 18) ^ (W >>> 3);
        const u = E[o - 2];
        const y = Ij(u, 17) ^ Ij(u, 19) ^ (u >>> 10);
        E[o] = (E[o - 16] + M + E[o - 7] + y) | 0;
    }
    let G = Z[0];
    let D = Z[1];
    let p = Z[2];
    let B = Z[3];
    let X = Z[4];
    let r = Z[5];
    let A = Z[6];
    let I = Z[7];
    for (let N = 0; N < 64; N++) {
        const L = (I + (Ij(X, 6) ^ Ij(X, 11) ^ Ij(X, 25)) + ((X & r) ^ (~X & A)) + Hj[N] + E[N]) | 0;
        const t = ((Ij(G, 2) ^ Ij(G, 13) ^ Ij(G, 22)) + ((G & D) ^ (G & p) ^ (D & p))) | 0;
        I = A; A = r; r = X; X = (B + L) | 0; B = p; p = D; D = G; G = (L + t) | 0;
    }
    Z[0] = (Z[0] + G) | 0; Z[1] = (Z[1] + D) | 0; Z[2] = (Z[2] + p) | 0; Z[3] = (Z[3] + B) | 0;
    Z[4] = (Z[4] + X) | 0; Z[5] = (Z[5] + r) | 0; Z[6] = (Z[6] + A) | 0; Z[7] = (Z[7] + I) | 0;
}

function Kj(Z, n, U) {
    const x = Uint32Array.from(Z);
    const E = U + n.length;
    let G = n.length + 1;
    for (; G % 64 !== 56;) G++;
    const D = new Uint8Array(G + 8);
    D.set(n);
    D[n.length] = 128;
    const p = 8 * E;
    const B = Math.floor(p / 4294967296);
    const X = p >>> 0;
    const r = D.length - 8;
    D[r] = (B >>> 24) & 255; D[r + 1] = (B >>> 16) & 255; D[r + 2] = (B >>> 8) & 255; D[r + 3] = B & 255;
    D[r + 4] = (X >>> 24) & 255; D[r + 5] = (X >>> 16) & 255; D[r + 6] = (X >>> 8) & 255; D[r + 7] = X & 255;
    for (let I = 0; I < D.length; I += 64) Jj(x, D, I);
    const A = new Uint8Array(32);
    for (let P = 0; P < 8; P++) {
        A[4 * P] = (x[P] >>> 24) & 255;
        A[4 * P + 1] = (x[P] >>> 16) & 255;
        A[4 * P + 2] = (x[P] >>> 8) & 255;
        A[4 * P + 3] = x[P] & 255;
    }
    return A;
}

function Lj(Z, n) {
    const U = new Uint32Array(8);
    for (let x = 0; x < 8; x++) {
        const E = n + 4 * x;
        U[x] = (Z[E] << 24) | (Z[E + 1] << 16) | (Z[E + 2] << 8) | Z[E + 3];
    }
    return U;
}

function signPath(version, keyBytes, requestPath) {
    const U = new TextEncoder().encode(requestPath);
    const x = Kj(Lj(keyBytes, 0), U, 64);
    const hash = Kj(Lj(keyBytes, 32), x, 64);
    let n = '';
    for (let i = 0; i < hash.length; i += 3) {
        const b0 = hash[i];
        const b1 = hash[i + 1];
        const b2 = hash[i + 2];
        n += Nj[b0 >> 2] + Nj[((3 & b0) << 4) | (b1 >> 4)];
        if (i + 1 < hash.length) n += Nj[((15 & b1) << 2) | (b2 >> 6)];
        if (i + 2 < hash.length) n += Nj[63 & b2];
    }
    return version + '.' + n.slice(0, 16);
}

// ---------------------------------------------------------------------------
// live API verification
// ---------------------------------------------------------------------------

async function testKey(version, keyB64) {
    let keyBytes;
    try {
        keyBytes = Buffer.from(keyB64, 'base64');
    } catch (_) {
        return { valid: false, reason: 'malformed_key' };
    }
    if (keyBytes.length !== KEY_LENGTH) return { valid: false, reason: `key_length_${keyBytes.length}` };

    const token = signPath(version, keyBytes, API_PATH);
    const url = `${SITE}/api/v1${API_PATH}&_=${token}`;

    let res;
    try {
        res = await fetchResource(url, 'json', {
            headers: { Accept: 'application/json' },
            label: 'api/manga'
        });
    } catch (err) {
        return { valid: null, reason: err.reason || 'unreachable', error: err.message };
    }

    if (isRetiredPayload(res.data)) return { valid: false, reason: 'key_retired', provider: res.provider };
    try {
        const payload = JSON.parse(res.data);
        if (payload && (payload.status === 'ok' || payload.result)) {
            return { valid: true, provider: res.provider };
        }
    } catch (_) {
        /* fall through */
    }
    return { valid: false, reason: 'unexpected_payload', provider: res.provider };
}

// ---------------------------------------------------------------------------
// key extraction from the obfuscated apicore bundle
// ---------------------------------------------------------------------------

const BUILTINS = new Set([
    'Uint8Array', 'Uint32Array', 'Int8Array', 'Int32Array', 'Uint16Array', 'Int16Array',
    'Array', 'String', 'Math', 'Object', 'Boolean', 'Number', 'Date', 'RegExp', 'Error',
    'Symbol', 'JSON', 'Promise', 'Proxy', 'Reflect', 'Map', 'Set', 'Function',
    'parseInt', 'parseFloat', 'decodeURIComponent', 'encodeURIComponent'
]);

function extractBraceBlock(code, startIdx) {
    const braceIdx = code.indexOf('{', startIdx);
    if (braceIdx === -1) return null;
    let depth = 0;
    for (let i = braceIdx; i < code.length; i++) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}') {
            depth--;
            if (depth === 0) return code.substring(startIdx, i + 1);
        }
    }
    return null;
}

function pickKeyFromObject(keyObj) {
    let version = null;
    let keyBytes = null;
    for (const value of Object.values(keyObj || {})) {
        if (typeof value === 'string' && value.length >= 2 && value.length <= 6) {
            version = value;
        } else if (typeof value === 'function') {
            try {
                const produced = value();
                if (produced && produced.length === KEY_LENGTH) keyBytes = produced;
            } catch (_) {
                /* keep looking */
            }
        }
    }
    return { version, keyBytes };
}

function isValidVersion(version) {
    return typeof version === 'string' && /^[A-Za-z0-9_-]{2,6}$/.test(version);
}

function assertKey(version, keyBytes, strategy) {
    if (!isValidVersion(version)) throw new Error(`${strategy}: invalid version ${JSON.stringify(version)}`);
    if (!keyBytes || keyBytes.length !== KEY_LENGTH) {
        throw new Error(`${strategy}: expected ${KEY_LENGTH} key bytes, got ${keyBytes ? keyBytes.length : 0}`);
    }
    if (!keyBytes.some((byte) => byte !== 0)) throw new Error(`${strategy}: extracted key is all zeroes`);
}

function runKeyGenerator({ arrayCode, deobfCode, aliasDefs, iifeCode, keyGenCode, objName }) {
    if (!objName) throw new Error('could not identify the key object name');
    const runner = [
        arrayCode + ';',
        deobfCode + ';',
        aliasDefs,
        iifeCode,
        keyGenCode + ';',
        `global.keyObj = ${objName};`
    ].join('\n');

    const context = {
        global: {},
        Uint8Array,
        Uint32Array,
        Array,
        String,
        Math,
        Object,
        parseInt,
        parseFloat,
        decodeURIComponent,
        encodeURIComponent
    };
    vm.createContext(context);
    vm.runInContext(runner, context, { timeout: 20000 });
    return pickKeyFromObject(context.global.keyObj);
}

/** Strategy 1: the shape every build since 1.1.x has used. */
function strategyPrimary(apicore) {
    const iifeMatch = apicore.match(
        /!function\s*\(\)\s*\{const\s+([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+(?:\(\))?),\s*([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+(?:\(\))?);/
    );
    if (!iifeMatch) throw new Error('primary: unscrambler IIFE pattern not found');

    let arrFunc;
    let deobfFunc;
    let deobfAlias;
    if (iifeMatch[2].endsWith('()')) {
        arrFunc = iifeMatch[2].slice(0, -2);
        deobfFunc = iifeMatch[4];
        deobfAlias = iifeMatch[3];
    } else {
        arrFunc = iifeMatch[4].slice(0, -2);
        deobfFunc = iifeMatch[2];
        deobfAlias = iifeMatch[1];
    }

    const arrStart = apicore.indexOf(`function ${arrFunc}(`);
    if (arrStart === -1) throw new Error(`primary: string array function ${arrFunc} not found`);
    const arrayCode = extractBraceBlock(apicore, arrStart);

    const deobfStart = apicore.indexOf(`function ${deobfFunc}(`);
    if (deobfStart === -1) throw new Error(`primary: deobfuscator ${deobfFunc} not found`);
    const deobfCode = extractBraceBlock(apicore, deobfStart);

    const iifeEndMarker = '}();';
    const iifeEnd = apicore.indexOf(iifeEndMarker) + iifeEndMarker.length;
    const iifeCode = apicore.substring(apicore.indexOf('!function'), iifeEnd);

    const { keyGenCode, objName } = locateKeyGenerator(apicore);

    const aliases = new Set(
        [...keyGenCode.matchAll(/\b([a-zA-Z0-9_$]+)\(\d+\)/g)]
            .map((match) => match[1])
            .filter((name) => !BUILTINS.has(name) && name !== deobfFunc)
    );
    if (deobfAlias && deobfAlias !== deobfFunc) aliases.add(deobfAlias);

    const preIife = apicore.substring(0, apicore.indexOf('!function'));
    for (const match of preIife.matchAll(/const\s+([a-zA-Z0-9_$]+)\s*=\s*([a-zA-Z0-9_$]+)/g)) {
        if (match[2] === deobfFunc) aliases.add(match[1]);
    }

    const aliasDefs = Array.from(aliases).map((alias) => `var ${alias} = ${deobfFunc};`).join('\n');

    return runKeyGenerator({ arrayCode, deobfCode, aliasDefs, iifeCode, keyGenCode, objName });
}

/**
 * Locates the `const obj={}` dictionary plus the enclosing key generator block.
 * Shared by both strategies because this part is stable across builds.
 */
function locateKeyGenerator(apicore) {
    const u8Idx = apicore.indexOf('Uint8Array(1088)');
    if (u8Idx === -1) throw new Error('Uint8Array(1088) marker not found');

    const tail = apicore.substring(u8Idx, u8Idx + 400);
    const endMatch = tail.match(/return\s+([a-zA-Z0-9_$]+)\s*;?\s*\}/);
    if (!endMatch) throw new Error('key generator return statement not found');
    const funcEndIdx = u8Idx + endMatch.index + endMatch[0].length;

    const cjMatch = apicore
        .substring(Math.max(0, u8Idx - 1000), u8Idx)
        .match(/function\s+([a-zA-Z0-9_$]+)\s*\([a-zA-Z0-9_$,\s]+\)\s*\{[^}]*?([a-zA-Z0-9_$]+)\[[a-zA-Z0-9_$]+\]/);

    let start = -1;
    if (cjMatch) {
        const dictName = cjMatch[2];
        start = apicore.lastIndexOf(`${dictName}={};`, u8Idx);
    }
    if (start === -1) {
        const windowStart = Math.max(0, u8Idx - 6000);
        const window = apicore.substring(windowStart, u8Idx);
        const matches = [...window.matchAll(/([a-zA-Z0-9_$]+)=\{\};[\s\S]*?\1\[[a-zA-Z0-9_$]+\(\d+\)\]=\[\d+,\d+,\d+/g)];
        if (matches.length > 0) {
            const dictName = matches[matches.length - 1][1];
            const rel = window.lastIndexOf(`${dictName}={};`);
            if (rel !== -1) start = windowStart + rel;
        }
    }
    if (start === -1) throw new Error('key byte dictionary not found');

    const keyGenCode = apicore.substring(start, funcEndIdx);
    const objMatch = keyGenCode.match(/const ([a-zA-Z0-9_$]+)=\{\};\1\[[a-zA-Z0-9_$]+\(\d+\)\]=/);
    return { keyGenCode, objName: objMatch ? objMatch[1] : null };
}

/**
 * Strategy 2: bundler mangle names changed enough that the strict `const a=b,
 * c=d();` declaration no longer matches. Resolve the helper functions from the
 * names the IIFE calls *and* from the identifiers it aliases, then hoist only
 * the pure `x = y` aliases — a call alias (`L = R()`) must stay inside the IIFE,
 * because hoisting it would hand the deobfuscator an unpermuted string array.
 */
function strategyRelaxed(apicore) {
    const iifeStart = apicore.indexOf('!function');
    if (iifeStart === -1) throw new Error('relaxed: no IIFE found');
    const iifeBlock = extractBraceBlock(apicore, iifeStart);
    if (!iifeBlock) throw new Error('relaxed: unbalanced IIFE');
    const iifeCode = iifeBlock + '();';

    const head = apicore.substring(0, iifeStart);
    const declarationRe = /(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*([a-zA-Z0-9_$]+)\s*(?=[,;])/g;

    const candidates = new Set();
    for (const match of iifeBlock.matchAll(/\b([a-zA-Z0-9_$]+)\s*\(/g)) {
        const name = match[1];
        if (!BUILTINS.has(name) && !['if', 'for', 'while', 'switch', 'catch', 'function', 'return'].includes(name)) {
            candidates.add(name);
        }
    }

    const aliases = [];
    for (const source of [head, iifeBlock]) {
        for (const match of source.matchAll(declarationRe)) {
            const [, alias, target] = match;
            if (alias === target) continue;
            aliases.push(`var ${alias} = ${target};`);
            candidates.add(target);
        }
    }

    const defs = [];
    for (const name of candidates) {
        if (BUILTINS.has(name)) continue;
        const at = apicore.indexOf(`function ${name}(`);
        if (at === -1) continue;
        const block = extractBraceBlock(apicore, at);
        if (!block || block.length < 20) continue;
        defs.push(block);
    }
    if (defs.length < 2) throw new Error(`relaxed: resolved ${defs.length} of the 2 required helper functions`);

    const { keyGenCode, objName } = locateKeyGenerator(apicore);
    if (!objName) throw new Error('relaxed: key object name not found');

    return runKeyGenerator({
        arrayCode: defs.join(';\n'),
        deobfCode: '',
        aliasDefs: aliases.join('\n'),
        iifeCode,
        keyGenCode,
        objName
    });
}

function extractKeyFromApicore(apicore) {
    const strategies = [
        ['primary', strategyPrimary],
        ['relaxed', strategyRelaxed]
    ];
    const problems = [];

    for (const [name, strategy] of strategies) {
        try {
            const { version, keyBytes } = strategy(apicore);
            assertKey(version, keyBytes, name);
            const key = Buffer.from(keyBytes).toString('base64');
            log(`[Sync] extracted version '${version}' via ${name} strategy (${keyBytes.length} bytes)`);
            return { version, key, strategy: name };
        } catch (err) {
            problems.push(`${name}: ${err.message}`);
            warn(`[Sync] ${name} extraction strategy failed: ${err.message}`);
        }
    }
    throw new Error(`key extraction failed -> ${problems.join(' | ')}`);
}

// ---------------------------------------------------------------------------
// scrape orchestration
// ---------------------------------------------------------------------------

function resolveAssetUrl(candidate, baseUrl) {
    const cleaned = unwrapArchiveUrl(String(candidate || '').trim());
    if (/^https?:\/\//i.test(cleaned)) return cleaned;
    if (cleaned.startsWith('/')) return `${SITE}${cleaned}`;
    try {
        return new URL(cleaned, baseUrl).href;
    } catch (_) {
        return `${SITE}/${cleaned.replace(/^\.?\//, '')}`;
    }
}

async function extractKeyFromComix() {
    log('[Sync] scraping comix.to for the published signing key...');

    const home = await fetchResource(`${SITE}/`, 'html', {
        label: 'home',
        chain: resolveChain('html'),
        accept: (res) => /main-[a-zA-Z0-9_.-]+\.js/.test(res.data)
    });

    const mainMatch =
        home.data.match(/<script[^>]+src="([^"]*main-[^"]+\.js)"/i) ||
        home.data.match(/["'](\/?[^"']*main-[^"']+\.js)["']/i);
    if (!mainMatch) throw new Error('could not locate main-*.js in the comix.to home page');
    const mainUrl = resolveAssetUrl(mainMatch[1], `${SITE}/`);
    log(`[Sync] main bundle: ${redact(mainUrl)} (via ${home.provider})`);

    const main = await fetchResource(mainUrl, 'js', {
        label: 'main.js',
        chain: resolveChain('js'),
        accept: (res) => /apicore-[a-zA-Z0-9_.-]+\.js/.test(res.data)
    });

    const apicoreMatch =
        main.data.match(/["'](\.?\/?[^"']*apicore-[a-zA-Z0-9_.-]+\.js)["']/) ||
        main.data.match(/(apicore-[a-zA-Z0-9_.-]+\.js)/);
    if (!apicoreMatch) throw new Error('could not locate apicore-*.js inside the main bundle');
    const apicoreUrl = resolveAssetUrl(apicoreMatch[1], mainUrl);
    log(`[Sync] apicore bundle: ${redact(apicoreUrl)} (via ${main.provider})`);

    const apicore = await fetchResource(apicoreUrl, 'js', {
        label: 'apicore.js',
        chain: resolveChain('js'),
        accept: (res) => res.data.includes('Uint8Array(1088)')
    });

    log(`[Sync] apicore downloaded (${apicore.data.length} bytes via ${apicore.provider})`);
    return { ...extractKeyFromApicore(apicore.data), source: { main: mainUrl, apicore: apicoreUrl } };
}

// ---------------------------------------------------------------------------
// repository state
// ---------------------------------------------------------------------------

function readLocalConfig() {
    if (!fs.existsSync(KEYS_PATH)) return null;
    try {
        const parsed = JSON.parse(fs.readFileSync(KEYS_PATH, 'utf8'));
        if (parsed && parsed.version && parsed.key) return parsed;
    } catch (err) {
        warn(`[Sync] comix_keys.json is not valid JSON: ${err.message}`);
    }
    return null;
}

async function readPublishedConfig() {
    try {
        const res = await fetch(`${PAGES_KEY_URL}?t=${Date.now()}`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return { ok: false, status: res.status };
        return { ok: true, config: await res.json() };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

function writeConfig(config) {
    const payload = JSON.stringify(config, null, 2) + '\n';
    fs.writeFileSync(KEYS_PATH, payload, 'utf8');
    if (fs.existsSync(path.dirname(BUNDLES_KEYS_PATH))) {
        fs.writeFileSync(BUNDLES_KEYS_PATH, payload, 'utf8');
    }
}

function emitOutputs(pairs) {
    const target = process.env.GITHUB_OUTPUT;
    if (!target) {
        log(`outputs: ${Object.entries(pairs).map(([k, v]) => `${k}=${v}`).join(' ')}`);
        return;
    }
    try {
        const body = Object.entries(pairs)
            .map(([key, value]) => `${key}=${String(value).replace(/\r?\n/g, ' ')}`)
            .join('\n');
        fs.appendFileSync(target, body + '\n');
    } catch (err) {
        warn(`[Sync] failed to write GITHUB_OUTPUT: ${err.message}`);
    }
}

function writeReport(report) {
    try {
        fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8');
    } catch (err) {
        warn(`[Sync] failed to write report: ${err.message}`);
    }
}

function appendStepSummary(lines) {
    const target = process.env.GITHUB_STEP_SUMMARY;
    if (!target) return;
    try {
        fs.appendFileSync(target, lines.join('\n') + '\n');
    } catch (err) {
        warn(`[Sync] failed to write step summary: ${err.message}`);
    }
}

function summarizeTransports() {
    const rows = transportLog.map(
        (entry) =>
            `| ${entry.provider} | ${entry.kind} | ${entry.resource} | ${entry.status} | ${entry.bytes} | ${entry.ms}ms | ${entry.ok ? 'ok' : entry.note} |`
    );
    return [
        '| provider | kind | resource | status | bytes | time | result |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...rows
    ];
}

function buildReport(outcome) {
    const ok = transportLog.filter((entry) => entry.ok);
    return {
        generated_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt.getTime(),
        mode: SELFTEST ? 'selftest' : 'sync',
        force: FORCE,
        no_direct: NO_DIRECT,
        providers_configured: process.env.COMIX_PROVIDERS || 'default',
        proxy_configured: Boolean(process.env.COMIX_PROXY_URL),
        outcome,
        winning_transport: ok.length > 0 ? ok[ok.length - 1].provider : null,
        transports: transportLog
    };
}

// ---------------------------------------------------------------------------
// self test
// ---------------------------------------------------------------------------

async function runSelftest() {
    log('[Selftest] discovering live comix.to asset URLs...');

    let htmlUrl = `${SITE}/`;
    let jsUrl = null;
    let discoveryError = null;
    try {
        const home = await fetchResource(htmlUrl, 'html', {
            label: 'home',
            accept: (res) => /main-[a-zA-Z0-9_.-]+\.js/.test(res.data)
        });
        const mainMatch =
            home.data.match(/<script[^>]+src="([^"]*main-[^"]+\.js)"/i) ||
            home.data.match(/["'](\/?[^"']*main-[^"']+\.js)["']/i);
        if (mainMatch) {
            const mainUrl = resolveAssetUrl(mainMatch[1], `${SITE}/`);
            const main = await fetchResource(mainUrl, 'js', {
                label: 'main.js',
                accept: (res) => /apicore-[a-zA-Z0-9_.-]+\.js/.test(res.data)
            });
            const apicoreMatch =
                main.data.match(/["'](\.?\/?[^"']*apicore-[a-zA-Z0-9_.-]+\.js)["']/) ||
                main.data.match(/(apicore-[a-zA-Z0-9_.-]+\.js)/);
            if (apicoreMatch) jsUrl = resolveAssetUrl(apicoreMatch[1], mainUrl);
        }
    } catch (err) {
        discoveryError = err.message;
    }

    // Probe the API with the real key when one is checked in, otherwise with a
    // throwaway token (comix.to answers 403 for unknown versions).
    const known = readLocalConfig();
    const probeVersion = known ? known.version : 'sel';
    const probeKey = known ? Buffer.from(known.key, 'base64') : Buffer.alloc(KEY_LENGTH, 7);
    const apiUrl = `${SITE}/api/v1${API_PATH}&_=${signPath(probeVersion, probeKey, API_PATH)}`;
    const targets = [
        ['html', htmlUrl],
        ['js', jsUrl],
        ['json', apiUrl]
    ].filter((entry) => Boolean(entry[1]));

    const rows = [];
    const results = {};
    for (const name of Object.keys(PROVIDERS)) {
        if (name === 'proxy' && !process.env.COMIX_PROXY_URL) {
            rows.push(`| ${name} | - | skipped (COMIX_PROXY_URL not set) | - |`);
            continue;
        }
        for (const [kind, url] of targets) {
            const started = Date.now();
            let verdict;
            try {
                const res = await PROVIDERS[name].fetch(url, kind, {});
                let problem = validateResponse(kind, res);
                // The dummy self-test token is always rejected, so a 403 proves
                // reachability but not a healthy API path.
                if (!problem && kind === 'json' && res.status !== 200) problem = `rejected token (status ${res.status})`;
                const bytes = res && res.data ? res.data.length : 0;
                verdict = problem ? `fail: ${problem} (${res ? res.status : 0}, ${bytes} bytes)` : `ok (${res.status}, ${bytes} bytes)`;
                results[`${name}:${kind}`] = !problem;
            } catch (err) {
                verdict = `fail: ${err.message}`;
                results[`${name}:${kind}`] = false;
            }
            rows.push(`| ${name} | ${kind} | ${verdict} | ${Date.now() - started}ms |`);
        }
    }

    const usable = targets.every(([kind]) => Object.entries(results).some(([key, ok]) => ok && key.endsWith(`:${kind}`)));
    const summary = [
        '### Comix transport self-test',
        '',
        `- discovery: ${discoveryError ? `failed (${discoveryError})` : 'ok'}`,
        `- apicore: ${jsUrl || 'not resolved'}`,
        `- every resource reachable: ${usable}`,
        '',
        '| provider | kind | result | time |',
        '| --- | --- | --- | --- |',
        ...rows
    ];
    appendStepSummary(summary);
    console.log(summary.join('\n'));

    writeReport(buildReport({ reason: 'selftest', usable }));
    log(`[Selftest] ${usable ? 'at least one transport serves every resource' : 'NOT every resource is reachable'}`);
    process.exit(usable ? 0 : 1);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function finish(outcome, exitCode = 0) {
    const report = buildReport(outcome);
    writeReport(report);
    appendStepSummary([
        '### Comix key sync',
        '',
        `- **result:** ${outcome.reason}`,
        `- **version:** ${outcome.version || 'n/a'}${outcome.rotated ? ' (rotated)' : ''}`,
        `- **verified against live API:** ${outcome.verified === null ? 'unknown' : outcome.verified}`,
        `- **transport:** ${report.winning_transport || 'none'}`,
        '',
        '<details><summary>Transport attempts</summary>',
        '',
        ...summarizeTransports(),
        '',
        '</details>'
    ]);
    emitOutputs({
        key_updated: outcome.rotated ? 'true' : 'false',
        version: outcome.version || '',
        verified: String(outcome.verified)
    });
    log(`[Sync] done -> ${outcome.reason} (version=${outcome.version || 'n/a'}, rotated=${outcome.rotated}, verified=${outcome.verified})`);
    process.exit(exitCode);
}

async function main() {
    if (SELFTEST) return runSelftest();

    const local = readLocalConfig();

    if (!local) {
        log('[Sync] no local key config found, performing initial extraction...');
        const scraped = await extractKeyFromComix();
        const verification = await testKey(scraped.version, scraped.key);
        writeConfig({ version: scraped.version, key: scraped.key, updated_at: Date.now(), verified: verification.valid === true });
        return finish({
            rotated: true,
            reason: 'initial_extract',
            version: scraped.version,
            verified: verification.valid,
            strategy: scraped.strategy
        });
    }

    log(`[Sync] testing current key (version: ${local.version})...`);
    const current = await testKey(local.version, local.key);

    if (current.valid === true && !FORCE) {
        log(`[Sync] key is valid (via ${current.provider}).`);
        const published = await readPublishedConfig();
        if (!published.ok) {
            log(`[Sync] could not read the published key (${published.error || 'HTTP ' + published.status}), forcing a deploy.`);
            return finish({ rotated: true, reason: 'pages_unreadable', version: local.version, verified: true });
        }
        if (published.config && published.config.version !== local.version) {
            log(`[Sync] GitHub Pages is stale (${published.config.version} != ${local.version}), forcing a deploy.`);
            return finish({ rotated: true, reason: 'pages_out_of_sync', version: local.version, verified: true });
        }
        return finish({ rotated: false, reason: 'ok', version: local.version, verified: true });
    }

    if (current.valid === true && FORCE) {
        log('[Sync] --force set, rotating despite a healthy key.');
    } else {
        log(`[Sync] key is not usable (${current.reason}${current.provider ? `, transport ${current.provider}` : ''}).`);
    }

    let scraped = null;
    let scrapeError = null;
    try {
        scraped = await extractKeyFromComix();
    } catch (err) {
        scrapeError = err;
        warn(`[Sync] could not scrape a published key: ${err.message}`);
    }

    if (!scraped) {
        // Nothing reachable. If the key is merely unverifiable (WAF) and the
        // published copy matches, this is a no-op rather than a failure.
        if (current.reason === 'waf_blocked' || current.reason === 'unreachable') {
            const published = await readPublishedConfig();
            if (published.ok && published.config && published.config.version === local.version) {
                warn('[Sync] live API unreachable, but the local key matches the published one. Keeping it.');
                return finish({ rotated: false, reason: 'unverified_in_sync', version: local.version, verified: null });
            }
        }
        throw scrapeError || new Error('key rotation failed');
    }

    log(`[Sync] published key is '${scraped.version}' (local '${local.version}').`);

    const sameKey = scraped.version === local.version && scraped.key === local.key;
    if (sameKey) {
        if (current.valid === null) {
            warn('[Sync] live API unreachable from this runner, but the published key matches the local one. Keeping it.');
            return finish({ rotated: false, reason: 'unverified_in_sync', version: local.version, verified: null });
        }
        if (current.valid === false && current.reason === 'key_retired') {
            // The site is shipping exactly the key the API just rejected. Either
            // comix.to is mid-rotation or our signing drifted; rotating to an
            // identical key cannot help, and staying silent would hide it.
            throw new Error(
                `comix.to rejects the shipped key '${local.version}' but still serves that same key. ` +
                'Signing or the key contract may have changed upstream.'
            );
        }
        log('[Sync] published key matches the local key; nothing to rotate.');
        return finish({ rotated: false, reason: FORCE ? 'force_same_key' : 'ok', version: local.version, verified: true });
    }

    const verification = await testKey(scraped.version, scraped.key);
    if (verification.valid === false && verification.reason === 'key_retired') {
        throw new Error(`extracted key for '${scraped.version}' was rejected by the live API`);
    }
    if (verification.valid !== true) {
        // The relaxed strategy reconstructs scope heuristically; a well-formed
        // but wrong key would break every user until the next rotation, so it
        // must never be published on faith.
        if (scraped.strategy !== 'primary') {
            throw new Error(
                `key extracted via the ${scraped.strategy} strategy could not be verified live ` +
                `(${verification.reason}); refusing to publish an unverified heuristic result`
            );
        }
        warn(`[Sync] could not verify the new key live (${verification.reason}); publishing it unverified.`);
    }

    writeConfig({
        version: scraped.version,
        key: scraped.key,
        updated_at: Date.now(),
        verified: verification.valid === true
    });
    return finish({
        rotated: true,
        reason: verification.valid === true ? 'rotated' : 'rotated_unverified',
        version: scraped.version,
        verified: verification.valid,
        strategy: scraped.strategy
    });
}

if (require.main === module) {
    main().catch((err) => {
        console.error('[Sync Error]:', err);
        appendStepSummary(['### Comix key sync failed', '', '```', String(err.message || err), '```', '', ...summarizeTransports()]);
        writeReport(buildReport({ reason: 'error', error: String(err.message || err) }));
        emitOutputs({ key_updated: 'false', version: '', verified: 'false' });
        process.exit(1);
    });
}

module.exports = {
    signPath,
    testKey,
    extractKeyFromApicore,
    fetchResource,
    validateResponse,
    buildProxyUrl,
    toTranslateUrl,
    decodeBody,
    unwrapArchiveUrl
};
