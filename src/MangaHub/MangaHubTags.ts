/* SPDX-License-Identifier: GPL-3.0-or-later */

import { TagSection } from '@paperback/types'

export const MANGAHUB_SORTS: { id: string; label: string; value: string }[] = [
    { id: 'sort_POPULAR', label: 'Popular', value: 'POPULAR' },
    { id: 'sort_LATEST', label: 'Latest Updates', value: 'LATEST' },
    { id: 'sort_NEW', label: 'Recently Added', value: 'NEW' },
    { id: 'sort_COMPLETED', label: 'Completed', value: 'COMPLETED' },
    { id: 'sort_ALPHABET', label: 'Alphabetical (A-Z)', value: 'ALPHABET' }
]

export const MANGAHUB_FORMATS: { id: string; label: string; slug: string }[] = [
    { id: 'format_manhwa', label: 'Manhwa (Korean)', slug: 'manhwa' },
    { id: 'format_manhua', label: 'Manhua (Chinese)', slug: 'manhua' },
    { id: 'format_webtoons', label: 'Webtoons', slug: 'webtoons' },
    { id: 'format_web-comic', label: 'Web Comic', slug: 'web-comic' },
    { id: 'format_long-strip', label: 'Long Strip', slug: 'long-strip' },
    { id: 'format_full-color', label: 'Full Color', slug: 'full-color' },
    { id: 'format_adaptation', label: 'Adaptation', slug: 'adaptation' }
]

// Sanitized genres (adult/mature terms stripped per library visibility rule)
export const MANGAHUB_GENRES: { id: string; label: string; slug: string }[] = [
    { id: 'genre_action', label: 'Action', slug: 'action' },
    { id: 'genre_adventure', label: 'Adventure', slug: 'adventure' },
    { id: 'genre_comedy', label: 'Comedy', slug: 'comedy' },
    { id: 'genre_crime', label: 'Crime', slug: 'crime' },
    { id: 'genre_delinquents', label: 'Delinquents', slug: 'delinquents' },
    { id: 'genre_demons', label: 'Demons', slug: 'demons' },
    { id: 'genre_drama', label: 'Drama', slug: 'drama' },
    { id: 'genre_fantasy', label: 'Fantasy', slug: 'fantasy' },
    { id: 'genre_ghosts', label: 'Ghosts', slug: 'ghosts' },
    { id: 'genre_historical', label: 'Historical', slug: 'historical' },
    { id: 'genre_horror', label: 'Horror', slug: 'horror' },
    { id: 'genre_isekai', label: 'Isekai', slug: 'isekai' },
    { id: 'genre_magic', label: 'Magic', slug: 'magic' },
    { id: 'genre_martial-arts', label: 'Martial Arts', slug: 'martial-arts' },
    { id: 'genre_military', label: 'Military', slug: 'military' },
    { id: 'genre_monster-girls', label: 'Monster Girls', slug: 'monster-girls' },
    { id: 'genre_monsters', label: 'Monsters', slug: 'monsters' },
    { id: 'genre_mystery', label: 'Mystery', slug: 'mystery' },
    { id: 'genre_post-apocalyptic', label: 'Post-apocalyptic', slug: 'post-apocalyptic' },
    { id: 'genre_psychological', label: 'Psychological', slug: 'psychological' },
    { id: 'genre_reincarnation', label: 'Reincarnation', slug: 'reincarnation' },
    { id: 'genre_romance', label: 'Romance', slug: 'romance' },
    { id: 'genre_school-life', label: 'School Life', slug: 'school-life' },
    { id: 'genre_sci-fi', label: 'Sci-Fi', slug: 'sci-fi' },
    { id: 'genre_seinen', label: 'Seinen', slug: 'seinen' },
    { id: 'genre_shounen', label: 'Shounen', slug: 'shounen' },
    { id: 'genre_slice-of-life', label: 'Slice of Life', slug: 'slice-of-life' },
    { id: 'genre_superhero', label: 'Superhero', slug: 'superhero' },
    { id: 'genre_supernatural', label: 'Supernatural', slug: 'supernatural' },
    { id: 'genre_survival', label: 'Survival', slug: 'survival' },
    { id: 'genre_thriller', label: 'Thriller', slug: 'thriller' },
    { id: 'genre_time-travel', label: 'Time Travel', slug: 'time-travel' },
    { id: 'genre_tragedy', label: 'Tragedy', slug: 'tragedy' },
    { id: 'genre_wuxia', label: 'Wuxia', slug: 'wuxia' },
    { id: 'genre_zombies', label: 'Zombies', slug: 'zombies' }
]

export function getMangaHubSearchTags(): TagSection[] {
    return [
        App.createTagSection({
            id: 'sorts',
            label: 'Sort By',
            tags: MANGAHUB_SORTS.map(s => App.createTag({ id: s.id, label: s.label }))
        }),
        App.createTagSection({
            id: 'formats',
            label: 'Format / Publication',
            tags: MANGAHUB_FORMATS.map(f => App.createTag({ id: f.id, label: f.label }))
        }),
        App.createTagSection({
            id: 'genres',
            label: 'Genres',
            tags: MANGAHUB_GENRES.map(g => App.createTag({ id: g.id, label: g.label }))
        })
    ]
}
