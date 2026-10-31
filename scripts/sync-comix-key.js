/**
 * Automated Comix.to Signing Key Sync
 * 
 * 1. Checks current comix_keys.json against the live Comix API.
 * 2. If valid, exits early.
 * 3. If retired/invalid:
 *    - Downloads https://comix.to/ (with Cloudflare-resistant fallback via Jina)
 *    - Finds main-*.js and apicore-*.js
 *    - Dynamically resolves all deobfuscator aliases inside keyGenCode
 *    - Executes in an isolated Node VM to extract active VERSION and KEY_B64
 *    - Verifies the new key against https://comix.to/api/v1/manga
 *    - If HTTP 200, updates comix_keys.json and bundles/comix_keys.json
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT_DIR = path.resolve(__dirname, '..');
const KEYS_PATH = path.join(ROOT_DIR, 'comix_keys.json');
const BUNDLES_KEYS_PATH = path.join(ROOT_DIR, 'bundles', 'comix_keys.json');

const BUILTINS = new Set([
    'Uint8Array', 'Uint32Array', 'Int8Array', 'Int32Array', 'Uint16Array', 'Int16Array',
    'Array', 'String', 'Math', 'Object', 'Boolean', 'Number', 'Date', 'RegExp', 'Error',
    'Symbol', 'JSON', 'Promise', 'Proxy', 'Reflect', 'Map', 'Set', 'Function'
]);

function httpGetRaw(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const options = {
            hostname: u.hostname,
            port: u.port || 443,
            path: u.pathname + u.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Referer': 'https://comix.to/',
                'Accept': 'application/json, text/html, */*',
                ...headers
            }
        };

        https.get(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
        }).on('error', reject);
    });
}

async function httpGet(url, headers = {}) {
    try {
        const res = await httpGetRaw(url, headers);
        if (res.status === 403 && !url.includes('.js')) {
            console.log(`[Sync] Direct request to ${url} returned 403 (Cloudflare WAF). Retrying via Jina proxy...`);
            const jinaUrl = `https://r.jina.ai/${url}`;
            const jinaRes = await httpGetRaw(jinaUrl, { 'X-Return-Format': 'html' });
            if (jinaRes.status === 200 && jinaRes.data) {
                return jinaRes;
            }
        }
        return res;
    } catch (err) {
        if (!url.includes('.js')) {
            console.log(`[Sync] Request to ${url} failed. Retrying via Jina proxy...`);
            const jinaUrl = `https://r.jina.ai/${url}`;
            return httpGetRaw(jinaUrl, { 'X-Return-Format': 'html' });
        }
        throw err;
    }
}

async function fetchAssetWithRetry(url) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await httpGetRaw(url);
            if (res.status === 200 && res.data) {
                return res;
            }
            console.log(`[Sync] Download ${url} attempt ${attempt} returned status ${res.status}. Retrying in 1.5s...`);
        } catch (err) {
            console.log(`[Sync] Download ${url} attempt ${attempt} failed: ${err.message}. Retrying in 1.5s...`);
        }
        await new Promise(r => setTimeout(r, 1500));
    }
    throw new Error(`Failed to load asset: ${url}`);
}

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

// SHA256 constants & HMAC generator replicating ComixCrypto
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

