# Plan: Hitomi.la Paperback v0.8 Repository

## Goal
Build a fully functional extension repository for the **Hitomi.la** source targeting **Paperback v0.8** (iOS), based on the architecture of `thenetsky/netskys-extensions` (0.8 branch), deploying to `https://github.com/Phat-Hy/Hitomi.la-Paperback-Repo`, with the Agent Harness kit installed.

## Context & Architecture
- **Paperback v0.8 Framework**:
  - Uses `@paperback/types: ^0.8.7` and `@paperback/toolchain: ^0.8.7`.
  - Extension class implementing `SearchResultsProviding`, `MangaProviding`, `ChapterProviding`, `HomePageSectionsProviding`.
  - Source information defined with `SourceInfo`, `ContentRating.ADULT`, `SourceIntents`.
  - Directory structure: `src/Hitomi/Hitomi.ts`, `src/Hitomi/HitomiParser.ts`, `src/Hitomi/includes/icon.png`.
- **Hitomi.la Protocol**:
  - Base domain: `https://hitomi.la` / `https://ltn.gold-usergeneratedcontent.net`.
  - Feed and JSON endpoints: All Atom feeds (`*.atom`), gallery JSON (`galleries/{id}.js`), and `gg.js` are served directly via `https://ltn.gold-usergeneratedcontent.net/` (HTTP 200). Note: `hitomi.la/*.atom` returns HTTP 302 redirecting to LTN, so requests should target `LTN_DOMAIN` directly to avoid header-stripping on cross-origin redirects in iOS URLSession.
  - Image decryption & URLs: Hitomi's `gg.js` dynamic hash routing algorithm implemented in `ImageUriResolver`.
  - Tag & Search Engine: Official Hitomi TagIndex API (`https://tagindex.hitomi.la/global/<c1>/<c2>/.../<cn>.json` and namespace indices), returning pure JSON suggestion arrays `[ [name, count, namespace], ... ]`.
- **Repository & Distribution**:
  - GitHub Actions workflow (`.github/workflows/main.yml`) bundles sources using `npx paperback bundle` and `npx paperback bundle --folder=0.8` and deploys to `gh-pages` branch.
  - Repo URL: `https://phat-hy.github.io/Hitomi.la-Paperback-Repo/`.

## Version Evolution & Bug Fixes
- **v1.0.0**: Initial port with Nozomi binary buffers and direct feeds. Encountered iOS URLSession binary decoding issues with Nozomi and Range headers.
- **v1.1.0**: Switched to live UTF-8 XML Atom feeds. Expanded homepage to 7 sections.
- **v1.2.0**: Attempted B-Tree Range requests for gallery titles. Caused iOS URLSession crashes/freezing due to unsupported Range headers on 1.9GB index file and 302 redirects from `hitomi.la`.
- **v1.2.1 (Resolved & Verified)**:
  1. Removed B-Tree Range search; replaced with native Hitomi TagIndex API (`tagindex.hitomi.la`) for instant title/tag/series/artist/character searches.
  2. Changed all feed requests from `hitomi.la` to `ltn.gold-usergeneratedcontent.net` directly, eliminating HTTP 302 redirects and header drops.
  3. Streamlined homepage to 5 essential sections with individual try/catch emission (`sectionCallback`), ensuring each section appears immediately on screen.
  4. Removed `CLOUDFLARE_BYPASS_REQUIRED` intent flag to eliminate unnecessary bypass prompts.
  5. Tested and verified locally with mock runtime and confirmed live deployment on GitHub Pages.
- **v1.2.5**: Fixed filter hijacking and iOS binary parsing.
- **v1.2.6 (Title Search Perfected)**:
  1. Re-architected B-Tree galleriesindex title search into two-phase execution: Phase 1 locates data ranges for all candidate terms in the B-Tree index; Phase 2 sorts ranges by length ascending and downloads the smallest/most specific data chunk first (e.g. 120 bytes for other!! -> 29 IDs) instead of downloading large stop-word chunks first.
  2. Implemented fast in-memory DataView byte scanning for candidate ID intersection with secondary terms.
  3. Added title punctuation awareness: detects other!! when user searches Mother and No Other or Mother and No Other!!, and detects mother, for Mother, It Has to Be You.
  4. Moved B-Tree title search to run before TagIndex autocomplete suggestions, preventing tag suggestions from hijacking title queries.
  5. Added title relevance sorting with exact phrase bonus (+100) so chapters of the searched title appear first in results.
- **v1.2.7 (Pagination & Infinite Scroll)**:
  1. Title Search Pagination: Implemented PagedResults metadata passing with allIds pool (up to 1,000 matches). Page 1 serves the first 25 ranked results; scrolling down in Paperback automatically requests subsequent batches (25-50, 50-75, etc.) without re-querying the B-Tree index.
  2. Nozomi Feed Pagination: Added fetchNozomiSection with 100-byte Range requests for seamless infinite scrolling on View More (Recently Added, English, Manga, Doujinshi, etc.) and tag/namespace browse pages.
