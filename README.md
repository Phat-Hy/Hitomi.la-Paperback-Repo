# Hitomi.la Paperback Repository (v0.8)

Official Paperback v0.8 source repository for [Hitomi.la](https://hitomi.la).

[![Bundle and Publish Sources](https://github.com/Phat-Hy/Hitomi.la-Paperback-Repo/actions/workflows/main.yml/badge.svg)](https://github.com/Phat-Hy/Hitomi.la-Paperback-Repo/actions/workflows/main.yml)
[![Version](https://img.shields.io/badge/version-1.2.11-blue.svg)](https://github.com/Phat-Hy/Hitomi.la-Paperback-Repo)
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
5. Tap **Add** and install or update the **Hitomi** extension from the catalog.

---

## ✨ Features

- **🏠 Multi-Section Homepage**:
  - 🌟 **Popular Today** (`popular-today.nozomi`)
  - 🔥 **Popular This Week** (`popular-week.nozomi`)
  - 🆕 **Recently Added** (`index-all.nozomi`)
  - Infinite scroll pagination on "View More" sections via Range byte streams.

- **🔍 Smart Composite Search**:
  - **Exact & Fuzzy Title Search**: Two-phase B-Tree range search with candidate sorting for exact matching on multi-word phrases (e.g. *Mother and No Other!!*).
  - **Direct ID Lookup**: Enter digits directly (e.g. `2892173`) for instantaneous gallery resolution.
  - **Inline Namespace Filters**: Filter by language, tag, artist, series, character, group, or type directly in the search bar.
  - **Negative Exclusions**: Prepend `-` to exclude specific tags or attributes (e.g. `-tag:cheating`).
  - **Seamless UI Integration**: Combine typed titles with Paperback's native filter menu (e.g. typing a title while selecting Language in the filter sheet).
  - **Deep Multi-Page Pagination**: Continuous scrolling across broad search pools (up to 1,000 titles) and infinite Nozomi feeds.

- **🖼️ High-Performance Image Engine**:
  - Real-time `gg.js` dynamic hash routing algorithm for WebP and AVIF pages.
  - Dual subdomain distribution (`w1`/`w2` and `a1`/`a2`) with automatic fallback mapping.
  - Built-in request interceptor injecting required Hitomi CDN headers (`Referer: https://hitomi.la/`) on all image downloads.

---

## 🔎 Search Syntax Guide

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

### Supported Filter Prefixes
* **Language**: `language:xxx`, `lang:xxx`
* **Female Tags**: `female:xxx`
* **Male Tags**: `male:xxx`
* **General Tags**: `tag:xxx`, `-tag:xxx`
* **Artist**: `artist:xxx`
* **Series / Parody**: `series:xxx`, `parody:xxx`
* **Character**: `character:xxx`, `char:xxx`
* **Group / Circle**: `group:xxx`, `circle:xxx`
* **Type**: `type:doujinshi`, `type:manga`, `type:artistcg`, `type:gamecg`

> [!TIP]
> Multi-word values can be enclosed in double quotes (e.g. `tag:"huge breasts"`) or typed with underscores (e.g. `tag:huge_breasts`).

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

### Repository Settings:
1. Go to repository settings: [Hitomi.la-Paperback-Repo Settings](https://github.com/Phat-Hy/Hitomi.la-Paperback-Repo/settings/pages).
2. Under **Build and deployment** -> **Source**, select **Deploy from a branch**.
3. Under **Branch**, select `gh-pages` and `/ (root)`, then click **Save**.

---

## 📄 License
This project is licensed under the [GNU General Public License v3.0](LICENSE).
