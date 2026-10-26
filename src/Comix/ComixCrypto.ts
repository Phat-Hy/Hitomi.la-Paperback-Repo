/* SPDX-License-Identifier: GPL-3.0-or-later */

const KEY_B64 = 'Wkoyd1UsY8yBSNvVjtSqXQ/tabtd4UFlywK5mx3rgGeWx5bucjRUYBckqSofP15PNkOG/dY0ltf7UxsU1MrtARXO5layePx3sUiScDE482f4SPXceDpLLbdn6ypReoFd1qsL7cAkQtem2+Hd+zGnwRo6FvPgDbs8Zrm7Jh/RFOV4I/XcynqdVDBETI7aB9F19hkmzhsulStMa22ra4WsNAVzWPL5mDNR8AUvWr/k9arDE7OzeFWYe1OuXGRnRZ53ulsrr87BdzUSe4VWSF8m4Je0m8FLF2TBpfjLsvS5aFwkZUptGSgF3eqpUCNx1G1iAWkvjPqwNnOdwKXhVyNk0x89EIkvjUHKVQiojcD5FPteFF0PaqeEQn2g33pV2xXrzlcrJpD8EEL2VM8GzUvulmpKTz5XowutYvyA7TNiUeJGlY5WxTKs/rasn1eO4ZvzH8ESN6QR2YKC1gZivQ4QYyp5NkPgVJ1/+kHsIE9iGuYMbZsRP6mad/bhsJ1H0XKLqBor+SI5bc8NwpxgKOLRCiu19efTFfYadIaptBrblmcFNCxGPoG7IlAouTWCF779Qq80IvCyjDXBqEMqgMBkXUgXa2q1AZ6s+jVbrlQ78bnEZWehFOejJmdNO4I7BPR7FHbNKjymoZHOdT49UhhOipzSXiFKilWkDlFe36RPfu6Ge2Slv30IRYol5pPQhGVK3T0zeixO1btja7x5pa786SI7Edj6D03ej8WlT6kRCq9AFz7UEK8RpBYBfE7mpRxlUm/NEnRL5WIkGPC9q1GKiNEzVNxedqJNNkynD/a1osKmorZg58qYCZ5PJDSr9McXdYQ8RT0i4EwLssoE9nkQ5CnBr1i2Q3pktp9SRd0/7DWBHeQNA8LLMka8FwDJVFlvl1EBEXw++qe2J5vCA3ny4YNCxalDcGkq9Nq2hSPwuDnNVKurPRZ8nPECIUa7i/L+fAIzJ+WGb+QZMvQFoHv3rAjw1+s4qeSWMPz5QKXm6vedcIiL7StF0TaXWz8goFm9byEH353UJldivOfZAYMntZGfr3q7k6FaV1EZG9YqignRk5Qv2UeUuIm4YTrzXSDSovczFuS7Rtz2uD4yyX8N7gFHya0ldAtrz6SergoX1RVCcKNFxBTClk5OM5DwTAaItxBtGEcPLL6q3RZ7/01gLP/2tfHx7tLZ13a8fKtb6nA8h+V/2tYYsMbEjn8r4a5Qldv55paSQ3661IE4kngTrzdqUhkNXAfVD+9mhMgSM7ZuuYmm8UZk7r3yJgweXibl1EQJCgV09kJEbXOdn6ktZipa48loo7D4rPSYnHhSL/KWwBWp4IwnBJWzLE1Qtepx1CcEY+uQzJIV+WvSuafHZmT1VzrvoSzCTwfy0A5P0UFUP9XgfJCrrrst29AbXQZddpTFIOfvGTp8W9ac/kNWaI0d1JDm3f+JII4zP/wI+3M='
const VERSION = 'j22'
const Fj = 1024
const Hj = new Uint32Array([
    1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221,
    3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580,
    3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986,
    2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895,
    666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037,
    2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344,
    430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779,
    1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298
])
const Nj = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

// Pure base64 decoder: zero dependency on atob or Buffer
function base64ToUint8(b64: string): Uint8Array {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    const clean = b64.replace(/=+$/, '')
    const bytes: number[] = []
    let buffer = 0
    let bits = 0
    for (let i = 0; i < clean.length; i++) {
        const val = chars.indexOf(clean.charAt(i))
        if (val === -1) continue
        buffer = (buffer << 6) | val
        bits += 6
        if (bits >= 8) {
            bits -= 8
            bytes.push((buffer >> bits) & 0xff)
        }
    }
    return new Uint8Array(bytes)
}

const keyBytes = base64ToUint8(KEY_B64)

