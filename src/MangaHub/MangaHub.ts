/* SPDX-License-Identifier: GPL-3.0-or-later */

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
    parseChapterPages,
    parseChapters,
    parseMangaDetails,
    parseMangaTile
} from './MangaHubParser'
import { getMangaHubSearchTags } from './MangaHubTags'

const MANGAHUB_DOMAIN = 'https://mangahub.io'
const GRAPHQL_URL = 'https://api.mghcdn.com/graphql'

function generateApiKey(): string {
    let key = ''
    const hex = '0123456789abcdef'
    for (let i = 0; i < 32; i++) {
        key += hex.charAt(Math.floor(Math.random() * hex.length))
    }
    return key
}

export const MangaHubInfo: SourceInfo = {
    version: '1.0.0',
    name: 'MangaHub',
    icon: 'icon.png',
    author: 'Phat-Hy',
    authorWebsite: 'https://github.com/Phat-Hy',
    description: 'Extension that pulls manga, manhwa, and comics from mangahub.io',
    contentRating: ContentRating.EVERYONE,
    websiteBaseURL: MANGAHUB_DOMAIN,
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS | SourceIntents.CLOUDFLARE_BYPASS_REQUIRED,
    sourceTags: [
        {
            text: 'Manga',
            type: BadgeColor.BLUE
        },
        {
            text: 'Webtoon',
            type: BadgeColor.GREEN
        },
        {
            text: 'Cloudflare',
            type: BadgeColor.GREY
        }
    ]
}

