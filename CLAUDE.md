# CLAUDE.md

Operator notes for this repo. Read before touching the portfolio.

## Development rules

### Always run `npm run build` before pushing

```bash
npm run build
```

Runs the HTML generator (`scripts/build.mjs`) then the Tailwind CLI. Catches:

- Markdown frontmatter typos that break a post's metadata
- Unreplaced `{{ placeholders }}` from a partial template (build prints `warn: unreplaced placeholders: [...]`)
- Tailwind class lookup failures (v4 errors loudly on `@apply` of an unknown utility)

CI runs the same command and asserts the expected files exist in `dist/`.

### Always use feature branches

Never push directly to `main`. Open a PR, let CI run, merge.

## Architecture rules

### No JSX runtime, ever

This site is intentionally framework-free. Adding React, Astro, or any JSX runtime is a regression on the scope this site was deliberately reduced to. If a feature needs interactivity:

1. First try CSS (animations, hover states, `:has()` selectors are powerful).
2. Then try ~10-50 LOC of vanilla JS in `src/scripts/` (see `theme.js`, `typing.js`, `blog-filter.js` as the size budget).
3. Only beyond that, reach for a build-time include (a partial in `src/partials/`) or a build-script enhancement.

The HTML + CSS without images is about 90KB. Keep the whole site lean — no heavy media without a reason.

### No client-side routing

Every page is a real file at a real URL. No SPA shell, no hydration. The browser navigates between pages with normal HTTP.

### Markdown for posts, HTML for layout

Blog posts: `src/posts/*.md` with YAML frontmatter. Rendered by `marked` at build time. The renderer is configured in `scripts/build.mjs` (`configureMarked`); all rendering enhancements run at build time and ship as plain HTML + CSS (no client framework). If you need a new MDX-style component in a post, add it as a `marked` extension there, not by pulling in MDX.

Authoring features the renderer supports today:

- **Syntax highlighting** via Shiki (build-time, a `devDependency`, never shipped to the browser). Fence a code block with a language (` ```bash `, ` ```typescript `, etc.) and it gets dual light/dark highlighting that follows the `.dark` theme toggle through CSS variables, zero client JS. Supported languages are the `SHIKI_LANGS` array in `build.mjs`; add to it for a new language. Unknown languages fall back to plaintext rather than failing the build.
- **Admonitions**: `:::note`, `:::info`, `:::tip`, `:::warning`, `:::danger`, optionally with an inline title (`:::warning Heads up`), closed by a line containing only `:::`. Styled in `styles.css` under `.admonition-*`.
- **Heading anchors**: `##` and `###` headings auto-get a slug `id` and a hover `#` link. Slug dedup is per-post.
- **Copy button**: post pages load `src/scripts/copy-code.js`, which adds a hover copy-to-clipboard button to each code block. Progressive enhancement — code is fully readable without JS.

Pages: `src/pages/*.html`. Plain HTML with `{{ placeholders }}` for values the layout fills (title, description, content). The page itself can also have placeholders that the build script fills before wrapping (used for blog/index.html's tag filter + post cards).

## Adding a blog post

1. `src/posts/<slug>.md` with frontmatter: `title`, `summary`, `label`, `author`, `published`, `image`, `readTime`, optional `tags`.
2. Cover image in `public/images/`.
3. `npm run build` → post HTML at `dist/blog/posts/<slug>.html`, card on the blog index, entry in `sitemap.xml`.

## Adding a page

1. `src/pages/<route>.html` with YAML frontmatter at the top (`title`, `description`, `ogImage`, `canonical`, `header: home` or `blog`).
2. Body is plain HTML with Tailwind utility classes.
3. `npm run build`. The page lands at `/<route>` (the nginx `try_files $uri $uri.html` rule resolves the `.html` extension for pretty URLs).

## Design system

Ocean Breeze (palette from [tweakcn](https://tweakcn.com/r/themes/ocean-breeze.json)). The site is a calm two-tone field with a single emerald accent. Light theme is a cool alice-blue field (`#F0F8FF`, `oklch(0.9751 0.0127 244.25)`) with dark slate-blue ink text (`oklch(0.3729 0.0306 259.73)`); dark theme is a deep navy field (`#0F172A`) with light-grey text (`oklch(0.8717 0.0093 258.34)`). Muted text is slate-grey. The one accent is emerald green (`#22C55E`, slightly brighter `#34D399` in dark), used sparingly: the brand blob, hover states, the active tag, link underlines. Layout corners use a `0.5rem` radius (`--radius`); imagery is masked into soft squircle tiles (`--radius-tile`); hairlines are a light slate `--border`. A section can flip to the opposite tone with `.section-ink`. Signature elements: the morphing-blob mark (`.blob`), two-tone statement text (`.statement` emphasis plus `.ctx` context), mono HUD meta labels, and scramble-on-hover (`scramble.js`). Motion is CSS plus tiny vanilla JS only: no GSAP, Lenis, or WebGL.

Fonts: DM Sans for display, headings, and body; IBM Plex Mono for nav, labels, meta, and code; Lora available as the serif (`--font-serif`). Visual changes should stay consistent with the tokens in `src/styles.css`.

The favicon mark (navy tile + emerald blob) lives in `public/favicon.svg`. The bitmap icons (`favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`) are regenerated from that mark by `node scripts/gen-icons.mjs` — re-run it after any palette change so the bitmaps stay in sync.

The hero portrait is `public/images/portrait-bw.jpg` — a 1152×1536 (3:4) black-and-white crop of the source photo, converted with `sips` (center crop to 3:4, resize, match to the Generic Gray ICC profile). It doubles as the OG/social-card image. To swap it, keep the ratio and rerun that treatment.

## Hosting

Self-hosted in the **farallon homelab**, mirroring the blog's deploy shape: a Docker image (Node build stage → nginx serving `dist/` on :3002) running as a compose unit on the acquisition VM, proxied at `alexanderwest.com` by Nginx Proxy Manager with a Let's Encrypt cert. Infra wiring lives in the [farallon-infra](https://github.com/awest25/farallon-infra) repo.

Deploy is: build on the VM from this directory, `docker compose up -d --build`. If the site later moves to Cloudflare Pages, delete the Dockerfile/compose and the nginx notes here.

## Provenance

Design and build system adapted from [JayceBordelon/jaycebordelon.com](https://github.com/JayceBordelon/jaycebordelon.com). All content (name, copy, images, resume, posts) is Alexander's. Keep the attribution line in README.md.

## Related repos

- [farallon-infra](https://github.com/awest25/farallon-infra) — homelab Terraform.
- [blog](https://github.com/awest25/blog) — earlier Astro blog at `blog.alexanderwest.com` (Keystatic-edited, separate container).
- [resume](https://github.com/awest25/resume) — LaTeX source of `public/Resume.pdf`; its CI builds the PDF artifact.

## No auth here

This site has no signed-in surfaces and no plan to add them.

## Local dev

```bash
npm install
npm run build
npm run serve
# http://localhost:3000
```

Edit, re-run `npm run build`, refresh the browser. Or run `npm run watch:css` in one terminal for Tailwind hot-rebuild while you re-run the HTML build manually.
