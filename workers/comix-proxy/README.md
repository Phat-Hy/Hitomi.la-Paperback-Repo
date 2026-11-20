# comix.to reverse proxy (Cloudflare Worker)

Optional self-owned transport for `scripts/sync-comix-key.js`.

## Why

GitHub Actions runs on Azure IP ranges. comix.to sits behind Cloudflare, which
answers those ranges with a `403 / Just a moment...` challenge, so the scheduled
key sync cannot read the site directly. The sync already falls back to
`comix-to.translate.goog`, `r.jina.ai` and the Wayback Machine — this Worker is
the fallback you own and control, tried **before** any third party once
`COMIX_PROXY_URL` is set.

## Deploy

```bash
cd workers/comix-proxy
npx wrangler login      # opens a browser, one time
npx wrangler deploy
```

Wrangler prints the URL, e.g. `https://comix-proxy.<your-subdomain>.workers.dev`.
Free plan is 100k requests/day; one sync run uses about four.

## Wire it into the repository

Set the repository variable `COMIX_PROXY_URL` to the encoded template form
(**use this form** — it preserves query strings such as `?limit=20&page=1`):

```text
https://comix-proxy.<your-subdomain>.workers.dev/?u={url_encoded}
```

GitHub UI: **Settings → Secrets and variables → Actions → Variables → New
repository variable**. If you would rather set it from a terminal:

```bash
gh variable set COMIX_PROXY_URL --body "https://comix-proxy.<subdomain>.workers.dev/?u={url_encoded}"
```

Supported templates: `...?u={url_encoded}`, `...?url={url}`, or `{url}` inline.
The bare prefix form (`https://<worker>/`) works too, but the target's query
string is lost, so only use it for plain asset paths.

## Verify

Locally, with the variable exported:

```bash
COMIX_PROXY_URL="https://comix-proxy.<subdomain>.workers.dev/?u={url_encoded}" \
  node scripts/sync-comix-key.js --selftest
```

The `proxy` rows must be green for `html` and `js`. Then dispatch the
**Sync Comix Signing Key** workflow with both `force` and `selftest` unchecked
and confirm the log shows `transport ok proxy ...` before the others.

## Lock it down (optional)

An allowlisted GET-only proxy is low risk, but if you want a shared secret:

```bash
npx wrangler secret put PROXY_TOKEN
```

and append `&token=<value>` to `COMIX_PROXY_URL`. Requests without the token get
`403`.

## Contract

| Method | Path | Notes |
| --- | --- | --- |
| `GET` / `HEAD` | `/?u=<encoded https://comix.to/...>` | Recommended; preserves query |
| `GET` / `HEAD` | `/?url=<encoded ...>` | Same, alternate parameter name |
| `GET` / `HEAD` | `/<https://comix.to/...>` | Prefix form; target query is dropped |
| `OPTIONS` | any | CORS preflight |

Only `https` targets on `comix.to` or a `*.comix.to` subdomain are proxied.
Responses are never cached (`cacheTtl: 0`), cookies are stripped, and
`content-encoding` is normalised away because the Worker requests an identity
body.