function Ij(Z, n) { return Z >>> n | Z << 32 - n; }
function Jj(Z, U, x) {
    const E = new Uint32Array(64);
    for (let P = 0; P < 16; P++) {
        const R = x + 4 * P;
        E[P] = U[R] << 24 | U[R + 1] << 16 | U[R + 2] << 8 | U[R + 3];
    }
    for (let o = 16; o < 64; o++) {
        const W = E[o - 15], M = Ij(W, 7) ^ Ij(W, 18) ^ W >>> 3, u = E[o - 2], y = Ij(u, 17) ^ Ij(u, 19) ^ u >>> 10;
        E[o] = E[o - 16] + M + E[o - 7] + y | 0;
    }
    let G = Z[0], D = Z[1], p = Z[2], B = Z[3], X = Z[4], r = Z[5], A = Z[6], I = Z[7];
    for (let N = 0; N < 64; N++) {
        const L = I + (Ij(X, 6) ^ Ij(X, 11) ^ Ij(X, 25)) + (X & r ^ ~X & A) + Hj[N] + E[N] | 0;
        const t = (Ij(G, 2) ^ Ij(G, 13) ^ Ij(G, 22)) + (G & D ^ G & p ^ D & p) | 0;
        I = A; A = r; r = X; X = B + L | 0; B = p; p = D; D = G; G = L + t | 0;
    }
    Z[0] = Z[0] + G | 0; Z[1] = Z[1] + D | 0; Z[2] = Z[2] + p | 0; Z[3] = Z[3] + B | 0;
    Z[4] = Z[4] + X | 0; Z[5] = Z[5] + r | 0; Z[6] = Z[6] + A | 0; Z[7] = Z[7] + I | 0;
}
function Kj(Z, n, U) {
    const x = Uint32Array.from(Z);
    const E = U + n.length;
    let G = n.length + 1;
    for (; G % 64 != 56;) G++;
    const D = new Uint8Array(G + 8);
    D.set(n);
    D[n.length] = 128;
    const p = 8 * E, B = Math.floor(p / 4294967296), X = p >>> 0, r = D.length - 8;
    D[r] = B >>> 24 & 255; D[r + 1] = B >>> 16 & 255; D[r + 2] = B >>> 8 & 255; D[r + 3] = 255 & B;
    D[r + 4] = X >>> 24 & 255; D[r + 5] = X >>> 16 & 255; D[r + 6] = X >>> 8 & 255; D[r + 7] = 255 & X;
    for (let I = 0; I < D.length; I += 64) Jj(x, D, I);
    const A = new Uint8Array(32);
    for (let P = 0; P < 8; P++) {
        A[4 * P] = x[P] >>> 24 & 255;
        A[4 * P + 1] = x[P] >>> 16 & 255;
        A[4 * P + 2] = x[P] >>> 8 & 255;
        A[4 * P + 3] = 255 & x[P];
    }
    return A;
}
function Lj(Z, n) {
    const U = new Uint32Array(8);
    for (let x = 0; x < 8; x++) {
        const E = n + 4 * x;
        U[x] = Z[E] << 24 | Z[E + 1] << 16 | Z[E + 2] << 8 | Z[E + 3];
    }
    return U;
}
function signPath(version, keyBytes, path) {
    const U = new TextEncoder().encode(path);
    const x = Kj(Lj(keyBytes, 0), U, 64);
    const hash = Kj(Lj(keyBytes, 32), x, 64);
    let n = '';
    for (let i = 0; i < hash.length; i += 3) {
        const b0 = hash[i], b1 = hash[i + 1], b2 = hash[i + 2];
        n += Nj[b0 >> 2] + Nj[(3 & b0) << 4 | b1 >> 4];
        if (i + 1 < hash.length) n += Nj[(15 & b1) << 2 | b2 >> 6];
        if (i + 2 < hash.length) n += Nj[63 & b2];
    }
    return version + '.' + n.slice(0, 16);
}

async function testKey(version, keyB64) {
    try {
        const keyBytes = Buffer.from(keyB64, 'base64');
        const path = '/manga?limit=20&page=1';
        const token = signPath(version, keyBytes, path);
        const url = `https://comix.to/api/v1${path}&_=${token}`;
        const res = await httpGet(url);
        if (res.status === 200 && res.data) {
            if (res.data.includes('"status":"ok"') || res.data.includes('"result"')) {
                return true;
            }
        }
    } catch (_) {}
    return false;
}

