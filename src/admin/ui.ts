import type { AppConfig, SessionUser, SiteConfig } from '../types'
import { defaultFilters } from '../types'

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Safe embed of JSON inside a <script> tag (prevents </script> breakout). */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function layout(title: string, body: string, user?: SessionUser | null): string {
  const nav = user
    ? `<div class="nav-user">
        ${user.avatarUrl ? `<img src="${esc(user.avatarUrl)}" alt="" width="28" height="28" />` : ''}
        <span>${esc(user.login)}</span>
        <a href="/auth/logout">Log out</a>
      </div>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <meta http-equiv="Content-Security-Policy" content="frame-ancestors 'none'; default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' https://avatars.githubusercontent.com data:;" />
  <title>${esc(title)}</title>
  <style>
    :root {
      --bg: #0f1412;
      --panel: #1a221e;
      --line: #2d3b34;
      --text: #e8f0eb;
      --muted: #8fa396;
      --accent: #3d9a6a;
      --accent2: #c4a35a;
      --danger: #d4654a;
      --radius: 12px;
      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; background: var(--bg); color: var(--text);
      min-height: 100vh; line-height: 1.45;
    }
    a { color: var(--accent); }
    header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 1rem 1.5rem; border-bottom: 1px solid var(--line);
      background: #121a16;
    }
    header h1 { font-size: 1.05rem; margin: 0; font-weight: 650; letter-spacing: 0.02em; }
    header h1 span { color: var(--accent2); font-weight: 500; }
    .nav-user { display: flex; align-items: center; gap: 0.6rem; font-size: 0.9rem; color: var(--muted); }
    .nav-user img { border-radius: 50%; }
    main { max-width: 1100px; margin: 0 auto; padding: 1.5rem; }
    .card {
      background: var(--panel); border: 1px solid var(--line);
      border-radius: var(--radius); padding: 1.25rem; margin-bottom: 1rem;
    }
    .card h2 { margin: 0 0 0.75rem; font-size: 1.15rem; }
    .muted { color: var(--muted); font-size: 0.9rem; }
    .row { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: end; }
    label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.8rem; color: var(--muted); }
    input, select, textarea {
      background: #0d1210; border: 1px solid var(--line); color: var(--text);
      border-radius: 8px; padding: 0.5rem 0.65rem; font: inherit; min-width: 10rem;
    }
    textarea { min-width: 100%; min-height: 4rem; }
    button, .btn {
      background: var(--accent); color: #04140c; border: none; border-radius: 8px;
      padding: 0.55rem 1rem; font-weight: 650; cursor: pointer; font: inherit;
      text-decoration: none; display: inline-block;
    }
    button.secondary, .btn.secondary { background: transparent; color: var(--text); border: 1px solid var(--line); }
    button.danger { background: var(--danger); color: #fff; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
    th, td { text-align: left; padding: 0.55rem 0.4rem; border-bottom: 1px solid var(--line); vertical-align: top; }
    th { color: var(--muted); font-weight: 600; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; }
    .pill {
      display: inline-block; padding: 0.15rem 0.5rem; border-radius: 999px;
      font-size: 0.75rem; background: #24332b; color: var(--muted);
    }
    .pill.ok { background: #1a3d2c; color: #7dcea0; }
    .pill.err { background: #3d221c; color: #f0a090; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
    @media (max-width: 720px) { .grid-2 { grid-template-columns: 1fr; } }
    .cat-block {
      border: 1px solid var(--line); border-radius: 10px; padding: 1rem; margin-top: 0.75rem;
      background: #141c18;
    }
    .cat-block h3 { margin: 0 0 0.5rem; font-size: 0.95rem; }
    #toast {
      position: fixed; bottom: 1.25rem; right: 1.25rem; background: #24332b;
      border: 1px solid var(--accent); padding: 0.75rem 1rem; border-radius: 10px;
      display: none; max-width: 22rem; z-index: 50; font-size: 0.9rem;
    }
    .login-wrap { max-width: 28rem; margin: 4rem auto; text-align: center; }
    .login-wrap p { color: var(--muted); }
  </style>
</head>
<body>
  <header>
    <h1>Amazon Flash Catalog <span>· admin</span></h1>
    ${nav}
  </header>
  <main>${body}</main>
  <div id="toast"></div>
  <script>
    function toast(msg, isErr) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.style.borderColor = isErr ? 'var(--danger)' : 'var(--accent)';
      el.style.display = 'block';
      setTimeout(() => { el.style.display = 'none'; }, 4500);
    }
    async function api(path, opts) {
      const res = await fetch(path, {
        headers: { 'Content-Type': 'application/json', ...(opts && opts.headers) },
        ...opts,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText || 'Request failed');
      return data;
    }
  </script>
</body>
</html>`
}

