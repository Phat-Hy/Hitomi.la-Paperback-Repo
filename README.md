# Paperback v0.8 Sources Repository

Official Paperback v0.8 source repository providing extensions for [Hitomi.la](https://hitomi.la), [Comix.to](https://comix.to), [MangaHub.io](https://mangahub.io), [AllPornComic.com](https://allporncomic.com), and [ToonGod.org](https://www.toongod.org).

[![Bundle and Publish Sources](https://github.com/Phat-Hy/Hitomi.la-Paperback-Repo/actions/workflows/main.yml/badge.svg)](https://github.com/Phat-Hy/Hitomi.la-Paperback-Repo/actions/workflows/main.yml)
[![Hitomi Version](https://img.shields.io/badge/Hitomi-v1.2.11-blue.svg)](https://github.com/Phat-Hy/Hitomi.la-Paperback-Repo)
[![Comix Version](https://img.shields.io/badge/Comix-v1.0.5-purple.svg)](https://github.com/Phat-Hy/Hitomi.la-Paperback-Repo)
[![MangaHub Version](https://img.shields.io/badge/MangaHub-v1.0.0-red.svg)](https://github.com/Phat-Hy/Hitomi.la-Paperback-Repo)
[![AllPornComic Version](https://img.shields.io/badge/AllPornComic-v1.0.14-pink.svg)](https://github.com/Phat-Hy/Hitomi.la-Paperback-Repo)
[![ToonGod Version](https://img.shields.io/badge/ToonGod-v1.1.5-yellow.svg)](https://github.com/Phat-Hy/Hitomi.la-Paperback-Repo)
[![Paperback](https://img.shields.io/badge/paperback-v0.8-orange.svg)](https://paperback.moe)

---

## 📥 How to Add to Paperback App (v0.8)

1. Open **Paperback** on your iOS device.
2. Go to **Settings** ⚙️ -> **External Sources** / **Repositories**.
3. Tap **Add Repository** (or **+**).
4. Paste either of the following repository URLs:
   ```text
   https://phat-hy.github.io/Hitomi.la-Paperback-Repo/
   ```
   or
   ```text
   https://phat-hy.github.io/Hitomi.la-Paperback-Repo/0.8/
   ```
5. Tap **Add** and install extensions from the catalog:
   - **Hitomi** (v1.2.11)
   - **Comix** (v1.0.5)
   - **MangaHub** (v1.0.0)
   - **AllPornComic** (v1.0.14)
   - **ToonGod** (v1.1.5)

---

## 📚 Available Sources

### 1. ⚡ Hitomi (`hitomi.la`)
High-performance extension for Hitomi manga, webtoons, and doujinshi:
- **Homepage Sections**:
  - 🌟 **Popular Today** (`popular-today.nozomi`)
  - 🔥 **Popular This Week** (`popular-week.nozomi`)
  - 🆕 **Recently Added** (`index-all.nozomi`)
- **Smart Composite Search**:
  - Two-phase B-Tree exact & fuzzy title search.
  - Direct gallery ID lookup (e.g. `1234567`).
  - Typed namespace filters (`language:english`, `artist:xxx`, `type:manga`, `tag:xxx`).
  - Negative exclusions (`-tag:horror`, `-type:doujinshi`).
- **Dynamic Image Engine**:
  - Dynamic `gg.m` subdomain routing algorithm (`w1`/`w2` and `a1`/`a2`).
  - Automatic `gg.js` sync and request interceptor header injection.

### 2. 📖 Comix (`comix.to`)
Comprehensive extension for Comix manga, manhwa, and comics:
- **Homepage Sections**:
  - 🌟 **Trending**: Daily trending featured banner
  - 🇯🇵 **Latest Manga**: Japanese manga releases
  - 🇰🇷 **Latest Manhwa (Webtoons)**: Korean webtoons
  - 🇨🇳 **Latest Manhua**: Chinese comics
  - 🔥 **Most Followed**: All-time most followed titles
  - ⭐ **Top Rated**: Highest scoring series
  - 🆕 **Recently Added**: Newly indexed titles
- **Search & Filter**:
  - Title keyword search with unencoded signature authentication.
  - 26+ Genres with tag inclusion & exclusion support (`supportsTagExclusion: true`).
  - Filter by Publication Format, Demographics, Status, and Sort criteria.

### 3. 🌐 MangaHub (`mangahub.io`)
Fast, GraphQL-powered extension for MangaHub manga, manhwa, and webtoons:
- **Homepage Sections**:
  - 🌟 **Popular Manga**: Featured carousel of all-time popular manga
  - 🔄 **Latest Updates**: Newly uploaded chapters
  - 🇰🇷 **Popular Manhwa (Webtoons)**: Top Korean webtoons
  - 🇨🇳 **Popular Manhua**: Top Chinese manhua
  - 🆕 **Recently Added**: Newly indexed series
  - 🏆 **Completed Series**: Complete story releases
- **Search & Tag Filter**:
  - Search by keywords, publication format, and 35+ sanitized genres.
  - Sort by Popular, Latest Updates, Recently Added, Completed, or Alphabetical (A-Z).
- **Cloudflare Bypass**: Native `CloudflareBypassRequestProviding` integration with session resilience and key generation.

### 4. 🌸 AllPornComic (`allporncomic.com`)
Full-featured extension for AllPornComic webtoons and comics:
- **Homepage Sections**:
  - 🔄 **Latest Updates**
  - 🔥 **Most Popular**
  - ⭐ **Top Rated**
  - 🆕 **New Releases**
- **Cloudflare Bypass**: Native `CloudflareBypassRequestProviding` integration to handle Cloudflare turnstile/clearance directly in Paperback.
- **Search & Filter**: Search by title or browse by category.
- **High-Res Reader**: Automatically strips thumbnail downscaling suffixes for crisp, high-resolution comic pages.

### 5. 👑 ToonGod (`toongod.org`)
Full-featured extension for ToonGod webtoons, manhwa, and manga:
- **Homepage Sections**:
  - 🔄 **Latest Updates**
  - 🔥 **Most Popular**
  - ⭐ **Top Rated**
  - 🆕 **New Releases**
- **Cloudflare Bypass**: Native `CloudflareBypassRequestProviding` integration to solve Cloudflare Turnstile directly within Paperback.
- **Search & Filter**:
  - Search by keywords or filter across genres (Romance, Drama, Fantasy, Comedy, Action, etc.).
  - Continuous multi-page infinite scroll pagination.
  - Smart prefix search (`genre:romance`, `tag:drama`).
- **High-Res Reader**: Vertical webtoon reader layout with zero-dependency JSC parsing.

---

## 🔎 Hitomi Search Syntax Guide

You can search using titles, namespace filters, and exclusions interchangeably:

| Search Query | Description |
| :--- | :--- |
| `Summer Memories` | Returns all matching chapters/volumes by title |
| `Summer Memories language:english` | Returns only English releases of the title |
| `Summer Memories language:japanese` | Returns only Japanese releases of the title |
| `Summer Memories -tag:drama` | Excludes any chapters containing the `drama` tag |
| `artist:shinkai language:english` | Streams English galleries by a specific artist |
| `type:manga language:english` | Filters by type (e.g. `manga`, `webtoon`, `doujinshi`) |
| `series:"original work" -tag:fantasy` | Series search with phrase quotes and negative tag exclusion |
| `1234567` | Direct gallery ID lookup |

---

## 🛠️ Local Development & Building

### Prerequisites
- Node.js 18+ (tested on Node 20 / 22)
- npm

### Setup
```bash
git clone https://github.com/Phat-Hy/Hitomi.la-Paperback-Repo.git
cd Hitomi.la-Paperback-Repo
npm install
```

### Build & Bundle
Bundle all extensions and generate repository index files:
```bash
npm run bundle
# or
npx paperback bundle
```

This compiles TypeScript source files in `src/` to `bundles/` and updates `versioning.json`.

---

## 📄 License

GPL-3.0 License. See [LICENSE](LICENSE) for details.
