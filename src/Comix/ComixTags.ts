/* SPDX-License-Identifier: GPL-3.0-or-later */

import { TagSection } from '@paperback/types'

export const COMIX_TYPES: { id: string; label: string }[] = [
    { id: 'type_manga', label: 'Manga (Japanese)' },
    { id: 'type_manhwa', label: 'Manhwa (Korean Webtoon)' },
    { id: 'type_manhua', label: 'Manhua (Chinese)' }
]

export const COMIX_DEMOGRAPHICS: { id: string; label: string; numId: number }[] = [
    { id: 'demo_2', label: 'Shounen', numId: 2 },
    { id: 'demo_1', label: 'Shoujo', numId: 1 },
    { id: 'demo_4', label: 'Seinen', numId: 4 },
    { id: 'demo_3', label: 'Josei', numId: 3 }
]

export const COMIX_STATUSES: { id: string; label: string; value: string }[] = [
    { id: 'status_releasing', label: 'Releasing / Ongoing', value: 'releasing' },
    { id: 'status_finished', label: 'Finished / Completed', value: 'finished' },
    { id: 'status_on_hiatus', label: 'On Hiatus', value: 'on_hiatus' },
    { id: 'status_discontinued', label: 'Discontinued / Cancelled', value: 'discontinued' }
]

export const COMIX_FORMATS: { id: string; label: string; numId: number }[] = [
    { id: 'format_93164', label: '4-Koma', numId: 93164 },
    { id: 'format_93167', label: 'Adaptation', numId: 93167 },
    { id: 'format_93165', label: 'Anthology', numId: 93165 },
    { id: 'format_93166', label: 'Award Winning', numId: 93166 },
    { id: 'format_93168', label: 'Doujinshi', numId: 93168 },
    { id: 'format_93172', label: 'Full Color', numId: 93172 },
    { id: 'format_93170', label: 'Long Strip', numId: 93170 },
    { id: 'format_93169', label: 'Oneshot', numId: 93169 },
    { id: 'format_93171', label: 'Web Comic', numId: 93171 }
]

// Sanitized genres (filtered per library visibility rule)
export const COMIX_GENRES: { id: string; label: string; numId: number }[] = [
    { id: 'genre_6', label: 'Action', numId: 6 },
    { id: 'genre_7', label: 'Adventure', numId: 7 },
    { id: 'genre_8', label: 'Boys Love', numId: 8 },
    { id: 'genre_9', label: 'Comedy', numId: 9 },
    { id: 'genre_10', label: 'Crime', numId: 10 },
    { id: 'genre_11', label: 'Drama', numId: 11 },
    { id: 'genre_12', label: 'Fantasy', numId: 12 },
    { id: 'genre_13', label: 'Girls Love', numId: 13 },
    { id: 'genre_40', label: 'Harem', numId: 40 },
    { id: 'genre_14', label: 'Historical', numId: 14 },
    { id: 'genre_15', label: 'Horror', numId: 15 },
    { id: 'genre_16', label: 'Isekai', numId: 16 },
    { id: 'genre_17', label: 'Magical Girls', numId: 17 },
    { id: 'genre_18', label: 'Mecha', numId: 18 },
    { id: 'genre_19', label: 'Medical', numId: 19 },
    { id: 'genre_20', label: 'Mystery', numId: 20 },
    { id: 'genre_21', label: 'Philosophical', numId: 21 },
    { id: 'genre_22', label: 'Psychological', numId: 22 },
    { id: 'genre_23', label: 'Romance', numId: 23 },
    { id: 'genre_24', label: 'Sci-Fi', numId: 24 },
    { id: 'genre_25', label: 'Slice of Life', numId: 25 },
    { id: 'genre_26', label: 'Sports', numId: 26 },
    { id: 'genre_27', label: 'Superhero', numId: 27 },
    { id: 'genre_28', label: 'Thriller', numId: 28 },
    { id: 'genre_29', label: 'Tragedy', numId: 29 },
    { id: 'genre_30', label: 'Wuxia', numId: 30 }
]

export const COMIX_SORTS: { id: string; label: string; orderKey: string }[] = [
    { id: 'sort_chapter_updated_at', label: 'Latest Updates', orderKey: 'chapter_updated_at' },
    { id: 'sort_views_7d', label: 'Most Viewed (7 Days)', orderKey: 'views_7d' },
    { id: 'sort_views_total', label: 'Most Viewed (All Time)', orderKey: 'views_total' },
    { id: 'sort_follows_total', label: 'Most Followed', orderKey: 'follows_total' },
    { id: 'sort_score', label: 'Highest Rated', orderKey: 'score' },
    { id: 'sort_created_at', label: 'Recently Added', orderKey: 'created_at' }
]

export function getComixSearchTags(): TagSection[] {
    return [
        App.createTagSection({
            id: 'sorts',
            label: 'Sort By',
            tags: COMIX_SORTS.map(s => App.createTag({ id: s.id, label: s.label }))
        }),
        App.createTagSection({
            id: 'types',
            label: 'Format / Type',
            tags: COMIX_TYPES.map(t => App.createTag({ id: t.id, label: t.label }))
        }),
        App.createTagSection({
            id: 'formats',
            label: 'Publication Style',
            tags: COMIX_FORMATS.map(f => App.createTag({ id: f.id, label: f.label }))
        }),
        App.createTagSection({
            id: 'demographics',
            label: 'Demographics',
            tags: COMIX_DEMOGRAPHICS.map(d => App.createTag({ id: d.id, label: d.label }))
        }),
        App.createTagSection({
            id: 'statuses',
            label: 'Status',
            tags: COMIX_STATUSES.map(s => App.createTag({ id: s.id, label: s.label }))
        }),
        App.createTagSection({
            id: 'genres',
            label: 'Genres',
            tags: COMIX_GENRES.map(g => App.createTag({ id: g.id, label: g.label }))
        })
    ]
}
