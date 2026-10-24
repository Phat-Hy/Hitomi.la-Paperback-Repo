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
import { searchGalleryTitlesHitomi, responseToUint8Array } from './HitomiTitleSearch'

const HITOMI_DOMAIN = 'https://hitomi.la'
const LTN_DOMAIN = 'https://ltn.gold-usergeneratedcontent.net'

export const HitomiInfo: SourceInfo = {
    version: '1.2.10',
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

interface SearchFilterRule {
    namespace: 'language' | 'female' | 'male' | 'tag' | 'artist' | 'series' | 'character' | 'group' | 'type';
    value: string;
    negative: boolean;
}

function parseSearchQuery(rawQuery?: string, includedTags: Tag[] = []): { titleKeywords: string; rules: SearchFilterRule[] } {
    const rules: SearchFilterRule[] = []
    const remainingWords: string[] = []

    // 1. Process includedTags from Paperback UI filter menu
    for (const tag of includedTags) {
        if (!tag || !tag.id) continue
        const id = tag.id
        if (id.startsWith('index-')) {
            const lang = id.replace(/^index-/, '')
            rules.push({ namespace: 'language', value: lang.toLowerCase(), negative: false })
        } else if (id.startsWith('type/')) {
            const type = id.replace(/^type\//, '')
            rules.push({ namespace: 'type', value: type.toLowerCase(), negative: false })
        } else if (id.startsWith('tag/female:')) {
            const val = decodeURIComponent(id.replace(/^tag\/female:/, '')).replace(/_/g, ' ').toLowerCase()
            rules.push({ namespace: 'female', value: val, negative: false })
        } else if (id.startsWith('tag/male:')) {
            const val = decodeURIComponent(id.replace(/^tag\/male:/, '')).replace(/_/g, ' ').toLowerCase()
            rules.push({ namespace: 'male', value: val, negative: false })
        } else if (id.startsWith('tag/')) {
            const val = decodeURIComponent(id.replace(/^tag\//, '')).replace(/_/g, ' ').toLowerCase()
            rules.push({ namespace: 'tag', value: val, negative: false })
        }
    }

    if (!rawQuery) {
        return { titleKeywords: '', rules }
    }

    // 2. Parse typed search text for namespace:value, -namespace:value, and title words
    const regex = /(-?[a-zA-Z]+:(?:"[^"]+"|\S+))|("[^"]+")|(\S+)/g
    let match: RegExpExecArray | null

    const validNamespaces = new Map<string, SearchFilterRule['namespace']>([
        ['language', 'language'],
        ['lang', 'language'],
        ['female', 'female'],
        ['male', 'male'],
        ['tag', 'tag'],
        ['artist', 'artist'],
        ['series', 'series'],
        ['parody', 'series'],
        ['character', 'character'],
        ['char', 'character'],
        ['group', 'group'],
        ['circle', 'group'],
        ['type', 'type']
    ])

    while ((match = regex.exec(rawQuery)) !== null) {
        const token = match[0]
        if (token.includes(':')) {
            let negative = false
            let cleanToken = token
            if (cleanToken.startsWith('-')) {
                negative = true
                cleanToken = cleanToken.slice(1)
            }
            const colonIdx = cleanToken.indexOf(':')
            const ns = cleanToken.slice(0, colonIdx).toLowerCase()
            const val = cleanToken.slice(colonIdx + 1).replace(/^"|"$/g, '').trim().toLowerCase()

            if (validNamespaces.has(ns)) {
                rules.push({
                    namespace: validNamespaces.get(ns)!,
                    value: val.replace(/_/g, ' '),
                    negative
                })
                continue
            }
        }

        const cleanWord = token.replace(/^"|"$/g, '').trim()
        if (cleanWord) {
            remainingWords.push(cleanWord)
        }
    }

    return {
        titleKeywords: remainingWords.join(' '),
        rules
    }
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
                    Referer: `${HITOMI_DOMAIN}/`
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

    private matchesGalleryFilters(gallery: HitomiGallery, rules: SearchFilterRule[]): boolean {
        if (!rules || rules.length === 0) return true

        for (const rule of rules) {
            let match = false
            const val = rule.value.toLowerCase().replace(/_/g, ' ')

            if (rule.namespace === 'language') {
                const lang = (gallery.languageName.english || gallery.languageName.local || '').toLowerCase()
                match = lang === val || lang.includes(val)
            } else if (rule.namespace === 'type') {
                match = (gallery.type || '').toLowerCase() === val
            } else if (rule.namespace === 'female') {
                match = gallery.tags.some(t => t.type === 'female' && t.name.toLowerCase() === val)
            } else if (rule.namespace === 'male') {
                match = gallery.tags.some(t => t.type === 'male' && t.name.toLowerCase() === val)
            } else if (rule.namespace === 'tag') {
                match = gallery.tags.some(t => t.name.toLowerCase() === val)
            } else if (rule.namespace === 'artist') {
                match = gallery.artists.some(a => a.toLowerCase().includes(val))
            } else if (rule.namespace === 'series') {
                match = gallery.series.some(s => s.toLowerCase().includes(val))
            } else if (rule.namespace === 'character') {
                match = gallery.characters.some(c => c.toLowerCase().includes(val))
            } else if (rule.namespace === 'group') {
                match = gallery.groups.some(g => g.toLowerCase().includes(val))
            }

            if (rule.negative) {
                if (match) return false
            } else {
                if (!match) return false
            }
        }
        return true
    }

    private async buildFilteredPartialManga(id: number, rules: SearchFilterRule[]): Promise<PartialSourceManga | null> {
        try {
            const gallery = await this.fetchGallery(String(id))
            if (rules.length > 0 && !this.matchesGalleryFilters(gallery, rules)) {
                return null
            }

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

    private async fetchNozomiIds(nozomiPath: string, page: number, limit = 25): Promise<number[]> {
        const start = (page - 1) * limit * 4
        const end = page * limit * 4 - 1
        const cleanPath = nozomiPath.replace(/^\/+/, '')

        try {
            const req = App.createRequest({
                url: `${LTN_DOMAIN}/${cleanPath}?r=${start}-${end}`,
                method: 'GET',
                headers: {
                    Range: `bytes=${start}-${end}`,
                    Referer: `${HITOMI_DOMAIN}/`
                }
            })
            const res = await this.requestManager.schedule(req, 1)
            const bytes = responseToUint8Array(res)
            if (!bytes || bytes.length < 4) return []

            const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
            const ids: number[] = []
            for (let i = 0; i + 4 <= dv.byteLength; i += 4) {
                ids.push(dv.getInt32(i, false))
            }
            return ids
        } catch {
            return []
        }
    }

    private ruleToFeedPath(rule: SearchFilterRule): string {
        const enc = encodeURIComponent(rule.value)
        if (rule.namespace === 'female' || rule.namespace === 'male') {
            return `tag/${rule.namespace}:${enc}-all`
        }
        if (rule.namespace === 'language') {
            return `index-${enc}`
        }
        if (rule.namespace === 'type') {
            return `type/${enc}-all`
        }
        if (rule.namespace === 'tag') {
            return `tag/${enc}-all`
        }
        return `${rule.namespace}/${enc}-all`
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

    private async fetchNozomiSection(nozomiPath: string, page: number, limit = 25): Promise<PartialSourceManga[]> {
        const start = (page - 1) * limit * 4
        const end = page * limit * 4 - 1
        const cleanPath = nozomiPath.replace(/^\/+/, '')

        try {
            const req = App.createRequest({
                url: `${LTN_DOMAIN}/${cleanPath}?r=${start}-${end}`,
                method: 'GET',
                headers: {
                    Range: `bytes=${start}-${end}`,
                    Referer: `${HITOMI_DOMAIN}/`
                }
            })
            const res = await this.requestManager.schedule(req, 1)
            const bytes = responseToUint8Array(res)
            if (!bytes || bytes.length < 4) return []

            const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
            const ids: number[] = []
            for (let i = 0; i + 4 <= dv.byteLength; i += 4) {
                ids.push(dv.getInt32(i, false))
            }

            const items = await Promise.all(
                ids.map(id => this.buildPartialSourceManga(id))
            )
            return items.filter((item): item is PartialSourceManga => item !== null)
        } catch {
            return []
        }
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
        let nozomiPath = 'index-all.nozomi'

        switch (homepageSectionId) {
            case 'recently_added':
                nozomiPath = 'index-all.nozomi'
                break
            case 'english':
                nozomiPath = 'index-english.nozomi'
                break
            case 'japanese':
                nozomiPath = 'index-japanese.nozomi'
                break
            case 'doujinshi':
                nozomiPath = 'type/doujinshi-all.nozomi'
                break
            case 'manga':
                nozomiPath = 'type/manga-all.nozomi'
                break
            case 'artistcg':
                nozomiPath = 'type/artistcg-all.nozomi'
                break
            case 'gamecg':
                nozomiPath = 'type/gamecg-all.nozomi'
                break
            default:
                nozomiPath = 'index-all.nozomi'
                break
        }

        const page = typeof metadata?.page === 'number' ? metadata.page : 1
        const items = await this.fetchNozomiSection(nozomiPath, page, 25)
        const nextMetadata = items.length >= 25 ? { page: page + 1 } : undefined

        return App.createPagedResults({
            results: items,
            metadata: nextMetadata
        })
    }

    async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
        await this.ensureGG()

        // 0a. Paginated continuation of Nozomi results (feeds, tags, categories)
        if (metadata?.nozomiPath && typeof metadata.nozomiPath === 'string') {
            const page: number = typeof metadata.page === 'number' ? metadata.page : 2
            const rules: SearchFilterRule[] = metadata.rules || []
            const rawIds = await this.fetchNozomiIds(metadata.nozomiPath, page, 50)
            const filteredItems = await Promise.all(
                rawIds.map(id => this.buildFilteredPartialManga(id, rules))
            )
            const valid = filteredItems.filter((item): item is PartialSourceManga => item !== null)
            const nextMetadata = rawIds.length >= 50 ? { nozomiPath: metadata.nozomiPath, page: page + 1, rules } : undefined
            return App.createPagedResults({
                results: valid,
                metadata: nextMetadata
            })
        }

        // 0b. Paginated continuation of Title Search (allIds)
        if (metadata?.allIds && Array.isArray(metadata.allIds)) {
            const allIds: number[] = metadata.allIds
            const rules: SearchFilterRule[] = metadata.rules || []
            let offset: number = typeof metadata.offset === 'number' ? metadata.offset : 0
            const batchLimit = 25
            const matchedItems: PartialSourceManga[] = []

            while (offset < allIds.length && matchedItems.length < batchLimit) {
                const nextBatch = allIds.slice(offset, offset + batchLimit)
                offset += nextBatch.length

                const batchItems = await Promise.all(
                    nextBatch.map(id => this.buildFilteredPartialManga(id, rules))
                )
                for (const item of batchItems) {
                    if (item) matchedItems.push(item)
                }
            }

            const nextMetadata = offset < allIds.length ? { allIds, offset, rules } : undefined
            return App.createPagedResults({
                results: matchedItems,
                metadata: nextMetadata
            })
        }

        const { titleKeywords, rules } = parseSearchQuery(query.title, query.includedTags)

        // 1. Direct gallery ID lookup (if titleKeywords is digits only and no active rules)
        if (titleKeywords && /^\d+$/.test(titleKeywords) && rules.length === 0) {
            const item = await this.buildPartialSourceManga(parseInt(titleKeywords, 10))
            return App.createPagedResults({
                results: item ? [item] : []
            })
        }

        // 2. Title keywords present: e.g. "Mother and No Other!!" or "Mother and No Other!! language:english"
        if (titleKeywords) {
            try {
                const titleIds = await searchGalleryTitlesHitomi(titleKeywords, this.requestManager)
                if (titleIds.length > 0) {
                    const totalPool = titleIds.slice(0, 1000)
                    const batchLimit = 25
                    let offset = 0
                    const matchedItems: PartialSourceManga[] = []

                    while (offset < totalPool.length && matchedItems.length < batchLimit) {
                        const nextBatch = totalPool.slice(offset, offset + batchLimit)
                        offset += nextBatch.length

                        const batchItems = await Promise.all(
                            nextBatch.map(id => this.buildFilteredPartialManga(id, rules))
                        )
                        for (const item of batchItems) {
                            if (item) matchedItems.push(item)
                        }
                    }

                    if (matchedItems.length > 0) {
                        const cleanWords = titleKeywords.toLowerCase().split(/\s+/).filter(w => w.length > 1)
                        const cleanPhrase = titleKeywords.toLowerCase()
                        matchedItems.sort((a, b) => {
                            const aTitle = a.title.toLowerCase()
                            const bTitle = b.title.toLowerCase()
                            const aExact = aTitle.includes(cleanPhrase) ? 100 : 0
                            const bExact = bTitle.includes(cleanPhrase) ? 100 : 0
                            const aMatches = aExact + cleanWords.filter(w => aTitle.includes(w)).length
                            const bMatches = bExact + cleanWords.filter(w => bTitle.includes(w)).length
                            return bMatches - aMatches
                        })

                        const nextMetadata = offset < totalPool.length ? { allIds: totalPool, offset, rules } : undefined
                        return App.createPagedResults({
                            results: matchedItems,
                            metadata: nextMetadata
                        })
                    }
                }
            } catch {
                // Continue to tag suggestion fallback
            }
        }

        // 3. No title keywords, but namespace rules present (e.g. "language:english female:milf" or filter tag selections)
        if (rules.length > 0) {
            const primaryRule = rules.find(r => !r.negative && r.namespace !== 'language') || rules.find(r => !r.negative)
            if (primaryRule) {
                const basePath = this.ruleToFeedPath(primaryRule)
                const nozomiPath = `${basePath}.nozomi`
                const rawIds = await this.fetchNozomiIds(nozomiPath, 1, 50)
                if (rawIds.length > 0) {
                    const filteredItems = await Promise.all(
                        rawIds.map(id => this.buildFilteredPartialManga(id, rules))
                    )
                    const valid = filteredItems.filter((item): item is PartialSourceManga => item !== null)
                    const nextMetadata = rawIds.length >= 50 ? { nozomiPath, page: 2, rules } : undefined
                    return App.createPagedResults({
                        results: valid,
                        metadata: nextMetadata
                    })
                }

                // Fallback to atom if nozomi not found
                try {
                    const atomPath = `${basePath}.atom`
                    const items = await this.fetchAtomSection(atomPath, 25)
                    const filtered = await Promise.all(
                        items.map(async m => {
                            const g = await this.fetchGallery(m.mangaId)
                            return this.matchesGalleryFilters(g, rules) ? m : null
                        })
                    )
                    const valid = filtered.filter((item): item is PartialSourceManga => item !== null)
                    return App.createPagedResults({ results: valid })
                } catch {}
            }
        }

        // 4. Empty search (user pressed enter with no query and no tags): show recent
        const recent = await this.fetchAtomSection('index-all.atom', 25)
        const nextMetadata = recent.length >= 25 ? { nozomiPath: 'index-all.nozomi', page: 2 } : undefined
        return App.createPagedResults({
            results: recent,
            metadata: nextMetadata
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
