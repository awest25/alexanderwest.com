#!/usr/bin/env node
/*
 * Static site build.
 * Input: src/ tree (pages with frontmatter + partials + markdown posts).
 * Output: dist/ tree (plain HTML + CSS + images), drop-in for nginx.
 *
 * Pipeline:
 *   1. Read the background partial once (static markup, no generation).
 *   2. Render each src/pages/**.html through the layout partial.
 *   3. Render each src/posts/*.md to a blog post HTML via the post partial.
 *   4. Render the blog index with the list of post cards.
 *   5. Compile Tailwind (separate npm step; not done here).
 *   6. Copy public assets + scripts/ to dist/.
 *   7. Emit sitemap.xml + robots.txt.
 *
 * No JS frameworks, no JSX. marked + gray-matter + the standard library.
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, dirname, basename, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { marked } from "marked";
import { createHighlighter } from "shiki";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");
const DIST = join(ROOT, "dist");
const SITE_URL = process.env.SITE_URL || "https://alexanderwest.com";

/* ---------------------------------------------------------------- *
 * fs helpers                                                        *
 * ---------------------------------------------------------------- */

function read(path) {
  return readFileSync(path, "utf8");
}
function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}
function walk(dir, ext) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, ext));
    else if (!ext || entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

/* ---------------------------------------------------------------- *
 * Frontmatter-style header on .html source files                    *
 * ---------------------------------------------------------------- */

function parsePageFrontmatter(raw) {
  // src/pages/*.html files start with --- ... --- YAML frontmatter
  // followed by the body. Reuse gray-matter so YAML works.
  if (!raw.startsWith("---")) return { data: {}, content: raw };
  return matter(raw);
}

/* ---------------------------------------------------------------- *
 * Layout rendering                                                  *
 * ---------------------------------------------------------------- */

function applyTemplate(template, vars) {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    const re = new RegExp(`{{\\s*${key}\\s*}}`, "g");
    out = out.replace(re, value ?? "");
  }
  // Surface any unreplaced placeholders so typos fail loud instead of
  // shipping a literal `{{ foo }}` to production.
  const unreplaced = out.match(/{{\s*[a-zA-Z][a-zA-Z0-9_]*\s*}}/g);
  if (unreplaced && unreplaced.length > 0) {
    console.warn("warn: unreplaced placeholders:", [...new Set(unreplaced)]);
  }
  return out;
}

