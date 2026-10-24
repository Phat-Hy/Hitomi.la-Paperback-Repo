# Plan: Hitomi.la Paperback v0.8 Repository

## Goal
Build a fully functional extension repository for the **Hitomi.la** source targeting **Paperback v0.8** (iOS), based on the architecture of `thenetsky/netskys-extensions` (0.8 branch), deploying to `https://github.com/Phat-Hy/Hitomi.la-Paperback-Repo`, with the Agent Harness kit installed.

## Context & Architecture
- **Paperback v0.8 Framework**:
  - Uses `@paperback/types: ^0.8.7` and `@paperback/toolchain: ^0.8.7`.
  - Extension class implementing `SearchResultsProviding`, `MangaProviding`, `ChapterProviding`, `HomePageSectionsProviding`.
  - Source information defined with `SourceInfo`, `ContentRating.ADULT`, `SourceIntents`.
  - Directory structure: `src/Hitomi/Hitomi.ts`, `src/Hitomi/HitomiParser.ts` (or utils), `src/Hitomi/includes/icon.png`.
- **Hitomi.la Protocol**:
  - Base domain: `https://hitomi.la` / `https://ltn.gold-usergeneratedcontent.net`.
  - Gallery details: `https://ltn.gold-usergeneratedcontent.net/galleries/{id}.js`.
  - Image decryption & URLs: Hitomi's `gg.js` dynamic hash routing algorithm.
  - Homepage / Popular / Latest: Nozomi binary files (`index-all.nozomi`, `today-all.nozomi`, `week-all.nozomi`, etc.).
  - Search: Keyword and tag parsing, search queries via Hitomi index or search endpoints.
- **Repository & Distribution**:
  - GitHub Actions workflow (`.github/workflows/main.yml`) bundles sources using `npm run bundle` and deploys to `gh-pages` branch.
  - Compatible with Paperback v0.8 repo URL: `https://phat-hy.github.io/Hitomi.la-Paperback-Repo/` or `/0.8/`.
- **Harness Skill & Guardrails**:
  - `.hs.json` and `.agents/` kit hooks, rules, and skills configured.

## Proposed Steps
1. **Repository Setup & Tooling**:
   - Create `package.json`, `tsconfig.json`, `.eslintrc.js`, `.gitignore`, `.gitattributes`.
   - Install dependencies (`@paperback/toolchain`, `@paperback/types`, `cheerio`, `html-entities`, TypeScript).
2. **Hitomi Extension Implementation (`src/Hitomi`)**:
   - `src/Hitomi/Hitomi.ts`: Main class implementing Paperback v0.8 interfaces (`MangaProviding`, `ChapterProviding`, `SearchResultsProviding`, `HomePageSectionsProviding`).
   - `src/Hitomi/HitomiParser.ts`: Logic for:
     - `gg.js` extraction and URL resolution for webp images.
     - Nozomi binary file reading (BigEndian int32 buffer parsing) for popular & latest galleries.
     - Gallery JSON parsing (`galleries/{id}.js`) into `SourceManga` and chapter pages.
     - Search handling (tag/term searches, gallery IDs).
   - `src/Hitomi/includes/icon.png`: High-resolution Hitomi icon.
3. **GitHub Actions & Automated Deployment**:
   - Create `.github/workflows/main.yml` supporting pushes to `main` and branch `0.8`.
   - Setup bundling scripts.
4. **Verification & Testing**:
   - Run `npm run bundle` locally to test bundling without errors.
   - Run `npm run test` or mock requests to verify metadata and parsing.
   - Verify bundle output (`bundles/` or `0.8/`).
5. **Documentation**:
   - Create a clean `README.md` with:
     - Paperback repository URL to add to the app.
     - How to install on iOS Paperback v0.8.
     - Development guide (`npm run bundle`, `npm run serve`).
