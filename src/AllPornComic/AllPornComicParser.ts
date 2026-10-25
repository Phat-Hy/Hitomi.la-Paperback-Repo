/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
    Chapter,
    ChapterDetails,
    PartialSourceManga,
    SourceManga,
    Tag,
    TagSection
} from '@paperback/types'
import * as cheerio from 'cheerio'
import { decode } from 'html-entities'

export function extractImageSrc(imageElement: any): string {
    if (!imageElement) return ''
    let src = imageElement.attr('data-src') ||
              imageElement.attr('data-lazy-src') ||
              imageElement.attr('srcset')?.split(' ')[0] ||
              imageElement.attr('src') ||
              imageElement.attr('data-cfsrc') ||
              ''
    src = src.trim().replace(/(\s{2,})/gi, '')
    // Remove resizing suffixes (e.g. -193x278.jpg -> .jpg)
    src = src.replace(/-\d+x\d+(\.\w+)$/, '$1')

    if (src.startsWith('//')) {
        src = 'https:' + src
    } else if (src.startsWith('/')) {
        src = 'https://allporncomic.com' + src
    }
    src = src.replace(/^http:\/\//, 'https://')
    return src
}

export function extractSlug(href: string): string {
    if (!href) return ''
    const clean = href.replace(/\/$/, '')
    const parts = clean.split('/')
    return parts.pop() || ''
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

export function parseMangaDetails($: cheerio.CheerioAPI, mangaId: string): SourceManga {
    const rawTitle = $('div.post-title h1, div#manga-title h1').first().clone().children().remove().end().text().trim() ||
                     $('div.post-title h1, div#manga-title h1').first().text().trim() ||
                     'Untitled'
    const title = decode(rawTitle)

    const titles: string[] = [title]
    const altText = $('div.summary-content:contains(Alternative), h5:contains(Alternative) + div, h5:contains(Alt Name) + div').text().trim()
    if (altText) {
        for (const alt of altText.split(/\s*[/,;]\s*/)) {
            const cleanAlt = decode(alt.trim())
            if (cleanAlt && !titles.includes(cleanAlt)) {
                titles.push(cleanAlt)
            }
        }
    }

    const author = decode($('div.author-content a, div.author-content').first().text().replace(/\n/g, '').trim()) || 'Unknown'
    const artist = decode($('div.artist-content a, div.artist-content').first().text().replace(/\n/g, '').trim()) || author || 'Unknown'
    const desc = decode($('div.description-summary, div.summary-container, div.manga-excerpt').first().text().replace(/Show more/i, '').trim())

    const ratingText = $('#averagerate').text().trim()
    const rating = parseFloat(ratingText) || 0

    const image = extractImageSrc($('div.summary_image img').first())

    const parsedStatus = $('div.summary-content', $('div.post-content_item').last()).text().trim().toUpperCase()
    const status = parsedStatus.includes('COMPLETED') ? 'Completed' : 'Ongoing'

    const genres: Tag[] = []
    $('div.genres-content a, .genres-content a').each((_, el) => {
        const name = $(el).text().trim()
        const href = $(el).attr('href') || ''
        const id = extractSlug(href)
        if (name && id) {
            genres.push(App.createTag({ id, label: decode(name) }))
        }
    })

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
            hentai: true
        })
    })
}

export function parseChapters($: cheerio.CheerioAPI, mangaId: string): Chapter[] {
    const chapters: Chapter[] = []
    const rows = $('li.wp-manga-chapter').toArray()

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const link = $('a', row).first()
        const href = link.attr('href') || ''
        const chapterSlug = extractSlug(href)
        if (!chapterSlug || chapterSlug === '#' || chapterSlug === mangaId) continue

        const rawName = link.text().trim()
        const chapName = decode(rawName)

        const chapMatch = (chapterSlug + ' ' + chapName).match(/(?:chapter|ch[-_\s]*)(\d+(?:\.\d+)?)/i)
        const chapNum = chapMatch && chapMatch[1] ? parseFloat(chapMatch[1]) : (rows.length - i)

        const dateStr = $('span.chapter-release-date a', row).attr('title') ||
                        $('span.chapter-release-date i', row).text().trim()
        const time = parseDate(dateStr)

        chapters.push(App.createChapter({
            id: chapterSlug,
            mangaId,
            name: chapName || `Chapter ${chapNum}`,
            chapNum,
            time
        }))
    }

    return chapters
}

export function parseChapterDetails($: cheerio.CheerioAPI, mangaId: string, chapterId: string): ChapterDetails {
    const pages: string[] = []

    $('div.page-break img, div.reading-content img, div.wp-manga-chapter-img img').each((_, el) => {
        const src = extractImageSrc($(el))
        if (src && !pages.includes(src)) {
            pages.push(encodeURI(src))
        }
    })

    return App.createChapterDetails({
        id: chapterId,
        mangaId,
        pages
    })
}

export function parseMangaItems($: cheerio.CheerioAPI): PartialSourceManga[] {
    const items: PartialSourceManga[] = []
    const seen = new Set<string>()

    $('div.c-tabs-item__content, div.page-item-detail, div.row.c-tabs-item__content').each((_, el) => {
        const titleLink = $('h3.h5 a, .post-title a', el).first()
        const href = titleLink.attr('href') || $('div.item-thumb a, div.tab-thumb a', el).first().attr('href') || ''
        const slug = extractSlug(href)
        if (!slug || seen.has(slug)) return
        seen.add(slug)

        const title = decode(titleLink.text().trim() || $('h3.h5, .post-title', el).text().trim())
        if (!title) return

        const img = $('div.item-thumb img, div.tab-thumb img, img', el).first()
        const image = extractImageSrc(img)

        const subtitle = decode($('span.font-meta.chapter a, span.font-meta.chapter, .chapter-item .chapter a', el).first().text().trim())

        items.push(App.createPartialSourceManga({
            mangaId: slug,
            image,
            title,
            subtitle: subtitle || undefined
        }))
    })

    return items
}