function Ij(Z: number, n: number): number {
    return Z >>> n | Z << 32 - n
}

function Jj(Z: Uint32Array, U: Uint8Array, x: number): void {
    const E = new Uint32Array(64)
    for (let P = 0; P < 16; P++) {
        const R = x + 4 * P
        E[P] = U[R] << 24 | U[R + 1] << 16 | U[R + 2] << 8 | U[R + 3]
    }
    for (let o = 16; o < 64; o++) {
        const W = E[o - 15], M = Ij(W, 7) ^ Ij(W, 18) ^ W >>> 3, u = E[o - 2], y = Ij(u, 17) ^ Ij(u, 19) ^ u >>> 10
        E[o] = E[o - 16] + M + E[o - 7] + y | 0
    }
    let G = Z[0], D = Z[1], p = Z[2], B = Z[3], X = Z[4], r = Z[5], A = Z[6], I = Z[7]
    for (let N = 0; N < 64; N++) {
        const L = I + (Ij(X, 6) ^ Ij(X, 11) ^ Ij(X, 25)) + (X & r ^ ~X & A) + Hj[N] + E[N] | 0
        const t = (Ij(G, 2) ^ Ij(G, 13) ^ Ij(G, 22)) + (G & D ^ G & p ^ D & p) | 0
        I = A; A = r; r = X; X = B + L | 0; B = p; p = D; D = G; G = L + t | 0
    }
    Z[0] = Z[0] + G | 0; Z[1] = Z[1] + D | 0; Z[2] = Z[2] + p | 0; Z[3] = Z[3] + B | 0
    Z[4] = Z[4] + X | 0; Z[5] = Z[5] + r | 0; Z[6] = Z[6] + A | 0; Z[7] = Z[7] + I | 0
}

function Kj(Z: Uint32Array, n: Uint8Array, U: number): Uint8Array {
    const x = Uint32Array.from(Z)
    const E = U + n.length
    let G = n.length + 1
    for (; G % 64 != 56;) G++
    const D = new Uint8Array(G + 8)
    D.set(n)
    D[n.length] = 128
    const p = 8 * E, B = Math.floor(p / 4294967296), X = p >>> 0, r = D.length - 8
    D[r] = B >>> 24 & 255; D[r + 1] = B >>> 16 & 255; D[r + 2] = B >>> 8 & 255; D[r + 3] = 255 & B
    D[r + 4] = X >>> 24 & 255; D[r + 5] = X >>> 16 & 255; D[r + 6] = X >>> 8 & 255; D[r + 7] = 255 & X
    for (let I = 0; I < D.length; I += 64) Jj(x, D, I)
    const A = new Uint8Array(32)
    for (let P = 0; P < 8; P++) {
        A[4 * P] = x[P] >>> 24 & 255
        A[4 * P + 1] = x[P] >>> 16 & 255
        A[4 * P + 2] = x[P] >>> 8 & 255
        A[4 * P + 3] = 255 & x[P]
    }
    return A
}

function Lj(Z: Uint8Array, n: number): Uint32Array {
    const U = new Uint32Array(8)
    for (let x = 0; x < 8; x++) {
        const E = n + 4 * x
        U[x] = Z[E] << 24 | Z[E + 1] << 16 | Z[E + 2] << 8 | Z[E + 3]
    }
    return U
}

function stringToUtf8(str: string): Uint8Array {
    if (typeof TextEncoder !== 'undefined') {
        try {
            return (new TextEncoder()).encode(str)
        } catch (_) {}
    }
    const utf8: number[] = []
    for (let i = 0; i < str.length; i++) {
        let charcode = str.charCodeAt(i)
        if (charcode < 0x80) utf8.push(charcode)
        else if (charcode < 0x800) {
            utf8.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f))
        } else if (charcode < 0xd800 || charcode >= 0xe000) {
            utf8.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f))
        } else {
            i++
            charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff))
            utf8.push(0xf0 | (charcode >> 18), 0x80 | ((charcode >> 12) & 0x3f), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f))
        }
    }
    return new Uint8Array(utf8)
}

function Wj(key: Uint8Array, path: string): string {
    const U = stringToUtf8(path)
    const x = Kj(Lj(key, 0), U, 64)
    const hash = Kj(Lj(key, 32), x, 64)
    let n = ''
    for (let i = 0; i < hash.length; i += 3) {
        const b0 = hash[i], b1 = hash[i + 1], b2 = hash[i + 2]
        n += Nj[b0 >> 2] + Nj[(3 & b0) << 4 | b1 >> 4]
        if (i + 1 < hash.length) n += Nj[(15 & b1) << 2 | b2 >> 6]
        if (i + 2 < hash.length) n += Nj[63 & b2]
    }
    return n.slice(0, 16)
}

