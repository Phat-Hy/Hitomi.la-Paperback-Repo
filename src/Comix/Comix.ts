/* SPDX-License-Identifier: GPL-3.0-or-later */

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
    version: '1.0.3',
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
                const headers: Record<string, string> = { ...(request.headers ?? {}) }
                if (request.url.includes('comix.to')) {
                    headers.Referer = `${COMIX_DOMAIN}/`
                    headers.Accept = 'application/json, text/plain, */*'
                } else {
                    delete headers.Referer
                    delete headers.referer
                    delete headers.Accept
                    delete headers.accept
                }
                request.headers = headers
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
        const sectionDefs: {
            section: HomeSection
            fetch: () => Promise<any[]>
        }[] = [
            {
                section: App.createHomeSection({
                    id: 'comix_trending',
                    title: 'Trending',
                    type: HomeSectionType.featured,
                    containsMoreItems: true
                }),
                fetch: async () => {
                    const json: any = await this.fetchJson('/manga/top', {
                        type: 'trending',
                        days: 1,
                        limit: 20
                    })
                    return json.result || []
                }
            },
            {
                section: App.createHomeSection({
                    id: 'comix_popular',
                    title: 'Popular',
                    type: HomeSectionType.singleRowNormal,
                    containsMoreItems: true
                }),
                fetch: async () => {
                    const json: any = await this.fetchJson('/manga/top', {
                        type: 'follows',
                        days: 7,
                        limit: 20
                    })
                    return json.result || []
                }
            },
            {
                section: App.createHomeSection({
                    id: 'comix_latest',
                    title: 'Latest Updates',
                    type: HomeSectionType.singleRowNormal,
                    containsMoreItems: true
                }),
                fetch: async () => {
                    const json: any = await this.fetchJson('/manga', {
                        order: { chapter_updated_at: 'desc' },
                        limit: 20,
                        page: 1
                    })
                    return json.result?.items || []
                }
            }
        ]

        // Emit initial empty sections so the UI renders placeholders
        for (const item of sectionDefs) {
            item.section.items = []
            sectionCallback(item.section)
        }

        // Fetch and populate each section asynchronously
        for (const item of sectionDefs) {
            try {
                const rawItems = await item.fetch()
                if (rawItems && rawItems.length > 0) {
                    item.section.items = rawItems.map(parseMangaTile)
                    sectionCallback(item.section)
                }
            } catch (err) {
                console.error(`Error populating section ${item.section.id}:`, err)
            }
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
