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

const TOONGOD_DOMAIN = 'https://www.toongod.org'

export function extractImageSrc(tagStr: string): string {
    if (!tagStr) return ''
    const dataMatch = tagStr.match(/(?:data-src|data-lazy-src|data-cfsrc)=["']\s*([^"'\s]+)\s*["']/i)
    let src = ''
    if (dataMatch && dataMatch[1]) {
        src = dataMatch[1]
    } else {
        const srcsetMatch = tagStr.match(/(?:data-srcset|srcset)=["']\s*([^"']+)\s*["']/i)
        if (srcsetMatch && srcsetMatch[1]) {
            const parts = srcsetMatch[1].split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean)
            src = parts.pop() || ''
        } else {
            const srcMatch = tagStr.match(/src=["']\s*([^"'\s]+)\s*["']/i)
            if (srcMatch && srcMatch[1] && !srcMatch[1].includes('dflazy') && !srcMatch[1].includes('placeholder')) {
                src = srcMatch[1]
            }
        }
    }
    if (!src) return ''
    src = src.trim().replace(/-\d+x\d+(\.\w+)$/, '$1')
    if (src.startsWith('//')) src = 'https:' + src
    else if (src.startsWith('/')) src = TOONGOD_DOMAIN + src
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
    const titleMatch = html.match(/<div class="[^"]*post-title[^"]*"[^>]*>\s*<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
                       html.match(/<div id="manga-title">\s*<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
                       html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
    const title = titleMatch ? decode(titleMatch[1].replace(/<[^>]+>/g, '').trim()) : 'Untitled'

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

    const summaryImgMatch = html.match(/<div class="[^"]*summary_image[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                           html.match(/class="[^"]*tab-summary[^"]*"[\s\S]*?<img\s+[^>]*>/i)
    let image = ''
    if (summaryImgMatch) {
        const imgTag = summaryImgMatch[0].match(/<img\s+[^>]*>/i)
        if (imgTag) {
            image = extractImageSrc(imgTag[0])
        }
    }
    if (!image) {
        const fallbackImg = html.match(/<img[^>]+class="[^"]*(?:wp-post-image|img-responsive)[^"]*"[^>]*>/i)
        if (fallbackImg) {
            image = extractImageSrc(fallbackImg[0])
        }
    }

    const authorMatch = html.match(/<div class="author-content">([\s\S]*?)<\/div>/i)
    const author = authorMatch ? decode(authorMatch[1].replace(/<[^>]+>/g, '').trim()) : 'Unknown'

    const artistMatch = html.match(/<div class="artist-content">([\s\S]*?)<\/div>/i)
    const artist = artistMatch ? decode(artistMatch[1].replace(/<[^>]+>/g, '').trim()) : author

    const descMatch = html.match(/<div class="(?:description-summary|summary-container|manga-excerpt)">([\s\S]*?)<\/div>/i)
    const desc = descMatch ? decode(descMatch[1].replace(/<[^>]+>/g, ' ').replace(/Show more/gi, '').trim()) : ''

    const ratingMatch = html.match(/id="averagerate"[^>]*>([\s\S]*?)<\/span>/i) ||
                        html.match(/<span class="score"[^>]*>([\s\S]*?)<\/span>/i)
    const rating = ratingMatch ? parseFloat(ratingMatch[1].replace(/<[^>]+>/g, '').trim()) || 0 : 0

    const status = /Completed/i.test(html) ? 'Completed' : 'Ongoing'

    const genres: Tag[] = []
    const genresBoxMatch = html.match(/<div class="genres-content">([\s\S]*?)<\/div>/i)
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
            rating,
            status,
            artist,
            author,
            desc,
            tags: tagSections,
            hentai: false
        })
    })
}

export function parseChapters(html: string, mangaId: string): Chapter[] {
    const chapters: Chapter[] = []
    const chapterRegex = /<li[^>]+class="[^"]*wp-manga-chapter[^"]*"[^>]*>([\s\S]*?)<\/li>/gi
    let m: RegExpExecArray | null
    let i = 0

    while ((m = chapterRegex.exec(html)) !== null) {
        const block = m[1]
        const linkMatch = block.match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
        if (!linkMatch) continue

        const href = linkMatch[1]
        const rawName = linkMatch[2].replace(/<[^>]+>/g, '').trim()
        const chapterSlug = extractSlug(href)
        if (!chapterSlug || chapterSlug === '#' || chapterSlug === mangaId) continue

        const name = decode(rawName)
        const chapMatch = (chapterSlug + ' ' + name).match(/(?:chapter|ch[-_\s]*)(\d+(?:\.\d+)?)/i)
        const chapNum = chapMatch && chapMatch[1] ? parseFloat(chapMatch[1]) : i

        const dateMatch = block.match(/<span class="chapter-release-date">[\s\S]*?(?:title=["']([^"']+)["']|<i>([\s\S]*?)<\/i>)/i)
        const dateStr = dateMatch ? (dateMatch[1] || dateMatch[2] || '') : ''
        const time = parseDate(dateStr)

        chapters.push(App.createChapter({
            id: chapterSlug,
            mangaId,
            name: name || `Chapter ${chapNum}`,
            chapNum,
            time
        }))
        i++
    }

    return chapters
}

