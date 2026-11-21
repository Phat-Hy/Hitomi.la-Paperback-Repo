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
    decryptPayload,
    getActiveVersion,
    serializeParams,
    signPath,
    updateComixKey
} from './ComixCrypto'
import {
    parseChapterDetails,
    parseChapters,
    parseMangaDetails,
    parseMangaTile
} from './ComixParser'
import { getComixSearchTags } from './ComixTags'

const COMIX_DOMAIN = 'https://comix.to'
const API_BASE = `${COMIX_DOMAIN}/api/v1`

/**
 * Normalises whatever was thrown into a real Error with a message.
 *
 * iOS JavaScriptCore surfaces a bare rejection as "JSError undefined" and the
 * app falls back to `PaperbackError(300)`, which tells the user nothing. Every
 * catch block funnels through here so a message always survives.
 */
function toError(err: any, fallback: string): Error {
    const message = err && typeof err.message === 'string' ? err.message.trim() : ''
    if (message) return err instanceof Error ? err : new Error(message)
    if (typeof err === 'string' && err.trim()) return new Error(`${fallback}: ${err.trim()}`)
    if (err && typeof err === 'object') {
        try {
            const json = JSON.stringify(err)
            if (json && json !== '{}' && json !== 'null') return new Error(`${fallback}: ${json}`)
        } catch (_) {}
    }
    return new Error(fallback)
}

