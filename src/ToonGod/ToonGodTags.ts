/* SPDX-License-Identifier: GPL-3.0-or-later */

import { Tag, TagSection } from '@paperback/types'

export const TOONGOD_GENRES: { id: string; label: string }[] = [
    { id: 'action', label: 'Action' },
    { id: 'adventure', label: 'Adventure' },
    { id: 'comedy', label: 'Comedy' },
    { id: 'drama', label: 'Drama' },
    { id: 'fantasy', label: 'Fantasy' },
    { id: 'historical', label: 'Historical' },
    { id: 'horror', label: 'Horror' },
    { id: 'mystery', label: 'Mystery' },
    { id: 'psychological', label: 'Psychological' },
    { id: 'romance', label: 'Romance' },
    { id: 'school-life', label: 'School Life' },
    { id: 'sci-fi', label: 'Sci-Fi' },
    { id: 'slice-of-life', label: 'Slice of Life' },
    { id: 'sports', label: 'Sports' },
    { id: 'supernatural', label: 'Supernatural' },
    { id: 'thriller', label: 'Thriller' },
    { id: 'mature', label: 'Mature' },
    { id: 'smut', label: 'Smut' },
    { id: 'ecchi', label: 'Ecchi' },
    { id: 'harem', label: 'Harem' },
    { id: 'webtoon', label: 'Webtoon' },
    { id: 'manhwa', label: 'Manhwa' },
    { id: 'manga', label: 'Manga' },
    { id: 'manhua', label: 'Manhua' },
    { id: 'shounen', label: 'Shounen' },
    { id: 'shoujo', label: 'Shoujo' },
    { id: 'seinen', label: 'Seinen' },
    { id: 'josei', label: 'Josei' },
    { id: 'isekai', label: 'Isekai' },
    { id: 'reincarnation', label: 'Reincarnation' },
    { id: 'martial-arts', label: 'Martial Arts' },
    { id: 'magic', label: 'Magic' },
    { id: 'super-power', label: 'Super Power' },
    { id: 'time-travel', label: 'Time Travel' },
    { id: 'uncensored', label: 'Uncensored' }
]

export function getToonGodTagSections(): TagSection[] {
    return [
        App.createTagSection({
            id: 'genres',
            label: 'Genres & Categories',
            tags: TOONGOD_GENRES.map(g => App.createTag(g))
        })
    ]
}

export interface ParsedToonGodSearch {
    genreSlug?: string
    searchKeywords: string
}

export function parseToonGodSearchPrefix(rawTitle: string): ParsedToonGodSearch {
    const trimmed = rawTitle.trim()
    if (!trimmed) return { searchKeywords: '' }

    const prefixRegex = /^(genre|tag|category):([\w\-\s]+)(.*)$/i
    const match = trimmed.match(prefixRegex)

    if (match) {
        const value = match[2].trim().toLowerCase()
        const leftover = (match[3] || '').trim()
        const slug = value.replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '')

        const found = TOONGOD_GENRES.find(g => g.label.toLowerCase() === value || g.id === slug)
        return {
            genreSlug: found ? found.id : slug,
            searchKeywords: leftover
        }
    }

    return {
        searchKeywords: trimmed
    }
}
