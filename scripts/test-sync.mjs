#!/usr/bin/env node
/**
 * Regression guard for scripts/sync-comix-key.js.
 *
 * Offline checks always run: signing vectors, provider URL builders, response
 * validation, archive/gzip handling. The live block exercises the real
 * comix.to bundle through the transport chain and is SKIPPED (not failed) when
 * no transport can reach the site — a network outage must not turn the build
 * red, but a reachable site that yields a wrong key must.
 *
 * Usage: node scripts/test-sync.mjs [--offline]
 */

import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const sync = require('./sync-comix-key.js');
const { signPath, buildProxyUrl, toTranslateUrl, validateResponse, decodeBody, unwrapArchiveUrl } = sync;

const OFFLINE = process.argv.includes('--offline');

test('signing matches the committed vectors', () => {
    const ramp = new Uint8Array(1088).map((_, index) => index & 0xff);
    const flat = new Uint8Array(1088).fill(7);

    // Locked vectors: any accidental change to the SHA-256 port changes these.
    assert.equal(signPath('abc', ramp, '/manga?limit=20&page=1'), 'abc.WFr9cyRizhfQ8Xx9');
    assert.equal(signPath('xyz', ramp, '/manga/43'), 'xyz.xJ46q5sE85bu6k-p');
    assert.equal(signPath('abc', flat, '/manga?limit=20&page=1'), 'abc.xi_9invmUNDx2cyv');
});

test('token shape follows the comix.to contract', () => {
    const token = signPath('sno', new Uint8Array(1088).fill(3), '/manga?limit=20&page=1');
    const [version, digest] = token.split('.');
    assert.equal(version, 'sno');
    assert.equal(digest.length, 16);
    assert.match(digest, /^[A-Za-z0-9_-]+$/);
    assert.notEqual(token, signPath('sno', new Uint8Array(1088).fill(4), '/manga?limit=20&page=1'));
});

test('proxy URL templates are built exactly', () => {
    const original = process.env.COMIX_PROXY_URL;
    try {
        process.env.COMIX_PROXY_URL = 'https://w.example.dev/?u={url_encoded}';
        assert.equal(
            buildProxyUrl('https://comix.to/a?b=1'),
            'https://w.example.dev/?u=' + encodeURIComponent('https://comix.to/a?b=1')
        );

        process.env.COMIX_PROXY_URL = 'https://w.example.dev/proxy/{url}';
        assert.equal(buildProxyUrl('https://comix.to/a'), 'https://w.example.dev/proxy/https://comix.to/a');

        process.env.COMIX_PROXY_URL = 'https://w.example.dev/';
        assert.equal(buildProxyUrl('https://comix.to/a'), 'https://w.example.dev/https://comix.to/a');

        delete process.env.COMIX_PROXY_URL;
        assert.equal(buildProxyUrl('https://comix.to/a'), null);
    } finally {
        if (original === undefined) delete process.env.COMIX_PROXY_URL;
        else process.env.COMIX_PROXY_URL = original;
    }
});

test('translate URL rewriting keeps path and query', () => {
    const proxied = toTranslateUrl('https://comix.to/assets/build/x/dist/apicore-a-b.js?_=1');
    assert.ok(proxied.startsWith('https://comix-to.translate.goog/assets/build/x/dist/apicore-a-b.js?'), proxied);
    assert.match(proxied, /_x_tr_sl=auto/);
    assert.match(proxied, /_x_tr_tl=en/);
    assert.match(proxied, /[?&]_=1/);
    assert.equal(toTranslateUrl('https://example.com/'), null);
});

test('archive URLs are unwrapped back to the origin', () => {
    assert.equal(
        unwrapArchiveUrl('https://web.archive.org/web/20261120074256id_/https://comix.to/assets/a.js'),
        'https://comix.to/assets/a.js'
    );
    assert.equal(
        unwrapArchiveUrl('http://web.archive.org/web/20261120074256/https://comix.to/'),
        'https://comix.to/'
    );
    assert.equal(unwrapArchiveUrl('https://comix.to/'), 'https://comix.to/');
});

test('gzip and brotli replay bodies are decoded', () => {
    const text = 'Uint8Array(1088) and some javascript '.repeat(50);
    assert.equal(decodeBody(zlib.gzipSync(Buffer.from(text)), ''), text, 'gzip sniffed from magic bytes');
    assert.equal(decodeBody(zlib.gzipSync(Buffer.from(text)), 'gzip'), text, 'declared gzip');
    assert.equal(decodeBody(zlib.brotliCompressSync(Buffer.from(text)), 'br'), text, 'declared brotli');
    assert.equal(decodeBody(Buffer.from(text), ''), text, 'identity');
    assert.equal(decodeBody(Buffer.alloc(0), ''), '');
});

