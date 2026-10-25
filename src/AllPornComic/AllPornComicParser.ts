/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
    Chapter,
    ChapterDetails,
    PartialSourceManga,
    SourceManga,
    Tag,
    TagSection
} from '@paperback/types'
import { decode } from 'html-entities'

export function extractImageSrc(tagStr: string): string {
    if (!tagStr) return ''
    const match = tagStr.match(/(?:data-src|data-lazy-src|data-cfsrc|src)=["']([^"']+)["']/i)
    if (!match || !match[1]) return ''
    let src = match[1].trim().replace(/-\d+x\d+(\.\w+)$/, '$1')
    if (src.startsWith('//')) src = 'https:' + src
    else if (src.startsWith('/')) src = 'https://allporncomic.com' + src
    return src.replace(/^http:\/\//, 'https://')
}

export function extractSlug(href: string): string {
    if (!href) return ''
    const clean = href.replace(/\/$/, '')
    return clean.split('/').pop() || ''
}

export function parseDate(dateStr: string): Date {
    if (!dateStr) return new Date()
    const upper = dateStr.toUpperCase().trim()

    if (upper.includes('LESS THAN AN HOUR') || upper.includes('JUST NOW') || upper.includes('AGO')) {
        const timeUnits: Record<string, number> = {
            YEAR: 31556952000,
            MONTH: 2592000000,
            WEEK: 604800000,
            DAY: 86400000,
            HOUR: 3600000,
            MIN: 60000,
            SEC: 1000
        }
        const match = upper.match(/(\d+)\s*(YEAR|MONTH|WEEK|DAY|HOUR|MIN|SEC)/)
        if (match && match[1] && match[2]) {
            const count = parseInt(match[1], 10)
            const unit = Object.keys(timeUnits).find(u => match[2]!.startsWith(u))
            if (unit) {
                return new Date(Date.now() - count * timeUnits[unit]!)
            }
        }
        return new Date()
    }

    if (upper.includes('YESTERDAY')) {
        return new Date(Date.now() - 86400000)
    }

    const parsed = new Date(dateStr)
    return isNaN(parsed.getTime()) ? new Date() : parsed
}

export function parseMangaDetails(html: string, mangaId: string): SourceManga {
    // 1. Title
    const titleMatch = html.match(/class=["'][^"']*post-title[^"']*["'][^>]*>[\s\S]*?<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i) ||
                       html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
                       html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
                       html.match(/<title>([\s\S]*?)(?:-\s*AllPornComic|<\/title>)/i)
    let title = titleMatch ? decode(titleMatch[1].replace(/<[^>]+>/g, '').trim()) : ''
    if (!title || title.toLowerCase() === 'untitled') {
        title = mangaId.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')
    }

    const titles: string[] = [title]
    const altMatch = html.match(/(?:Alternative|Alt Name\(s\))<\/h5>[\s\S]*?<div class="summary-content">([\s\S]*?)<\/div>/i)
    if (altMatch && altMatch[1]) {
        const altText = altMatch[1].replace(/<[^>]+>/g, '').trim()
        for (const alt of altText.split(/\s*[/,;]\s*/)) {
            const cleanAlt = decode(alt.trim())
            if (cleanAlt && !titles.includes(cleanAlt)) {
                titles.push(cleanAlt)
            }
        }
    }

    // 2. Cover Image
    let image = ''
    const summaryImgMatch = html.match(/class=["'][^"']*summary_image[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
                           html.match(/class=["'][^"']*tab-summary[^"']*["'][\s\S]*?<img\s+[^>]*>/i)
    if (summaryImgMatch) {
        const imgTag = summaryImgMatch[0].match(/<img\s+[^>]*>/i)
        if (imgTag) {
            image = extractImageSrc(imgTag[0])
        }
    }
    if (!image) {
        const ogImgMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)
        if (ogImgMatch && ogImgMatch[1]) {
            image = ogImgMatch[1].trim()
        }
    }
    if (!image) {
        const wpImg = html.match(/<img[^>]+class=["'][^"']*(?:wp-post-image|img-responsive)[^"']*["'][^>]*>/i)
        if (wpImg) {
            image = extractImageSrc(wpImg[0])
        }
    }

    // 3. Author & Artist
    const authorMatch = html.match(/class=["'][^"']*author-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
    const author = authorMatch ? decode(authorMatch[1].replace(/<[^>]+>/g, '').trim()) : 'Unknown'

    const artistMatch = html.match(/class=["'][^"']*artist-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
    const artist = artistMatch ? decode(artistMatch[1].replace(/<[^>]+>/g, '').trim()) : author

    // 4. Description
    const descMatch = html.match(/class=["'][^"']*(?:description-summary|summary__content|summary-container|manga-excerpt)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
                      html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i)
    const desc = descMatch ? decode(descMatch[1].replace(/<[^>]+>/g, ' ').replace(/Show more/gi, '').trim()) : ''

    const status = /Completed/i.test(html) ? 'Completed' : 'Ongoing'

    // 5. Genres
    const genres: Tag[] = []
    const genresBoxMatch = html.match(/class=["'][^"']*genres-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
    if (genresBoxMatch) {
        const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
        let lm: RegExpExecArray | null
        while ((lm = linkRegex.exec(genresBoxMatch[1])) !== null) {
            const id = extractSlug(lm[1])
            const label = decode(lm[2].replace(/<[^>]+>/g, '').trim())
            if (id && label) {
                genres.push(App.createTag({ id, label }))
            }
        }
    }

    const tagSections: TagSection[] = []
    if (genres.length > 0) {
        tagSections.push(App.createTagSection({ id: 'genres', label: 'Genres', tags: genres }))
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
            tags: tagSections
        })
    })
}

export function parseChapters(html: string, mangaId: string): Chapter[] {
    const rawChapters: { chapterSlug: string; name: string; parsedNum: number; validTime: Date }[] = []
    const chapterRegex = /<li[^>]+class="[^"]*wp-manga-chapter[^"]*"[^>]*>([\s\S]*?)<\/li>/gi
    let m: RegExpExecArray | null

    while ((m = chapterRegex.exec(html)) !== null) {
        const block = m[1]
        const linkMatch = block.match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
        if (!linkMatch) continue

        const href = linkMatch[1]
        const rawName = linkMatch[2].replace(/<[^>]+>/g, '').trim()
        const chapterSlug = extractSlug(href)
        if (!chapterSlug || chapterSlug === '#' || chapterSlug === mangaId) continue

        const name = decode(rawName)
        const chapMatch = (chapterSlug + ' ' + name).match(/(?:chapter|ch)[-_\s]*(\d+(?:\.\d+)?)/i)
        const parsedNum = chapMatch && chapMatch[1] ? parseFloat(chapMatch[1]) : NaN

        const dateMatch = block.match(/<span class="chapter-release-date">[\s\S]*?(?:title=["']([^"']+)["']|<i>([\s\S]*?)<\/i>)/i)
        const dateStr = dateMatch ? (dateMatch[1] || dateMatch[2] || '') : ''
        const time = parseDate(dateStr)
        const validTime = (time instanceof Date && !isNaN(time.getTime())) ? time : new Date()

        rawChapters.push({
            chapterSlug,
            name,
            parsedNum,
            validTime
        })
    }

    const total = rawChapters.length
    const chapters: Chapter[] = []

    for (let i = 0; i < total; i++) {
        const item = rawChapters[i]!
        const chapNum = !isNaN(item.parsedNum) ? item.parsedNum : (total - i)

        chapters.push(App.createChapter({
            id: item.chapterSlug,
            mangaId: mangaId,
            name: item.name || `Chapter ${chapNum}`,
            chapNum,
            time: item.validTime
        }))
    }

    return chapters
}

export function parseChapterDetails(html: string, mangaId: string, chapterId: string): ChapterDetails {
    const pages: string[] = []
    const readingAreaMatch = html.match(/<div class="(?:reading-content|page-break|wp-manga-chapter-img)"[^>]*>([\s\S]*?)<div class="(?:nav-links|c-selectpicker_header)/i) ||
                             html.match(/<div class="reading-content"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i)
    const searchHtml = readingAreaMatch ? readingAreaMatch[1] : html

    const imgRegex = /<img[^>]+(?:data-src|data-lazy-src|data-cfsrc|src)=["']([^"']+)["'][^>]*>/gi
    let m: RegExpExecArray | null
    while ((m = imgRegex.exec(searchHtml)) !== null) {
        const src = extractImageSrc(m[0])
        if (src && !pages.includes(src) && !src.includes('logo') && !src.includes('banner')) {
            pages.push(encodeURI(src))
        }
    }

    return App.createChapterDetails({
        id: chapterId,
        mangaId,
        pages
    })
}

export function parseMangaItems(html: string): PartialSourceManga[] {
    const items: PartialSourceManga[] = []
    const seen = new Set<string>()
    const blocks = html.split(/<div\s+class="[^"]*(?:c-tabs-item__content|page-item-detail|badge-pos-1)[^"]*"/i).slice(1)

    for (const block of blocks) {
        const linkMatch = block.match(/href=["'](https?:\/\/[^"']*\/porncomic\/[^"'/]+\/?)["']/i) ||
                          block.match(/href=["'](\/?porncomic\/[^"'/]+\/?)["']/i) ||
                          block.match(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>/i)
        if (!linkMatch) continue

        const slug = extractSlug(linkMatch[1])
        if (!slug || seen.has(slug) || slug === 'porncomic' || slug === 'wp-content' || slug === 'wp-json') continue

        const titleMatch = block.match(/<h[3-5][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) ||
                           block.match(/<div\s+class="post-title[^"]*">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) ||
                           block.match(/<a[^>]+href=["'][^"']*\/porncomic\/[^"'/]+\/?[^"']*title=["']([^"']+)["']/i) ||
                           block.match(/class="post-title"[\s\S]*?>([\s\S]*?)<\//i) ||
                           block.match(/title=["']([^"']+)["']/i)
        const title = titleMatch ? decode(titleMatch[1].replace(/<[^>]+>/g, '').trim()) : ''
        if (!title) continue

        seen.add(slug)

        const imgMatch = block.match(/<img\s+[^>]*>/i)
        const image = imgMatch ? extractImageSrc(imgMatch[0]) : ''

        const chMatch = block.match(/class="font-meta\s+chapter"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) ||
                        block.match(/class="chapter-item"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) ||
                        block.match(/class="chapter"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)
        const subtitle = chMatch ? decode(chMatch[1].replace(/<[^>]+>/g, '').trim()) : ''

        items.push(App.createPartialSourceManga({
            mangaId: slug,
            image,
            title,
            subtitle: subtitle || undefined
        }))
    }

    return items
}
