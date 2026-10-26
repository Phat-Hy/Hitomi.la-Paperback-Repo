/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
    Chapter,
    PartialSourceManga,
    SourceManga,
    Tag,
    TagSection
} from '@paperback/types'

const THUMB_CDN_BASE = 'https://thumb.mghcdn.com'
const IMG_CDN_BASE = 'https://imgx.mghcdn.com'

const BLOCKED_TAGS = /\b(?:mature|adult|18\+|hentai|erotica|smut|ecchi|sex|porn|pornographic|shota|loli|incest|sexual-violence)\b/i

export function parseMangaTile(item: any): PartialSourceManga {
    const mangaId = item.slug || ''
    const title = item.title || 'Untitled'
    const image = item.image ? `${THUMB_CDN_BASE}/${item.image}` : ''

    return App.createPartialSourceManga({
        mangaId,
        image,
        title,
        subtitle: ''
    })
}

export function parseMangaDetails(json: any, mangaId: string): SourceManga {
    const data = json.data?.manga || json.manga || json
    const titles: string[] = [data.title || mangaId]

    if (data.alternativeTitle && typeof data.alternativeTitle === 'string') {
        const altTitles = data.alternativeTitle
            .split(';')
            .map((s: string) => s.trim())
            .filter((s: string) => s && !titles.includes(s))
        titles.push(...altTitles)
    }

    const image = data.image ? `${THUMB_CDN_BASE}/${data.image}` : ''

    let status = 'Ongoing'
    if (data.status) {
        const s = String(data.status).toLowerCase().trim()
        if (s === 'completed') status = 'Completed'
        else if (s === 'ongoing') status = 'Ongoing'
        else status = 'Unknown'
    }

    const author = data.author ? String(data.author).trim() : ''
    const artist = data.artist ? String(data.artist).trim() : ''
    const desc = data.description ? String(data.description).trim() : ''

    // Collect and sanitize tags
    const tags: Tag[] = []
    const seenTags = new Set<string>()

    if (data.genres && typeof data.genres === 'string') {
        const rawList = data.genres.split(',').map((g: string) => g.trim()).filter(Boolean)
        for (const genre of rawList) {
            const cleanId = genre.toLowerCase().replace(/[^a-z0-9]+/g, '-')
            if (seenTags.has(cleanId)) continue
            seenTags.add(cleanId)

            if (!BLOCKED_TAGS.test(cleanId) && !BLOCKED_TAGS.test(genre)) {
                tags.push(App.createTag({ id: cleanId, label: genre }))
            }
        }
    }

    const tagSections: TagSection[] = []
    if (tags.length > 0) {
        tagSections.push(App.createTagSection({
            id: '0',
            label: 'content',
            tags
        }))
    }

    return App.createSourceManga({
        id: mangaId,
        mangaInfo: App.createMangaInfo({
            titles,
            image,
            status,
            artist,
            author,
            desc,
            tags: tagSections,
            hentai: false
        })
    })
}

function formatChapterName(title?: string, number?: number): string {
    const numStr = number !== undefined ? String(number).replace(/\.0$/, '') : ''
    const cleanTitle = (title || '').replace(/\s+/g, ' ').trim()
    if (!cleanTitle) return numStr ? `Chapter ${numStr}` : 'Chapter'
    if (numStr && (cleanTitle.toLowerCase().includes(`chapter ${numStr}`) || cleanTitle.toLowerCase().includes(`ch. ${numStr}`) || cleanTitle.includes(numStr))) {
        return cleanTitle
    }
    return numStr ? `Chapter ${numStr} - ${cleanTitle}` : cleanTitle
}

export function parseChapters(rawChapters: any[], mangaId: string): Chapter[] {
    if (!Array.isArray(rawChapters)) return []

    const chapters: Chapter[] = []
    for (const c of rawChapters) {
        const chapNum = typeof c.number === 'number' ? c.number : parseFloat(c.number || '0')
        const id = String(c.number)
        const name = formatChapterName(c.title, chapNum)
        let time = new Date()
        if (c.date) {
            const parsedTime = new Date(c.date)
            if (!isNaN(parsedTime.getTime())) {
                time = parsedTime
            }
        }

        chapters.push(App.createChapter({
            id,
            chapNum,
            name,
            time,
            langCode: 'en'
        }))
    }

    // Return newest first for Paperback chapter list
    return chapters.reverse()
}

export function parseChapterPages(rawPages: string): string[] {
    if (!rawPages) return []

    try {
        const parsed = typeof rawPages === 'string' ? JSON.parse(rawPages) : rawPages

        // Format 1: { p: "prefix/", i: ["1.jpg", "2.jpg"] }
        if (parsed.p && Array.isArray(parsed.i)) {
            const prefix = String(parsed.p).replace(/^\//, '')
            return parsed.i.map((img: string) => {
                if (img.startsWith('http://') || img.startsWith('https://')) return img
                return `${IMG_CDN_BASE}/${prefix}${img}`
            })
        }

        // Format 2: ["img1.jpg", "img2.jpg"]
        if (Array.isArray(parsed)) {
            return parsed.map((item: string) => {
                if (item.startsWith('http://') || item.startsWith('https://')) return item
                return `${IMG_CDN_BASE}/${String(item).replace(/^\//, '')}`
            })
        }

        // Format 3: Object map
        if (typeof parsed === 'object') {
            return Object.values(parsed).map((item: any) => {
                const str = String(item)
                if (str.startsWith('http://') || str.startsWith('https://')) return str
                return `${IMG_CDN_BASE}/${str.replace(/^\//, '')}`
            })
        }
    } catch (e) {
        console.error('Failed to parse chapter pages JSON:', e)
    }

    return []
}
