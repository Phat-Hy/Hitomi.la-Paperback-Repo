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
    version: '1.0.1',
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
            // fallback defaults in ImageUriResolver will be used
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
                id: 'japanese',
                title: 'Japanese',
                type: HomeSectionType.singleRowNormal,
                containsMoreItems: true
            }),
            App.createHomeSection({
                id: 'english',
                title: 'English',
                type: HomeSectionType.singleRowNormal,
                containsMoreItems: true
            }),
            App.createHomeSection({
                id: 'manga',
                title: 'Manga',
                type: HomeSectionType.singleRowNormal,
                containsMoreItems: true
            })
        ]

        // Load and emit Recently Added
        try {
            sections[0]!.items = await this.fetchAtomSection('index-all.atom', 16)
            sectionCallback(sections[0]!)
        } catch {
            sectionCallback(sections[0]!)
        }

        // Load and emit Japanese
        try {
            sections[1]!.items = await this.fetchAtomSection('index-japanese.atom', 16)
            sectionCallback(sections[1]!)
        } catch {
            sectionCallback(sections[1]!)
        }

        // Load and emit English
        try {
            sections[2]!.items = await this.fetchAtomSection('index-english.atom', 16)
            sectionCallback(sections[2]!)
        } catch {
            sectionCallback(sections[2]!)
        }

        // Load and emit Manga
        try {
            sections[3]!.items = await this.fetchAtomSection('type/manga-all.atom', 16)
            sectionCallback(sections[3]!)
        } catch {
            sectionCallback(sections[3]!)
        }
    }

    async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        await this.ensureGG()
        let path = 'index-all.atom'

        switch (homepageSectionId) {
            case 'recently_added':
                path = 'index-all.atom'
                break
            case 'japanese':
                path = 'index-japanese.atom'
                break
            case 'english':
                path = 'index-english.atom'
                break
            case 'manga':
                path = 'type/manga-all.atom'
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

        if (title && /^\d+$/.test(title)) {
            // Direct gallery ID lookup
            const item = await this.buildPartialSourceManga(parseInt(title, 10))
            return App.createPagedResults({
                results: item ? [item] : []
            })
        }

        let path = 'index-all.atom'

        if (title) {
            // Tag, artist, or series search
            const cleanTitle = encodeURIComponent(title.toLowerCase().replace(/\s+/g, ' '))
            path = `tag/female:${cleanTitle}-all.atom`
        } else if (query.includedTags && query.includedTags.length > 0) {
            const tag = query.includedTags[0]
            if (tag && tag.id) {
                path = `${tag.id}-all.atom`
            }
        }

        try {
            const items = await this.fetchAtomSection(path, 25)
            if (items.length > 0) {
                return App.createPagedResults({ results: items })
            }
        } catch {
            // If specific tag feed fails, fallback to general tag search
            if (title) {
                try {
                    const cleanTitle = encodeURIComponent(title.toLowerCase().replace(/\s+/g, ' '))
                    const fallbackItems = await this.fetchAtomSection(`tag/${cleanTitle}-all.atom`, 25)
                    return App.createPagedResults({ results: fallbackItems })
                } catch {
                    // Empty if not found
                }
            }
        }

        return App.createPagedResults({
            results: []
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

        const popularTags: Tag[] = [
            App.createTag({ id: 'tag/female:yuri', label: 'Yuri ♀' }),
            App.createTag({ id: 'tag/female:schoolgirl_uniform', label: 'Schoolgirl Uniform ♀' }),
            App.createTag({ id: 'tag/female:big_breasts', label: 'Big Breasts ♀' }),
            App.createTag({ id: 'tag/female:sole_female', label: 'Sole Female ♀' }),
            App.createTag({ id: 'tag/male:sole_male', label: 'Sole Male ♂' })
        ]

        return [
            App.createTagSection({ id: 'categories', label: 'Categories', tags: categories }),
            App.createTagSection({ id: 'languages', label: 'Languages', tags: languages }),
            App.createTagSection({ id: 'tags', label: 'Popular Tags', tags: popularTags })
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
