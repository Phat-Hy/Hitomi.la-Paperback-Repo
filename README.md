# Paperback v0.8 Sources Repository

Official Paperback v0.8 source repository providing extensions for [Hitomi.la](https://hitomi.la), [AllPornComic.com](https://allporncomic.com), and [ToonGod.org](https://www.toongod.org).

[![Bundle and Publish Sources](https://github.com/Phat-Hy/Hitomi.la-Paperback-Repo/actions/workflows/main.yml/badge.svg)](https://github.com/Phat-Hy/Hitomi.la-Paperback-Repo/actions/workflows/main.yml)
[![Hitomi Version](https://img.shields.io/badge/Hitomi-v1.2.11-blue.svg)](https://github.com/Phat-Hy/Hitomi.la-Paperback-Repo)
[![AllPornComic Version](https://img.shields.io/badge/AllPornComic-v1.0.4-pink.svg)](https://github.com/Phat-Hy/Hitomi.la-Paperback-Repo)
[![ToonGod Version](https://img.shields.io/badge/ToonGod-v1.0.2-yellow.svg)](https://github.com/Phat-Hy/Hitomi.la-Paperback-Repo)
[![Paperback](https://img.shields.io/badge/paperback-v0.8-orange.svg)](https://paperback.moe)

### 3. 👑 ToonGod (`toongod.org`)
Full-featured extension for ToonGod adult manhwa, webtoons, and manga:
- **Homepage Sections**:
  - 🔄 **Latest Updates**
  - 🔥 **Most Popular**
  - ⭐ **Top Rated**
  - 🆕 **New Releases**
- **Cloudflare Bypass**: Native `CloudflareBypassRequestProviding` integration to solve Cloudflare Turnstile directly within Paperback.
- **Search & Filter**:
  - Search by keywords or filter by 35+ genres (Romance, Drama, Fantasy, Smut, Mature, Harem, etc.).
  - Continuous multi-page infinite scroll pagination.
  - Smart prefix search (`genre:romance`, `tag:smut`).
- **High-Res Reader**: Vertical webtoon reader layout with zero-dependency JSC parsing.

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
5. Tap **Add** and install either or both extensions from the catalog:
   - **Hitomi** (v1.2.11)
   - **AllPornComic** (v1.0.4)
   - **ToonGod** (v1.0.2)

---

## 📚 Available Sources

### 1. 🌸 AllPornComic (`allporncomic.com`)
Full-featured extension for AllPornComic adult webtoons and comics:
- **Homepage Sections**:
  - 🔄 **Latest Updates**
  - 🔥 **Most Popular**
  - ⭐ **Top Rated**
  - 🆕 **New Releases**
- **Cloudflare Bypass**: Native `CloudflareBypassRequestProviding` integration to handle Cloudflare turnstile/clearance directly in Paperback.
- **Search & Filter**: Search by title or browse by adult genre categories.
- **High-Res Reader**: Automatically strips thumbnail downscaling suffixes for crisp, high-resolution comic pages.

### 2. ⚡ Hitomi (`hitomi.la`)
High-performance extension for Hitomi manga and doujinshi:
- **Homepage Sections**:
  - 🌟 **Popular Today** (`popular-today.nozomi`)
  - 🔥 **Popular This Week** (`popular-week.nozomi`)
  - 🆕 **Recently Added** (`index-all.nozomi`)
- **Smart Composite Search**:
  - Two-phase B-Tree exact & fuzzy title search.
  - Direct gallery ID lookup (e.g. `2892173`).
  - Typed namespace filters (`language:english`, `female:milf`, `tag:xxx`, `artist:xxx`, `type:xxx`).
  - Negative exclusions (`-tag:cheating`, `-female:bikini`).
- **Dynamic Image Engine**:
  - Dynamic `gg.m` subdomain routing algorithm (`w1`/`w2` and `a1`/`a2`).
  - Automatic `gg.js` sync and request interceptor header injection.

---

## 🔎 Hitomi Search Syntax Guide

You can search using titles, namespace filters, and exclusions interchangeably:

| Search Query | Description |
| :--- | :--- |
| `Mother and No Other!!` | Returns all matching chapters/volumes by title |
| `Mother and No Other!! language:english` | Returns only English releases of the title |
| `Mother and No Other!! language:turkish` | Returns only Turkish releases of the title |
| `Mother and No Other!! -female:bikini` | Excludes any chapters containing the `bikini` tag |
| `female:milf language:english` | Streams English galleries tagged with `female:milf` |
| `artist:homunculus` | Searches galleries by specific artist |
| `series:"fate grand order" -tag:netorare` | Series search with phrase quotes and negative tag exclusion |
| `2892173` | Direct gallery ID lookup |

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
```bash
npm run bundle
```

Or bundle specifically for the `0.8` branch folder:
```bash
npx paperback bundle --folder=0.8
```

### Local Dev Server
To test your local source directly on your iOS device connected to the same Wi-Fi network:
```bash
npm run serve
```

---

## 🚀 Automated Deployment (GitHub Actions)

This repository includes a GitHub Actions workflow (`.github/workflows/main.yml`) that automatically compiles the Paperback bundle on every push to `main` and publishes the output to GitHub Pages (`gh-pages` branch).

---

## 📄 License
This project is licensed under the [GNU General Public License v3.0](LICENSE).