export class MangaHub implements
    SearchResultsProviding,
    MangaProviding,
    ChapterProviding,
    HomePageSectionsProviding,
    CloudflareBypassRequestProviding {

    private apiKey: string = generateApiKey()

    requestManager = App.createRequestManager({
        requestsPerSecond: 4,
        requestTimeout: 20000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                const headers: Record<string, string> = { ...(request.headers ?? {}) }

                if (request.url.includes('api.mghcdn.com')) {
                    headers['Content-Type'] = 'application/json'
                    headers['Accept'] = 'application/json'
                    headers['x-mhub-access'] = this.apiKey
                    headers['Cookie'] = `mhub_access=${this.apiKey}`
                    headers['Origin'] = MANGAHUB_DOMAIN
                    headers['Referer'] = `${MANGAHUB_DOMAIN}/`
                } else if (request.url.includes('mghcdn.com') || request.url.includes('mangahub.io')) {
                    headers['Referer'] = `${MANGAHUB_DOMAIN}/`
                    headers['Origin'] = MANGAHUB_DOMAIN
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

    async getCloudflareBypassRequestAsync(): Promise<Request> {
        return App.createRequest({
            url: `${MANGAHUB_DOMAIN}/`,
            method: 'GET',
            headers: {
                Referer: `${MANGAHUB_DOMAIN}/`,
                Origin: MANGAHUB_DOMAIN
            }
        })
    }

    private async queryGraphQL<T = any>(query: string): Promise<T> {
        const body = JSON.stringify({ query })
        const request = App.createRequest({
            url: GRAPHQL_URL,
            method: 'POST',
            data: body,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        })

        const response = await this.requestManager.schedule(request, 1)
        const rawText = response.data || '{}'
        let parsed: any = {}
        try {
            parsed = JSON.parse(rawText)
        } catch (_) {
            parsed = {}
        }

        if (parsed.errors || (rawText && /rate\s*limit|api\s*key|invalid/i.test(rawText))) {
            this.apiKey = generateApiKey()
            const retryReq = App.createRequest({
                url: GRAPHQL_URL,
                method: 'POST',
                data: body,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            })
            const retryRes = await this.requestManager.schedule(retryReq, 1)
            try {
                return JSON.parse(retryRes.data || '{}') as T
            } catch (_) {
                return {} as T
            }
        }

        return parsed as T
    }

    getMangaShareUrl(mangaId: string): string {
        return `${MANGAHUB_DOMAIN}/manga/${mangaId}`
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const gql = `{
            manga(x: m01, slug: "${mangaId}") {
                title
                slug
                status
                image
                author
                artist
                genres
                description
                alternativeTitle
            }
        }`
        const json = await this.queryGraphQL<any>(gql)
        return parseMangaDetails(json, mangaId)
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const gql = `{
            manga(x: m01, slug: "${mangaId}") {
                chapters {
                    number
                    title
                    date
                }
            }
        }`
        const json = await this.queryGraphQL<any>(gql)
        const chapters = json.data?.manga?.chapters || []
        return parseChapters(chapters, mangaId)
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const chapNum = parseFloat(chapterId)
        const gql = `{
            chapter(x: m01, slug: "${mangaId}", number: ${chapNum}) {
                pages
                mangaID
                number
            }
        }`
        const json = await this.queryGraphQL<any>(gql)
        const rawPages = json.data?.chapter?.pages || ''
        const pages = parseChapterPages(rawPages)

        return App.createChapterDetails({
            id: chapterId,
            mangaId,
            pages
        })
    }

    async getSearchTags(): Promise<TagSection[]> {
        return getMangaHubSearchTags()
    }

    async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
        const page = metadata?.page ?? 1
        const offset = (page - 1) * 30
        const keyword = (query.title || '').trim().replace(/"/g, '\\"')

        let order = 'POPULAR'
        let genre = 'all'

        for (const tag of query.includedTags ?? []) {
            if (tag.id.startsWith('sort_')) {
                order = tag.id.replace('sort_', '')
            } else if (tag.id.startsWith('format_')) {
                genre = tag.id.replace('format_', '')
            } else if (tag.id.startsWith('genre_')) {
                genre = tag.id.replace('genre_', '')
            }
        }

        const gql = `{
            search(x: m01, q: "${keyword}", genre: "${genre}", mod: ${order}, offset: ${offset}) {
                rows {
                    title
                    slug
                    image
                }
            }
        }`

        const json = await this.queryGraphQL<any>(gql)
        const rows = json.data?.search?.rows || []
        const results = rows.map(parseMangaTile)
        const hasNext = rows.length === 30

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
                    id: 'mangahub_popular',
                    title: 'Popular Manga',
                    type: HomeSectionType.featured,
                    containsMoreItems: true
                }),
                fetch: async () => {
                    const json = await this.queryGraphQL<any>(`{
                        search(x: m01, q: "", genre: "all", mod: POPULAR, offset: 0) {
                            rows { title, slug, image }
                        }
                    }`)
                    return json.data?.search?.rows || []
                }
            },
            {
                section: App.createHomeSection({
                    id: 'mangahub_latest',
                    title: 'Latest Updates',
                    type: HomeSectionType.singleRowNormal,
                    containsMoreItems: true
                }),
                fetch: async () => {
                    const json = await this.queryGraphQL<any>(`{
                        search(x: m01, q: "", genre: "all", mod: LATEST, offset: 0) {
                            rows { title, slug, image }
                        }
                    }`)
                    return json.data?.search?.rows || []
                }
            },
            {
                section: App.createHomeSection({
                    id: 'mangahub_manhwa',
                    title: 'Popular Manhwa (Webtoons)',
                    type: HomeSectionType.singleRowNormal,
                    containsMoreItems: true
                }),
                fetch: async () => {
                    const json = await this.queryGraphQL<any>(`{
                        search(x: m01, q: "", genre: "manhwa", mod: POPULAR, offset: 0) {
                            rows { title, slug, image }
                        }
                    }`)
                    return json.data?.search?.rows || []
                }
            },
            {
                section: App.createHomeSection({
                    id: 'mangahub_manhua',
                    title: 'Popular Manhua',
                    type: HomeSectionType.singleRowNormal,
                    containsMoreItems: true
                }),
                fetch: async () => {
                    const json = await this.queryGraphQL<any>(`{
                        search(x: m01, q: "", genre: "manhua", mod: POPULAR, offset: 0) {
                            rows { title, slug, image }
                        }
                    }`)
                    return json.data?.search?.rows || []
                }
            },
            {
                section: App.createHomeSection({
                    id: 'mangahub_new',
                    title: 'Recently Added',
                    type: HomeSectionType.singleRowNormal,
                    containsMoreItems: true
                }),
                fetch: async () => {
                    const json = await this.queryGraphQL<any>(`{
                        search(x: m01, q: "", genre: "all", mod: NEW, offset: 0) {
                            rows { title, slug, image }
                        }
                    }`)
                    return json.data?.search?.rows || []
                }
            },
            {
                section: App.createHomeSection({
                    id: 'mangahub_completed',
                    title: 'Completed Series',
                    type: HomeSectionType.singleRowNormal,
                    containsMoreItems: true
                }),
                fetch: async () => {
                    const json = await this.queryGraphQL<any>(`{
                        search(x: m01, q: "", genre: "all", mod: COMPLETED, offset: 0) {
                            rows { title, slug, image }
                        }
                    }`)
                    return json.data?.search?.rows || []
                }
            }
        ]

        // Emit initial empty sections so the UI renders placeholders immediately
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
        const offset = (page - 1) * 30

        let order = 'POPULAR'
        let genre = 'all'

        switch (homepageSectionId) {
            case 'mangahub_latest':
                order = 'LATEST'
                break
            case 'mangahub_manhwa':
                genre = 'manhwa'
                break
            case 'mangahub_manhua':
                genre = 'manhua'
                break
            case 'mangahub_new':
                order = 'NEW'
                break
            case 'mangahub_completed':
                order = 'COMPLETED'
                break
            case 'mangahub_popular':
            default:
                order = 'POPULAR'
                break
        }

        const gql = `{
            search(x: m01, q: "", genre: "${genre}", mod: ${order}, offset: ${offset}) {
                rows {
                    title
                    slug
                    image
                }
            }
        }`

        const json = await this.queryGraphQL<any>(gql)
        const rows = json.data?.search?.rows || []
        const results = rows.map(parseMangaTile)
        const hasNext = rows.length === 30

        return App.createPagedResults({
            results,
            metadata: hasNext ? { page: page + 1 } : undefined
        })
    }
}