test('response validation rejects challenges and truncated bodies', () => {
    const challenge = { status: 403, data: '<html><title>Just a moment...</title></html>', headers: {} };
    assert.equal(validateResponse('json', challenge), 'cloudflare challenge');

    assert.equal(validateResponse('json', { status: 200, data: '{"status":"ok"}', headers: {} }), null);
    assert.equal(validateResponse('json', { status: 403, data: '{"error":"key_retired"}', headers: {} }), null);
    assert.match(validateResponse('json', { status: 500, data: 'boom', headers: {} }), /unexpected status 500/);

    assert.match(validateResponse('html', { status: 200, data: '<html>short</html>', headers: {} }), /html too short/);
    assert.equal(validateResponse('html', { status: 200, data: '<script src="/main-a.js"></script>' + 'x'.repeat(3000), headers: {} }), null);

    assert.match(validateResponse('js', { status: 200, data: 'function a(){return 1}', headers: {} }), /js too short/);
    assert.equal(validateResponse('js', { status: 200, data: 'function a(){return 1}'.repeat(400), headers: {} }), null);
});

test('relaxed extraction survives a perturbed prologue', async (t) => {
    if (OFFLINE) {
        t.skip('live bundle check disabled by --offline');
        return;
    }

    let apicore;
    try {
        apicore = await fetchLiveApicore();
    } catch (err) {
        t.skip(`comix.to not reachable from this runner (${err.message})`);
        return;
    }

    const primary = sync.extractKeyFromApicore(apicore);
    assert.equal(primary.strategy, 'primary');
    assert.equal(Buffer.from(primary.key, 'base64').length, 1088);

    const strict = apicore.match(
        /!function\s*\(\)\s*\{const\s+([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+(?:\(\))?),\s*([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+(?:\(\))?);/
    );
    assert.ok(strict, 'could not locate the obfuscator prologue to perturb');

    const body = strict[0].replace(/^!function\s*\(\)\s*\{/, '').replace(/;$/, '');
    const [left, right] = body.split(',');
    const perturbed = apicore.replace(strict[0], `!function(){${left};${right};`);
    assert.notEqual(perturbed, apicore);

    const relaxed = sync.extractKeyFromApicore(perturbed);
    assert.equal(relaxed.strategy, 'relaxed');
    assert.equal(relaxed.key, primary.key, 'relaxed strategy must reproduce the primary key byte for byte');
    assert.equal(relaxed.version, primary.version);
});

test('live key still signs a working API request', async (t) => {
    if (OFFLINE) {
        t.skip('live API check disabled by --offline');
        return;
    }

    const config = JSON.parse(fs.readFileSync(new URL('../comix_keys.json', import.meta.url), 'utf8'));
    let result;
    try {
        result = await sync.testKey(config.version, config.key);
    } catch (err) {
        t.skip(`comix.to not reachable from this runner (${err.message})`);
        return;
    }

    if (result.valid === null) {
        t.skip(`transports unavailable: ${result.reason}`);
        return;
    }
    assert.equal(result.valid, true, `key ${config.version} is rejected by the live API (${result.reason})`);
});

async function fetchLiveApicore() {
    const home = await sync.fetchResource('https://comix.to/', 'html', {
        label: 'home',
        accept: (res) => /main-[a-zA-Z0-9_.-]+\.js/.test(res.data)
    });
    const mainPath = home.data.match(/<script[^>]+src="([^"]*main-[^"]+\.js)"/i)[1];
    const mainUrl = new URL(mainPath, 'https://comix.to/').href;

    const main = await sync.fetchResource(mainUrl, 'js', {
        label: 'main.js',
        accept: (res) => /apicore-[a-zA-Z0-9_.-]+\.js/.test(res.data)
    });
    const apicorePath = main.data.match(/["'](\.?\/?[^"']*apicore-[a-zA-Z0-9_.-]+\.js)["']/)[1];
    const apicoreUrl = new URL(apicorePath.replace(/^\.\//, '/'), mainUrl).href;

    const apicore = await sync.fetchResource(apicoreUrl, 'js', {
        label: 'apicore.js',
        accept: (res) => res.data.includes('Uint8Array(1088)')
    });
    return apicore.data;
}
