/* SPDX-License-Identifier: GPL-3.0-or-later */

export interface HitomiTag {
    type: 'tag' | 'male' | 'female' | 'artist' | 'group' | 'series' | 'character' | 'language' | 'type';
    name: string;
}

export interface HitomiFile {
    index: number;
    hash: string;
    name: string;
    hasAvif: boolean;
    hasWebp: boolean;
    width: number;
    height: number;
}

export interface HitomiGallery {
    id: number;
    title: {
        display: string;
        japanese: string | null;
    };
    type: string;
    languageName: {
        english: string | null;
        local: string | null;
    };
    artists: string[];
    groups: string[];
    series: string[];
    characters: string[];
    tags: HitomiTag[];
    files: HitomiFile[];
    publishedDate?: Date;
}
