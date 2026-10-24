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
import { searchGalleryTitlesHitomi } from './HitomiTitleSearch'

const HITOMI_DOMAIN = 'https://hitomi.la'
const LTN_DOMAIN = 'https://ltn.gold-usergeneratedcontent.net'

export const HitomiInfo: SourceInfo = {
    version: '1.2.6',
    name: 'Hitomi',
    icon: 'icon.png',
    author: 'Phat-Hy',
    authorWebsite: 'https://github.com/Phat-Hy',
    description: 'High performance extension for hitomi.la with B-Tree title search, TagIndex suggestions, and multi-section homepage',
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
        requestsPerSecond: 25,
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

        // 2. User typed search query (title, character, series, artist, or tag)
        // Must take precedence over includedTags so user searches are never hijacked by active filters
        if (title) {
            const clean = title.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim()

            // 2a. Explicit namespace prefix: artist:xxx, female:xxx, series:xxx, etc.
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

            // 2b. Direct Title B-Tree Index Search (Matches exact doujinshi and manga titles like "Mother and No Other!!")
            try {
                const titleIds = await searchGalleryTitlesHitomi(title, this.requestManager)
                if (titleIds.length > 0) {
                    const topIds = titleIds.slice(0, 30)
                    const items = await Promise.all(
                        topIds.map(id => this.buildPartialSourceManga(id))
                    )
                    const valid = items.filter((item): item is PartialSourceManga => item !== null)
                    if (valid.length > 0) {
                        // Rank results so exact phrase and word matches in title appear first
                        const queryWords = clean.split(/\s+/).filter(w => w.length > 1)
                        valid.sort((a, b) => {
                            const aTitle = a.title.toLowerCase()
                            const bTitle = b.title.toLowerCase()
                            const aExact = aTitle.includes(clean) ? 100 : 0
                            const bExact = bTitle.includes(clean) ? 100 : 0
                            const aMatches = aExact + queryWords.filter(w => aTitle.includes(w)).length
                            const bMatches = bExact + queryWords.filter(w => bTitle.includes(w)).length
                            return bMatches - aMatches
                        })
                        return App.createPagedResults({ results: valid })
                    }
                }
            } catch {
                // Continue to tag suggestion fallback
            }

            // 2c. Fallback TagIndex Suggestion Search (Used when title search yielded no results)
            try {
                const suggestions = await this.fetchTagIndexSuggestions(clean, "global")

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
                // Continue to candidate fallback probe
            }
            // 2d. Direct candidate probe across common Hitomi feeds
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

        // 3. Filter Tag search (when user browses by tag without typing a search query)
        if (query.includedTags && query.includedTags.length > 0) {
            const tag = query.includedTags[0]
            if (tag && tag.id) {
                const path = `${tag.id}-all.atom`
                const items = await this.fetchAtomSection(path, 25)
                return App.createPagedResults({ results: items })
            }
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
            App.createTag({ id: 'type/anime', label: 'Anime' }),
            App.createTag({ id: 'type/webtoon', label: 'Webtoon' }),
            App.createTag({ id: 'type/anthology', label: 'Anthology' })
        ]

        const languages: Tag[] = [
            App.createTag({ id: 'index-english', label: 'English' }),
            App.createTag({ id: 'index-japanese', label: 'Japanese' }),
            App.createTag({ id: 'index-chinese', label: 'Chinese' }),
            App.createTag({ id: 'index-korean', label: 'Korean' }),
            App.createTag({ id: 'index-spanish', label: 'Spanish' }),
            App.createTag({ id: 'index-french', label: 'French' }),
            App.createTag({ id: 'index-russian', label: 'Russian' }),
            App.createTag({ id: 'index-german', label: 'German' }),
            App.createTag({ id: 'index-portuguese', label: 'Portuguese' }),
            App.createTag({ id: 'index-italian', label: 'Italian' }),
            App.createTag({ id: 'index-indonesian', label: 'Indonesian' }),
            App.createTag({ id: 'index-vietnamese', label: 'Vietnamese' }),
            App.createTag({ id: 'index-thai', label: 'Thai' })
        ]

        const femaleTags: Tag[] = [
            App.createTag({ id: 'tag/female:sole%20female', label: 'Sole Female ♀' }),
            App.createTag({ id: 'tag/female:schoolgirl%20uniform', label: 'Schoolgirl Uniform ♀' }),
            App.createTag({ id: 'tag/female:big%20breasts', label: 'Big Breasts ♀' }),
            App.createTag({ id: 'tag/female:stockings', label: 'Stockings ♀' }),
            App.createTag({ id: 'tag/female:maid', label: 'Maid ♀' }),
            App.createTag({ id: 'tag/female:swimsuit', label: 'Swimsuit ♀' }),
            App.createTag({ id: 'tag/female:nakadashi', label: 'Nakadashi ♀' }),
            App.createTag({ id: 'tag/female:ahegao', label: 'Ahegao ♀' }),
            App.createTag({ id: 'tag/female:milf', label: 'Milf ♀' }),
            App.createTag({ id: 'tag/female:gyaru', label: 'Gyaru ♀' }),
            App.createTag({ id: 'tag/female:blowjob', label: 'Blowjob ♀' }),
            App.createTag({ id: 'tag/female:paizuri', label: 'Paizuri ♀' }),
            App.createTag({ id: 'tag/female:netorare', label: 'Netorare (NTR) ♀' }),
            App.createTag({ id: 'tag/female:cheating', label: 'Cheating ♀' }),
            App.createTag({ id: 'tag/female:yuri', label: 'Yuri ♀' }),
            App.createTag({ id: 'tag/female:defloration', label: 'Defloration ♀' }),
            App.createTag({ id: 'tag/female:dark%20skin', label: 'Dark Skin ♀' }),
            App.createTag({ id: 'tag/female:bunnygirl', label: 'Bunnygirl ♀' }),
            App.createTag({ id: 'tag/female:monster%20girl', label: 'Monster Girl ♀' }),
            App.createTag({ id: 'tag/female:femdom', label: 'Femdom ♀' }),
            App.createTag({ id: 'tag/female:mind%20break', label: 'Mind Break ♀' }),
            App.createTag({ id: 'tag/female:elf', label: 'Elf ♀' }),
            App.createTag({ id: 'tag/female:catgirl', label: 'Catgirl ♀' }),
            App.createTag({ id: 'tag/female:nurse', label: 'Nurse ♀' }),
            App.createTag({ id: 'tag/female:incest', label: 'Incest ♀' }),
            App.createTag({ id: 'tag/female:tsundere', label: 'Tsundere ♀' }),
            App.createTag({ id: 'tag/female:lingerie', label: 'Lingerie ♀' }),
            App.createTag({ id: 'tag/female:tomboy', label: 'Tomboy ♀' }),
            App.createTag({ id: 'tag/female:squirting', label: 'Squirting ♀' }),
            App.createTag({ id: 'tag/female:glasses', label: 'Glasses ♀' }),
            App.createTag({ id: 'tag/female:bondage', label: 'Bondage ♀' }),
            App.createTag({ id: 'tag/female:twintails', label: 'Twintails ♀' }),
            App.createTag({ id: 'tag/female:collar', label: 'Collar ♀' }),
            App.createTag({ id: 'tag/female:exhibitionism', label: 'Exhibitionism ♀' }),
            App.createTag({ id: 'tag/female:impregnation', label: 'Impregnation ♀' }),
            App.createTag({ id: 'tag/female:bitch', label: 'Bitch ♀' }),
            App.createTag({ id: 'tag/female:tanlines', label: 'Tanlines ♀' }),
            App.createTag({ id: 'tag/female:prostitution', label: 'Prostitution ♀' }),
            App.createTag({ id: 'tag/female:miko', label: 'Miko ♀' }),
            App.createTag({ id: 'tag/female:kunoichi', label: 'Kunoichi ♀' }),
            App.createTag({ id: 'tag/female:sweating', label: 'Sweating ♀' }),
            App.createTag({ id: 'tag/female:chikan', label: 'Chikan ♀' }),
            App.createTag({ id: 'tag/female:masturbation', label: 'Masturbation ♀' }),
            App.createTag({ id: 'tag/female:x-ray', label: 'X-Ray ♀' }),
            App.createTag({ id: 'tag/female:cervix%20penetration', label: 'Cervix Penetration ♀' }),
            App.createTag({ id: 'tag/female:anal', label: 'Anal ♀' }),
            App.createTag({ id: 'tag/female:small%20breasts', label: 'Small Breasts ♀' }),
            App.createTag({ id: 'tag/female:huge%20breasts', label: 'Huge Breasts ♀' })
        ]

        const maleTags: Tag[] = [
            App.createTag({ id: 'tag/male:sole%20male', label: 'Sole Male ♂' }),
            App.createTag({ id: 'tag/male:shota', label: 'Shota ♂' }),
            App.createTag({ id: 'tag/male:glasses', label: 'Glasses ♂' }),
            App.createTag({ id: 'tag/male:dilf', label: 'Dilf ♂' }),
            App.createTag({ id: 'tag/male:crossdressing', label: 'Crossdressing ♂' }),
            App.createTag({ id: 'tag/male:tomgirl', label: 'Tomgirl ♂' }),
            App.createTag({ id: 'tag/male:yaoi', label: 'Yaoi ♂' }),
            App.createTag({ id: 'tag/male:muscle', label: 'Muscle ♂' }),
            App.createTag({ id: 'tag/male:mind%20break', label: 'Mind Break ♂' }),
            App.createTag({ id: 'tag/male:bbm', label: 'BBM ♂' }),
            App.createTag({ id: 'tag/male:cheating', label: 'Cheating ♂' }),
            App.createTag({ id: 'tag/male:monster', label: 'Monster ♂' }),
            App.createTag({ id: 'tag/male:tentacles', label: 'Tentacles ♂' }),
            App.createTag({ id: 'tag/male:dark%20skin', label: 'Dark Skin ♂' }),
            App.createTag({ id: 'tag/male:teacher', label: 'Teacher ♂' }),
            App.createTag({ id: 'tag/male:swimsuit', label: 'Swimsuit ♂' }),
            App.createTag({ id: 'tag/male:blindfold', label: 'Blindfold ♂' }),
            App.createTag({ id: 'tag/male:schoolboy%20uniform', label: 'Schoolboy Uniform ♂' }),
            App.createTag({ id: 'tag/male:old%20man', label: 'Old Man ♂' }),
            App.createTag({ id: 'tag/male:chubby', label: 'Chubby ♂' })
        ]

        const generalTags: Tag[] = [
            App.createTag({ id: 'tag/full%20color', label: 'Full Color' }),
            App.createTag({ id: 'tag/group', label: 'Group' }),
            App.createTag({ id: 'tag/vanilla', label: 'Vanilla' }),
            App.createTag({ id: 'tag/incest', label: 'Incest' }),
            App.createTag({ id: 'tag/harem', label: 'Harem' }),
            App.createTag({ id: 'tag/cosplay', label: 'Cosplay' }),
            App.createTag({ id: 'tag/kemonomimi', label: 'Kemonomimi' }),
            App.createTag({ id: 'tag/supernatural', label: 'Supernatural' }),
            App.createTag({ id: 'tag/fantasy', label: 'Fantasy' }),
            App.createTag({ id: 'tag/sci-fi', label: 'Sci-Fi' }),
            App.createTag({ id: 'tag/horror', label: 'Horror' }),
            App.createTag({ id: 'tag/romance', label: 'Romance' }),
            App.createTag({ id: 'tag/comedy', label: 'Comedy' }),
            App.createTag({ id: 'tag/gender%20bender', label: 'Gender Bender' }),
            App.createTag({ id: 'tag/slice%20of%20life', label: 'Slice of Life' }),
            App.createTag({ id: 'tag/uncensored', label: 'Uncensored' })
        ]

        return [
            App.createTagSection({ id: 'categories', label: 'Categories', tags: categories }),
            App.createTagSection({ id: 'languages', label: 'Languages', tags: languages }),
            App.createTagSection({ id: 'female', label: 'Female Tags (50+)', tags: femaleTags }),
            App.createTagSection({ id: 'male', label: 'Male Tags', tags: maleTags }),
            App.createTagSection({ id: 'general', label: 'Themes & Genres', tags: generalTags })
        ]
    }
}
