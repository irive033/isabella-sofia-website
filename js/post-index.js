// Dynamically render a grid of blog posts from the live GitHub repo.
// Used by the category pages (beauty.html, wellness.html, style.html) so
// they always show the posts that actually exist — no more hardcoded
// links going stale when posts are deleted or moved between categories.
//
// How it works:
//   1. List every HTML file across posts/beauty/, /lifestyle/, /style/.
//      Folders that don't exist are silently skipped (404 ignored).
//   2. For each file, fetch the raw HTML and pull out title / date /
//      category / header image via regex.
//   3. Filter by the category the caller asked for (or 'all'), sort
//      newest-first by ISO date, and render into the container.
//
// Called from inline scripts at the bottom of each category page:
//   <script>renderPostGrid(el, 'beauty')</script>

(function () {
  const REPO = 'irive033/isabella-sofia-website';
  const BRANCH = 'main';
  const CATEGORIES = ['beauty', 'lifestyle', 'style'];

  // Legacy slug rename guard — any 'wellness' meta tag left over from
  // before the Lifestyle rename gets treated as lifestyle here.
  function normalizeCategorySlug(slug) {
    const s = (slug || '').toLowerCase().trim();
    if (s === 'wellness') return 'lifestyle';
    return s;
  }

  async function listCategoryFolder(cat) {
    try {
      const r = await fetch(
        `https://api.github.com/repos/${REPO}/contents/posts/${cat}?ref=${BRANCH}`,
        { cache: 'no-store' }
      );
      if (!r.ok) return [];
      const files = await r.json();
      return (Array.isArray(files) ? files : [])
        .filter(f => f.type === 'file' && f.name.endsWith('.html'))
        .map(f => ({ folder: cat, name: f.name, path: `posts/${cat}/${f.name}` }));
    } catch (e) {
      return [];
    }
  }

  function parsePostMeta(html) {
    const pick = (pattern) => {
      const m = html.match(pattern);
      return m ? m[1].trim() : '';
    };
    // Prefer <h1> inside .post-header; fall back to the <title> tag's
    // first segment before the " — ".
    const title = pick(/<section[^>]*class=["'][^"']*post-header[^"']*["'][^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i)
               || pick(/<title>([^<]*?)\s*—/i)
               || pick(/<title>([^<]*)<\/title>/i);
    const date = pick(/<meta\s+name=["']date["']\s+content=["']([^"']+)["']/i);
    const rawCategory = pick(/<meta\s+name=["']category["']\s+content=["']([^"']+)["']/i);
    // Header image: check for inline background-image style on .post-header first
    // (that's how header images are saved). Fall back to the first <img> in the
    // post body if no header image was set.
    let image = pick(/class=["']post-header[^"']*["'][^>]*style=["'][^"']*background-image:\s*url\(['"]?([^'")]+)['"]?\)/i);
    if (!image) {
      image = pick(/<section[^>]*class=["'][^"']*post-body[^"']*["'][^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/i);
    }
    if (!image) {
      // Final fallback: any <img> anywhere in the doc (skips header nav icons
      // which are <svg>, so this is safe).
      image = pick(/<img[^>]+src=["']([^"']+)["']/i);
    }
    return {
      title,
      date,
      // Empty string signals "no meta tag" — callers fall back to the
      // folder name. Normalizer only runs when a tag was actually present.
      category: rawCategory ? normalizeCategorySlug(rawCategory) : '',
      image
    };
  }

  // Older posts (pre-editor migration) don't have a <meta name="category">
  // tag. Fall back to the folder they live in so they still show up in the
  // right category grid.
  function effectiveCategory(p) {
    return p.category || p.folder || '';
  }

  async function fetchPostMeta(p) {
    try {
      const r = await fetch(
        `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${p.path}`,
        { cache: 'no-store' }
      );
      if (!r.ok) return null;
      const html = await r.text();
      return { ...p, ...parsePostMeta(html) };
    } catch (e) {
      return null;
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
    ));
  }

  function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function formatDate(isoDate) {
    if (!isoDate) return '';
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Render cards for the given category ('beauty' | 'lifestyle' | 'style' | 'all').
  // Expects the container to already have the .blog-grid class so the existing
  // grid CSS applies to what we render.
  async function renderPostGrid(container, categoryFilter) {
    if (!container) return;
    container.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:#888; font-style:italic;">Loading posts...</div>';
    try {
      // Step 1: listings across all category folders
      const listings = await Promise.all(CATEGORIES.map(listCategoryFolder));
      const files = listings.flat();
      if (files.length === 0) {
        container.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:60px; color:#888; font-style:italic;">No posts yet.</div>';
        return;
      }
      // Step 2: fetch each post's HTML to pull out metadata
      const posts = (await Promise.all(files.map(fetchPostMeta))).filter(Boolean);
      // Step 3: filter + sort
      const filtered = categoryFilter === 'all'
        ? posts
        : posts.filter(p => effectiveCategory(p) === categoryFilter);
      filtered.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

      if (filtered.length === 0) {
        container.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:60px; color:#888; font-style:italic;">No posts in this category yet.</div>';
        return;
      }

      // We're inside /pages/, so the href needs to step up one level to
      // reach the sibling posts/ folder. Absolute paths would work too,
      // but staying relative keeps the site portable.
      container.innerHTML = filtered.map(p => {
        const pretty = p.name.replace(/\.html$/, '').replace(/-/g, ' ').replace(/\bamp\b/g, '&');
        const title = p.title || pretty;
        const dateStr = formatDate(p.date);
        const href = `../${p.path}`;
        const thumb = p.image
          ? `<div class="thumb" style="background-image: url('${escapeAttr(p.image)}'); background-size: cover; background-position: center;"></div>`
          : `<div class="thumb">Image</div>`;
        return `
          <article class="blog-grid-item">
            <a href="${escapeAttr(href)}" class="thumb-link" style="display:block;">
              ${thumb}
            </a>
            <div class="post-info">
              <h3><a href="${escapeAttr(href)}" style="color:inherit; text-decoration:none;">${escapeHtml(title)}</a></h3>
              <div class="meta">Isabella Rivera${dateStr ? ' &middot; ' + dateStr : ''}</div>
              <a href="${escapeAttr(href)}" class="read-more">Read more</a>
            </div>
          </article>
        `;
      }).join('');
    } catch (e) {
      container.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px; color:#c00;">Failed to load posts: ${escapeHtml(e.message)}</div>`;
    }
  }

  // Shared fetch + filter helper used by both the grid and carousel renderers.
  async function getFilteredPosts(categoryFilter, { limit } = {}) {
    const listings = await Promise.all(CATEGORIES.map(listCategoryFolder));
    const files = listings.flat();
    if (files.length === 0) return [];
    const posts = (await Promise.all(files.map(fetchPostMeta))).filter(Boolean);
    const filtered = categoryFilter === 'all'
      ? posts
      : posts.filter(p => effectiveCategory(p) === categoryFilter);
    filtered.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return typeof limit === 'number' ? filtered.slice(0, limit) : filtered;
  }

  // Carousel variant for the homepage. Each item is an <a.carousel-item>
  // with a placeholder div + date + h4 — matching the existing markup so the
  // site's carousel CSS styles it correctly.
  //
  // Options:
  //   basePath — prefix for hrefs. Use '' from index.html (which sits at the
  //     site root), or '../' from pages inside /pages/.
  //   limit    — max number of items to show (defaults to 5).
  async function renderPostCarousel(container, categoryFilter, { basePath = '', limit = 5 } = {}) {
    if (!container) return;
    container.innerHTML = '<div style="padding:30px; color:#888; font-style:italic;">Loading...</div>';
    try {
      const posts = await getFilteredPosts(categoryFilter, { limit });
      if (posts.length === 0) {
        container.innerHTML = '<div style="padding:30px; color:#888; font-style:italic;">No posts yet.</div>';
        return;
      }
      container.innerHTML = posts.map(p => {
        const pretty = p.name.replace(/\.html$/, '').replace(/-/g, ' ').replace(/\bamp\b/g, '&');
        const title = p.title || pretty;
        const dateStr = formatDate(p.date);
        const href = basePath + p.path;
        const thumb = p.image
          ? `<div class="carousel-item-placeholder" style="background-image: url('${escapeAttr(p.image)}'); background-size: cover; background-position: center; color: transparent;"></div>`
          : `<div class="carousel-item-placeholder">Image</div>`;
        return `
          <a href="${escapeAttr(href)}" class="carousel-item">
            ${thumb}
            ${dateStr ? `<div class="date">${escapeHtml(dateStr)}</div>` : ''}
            <h4>${escapeHtml(title)}</h4>
          </a>
        `;
      }).join('');
    } catch (e) {
      container.innerHTML = `<div style="padding:30px; color:#c00;">Failed to load posts: ${escapeHtml(e.message)}</div>`;
    }
  }

  // Expose for use by inline scripts on each page.
  window.renderPostGrid = renderPostGrid;
  window.renderPostCarousel = renderPostCarousel;
})();
