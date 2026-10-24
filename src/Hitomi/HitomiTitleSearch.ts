/* SPDX-License-Identifier: GPL-3.0-or-later */

import { RequestManager, Response } from '@paperback/types'

const HITOMI_DOMAIN = 'https://hitomi.la'
const LTN_DOMAIN = 'https://ltn.gold-usergeneratedcontent.net'
const GALLERIES_INDEX_DIR = 'galleriesindex'
const B = 16
const MAX_NODE_SIZE = 464
const MAX_DATA_RANGE_BYTES = 1000000 // Allow up to 1 MB data chunk download

let cachedVersion: string | null = null
let cachedVersionTs = 0
const VERSION_TTL_MS = 5 * 60 * 1000

const STOP_WORDS = new Set([
    'the', 'and', 'a', 'an', 'in', 'on', 'of', 'for', 'to', 'at', 'by',
    'from', 'with', 'is', 'it', 'as', 'be', 'are', 'was', 'or', 'no'
])

function sha256(input: Uint8Array): Uint8Array {
    const K: number[] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
        0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
        0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
        0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
        0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
        0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
        0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ]

    const msgLen = input.length
    const bitLen = msgLen * 8
    const padLen = (64 - ((msgLen + 9) % 64)) % 64
    const totalLen = msgLen + 1 + padLen + 8
    const padded = new Uint8Array(totalLen)
    padded.set(input)
    padded[msgLen] = 0x80
    const dv = new DataView(padded.buffer)
    dv.setUint32(totalLen - 4, bitLen, false)

    let h0 = 0x6a09e667
    let h1 = 0xbb67ae85
    let h2 = 0x3c6ef372
    let h3 = 0xa54ff53a
    let h4 = 0x510e527f
    let h5 = 0x9b05688c
    let h6 = 0x1f83d9ab
    let h7 = 0x5be0cd19

    const w = new Int32Array(64)

    for (let offset = 0; offset < totalLen; offset += 64) {
        for (let i = 0; i < 16; i++) {
            w[i] = dv.getInt32(offset + i * 4, false)
        }
        for (let i = 16; i < 64; i++) {
            const s0 = (((w[i - 15]! >>> 7) | (w[i - 15]! << 25)) ^ ((w[i - 15]! >>> 18) | (w[i - 15]! << 14)) ^ (w[i - 15]! >>> 3)) | 0
            const s1 = (((w[i - 2]! >>> 17) | (w[i - 2]! << 15)) ^ ((w[i - 2]! >>> 19) | (w[i - 2]! << 13)) ^ (w[i - 2]! >>> 10)) | 0
            w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0
        }

        let a = h0
        let b = h1
        let c = h2
        let d = h3
        let e = h4
        let f = h5
        let g = h6
        let h = h7

        for (let i = 0; i < 64; i++) {
            const S1 = (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) | 0
            const ch = ((e & f) ^ (~e & g)) | 0
            const temp1 = (h + S1 + ch + K[i]! + w[i]!) | 0
            const S0 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) | 0
            const maj = ((a & b) ^ (a & c) ^ (b & c)) | 0
            const temp2 = (S0 + maj) | 0

            h = g
            g = f
            f = e
            e = (d + temp1) | 0
            d = c
            c = b
            b = a
            a = (temp1 + temp2) | 0
        }

        h0 = (h0 + a) | 0
        h1 = (h1 + b) | 0
        h2 = (h2 + c) | 0
        h3 = (h3 + d) | 0
        h4 = (h4 + e) | 0
        h5 = (h5 + f) | 0
        h6 = (h6 + g) | 0
        h7 = (h7 + h) | 0
    }

    const result = new Uint8Array(32)
    const rv = new DataView(result.buffer)
    rv.setInt32(0, h0, false)
    rv.setInt32(4, h1, false)
    rv.setInt32(8, h2, false)
    rv.setInt32(12, h3, false)
    rv.setInt32(16, h4, false)
    rv.setInt32(20, h5, false)
    rv.setInt32(24, h6, false)
    rv.setInt32(28, h7, false)
    return result
}

function hashTerm(term: string): Uint8Array {
    const bytes: number[] = []
    for (let i = 0; i < term.length; i++) {
        const codePoint = term.codePointAt(i) ?? 0
        if (codePoint > 0xffff) i++

        if (codePoint <= 0x7f) {
            bytes.push(codePoint)
        } else if (codePoint <= 0x7ff) {
            bytes.push(0xc0 | (codePoint >> 6))
            bytes.push(0x80 | (codePoint & 0x3f))
        } else if (codePoint <= 0xffff) {
            bytes.push(0xe0 | (codePoint >> 12))
            bytes.push(0x80 | ((codePoint >> 6) & 0x3f))
            bytes.push(0x80 | (codePoint & 0x3f))
        } else {
            bytes.push(0xf0 | (codePoint >> 18))
            bytes.push(0x80 | ((codePoint >> 12) & 0x3f))
            bytes.push(0x80 | ((codePoint >> 6) & 0x3f))
            bytes.push(0x80 | (codePoint & 0x3f))
        }
    }
    return sha256(new Uint8Array(bytes)).slice(0, 4)
}

