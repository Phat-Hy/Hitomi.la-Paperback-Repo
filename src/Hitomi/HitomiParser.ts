/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
    ChapterDetails,
    Response,
    SourceManga,
    Tag,
    TagSection
} from '@paperback/types'
import { HitomiFile, HitomiGallery, HitomiTag } from './HitomiModels'

const IMAGE_DOMAIN = 'gold-usergeneratedcontent.net'

export class ImageUriResolver {
    private static b = '1792879202/'
    private static defaultO = 0
    private static caseO = 1
    private static cases = new Set<number>()
    private static ggFunction: ((g: number) => number) | null = null
    private static lastSyncedAt = 0
    private static readonly GG_CACHE_TTL_MS = 15 * 60 * 1000

    static needsSync(): boolean {
        return ImageUriResolver.cases.size === 0 || Date.now() - ImageUriResolver.lastSyncedAt > ImageUriResolver.GG_CACHE_TTL_MS
    }

    static parseGG(responseText: string): void {
        ImageUriResolver.cases.clear()

        const bMatch = responseText.match(/(?:var\s+)?b\s*[:=]\s*['"]([^'"]+)['"]/)
        if (bMatch && bMatch[1]) {
            ImageUriResolver.b = bMatch[1].replace(/\/$/, '') + '/'
        }

        // 1. Dynamic extraction of authentic gg.m function
        try {
            const fn = new Function('var gg;\n' + responseText + '\nreturn (typeof gg !== "undefined" && typeof gg.m === "function") ? gg.m : null;')
            const mFn = fn()
            if (typeof mFn === 'function') {
                ImageUriResolver.ggFunction = mFn
            }
        } catch {
            ImageUriResolver.ggFunction = null
        }

        // 2. Dynamic fallback parser: inspect default o and case o
        const defaultOMatch = responseText.match(/(?:var\s+)?o\s*=\s*(\d+)/)
        ImageUriResolver.defaultO = defaultOMatch ? parseInt(defaultOMatch[1], 10) : 0

        const caseOMatch = responseText.match(/case\s+\d+:[\s\S]*?o\s*=\s*(\d+);\s*break;/)
        ImageUriResolver.caseO = caseOMatch ? parseInt(caseOMatch[1], 10) : (1 - ImageUriResolver.defaultO)

        const caseMatches = responseText.matchAll(/case\s+(\d+):/g)
        for (const match of caseMatches) {
            if (match[1]) {
                ImageUriResolver.cases.add(parseInt(match[1], 10))
            }
        }

        if (ImageUriResolver.cases.size === 0) {
            const cArrayMatch = responseText.match(/(?:var\s+)?c\s*=\s*\[([\d,\s]+)\]/)
            if (cArrayMatch && cArrayMatch[1]) {
                const numbers = cArrayMatch[1]
                    .split(',')
                    .map(s => parseInt(s.trim(), 10))
                    .filter(n => !Number.isNaN(n))
                numbers.forEach(n => ImageUriResolver.cases.add(n))
            }
        }

        ImageUriResolver.lastSyncedAt = Date.now()
    }

    private static getM(g: number): number {
        if (ImageUriResolver.ggFunction) {
            try {
                return ImageUriResolver.ggFunction(g)
            } catch {
                // Fall through to fallback parser
            }
        }
        return ImageUriResolver.cases.has(g) ? ImageUriResolver.caseO : ImageUriResolver.defaultO
    }

    static getImageUri(
        image: HitomiFile,
        extension: 'webp' | 'avif' = 'webp',
        options: { isThumbnail?: boolean; isSmall?: boolean } = {}
    ): string {
        const resolvedExtension = (extension === 'avif' && image.hasAvif) ? 'avif' : 'webp'
        const imageHashCode = parseInt(image.hash.slice(-1) + image.hash.slice(-3, -1), 16)
        const m = ImageUriResolver.getM(imageHashCode)

        if (!options.isThumbnail) {
            // Full page image
            const prefix = resolvedExtension === 'avif' ? 'a' : 'w'
            const subdomain = `${prefix}${1 + m}`
            const path = `${ImageUriResolver.b}${imageHashCode}/${image.hash}`
            return `https://${subdomain}.${IMAGE_DOMAIN}/${path}.${resolvedExtension}`
        } else {
            // Thumbnail
            const prefix = String.fromCharCode(97 + m) + 'tn' // atn or btn
            const thumbType = options.isSmall ? 'smalltn' : 'bigtn'
            const path = `${resolvedExtension}${thumbType}/${image.hash.slice(-1)}/${image.hash.slice(-3, -1)}/${image.hash}`
            return `https://${prefix}.${IMAGE_DOMAIN}/${path}.${resolvedExtension}`
        }
    }
}

export function responseToArrayBuffer(response: Response): ArrayBuffer {
    if (response.rawData && response.rawData.length > 0) {
        const raw = response.rawData
        const len = raw.length
        const u8 = new Uint8Array(len)
        for (let i = 0; i < len; i++) {
            u8[i] = raw[i] as number
        }
        return u8.buffer
    }
    if (typeof response.data === 'string') {
        const str = response.data
        const len = str.length
        const u8 = new Uint8Array(len)
        for (let i = 0; i < len; i++) {
            u8[i] = str.charCodeAt(i) & 0xff
        }
        return u8.buffer
    }
    return new ArrayBuffer(0)
}

export function parseNozomiBuffer(buffer: ArrayBuffer): number[] {
    if (!buffer || buffer.byteLength < 4) return []
    const view = new DataView(buffer)
    const len = Math.floor(buffer.byteLength / 4) * 4
    const ids: number[] = []
    for (let i = 0; i < len; i += 4) {
        ids.push(view.getInt32(i, false))
    }
    return ids
}

