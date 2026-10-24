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
    version: '1.2.1',
    name: 'Hitomi',
    icon: 'icon.png',
    author: 'Phat-Hy',
    authorWebsite: 'https://github.com/Phat-Hy',
    description: 'High performance extension for hitomi.la with TagIndex search and instant multi-section homepage',
    contentRating: ContentRating.ADULT,
    websiteBaseURL: HITOMI_DOMAIN,
    sourceTags: [
        {
            text: '18+',
            type: BadgeColor.RED
        }
    ],
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS
}

interface TagIndexSuggestion {
    name: string;
    count: number;
    namespace: string;
}

function encodeSearchQueryForUrl(s: string): string {
    return s.replace(/[ \/\.]/g, m => {
        if (m === ' ') return '_'
        if (m === '/') return 'slash'
        if (m === '.') return 'dot'
        return m
    })
}

export class Hitomi implements SearchResultsProviding, MangaProviding, ChapterProviding, HomePageSectionsProviding {
    requestManager = App.createRequestManager({
        requestsPerSecond: 15,
        requestTimeout: 15000,
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
        const cleanPath = path.replace(/^\/+/, '')
        const request = App.createRequest({
            url: `${LTN_DOMAIN}/${cleanPath}`,
            method: 'GET'
        })
        const response = await this.requestManager.schedule(request, 1)

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

    private async fetchTagIndexSuggestions(term: string, field = 'global'): Promise<TagIndexSuggestion[]> {
        const clean = term.toLowerCase().trim()
        if (!clean) return []

        const chars = clean.split('').map(encodeSearchQueryForUrl)
        const url = `https://tagindex.hitomi.la/${field}/${chars.join('/')}.json`

        try {
            const request = App.createRequest({
                url,
                method: 'GET'
            })
            const response = await this.requestManager.schedule(request, 1)
            if (response.status !== 200 || !response.data) return []

            const raw = typeof response.data === 'string' ? JSON.parse(response.data) : response.data
            if (!Array.isArray(raw)) return []

            return raw.map((item: any) => ({
                name: String(item[0]),
                count: Number(item[1]),
                namespace: String(item[2])
            }))
        } catch {
            return []
        }
    }

    private suggestionToAtomPath(s: TagIndexSuggestion): string {
        const encoded = encodeURIComponent(s.name.replace(/[\/#]/g, ''))
        if (s.namespace === 'female' || s.namespace === 'male') {
            return `tag/${s.namespace}:${encoded}-all.atom`
        }
        if (s.namespace === 'language') {
            return `index-${encoded}.atom`
        }
        if (s.namespace === 'tag') {
            return `tag/${encoded}-all.atom`
        }
        return `${s.namespace}/${encoded}-all.atom`
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

        const sectionDefs = [
            {
                id: 'recently_added',
                title: 'Recently Added',
                feedPath: 'index-all.atom',
                limit: 10
            },
            {
                id: 'english',
                title: 'English Releases',
                feedPath: 'index-english.atom',
                limit: 8
            },
            {
                id: 'manga',
                title: 'Popular Manga',
                feedPath: 'type/manga-all.atom',
                limit: 8
            },
            {
                id: 'doujinshi',
                title: 'Doujinshi',
                feedPath: 'type/doujinshi-all.atom',
                limit: 8
            },
            {
                id: 'japanese',
                title: 'Japanese Releases',
                feedPath: 'index-japanese.atom',
                limit: 8
            }
        ]

        for (const def of sectionDefs) {
            const section = App.createHomeSection({
                id: def.id,
                title: def.title,
                type: HomeSectionType.singleRowNormal,
                containsMoreItems: true
            })

            try {
                const items = await this.fetchAtomSection(def.feedPath, def.limit)
                section.items = items
                sectionCallback(section)
            } catch {
                section.items = []
                sectionCallback(section)
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

        // 3. User typed search query (e.g. title, character, series, or artist)
        if (title) {
            const clean = title.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim()

            // 3a. Explicit namespace prefix: artist:xxx, female:xxx, series:xxx, etc.
            if (clean.includes(':')) {
                const [prefix, ...rest] = clean.split(':')
                const val = rest.join(':').trim()
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

            // 3b. Hitomi Official TagIndex Suggestion Search
            try {
                let suggestions = await this.fetchTagIndexSuggestions(clean, 'global')

                // If multi-word search didn't yield exact phrase, try significant keyword
                if (suggestions.length === 0 && clean.includes(' ')) {
                    const words = clean.split(' ').filter(w => w.length > 2 && !['english', 'japanese', 'chinese'].includes(w))
                    for (const word of words) {
                        suggestions = await this.fetchTagIndexSuggestions(word, 'global')
                        if (suggestions.length > 0) break
                    }
                }

                if (suggestions.length > 0) {
                    const topSuggestions = suggestions.slice(0, 2)
                    for (const sug of topSuggestions) {
                        const path = this.suggestionToAtomPath(sug)
                        try {
                            const items = await this.fetchAtomSection(path, 25)
                            if (items.length > 0) {
                                return App.createPagedResults({ results: items })
                            }
                        } catch {}
                    }
                }
            } catch {
                // If TagIndex request fails, continue to candidate fallback probe
            }

            // 3c. Direct candidate probe across common Hitomi feeds
            const enc = encodeURIComponent(clean)
            const candidates = [
                `series/${enc}-all.atom`,
                `artist/${enc}-all.atom`,
                `character/${enc}-all.atom`,
                `tag/female:${enc}-all.atom`,
                `tag/${enc}-all.atom`,
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

            // No matches found for this query - return empty results
            return App.createPagedResults({
                results: []
            })
        }

        // 4. Empty search query (user pressed enter with no text): show recent
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
}
