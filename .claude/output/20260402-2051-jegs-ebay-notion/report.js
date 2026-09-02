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


/**
 * Notion-style report interactivity
 * - Theme toggle (light/dark)
 * - Code dialog expand
 * - Copy buttons on code blocks
 * - Width picker for page content
 * - Math rendering (KaTeX)
 * - External links open in new tab
 * - Inline code path coloring
 * - Search filtering with highlight
 * - Scroll-aware nav link activation with auto-scroll
 * - Smooth scroll for anchor links
 */

(function () {
  "use strict";

  // ─── Shared module init ─────────────────────────────────────────────────────
  if (window.__RPT) {
    __RPT.initThemeToggle('.theme-toggle', {
      storageKey: 'notion-theme',
      defaultTheme: 'dark'
    });
    __RPT.initCodeDialog('#code-dialog');
    __RPT.initCopyButtons('.copy-btn');
    __RPT.initWidthPicker('.page', 'notion-width');
    __RPT.openExternalLinks();
    __RPT.initCodePaths();
  }

  // ─── Math init (needs DOMContentLoaded for KaTeX scripts to load) ─────────
  document.addEventListener("DOMContentLoaded", function () {
    if (window.__RPT) {
      __RPT.initMath();
    }
  });

  // ─── DOM refs ──────────────────────────────────────────────────────────────
  const searchInput = document.getElementById("search");
  const searchCount = document.getElementById("search-count");
  const jumpBar = document.getElementById("jump-bar");
  const jumpLinksContainer = document.getElementById("jump-links");
  const cards = document.querySelectorAll(".card");
  const jumpLinks = jumpBar ? jumpBar.querySelectorAll(".jump-links a") : [];

  // ─── Smooth scroll for nav links ──────────────────────────────────────────
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (e) => {
      const id = link.getAttribute("href")?.slice(1);
      if (!id) return;
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      const offset = (jumpBar ? jumpBar.offsetHeight : 0) + 16;
      const top = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: "smooth" });
      history.replaceState(null, "", `#${id}`);
    });
  });

  // ─── Scroll spy: highlight active nav link + auto-scroll into view ────────
  function updateActiveLink() {
    if (!jumpLinks.length) return;
    const offset = (jumpBar ? jumpBar.offsetHeight : 0) + 40;
    let activeId = "";

    cards.forEach((card) => {
      const section = card.querySelector("section[data-section-id]");
      if (!section) return;
      const rect = card.getBoundingClientRect();
      if (rect.top <= offset) {
        activeId = section.getAttribute("data-section-id") || "";
      }
    });

    jumpLinks.forEach((link) => {
      const href = link.getAttribute("href")?.slice(1);
      if (href === activeId) {
        link.classList.add("active");
        // Scroll the nav links container to bring active link into view
        if (jumpLinksContainer) {
          const containerRect = jumpLinksContainer.getBoundingClientRect();
          const linkRect = link.getBoundingClientRect();
          const scrollLeft = jumpLinksContainer.scrollLeft;
          const linkLeft = linkRect.left - containerRect.left + scrollLeft;
          const linkRight = linkLeft + linkRect.width;
          const containerWidth = containerRect.width;

          if (linkLeft < scrollLeft || linkRight > scrollLeft + containerWidth) {
            jumpLinksContainer.scrollTo({
              left: linkLeft - containerWidth / 2 + linkRect.width / 2,
              behavior: "smooth"
            });
          }
        }
      } else {
        link.classList.remove("active");
      }
    });
  }

  let scrollTick = false;
  window.addEventListener("scroll", () => {
    if (!scrollTick) {
      requestAnimationFrame(() => {
        updateActiveLink();
        scrollTick = false;
      });
      scrollTick = true;
    }
  });
  updateActiveLink();

  // ─── Search ───────────────────────────────────────────────────────────────
  let searchTimeout;
  const MARK_CLASS = "search-hit";

  function clearMarks() {
    document.querySelectorAll(`mark.${MARK_CLASS}`).forEach((m) => {
      const parent = m.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(m.textContent || ""), m);
        parent.normalize();
      }
    });
  }

  function highlightText(node, regex) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || "";
      if (!regex.test(text)) return 0;
      regex.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      let count = 0;
      let match;
      while ((match = regex.exec(text)) !== null) {
        if (match.index > last) {
          frag.appendChild(document.createTextNode(text.slice(last, match.index)));
        }
        const mark = document.createElement("mark");
        mark.className = MARK_CLASS;
        mark.textContent = match[0];
        frag.appendChild(mark);
        last = regex.lastIndex;
        count++;
      }
      if (last < text.length) {
        frag.appendChild(document.createTextNode(text.slice(last)));
      }
      if (count > 0 && node.parentNode) {
        node.parentNode.replaceChild(frag, node);
      }
      return count;
    }

    if (
      node.nodeType === Node.ELEMENT_NODE &&
      !/^(script|style|mark|input|textarea)$/i.test(node.tagName)
    ) {
      const children = Array.from(node.childNodes);
      let count = 0;
      for (const child of children) {
        count += highlightText(child, regex);
      }
      return count;
    }
    return 0;
  }

  function doSearch(query) {
    clearMarks();
    const noResults = document.getElementById("no-results");

    if (!query.trim()) {
      cards.forEach((c) => c.classList.remove("search-hidden"));
      if (searchCount) searchCount.textContent = "";
      if (noResults) noResults.classList.remove("visible");
      return;
    }

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escaped})`, "gi");
    let totalHits = 0;
    let visibleCards = 0;

    cards.forEach((card) => {
      const hits = highlightText(card, regex);
      if (hits > 0) {
        card.classList.remove("search-hidden");
        totalHits += hits;
        visibleCards++;
      } else {
        card.classList.add("search-hidden");
      }
    });

    if (searchCount) {
      searchCount.textContent = totalHits > 0 ? `${totalHits} found` : "0 found";
    }
    if (noResults) {
      if (visibleCards === 0) {
        noResults.classList.add("visible");
      } else {
        noResults.classList.remove("visible");
      }
    }
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => doSearch(searchInput.value), 200);
    });

    // Cmd/Ctrl+K to focus search
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
      // Escape to clear search
      if (e.key === "Escape" && document.activeElement === searchInput) {
        searchInput.value = "";
        doSearch("");
        searchInput.blur();
      }
    });
  }
})();