async function extractKeyFromComix() {
    console.log('[Sync] Fetching comix.to home page to detect latest build assets...');
    const homeRes = await httpGet('https://comix.to/');
    if (homeRes.status !== 200) throw new Error(`Failed to load comix.to home: HTTP ${homeRes.status}`);

    const mainMatch = homeRes.data.match(/src="([^">]*main-[^">]+\.js)"/) || homeRes.data.match(/main-[^.]+\.js/);
    if (!mainMatch) throw new Error('Could not find main-*.js in comix.to HTML');

    const mainPath = mainMatch[1] || mainMatch[0];
    const mainUrl = mainPath.startsWith('http') ? mainPath : (mainPath.startsWith('/') ? `https://comix.to${mainPath}` : `https://comix.to/assets/build/35595e3de3c99889c1aa70/dist/${mainPath}`);
    console.log('[Sync] Main JS URL:', mainUrl);

    const mainRes = await fetchAssetWithRetry(mainUrl);
    const apicoreMatch = mainRes.data.match(/["'](\.?\/?[^"']*apicore-[^"']+\.js)["']/);
    if (!apicoreMatch) throw new Error('Could not find apicore-*.js in main.js');

    const apicoreRel = apicoreMatch[1].replace(/^\.\//, '/');
    const apicoreBase = mainUrl.substring(0, mainUrl.lastIndexOf('/') + 1);
    const apicoreUrl = apicoreRel.startsWith('http') ? apicoreRel : (apicoreRel.startsWith('/') ? new URL(apicoreRel, 'https://comix.to').href : apicoreBase + apicoreRel);
    console.log('[Sync] Apicore JS URL:', apicoreUrl);

    const apicoreRes = await fetchAssetWithRetry(apicoreUrl);
    const apicore = apicoreRes.data;

    console.log('[Sync] Apicore downloaded (', apicore.length, 'bytes). Extracting obfuscated functions...');

    const m = apicore.match(/!function\(\)\{const ([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+),([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+)\(\);/);
    if (!m) throw new Error('Could not match unscrambler header at start of apicore');
    const { deobfAlias, deobfFunc, arrayAlias, arrayFunc } = { deobfAlias: m[1], deobfFunc: m[2], arrayAlias: m[3], arrayFunc: m[4] };

    const arrayStart = apicore.indexOf('function ' + arrayFunc + '()');
    const arrayCode = extractBraceBlock(apicore, arrayStart);
    if (!arrayCode) throw new Error(`Could not extract function ${arrayFunc}`);

    const deobfStart = apicore.indexOf('function ' + deobfFunc + '(');
    const deobfCode = extractBraceBlock(apicore, deobfStart);
    if (!deobfCode) throw new Error(`Could not extract function ${deobfFunc}`);

    const iifeStart = apicore.indexOf('!function(){const ' + deobfAlias + '=' + deobfFunc);
    const iifeEnd = apicore.indexOf('}();', iifeStart) + 4;
    const iifeCode = apicore.substring(iifeStart, iifeEnd);

    const wjStart = apicore.indexOf('wj={};');
    const dxEndMarker = apicore.includes('return zj};') ? 'return zj};' : 'return zj;}';
    const dxEnd = apicore.indexOf(dxEndMarker, wjStart) + dxEndMarker.length;
    const keyGenCode = apicore.substring(wjStart, dxEnd);

    // Dynamically detect all deobfuscator aliases used in keyGenCode
    const aliases = new Set(
        [...keyGenCode.matchAll(/\b([a-zA-Z0-9_$]+)\(\d+\)/g)]
            .map(match => match[1])
            .filter(name => !BUILTINS.has(name))
    );
    const aliasDefs = Array.from(aliases).map(a => `var ${a} = ${deobfFunc};`).join('\n');

    // Find the object name assigned at the end of keyGenCode: e.g. const tU={};
    const objMatch = keyGenCode.match(/const ([a-zA-Z0-9_$]+)=\{\};\1\[[a-zA-Z0-9_$]+\(\d+\)\]=/);
    if (!objMatch) throw new Error('Could not identify key object in key generator');
    const objName = objMatch[1];

    const runner = `
${arrayCode};
${deobfCode};
var ${deobfAlias} = ${deobfFunc};
${aliasDefs}
${iifeCode}

${keyGenCode}

global.keyObj = ${objName};
`;

    const ctx = {
        global: {},
        console,
        TextEncoder,
        TextDecoder,
        Uint8Array,
        Uint32Array,
        Int8Array,
        Math,
        String,
        Object
    };

    vm.createContext(ctx);
    vm.runInContext(runner, ctx);

    let version = null;
    let keyBytes = null;
    for (const [k, v] of Object.entries(ctx.global.keyObj || {})) {
        if (typeof v === 'string' && v.length >= 2 && v.length <= 6) {
            version = v;
        } else if (typeof v === 'function') {
            keyBytes = v();
        }
    }

    if (!version || !keyBytes || keyBytes.length !== 1088) {
        throw new Error(`Invalid extracted key (version: ${version}, bytes: ${keyBytes?.length})`);
    }

    const keyB64 = Buffer.from(keyBytes).toString('base64');
    console.log(`[Sync] Successfully extracted Version: '${version}', Key length: ${keyBytes.length}`);
    return { version, key: keyB64 };
}

async function main() {
    let currentConfig = null;
    if (fs.existsSync(KEYS_PATH)) {
        try {
            currentConfig = JSON.parse(fs.readFileSync(KEYS_PATH, 'utf8'));
        } catch (_) {}
    }

    if (currentConfig && currentConfig.version && currentConfig.key) {
        console.log(`[Sync] Testing current key config (version: ${currentConfig.version})...`);
        const isValid = await testKey(currentConfig.version, currentConfig.key);
        if (isValid) {
            console.log('[Sync] Current key is valid and working! No update needed.');
            process.exit(0);
        }
        console.log('[Sync] Current key is retired or invalid. Proceeding to rotate...');
    } else {
        console.log('[Sync] No existing key config found. Performing initial extraction...');
    }

    const newConfig = await extractKeyFromComix();
    console.log(`[Sync] Testing newly extracted key (version: ${newConfig.version})...`);
    const isValid = await testKey(newConfig.version, newConfig.key);
    if (!isValid) {
        throw new Error(`Extracted key for version '${newConfig.version}' failed live API verification!`);
    }

    console.log(`[Sync] Verification successful! Updating comix_keys.json...`);
    const payload = JSON.stringify({
        version: newConfig.version,
        key: newConfig.key,
        updated_at: Date.now()
    }, null, 2);

    fs.writeFileSync(KEYS_PATH, payload, 'utf8');
    if (fs.existsSync(path.dirname(BUNDLES_KEYS_PATH))) {
        fs.writeFileSync(BUNDLES_KEYS_PATH, payload, 'utf8');
    }

    console.log('[Sync] Successfully updated comix_keys.json!');
    // Output for GitHub Actions
    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, 'key_updated=true\n');
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${newConfig.version}\n`);
    }
}

main().catch(err => {
    console.error('[Sync Error]:', err);
    process.exit(1);
});
