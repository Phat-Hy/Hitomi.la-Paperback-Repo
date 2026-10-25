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
        from: (data: string, encoding: string) => ({
            toString: () => data
        })
    }
}

import {
    BadgeColor,
    Chapter,
    ChapterDetails,
    ChapterProviding,
    CloudflareBypassRequestProviding,
    ContentRating,
    HomePageSectionsProviding,
    HomeSection,
    HomeSectionType,
    MangaProviding,
    PagedResults,
    PartialSourceManga,
    Request,
    Response,
    SearchRequest,
    SearchResultsProviding,
    SourceInfo,
    SourceIntents,
    SourceManga,
    TagSection
} from '@paperback/types'
import {
    parseChapterDetails,
    parseChapters,
    parseMangaDetails,
    parseMangaItems
} from './ToonGodParser'
import {
    getToonGodTagSections,
    parseToonGodSearchPrefix
} from './ToonGodTags'

const TOONGOD_DOMAIN = 'https://www.toongod.org'

export const ToonGodInfo: SourceInfo = {
    version: '1.0.2',
    name: 'ToonGod',
    icon: 'icon.png',
    author: 'Phat-Hy',
    authorWebsite: 'https://github.com/Phat-Hy',
    description: 'Extension that pulls adult manhwa and webtoons from toongod.org',
    contentRating: ContentRating.ADULT,
    websiteBaseURL: TOONGOD_DOMAIN,
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS | SourceIntents.CLOUDFLARE_BYPASS_REQUIRED,
    sourceTags: [
        {
            text: '18+',
            type: BadgeColor.RED
        },
        {
            text: 'Cloudflare',
            type: BadgeColor.GREY
        }
    ]
}

