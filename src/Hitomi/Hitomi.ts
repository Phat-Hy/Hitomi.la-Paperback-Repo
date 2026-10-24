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
    PartialSourceManga,
    Request,
    Response,
    SearchRequest,
    SearchResultsProviding,
    SourceInfo,
    SourceIntents,
    SourceManga,
    Tag,
    TagSection
} from '@paperback/types'
import { searchGalleryIdsByTerm } from './HitomiBTree'
import { HitomiGallery } from './HitomiModels'
import {
    ImageUriResolver,
    parseGalleryJson,
    parseGalleryToChapterDetails,
    parseGalleryToSourceManga,
    parseNozomiBuffer,
    responseToArrayBuffer
} from './HitomiParser'

const HITOMI_DOMAIN = 'https://hitomi.la'
const LTN_DOMAIN = 'https://ltn.gold-usergeneratedcontent.net'

export const HitomiInfo: SourceInfo = {
    version: '1.0.0',
    name: 'Hitomi',
    icon: 'icon.png',
    author: 'Phat-Hy',
    authorWebsite: 'https://github.com/Phat-Hy',
    description: 'Extension that pulls manga and doujinshi from hitomi.la',
    contentRating: ContentRating.ADULT,
    websiteBaseURL: HITOMI_DOMAIN,
    sourceTags: [
        {
            text: '18+',
            type: BadgeColor.RED
        }
    ],
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS | SourceIntents.CLOUDFLARE_BYPASS_REQUIRED
}