export function parseChapterDetails(html: string, mangaId: string, chapterId: string): ChapterDetails {
    const pages: string[] = []

    // 1. Isolate the reading container without truncating at nested </div>
    let searchHtml = html
    const rcStart = html.search(/class=["'][^"']*reading-content[^"']*["']/i)
    if (rcStart !== -1) {
        const afterRc = html.slice(rcStart)
        const rcEnd = afterRc.search(/class=["'][^"']*(?:entry-header_footer|manga-reading-nav-foot|nav-links|comments-area)[^"']*["']|<footer/i)
        if (rcEnd !== -1) {
            searchHtml = afterRc.slice(0, rcEnd)
        } else {
            searchHtml = afterRc
        }
    }

    // 2. Extract all images from searchHtml
    const imgRegex = /<img\s+[^>]*>/gi
    let m: RegExpExecArray | null
    while ((m = imgRegex.exec(searchHtml)) !== null) {
        const tag = m[0]
        if (rcStart === -1 && !tag.includes('wp-manga-chapter-img') && !tag.includes('image-') && !tag.includes('page-break')) {
            continue
        }
        const src = extractImageSrc(tag)
        if (src && !pages.includes(src) && !src.includes('logo') && !src.includes('banner') && !src.includes('icon') && !src.includes('dflazy') && !src.includes('placeholder')) {
            pages.push(src)
        }
    }

    // 3. Fallback: scan whole html for wp-manga-chapter-img or id="image-
    if (pages.length === 0) {
        const chImgRegex = /<img\s+[^>]*class=["'][^"']*wp-manga-chapter-img[^"']*["'][^>]*>|<img\s+[^>]*id=["']image-\d+["'][^>]*>/gi
        while ((m = chImgRegex.exec(html)) !== null) {
            const src = extractImageSrc(m[0])
            if (src && !pages.includes(src) && !src.includes('logo') && !src.includes('banner') && !src.includes('dflazy')) {
                pages.push(src)
            }
        }
    }

    // 4. Fallback 2: scan whole html for any upload image
    if (pages.length === 0) {
        const uploadRegex = /<img\s+[^>]+(?:data-src|data-lazy-src|src)=["']\s*([^"'\s]+\/(?:uploads|chapter)[^"'\s]*)\s*["'][^>]*>/gi
        while ((m = uploadRegex.exec(html)) !== null) {
            const src = extractImageSrc(m[0])
            if (src && !pages.includes(src) && !src.includes('logo') && !src.includes('banner') && !src.includes('dflazy')) {
                pages.push(src)
            }
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
    const blocks = html.split(/<div\s+class="[^"]*(?:c-tabs-item__content|page-item-detail|badge-pos-1|popular-item|slider__item|page-listing-item)[^"]*"/i).slice(1)

    for (const block of blocks) {
        const linkMatch = block.match(/href=["'](https?:\/\/[^"']*\/(?:webtoon|manga|webtoons)\/[^"'\/]+\/?)["']/i) ||
                          block.match(/href=["'](\/?(?:webtoon|manga|webtoons)\/[^"'\/]+\/?)["']/i) ||
                          block.match(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>/i)
        if (!linkMatch) continue

        const slug = extractSlug(linkMatch[1])
        if (!slug || seen.has(slug) || slug === 'webtoon' || slug === 'webtoons' || slug === 'manga' || slug === 'wp-content' || slug === 'wp-json') continue

        const titleMatch = block.match(/<h[1-5][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) ||
                           block.match(/class="[^"]*post-title[^"]*"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) ||
                           block.match(/class="[^"]*manga-title[^"]*"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) ||
                           block.match(/<a[^>]+href=["'][^"']*\/(?:webtoon|manga)\/[^"'\/]+\/?[^"']*title=["']([^"']+)["']/i) ||
                           block.match(/class="[^"]*post-title[^"]*"[\s\S]*?>([\s\S]*?)<\//i) ||
                           block.match(/title=["']([^"']+)["']/i)
        const title = titleMatch ? decode(titleMatch[1].replace(/<[^>]+>/g, '').trim()) : ''
        if (!title) continue

        seen.add(slug)

        const imgMatch = block.match(/<img\s+[^>]*>/i)
        const image = imgMatch ? extractImageSrc(imgMatch[0]) : ''

        const chMatch = block.match(/class="[^"]*chapter[^"]*"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)
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
