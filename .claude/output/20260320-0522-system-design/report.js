/* report.js — interactive behaviours for the generated HTML report */
(function () {
  'use strict';

  const root = document.documentElement;

  // ── Safe localStorage (file:// URLs may block access in some browsers) ────────
  const store = (() => {
    const mem = Object.create(null);
    try {
      localStorage.setItem('__rpt_test', '1');
      localStorage.removeItem('__rpt_test');
      return localStorage;
    } catch (_) {
      return {
        getItem:    (k)    => (k in mem ? mem[k] : null),
        setItem:    (k, v) => { mem[k] = String(v); },
        removeItem: (k)    => { delete mem[k]; },
      };
    }
  })();

  // ── Theme toggle ─────────────────────────────────────────────────────────────
  const themeBtn = document.getElementById('theme-btn');

  (function initTheme() {
    const saved = store.getItem('rpt-theme') || 'dark';
    if (saved === 'light') root.classList.add('light');
  })();

  function syncThemeBtn() {
    const isLight = root.classList.contains('light');
    themeBtn.innerHTML = isLight
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
           <circle cx="12" cy="12" r="5"/>
           <line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/>
           <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
           <line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/>
           <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
         </svg> <span class="btn-label">Light</span>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
           <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
         </svg> <span class="btn-label">Dark</span>`;
  }
  syncThemeBtn();

  themeBtn.addEventListener('click', () => {
    root.classList.toggle('light');
    store.setItem('rpt-theme', root.classList.contains('light') ? 'light' : 'dark');
    syncThemeBtn();
  });

  // ── Accent color picker ───────────────────────────────────────────────────────
  const ACCENTS = {
    indigo:  { label: 'Indigo',  rgb: '99, 102, 241',  hex: '#6366f1' },
    violet:  { label: 'Violet',  rgb: '139, 92, 246',  hex: '#8b5cf6' },
    purple:  { label: 'Purple',  rgb: '168, 85, 247',  hex: '#a855f7' },
    fuchsia: { label: 'Fuchsia', rgb: '217, 70, 239',  hex: '#d946ef' },
    pink:    { label: 'Pink',    rgb: '236, 72, 153',   hex: '#ec4899' },
    rose:    { label: 'Rose',    rgb: '244, 63, 94',    hex: '#f43f5e' },
    red:     { label: 'Red',     rgb: '239, 68, 68',    hex: '#ef4444' },
    orange:  { label: 'Orange',  rgb: '249, 115, 22',   hex: '#f97316' },
    amber:   { label: 'Amber',   rgb: '245, 158, 11',   hex: '#f59e0b' },
    yellow:  { label: 'Yellow',  rgb: '234, 179, 8',    hex: '#eab308' },
    lime:    { label: 'Lime',    rgb: '132, 204, 22',   hex: '#84cc16' },
    emerald: { label: 'Emerald', rgb: '16, 185, 129',   hex: '#10b981' },
    teal:    { label: 'Teal',    rgb: '20, 184, 166',   hex: '#14b8a6' },
    cyan:    { label: 'Cyan',    rgb: '6, 182, 212',    hex: '#06b6d4' },
    sky:     { label: 'Sky',     rgb: '14, 165, 233',   hex: '#0ea5e9' },
    blue:    { label: 'Blue',    rgb: '59, 130, 246',   hex: '#3b82f6' },
  };

  function applyAccent(name) {
    const a = ACCENTS[name] || ACCENTS.indigo;
    root.style.setProperty('--accent', a.hex);
    root.style.setProperty('--accent-rgb', a.rgb);
    root.style.setProperty('--accent-dim', `rgba(${a.rgb}, .15)`);
    store.setItem('rpt-accent', name);
    document.querySelectorAll('.color-swatch').forEach((s) =>
      s.classList.toggle('active', s.dataset.accent === name)
    );
    const lbl = document.querySelector('#color-btn .btn-label');
    if (lbl) lbl.textContent = a.label;
  }

  applyAccent(store.getItem('rpt-accent') || 'indigo');

  const colorBtn  = document.getElementById('color-btn');
  const colorMenu = document.getElementById('color-menu');
  if (colorBtn && colorMenu) {
    colorBtn.addEventListener('click', (e) => { e.stopPropagation(); colorMenu.classList.toggle('open'); });
    document.querySelectorAll('.color-swatch').forEach((s) =>
      s.addEventListener('click', () => { applyAccent(s.dataset.accent); colorMenu.classList.remove('open'); })
    );
    document.addEventListener('click', () => colorMenu.classList.remove('open'));
  }

  // ── Font picker ──────────────────────────────────────────────────────────────
  const FONTS = {
    system:       "system-ui, -apple-system, 'Segoe UI', sans-serif",
    inter:        "Inter, system-ui, sans-serif",
    roboto:       "Roboto, system-ui, sans-serif",
    opensans:     "'Open Sans', system-ui, sans-serif",
    source:       "'Source Sans 3', system-ui, sans-serif",
    nunito:       "Nunito, system-ui, sans-serif",
    dmsans:       "'DM Sans', system-ui, sans-serif",
    worksans:     "'Work Sans', system-ui, sans-serif",
    jakarta:      "'Plus Jakarta Sans', system-ui, sans-serif",
    spacegrotesk: "'Space Grotesk', system-ui, sans-serif",
    ibmplex:      "'IBM Plex Sans', system-ui, sans-serif",
    helvetica:    "'Helvetica Neue', Helvetica, Arial, sans-serif",
    verdana:      "Verdana, Geneva, sans-serif",
    georgia:      "Georgia, 'Times New Roman', serif",
    lora:         "Lora, Georgia, serif",
    merriweather: "Merriweather, Georgia, serif",
    playfair:     "'Playfair Display', Georgia, serif",
    palatino:     "Palatino, 'Palatino Linotype', 'Book Antiqua', serif",
    crimson:      "'Crimson Pro', Georgia, serif",
    garamond:     "'EB Garamond', Georgia, serif",
    libre:        "'Libre Baskerville', Georgia, serif",
    mono:         "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    ibmplexmono:  "'IBM Plex Mono', monospace",
  };
  const FONT_LABELS = {
    system: 'System', inter: 'Inter', roboto: 'Roboto', opensans: 'Open Sans',
    source: 'Source Sans', nunito: 'Nunito', dmsans: 'DM Sans', worksans: 'Work Sans',
    jakarta: 'Plus Jakarta Sans', spacegrotesk: 'Space Grotesk', ibmplex: 'IBM Plex Sans',
    helvetica: 'Helvetica', verdana: 'Verdana', georgia: 'Georgia',
    lora: 'Lora', merriweather: 'Merriweather', playfair: 'Playfair Display',
    palatino: 'Palatino', crimson: 'Crimson Pro', garamond: 'EB Garamond',
    libre: 'Libre Baskerville', mono: 'JetBrains Mono', ibmplexmono: 'IBM Plex Mono',
  };

  const fontBtn   = document.getElementById('font-btn');
  const fontMenu  = document.getElementById('font-menu');
  const fontLabel = fontBtn.querySelector('.font-label');
  let activeFont  = store.getItem('rpt-font') || 'system';

  function applyFont(name) {
    root.style.setProperty('--font', FONTS[name] || FONTS.system);
    activeFont = name;
    store.setItem('rpt-font', name);
    document.querySelectorAll('.font-opt').forEach((b) =>
      b.classList.toggle('active', b.dataset.font === name)
    );
    fontLabel.textContent = FONT_LABELS[name] || name;
  }
  applyFont(activeFont);

  fontBtn.addEventListener('click', (e) => { e.stopPropagation(); fontMenu.classList.toggle('open'); });
  document.querySelectorAll('.font-opt').forEach((btn) =>
    btn.addEventListener('click', () => { applyFont(btn.dataset.font); fontMenu.classList.remove('open'); })
  );
  document.addEventListener('click', () => fontMenu.classList.remove('open'));

  // ── Print ─────────────────────────────────────────────────────────────────────
  document.getElementById('print-btn').addEventListener('click', () => window.print());

  // ── External links → new tab ──────────────────────────────────────────────────
  document.querySelectorAll('a[href^="http"]').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });

  // ── Scroll spy ───────────────────────────────────────────────────────────────
  const navLinks = document.querySelectorAll('nav.sidebar a');

  const spyObserver = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      navLinks.forEach((l) => l.classList.remove('active'));
      const link = document.querySelector('nav.sidebar a[href="#' + e.target.id + '"]');
      if (link) { link.classList.add('active'); link.scrollIntoView({ block: 'nearest' }); }
    });
  }, { rootMargin: '-8% 0px -72% 0px' });

  document.querySelectorAll('h2[id], h3[id]').forEach((h) => spyObserver.observe(h));

  // ── Search ───────────────────────────────────────────────────────────────────
  const searchEl    = document.getElementById('search');
  const countEl     = document.getElementById('search-count');
  const noResultEl  = document.getElementById('no-results');
  const allSections = Array.from(document.querySelectorAll('main section[data-section-id]'));

  // Build index once from original DOM text (before any mark mutations)
  const searchIndex = allSections.map((sec) => ({
    el:   sec,
    id:   sec.dataset.sectionId || '',
    text: (sec.textContent || '').toLowerCase(),
  }));

  function clearMarks(el) {
    // Unwrap every mark first, then normalize once — per-mark normalize corrupts
    // the sibling list when multiple marks share the same parent element.
    el.querySelectorAll('mark').forEach((m) => {
      const parent = m.parentNode;
      if (parent) parent.replaceChild(document.createTextNode(m.textContent || ''), m);
    });
    el.normalize();
  }

  function addMarks(el, q) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes  = [];
    let n;
    while ((n = walker.nextNode())) {
      if (n.parentElement && !n.parentElement.closest('script,style,mark')) nodes.push(n);
    }
    nodes.forEach((node) => {
      const txt = node.textContent || '';
      const lo  = txt.toLowerCase();
      if (!lo.includes(q)) return;

      const frag = document.createDocumentFragment();
      let last = 0;
      let idx  = lo.indexOf(q, last);
      while (idx !== -1) {
        if (idx > last) frag.appendChild(document.createTextNode(txt.slice(last, idx)));
        const mark = document.createElement('mark');
        mark.textContent = txt.slice(idx, idx + q.length);
        frag.appendChild(mark);
        last = idx + q.length;
        idx  = lo.indexOf(q, last);
      }
      if (last < txt.length) frag.appendChild(document.createTextNode(txt.slice(last)));
      if (node.parentNode) node.parentNode.replaceChild(frag, node);
    });
  }

  let searchTimer;
  function doSearch() {
    const q = (searchEl.value || '').trim().toLowerCase();
    allSections.forEach((sec) => clearMarks(sec));

    if (!q) {
      allSections.forEach((sec) => sec.classList.remove('hidden-search', 'search-reveal'));
      document.querySelectorAll('nav .nav-section').forEach((n) => n.classList.remove('hidden-search'));
      noResultEl.style.display = 'none';
      countEl.textContent = '';
      return;
    }

    let count = 0;
    searchIndex.forEach(({ el, id, text }) => {
      const hit = text.includes(q);
      el.classList.toggle('hidden-search', !hit);
      if (hit) {
        count++;
        // Restart the reveal animation for each newly-visible section
        el.classList.remove('search-reveal');
        void el.offsetHeight;
        el.classList.add('search-reveal');
        addMarks(el, q);
      }
      if (id) {
        const link = document.querySelector('nav.sidebar a[href="#' + id + '"]');
        const item = link && link.closest('.nav-section.nav-h2');
        if (item) item.classList.toggle('hidden-search', !hit);
      }
    });

    countEl.textContent = count ? `${count} result${count !== 1 ? 's' : ''}` : '';
    noResultEl.style.display = count === 0 ? 'block' : 'none';
  }

  searchEl.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(doSearch, 120); });
  searchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { searchEl.value = ''; doSearch(); searchEl.blur(); }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); searchEl.focus(); searchEl.select(); }
  });

  // ── Copy buttons (inline, in code blocks) ────────────────────────────────────
  function setupCopyBtn(btn, getCode) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = getCode();
      if (!text) return;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
          btn.textContent = '✓ Copied';
          btn.classList.add('copied');
          setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
        });
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
    });
  }

  document.querySelectorAll('.copy-btn').forEach((btn) => {
    const wrap = btn.closest('.code-wrap');
    setupCopyBtn(btn, () => (wrap && wrap.querySelector('pre code') || { textContent: '' }).textContent || '');
  });

  // ── Code preview dialog ──────────────────────────────────────────────────────
  const dialog     = document.getElementById('code-dialog');
  const dlgLang    = dialog.querySelector('.dlg-lang');
  const dlgTitle   = dialog.querySelector('.dlg-title');
  const dlgLines   = dialog.querySelector('.dlg-lines');
  const dlgBody    = dialog.querySelector('.dlg-body');
  const dlgCopy    = dialog.querySelector('.dlg-copy');
  const dlgClose   = dialog.querySelector('.dlg-close');

  function openDialog(wrap) {
    const pre   = wrap.querySelector('pre');
    const code  = wrap.querySelector('pre code');
    const lang  = wrap.querySelector('.code-lang')?.textContent || '';
    const lines = (code?.textContent || '').split('\n').length;

    dlgLang.textContent  = lang || 'text';
    dlgTitle.textContent = lang ? `${lang} snippet` : 'Code preview';
    dlgLines.textContent = `${lines} line${lines !== 1 ? 's' : ''}`;

    // Clone the pre/code so we keep syntax highlighting
    dlgBody.innerHTML = '';
    if (pre) dlgBody.appendChild(pre.cloneNode(true));

    // Wire dialog copy button
    dlgCopy.textContent = 'Copy';
    dlgCopy.classList.remove('copied');
    setupCopyBtn(dlgCopy, () => code?.textContent || '');

    dialog.showModal();
    dlgBody.scrollTop = 0;
  }

  document.querySelectorAll('.code-wrap').forEach((wrap) => {
    // Expand button in header
    const expandBtn = wrap.querySelector('.code-expand');
    if (expandBtn) expandBtn.addEventListener('click', (e) => { e.stopPropagation(); openDialog(wrap); });

    // Click anywhere on pre also opens dialog
    const pre = wrap.querySelector('pre');
    if (pre) pre.addEventListener('click', () => openDialog(wrap));
  });

  function closeDialog() {
    // Play the close animation (data-closing CSS keyframe), then actually close
    // the <dialog> element. Without this, calling dialog.close() synchronously
    // would remove [open] before the animation runs, making it invisible.
    dialog.setAttribute('data-closing', '');
    dialog.addEventListener('animationend', () => {
      dialog.removeAttribute('data-closing');
      dialog.close();
    }, { once: true });
  }

  dlgClose.addEventListener('click', closeDialog);
  dialog.addEventListener('click', (e) => {
    // e.target === dialog is unreliable for backdrop clicks across browsers;
    // bounding rect is the safe cross-browser approach.
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
      closeDialog();
    }
  });
  // Intercept native Escape handling so the close animation plays
  dialog.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeDialog(); } });

  // ── Inline code path:line-no coloring ────────────────────────────────────────
  // Detects inline <code> elements whose text matches "path/file.ext:123" and
  // re-renders them with separate spans for the file path and line number parts.
  // Only runs on inline code (inside p, li, td) — not on pre>code blocks.
  (function colorCodePaths() {
    // Matches: anything ending in .ext:digits, e.g. "src/foo.ts:42" or "foo.tsx:123"
    const PATH_RE = /^(.+\.[a-z0-9]+):(\d+)$/i;
    document.querySelectorAll('p code, li code, td code').forEach((el) => {
      const text = el.textContent || '';
      const m = PATH_RE.exec(text.trim());
      if (!m) return;
      el.classList.add('code-path');
      el.innerHTML =
        `<span class="code-path-file">${m[1]}</span>` +
        `<span class="code-path-line">:${m[2]}</span>`;
    });
  })();
})();