export class Hitomi implements SearchResultsProviding, MangaProviding, ChapterProviding, HomePageSectionsProviding {
    requestManager = App.createRequestManager({
        requestsPerSecond: 6,
        requestTimeout: 20000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                request.headers = {
                    ...(request.headers ?? {}),
                    referer: `${HITOMI_DOMAIN}/`,
                    'user-agent': await this.requestManager.getDefaultUserAgent()
                }
                return request
            },
            interceptResponse: async (response: Response): Promise<Response> => {
                return response
            }
        }
    })

    private galleryCache = new Map<string, HitomiGallery>()

    private async ensureGG(): Promise<void> {
        if (!ImageUriResolver.needsSync()) return

        const request = App.createRequest({
            url: `${LTN_DOMAIN}/gg.js`,
            method: 'GET'
        })
        const response = await this.requestManager.schedule(request, 1)
        if (response.data && typeof response.data === 'string') {
            ImageUriResolver.parseGG(response.data)
        }
    }

    private fetchBinary = async (url: string, headers?: Record<string, string>): Promise<ArrayBuffer> => {
        const request = App.createRequest({
            url,
            method: 'GET',
            headers: headers || {}
        })
        const response = await this.requestManager.schedule(request, 1)
        return responseToArrayBuffer(response)
    }

    private async fetchGallery(id: string): Promise<HitomiGallery> {
        const cached = this.galleryCache.get(id)
        if (cached) return cached

        const request = App.createRequest({
            url: `${LTN_DOMAIN}/galleries/${id}.js`,
            method: 'GET'
        })
        const response = await this.requestManager.schedule(request, 1)
        this.checkCloudflareError(response.status)

        const raw = response.data || ''
        const gallery = parseGalleryJson(raw, id)
        this.galleryCache.set(id, gallery)
        return gallery
    }

    private async buildPartialSourceManga(id: number): Promise<PartialSourceManga | null> {
        try {
            const gallery = await this.fetchGallery(String(id))
            let thumbnail = ''
            if (gallery.files.length > 0 && gallery.files[0]) {
                thumbnail = ImageUriResolver.getImageUri(gallery.files[0], 'webp', { isThumbnail: true, isSmall: false })
            }

            const subtitleParts: string[] = []
            if (gallery.artists.length > 0) subtitleParts.push(gallery.artists.join(', '))
            if (gallery.languageName.english) subtitleParts.push(gallery.languageName.english)

            return App.createPartialSourceManga({
                mangaId: String(gallery.id),
                image: thumbnail,
                title: gallery.title.display,
                subtitle: subtitleParts.join(' · ')
            })
        } catch {
            return null
        }
    }

    getMangaShareUrl(mangaId: string): string {
        return `${HITOMI_DOMAIN}/galleries/${mangaId}.html`
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        await this.ensureGG()
        const gallery = await this.fetchGallery(mangaId)
        return parseGalleryToSourceManga(gallery, mangaId)
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const gallery = await this.fetchGallery(mangaId)
        return [
            App.createChapter({
                id: mangaId,
                mangaId: mangaId,
                name: 'Chapter 1',
                chapNum: 1,
                time: gallery.publishedDate || new Date()
            })
        ]
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        await this.ensureGG()
        const gallery = await this.fetchGallery(mangaId)
        return parseGalleryToChapterDetails(gallery, mangaId, chapterId)
    }

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        await this.ensureGG()

        const sections = [
            App.createHomeSection({
                id: 'popular_today',
                title: 'Popular Today',
                type: HomeSectionType.singleRowNormal,
                containsMoreItems: true
            }),
            App.createHomeSection({
                id: 'popular_week',
                title: 'Popular This Week',
                type: HomeSectionType.singleRowNormal,
                containsMoreItems: true
            }),
            App.createHomeSection({
                id: 'recently_added',
                title: 'Recently Added',
                type: HomeSectionType.singleRowNormal,
                containsMoreItems: true
            })
        ]

        // Populate popular today
        sectionCallback(sections[0]!)
        this.fetchNozomiSection('popular/today-all.nozomi', 0, 16)
            .then(items => {
                sections[0]!.items = items
                sectionCallback(sections[0]!)
            })
            .catch(() => undefined)

        // Populate popular this week
        sectionCallback(sections[1]!)
        this.fetchNozomiSection('popular/week-all.nozomi', 0, 16)
            .then(items => {
                sections[1]!.items = items
                sectionCallback(sections[1]!)
            })
            .catch(() => undefined)

        // Populate recently added
        sectionCallback(sections[2]!)
        this.fetchNozomiSection('n/index-all.nozomi', 0, 16)
            .then(items => {
                sections[2]!.items = items
                sectionCallback(sections[2]!)
            })
            .catch(() => undefined)
    }

    private async fetchNozomiSection(path: string, offsetIndex: number, limit: number): Promise<PartialSourceManga[]> {
        const byteStart = offsetIndex * 4
        const byteEnd = (offsetIndex + limit) * 4 - 1
        const buffer = await this.fetchBinary(`${LTN_DOMAIN}/${path}`, {
            Range: `bytes=${byteStart}-${byteEnd}`
        })
        const ids = parseNozomiBuffer(buffer)
        const mangas: PartialSourceManga[] = []
        for (const id of ids) {
            const item = await this.buildPartialSourceManga(id)
            if (item) mangas.push(item)
        }
        return mangas
    }

    async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        await this.ensureGG()
        const page: number = metadata?.page ?? 0
        const pageSize = 24
        let path = 'n/index-all.nozomi'

        switch (homepageSectionId) {
            case 'popular_today':
                path = 'popular/today-all.nozomi'
                break
            case 'popular_week':
                path = 'popular/week-all.nozomi'
                break
            case 'recently_added':
                path = 'n/index-all.nozomi'
                break
            default:
                throw new Error(`Invalid section ID: ${homepageSectionId}`)
        }

        const mangas = await this.fetchNozomiSection(path, page * pageSize, pageSize)
        const nextMetadata = mangas.length >= pageSize ? { page: page + 1 } : undefined

        return App.createPagedResults({
            results: mangas,
            metadata: nextMetadata
        })
    }

    async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
        await this.ensureGG()
        const page: number = metadata?.page ?? 0
        const pageSize = 24

        let allIds: number[] = metadata?.allIds ?? []

        if (!metadata?.allIds) {
            const title = query.title?.trim()
            if (title && /^\d+$/.test(title)) {
                // Direct ID search
                const id = parseInt(title, 10)
                const item = await this.buildPartialSourceManga(id)
                return App.createPagedResults({
                    results: item ? [item] : []
                })
            }

            if (title) {
                // B-Tree search by term
                allIds = await searchGalleryIdsByTerm(title, this.fetchBinary)
            } else if (query.includedTags && query.includedTags.length > 0) {
                // Search by tag
                const tagId = query.includedTags[0]?.id
                if (tagId) {
                    allIds = await searchGalleryIdsByTerm(tagId, this.fetchBinary)
                }
            } else {
                // Default search: latest galleries
                const buffer = await this.fetchBinary(`${LTN_DOMAIN}/n/index-all.nozomi`, {
                    Range: `bytes=0-399`
                })
                allIds = parseNozomiBuffer(buffer)
            }
        }

        const start = page * pageSize
        const end = start + pageSize
        const sliceIds = allIds.slice(start, end)

        const mangas: PartialSourceManga[] = []
        for (const id of sliceIds) {
            const item = await this.buildPartialSourceManga(id)
            if (item) mangas.push(item)
        }

        const nextMetadata = end < allIds.length ? { page: page + 1, allIds } : undefined

        return App.createPagedResults({
            results: mangas,
            metadata: nextMetadata
        })
    }

    async getSearchTags(): Promise<TagSection[]> {
        const categories: Tag[] = [
            App.createTag({ id: 'type:doujinshi', label: 'Doujinshi' }),
            App.createTag({ id: 'type:manga', label: 'Manga' }),
            App.createTag({ id: 'type:artistcg', label: 'Artist CG' }),
            App.createTag({ id: 'type:gamecg', label: 'Game CG' }),
            App.createTag({ id: 'type:anime', label: 'Anime' })
        ]

        const languages: Tag[] = [
            App.createTag({ id: 'language:english', label: 'English' }),
            App.createTag({ id: 'language:japanese', label: 'Japanese' }),
            App.createTag({ id: 'language:chinese', label: 'Chinese' }),
            App.createTag({ id: 'language:korean', label: 'Korean' }),
            App.createTag({ id: 'language:spanish', label: 'Spanish' })
        ]

        return [
            App.createTagSection({ id: 'categories', label: 'Categories', tags: categories }),
            App.createTagSection({ id: 'languages', label: 'Languages', tags: languages })
        ]
    }

    private checkCloudflareError(status: number): void {
        if (status === 503 || status === 403) {
            throw new Error(`CLOUDFLARE BYPASS ERROR:\nPlease open Hitomi.la in the Paperback in-app browser to pass Cloudflare.`)
        }
    }

    async getCloudflareBypassRequestAsync(): Promise<Request> {
        return App.createRequest({
            url: HITOMI_DOMAIN,
            method: 'GET',
            headers: {
                referer: `${HITOMI_DOMAIN}/`,
                'user-agent': await this.requestManager.getDefaultUserAgent()
            }
        })
    }
}