function escapeHTML(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeJSONForScript(obj) {
  // JSON-LD injected as the body of a <script>. JSON.stringify can emit
  // a literal '</script>' inside string fields (author-controlled), which
  // would break out of the script tag and create an XSS surface. Escape
  // '<' to its JSON unicode form so the browser parser can't terminate
  // the script early. Input is the OBJECT, not a pre-stringified string.
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

/* ---------------------------------------------------------------- *
 * Markdown engine config (Shiki highlighting, heading anchors,      *
 * admonitions). All build-time; the rendered HTML ships no JS.      *
 * ---------------------------------------------------------------- */

// Languages the posts actually use, plus a few common ones so future
// posts highlight without a build change. Keep this list tight — each
// grammar adds to build time, not to shipped output.
const SHIKI_LANGS = ["bash", "shell", "protobuf", "typescript", "javascript", "json", "go", "python", "html", "css", "yaml", "diff", "sql", "rust", "c", "cpp"];

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/<[^>]+>/g, "") // strip any inline HTML tags
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

const ADMONITION_META = {
  note: { label: "Note" },
  info: { label: "Info" },
  tip: { label: "Tip" },
  warning: { label: "Warning" },
  danger: { label: "Danger" },
};

// Map a fenced code's language token to a grammar Shiki has loaded,
// falling back to plaintext so an unknown lang never throws the build.
function resolveLang(highlighter, lang) {
  const requested = (lang || "").trim().split(/\s+/)[0].toLowerCase();
  if (requested && highlighter.getLoadedLanguages().includes(requested)) return requested;
  return "text";
}

function configureMarked(highlighter) {
  const usedSlugs = new Map();

  marked.use({
    gfm: true,
    hooks: {
      preprocess(markdown) {
        // Heading-id dedup is per-document, not per-build.
        usedSlugs.clear();
        return markdown;
      },
    },
    extensions: [
      {
        name: "admonition",
        level: "block",
        start(src) {
          const i = src.indexOf("\n:::");
          const head = src.startsWith(":::") ? 0 : -1;
          if (head === 0) return 0;
          return i === -1 ? undefined : i + 1;
        },
        tokenizer(src) {
          const rule = /^:::(\w+)(?:[ \t]+([^\n]*))?\n([\s\S]*?)\n:::[ \t]*(?:\n+|$)/;
          const match = rule.exec(src);
          if (!match) return undefined;
          const [raw, kindRaw, titleRaw, body] = match;
          const kind = kindRaw.toLowerCase();
          if (!ADMONITION_META[kind]) return undefined;
          const token = {
            type: "admonition",
            raw,
            kind,
            title: (titleRaw || "").trim(),
            tokens: [],
          };
          this.lexer.blockTokens(body, token.tokens);
          return token;
        },
        renderer(token) {
          const meta = ADMONITION_META[token.kind];
          const heading = token.title || meta.label;
          const inner = this.parser.parse(token.tokens);
          return `<div class="admonition admonition-${token.kind}">
  <p class="admonition-title">${escapeHTML(heading)}</p>
  <div class="admonition-content">${inner}</div>
</div>\n`;
        },
      },
    ],
    renderer: {
      code({ text, lang }) {
        const language = resolveLang(highlighter, lang);
        const highlighted = highlighter.codeToHtml(text, {
          lang: language,
          themes: { light: "github-light-default", dark: "nord" },
          defaultColor: false,
        });
        // Build-time wrapper: carries the small language label (CSS
        // ::before reads data-lang) and anchors the copy button that
        // copy-code.js appends at runtime.
        const langAttr = language === "text" ? "" : ` data-lang="${language}"`;
        return `<div class="code-block"${langAttr}>${highlighted}</div>\n`;
      },
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        if (depth === 1 || depth > 3) return `<h${depth}>${inner}</h${depth}>\n`;
        const base = slugify(inner) || "section";
        const seen = usedSlugs.get(base) ?? 0;
        usedSlugs.set(base, seen + 1);
        const id = seen === 0 ? base : `${base}-${seen}`;
        return `<h${depth} id="${id}" class="scroll-mt-24">${inner}<a href="#${id}" class="heading-anchor" aria-label="Link to this section">#</a></h${depth}>\n`;
      },
    },
  });
}

/* ---------------------------------------------------------------- *
 * Build defaults                                                    *
 * ---------------------------------------------------------------- */

const layoutTemplate = read(join(SRC, "partials/layout.html"));
const headerHome = read(join(SRC, "partials/header-home.html"));
const headerBlog = read(join(SRC, "partials/header-blog.html"));
const postTemplate = read(join(SRC, "partials/post.html"));
// The background is the drawing sheet: graph-paper grid, double frame,
// registration marks, and grid-zone references.
const backgroundSVG = read(join(SRC, "partials/background.html"));

function renderPage({ frontmatter, body, slug }) {
  const header = frontmatter.header === "blog" ? headerBlog : headerHome;
  const jsonLd = frontmatter.jsonLd ?? defaultJsonLd();
  return applyTemplate(layoutTemplate, {
    title: escapeHTML(frontmatter.title || "Alexander West"),
    description: escapeHTML(frontmatter.description || ""),
    canonical: frontmatter.canonical || `${SITE_URL}${slug}`,
    ogTitle: escapeHTML(frontmatter.ogTitle || frontmatter.title || "Alexander West"),
    ogType: frontmatter.ogType || "website",
    ogImage: frontmatter.ogImage ? `${SITE_URL}${frontmatter.ogImage}` : `${SITE_URL}/icon-512.png`,
    htmlClass: frontmatter.htmlClass || "",
    bodyClass: frontmatter.bodyClass || "min-h-screen",
    header,
    content: body,
    background: backgroundSVG,
    pageScripts: frontmatter.pageScripts || "",
    jsonLd: escapeJSONForScript(jsonLd),
  });
}

function defaultJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: "Alexander West",
    url: SITE_URL,
    jobTitle: "Software Engineer",
    alumniOf: {
      "@type": "CollegeOrUniversity",
      name: "University of California, Los Angeles",
    },
    sameAs: ["https://github.com/awest25", "https://linkedin.com/in/awest25"],
  };
}

/* ---------------------------------------------------------------- *
 * Page rendering                                                    *
 * ---------------------------------------------------------------- */