export function loginPage(appName: string, error?: string): string {
  const body = `
    <div class="login-wrap card">
      <h2>${esc(appName)}</h2>
      <p>Multi-site Amazon flash catalog control plane. Sign in with GitHub (org members only).</p>
      ${error ? `<p class="pill err">${esc(error)}</p>` : ''}
      <p style="margin-top:1.5rem"><a class="btn" href="/auth/login">Continue with GitHub</a></p>
    </div>`
  return layout('Sign in · Flash Catalog', body, null)
}

export function dashboardPage(
  config: AppConfig,
  user: SessionUser,
  appName: string,
): string {
  const rows =
    config.sites.length === 0
      ? `<tr><td colspan="6" class="muted">No sites yet — create one below.</td></tr>`
      : config.sites
          .map((s) => {
            const status = s.lastError
              ? `<span class="pill err">error</span>`
              : s.lastRunAt
                ? `<span class="pill ok">ok</span>`
                : `<span class="pill">never run</span>`
            return `<tr>
              <td><a href="/admin/sites/${esc(s.id)}"><strong>${esc(s.name)}</strong></a><div class="muted">${esc(s.id)}</div></td>
              <td>${s.enabled ? 'on' : 'off'}</td>
              <td><span class="pill">${esc(s.schedule)}</span></td>
              <td>${s.lastProductCount ?? '—'}</td>
              <td>${s.lastRunAt ? esc(s.lastRunAt.slice(0, 19).replace('T', ' ')) + 'Z' : '—'}</td>
              <td>${status}</td>
            </tr>`
          })
          .join('')

  const body = `
    <div class="card">
      <h2>Sites</h2>
      <p class="muted">Each site has Amazon source categories, filters, optional cron, and an R2 catalog JSON consumers can pull.</p>
      <table>
        <thead>
          <tr>
            <th>Site</th><th>Enabled</th><th>Schedule</th><th>Products</th><th>Last run</th><th>Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="card">
      <h2>Add site</h2>
      <form id="new-site" class="row">
        <label>Site id (slug)
          <input name="id" required pattern="[a-z0-9\\-]{2,48}" placeholder="ibamboo" />
        </label>
        <label>Display name
          <input name="name" required placeholder="iBamboo" />
        </label>
        <label>Site URL (optional)
          <input name="siteUrl" type="url" placeholder="https://ibamboo.com" />
        </label>
        <button type="submit">Create site</button>
      </form>
    </div>
    <script>
      document.getElementById('new-site').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          const data = await api('/api/sites', {
            method: 'POST',
            body: JSON.stringify({
              id: fd.get('id'),
              name: fd.get('name'),
              siteUrl: fd.get('siteUrl') || undefined,
            }),
          });
          toast('Site created');
          location.href = '/admin/sites/' + encodeURIComponent(data.site.id);
        } catch (err) {
          toast(err.message || String(err), true);
        }
      });
    </script>`

  return layout(`${appName} · Sites`, body, user)
}

