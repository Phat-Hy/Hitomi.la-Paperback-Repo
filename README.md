# Hitomi.la Paperback Repository (v0.8)

Official Paperback v0.8 source repository for [Hitomi.la](https://hitomi.la).

## 📥 How to Add to Paperback App (v0.8)

1. Open **Paperback** on your iOS device.
2. Go to **Settings** ⚙️ -> **External Sources** / **Repositories**.
3. Tap **Add Repository** (or **+**).
4. Paste either of the following repository URLs:
   ```
   https://phat-hy.github.io/Hitomi.la-Paperback-Repo/
   ```
   or
   ```
   https://phat-hy.github.io/Hitomi.la-Paperback-Repo/0.8/
   ```
5. Tap **Add** and install the **Hitomi** extension from the catalog.

---

## ✨ Features

- **Home Sections**:
  - 🌟 Popular Today
  - 🔥 Popular This Week
  - 🆕 Recently Added
- **Search**:
  - Direct Gallery ID lookup (e.g. `4277052`)
  - Full B-Tree fuzzy and keyword search across Hitomi titles, artists, characters, and series
  - Category tags (Doujinshi, Manga, Artist CG, Game CG)
  - Language filters (English, Japanese, Chinese, Korean, Spanish)
- **High Performance Image Engine**:
  - Live `gg.js` dynamic hash routing algorithm for WebP images
  - High resolution thumbnail and chapter page resolution
  - Cloudflare bypass integration

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
Or bundle specifically for the 0.8 folder:
```bash
npx paperback bundle --folder=0.8
```

### Local Dev Server
To test your local source directly on your device connected to the same Wi-Fi network:
```bash
npm run serve
```

---

## 🚀 Automated Deployment (GitHub Actions)

This repository includes a GitHub Actions workflow (`.github/workflows/main.yml`) that automatically builds the Paperback bundle on every push and publishes the compiled repository to the `gh-pages` branch.

### Enabling GitHub Pages in your GitHub Repository:
1. Go to your repository settings: [Hitomi.la-Paperback-Repo Settings](https://github.com/Phat-Hy/Hitomi.la-Paperback-Repo/settings/pages).
2. Under **Build and deployment** -> **Source**, select **Deploy from a branch**.
3. Under **Branch**, select `gh-pages` and `/ (root)`, then click **Save**.
