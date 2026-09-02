/**
 * shared.js — Reusable interactive modules for create-report templates.
 *
 * Attaches to window.__RPT namespace. Templates call only what they need:
 *   __RPT.initThemeToggle('#theme-btn');
 *   __RPT.initSearch('#search', '#search-count', '#no-results', 'section[data-section-id]');
 *   __RPT.initCodeDialog('#code-dialog');
 *   __RPT.initCopyButtons('.copy-btn');
 *   __RPT.initWidthPicker('main.content', 'rpt-width');
 *   __RPT.initMath();
 *   __RPT.openExternalLinks();
 */
(function () {
  "use strict";

  const root = document.documentElement;

  // ── Safe localStorage (file:// may block access) ──────────────────────────
  const store = (() => {
    const mem = Object.create(null);
    try {
      localStorage.setItem("__rpt_test", "1");
      localStorage.removeItem("__rpt_test");
      return localStorage;
    } catch (_) {
      return {
        getItem: (k) => (k in mem ? mem[k] : null),
        setItem: (k, v) => {
          mem[k] = String(v);
        },
        removeItem: (k) => {
          delete mem[k];
        },
      };
    }
  })();

  // ── SVG icons ─────────────────────────────────────────────────────────────
  const SUN_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
  const MOON_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

  // ── Theme Toggle ──────────────────────────────────────────────────────────
  /**
   * @param {string} btnSelector - CSS selector for the toggle button
   * @param {object} opts
   * @param {string} opts.storageKey - localStorage key (default: 'rpt-theme')
   * @param {string} opts.darkClass - class to add for light mode (default: 'light')
   * @param {string} opts.defaultTheme - 'dark' or 'light' (default: 'dark')
   * @param {string} opts.lightLabel - label text for light mode
   * @param {string} opts.darkLabel - label text for dark mode
   */
  function initThemeToggle(btnSelector, opts) {
    opts = Object.assign(
      {
        storageKey: "rpt-theme",
        darkClass: "light",
        defaultTheme: "dark",
        lightLabel: "Light",
        darkLabel: "Dark",
      },
      opts
    );

    var btn = document.querySelector(btnSelector);
    if (!btn) return;

    var saved = store.getItem(opts.storageKey) || opts.defaultTheme;
    if (saved === "light") root.classList.add(opts.darkClass);

    function sync() {
      var isLight = root.classList.contains(opts.darkClass);
      btn.innerHTML = isLight
        ? SUN_SVG + ' <span class="btn-label">' + opts.lightLabel + "</span>"
        : MOON_SVG + ' <span class="btn-label">' + opts.darkLabel + "</span>";
    }
    sync();

    btn.addEventListener("click", function () {
      root.classList.toggle(opts.darkClass);
      store.setItem(
        opts.storageKey,
        root.classList.contains(opts.darkClass) ? "light" : "dark"
      );
      sync();
    });

    return { getTheme: () => (root.classList.contains(opts.darkClass) ? "light" : "dark") };
  }

  // ── Search (Chrome-like: multi-word OR, next/back cycling, match index) ──
  /**
   * Chrome-like find-in-page. Splits query by spaces (OR search), highlights
   * all matching words, provides next/back cycling with index/count display.
   *
   * Expected HTML near the search input:
   *   <input id="search">
   *   <span id="search-count"></span>           ← shows "3 / 12"
   *   <button class="search-prev">▲</button>    ← optional, auto-created if missing
   *   <button class="search-next">▼</button>    ← optional, auto-created if missing
   *
   * @param {string} inputSel
   * @param {string} countSel
   * @param {string} noResultsSel
   * @param {string} sectionSel
   * @param {object} opts
   */
  function initSearch(inputSel, countSel, noResultsSel, sectionSel, opts) {
    opts = Object.assign({ navLinkSel: null, hiddenClass: "hidden-search" }, opts);

    var searchEl = document.querySelector(inputSel);
    var countEl = document.querySelector(countSel);
    var noResultEl = document.querySelector(noResultsSel);
    var allSections = Array.from(document.querySelectorAll(sectionSel));
    if (!searchEl || !allSections.length) return;

    // Auto-create prev/next buttons if not present
    var wrap = searchEl.closest(".search-wrap") || searchEl.parentElement;
    var prevBtn = wrap.querySelector(".search-prev");
    var nextBtn = wrap.querySelector(".search-next");
    if (!prevBtn || !nextBtn) {
      var navContainer = document.createElement("span");
      navContainer.className = "search-nav";
      navContainer.innerHTML =
        '<button class="search-prev" title="Previous (Shift+Enter)">&#9650;</button>' +
        '<button class="search-next" title="Next (Enter)">&#9660;</button>';
      if (countEl && countEl.parentNode) {
        countEl.parentNode.insertBefore(navContainer, countEl.nextSibling);
      } else {
        wrap.appendChild(navContainer);
      }
      prevBtn = navContainer.querySelector(".search-prev");
      nextBtn = navContainer.querySelector(".search-next");
    }

    // State
    var allMarks = [];  // all <mark> elements in document order
    var currentIdx = -1;
    var ACTIVE_CLASS = "search-active";

    function clearMarks() {
      allSections.forEach(function (sec) {
        sec.querySelectorAll("mark").forEach(function (m) {
          var parent = m.parentNode;
          if (parent) parent.replaceChild(document.createTextNode(m.textContent || ""), m);
        });
        sec.normalize();
      });
      allMarks = [];
      currentIdx = -1;
    }

    function addMarksForWord(el, word) {
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      var nodes = [];
      var n;
      while ((n = walker.nextNode())) {
        if (n.parentElement && !n.parentElement.closest("script,style,mark"))
          nodes.push(n);
      }
      nodes.forEach(function (node) {
        var txt = node.textContent || "";
        var lo = txt.toLowerCase();
        if (!lo.includes(word)) return;
        var frag = document.createDocumentFragment();
        var last = 0;
        var idx = lo.indexOf(word, last);
        while (idx !== -1) {
          if (idx > last) frag.appendChild(document.createTextNode(txt.slice(last, idx)));
          var mark = document.createElement("mark");
          mark.textContent = txt.slice(idx, idx + word.length);
          frag.appendChild(mark);
          last = idx + word.length;
          idx = lo.indexOf(word, last);
        }
        if (last < txt.length) frag.appendChild(document.createTextNode(txt.slice(last)));
        if (node.parentNode) node.parentNode.replaceChild(frag, node);
      });
    }

    function updateCount() {
      if (!countEl) return;
      if (allMarks.length === 0) {
        countEl.textContent = "";
        return;
      }
      countEl.textContent = (currentIdx + 1) + " / " + allMarks.length;
    }

    function goToMark(idx) {
      if (allMarks.length === 0) return;
      // Remove active from previous
      if (currentIdx >= 0 && currentIdx < allMarks.length) {
        allMarks[currentIdx].classList.remove(ACTIVE_CLASS);
      }
      currentIdx = ((idx % allMarks.length) + allMarks.length) % allMarks.length;
      var mark = allMarks[currentIdx];
      mark.classList.add(ACTIVE_CLASS);
      mark.scrollIntoView({ behavior: "smooth", block: "center" });
      updateCount();
    }

    function goNext() { goToMark(currentIdx + 1); }
    function goPrev() { goToMark(currentIdx - 1); }

    var timer;
    function doSearch() {
      var raw = (searchEl.value || "").trim().toLowerCase();
      clearMarks();

      if (!raw) {
        allSections.forEach(function (sec) { sec.classList.remove(opts.hiddenClass, "search-reveal"); });
        if (opts.navLinkSel) {
          document.querySelectorAll(opts.navLinkSel).forEach(function (n) { n.classList.remove(opts.hiddenClass); });
        }
        if (noResultEl) noResultEl.style.display = "none";
        updateCount();
        return;
      }

      // Split by spaces for OR search, filter empty
      var words = raw.split(/\s+/).filter(function (w) { return w.length > 0; });

      // For section visibility: a section matches if ANY word is found
      allSections.forEach(function (sec) {
        var text = (sec.textContent || "").toLowerCase();
        var hit = words.some(function (w) { return text.includes(w); });
        sec.classList.toggle(opts.hiddenClass, !hit);
        if (hit) {
          sec.classList.remove("search-reveal");
          void sec.offsetHeight;
          sec.classList.add("search-reveal");
          // Add marks for each word
          words.forEach(function (w) { addMarksForWord(sec, w); });
        }
      });

      // Nav link visibility
      if (opts.navLinkSel) {
        allSections.forEach(function (sec) {
          var id = sec.dataset.sectionId || sec.id || "";
          if (!id) return;
          var link = document.querySelector(opts.navLinkSel + ' a[href="#' + id + '"]');
          var navItem = link && link.closest(opts.navLinkSel);
          if (navItem) navItem.classList.toggle(opts.hiddenClass, sec.classList.contains(opts.hiddenClass));
        });
      }

      // Collect all marks in document order
      allMarks = Array.from(document.querySelectorAll("mark"));

      if (noResultEl) noResultEl.style.display = allMarks.length === 0 ? "block" : "none";

      // Jump to first match
      if (allMarks.length > 0) {
        goToMark(0);
      } else {
        updateCount();
      }
    }

    // Event handlers
    searchEl.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(doSearch, 180);
    });
    searchEl.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        searchEl.value = "";
        doSearch();
        searchEl.blur();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) { goPrev(); } else { goNext(); }
      }
    });
    document.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchEl.focus();
        searchEl.select();
      }
    });

    prevBtn.addEventListener("click", function (e) { e.preventDefault(); goPrev(); });
    nextBtn.addEventListener("click", function (e) { e.preventDefault(); goNext(); });
  }

  // ── Code Dialog ───────────────────────────────────────────────────────────
  /**
   * @param {string} dialogSel - CSS selector for the <dialog> element
   */
  function initCodeDialog(dialogSel) {
    var dialog = document.querySelector(dialogSel);
    if (!dialog) return;

    var dlgLang = dialog.querySelector(".dlg-lang");
    var dlgTitle = dialog.querySelector(".dlg-title");
    var dlgLines = dialog.querySelector(".dlg-lines");
    var dlgBody = dialog.querySelector(".dlg-body");
    var dlgCopy = dialog.querySelector(".dlg-copy");
    var dlgClose = dialog.querySelector(".dlg-close");

    function setupCopy(btn, getText) {
      if (!btn) return;
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var text = getText();
        if (!text) return;
        navigator.clipboard.writeText(text).then(function () {
          btn.textContent = "Copied!";
          btn.classList.add("copied");
          setTimeout(function () {
            btn.textContent = "Copy";
            btn.classList.remove("copied");
          }, 2000);
        });
      });
    }

    function openDialog(wrap) {
      var pre = wrap.querySelector("pre");
      var code = wrap.querySelector("pre code");
      var langEl = wrap.querySelector(".code-lang");
      var lang = langEl ? langEl.textContent : "";
      var lines = (code ? code.textContent || "" : "").split("\n").length;

      if (dlgLang) dlgLang.textContent = lang || "text";
      if (dlgTitle)
        dlgTitle.textContent = lang ? lang + " snippet" : "Code preview";
      if (dlgLines)
        dlgLines.textContent = lines + " line" + (lines !== 1 ? "s" : "");

      if (dlgBody) {
        dlgBody.innerHTML = "";
        if (pre) dlgBody.appendChild(pre.cloneNode(true));
      }

      if (dlgCopy) {
        dlgCopy.textContent = "Copy";
        dlgCopy.classList.remove("copied");
        // Remove old listener by cloning
        var newCopy = dlgCopy.cloneNode(true);
        dlgCopy.parentNode.replaceChild(newCopy, dlgCopy);
        dlgCopy = newCopy;
        dialog.querySelector(".dlg-copy"); // re-query not needed, we have ref
        setupCopy(newCopy, function () {
          return code ? code.textContent || "" : "";
        });
      }

      dialog.showModal();
      if (dlgBody) dlgBody.scrollTop = 0;
    }

    function closeDialog() {
      dialog.setAttribute("data-closing", "");
      dialog.addEventListener(
        "animationend",
        function () {
          dialog.removeAttribute("data-closing");
          dialog.close();
        },
        { once: true }
      );
      // Fallback if no animation
      setTimeout(function () {
        if (dialog.hasAttribute("data-closing")) {
          dialog.removeAttribute("data-closing");
          dialog.close();
        }
      }, 400);
    }

    // Wire expand buttons and pre clicks
    document.querySelectorAll(".code-wrap").forEach(function (wrap) {
      var expandBtn = wrap.querySelector(".code-expand");
      if (expandBtn)
        expandBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          openDialog(wrap);
        });
      // Pre click removed — only expand button opens the dialog
    });

    if (dlgClose) dlgClose.addEventListener("click", closeDialog);
    dialog.addEventListener("click", function (e) {
      var r = dialog.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      ) {
        closeDialog();
      }
    });
    dialog.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeDialog();
      }
    });
  }

  // ── Copy Buttons ──────────────────────────────────────────────────────────
  function initCopyButtons(sel) {
    document.querySelectorAll(sel || ".copy-btn").forEach(function (btn) {
      var wrap = btn.closest(".code-wrap");
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var code = wrap && wrap.querySelector("pre code");
        var text = code ? code.textContent || "" : "";
        if (!text) return;
        navigator.clipboard.writeText(text).then(function () {
          btn.textContent = "Copied!";
          btn.classList.add("copied");
          setTimeout(function () {
            btn.textContent = "Copy";
            btn.classList.remove("copied");
          }, 2000);
        });
      });
    });
  }

  // ── Width Picker ──────────────────────────────────────────────────────────
  var WIDTH_MAP = { sm: "640px", md: "960px", lg: "1200px", xl: "100%" };

  function initWidthPicker(contentSel, storageKey) {
    storageKey = storageKey || "rpt-width";
    var contentEl = document.querySelector(contentSel);
    if (!contentEl) return;

    var active = store.getItem(storageKey) || "md";

    function apply(w) {
      var val = WIDTH_MAP[w] || WIDTH_MAP.md;
      contentEl.style.maxWidth = val;
      active = w;
      store.setItem(storageKey, w);
      document.querySelectorAll(".width-btn").forEach(function (b) {
        b.classList.toggle("active", b.dataset.width === w);
      });
    }
    apply(active);

    document.querySelectorAll(".width-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        apply(btn.dataset.width);
      });
    });

    return { getWidth: function () { return active; } };
  }

  // ── Math (KaTeX) ──────────────────────────────────────────────────────────
  function initMath() {
    if (typeof renderMathInElement !== "undefined") {
      renderMathInElement(document.body, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\\\(", right: "\\\\)", display: false },
          { left: "\\\\[", right: "\\\\]", display: true },
        ],
        throwOnError: false,
      });
    }
  }

  // ── External Links ────────────────────────────────────────────────────────
  function openExternalLinks() {
    document.querySelectorAll('a[href^="http"]').forEach(function (a) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    });
  }

  // ── Inline code path:line coloring ────────────────────────────────────────
  function initCodePaths() {
    var PATH_RE = /^(.+\.[a-z0-9]+):(\d+)$/i;
    document.querySelectorAll("p code, li code, td code").forEach(function (el) {
      var text = el.textContent || "";
      var m = PATH_RE.exec(text.trim());
      if (!m) return;
      el.classList.add("code-path");
      el.innerHTML =
        '<span class="code-path-file">' + m[1] + "</span>" +
        '<span class="code-path-line">:' + m[2] + "</span>";
    });
  }

  // ── Expose namespace ──────────────────────────────────────────────────────
  window.__RPT = {
    store: store,
    initThemeToggle: initThemeToggle,
    initSearch: initSearch,
    initCodeDialog: initCodeDialog,
    initCopyButtons: initCopyButtons,
    initWidthPicker: initWidthPicker,
    initMath: initMath,
    openExternalLinks: openExternalLinks,
    initCodePaths: initCodePaths,
    WIDTH_MAP: WIDTH_MAP,
  };
})();


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

  // ── Page width toggle ───────────────────────────────────────────────────────
  const WIDTH_MAP = { sm: '640px', md: '960px', lg: '1200px', xl: '100%' };
  const contentEl = document.querySelector('main.content');
  let activeWidth = store.getItem('rpt-width') || 'md';

  function applyWidth(w) {
    const val = WIDTH_MAP[w] || WIDTH_MAP.md;
    if (contentEl) contentEl.style.maxWidth = val;
    activeWidth = w;
    store.setItem('rpt-width', w);
    document.querySelectorAll('.width-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.width === w);
    });
  }
  applyWidth(activeWidth);

  document.querySelectorAll('.width-btn').forEach(function (btn) {
    btn.addEventListener('click', function () { applyWidth(btn.dataset.width); });
  });

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

    // Pre click removed — only expand button opens the dialog
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