export function siteEditorPage(
  site: SiteConfig,
  user: SessionUser,
  catalogPath: string,
): string {
  const body = `
    <p class="muted"><a href="/admin">← All sites</a></p>
    <div class="card">
      <h2>${esc(site.name)} <span class="pill">${esc(site.id)}</span></h2>
      <p class="muted">
        Public catalog JSON:
        <a href="${esc(catalogPath)}" target="_blank" rel="noopener">${esc(catalogPath)}</a>
        (also R2 key <code>catalogs/${esc(site.id)}/latest.json</code>)
      </p>
      ${
        site.lastError
          ? `<p class="pill err">Last error: ${esc(site.lastError)}</p>`
          : ''
      }
      <div class="row" style="margin-top:1rem">
        <label>Display name
          <input id="site-name" value="${esc(site.name)}" />
        </label>
        <label>Site URL
          <input id="site-url" value="${esc(site.siteUrl || '')}" />
        </label>
        <label>Enabled
          <select id="site-enabled">
            <option value="true" ${site.enabled ? 'selected' : ''}>Yes</option>
            <option value="false" ${!site.enabled ? 'selected' : ''}>No</option>
          </select>
        </label>
        <label>Schedule
          <select id="site-schedule">
            ${['manual', 'hourly', 'every_6h', 'daily', 'weekly']
              .map(
                (s) =>
                  `<option value="${s}" ${site.schedule === s ? 'selected' : ''}>${s}</option>`,
              )
              .join('')}
          </select>
        </label>
      </div>
      <div class="row" style="margin-top:1rem">
        <button type="button" id="btn-save">Save site settings</button>
        <button type="button" class="secondary" id="btn-run">Run refresh now</button>
        <button type="button" class="danger secondary" id="btn-delete">Delete site</button>
      </div>
      <p id="run-status" class="muted" style="margin-top:0.75rem"></p>
    </div>

    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <h2 style="margin:0">Source categories &amp; filters</h2>
        <button type="button" class="secondary" id="btn-add-cat">+ Add category</button>
      </div>
      <p class="muted">Pick Amazon browse nodes and/or search queries, map to a site shelf, and control filters. Fetch = BSR/search discovery + optional Creators API enrichment.</p>
      <div id="cats"></div>
      <div class="row" style="margin-top:1rem">
        <button type="button" id="btn-save-cats">Save categories</button>
      </div>
    </div>

    <script>
      const siteId = ${jsonForScript(site.id)};
      let categories = ${jsonForScript(site.categories.length ? site.categories : [])};
      const emptyCat = ${jsonForScript({
        id: '',
        label: '',
        browseNode: '',
        searchQuery: '',
        enabled: true,
        siteCategory: '',
        filters: defaultFilters(),
      })};

      function attrEsc(s) {
        return String(s ?? '')
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      }

      function kw(list) { return (list || []).join(', '); }
      function parseKw(s) {
        return String(s || '').split(/[,\\n]/).map(x => x.trim()).filter(Boolean);
      }

      function renderCats() {
        const root = document.getElementById('cats');
        if (!categories.length) {
          root.innerHTML = '<p class="muted">No categories yet.</p>';
          return;
        }
        root.innerHTML = categories.map((c, i) => {
          const f = c.filters || {};
          return \`<div class="cat-block" data-i="\${i}">
            <h3>Category \${i + 1} <button type="button" class="secondary danger rm" data-i="\${i}" style="float:right;padding:0.25rem 0.5rem;font-size:0.8rem">Remove</button></h3>
            <div class="grid-2">
              <label>Source id <input data-f="id" data-i="\${i}" value="\${attrEsc(c.id || '')}" placeholder="kitchen-utensils" /></label>
              <label>Label <input data-f="label" data-i="\${i}" value="\${attrEsc(c.label || '')}" placeholder="Kitchen Utensils" /></label>
              <label>Browse node <input data-f="browseNode" data-i="\${i}" value="\${attrEsc(c.browseNode || '')}" placeholder="289754" /></label>
              <label>Search query <input data-f="searchQuery" data-i="\${i}" value="\${attrEsc(c.searchQuery || '')}" placeholder="bamboo kitchen utensils" /></label>
              <label>Site shelf / category <input data-f="siteCategory" data-i="\${i}" value="\${attrEsc(c.siteCategory || '')}" placeholder="kitchen" /></label>
              <label>Enabled
                <select data-f="enabled" data-i="\${i}">
                  <option value="true" \${c.enabled !== false ? 'selected' : ''}>Yes</option>
                  <option value="false" \${c.enabled === false ? 'selected' : ''}>No</option>
                </select>
              </label>
            </div>
            <p class="muted" style="margin:0.75rem 0 0.35rem">Filters</p>
            <div class="grid-2">
              <label>Top N <input type="number" data-ff="topN" data-i="\${i}" value="\${attrEsc(f.topN ?? 40)}" min="1" max="200" /></label>
              <label>Min rating <input type="number" data-ff="minRating" data-i="\${i}" value="\${attrEsc(f.minRating ?? 0)}" min="0" max="5" step="0.1" /></label>
              <label>Min reviews <input type="number" data-ff="minReviews" data-i="\${i}" value="\${attrEsc(f.minReviews ?? 0)}" min="0" /></label>
              <label>Min price USD <input type="number" data-ff="minPrice" data-i="\${i}" value="\${attrEsc(f.minPrice ?? '')}" step="0.01" placeholder="open" /></label>
              <label>Max price USD <input type="number" data-ff="maxPrice" data-i="\${i}" value="\${attrEsc(f.maxPrice ?? '')}" step="0.01" placeholder="open" /></label>
              <label>Require include keywords
                <select data-ff="requireKeywordMatch" data-i="\${i}">
                  <option value="false" \${!f.requireKeywordMatch ? 'selected' : ''}>No (soft)</option>
                  <option value="true" \${f.requireKeywordMatch ? 'selected' : ''}>Yes (hard)</option>
                </select>
              </label>
              <label style="grid-column:1/-1">Include keywords (comma-separated)
                <input data-ff="includeKeywords" data-i="\${i}" value="\${attrEsc(kw(f.includeKeywords))}" placeholder="bamboo" />
              </label>
              <label style="grid-column:1/-1">Exclude keywords
                <input data-ff="excludeKeywords" data-i="\${i}" value="\${attrEsc(kw(f.excludeKeywords))}" placeholder="plastic, toy" />
              </label>
            </div>
          </div>\`;
        }).join('');

        root.querySelectorAll('.rm').forEach(btn => {
          btn.addEventListener('click', () => {
            categories.splice(Number(btn.dataset.i), 1);
            renderCats();
          });
        });
        root.querySelectorAll('[data-f]').forEach(el => {
          el.addEventListener('change', () => syncFromDom());
          el.addEventListener('input', () => syncFromDom());
        });
        root.querySelectorAll('[data-ff]').forEach(el => {
          el.addEventListener('change', () => syncFromDom());
          el.addEventListener('input', () => syncFromDom());
        });
      }

      function syncFromDom() {
        const next = [];
        document.querySelectorAll('.cat-block').forEach((block) => {
          const i = Number(block.dataset.i);
          const get = (f) => block.querySelector('[data-f="'+f+'"]')?.value;
          const getf = (f) => block.querySelector('[data-ff="'+f+'"]')?.value;
          const minPrice = getf('minPrice');
          const maxPrice = getf('maxPrice');
          next[i] = {
            id: get('id') || ('cat-' + i),
            label: get('label') || '',
            browseNode: get('browseNode') || undefined,
            searchQuery: get('searchQuery') || undefined,
            siteCategory: get('siteCategory') || 'general',
            enabled: get('enabled') !== 'false',
            filters: {
              topN: Number(getf('topN') || 40),
              minRating: Number(getf('minRating') || 0),
              minReviews: Number(getf('minReviews') || 0),
              minPrice: minPrice === '' || minPrice == null ? null : Number(minPrice),
              maxPrice: maxPrice === '' || maxPrice == null ? null : Number(maxPrice),
              includeKeywords: parseKw(getf('includeKeywords')),
              excludeKeywords: parseKw(getf('excludeKeywords')),
              requireKeywordMatch: getf('requireKeywordMatch') === 'true',
            },
          };
        });
        categories = next.filter(Boolean);
      }

      document.getElementById('btn-add-cat').addEventListener('click', () => {
        syncFromDom();
        const c = JSON.parse(JSON.stringify(emptyCat));
        c.id = 'cat-' + (categories.length + 1);
        c.label = 'New category';
        c.siteCategory = 'general';
        categories.push(c);
        renderCats();
      });

      document.getElementById('btn-save').addEventListener('click', async () => {
        try {
          await api('/api/sites/' + encodeURIComponent(siteId), {
            method: 'PUT',
            body: JSON.stringify({
              name: document.getElementById('site-name').value,
              siteUrl: document.getElementById('site-url').value || undefined,
              enabled: document.getElementById('site-enabled').value === 'true',
              schedule: document.getElementById('site-schedule').value,
            }),
          });
          toast('Site settings saved');
        } catch (err) { toast(err.message, true); }
      });

      document.getElementById('btn-save-cats').addEventListener('click', async () => {
        syncFromDom();
        try {
          await api('/api/sites/' + encodeURIComponent(siteId) + '/categories', {
            method: 'PUT',
            body: JSON.stringify({ categories }),
          });
          toast('Categories saved');
        } catch (err) { toast(err.message, true); }
      });

      document.getElementById('btn-run').addEventListener('click', async () => {
        const st = document.getElementById('run-status');
        st.textContent = 'Refreshing… this can take a minute.';
        try {
          const data = await api('/api/sites/' + encodeURIComponent(siteId) + '/refresh', {
            method: 'POST',
            body: '{}',
          });
          st.textContent = data.ok
            ? ('Published ' + (data.catalog && data.catalog.productCount) + ' products.')
            : ('Failed: ' + (data.error || 'unknown'));
          toast(data.ok ? 'Refresh complete' : (data.error || 'Failed'), !data.ok);
          if (data.ok) setTimeout(() => location.reload(), 800);
        } catch (err) {
          st.textContent = err.message;
          toast(err.message, true);
        }
      });

      document.getElementById('btn-delete').addEventListener('click', async () => {
        if (!confirm('Delete site ' + siteId + '? Catalog objects in R2 are kept.')) return;
        try {
          await api('/api/sites/' + encodeURIComponent(siteId), { method: 'DELETE' });
          location.href = '/admin';
        } catch (err) { toast(err.message, true); }
      });

      renderCats();
    </script>`

  return layout(`${site.name} · Flash Catalog`, body, user)
}
