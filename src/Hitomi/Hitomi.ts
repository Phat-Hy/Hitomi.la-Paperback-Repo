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
import { HitomiGallery } from './HitomiModels'
import {
    ImageUriResolver,
    parseGalleryJson,
    parseGalleryToChapterDetails,
    parseGalleryToSourceManga
} from './HitomiParser'

const HITOMI_DOMAIN = 'https://hitomi.la'
const LTN_DOMAIN = 'https://ltn.gold-usergeneratedcontent.net'

export const HitomiInfo: SourceInfo = {
    version: '1.1.0',
    name: 'Hitomi',
    icon: 'icon.png',
    author: 'Phat-Hy',
    authorWebsite: 'https://github.com/Phat-Hy',
    description: 'Full-featured extension for hitomi.la with smart search and multi-section homepage',
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

        try {
            const request = App.createRequest({
                url: `${LTN_DOMAIN}/gg.js`,
                method: 'GET'
            })
            const response = await this.requestManager.schedule(request, 1)
            if (response.data && typeof response.data === 'string') {
                ImageUriResolver.parseGG(response.data)
            }
        } catch {
            // ImageUriResolver has resilient internal fallback mappings
        }
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

    private async fetchAtomSection(path: string, limit: number): Promise<PartialSourceManga[]> {
        const request = App.createRequest({
            url: `${HITOMI_DOMAIN}/${path}`,
            method: 'GET'
        })
        const response = await this.requestManager.schedule(request, 1)
        this.checkCloudflareError(response.status)

        const xml = response.data || ''
        const regex = /<entry>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<id>[\s\S]*?-(\d+)\.html<\/id>[\s\S]*?<\/entry>/g
        const entries: { title: string; id: string }[] = []
        let match: RegExpExecArray | null

        while ((match = regex.exec(xml)) !== null && entries.length < limit) {
            if (match[1] && match[2]) {
                entries.push({ title: match[1].trim(), id: match[2].trim() })
            }
        }

        const items = await Promise.all(
            entries.map(e => this.buildPartialSourceManga(Number(e.id)))
        )

        return items.filter((item): item is PartialSourceManga => item !== null)
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
                id: 'recently_added',
                title: 'Recently Added',
                type: HomeSectionType.singleRowNormal,
                containsMoreItems: true
            }),
            App.createHomeSection({
                id: 'english',
                title: 'English Releases',
                type: HomeSectionType.singleRowNormal,
                containsMoreItems: true
            }),
            App.createHomeSection({
                id: 'japanese',
                title: 'Japanese Releases',
                type: HomeSectionType.singleRowNormal,
                containsMoreItems: true
            }),
            App.createHomeSection({
                id: 'doujinshi',
                title: 'Doujinshi',
                type: HomeSectionType.singleRowNormal,
                containsMoreItems: true
            }),
            App.createHomeSection({
                id: 'manga',
                title: 'Manga',
                type: HomeSectionType.singleRowNormal,
                containsMoreItems: true
            }),
            App.createHomeSection({
                id: 'artistcg',
                title: 'Artist CG',
                type: HomeSectionType.singleRowNormal,
                containsMoreItems: true
            }),
            App.createHomeSection({
                id: 'gamecg',
                title: 'Game CG',
                type: HomeSectionType.singleRowNormal,
                containsMoreItems: true
            })
        ]

        const feedMap: [number, string][] = [
            [0, 'index-all.atom'],
            [1, 'index-english.atom'],
            [2, 'index-japanese.atom'],
            [3, 'type/doujinshi-all.atom'],
            [4, 'type/manga-all.atom'],
            [5, 'type/artistcg-all.atom'],
            [6, 'type/gamecg-all.atom']
        ]

        for (const [idx, path] of feedMap) {
            try {
                const items = await this.fetchAtomSection(path, 16)
                if (items.length > 0) {
                    sections[idx]!.items = items
                    sectionCallback(sections[idx]!)
                }
            } catch {
                // Continue emitting available sections
            }
        }
    }

    async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        await this.ensureGG()
        let path = 'index-all.atom'

        switch (homepageSectionId) {
            case 'recently_added':
                path = 'index-all.atom'
                break
            case 'english':
                path = 'index-english.atom'
                break
            case 'japanese':
                path = 'index-japanese.atom'
                break
            case 'doujinshi':
                path = 'type/doujinshi-all.atom'
                break
            case 'manga':
                path = 'type/manga-all.atom'
                break
            case 'artistcg':
                path = 'type/artistcg-all.atom'
                break
            case 'gamecg':
                path = 'type/gamecg-all.atom'
                break
            default:
                path = 'index-all.atom'
                break
        }

        const items = await this.fetchAtomSection(path, 25)
        return App.createPagedResults({
            results: items
        })
    }

    async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
        await this.ensureGG()
        const title = query.title?.trim()

        // 1. Direct gallery ID lookup
        if (title && /^\d+$/.test(title)) {
            const item = await this.buildPartialSourceManga(parseInt(title, 10))
            return App.createPagedResults({
                results: item ? [item] : []
            })
        }

        // 2. Filter Tag search (when selected from Paperback search filter menu)
        if (query.includedTags && query.includedTags.length > 0) {
            const tag = query.includedTags[0]
            if (tag && tag.id) {
                const path = `${tag.id}-all.atom`
                const items = await this.fetchAtomSection(path, 25)
                return App.createPagedResults({ results: items })
            }
        }

        // 3. User typed search query
        if (title) {
            const clean = title.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim()

            // 3a. Explicit namespace prefix: artist:xxx, female:xxx, series:xxx, etc.
            if (clean.includes(':')) {
                const [prefix, val] = clean.split(':').map(s => s.trim())
                if (val) {
                    const enc = encodeURIComponent(val)
                    let directPath = ''
                    if (prefix === 'female' || prefix === 'male') {
                        directPath = `tag/${prefix}:${enc}-all.atom`
                    } else if (prefix === 'tag') {
                        directPath = `tag/${enc}-all.atom`
                    } else if (prefix === 'artist') {
                        directPath = `artist/${enc}-all.atom`
                    } else if (prefix === 'character') {
                        directPath = `character/${enc}-all.atom`
                    } else if (prefix === 'series' || prefix === 'parody') {
                        directPath = `series/${enc}-all.atom`
                    } else if (prefix === 'group') {
                        directPath = `group/${enc}-all.atom`
                    } else if (prefix === 'type') {
                        directPath = `type/${enc}-all.atom`
                    } else if (prefix === 'language') {
                        directPath = `index-${enc}.atom`
                    }

                    if (directPath) {
                        try {
                            const items = await this.fetchAtomSection(directPath, 25)
                            if (items.length > 0) return App.createPagedResults({ results: items })
                        } catch {}
                    }
                }
            }

            // 3b. Smart probe across candidate Hitomi tag/artist/series feeds
            const enc = encodeURIComponent(clean)
            const candidates = [
                `tag/female:${enc}-all.atom`,
                `artist/${enc}-all.atom`,
                `tag/${enc}-all.atom`,
                `series/${enc}-all.atom`,
                `character/${enc}-all.atom`,
                `tag/male:${enc}-all.atom`,
                `group/${enc}-all.atom`
            ]

            for (const cand of candidates) {
                try {
                    const items = await this.fetchAtomSection(cand, 25)
                    if (items.length > 0) {
                        return App.createPagedResults({ results: items })
                    }
                } catch {
                    // Try next candidate
                }
            }
        }

        // Default: return recent items
        const recent = await this.fetchAtomSection('index-all.atom', 25)
        return App.createPagedResults({
            results: recent
        })
    }

    async getSearchTags(): Promise<TagSection[]> {
        const categories: Tag[] = [
            App.createTag({ id: 'type/doujinshi', label: 'Doujinshi' }),
            App.createTag({ id: 'type/manga', label: 'Manga' }),
            App.createTag({ id: 'type/artistcg', label: 'Artist CG' }),
            App.createTag({ id: 'type/gamecg', label: 'Game CG' }),
            App.createTag({ id: 'type/anime', label: 'Anime' })
        ]

        const languages: Tag[] = [
            App.createTag({ id: 'index-english', label: 'English' }),
            App.createTag({ id: 'index-japanese', label: 'Japanese' }),
            App.createTag({ id: 'index-chinese', label: 'Chinese' }),
            App.createTag({ id: 'index-korean', label: 'Korean' }),
            App.createTag({ id: 'index-spanish', label: 'Spanish' })
        ]

        const femaleTags: Tag[] = [
            App.createTag({ id: 'tag/female:schoolgirl%20uniform', label: 'Schoolgirl Uniform ♀' }),
            App.createTag({ id: 'tag/female:yuri', label: 'Yuri ♀' }),
            App.createTag({ id: 'tag/female:big%20breasts', label: 'Big Breasts ♀' }),
            App.createTag({ id: 'tag/female:sole%20female', label: 'Sole Female ♀' }),
            App.createTag({ id: 'tag/female:stockings', label: 'Stockings ♀' }),
            App.createTag({ id: 'tag/female:maid', label: 'Maid ♀' }),
            App.createTag({ id: 'tag/female:swimsuit', label: 'Swimsuit ♀' }),
            App.createTag({ id: 'tag/female:nakadashi', label: 'Nakadashi ♀' }),
            App.createTag({ id: 'tag/female:ahegao', label: 'Ahegao ♀' }),
            App.createTag({ id: 'tag/female:milf', label: 'Milf ♀' }),
            App.createTag({ id: 'tag/female:gyaru', label: 'Gyaru ♀' })
        ]

        const maleTags: Tag[] = [
            App.createTag({ id: 'tag/male:sole%20male', label: 'Sole Male ♂' }),
            App.createTag({ id: 'tag/male:shota', label: 'Shota ♂' }),
            App.createTag({ id: 'tag/male:glasses', label: 'Glasses ♂' }),
            App.createTag({ id: 'tag/male:dilf', label: 'Dilf ♂' })
        ]

        const generalTags: Tag[] = [
            App.createTag({ id: 'tag/full%20color', label: 'Full Color' }),
            App.createTag({ id: 'tag/group', label: 'Group' }),
            App.createTag({ id: 'tag/vanilla', label: 'Vanilla' }),
            App.createTag({ id: 'tag/incest', label: 'Incest' })
        ]

        return [
            App.createTagSection({ id: 'categories', label: 'Categories', tags: categories }),
            App.createTagSection({ id: 'languages', label: 'Languages', tags: languages }),
            App.createTagSection({ id: 'female', label: 'Female Tags', tags: femaleTags }),
            App.createTagSection({ id: 'male', label: 'Male Tags', tags: maleTags }),
            App.createTagSection({ id: 'general', label: 'General Tags', tags: generalTags })
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