function decodeBase64(b64: string): Uint8Array {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    const lookup = new Uint8Array(256)
    for (let i = 0; i < chars.length; i++) {
        lookup[chars.charCodeAt(i)] = i
    }
    const clean = b64.replace(/[^A-Za-z0-9+/]/g, '')
    const len = clean.length
    if (len === 0) return new Uint8Array(0)
    const placeHolders = clean.charAt(len - 2) === '=' ? 2 : (clean.charAt(len - 1) === '=' ? 1 : 0)
    const bytesLen = (len * 3) / 4 - placeHolders
    const u8 = new Uint8Array(bytesLen)
    let cur = 0
    for (let i = 0; i < len; i += 4) {
        const a = lookup[clean.charCodeAt(i)] ?? 0
        const b = lookup[clean.charCodeAt(i + 1)] ?? 0
        const c = lookup[clean.charCodeAt(i + 2)] ?? 0
        const d = lookup[clean.charCodeAt(i + 3)] ?? 0
        u8[cur++] = (a << 2) | (b >> 4)
        if (cur < bytesLen) u8[cur++] = ((b & 15) << 4) | (c >> 2)
        if (cur < bytesLen) u8[cur++] = ((c & 3) << 6) | (d & 63)
    }
    return u8
}

function tryExtractBytes(input: any): Uint8Array | null {
    if (!input) return null

    // 1. Direct Uint8Array / TypedArray / ArrayBuffer
    if (input instanceof Uint8Array) return input
    if (ArrayBuffer.isView(input)) {
        return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    }
    if (input instanceof ArrayBuffer) {
        return new Uint8Array(input)
    }
    if (Array.isArray(input)) {
        return new Uint8Array(input)
    }

    // 2. Official Paperback App.createByteArray bridge (if available)
    if (typeof (App as any)?.createByteArray === 'function') {
        try {
            const arr = (App as any).createByteArray(input)
            if (arr && arr.length > 0) return arr instanceof Uint8Array ? arr : new Uint8Array(arr)
        } catch {}
    }

    // 3. Nested buffer/data/byteArray
    if (input.buffer instanceof ArrayBuffer) {
        return new Uint8Array(input.buffer, input.byteOffset ?? 0, input.byteLength ?? input.length ?? 0)
    }
    if (input.byteArray instanceof Uint8Array) return input.byteArray
    if (input.data instanceof Uint8Array) return input.data

    // 4. If input has indexed numeric elements
    const count = input.length ?? input.count
    if (typeof count === 'number' && count > 0 && typeof input[0] === 'number') {
        const u8 = new Uint8Array(count)
        for (let i = 0; i < count; i++) {
            u8[i] = (input[i] ?? 0) & 0xff
        }
        return u8
    }

    // 5. If input is a string or has toString()
    let str: string | null = null
    if (typeof input === 'string') {
        str = input
    } else if (typeof input.toString === 'function') {
        try {
            const s = input.toString()
            if (typeof s === 'string' && s !== '[object Object]') {
                str = s
            }
        } catch {}
    }

    if (str && str.length > 0) {
        const trimmed = str.trim()
        // Check if base64 encoded
        if (/^[A-Za-z0-9+/=\r\n]+$/.test(trimmed) && trimmed.length % 4 === 0 && !trimmed.includes('\0')) {
            try {
                const decoded = decodeBase64(trimmed)
                if (decoded.length > 0) return decoded
            } catch {}
        }
        // Direct character codes (latin1 / binary string)
        const u8 = new Uint8Array(str.length)
        for (let i = 0; i < str.length; i++) {
            u8[i] = str.charCodeAt(i) & 0xff
        }
        return u8
    }

    return null
}

function responseToUint8Array(response: Response): Uint8Array {
    if (response.rawData) {
        const fromRaw = tryExtractBytes(response.rawData)
        if (fromRaw && fromRaw.length > 0) return fromRaw
    }
    if (response.data) {
        const fromData = tryExtractBytes(response.data)
        if (fromData && fromData.length > 0) return fromData
    }
    return new Uint8Array(0)
}

interface BTreeNode {
    keys: Uint8Array[];
    datas: [number, number][];
    subnodeAddresses: number[];
}

