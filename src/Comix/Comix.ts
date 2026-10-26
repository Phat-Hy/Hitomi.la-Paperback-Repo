/* SPDX-License-Identifier: GPL-3.0-or-later */

// Safety polyfills for JavaScriptCore in iOS
const g: any = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this))
if (typeof g.atob === 'undefined') {
    g.atob = (b64: string) => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='
        let str = b64.replace(/=+$/, '')
        let output = ''
        for (let bc = 0, bs = 0, buffer, idx = 0; buffer = str.charAt(idx++); ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) {
            buffer = chars.indexOf(buffer)
        }
        return output
    }
}
if (typeof g.Buffer === 'undefined') {
    g.Buffer = {
        from: (data: string) => ({
            toString: () => data
        })
    }
}

import {
    BadgeColor,
    Chapter,
    ChapterDetails,
    ChapterProviding,
    ContentRating,
    HomePageSectionsProviding,
    HomeSection,
    HomeSectionType,
    MangaProviding,
    PagedResults,
    Request,
    Response,
    SearchRequest,
    SearchResultsProviding,
    SourceInfo,
    SourceIntents,
    SourceManga
} from '@paperback/types'
import {
    decryptPayload,
    serializeParams,
    signPath
} from './ComixCrypto'
import {
    parseChapterDetails,
    parseChapters,
    parseMangaDetails,
    parseMangaTile
} from './ComixParser'

const COMIX_DOMAIN = 'https://comix.to'
const API_BASE = `${COMIX_DOMAIN}/api/v1`

export const ComixInfo: SourceInfo = {
    version: '1.0.0',
    name: 'Comix',
    icon: 'icon.png',
    author: 'Phat-Hy',
    authorWebsite: 'https://github.com/Phat-Hy',
    description: 'Extension that pulls manga, manhwa, and comics from comix.to',
    contentRating: ContentRating.EVERYONE,
    websiteBaseURL: COMIX_DOMAIN,
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS,
    sourceTags: [
        {
            text: 'Manga',
            type: BadgeColor.BLUE
        },
        {
            text: 'Webtoon',
            type: BadgeColor.GREEN
        }
    ]
}

export class Comix implements
    SearchResultsProviding,
    MangaProviding,
    ChapterProviding,
    HomePageSectionsProviding {

    requestManager = App.createRequestManager({
        requestsPerSecond: 4,
        requestTimeout: 20000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                request.headers = {
                    ...(request.headers ?? {}),
                    Referer: `${COMIX_DOMAIN}/`,
                    Accept: 'application/json, text/plain, */*'
                }
                return request
            },
            interceptResponse: async (response: Response): Promise<Response> => {
                return response
            }
        }
    })

    private async fetchJson<T = any>(endpoint: string, params: Record<string, any> = {}): Promise<T> {
        const qs = serializeParams(params)
        const pathForSigning = endpoint + (qs ? `?${qs}` : '')
        const token = signPath(pathForSigning)
        const fullUrl = `${API_BASE}${pathForSigning}${qs ? '&' : '?'}_=${token}`

        const request = App.createRequest({
            url: fullUrl,
            method: 'GET'
        })

        const response = await this.requestManager.schedule(request, 1)
        const rawText = response.data || '{}'
        const parsed = JSON.parse(rawText)

        if (response.headers?.['x-enc'] === '2' || parsed.e) {
            return decryptPayload<T>(parsed.e || parsed)
        }
        return parsed as T
    }

    getMangaShareUrl(mangaId: string): string {
        return `${COMIX_DOMAIN}/title/${mangaId}`
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const json = await this.fetchJson(`/manga/${mangaId}`)
        return parseMangaDetails(json, mangaId)
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const allItems: any[] = []
        let page = 1
        let hasNext = true

        while (hasNext && page <= 10) {
            const json: any = await this.fetchJson(`/manga/${mangaId}/chapters`, {
                limit: 100,
                page
            })
            const items = json.result?.items || []
            allItems.push(...items)

            hasNext = Boolean(json.result?.meta?.hasNext)
            page++
        }

        return parseChapters(allItems, mangaId)
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const json = await this.fetchJson(`/chapters/${chapterId}`)
        return parseChapterDetails(json, mangaId, chapterId)
    }

    async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
        const page = metadata?.page ?? 1
        const params: Record<string, any> = {
            limit: 20,
            page
        }

        if (query.title && query.title.trim()) {
            params.keyword = query.title.trim()
        } else {
            params.order = { chapter_updated_at: 'desc' }
        }

        const json: any = await this.fetchJson('/manga', params)
        const items = json.result?.items || []
        const results = items.map(parseMangaTile)
        const hasNext = Boolean(json.result?.meta?.hasNext)

        return App.createPagedResults({
            results,
            metadata: hasNext ? { page: page + 1 } : undefined
        })
    }

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        const sections = [
            App.createHomeSection({
                id: 'comix_trending',
                title: 'Trending',
                type: HomeSectionType.featured,
                containsMoreItems: true
            }),
            App.createHomeSection({
                id: 'comix_popular',
                title: 'Popular',
                type: HomeSectionType.singleRowNormal,
                containsMoreItems: true
            }),
            App.createHomeSection({
                id: 'comix_latest',
                title: 'Latest Updates',
                type: HomeSectionType.singleRowNormal,
                containsMoreItems: true
            })
        ]

        for (const section of sections) {
            sectionCallback(section)
        }

        // 1. Trending
        try {
            const json: any = await this.fetchJson('/manga/top', {
                type: 'trending',
                days: 1,
                limit: 20
            })
            const items = json.result || []
            sections[0].items = items.map(parseMangaTile)
            sectionCallback(sections[0])
        } catch (e) {
            console.error('Error fetching trending home section:', e)
        }

        // 2. Popular / Follows
        try {
            const json: any = await this.fetchJson('/manga/top', {
                type: 'follows',
                days: 7,
                limit: 20
            })
            const items = json.result || []
            sections[1].items = items.map(parseMangaTile)
            sectionCallback(sections[1])
        } catch (e) {
            console.error('Error fetching popular home section:', e)
        }

        // 3. Latest Updates
        try {
            const json: any = await this.fetchJson('/manga', {
                order: { chapter_updated_at: 'desc' },
                limit: 20,
                page: 1
            })
            const items = json.result?.items || []
            sections[2].items = items.map(parseMangaTile)
            sectionCallback(sections[2])
        } catch (e) {
            console.error('Error fetching latest home section:', e)
        }
    }

    async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        const page = metadata?.page ?? 1
        let results: any[] = []
        let hasNext = false

        if (homepageSectionId === 'comix_trending') {
            const json: any = await this.fetchJson('/manga/top', {
                type: 'trending',
                days: 1,
                limit: 20,
                page
            })
            const items = json.result || []
            results = items.map(parseMangaTile)
            hasNext = items.length >= 20
        } else if (homepageSectionId === 'comix_popular') {
            const json: any = await this.fetchJson('/manga/top', {
                type: 'follows',
                days: 7,
                limit: 20,
                page
            })
            const items = json.result || []
            results = items.map(parseMangaTile)
            hasNext = items.length >= 20
        } else {
            // Default: Latest Updates
            const json: any = await this.fetchJson('/manga', {
                order: { chapter_updated_at: 'desc' },
                limit: 20,
                page
            })
            const items = json.result?.items || []
            results = items.map(parseMangaTile)
            hasNext = Boolean(json.result?.meta?.hasNext)
        }

        return App.createPagedResults({
            results,
            metadata: hasNext ? { page: page + 1 } : undefined
        })
    }
}
