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
    ContentRating,
    HomePageSectionsProviding,
    HomeSection,
    HomeSectionType,
    MangaProviding,
    PagedResults,
    PartialSourceManga,
    TagSection,
    Request,
    Response,
    SearchRequest,
    SearchResultsProviding,
    SourceInfo,
    SourceIntents,
    SourceManga
} from '@paperback/types'
import {
    parseChapterDetails,
    parseChapters,
    parseMangaDetails,
    parseMangaItems
} from './AllPornComicParser'
import {
    getAllTagSections,
    parseSearchPrefix
} from './AllPornComicTags'

const APC_DOMAIN = 'https://allporncomic.com'

export const AllPornComicInfo: SourceInfo = {
    version: '1.0.10',
    name: 'AllPornComic',
    icon: 'icon.png',
    author: 'Phat-Hy',
    authorWebsite: 'https://github.com/Phat-Hy',
    description: 'Extension that pulls adult comics and webtoons from allporncomic.com',
    contentRating: ContentRating.ADULT,
    websiteBaseURL: APC_DOMAIN,
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS,
    sourceTags: [
        {
            text: '18+',
            type: BadgeColor.RED
        }
    ]
}

export class AllPornComic implements
    SearchResultsProviding,
    MangaProviding,
    ChapterProviding,
    HomePageSectionsProviding {

    requestManager = App.createRequestManager({
        requestsPerSecond: 4,
        requestTimeout: 25000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                request.headers = {
                    ...(request.headers ?? {}),
                    referer: `${APC_DOMAIN}/`,
                    Referer: `${APC_DOMAIN}/`,
                    Origin: APC_DOMAIN
                }
                return request
            },
            interceptResponse: async (response: Response): Promise<Response> => {
                return response
            }
        }
    })

    getMangaShareUrl(mangaId: string): string {
        return `${APC_DOMAIN}/porncomic/${mangaId}/`
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const request = App.createRequest({
            url: `${APC_DOMAIN}/porncomic/${mangaId}/`,
            method: 'GET'
        })
        const response = await this.requestManager.schedule(request, 1)
        return parseMangaDetails(response.data || '', mangaId)
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        // 1. First attempt: chapters embedded in the manga page
        const request = App.createRequest({
            url: `${APC_DOMAIN}/porncomic/${mangaId}/`,
            method: 'GET'
        })
        const response = await this.requestManager.schedule(request, 1)
        const html = response.data || ''
        let chapters = parseChapters(html, mangaId)

        // 2. Fallback: Madara AJAX chapters endpoint if static page had no chapters
        if (chapters.length === 0) {
            try {
                const ajaxRequest = App.createRequest({
                    url: `${APC_DOMAIN}/porncomic/${mangaId}/ajax/chapters/`,
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
        const cleanChapterSlug = chapterId.includes('/') ? chapterId.split('/').pop()! : chapterId
        const url = `${APC_DOMAIN}/porncomic/${mangaId}/${cleanChapterSlug}/?style=list`
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
        const pageParam = page > 1 ? `/page/${page}/` : '/'
        const url = `${APC_DOMAIN}${pageParam}?m_orderby=${orderby}&post_type=wp-manga`
        const request = App.createRequest({
            url,
            method: 'GET'
        })
        const response = await this.requestManager.schedule(request, 1)
        return parseMangaItems(response.data || '')
    }

    async getSearchTags(): Promise<TagSection[]> {
        return getAllTagSections()
    }

    async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
        const page: number = typeof metadata?.page === 'number' ? metadata.page : 1
        const pageParam = page > 1 ? `/page/${page}/` : '/'
        
        let taxPath: string | undefined = metadata?.taxPath
        let searchKeywords: string = metadata?.searchKeywords ?? ''

        // On page 1 (or if metadata did not carry state), initialize from query
        if (typeof metadata?.taxPath === 'undefined' && typeof metadata?.searchKeywords === 'undefined') {
            if (query.includedTags && query.includedTags.length > 0 && query.includedTags[0]?.id) {
                taxPath = query.includedTags[0].id
            }

            if (query.title && query.title.trim().length > 0) {
                const parsed = parseSearchPrefix(query.title)
                if (parsed.taxPath && !taxPath) {
                    taxPath = parsed.taxPath
                }
                searchKeywords = parsed.searchKeywords
            }
        }

        let url: string
        if (taxPath) {
            const cleanTax = taxPath.replace(/^\//, '').replace(/\/$/, '')
            const searchParam = searchKeywords ? `?s=${encodeURIComponent(searchKeywords)}&post_type=wp-manga` : ''
            url = `${APC_DOMAIN}/${cleanTax}${pageParam}${searchParam}`
        } else if (searchKeywords) {
            url = `${APC_DOMAIN}${pageParam}?s=${encodeURIComponent(searchKeywords)}&post_type=wp-manga`
        } else {
            url = `${APC_DOMAIN}${pageParam}?m_orderby=latest&post_type=wp-manga`
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
                items.length >= 18
            )

            const nextMetadata = hasNext ? { page: nextPageNum, taxPath, searchKeywords } : undefined

            return App.createPagedResults({
                results: items,
                metadata: nextMetadata
            })
        } catch {
            return App.createPagedResults({ results: [] })
        }
    }
}