export const ComixInfo: SourceInfo = {
    version: "1.1.9",
    name: 'Comix',
    icon: 'icon.png',
    author: 'Phat-Hy',
    authorWebsite: 'https://github.com/Phat-Hy',
    description: 'Extension that pulls manga, manhwa, manhua, and comics from comix.to',
    contentRating: ContentRating.EVERYONE,
    websiteBaseURL: COMIX_DOMAIN,
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

export class Comix implements
    SearchResultsProviding,
    MangaProviding,
    ChapterProviding,
    HomePageSectionsProviding,
    CloudflareBypassRequestProviding {

    requestManager = App.createRequestManager({
        requestsPerSecond: 4,
        requestTimeout: 20000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                if (!request) return request
                const headers: Record<string, string> = { ...(request.headers ?? {}) }
                if (request.url && request.url.includes('comix.to')) {
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

    async getCloudflareBypassRequestAsync(): Promise<Request> {
        return App.createRequest({
            url: `${COMIX_DOMAIN}/@waf/challenge?return=/`,
            method: 'GET',
            headers: {
                Referer: `${COMIX_DOMAIN}/`
            }
        })
    }

    private lastKeySyncTime = 0
    private readonly KEY_SYNC_INTERVAL = 3600000 // 1 hour

    private async ensureKeyConfig(force = false): Promise<void> {
        const now = Date.now()
        if (!force && this.lastKeySyncTime > 0 && (now - this.lastKeySyncTime) < this.KEY_SYNC_INTERVAL) {
            return
        }

        const remoteUrls = [
            'https://phat-hy.github.io/Hitomi.la-Paperback-Repo/comix_keys.json',
            'https://raw.githubusercontent.com/Phat-Hy/Hitomi.la-Paperback-Repo/main/comix_keys.json'
        ]

        for (const url of remoteUrls) {
            try {
                const req = App.createRequest({
                    url: `${url}?_t=${now}`,
                    method: 'GET'
                })
                const res = await this.requestManager.schedule(req, 1)
                if (res.status === 200 && res.data) {
                    const cfg = typeof res.data === 'string' ? JSON.parse(res.data) : res.data
                    if (cfg && cfg.version && cfg.key) {
                        // updateComixKey rejects configs older than the bundled
                        // default, so a stale Pages deploy cannot downgrade us.
                        const adopted = updateComixKey(cfg)
                        this.lastKeySyncTime = now
                        if (!adopted) {
                            console.warn(`Comix: ignoring stale remote key ${cfg.version} (active ${getActiveVersion()})`)
                        }
                        return
                    }
                }
            } catch (_) {
                // Try next URL fallback
            }
        }
        this.lastKeySyncTime = now
    }

    private async fetchJson<T = any>(endpoint: string, params: Record<string, any> = {}, retryOnExpired = true): Promise<T> {
        await this.ensureKeyConfig(false)

        const rawQs = serializeParams(params, false)
        const encQs = serializeParams(params, true)
        const pathForSigning = endpoint + (rawQs ? `?${rawQs}` : "")
        const token = signPath(pathForSigning)
        const fullUrl = `${API_BASE}${endpoint}${encQs ? `?${encQs}&` : "?"}_=${token}`

        const request = App.createRequest({
            url: fullUrl,
            method: "GET"
        })

        let response: Response
        try {
            response = await this.requestManager.schedule(request, 1)
        } catch (scheduleErr) {
            throw toError(scheduleErr, 'Comix network error')
        }

        if (!response) {
            throw new Error('Comix network error: Empty response received')
        }

        const rawText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data || {})
        let parsed: any = {}
        try {
            parsed = typeof response.data === 'string' ? JSON.parse(response.data) : (response.data || {})
        } catch (_) {
            parsed = {}
        }

        // A WAF challenge is not a key problem: detect it first so a captcha
        // response never triggers a pointless key refresh and retry.
        const wafChallenge =
            parsed.error === 'captcha_required' ||
            rawText.includes('captcha_required') ||
            rawText.includes('/@waf/challenge') ||
            rawText.includes('cf-mitigated') ||
            rawText.includes('Just a moment...') ||
            rawText.includes('challenge-platform') ||
            response.status === 503

        if (wafChallenge) {
            throw new Error('Cloudflare / WAF verification required! Please tap the Cloud icon on Discover page to verify.')
        }

        // A retired signature is worth one forced key refresh before giving up.
        if (
            parsed.code === 'key_retired' ||
            parsed.code === 'invalid_token' ||
            ((response.status === 401 || response.status === 403) && retryOnExpired)
        ) {
            if (retryOnExpired) {
                await this.ensureKeyConfig(true)
                const retried = await this.fetchJson<T>(endpoint, params, false)
                return retried
            }
            if (parsed.code === 'key_retired' || parsed.code === 'invalid_token') {
                throw new Error('Comix API signing key has expired or is invalid. Please check for extension updates.')
            }
            throw new Error('Comix request was rejected (403). Please tap the Cloud icon on Discover page to verify.')
        }

        if (response.headers?.["x-enc"] === "2" || parsed.e) {
            try {
                return decryptPayload<T>(parsed.e || parsed)
            } catch (decErr) {
                throw toError(decErr, 'Failed to decrypt Comix response')
            }
        }
        return parsed as T
    }

    getMangaShareUrl(mangaId: string): string {
        return `${COMIX_DOMAIN}/title/${mangaId}`
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        try {
            const json = await this.fetchJson(`/manga/${mangaId}`)
            return parseMangaDetails(json, mangaId)
        } catch (err: any) {
            throw toError(err, 'Failed to get manga details')
        }
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        try {
            const allItems: any[] = []
            let page = 1
            let hasNext = true

            while (hasNext && page <= 10) {
                const json: any = await this.fetchJson(`/manga/${mangaId}/chapters`, {
                    limit: 100,
                    page
                })
                if (json.error === 'captcha_required') {
                    throw new Error('Cloudflare / WAF verification required! Please tap the Cloud icon on Discover page to verify.')
                }
                const items = json.result?.items || []
                allItems.push(...items)

                hasNext = Boolean(json.result?.meta?.hasNext)
                page++
            }

            return parseChapters(allItems, mangaId)
        } catch (err: any) {
            throw toError(err, 'Failed to get chapters')
        }
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        try {
            const json = await this.fetchJson(`/chapters/${chapterId}`)
            return parseChapterDetails(json, mangaId, chapterId)
        } catch (err: any) {
            throw toError(err, 'Failed to get chapter details')
        }
    }

    async supportsTagExclusion(): Promise<boolean> {
        return true
    }

    async getSearchTags(): Promise<TagSection[]> {
        return getComixSearchTags()
    }

    async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
        try {
            const page = metadata?.page ?? 1
            const params: Record<string, any> = {
                limit: 20,
                page
            }

            if (query.title && query.title.trim()) {
                params.keyword = query.title.trim()
            }

            const types: string[] = []
            const demographics: number[] = []
            const statuses: string[] = []
            const formatsIn: number[] = []
            const formatsEx: number[] = []
            const genresIn: number[] = []
            const genresEx: number[] = []
            let orderKey: string | undefined

            const processTag = (tagId: string, isExcluded: boolean) => {
                if (tagId.startsWith('type_')) {
                    const val = tagId.replace('type_', '')
                    if (!isExcluded) types.push(val)
                } else if (tagId.startsWith('demo_')) {
                    const val = parseInt(tagId.replace('demo_', ''), 10)
                    if (!isNaN(val) && !isExcluded) demographics.push(val)
                } else if (tagId.startsWith('status_')) {
                    const val = tagId.replace('status_', '')
                    if (!isExcluded) statuses.push(val)
                } else if (tagId.startsWith('format_')) {
                    const val = parseInt(tagId.replace('format_', ''), 10)
                    if (!isNaN(val)) {
                        if (isExcluded) formatsEx.push(val)
                        else formatsIn.push(val)
                    }
                } else if (tagId.startsWith('genre_')) {
                    const val = parseInt(tagId.replace('genre_', ''), 10)
                    if (!isNaN(val)) {
                        if (isExcluded) genresEx.push(val)
                        else genresIn.push(val)
                    }
                } else if (tagId.startsWith('sort_')) {
                    const val = tagId.replace('sort_', '')
                    if (!isExcluded) orderKey = val
                }
            }

            for (const tag of query.includedTags ?? []) {
                processTag(tag.id, false)
            }
            for (const tag of query.excludedTags ?? []) {
                processTag(tag.id, true)
            }

            if (types.length > 0) params.types = types
            if (demographics.length > 0) params.demographics = demographics
            if (statuses.length > 0) params.statuses = statuses
            if (formatsIn.length > 0) params.formats_in = formatsIn
            if (formatsEx.length > 0) params.formats_ex = formatsEx
            if (genresIn.length > 0) params.genres_in = genresIn
            if (genresEx.length > 0) params.genres_ex = genresEx

            if (orderKey) {
                params.order = { [orderKey]: 'desc' }
            } else if (!params.keyword) {
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
        } catch (err: any) {
            throw toError(err, 'Failed to search manga')
        }
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
                    id: 'comix_manga',
                    title: 'Latest Manga',
                    type: HomeSectionType.singleRowNormal,
                    containsMoreItems: true
                }),
                fetch: async () => {
                    const json: any = await this.fetchJson('/manga', {
                        types: ['manga'],
                        order: { chapter_updated_at: 'desc' },
                        limit: 20,
                        page: 1
                    })
                    return json.result?.items || []
                }
            },
            {
                section: App.createHomeSection({
                    id: 'comix_manhwa',
                    title: 'Latest Manhwa (Webtoons)',
                    type: HomeSectionType.singleRowNormal,
                    containsMoreItems: true
                }),
                fetch: async () => {
                    const json: any = await this.fetchJson('/manga', {
                        types: ['manhwa'],
                        order: { chapter_updated_at: 'desc' },
                        limit: 20,
                        page: 1
                    })
                    return json.result?.items || []
                }
            },
            {
                section: App.createHomeSection({
                    id: 'comix_manhua',
                    title: 'Latest Manhua',
                    type: HomeSectionType.singleRowNormal,
                    containsMoreItems: true
                }),
                fetch: async () => {
                    const json: any = await this.fetchJson('/manga', {
                        types: ['manhua'],
                        order: { chapter_updated_at: 'desc' },
                        limit: 20,
                        page: 1
                    })
                    return json.result?.items || []
                }
            },
            {
                section: App.createHomeSection({
                    id: 'comix_popular',
                    title: 'Most Followed',
                    type: HomeSectionType.singleRowNormal,
                    containsMoreItems: true
                }),
                fetch: async () => {
                    const json: any = await this.fetchJson('/manga', {
                        order: { follows_total: 'desc' },
                        limit: 20,
                        page: 1
                    })
                    return json.result?.items || []
                }
            },
            {
                section: App.createHomeSection({
                    id: 'comix_top_rated',
                    title: 'Top Rated',
                    type: HomeSectionType.singleRowNormal,
                    containsMoreItems: true
                }),
                fetch: async () => {
                    const json: any = await this.fetchJson('/manga', {
                        order: { score: 'desc' },
                        limit: 20,
                        page: 1
                    })
                    return json.result?.items || []
                }
            },
            {
                section: App.createHomeSection({
                    id: 'comix_new',
                    title: 'Recently Added',
                    type: HomeSectionType.singleRowNormal,
                    containsMoreItems: true
                }),
                fetch: async () => {
                    const json: any = await this.fetchJson('/manga', {
                        order: { created_at: 'desc' },
                        limit: 20,
                        page: 1
                    })
                    return json.result?.items || []
                }
            }
        ]

        // Emit initial empty sections so the UI renders placeholders immediately
        for (const item of sectionDefs) {
            item.section.items = []
            sectionCallback(item.section)
        }

        // Fetch and populate each section asynchronously
        let failures = 0
        let firstFailure: any = null
        for (const item of sectionDefs) {
            try {
                const rawItems = await item.fetch()
                if (rawItems && rawItems.length > 0) {
                    item.section.items = rawItems.map(parseMangaTile)
                    sectionCallback(item.section)
                }
            } catch (err) {
                failures++
                if (firstFailure === null) firstFailure = err
                console.error(`Error populating section ${item.section.id}:`, err)
            }
        }

        // Empty shelves with no explanation are the worst outcome: if nothing
        // loaded at all, surface one readable error instead of silence.
        if (failures === sectionDefs.length) {
            throw toError(firstFailure, 'Comix home page could not load any section')
        }
    }

    async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        try {
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
            } else {
                let params: Record<string, any> = {
                    limit: 20,
                    page
                }

                switch (homepageSectionId) {
                    case 'comix_manga':
                        params = { ...params, types: ['manga'], order: { chapter_updated_at: 'desc' } }
                        break
                    case 'comix_manhwa':
                        params = { ...params, types: ['manhwa'], order: { chapter_updated_at: 'desc' } }
                        break
                    case 'comix_manhua':
                        params = { ...params, types: ['manhua'], order: { chapter_updated_at: 'desc' } }
                        break
                    case 'comix_popular':
                        params = { ...params, order: { follows_total: 'desc' } }
                        break
                    case 'comix_top_rated':
                        params = { ...params, order: { score: 'desc' } }
                        break
                    case 'comix_new':
                        params = { ...params, order: { created_at: 'desc' } }
                        break
                    default:
                        params = { ...params, order: { chapter_updated_at: 'desc' } }
                        break
                }

                const json: any = await this.fetchJson('/manga', params)
                const items = json.result?.items || []
                results = items.map(parseMangaTile)
                hasNext = Boolean(json.result?.meta?.hasNext)
            }

            return App.createPagedResults({
                results,
                metadata: hasNext ? { page: page + 1 } : undefined
            })
        } catch (err: any) {
            throw toError(err, 'Failed to load more items')
        }
    }
}