function decodeNode(data: Uint8Array): BTreeNode | null {
    if (!data || data.length === 0) return null
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    let pos = 0
    const has = (bytes: number) => pos + bytes <= data.length

    if (!has(4)) return null
    const numberOfKeys = view.getInt32(pos, false)
    pos += 4
    if (numberOfKeys < 0 || numberOfKeys > B) return null

    const keys: Uint8Array[] = []
    for (let i = 0; i < numberOfKeys; i++) {
        if (!has(4)) return null
        const keySize = view.getInt32(pos, false)
        pos += 4
        if (keySize <= 0 || keySize > 32 || !has(keySize)) return null
        keys.push(data.slice(pos, pos + keySize))
        pos += keySize
    }

    if (!has(4)) return null
    const numberOfDatas = view.getInt32(pos, false)
    pos += 4
    if (numberOfDatas < 0 || numberOfDatas > B) return null

    const datas: [number, number][] = []
    for (let i = 0; i < numberOfDatas; i++) {
        if (!has(12)) return null
        const left = view.getUint32(pos, false)
        const right = view.getUint32(pos + 4, false)
        const offset = 2 ** 32 * left + right
        pos += 8
        const length = view.getInt32(pos, false)
        pos += 4
        datas.push([offset, length])
    }

    const subnodeAddresses: number[] = []
    for (let i = 0; i < B + 1; i++) {
        if (!has(8)) return null
        const left = view.getUint32(pos, false)
        const right = view.getUint32(pos + 4, false)
        const subnodeAddress = 2 ** 32 * left + right
        pos += 8
        subnodeAddresses.push(subnodeAddress)
    }

    return { keys, datas, subnodeAddresses }
}

function compareArrayBuffers(dv1: Uint8Array, dv2: Uint8Array): number {
    const top = Math.min(dv1.byteLength, dv2.byteLength)
    for (let i = 0; i < top; i++) {
        if (dv1[i]! < dv2[i]!) return -1
        else if (dv1[i]! > dv2[i]!) return 1
    }
    return 0
}

function locateKey(key: Uint8Array, node: BTreeNode): [boolean, number] {
    let cmpResult = -1
    let i: number
    for (i = 0; i < node.keys.length; i++) {
        cmpResult = compareArrayBuffers(key, node.keys[i]!)
        if (cmpResult <= 0) break
    }
    return [!cmpResult, i]
}

function isLeaf(node: BTreeNode): boolean {
    return node.subnodeAddresses.every(addr => !addr)
}

async function bSearch(
    indexUrl: string,
    key: Uint8Array,
    node: BTreeNode,
    fetchRange: (url: string, start: number, end: number) => Promise<Uint8Array>
): Promise<[number, number] | null> {
    const [found, where] = locateKey(key, node)
    if (found) return node.datas[where] ?? null
    if (isLeaf(node)) return null

    const childAddr = node.subnodeAddresses[where]
    if (!childAddr) return null

    const nodedata = await fetchRange(indexUrl, childAddr, childAddr + MAX_NODE_SIZE - 1)
    const childNode = decodeNode(nodedata)
    if (!childNode) return null

    return bSearch(indexUrl, key, childNode, fetchRange)
}

function parseGalleryIdsFromData(data: Uint8Array): number[] {
    if (!data || data.length < 4) return []
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const count = view.getInt32(0, false)
    if (count <= 0 || count > 10000000) return []

    const needed = 4 + count * 4
    if (data.length < needed) return []

    const ids: number[] = []
    for (let i = 0; i < count; i++) {
        ids.push(view.getInt32(4 + i * 4, false))
    }
    return ids
}

async function getGalleriesIndexVersion(
    requestManager: RequestManager
): Promise<string> {
    const now = Date.now()
    if (cachedVersion && now - cachedVersionTs < VERSION_TTL_MS) {
        return cachedVersion
    }

    try {
        const req = App.createRequest({
            url: `${LTN_DOMAIN}/${GALLERIES_INDEX_DIR}/version?_=${now}`,
            method: 'GET'
        })
        const res = await requestManager.schedule(req, 1)
        const text = (res.data || '').trim()
        if (text && /^\d+$/.test(text)) {
            cachedVersion = text
            cachedVersionTs = now
            return text
        }
    } catch {}

    return '1792858349' // Fallback to current known galleries index version
}

