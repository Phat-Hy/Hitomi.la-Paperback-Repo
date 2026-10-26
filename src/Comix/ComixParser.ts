/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
    Chapter,
    ChapterDetails,
    LanguageCode,
    PartialSourceManga,
    SourceManga,
    Tag,
    TagSection
} from '@paperback/types'

const BLOCKED_TAGS = /\b(?:mature|adult|18\+|hentai|erotica|smut|ecchi|sex)\b/i

function mapLanguage(lang?: string): LanguageCode {
    if (!lang) return LanguageCode.ENGLISH
    switch (lang.toLowerCase()) {
        case 'en': return LanguageCode.ENGLISH
        case 'ko': return LanguageCode.KOREAN
        case 'ja': return LanguageCode.JAPANESE
        case 'zh':
        case 'zh-hk': return LanguageCode.CHINESE
        case 'fr': return LanguageCode.FRENCH
        case 'es': return LanguageCode.SPANISH
        case 'pt':
        case 'pt-br': return LanguageCode.PORTUGUESE
        case 'de': return LanguageCode.GERMAN
        case 'it': return LanguageCode.ITALIAN
        case 'ru': return LanguageCode.RUSSIAN
        case 'vi': return LanguageCode.VIETNAMESE
        case 'id': return LanguageCode.INDONESIAN
        case 'th': return LanguageCode.THAI
        default: return LanguageCode.ENGLISH
    }
}

function parseRelativeTime(dateStr?: string): Date {
    if (!dateStr) return new Date()
    const now = new Date()
    const lower = dateStr.toLowerCase().trim()
    const match = lower.match(/^(\d+)\s*(s|sec|m|min|h|hr|hour|d|day|w|wk|week|mo|month|y|yr|year)/)
    if (!match) return now

    const val = parseInt(match[1] || '0', 10)
    const unit = match[2]

    if (unit.startsWith('s')) now.setSeconds(now.getSeconds() - val)
    else if (unit.startsWith('m') && !unit.startsWith('mo')) now.setMinutes(now.getMinutes() - val)
    else if (unit.startsWith('h')) now.setHours(now.getHours() - val)
    else if (unit.startsWith('d')) now.setDate(now.getDate() - val)
    else if (unit.startsWith('w')) now.setDate(now.getDate() - val * 7)
    else if (unit.startsWith('mo')) now.setMonth(now.getMonth() - val)
    else if (unit.startsWith('y')) now.setFullYear(now.getFullYear() - val)

    return now
}

export function parseMangaTile(item: any): PartialSourceManga {
    const mangaId = item.hid || String(item.id)
    const title = item.title || 'Untitled'
    const image = item.poster?.medium || item.poster?.large || ''
    const subtitle = item.latestChapter ? `Ch. ${item.latestChapter}` : (item.type ? String(item.type).toUpperCase() : '')

    return App.createPartialSourceManga({
        mangaId,
        image,
        title,
        subtitle
    })
}

export function parseMangaDetails(json: any, mangaId: string): SourceManga {
    const data = json.result || json
    const titles: string[] = [data.title || mangaId]
    if (Array.isArray(data.altTitles)) {
        for (const alt of data.altTitles) {
            if (typeof alt === 'string' && alt.trim() && !titles.includes(alt.trim())) {
                titles.push(alt.trim())
            }
        }
    }

    const image = data.poster?.large || data.poster?.medium || ''
    let status = 'Ongoing'
    if (data.status) {
        const s = String(data.status).toLowerCase()
        if (s === 'completed' || s === 'finished') status = 'Completed'
        else if (s === 'hiatus') status = 'Hiatus'
        else if (s === 'cancelled') status = 'Cancelled'
    }

    const author = (data.authors || []).map((a: any) => a.title).filter(Boolean).join(', ')
    const artist = (data.artists || []).map((a: any) => a.title).filter(Boolean).join(', ')
    const desc = data.synopsis || ''

    // Collect tags & genres, filtering out mature terms to protect unauthenticated iOS library visibility
    const rawTags = [...(data.genres || []), ...(data.tags || [])]
    const seenTags = new Set<string>()
    const tags: Tag[] = []

    for (const t of rawTags) {
        const id = t.slug || String(t.id)
        const label = t.title || t.name || id
        if (!id || !label || seenTags.has(id.toLowerCase())) continue
        seenTags.add(id.toLowerCase())

        if (!BLOCKED_TAGS.test(id) && !BLOCKED_TAGS.test(label)) {
            tags.push(App.createTag({ id, label }))
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
            hentai: false // CRITICAL: Always false so Paperback iOS displays titles in Library & custom collections
        })
    })
}

export function parseChapters(items: any[], mangaId: string): Chapter[] {
    const chapters: Chapter[] = []
    for (const item of items) {
        const id = String(item.id)
        const chapNum = typeof item.number === 'number' ? item.number : parseFloat(item.number) || 0
        const volume = typeof item.volume === 'number' ? item.volume : 0
        const name = item.name || (item.group?.name ? `[${item.group.name}]` : '')
        const group = item.group?.name || undefined
        const time = parseRelativeTime(item.createdAtFormatted)
        const langCode = mapLanguage(item.language)

        chapters.push(App.createChapter({
            id,
            chapNum,
            volume,
            name,
            group,
            time,
            langCode
        }))
    }
    return chapters
}

export function parseChapterDetails(json: any, mangaId: string, chapterId: string): ChapterDetails {
    const data = json.result || json
    const pageItems = data.pages?.items || []
    const pages: string[] = pageItems
        .map((p: any) => p.url)
        .filter((url: any) => typeof url === 'string' && url.length > 0)

    return App.createChapterDetails({
        id: chapterId,
        mangaId,
        pages
    })
}