export function signPath(path: string): string {
    return VERSION + '.' + Wj(keyBytes, path)
}

let Pj: Int8Array | null = null
export function decryptPayload<T = any>(encStr: string): T {
    if (null === Pj) {
        Pj = new Int8Array(256).fill(-1)
        for (let A = 0; A < 64; A++) Pj[Nj.charCodeAt(A)] = A
        Pj[43] = 62; Pj[47] = 63
    }
    const U = Pj
    const x = stringToUtf8(encStr)
    const E = new Uint8Array(9 + (3 * x.length >> 2) & -4)
    const G = -4 & x.length
    let D = 2, p = 0
    for (; p < G; p += 4) {
        const I = U[x[p]] << 18 | U[x[p + 1]] << 12 | U[x[p + 2]] << 6 | U[x[p + 3]]
        if (I < 0) break
        E[D] = I >> 16; E[D + 1] = I >> 8; E[D + 2] = I
        D += 3
    }
    let B = 0, X = 0
    for (; p < x.length; p++) {
        const P = U[x[p]]
        if (P >= 0) {
            B = 65535 & (B << 6 | P)
            X += 6
            if (X >= 8) {
                X -= 8
                E[D++] = B >> X
            }
        }
    }

    if (D < 4) throw new Error('Protected response is too short')

    const xOffset = (E[2] << 8 | E[3]) % Fj
    const keySub = keyBytes.subarray(64, 1088)
    const GBuf = new Uint8Array(Fj)
    GBuf.set(keySub.subarray(xOffset))
    GBuf.set(keySub.subarray(0, xOffset), Fj - xOffset)

    const D32 = new Uint32Array(E.buffer, E.byteOffset, Math.floor(D / 4))
    const p32 = new Uint32Array(GBuf.buffer, GBuf.byteOffset, 256)
    const BWords = D >> 2
    for (let r = 1; r < BWords; r++) {
        D32[r] = D32[r] ^ p32[(r - 1) % 256]
    }
    for (let I = BWords << 2; I < D; I++) {
        E[I] = E[I] ^ GBuf[(I - 4) % Fj]
    }

    const decryptedBytes = E.subarray(4, D)
    let jsonStr = ''
    if (typeof TextDecoder !== 'undefined') {
        try {
            jsonStr = new TextDecoder().decode(decryptedBytes)
        } catch (_) {
            jsonStr = ''
        }
    }
    if (!jsonStr) {
        // Fallback UTF-8 decoder
        for (let i = 0; i < decryptedBytes.length; i++) {
            const byte1 = decryptedBytes[i]
            if (byte1 < 0x80) {
                jsonStr += String.fromCharCode(byte1)
            } else if (byte1 >= 0xc0 && byte1 < 0xe0) {
                const byte2 = decryptedBytes[++i]
                jsonStr += String.fromCharCode(((byte1 & 0x1f) << 6) | (byte2 & 0x3f))
            } else if (byte1 >= 0xe0 && byte1 < 0xf0) {
                const byte2 = decryptedBytes[++i]
                const byte3 = decryptedBytes[++i]
                jsonStr += String.fromCharCode(((byte1 & 0x0f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f))
            } else if (byte1 >= 0xf0) {
                const byte2 = decryptedBytes[++i]
                const byte3 = decryptedBytes[++i]
                const byte4 = decryptedBytes[++i]
                const codePoint = ((byte1 & 0x07) << 18) | ((byte2 & 0x3f) << 12) | ((byte3 & 0x3f) << 6) | (byte4 & 0x3f)
                jsonStr += String.fromCodePoint(codePoint)
            }
        }
    }
    return JSON.parse(jsonStr)
}

export function serializeParams(params: Record<string, any>, encode = true): string {
    const parts: string[] = []
    function enc(prefix: string, val: any): void {
        if (val === null || val === undefined) return
        if (Array.isArray(val)) {
            val.forEach((item, idx) => enc(`${prefix}[${idx}]`, item))
        } else if (typeof val === "object") {
            const sortedKeys = Object.keys(val).sort()
            for (const k of sortedKeys) {
                enc(prefix ? `${prefix}[${k}]` : k, val[k])
            }
        } else {
            parts.push(`${prefix}=${encode ? encodeURIComponent(String(val)) : String(val)}`)
        }
    }

    const sortedKeys = Object.keys(params).filter(k => k !== "_").sort()
    for (const k of sortedKeys) {
        enc(k, params[k])
    }
    return parts.join("&")
}