export async function searchGalleryTitlesHitomi(
    query: string,
    requestManager: RequestManager
): Promise<number[]> {
    const rawTerms = query.toLowerCase().trim().split(/\s+/).filter(t => t.length > 0)
    if (rawTerms.length === 0) return []

    const ver = await getGalleriesIndexVersion(requestManager)
    const indexUrl = `${LTN_DOMAIN}/${GALLERIES_INDEX_DIR}/galleries.${ver}.index`
    const dataUrl = `${LTN_DOMAIN}/${GALLERIES_INDEX_DIR}/galleries.${ver}.data`

    // In-memory node cache for the current search session (prevents duplicate downloads of root and parent nodes)
    const nodeCache = new Map<string, Uint8Array>()

    const fetchRange = async (url: string, start: number, end: number): Promise<Uint8Array> => {
        const cacheKey = `${url}:${start}-${end}`
        const cached = nodeCache.get(cacheKey)
        if (cached) return cached

        // Explicit byte-range query parameter to prevent iOS URLSession / URLCache from reusing mismatched 206 responses
        const sep = url.includes('?') ? '&' : '?'
        const reqUrl = `${url}${sep}r=${start}-${end}`

        const req = App.createRequest({
            url: reqUrl,
            method: 'GET',
            headers: {
                Range: `bytes=${start}-${end}`,
                Referer: `${HITOMI_DOMAIN}/`,
                'Cache-Control': 'no-cache'
            }
        })
        const res = await requestManager.schedule(req, 1)
        const bytes = responseToUint8Array(res)
        if (bytes.length > 0) {
            nodeCache.set(cacheKey, bytes)
        }
        return bytes
    }

    // Filter out common English stop words if multiple terms are present
    const nonStopTerms = rawTerms.filter(t => !STOP_WORDS.has(t) && t.length > 1)
    const termsToSearch = nonStopTerms.length > 0 ? nonStopTerms : rawTerms

    if (termsToSearch.length === 0) return []

    const rootData = await fetchRange(indexUrl, 0, MAX_NODE_SIZE - 1)
    const rootNode = decodeNode(rootData)
    if (!rootNode) return []

    interface TermRange {
        term: string;
        offset: number;
        length: number;
    }

    // Phase 1: Locate B-Tree index data ranges for each term (lightweight index lookups)
    const termRanges: TermRange[] = []
    for (let i = 0; i < termsToSearch.length; i++) {
        const t = termsToSearch[i]!
        let range = await bSearch(indexUrl, hashTerm(t), rootNode, fetchRange)
        let actualTerm = t

        // If not found with exact punctuation, try stripped term
        if (!range && /[^\w]/.test(t)) {
            const stripped = t.replace(/[^\w]/g, "")
            if (stripped.length > 0) {
                range = await bSearch(indexUrl, hashTerm(stripped), rootNode, fetchRange)
                actualTerm = stripped
            }
        } else if ((!range || range[1] > 20000) && i === termsToSearch.length - 1 && !/[^\w]/.test(t)) {
            // If last word has no punctuation and matched a huge range, check common title punctuation (e.g. "other!!" for "other")
            const rExcl = await bSearch(indexUrl, hashTerm(t + "!!"), rootNode, fetchRange)
            if (rExcl && rExcl[1] > 0 && (!range || rExcl[1] < range[1])) {
                range = rExcl
                actualTerm = t + "!!"
            }
        }

        if (range && range[1] > 0) {
            termRanges.push({ term: actualTerm, offset: range[0], length: range[1] })
        }
    }

    if (termRanges.length === 0) return []

    // Sort term ranges so the smallest/most specific data chunk is downloaded first
    termRanges.sort((a, b) => a.length - b.length)

    // Phase 2: Download the smallest data chunk to seed candidate IDs
    let candidateIds: number[] = []
    let primaryIndex = 0
    while (primaryIndex < termRanges.length && candidateIds.length === 0) {
        const primary = termRanges[primaryIndex]!
        primaryIndex++
        if (primary.length > 0 && primary.length <= MAX_DATA_RANGE_BYTES) {
            const primaryBuf = await fetchRange(dataUrl, primary.offset, primary.offset + primary.length - 1)
            candidateIds = parseGalleryIdsFromData(primaryBuf)
        }
    }

    if (candidateIds.length === 0) return []

    // Phase 3: Filter candidate IDs against remaining terms using fast binary DataView scanning
    for (let i = primaryIndex; i < termRanges.length; i++) {
        const tr = termRanges[i]!
        if (candidateIds.length === 0) break
        if (tr.length > MAX_DATA_RANGE_BYTES) continue

        const chunkBuf = await fetchRange(dataUrl, tr.offset, tr.offset + tr.length - 1)
        if (!chunkBuf || chunkBuf.length < 4) continue

        const dv = new DataView(chunkBuf.buffer, chunkBuf.byteOffset, chunkBuf.byteLength)
        const count = dv.getInt32(0, false)
        if (count <= 0) continue

        candidateIds = candidateIds.filter(id => {
            for (let j = 0; j < count; j++) {
                if (dv.getInt32(4 + j * 4, false) === id) return true
            }
            return false
        })
    }

    return candidateIds
}