export function parseGalleryJson(raw: string, id: string): HitomiGallery {
    let jsonStr: string | undefined
    const match = raw.match(/var\s+galleryinfo\s*=\s*(\{[\s\S]*?\})\s*$/)
    if (match && match[1]) {
        jsonStr = match[1]
    } else {
        const first = raw.indexOf('{')
        const last = raw.lastIndexOf('}')
        if (first !== -1 && last !== -1 && last > first) {
            jsonStr = raw.slice(first, last + 1)
        }
    }
    if (!jsonStr) {
        throw new Error(`Failed to parse gallery JSON for ID: ${id}`)
    }

    const json = JSON.parse(jsonStr)
    const gallery: HitomiGallery = {
        id: Number(id),
        title: {
            display: json.title || 'Untitled',
            japanese: typeof json.japanese_title === 'string' ? json.japanese_title : null
        },
        type: json.type || 'Doujinshi',
        languageName: {
            english: typeof json.language === 'string' ? json.language : null,
            local: typeof json.language_localname === 'string' ? json.language_localname : null
        },
        artists: [],
        groups: [],
        series: [],
        characters: [],
        tags: [],
        files: []
    }

    if (Array.isArray(json.artists)) {
        for (const a of json.artists) {
            if (a && a.artist) gallery.artists.push(a.artist)
        }
    }
    if (Array.isArray(json.groups)) {
        for (const g of json.groups) {
            if (g && g.group) gallery.groups.push(g.group)
        }
    }
    if (Array.isArray(json.parodys)) {
        for (const p of json.parodys) {
            if (p && p.parody) gallery.series.push(p.parody)
        }
    }
    if (Array.isArray(json.characters)) {
        for (const c of json.characters) {
            if (c && c.character) gallery.characters.push(c.character)
        }
    }
    if (Array.isArray(json.tags)) {
        for (const t of json.tags) {
            if (!t || !t.tag) continue
            let type: HitomiTag['type'] = 'tag'
            if (t.male === '1' || t.male === 1) type = 'male'
            else if (t.female === '1' || t.female === 1) type = 'female'
            gallery.tags.push({ type, name: t.tag })
        }
    }
    if (Array.isArray(json.files)) {
        for (let i = 0; i < json.files.length; i++) {
            const f = json.files[i]
            if (!f) continue
            gallery.files.push({
                index: i,
                hash: f.hash,
                name: f.name || `${i}.webp`,
                hasAvif: Boolean(f.hasavif),
                hasWebp: Boolean(f.haswebp),
                width: Number(f.width) || 0,
                height: Number(f.height) || 0
            })
        }
    }

    return gallery
}

export function parseGalleryToSourceManga(gallery: HitomiGallery, mangaId: string): SourceManga {
    const titles = [gallery.title.display]
    if (gallery.title.japanese) {
        titles.push(gallery.title.japanese)
    }

    let thumbnail = ''
    if (gallery.files.length > 0 && gallery.files[0]) {
        thumbnail = ImageUriResolver.getImageUri(gallery.files[0], 'webp', { isThumbnail: true, isSmall: false })
    }

    const tagSections: TagSection[] = []
    const generalTags: Tag[] = []
    const maleTags: Tag[] = []
    const femaleTags: Tag[] = []

    for (const t of gallery.tags) {
        const item = App.createTag({ id: `${t.type}:${t.name}`, label: t.name })
        if (t.type === 'female') {
            femaleTags.push(item)
        } else if (t.type === 'male') {
            maleTags.push(item)
        } else {
            generalTags.push(item)
        }
    }

    if (femaleTags.length > 0) {
        tagSections.push(App.createTagSection({ id: 'female', label: 'Female', tags: femaleTags }))
    }
    if (maleTags.length > 0) {
        tagSections.push(App.createTagSection({ id: 'male', label: 'Male', tags: maleTags }))
    }
    if (generalTags.length > 0) {
        tagSections.push(App.createTagSection({ id: 'tags', label: 'Tags', tags: generalTags }))
    }

    const descParts: string[] = []
    if (gallery.type) descParts.push(`Type: ${gallery.type}`)
    if (gallery.languageName.english) descParts.push(`Language: ${gallery.languageName.english}`)
    if (gallery.series.length > 0) descParts.push(`Series: ${gallery.series.join(', ')}`)
    if (gallery.characters.length > 0) descParts.push(`Characters: ${gallery.characters.join(', ')}`)
    if (gallery.groups.length > 0) descParts.push(`Groups: ${gallery.groups.join(', ')}`)
    descParts.push(`Pages: ${gallery.files.length}`)

    return App.createSourceManga({
        id: mangaId,
        mangaInfo: App.createMangaInfo({
            titles,
            image: thumbnail,
            status: 'Completed',
            artist: gallery.artists.length > 0 ? gallery.artists.join(', ') : 'Unknown',
            author: gallery.groups.length > 0 ? gallery.groups.join(', ') : gallery.artists[0] || 'Unknown',
            tags: tagSections,
            desc: descParts.join('\n')
        })
    })
}

export function parseGalleryToChapterDetails(gallery: HitomiGallery, mangaId: string, chapterId: string): ChapterDetails {
    const pages: string[] = []
    for (const f of gallery.files) {
        pages.push(ImageUriResolver.getImageUri(f, 'webp'))
    }

    return App.createChapterDetails({
        id: chapterId,
        mangaId: mangaId,
        pages
    })
}