export class ToonGod implements
    SearchResultsProviding,
    MangaProviding,
    ChapterProviding,
    HomePageSectionsProviding,
    CloudflareBypassRequestProviding {

    requestManager = App.createRequestManager({
        requestsPerSecond: 4,
        requestTimeout: 25000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                request.headers = {
                    ...(request.headers ?? {}),
                    referer: `${TOONGOD_DOMAIN}/`,
                    Referer: `${TOONGOD_DOMAIN}/`,
                    Origin: TOONGOD_DOMAIN
                }
                return request
            },
            interceptResponse: async (response: Response): Promise<Response> => {
                return response
            }
        }
    })

    async getCloudflareBypassRequestAsync(): Promise<Request> {
        return App.createRequest({
            url: `${TOONGOD_DOMAIN}/`,
            method: 'GET',
            headers: {
                referer: `${TOONGOD_DOMAIN}/`
            }
        })
    }

    getMangaShareUrl(mangaId: string): string {
        return `${TOONGOD_DOMAIN}/webtoon/${mangaId}/`
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const request = App.createRequest({
            url: `${TOONGOD_DOMAIN}/webtoon/${mangaId}/`,
            method: 'GET'
        })
        const response = await this.requestManager.schedule(request, 1)
        return parseMangaDetails(response.data || '', mangaId)
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        // 1. First attempt: chapters embedded in the webtoon page
        const request = App.createRequest({
            url: `${TOONGOD_DOMAIN}/webtoon/${mangaId}/`,
            method: 'GET'
        })
        const response = await this.requestManager.schedule(request, 1)
        const html = response.data || ''
        let chapters = parseChapters(html, mangaId)

        // 2. Fallback: Madara AJAX chapters endpoint if static page had no chapters
        if (chapters.length === 0) {
            try {
                const ajaxRequest = App.createRequest({
                    url: `${TOONGOD_DOMAIN}/webtoon/${mangaId}/ajax/chapters/`,
                    method: 'POST'
                })
                const ajaxRes = await this.requestManager.schedule(ajaxRequest, 1)
                chapters = parseChapters(ajaxRes.data || '', mangaId)
            } catch {
                // Ignore and proceed
            }
        }

        return chapters
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const url = `${TOONGOD_DOMAIN}/webtoon/${mangaId}/${chapterId}/?style=list`
        const request = App.createRequest({
            url,
            method: 'GET'
        })
        const response = await this.requestManager.schedule(request, 1)
        return parseChapterDetails(response.data || '', mangaId, chapterId)
    }

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        const sections: { section: HomeSection; orderby: string }[] = [
            {
                section: App.createHomeSection({
                    id: 'latest',
                    title: 'Latest Updates',
                    view_more: true,
                    type: HomeSectionType.singleRowLarge
                }),
                orderby: 'latest'
            },
            {
                section: App.createHomeSection({
                    id: 'views',
                    title: 'Most Popular',
                    view_more: true,
                    type: HomeSectionType.singleRowNormal
                }),
                orderby: 'views'
            },
            {
                section: App.createHomeSection({
                    id: 'rating',
                    title: 'Top Rated',
                    view_more: true,
                    type: HomeSectionType.singleRowNormal
                }),
                orderby: 'rating'
            },
            {
                section: App.createHomeSection({
                    id: 'new-manga',
                    title: 'New Releases',
                    view_more: true,
                    type: HomeSectionType.singleRowNormal
                }),
                orderby: 'new-manga'
            }
        ]

        for (const { section, orderby } of sections) {
            sectionCallback(section)
            try {
                const items = await this.fetchSectionItems(orderby, 1)
                section.items = items
                sectionCallback(section)
            } catch {
                section.items = []
                sectionCallback(section)
            }
        }
    }

    async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        const page: number = typeof metadata?.page === 'number' ? metadata.page : 1
        const items = await this.fetchSectionItems(homepageSectionId, page)
        const nextMetadata = items.length >= 10 ? { page: page + 1 } : undefined

        return App.createPagedResults({
            results: items,
            metadata: nextMetadata
        })
    }

    private async fetchSectionItems(orderby: string, page: number): Promise<PartialSourceManga[]> {
        const pageParam = page > 1 ? `page/${page}/` : ''
        
        // 1. Primary: /webtoons/[page/N/]?m_orderby=...
        try {
            const url = `${TOONGOD_DOMAIN}/webtoons/${pageParam}?m_orderby=${orderby}`
            const request = App.createRequest({
                url,
                method: 'GET'
            })
            const response = await this.requestManager.schedule(request, 1)
            const items = parseMangaItems(response.data || '')
            if (items.length > 0) return items
        } catch {}

        // 2. Fallback for 'views' -> 'trending'
        if (orderby === 'views') {
            try {
                const url = `${TOONGOD_DOMAIN}/webtoons/${pageParam}?m_orderby=trending`
                const request = App.createRequest({
                    url,
                    method: 'GET'
                })
                const response = await this.requestManager.schedule(request, 1)
                const items = parseMangaItems(response.data || '')
                if (items.length > 0) return items
            } catch {}
        }

        // 3. Fallback: query params on /webtoons/
        try {
            const pagePrefix = page > 1 ? `/page/${page}/` : '/'
            const url = `${TOONGOD_DOMAIN}/webtoons${pagePrefix}?m_orderby=${orderby}&post_type=wp-manga`
            const request = App.createRequest({
                url,
                method: 'GET'
            })
            const response = await this.requestManager.schedule(request, 1)
            return parseMangaItems(response.data || '')
        } catch {}

        return []
    }

    async getSearchTags(): Promise<TagSection[]> {
        return getToonGodTagSections()
    }

    async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
        const page: number = typeof metadata?.page === 'number' ? metadata.page : 1
        const pageParam = page > 1 ? `page/${page}/` : ''

        let genreSlug: string | undefined = metadata?.genreSlug
        let searchKeywords: string = metadata?.searchKeywords ?? ''

        if (typeof metadata?.genreSlug === 'undefined' && typeof metadata?.searchKeywords === 'undefined') {
            if (query.includedTags && query.includedTags.length > 0 && query.includedTags[0]?.id) {
                genreSlug = query.includedTags[0].id
            }

            if (query.title && query.title.trim().length > 0) {
                const parsed = parseToonGodSearchPrefix(query.title)
                if (parsed.genreSlug && !genreSlug) {
                    genreSlug = parsed.genreSlug
                }
                searchKeywords = parsed.searchKeywords
            }
        }

        let url: string
        if (genreSlug) {
            const searchParam = searchKeywords ? `?s=${encodeURIComponent(searchKeywords)}` : ''
            url = `${TOONGOD_DOMAIN}/webtoon-genre/${encodeURIComponent(genreSlug)}/${pageParam}${searchParam}`
        } else if (searchKeywords) {
            const pagePrefix = page > 1 ? `/page/${page}/` : '/'
            url = `${TOONGOD_DOMAIN}${pagePrefix}?s=${encodeURIComponent(searchKeywords)}&post_type=wp-manga`
        } else {
            url = `${TOONGOD_DOMAIN}/webtoons/${pageParam}?m_orderby=latest`
        }

        try {
            const request = App.createRequest({
                url,
                method: 'GET'
            })
            const response = await this.requestManager.schedule(request, 1)
            if (response.status === 404) {
                return App.createPagedResults({ results: [] })
            }
            const html = response.data || ''
            const items = parseMangaItems(html)

            const nextPageNum = page + 1
            const hasNext = items.length > 0 && (
                html.includes('nextpostslink') ||
                html.includes(`/page/${nextPageNum}/`) ||
                html.includes(`page/${nextPageNum}/`) ||
                items.length >= 18
            )

            const nextMetadata = hasNext ? { page: nextPageNum, genreSlug, searchKeywords } : undefined

            return App.createPagedResults({
                results: items,
                metadata: nextMetadata
            })
        } catch {
            return App.createPagedResults({ results: [] })
        }
    }
}
