(function () {
  "use strict";

  /* ---------------- constants ---------------- */
  var GENRE_SUGGESTIONS = ["Fiction","Nonfiction","Mystery","Science Fiction","Fantasy","Biography","History","Romance","Poetry","Self-Help","Science","Philosophy","Horror","Classic","Young Adult","Graphic Novel","Memoir","Thriller","Realistic Fiction","Humor","Animal Fiction"];
  var SPINE_COLORS = ["#2F4A3B","#6D2E38","#A8763B","#2B3A55","#4B3350","#1F4A4A","#7A3B2E","#4A4A2B"];
  var BOOK_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none"><path d="M4 4.5c2.2-.9 5-1 8 .3V19c-3-1.3-5.8-1.2-8-.3V4.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M20 4.5c-2.2-.9-5-1-8 .3V19c3-1.3 5.8-1.2 8-.3V4.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';

  function coverUrl(isbn) {
    if (!isbn) return null;
    var clean = String(isbn).replace(/[-\s]/g, "");
    if (!clean) return null;
    return "https://covers.openlibrary.org/b/isbn/" + encodeURIComponent(clean) + "-M.jpg?default=false";
  }

  function hashStr(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
    return Math.abs(h);
  }
  function spineColor(genre) {
    if (!genre) return SPINE_COLORS[0];
    return SPINE_COLORS[hashStr(genre.toLowerCase()) % SPINE_COLORS.length];
  }
  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function uid() {
    return (crypto.randomUUID ? crypto.randomUUID() : "b-" + Date.now() + "-" + Math.random().toString(16).slice(2));
  }
  function showToast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(showToast._h);
    showToast._h = setTimeout(function () { t.classList.remove("show"); }, 2400);
  }

/* ---------------- state ---------------- */
  var books = [];               // local cache of book records
  var usingLocalFallback = false;
  var db = null;                // supabase client (or legacy claude db)
  var currentEditId = null;     // set when editing an existing card
  var localKey = "catalog-books-local-v1";

  /* ---------------- supabase config ----------------
     Fill these in with your own project credentials.
     In Supabase: Project Settings -> API -> Project URL & anon public key.
     The anon key is safe to ship in client code — access is governed by
     Row Level Security policies on the `books` table. */
  var SUPABASE_URL = "https://iwnkpiwmjvjhibgckipp.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3bmtwaXdtanZqaGliZ2NraXBwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwODk4MDgsImV4cCI6MjEwNTY2NTgwOH0.7Z2JzLpnYbEMAELTRcgFPek8de80I6zSnApluoeiXJ8";
  var SUPABASE_TABLE = "books";

  function supabaseConfigured() {
    return SUPABASE_URL.indexOf("YOUR-PROJECT") === -1 &&
           SUPABASE_ANON_KEY.indexOf("YOUR-ANON") === -1 &&
           !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
  }

  function loadSupabaseClient() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase);
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
      s.onload = function () { resolve(window.supabase || null); };
      s.onerror = function () { reject(new Error("supabase client failed to load")); };
      document.head.appendChild(s);
    });
  }

  /* ---------------- persistence ---------------- */
  function loadLocalFallback() {
    try {
      var raw = localStorage.getItem(localKey);
      books = raw ? JSON.parse(raw) : [];
    } catch (e) { books = []; }
    renderAll();
  }
  function saveLocalFallback() {
    try { localStorage.setItem(localKey, JSON.stringify(books)); } catch (e) {}
  }

  function upsertLocalBook(book) {
    var idx = books.findIndex(function (b) { return b.id === book.id; });
    if (idx >= 0) books[idx] = book; else books.push(book);
  }
  function removeLocalBook(id) {
    books = books.filter(function (b) { return b.id !== id; });
  }

  function setSyncNote(text) {
    document.getElementById("syncNote").textContent = text;
  }

  function applyRemoteRows(rows) {
    books = rows.map(function (r) {
      return {
        id: String(r.id),
        title: r.title || "",
        author: r.author || "",
        genre: r.genre || "",
        isbn: r.isbn || "",
        addedAt: r.added_at || r.addedAt || new Date().toISOString()
      };
    });
    renderAll();
  }

  async function initStorage() {
    // 1) Try Supabase if configured
    if (supabaseConfigured()) {
      try {
        var supa = await loadSupabaseClient();
        db = supa.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        var probe = await db.from(SUPABASE_TABLE).select("id", { count: "exact", head: true });
        if (probe.error) throw probe.error;

        setSyncNote("Your library, saved and synced to Supabase.");
        var res = await db.from(SUPABASE_TABLE).select("*").order("added_at", { ascending: true });
        if (res.error) throw res.error;
        applyRemoteRows(res.data || []);

        db.channel("catalog-books-changes")
          .on("postgres_changes", { event: "*", schema: "public", table: SUPABASE_TABLE },
            function () {
              db.from(SUPABASE_TABLE).select("*").order("added_at", { ascending: true })
                .then(function (r2) { if (!r2.error) applyRemoteRows(r2.data || []); });
            })
          .subscribe();
        return;
      } catch (e) {
        db = null;
        usingLocalFallback = true;
        setSyncNote("Couldn't reach Supabase — saving to this browser only. (" + (e && e.message ? e.message : "check your config") + ")");
        loadLocalFallback();
        return;
      }
    }

    // 2) Legacy claude artifact db (kept for backwards compatibility)
    try {
      db = await window.claude.use("db");
    } catch (e) { db = null; }

    if (db) {
      setSyncNote("Your library, saved and synced through this page.");
      try {
        db.collection("books").onSnapshot(function (snapshot) {
          books = (snapshot.docs || snapshot || []).map(function (d) {
            return d.data ? Object.assign({ id: d.id }, d.data()) : d;
          });
          renderAll();
        });
        return;
      } catch (e) { db = null; }
    }

    // 3) Local-only fallback
    usingLocalFallback = true;
    setSyncNote("Saved to this browser only — add your Supabase credentials in script.js to sync.");
    loadLocalFallback();
  }

  async function persistBook(book) {
    if (usingLocalFallback || !db) {
      upsertLocalBook(book);
      saveLocalFallback();
      renderAll();
      return;
    }
    // Supabase path
    if (db.from) {
      var row = {
        id: book.id,
        title: book.title,
        author: book.author,
        genre: book.genre || null,
        isbn: book.isbn || null,
        added_at: book.addedAt
      };
      var res = await db.from(SUPABASE_TABLE).upsert(row, { onConflict: "id" });
      if (res.error) {
        showToast("Couldn't save — try again.");
        return;
      }
      upsertLocalBook(book);
      saveLocalFallback();
      renderAll();
      return;
    }
    // Legacy claude db path
    try {
      await db.collection("books").doc(book.id).set(book);
    } catch (e) {
      showToast("Couldn't save — try again.");
    }
  }

  async function deleteBookById(id) {
    if (usingLocalFallback || !db) {
      removeLocalBook(id);
      saveLocalFallback();
      renderAll();
      return;
    }
    // Supabase path
    if (db.from) {
      var res = await db.from(SUPABASE_TABLE).delete().eq("id", id);
      if (res.error) {
        showToast("Couldn't remove — try again.");
        return;
      }
      removeLocalBook(id);
      saveLocalFallback();
      renderAll();
      return;
    }
    // Legacy claude db path
    try {
      await db.collection("books").doc(id).delete();
    } catch (e) {
      showToast("Couldn't remove — try again.");
    }
  }

  /* ---------------- rendering: grid ---------------- */
  function populateGenreFilter() {
    var sel = document.getElementById("genreFilter");
    var current = sel.value;
    var genres = Array.from(new Set(books.map(function (b) { return b.genre; }).filter(Boolean))).sort();
    sel.innerHTML = '<option value="">All genres</option>' + genres.map(function (g) {
      return '<option value="' + escapeHtml(g) + '">' + escapeHtml(g) + "</option>";
    }).join("");
    if (genres.indexOf(current) >= 0) sel.value = current;
  }

  function matchesFilters(book, query, genre) {
    if (genre && book.genre !== genre) return false;
    if (!query) return true;
    var q = query.toLowerCase();
    return [book.title, book.author, book.genre, book.isbn].some(function (f) {
      return f && f.toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderAll() {
    populateGenreFilter();
    var query = document.getElementById("searchInput").value.trim();
    var genre = document.getElementById("genreFilter").value;
    var filtered = books.filter(function (b) { return matchesFilters(b, query, genre); });
    filtered.sort(function (a, b) { return (a.title || "").localeCompare(b.title || ""); });

    var grid = document.getElementById("grid");
    var countEl = document.getElementById("shelfCount");

    if (books.length === 0) {
      countEl.textContent = "";
      grid.innerHTML = '<div class="empty-state"><h3>The shelf is empty</h3><p>Add your first book to start the catalog.</p></div>';
      return;
    }
    if (filtered.length === 0) {
      countEl.textContent = books.length + (books.length === 1 ? " book on the shelf" : " books on the shelf");
      grid.innerHTML = '<div class="empty-state"><h3>No matches</h3><p>Try a different search or clear the genre filter.</p></div>';
      return;
    }

    countEl.textContent = filtered.length + " of " + books.length + (books.length === 1 ? " book" : " books") + " shown";

    grid.innerHTML = filtered.map(function (b, i) {
      var color = spineColor(b.genre);
      var cover = coverUrl(b.isbn);
      return (
        '<article class="card" data-id="' + b.id + '" tabindex="0" role="button" aria-label="View ' + escapeHtml(b.title || "Untitled") + '" style="--spine:' + color + '; animation-delay:' + Math.min(i * 0.03, 0.4) + 's">' +
          '<div class="card-cover">' +
            '<div class="cover-fallback">' + BOOK_ICON_SVG + '</div>' +
            (cover ? '<img class="cover-img" src="' + cover + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '') +
            '<div class="card-tab mono">' + escapeHtml(b.isbn ? "ISBN " + b.isbn.slice(-6) : "NO ISBN") + "</div>" +
            '<div class="card-actions">' +
              '<button class="icon-btn edit-btn" data-id="' + b.id + '" aria-label="Edit ' + escapeHtml(b.title) + '"><svg viewBox="0 0 20 20" fill="none"><path d="M13.5 3.5l3 3-9 9-3.6.6.6-3.6 9-9z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></button>' +
              '<button class="icon-btn del-btn" data-id="' + b.id + '" aria-label="Remove ' + escapeHtml(b.title) + '"><svg viewBox="0 0 20 20" fill="none"><path d="M4 6h12M8 6V4.5h4V6M6 6l.7 9.5A1 1 0 007.7 16.5h4.6a1 1 0 001-1L14 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
            "</div>" +
          "</div>" +
          '<div class="card-body">' +
            "<h3>" + escapeHtml(b.title || "Untitled") + "</h3>" +
            '<p class="author">' + escapeHtml(b.author || "Unknown author") + "</p>" +
            '<div class="meta-row"><span class="genre-tag">' + escapeHtml(b.genre || "Uncategorized") + "</span></div>" +
          "</div>" +
        "</article>"
      );
    }).join("");

    Array.prototype.forEach.call(grid.querySelectorAll(".edit-btn"), function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        openEditForm(btn.getAttribute("data-id"));
      });
    });
    Array.prototype.forEach.call(grid.querySelectorAll(".del-btn"), function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var b = books.find(function (x) { return x.id === btn.getAttribute("data-id"); });
        if (b && confirm('Remove "' + b.title + '" from the catalog?')) {
          deleteBookById(b.id);
          showToast("Removed from the shelf.");
        }
      });
    });
    Array.prototype.forEach.call(grid.querySelectorAll(".card"), function (card) {
      card.addEventListener("click", function (e) {
        if (e.target.closest(".icon-btn")) return;
        renderBookInfoModal(card.getAttribute("data-id"));
      });
      card.addEventListener("keydown", function (e) {
        if ((e.key === "Enter" || e.key === " ") && !e.target.closest(".icon-btn")) {
          e.preventDefault();
          renderBookInfoModal(card.getAttribute("data-id"));
        }
      });
    });
  }

  /* ---------------- book info popup (click a card) ---------------- */
  function renderBookInfoModal(id) {
    var b = books.find(function (x) { return x.id === id; });
    if (!b) return;
    var color = spineColor(b.genre);
    var cover = coverUrl(b.isbn);
    var added = b.addedAt ? new Date(b.addedAt) : null;
    var addedStr = (added && !isNaN(added.getTime())) ? added.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";

    openModal(
      '<div class="view-book" style="--spine:' + color + '">' +
        '<div class="view-cover">' +
          '<div class="cover-fallback">' + BOOK_ICON_SVG + '</div>' +
          (cover ? '<img class="cover-img" src="' + cover + '" alt="" onerror="this.style.display=\'none\'">' : '') +
        "</div>" +
        '<div class="view-info">' +
          '<h2 id="modalTitle">' + escapeHtml(b.title || "Untitled") + "</h2>" +
          '<p class="view-author">' + escapeHtml(b.author || "Unknown author") + "</p>" +
          '<div class="view-meta-row">' +
            '<span class="genre-tag">' + escapeHtml(b.genre || "Uncategorized") + "</span>" +
            (b.isbn ? '<span class="mono view-isbn">ISBN ' + escapeHtml(b.isbn) + "</span>" : "") +
          "</div>" +
          (addedStr ? '<p class="view-added">Added ' + addedStr + "</p>" : "") +
          '<div class="form-actions">' +
            '<button type="button" class="btn btn-danger" id="viewDeleteBtn">Remove</button>' +
            '<button type="button" class="btn btn-ghost" id="viewCloseBtn">Close</button>' +
            '<button type="button" class="btn btn-primary" id="viewEditBtn">Edit</button>' +
          "</div>" +
        "</div>" +
      "</div>"
    );

    document.getElementById("viewCloseBtn").addEventListener("click", closeModal);
    document.getElementById("viewEditBtn").addEventListener("click", function () { openEditForm(b.id); });
    document.getElementById("viewDeleteBtn").addEventListener("click", function () {
      if (confirm('Remove "' + b.title + '" from the catalog?')) {
        deleteBookById(b.id);
        showToast("Removed from the shelf.");
        closeModal();
      }
    });
  }

  document.getElementById("searchInput").addEventListener("input", renderAll);
  document.getElementById("genreFilter").addEventListener("change", renderAll);

  /* ---------------- modal shell ---------------- */
  var overlay = document.getElementById("overlay");
  var modalBody = document.getElementById("modalBody");
  var activeStream = null;

  function stopScanner() {
    if (activeStream) {
      activeStream.getTracks().forEach(function (t) { t.stop(); });
      activeStream = null;
    }
    if (window._catalogScanTimer) { clearInterval(window._catalogScanTimer); window._catalogScanTimer = null; }
  }

  function closeModal() {
    stopScanner();
    overlay.hidden = true;
    modalBody.innerHTML = "";
    currentEditId = null;
  }
  document.getElementById("modalClose").addEventListener("click", closeModal);
  overlay.addEventListener("click", function (e) { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !overlay.hidden) closeModal(); });

  function openModal(html) {
    modalBody.innerHTML = html;
    overlay.hidden = false;
  }

  document.getElementById("openCreate").addEventListener("click", function () {
    currentEditId = null;
    renderOptionScreen();
  });

  function renderOptionScreen() {
    stopScanner();
    var barcodeDisabled = false; // camera availability checked at click time
    var lookupDisabled = false; // live lookup via Open Library
    openModal(
      '<h2 id="modalTitle">Add a book</h2>' +
      '<p class="modal-sub">Choose how you\'d like to bring in the details.</p>' +
      '<div class="option-list">' +
        '<button class="option-tile" id="optScratch">' +
          '<span class="opt-icon"><svg viewBox="0 0 20 20" fill="none"><path d="M4 3.5h9l3 3V16a1 1 0 01-1 1H4a1 1 0 01-1-1V4.5a1 1 0 011-1z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M7 9h6M7 12h6M7 6h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></span>' +
          '<span><strong>Enter it myself</strong><span>Type in the title, author, and genre by hand.</span></span>' +
        "</button>" +
        '<button class="option-tile" id="optBarcode">' +
          '<span class="opt-icon"><svg viewBox="0 0 20 20" fill="none"><path d="M3 4v12M6 4v12M8.5 4v12M11 4v12M13 4v12M16 4v12" stroke="currentColor" stroke-width="1.3"/></svg></span>' +
          '<span><strong>Scan the barcode</strong><span>Use your camera, then check the details it finds.</span></span>' +
        "</button>" +
        '<button class="option-tile" id="optLookup" ' + (lookupDisabled ? "disabled" : "") + '>' +
          '<span class="opt-icon"><svg viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="5.5" stroke="currentColor" stroke-width="1.4"/><path d="M13.5 13.5L17 17" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></span>' +
          '<span><strong>Search by title, author, or ISBN</strong><span>' + (lookupDisabled ? "Not available in this session." : "Type what you know and fill in the rest.") + '</span></span>' +
        "</button>" +
      "</div>"
    );
    document.getElementById("optScratch").addEventListener("click", function () { renderScratchForm(null); });
    document.getElementById("optBarcode").addEventListener("click", renderBarcodeScreen);
    if (!lookupDisabled) document.getElementById("optLookup").addEventListener("click", renderLookupScreen);
  }

  function openEditForm(id) {
    var b = books.find(function (x) { return x.id === id; });
    if (!b) return;
    currentEditId = id;
    renderScratchForm(b);
  }

  /* ---------------- form: enter manually / edit / review ---------------- */
  function renderScratchForm(prefill, opts) {
    opts = opts || {};
    var isEdit = !!(prefill && prefill.id);
    var title = prefill && prefill.title || "";
    var author = prefill && prefill.author || "";
    var genre = prefill && prefill.genre || "";
    var isbn = prefill && prefill.isbn || "";

    openModal(
      (opts.backLabel ? '<button class="back-link" id="backBtn">‹ ' + escapeHtml(opts.backLabel) + "</button>" : "") +
      '<h2 id="modalTitle">' + (isEdit ? "Edit book" : opts.reviewMode ? "Check the details" : "Enter it myself") + "</h2>" +
      '<p class="modal-sub">' + (opts.reviewMode ? "Here's what turned up — fix anything that's off before saving." : "Fields marked with * are required.") + "</p>" +
      (opts.note ? '<div class="lookup-note">' + opts.note + "</div>" : "") +
      '<form id="bookForm">' +
        '<div class="field"><label for="fTitle">Title *</label><input id="fTitle" type="text" required value="' + escapeHtml(title) + '"></div>' +
        '<div class="field"><label for="fAuthor">Author *</label><input id="fAuthor" type="text" required value="' + escapeHtml(author) + '"></div>' +
        '<div class="field"><label for="fGenre">Genre</label><input id="fGenre" type="text" list="genreOptions" value="' + escapeHtml(genre) + '" placeholder="e.g. Fiction">' +
          '<datalist id="genreOptions">' + GENRE_SUGGESTIONS.map(function (g) { return '<option value="' + g + '">'; }).join("") + "</datalist>" +
        "</div>" +
        '<div class="field"><label for="fIsbn">ISBN</label><input id="fIsbn" type="text" value="' + escapeHtml(isbn) + '" placeholder="Optional"></div>' +
        '<div class="field-error" id="formError" style="display:none;"></div>' +
        '<div class="form-actions">' +
          (isEdit ? '<button type="button" class="btn btn-danger" id="deleteBtn">Remove</button>' : "") +
          '<button type="button" class="btn btn-ghost" id="cancelBtn">Cancel</button>' +
          '<button type="submit" class="btn btn-primary">' + (isEdit ? "Save changes" : "Add to shelf") + "</button>" +
        "</div>" +
      "</form>"
    );

    if (opts.backLabel) {
      document.getElementById("backBtn").addEventListener("click", function () {
        if (opts.onBack) opts.onBack(); else renderOptionScreen();
      });
    }
    document.getElementById("cancelBtn").addEventListener("click", closeModal);
    if (isEdit) {
      document.getElementById("deleteBtn").addEventListener("click", function () {
        if (confirm('Remove "' + prefill.title + '" from the catalog?')) {
          deleteBookById(prefill.id);
          showToast("Removed from the shelf.");
          closeModal();
        }
      });
    }

    document.getElementById("bookForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var t = document.getElementById("fTitle").value.trim();
      var a = document.getElementById("fAuthor").value.trim();
      var g = document.getElementById("fGenre").value.trim();
      var isb = document.getElementById("fIsbn").value.trim();
      var errEl = document.getElementById("formError");
      if (!t || !a) {
        errEl.textContent = "Title and author are needed before this goes on the shelf.";
        errEl.style.display = "block";
        return;
      }
      var book = {
        id: isEdit ? prefill.id : uid(),
        title: t, author: a, genre: g, isbn: isb,
        addedAt: (prefill && prefill.addedAt) || new Date().toISOString()
      };
      persistBook(book);
      showToast(isEdit ? "Changes saved." : '"' + t + '" added to the shelf.');
      closeModal();
    });
  }

  /* ------------- lookup (title / author / isbn -> Open Library) ------------- */
  function renderLookupScreen() {
    openModal(
      '<button class="back-link" id="backBtn">‹ Back</button>' +
      '<h2 id="modalTitle">Search by title, author, or ISBN</h2>' +
      '<p class="modal-sub">Type what you know and I\'ll look it up live in Open Library, then you can check the details before saving.</p>' +
      '<div class="lookup-row">' +
        '<input id="lookupInput" type="text" placeholder="e.g. Kindred by Octavia Butler, or an ISBN">' +
        '<button class="btn btn-primary" id="lookupGo">Look up</button>' +
      "</div>" +
      '<p class="status-line" id="lookupStatus"></p>'
    );
    document.getElementById("backBtn").addEventListener("click", renderOptionScreen);
    var input = document.getElementById("lookupInput");
    input.focus();
    var go = document.getElementById("lookupGo");
    function run() {
      var q = input.value.trim();
      if (!q) return;
      runLookup(q, "Search by title, author, or ISBN");
    }
    go.addEventListener("click", run);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); run(); } });
  }

  async function runLookup(query, backLabel) {
    var statusEl = document.getElementById("lookupStatus");
    var go = document.getElementById("lookupGo");
    if (statusEl) statusEl.innerHTML = '<span class="spinner"></span> Looking that up…';
    if (go) go.disabled = true;

    var cleanIsbn = query.replace(/[-\s]/g, "");
    var looksLikeIsbn = /^(\d{9}[\dXx]|\d{13})$/.test(cleanIsbn);
    var scratchPrefill = { title: looksLikeIsbn ? "" : query, isbn: looksLikeIsbn ? cleanIsbn : "" };

    async function fetchJson(url) {
      var res = await fetch(url);
      if (!res.ok) throw new Error("http " + res.status);
      return res.json();
    }

    function genreFromSubjects(subjects) {
      if (!subjects || !subjects.length) return "";
      var lower = subjects.map(function (s) { return String(s).toLowerCase(); });
      for (var i = 0; i < GENRE_SUGGESTIONS.length; i++) {
        var g = GENRE_SUGGESTIONS[i].toLowerCase();
        for (var j = 0; j < lower.length; j++) {
          if (lower[j] === g || lower[j].indexOf(g) !== -1) return GENRE_SUGGESTIONS[i];
        }
      }
      var first = String(subjects[0]);
      return first.charAt(0).toUpperCase() + first.slice(1);
    }

    function docToCandidate(doc) {
      var isbnList = doc.isbn || [];
      var preferred = "";
      for (var k = 0; k < isbnList.length; k++) {
        if (/^97\d{11}$/.test(isbnList[k])) { preferred = isbnList[k]; break; }
      }
      if (!preferred) preferred = isbnList[0] || "";
      return {
        title: doc.title || doc.title_suggest || "",
        author: (doc.author_name && doc.author_name[0]) || "",
        genre: genreFromSubjects(doc.subject),
        isbn: preferred
      };
    }

    try {
      var candidates = [];

      if (looksLikeIsbn) {
        try {
          // Direct edition lookup by ISBN
          var ed = await fetchJson("https://openlibrary.org/isbn/" + encodeURIComponent(cleanIsbn) + ".json");
          var cand = { title: ed.title || "", author: "", genre: genreFromSubjects(ed.subjects), isbn: cleanIsbn };
          if (ed.authors && ed.authors.length && ed.authors[0].key) {
            try {
              var auth = await fetchJson("https://openlibrary.org" + ed.authors[0].key + ".json");
              cand.author = auth.name || "";
            } catch (eAuth) { /* author optional */ }
          }
          candidates = [cand];
        } catch (eIsbn) {
          // Edition not found — fall back to search-by-ISBN
          var sr = await fetchJson("https://openlibrary.org/search.json?isbn=" + encodeURIComponent(cleanIsbn) + "&fields=title,author_name,subject,isbn&limit=5");
          candidates = (sr.docs || []).map(docToCandidate).filter(function (c) { return c.title || c.author; });
        }
      } else {
        // Title / author / free-text search
        var data = await fetchJson("https://openlibrary.org/search.json?q=" + encodeURIComponent(query) + "&fields=title,author_name,subject,isbn&limit=5");
        candidates = (data.docs || []).map(docToCandidate).filter(function (c) { return c.title || c.author; });
      }

      if (candidates.length === 0) {
        renderScratchForm(scratchPrefill, {
          backLabel: backLabel, onBack: renderOptionScreen,
          note: "Couldn't find that one in Open Library — no trouble, just fill in what you know below."
        });
      } else if (candidates.length === 1) {
        renderReviewForm(candidates[0], backLabel, null);
      } else {
        renderCandidateScreen(candidates, query, backLabel);
      }
    } catch (e) {
      renderScratchForm({ title: scratchPrefill.title, author: "", genre: "", isbn: scratchPrefill.isbn }, {
        backLabel: backLabel, onBack: renderOptionScreen,
        note: "The lookup didn't go through (offline, or the catalog is unreachable) — fill in the details by hand."
      });
    }
  }

  function renderReviewForm(candidate, backLabel, uncertainNote) {
    renderScratchForm(
      { title: candidate.title || "", author: candidate.author || "", genre: candidate.genre || "", isbn: candidate.isbn || "" },
      {
        backLabel: backLabel, onBack: renderOptionScreen, reviewMode: true,
        note: uncertainNote
          ? escapeHtml(uncertainNote) + " Have a look and adjust anything that's off."
          : "Filled in live from Open Library — give it a quick check before saving."
      }
    );
  }

  function renderCandidateScreen(candidates, query, backLabel) {
    openModal(
      '<button class="back-link" id="backBtn">‹ Back</button>' +
      '<h2 id="modalTitle">A few books match "' + escapeHtml(query) + '"</h2>' +
      '<p class="modal-sub">Pick the one you mean — you\'ll get a chance to fix any details next.</p>' +
      '<div class="option-list">' +
        candidates.map(function (c, i) {
          return (
            '<button class="option-tile candidate-tile" data-idx="' + i + '">' +
              '<span class="opt-icon"><svg viewBox="0 0 20 20" fill="none"><path d="M4 3.5h9l3 3V16a1 1 0 01-1 1H4a1 1 0 01-1-1V4.5a1 1 0 011-1z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></span>' +
              '<span><strong>' + escapeHtml(c.title || "Untitled") + '</strong><span>' + escapeHtml(c.author || "Unknown author") + (c.genre ? " · " + escapeHtml(c.genre) : "") + "</span></span>" +
            "</button>"
          );
        }).join("") +
        '<button class="option-tile" id="noneMatch">' +
          '<span class="opt-icon"><svg viewBox="0 0 20 20" fill="none"><path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span>' +
          '<span><strong>None of these</strong><span>Enter the details myself instead.</span></span>' +
        "</button>" +
      "</div>"
    );
    document.getElementById("backBtn").addEventListener("click", renderOptionScreen);
    document.getElementById("noneMatch").addEventListener("click", function () {
      renderScratchForm({ title: query, isbn: "" }, { backLabel: backLabel, onBack: renderOptionScreen });
    });
    Array.prototype.forEach.call(document.querySelectorAll(".candidate-tile"), function (btn) {
      btn.addEventListener("click", function () {
        renderReviewForm(candidates[Number(btn.getAttribute("data-idx"))], backLabel);
      });
    });
  }

  /* ---------------- barcode scanning ---------------- */
  var zxingLoadPromise = null;
  function loadZXing() {
    if (window.ZXing) return Promise.resolve(window.ZXing);
    if (zxingLoadPromise) return zxingLoadPromise;
    zxingLoadPromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/zxing-library/0.20.0/index.min.js";
      s.onload = function () { resolve(window.ZXing || null); };
      s.onerror = function () { reject(new Error("zxing load failed")); };
      document.head.appendChild(s);
    });
    return zxingLoadPromise;
  }

  function renderBarcodeScreen() {
    stopScanner();
    openModal(
      '<button class="back-link" id="backBtn">‹ Back</button>' +
      '<h2 id="modalTitle">Scan the barcode</h2>' +
      '<p class="modal-sub">Line the barcode up in the frame. If your camera won\'t cooperate, you can always type the ISBN in below.</p>' +
      '<div class="scan-wrap" id="scanWrap">' +
        '<video id="scanVideo" playsinline muted></video>' +
        '<div class="scan-frame"></div><div class="scan-line"></div>' +
      "</div>" +
      '<p class="status-line" id="scanStatus"><span class="spinner"></span> Starting camera…</p>' +
      '<div class="lookup-row">' +
        '<input id="manualIsbn" type="text" placeholder="Or type the ISBN here">' +
        '<button class="btn btn-ghost" id="manualIsbnGo">Use this</button>' +
      "</div>"
    );
    document.getElementById("backBtn").addEventListener("click", function () { stopScanner(); renderOptionScreen(); });
    document.getElementById("manualIsbnGo").addEventListener("click", function () {
      var v = document.getElementById("manualIsbn").value.trim();
      if (!v) return;
      stopScanner();
      runLookup(v, "Scan the barcode");
    });
    startScanner();
  }

  async function startScanner() {
    var statusEl = document.getElementById("scanStatus");
    var video = document.getElementById("scanVideo");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      statusEl.innerHTML = "Camera access isn't available here — type the ISBN below instead.";
      return;
    }
    try {
      activeStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    } catch (e) {
      statusEl.innerHTML = "Couldn't get to the camera (permission denied or unavailable) — type the ISBN below instead.";
      return;
    }
    video.srcObject = activeStream;
    await video.play().catch(function () {});
    statusEl.innerHTML = '<span class="spinner"></span> Watching for a barcode…';

    // Prefer the native BarcodeDetector API when present.
    if ("BarcodeDetector" in window) {
      try {
        var detector = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
        window._catalogScanTimer = setInterval(async function () {
          if (!activeStream) return;
          try {
            var codes = await detector.detect(video);
            if (codes && codes.length) {
              var value = codes[0].rawValue;
              stopScanner();
              statusEl.innerHTML = "Found " + escapeHtml(value) + " — looking it up…";
              runLookup(value, "Scan the barcode");
            }
          } catch (e2) { /* keep trying */ }
        }, 400);
        return;
      } catch (e3) { /* fall through to zxing */ }
    }

    // Fallback: ZXing loaded from cdnjs.
    try {
      var ZXing = await loadZXing();
      if (!ZXing || !activeStream) throw new Error("zxing unavailable");
      var reader = new ZXing.BrowserMultiFormatReader();
      window._catalogZxingReader = reader;
      reader.decodeFromVideoElement(video, function (result, err) {
        if (result && activeStream) {
          var value = result.getText();
          reader.reset();
          stopScanner();
          statusEl.innerHTML = "Found " + escapeHtml(value) + " — looking it up…";
          runLookup(value, "Scan the barcode");
        }
      });
    } catch (e4) {
      statusEl.innerHTML = "Barcode scanning isn't available in this browser — type the ISBN below instead.";
    }
  }

  var origStopScanner = stopScanner;
  stopScanner = function () {
    if (window._catalogZxingReader) {
      try { window._catalogZxingReader.reset(); } catch (e) {}
      window._catalogZxingReader = null;
    }
    origStopScanner();
  };

  /* ---------------- boot ---------------- */
  initStorage();
  renderAll();
})();