function buildPages() {
  const files = walk(join(SRC, "pages"), ".html");
  for (const file of files) {
    const rel = relative(join(SRC, "pages"), file);
    // blog/index.html is handled by buildBlogIndex after posts have
    // been rendered (it needs the post list to fill in the cards).
    if (rel === "blog/index.html") continue;
    const raw = read(file);
    const { data, content } = parsePageFrontmatter(raw);
    const slug = "/" + (rel === "index.html" ? "" : rel.replace(/\/index\.html$/, "").replace(/\.html$/, ""));
    const html = renderPage({ frontmatter: data, body: content, slug });
    write(join(DIST, rel), html);
  }
}

/* ---------------------------------------------------------------- *
 * Posts                                                             *
 * ---------------------------------------------------------------- */

function authorInitials(name) {
  return name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatDate(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function buildPosts() {
  const postsDir = join(SRC, "posts");
  if (!existsSync(postsDir)) return [];

  const posts = [];
  for (const file of readdirSync(postsDir).filter((f) => f.endsWith(".md"))) {
    const id = file.replace(/\.md$/, "");
    const raw = read(join(postsDir, file));
    const { data, content } = matter(raw);
    const html = marked.parse(content);

    // Final row of the title block: tags as small mono part labels.
    const tagBlock =
      data.tags && data.tags.length > 0
        ? `<div class="flex flex-wrap gap-2 border-t border-border px-5 py-3 sm:px-7">${data.tags
            .map(
              (t) =>
                `<span class="inline-flex items-center border border-border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">${escapeHTML(t)}</span>`
            )
            .join("")}</div>`
        : "";

    // Fourth title-block cell. Falls back to an empty cell so the
    // 4-column grid stays fully ruled when a post omits readTime.
    const readTimeBlock = data.readTime
      ? `<div class="tb-cell">
        <span class="tb-label" aria-hidden="true">Read Time</span>
        <span>${escapeHTML(data.readTime)}</span>
      </div>`
      : `<div class="tb-cell" aria-hidden="true"></div>`;

    const body = applyTemplate(postTemplate, {
      label: escapeHTML(data.label || ""),
      title: escapeHTML(data.title || ""),
      summary: escapeHTML(data.summary || ""),
      author: escapeHTML(data.author || ""),
      authorDesc: escapeHTML(data.authorDesc || ""),
      authorInitials: escapeHTML(authorInitials(data.author || "")),
      published: data.published || "",
      publishedFormatted: formatDate(data.published),
      readTimeBlock,
      tagBlock,
      content: html,
    });

    const slug = `/blog/posts/${id}`;
    const canonical = `${SITE_URL}${slug}`;
    const ogImage = data.image ? `${SITE_URL}${data.image}` : `${SITE_URL}/icon-512.png`;
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: data.title,
      description: data.summary,
      author: { "@type": "Person", name: data.author, url: SITE_URL },
      datePublished: data.published,
      image: ogImage,
      url: canonical,
      publisher: { "@type": "Person", name: "Alexander West", url: SITE_URL },
    };

    const page = renderPage({
      frontmatter: {
        title: data.title,
        ogTitle: data.title,
        description: data.summary,
        canonical,
        ogType: "article",
        ogImage: data.image,
        header: "blog",
        bodyClass: "min-h-screen",
        pageScripts: '<script src="/scripts/copy-code.js" defer></script>',
        jsonLd,
      },
      body,
      slug,
    });

    write(join(DIST, "blog/posts", `${id}.html`), page);

    posts.push({ id, ...data });
  }
  posts.sort((a, b) => (a.published < b.published ? 1 : -1));
  return posts;
}

/* ---------------------------------------------------------------- *
 * Blog index                                                        *
 * ---------------------------------------------------------------- */

// Each card reads like a Taste catalog entry: a squircle cover tile beside
// an editorial body — a mono part-number / label / date / read-time line, the
// title, the summary, tags, and a "Read" affordance (see .work-card in
// styles.css). Hover lifts the card and eases the cover in.
function renderPostCard(post, index) {
  const num = String(index + 1).padStart(3, "0");
  const tags = (post.tags || [])
    .map(
      (t) =>
        `<span class="tag inline-flex cursor-pointer items-center rounded-full border border-border px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground transition-colors duration-150 hover:border-accent hover:text-accent" data-tag="${escapeHTML(t)}">${escapeHTML(t)}</span>`
    )
    .join("");

  const metaPieces = [`<span class="text-accent">No. ${num}</span>`];
  if (post.label) metaPieces.push(escapeHTML(post.label));
  metaPieces.push(`<time datetime="${escapeHTML(post.published)}">${formatDate(post.published)}</time>`);
  if (post.readTime) metaPieces.push(escapeHTML(post.readTime));
  const meta = metaPieces.join(`<span class="text-border" aria-hidden="true">|</span>`);

  const tagsAttr = (post.tags || []).map((t) => escapeHTML(t)).join("|");

  const thumb = post.image
    ? `<div class="work-thumb aspect-[16/10] border-b border-border sm:aspect-auto sm:border-b-0 sm:border-r">
    <img src="${escapeHTML(post.image)}" alt="" width="640" height="400" loading="lazy" />
  </div>`
    : "";
  const cols = post.image ? "sm:grid-cols-[210px_1fr]" : "";

  return `
<a href="/blog/posts/${post.id}" class="group post-card work-card block border border-border bg-card/40" data-tags="${tagsAttr}">
  <div class="grid grid-cols-1 ${cols}">
    ${thumb}
    <div class="flex flex-col px-5 py-5 sm:px-7 sm:py-6">
      <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        ${meta}
      </div>
      <h2 class="mt-3 font-display text-xl font-semibold leading-snug tracking-tight text-foreground transition-colors duration-150 group-hover:text-accent sm:text-2xl">${escapeHTML(post.title)}</h2>
      <p class="mt-2.5 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">${escapeHTML(post.summary || "")}</p>
      <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap gap-2">${tags}</div>
        <span class="read-link" aria-hidden="true"><span class="dot"></span>Read</span>
      </div>
    </div>
  </div>
</a>`;
}

function buildBlogIndex(posts) {
  const file = join(SRC, "pages/blog/index.html");
  const raw = read(file);
  const { data, content } = parsePageFrontmatter(raw);

  const allTags = Array.from(new Set(posts.flatMap((p) => p.tags || [])));
  const tagButtons = [
    `<button type="button" class="tag-button active" data-tag="">All Posts</button>`,
    ...allTags.map((t) => `<button type="button" class="tag-button" data-tag="${escapeHTML(t)}">${escapeHTML(t)}</button>`),
  ].join("");

  const cards = posts.map((post, index) => renderPostCard(post, index)).join("\n");

  const body = applyTemplate(content, {
    tagFilter: tagButtons,
    postCards: cards || `<p class="border border-border py-12 text-center font-mono text-sm uppercase tracking-[0.18em] text-muted-foreground">No posts yet.</p>`,
  });

  const html = renderPage({ frontmatter: data, body, slug: "/blog" });
  write(join(DIST, "blog/index.html"), html);
}

/* ---------------------------------------------------------------- *
 * Static assets + sitemap + robots                                  *
 * ---------------------------------------------------------------- */

function copyAssets() {
  const publicDir = join(ROOT, "public");
  if (existsSync(publicDir)) cpSync(publicDir, DIST, { recursive: true });
  const scriptsDir = join(SRC, "scripts");
  if (existsSync(scriptsDir)) cpSync(scriptsDir, join(DIST, "scripts"), { recursive: true });
}

function writeSitemap(posts) {
  const urls = ["/", "/blog", ...posts.map((p) => `/blog/posts/${p.id}`)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITE_URL}${u}</loc></url>`).join("\n")}
</urlset>
`;
  write(join(DIST, "sitemap.xml"), xml);
}

function writeRobots() {
  write(
    join(DIST, "robots.txt"),
    `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`
  );
}

/* ---------------------------------------------------------------- *
 * Run                                                               *
 * ---------------------------------------------------------------- */

async function main() {
  if (existsSync(DIST)) rmSync(DIST, { recursive: true });
  mkdirSync(DIST, { recursive: true });

  const highlighter = await createHighlighter({
    themes: ["github-light-default", "nord"],
    langs: SHIKI_LANGS,
  });
  configureMarked(highlighter);

  buildPages();
  const posts = buildPosts();
  buildBlogIndex(posts);
  copyAssets();
  writeSitemap(posts);
  writeRobots();

  // Crude size summary so the dev sees how cheap this is at a glance.
  let total = 0;
  for (const f of walk(DIST)) total += statSync(f).size;
  console.log(`build: dist/ ready (${posts.length} posts, ${Math.round(total / 1024)}KB on disk)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
