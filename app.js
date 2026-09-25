(function () {
  "use strict";
  var bootStatusEl = document.getElementById("bootStatus");
  function setBootStatus(text, isError) {
    if (!bootStatusEl) return;
    if (!text) { bootStatusEl.hidden = true; return; }
    bootStatusEl.hidden = false;
    bootStatusEl.textContent = text;
    bootStatusEl.classList.toggle("boot-status-error", !!isError);
  }
  window.addEventListener("error", function (e) {
    setBootStatus("Script error: " + ((e && e.message) || "unknown"), true);
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    var msg = (r && (r.message || r.error_description || r.msg)) || String(r);
    setBootStatus("Unhandled error: " + msg, true);
  });

  var GENRE_SUGGESTIONS = ["Fiction","Nonfiction","Mystery","Science Fiction","Fantasy","Biography","History","Romance","Poetry","Self-Help","Science","Philosophy","Horror","Classic","Young Adult","Graphic Novel","Memoir","Thriller"];
  var MUSIC_GENRE_SUGGESTIONS = ["Rock","Pop","Hip-Hop","Jazz","Classical","Country","Folk","Electronic","R&B","Metal","Punk","Blues","Reggae","Soundtrack","Children's","Holiday","Comedy","Other"];
  var MUSIC_FORMATS = ["CD","Vinyl","Cassette","Digital","Other"];
  var SPINE_COLORS = ["#2F4A3B","#6D2E38","#A8763B","#2B3A55","#4B3350","#1F4A4A","#7A3B2E","#4A4A2B"];
  var BOOK_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none"><path d="M4 4.5c2.2-.9 5-1 8 .3V19c-3-1.3-5.8-1.2-8-.3V4.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M20 4.5c-2.2-.9-5-1-8 .3V19c3-1.3 5.8-1.2 8-.3V4.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  var DISC_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="12" r="2.2" stroke="currentColor" stroke-width="1.4"/><path d="M12 3.5a8.5 8.5 0 016.8 3.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

  function coverUrl(isbn) {
    if (!isbn) return null;
    var clean = String(isbn).replace(/[-\s]/g, "");
    if (!clean) return null;
    return "https://covers.openlibrary.org/b/isbn/" + encodeURIComponent(clean) + "-M.jpg?default=false";
  }
  function albumCoverUrl(mbid) {
    if (!mbid) return null;
    return "https://coverartarchive.org/release/" + encodeURIComponent(mbid) + "/front-250";
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
  function fetchJson(url, ms) {
    return fetch(url, { signal: AbortSignal.timeout(ms || 12000) }).then(function (res) {
      if (!res.ok) throw new Error("http " + res.status);
      return res.json();
    });
  }

  var books = [];
  var albums = [];
  var viewMode = "books";
  var usingLocalFallback = false;
  var db = null;
  var currentEditId = null;
  var currentEditAlbumId = null;
  var localKey = "catalog-books-local-v1";
  var albumsLocalKey = "catalog-albums-local-v1";
  var currentUser = null;
  var booksChannel = null;
  var albumsChannel = null;

  var SUPABASE_URL = "https://wgyrpvrzafubezcxqrzy.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndneXJwdnJ6YWZ1YmV6Y3hxcnp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxODI2NjYsImV4cCI6MjEwNTc1ODY2Nn0.rGn52ohlPcbKKoiRU3vsd1IrPeE5id6eriDD_JR8jco";
  var SUPABASE_TABLE = "books";
  var SUPABASE_ALBUMS_TABLE = "albums";

  function emailToUsername(email, metaUsername) {
    if (metaUsername) return metaUsername;
    return String(email || "").split("@")[0];
  }
  function loadSupabaseClient() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase);
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error("Timed out loading the account library from cdn.jsdelivr.net (likely blocked by this host's network/CSP)."));
      }, 8000);
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
      s.onload = function () {
        if (settled) return;
        settled = true; clearTimeout(timer);
        resolve(window.supabase || null);
      };
      s.onerror = function () {
        if (settled) return;
        settled = true; clearTimeout(timer);
        reject(new Error("The account library failed to load from cdn.jsdelivr.net (network or CSP blocked it)."));
      };
      document.head.appendChild(s);
    });
  }
  async function connectSupabase() {
    setBootStatus("Loading account library…");
    var supa = await loadSupabaseClient();
    if (!supa || !supa.createClient) throw new Error("Account library loaded but createClient is missing.");
    setBootStatus("Connecting…");
    db = supa.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        fetch: function (url, options) {
          return fetch(url, Object.assign({}, options, { signal: AbortSignal.timeout(15000) }));
        }
      }
    });
  }

  function loadLocalStore(key, into, mapFn) {
    try {
      var raw = localStorage.getItem(key);
      into.length = 0;
      if (raw) {
        var parsed = JSON.parse(raw);
        (Array.isArray(parsed) ? parsed : []).forEach(function (r) { into.push(mapFn ? mapFn(r) : r); });
      }
    } catch (e) { into.length = 0; }
  }
  function saveLocalStore(key, arr) {
    try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {}
  }
  function loadLocalFallback() {
    loadLocalStore(localKey, books);
    loadLocalStore(albumsLocalKey, albums);
    renderAll();
  }
  function saveLocalFallback() {
    saveLocalStore(localKey, books);
    saveLocalStore(albumsLocalKey, albums);
  }
  function upsertLocalBook(book) {
    var idx = books.findIndex(function (b) { return b.id === book.id; });
    if (idx >= 0) books[idx] = book; else books.push(book);
  }
  function removeLocalBook(id) { books = books.filter(function (b) { return b.id !== id; }); }
  function upsertLocalAlbum(album) {
    var idx = albums.findIndex(function (a) { return a.id === album.id; });
    if (idx >= 0) albums[idx] = album; else albums.push(album);
  }
  function removeLocalAlbum(id) { albums = albums.filter(function (a) { return a.id !== id; }); }

  function setSyncNote(text) { document.getElementById("syncNote").textContent = text; }

  function applyRemoteRows(rows) {
    books = rows.map(function (r) {
      return {
        id: String(r.id), title: r.title || "", author: r.author || "",
        genre: r.genre || "", isbn: r.isbn || "", quantity: r.quantity || 1,
        addedAt: r.added_at || r.addedAt || new Date().toISOString()
      };
    });
    renderAll();
  }
  function applyRemoteAlbumRows(rows) {
    albums = rows.map(function (r) {
      return {
        id: String(r.id), title: r.title || "", artist: r.artist || "",
        format: r.format || "", year: r.year || null, genre: r.genre || "",
        tracks: String(r.tracks || "").split("\n").map(function (t) { return t.trim(); }).filter(Boolean),
        mbid: r.mbid || "",
        addedAt: r.added_at || r.addedAt || new Date().toISOString()
      };
    });
    renderAll();
  }

  function setupSql() {
    return "-- The Catalog: full setup (safe to re-run)\n" +
      "create table if not exists public.books (\n" +
      "  id text primary key, title text not null, author text not null,\n" +
      "  genre text, isbn text, quantity int not null default 1,\n" +
      "  added_at timestamptz not null default now(),\n" +
      "  user_id uuid not null references auth.users(id) on delete cascade\n" +
      ");\n" +
      "alter table public.books add column if not exists quantity int not null default 1;\n" +
      "alter table public.books enable row level security;\n" +
      "drop policy if exists \"select own books\" on public.books;\n" +
      "create policy \"select own books\" on public.books for select using (auth.uid() = user_id);\n" +
      "drop policy if exists \"insert own books\" on public.books;\n" +
      "create policy \"insert own books\" on public.books for insert with check (auth.uid() = user_id);\n" +
      "drop policy if exists \"update own books\" on public.books;\n" +
      "create policy \"update own books\" on public.books for update using (auth.uid() = user_id);\n" +
      "drop policy if exists \"delete own books\" on public.books;\n" +
      "create policy \"delete own books\" on public.books for delete using (auth.uid() = user_id);\n" +
      "grant usage on schema public to anon, authenticated;\n" +
      "grant select, insert, update, delete on public.books to anon, authenticated;\n" +
      "alter publication supabase_realtime add table public.books;\n" +
      "create table if not exists public.albums (\n" +
      "  id text primary key, title text not null, artist text not null,\n" +
      "  format text, year int, genre text, tracks text, mbid text, cover text,\n" +
      "  added_at timestamptz not null default now(),\n" +
      "  user_id uuid not null references auth.users(id) on delete cascade\n" +
      ");\n" +
      "alter table public.albums add column if not exists cover text;\n" +
      "alter table public.albums enable row level security;\n" +
      "drop policy if exists \"select own albums\" on public.albums;\n" +
      "create policy \"select own albums\" on public.albums for select using (auth.uid() = user_id);\n" +
      "drop policy if exists \"insert own albums\" on public.albums;\n" +
      "create policy \"insert own albums\" on public.albums for insert with check (auth.uid() = user_id);\n" +
      "drop policy if exists \"update own albums\" on public.albums;\n" +
      "create policy \"update own albums\" on public.albums for update using (auth.uid() = user_id);\n" +
      "drop policy if exists \"delete own albums\" on public.albums;\n" +
      "create policy \"delete own albums\" on public.albums for delete using (auth.uid() = user_id);\n" +
      "grant select, insert, update, delete on public.albums to anon, authenticated;\n" +
      "alter publication supabase_realtime add table public.albums;\n" +
      "notify pgrst, 'reload schema';";
  }

  function diagnoseDbError(e, tableName) {
    var msg = (e && (e.message || e.hint || e.details)) || String(e || "");
    var code = e && e.code ? String(e.code) : "";
    var label = tableName || "books";
    if (/schema|pgrst/i.test(msg) || /schema|pgrst/i.test(code)) {
      return { note: "Supabase's schema cache is stale — run \u201cnotify pgrst, 'reload schema';\u201d in the SQL editor, then reload this page." };
    }
    if (/42P01|does not exist/i.test(msg) || code === "42P01") {
      return { note: "The '" + label + "' table wasn't found — run the setup SQL (printed in the browser console), then reload." };
    }
    if (/42703|column .* does not exist/i.test(msg) || code === "42703") {
      return { note: "The '" + label + "' table is missing a column the app needs. Full setup SQL is in the browser console." };
    }
    if (/42501|permission denied|row-level security/i.test(msg) || code === "42501") {
      return { note: "The database is refusing access (grants/RLS). Fix SQL is printed in the browser console." };
    }
    return { note: "Couldn't reach Supabase — saving to this browser only. (" + msg + ")" };
  }

  async function loadBooksForUser(userId) {
    if (booksChannel) { try { db.removeChannel(booksChannel); } catch (e) {} booksChannel = null; }
    async function fetchBooks() {
      return db.from(SUPABASE_TABLE).select("*").eq("user_id", userId).order("added_at", { ascending: true });
    }
    var res = await fetchBooks();
    if (res.error && /schema/i.test(res.error.message || "")) {
      await new Promise(function (r) { setTimeout(r, 2000); });
      res = await fetchBooks();
    }
    if (res.error) {
      console.warn("The Catalog: books load failed. Setup SQL:\n\n" + setupSql());
      usingLocalFallback = true;
      setSyncNote(diagnoseDbError(res.error, "books").note);
      return false;
    }
    applyRemoteRows(res.data || []);
    booksChannel = db.channel("catalog-books-changes-" + userId)
      .on("postgres_changes", { event: "*", schema: "public", table: SUPABASE_TABLE, filter: "user_id=eq." + userId },
        function () { fetchBooks().then(function (r2) { if (!r2.error) applyRemoteRows(r2.data || []); }); })
      .subscribe();
    return true;
  }

  async function loadAlbumsForUser(userId) {
    if (albumsChannel) { try { db.removeChannel(albumsChannel); } catch (e) {} albumsChannel = null; }
    async function fetchAlbums() {
      return db.from(SUPABASE_ALBUMS_TABLE).select("*").eq("user_id", userId).order("added_at", { ascending: true });
    }
    var res = await fetchAlbums();
    if (res.error && /schema/i.test(res.error.message || "")) {
      await new Promise(function (r) { setTimeout(r, 2000); });
      res = await fetchAlbums();
    }
    if (res.error) {
      console.warn("The Catalog: albums load failed (the 'albums' table is probably not created yet). Setup SQL:\n\n" + setupSql());
      setSyncNote("Music shelf: saving to this browser only until the 'albums' table exists in Supabase (setup SQL is in the browser console).");
      return false;
    }
    applyRemoteAlbumRows(res.data || []);
    albumsChannel = db.channel("catalog-albums-changes-" + userId)
      .on("postgres_changes", { event: "*", schema: "public", table: SUPABASE_ALBUMS_TABLE, filter: "user_id=eq." + userId },
        function () { fetchAlbums().then(function (r2) { if (!r2.error) applyRemoteAlbumRows(r2.data || []); }); })
      .subscribe();
    return true;
  }

  async function loadDataForUser(userId) {
    setSyncNote("Your library, saved and synced to Supabase.");
    var booksOk = await loadBooksForUser(userId);
    if (!booksOk) loadLocalFallback();
  }

  function initLocalOnlyMode() {
    usingLocalFallback = true;
    setSyncNote("Saved to this browser only.");
    loadLocalFallback();
  }

  async function persistBook(book) {
    if (usingLocalFallback || !db) {
      upsertLocalBook(book); saveLocalFallback(); renderAll(); return;
    }
    var row = {
      id: book.id, title: book.title, author: book.author,
      genre: book.genre || null, isbn: book.isbn || null,
      quantity: book.quantity || 1,
      added_at: book.addedAt, user_id: currentUser ? currentUser.id : null
    };
    var res = await db.from(SUPABASE_TABLE).upsert(row, { onConflict: "id" });
    if (res.error) { showToast("Couldn't save — try again."); return; }
    upsertLocalBook(book); saveLocalFallback(); renderAll();
  }

  async function deleteBookById(id) {
    if (usingLocalFallback || !db) {
      removeLocalBook(id); saveLocalFallback(); renderAll(); return;
    }
    var delQuery = db.from(SUPABASE_TABLE).delete().eq("id", id);
    if (currentUser) delQuery = delQuery.eq("user_id", currentUser.id);
    var res = await delQuery;
    if (res.error) { showToast("Couldn't remove — try again."); return; }
    removeLocalBook(id); saveLocalFallback(); renderAll();
  }

  async function persistAlbum(album) {
    if (usingLocalFallback || !db) {
      upsertLocalAlbum(album); saveLocalFallback(); renderAll(); return;
    }
    var row = {
      id: album.id, title: album.title, artist: album.artist,
      format: album.format || null, year: album.year || null,
      genre: album.genre || null, tracks: (album.tracks || []).join("\n"),
      mbid: album.mbid || null,
      added_at: album.addedAt, user_id: currentUser ? currentUser.id : null
    };
    var res = await db.from(SUPABASE_ALBUMS_TABLE).upsert(row, { onConflict: "id" });
    if (res.error) {
      upsertLocalAlbum(album); saveLocalFallback(); renderAll();
      showToast("Saved to this browser — run the setup SQL in Supabase to sync albums.");
      console.warn("The Catalog: album save failed (table missing?). Setup SQL:\n\n" + setupSql());
      return;
    }
    upsertLocalAlbum(album); saveLocalFallback(); renderAll();
  }

  async function deleteAlbumById(id) {
    if (usingLocalFallback || !db) {
      removeLocalAlbum(id); saveLocalFallback(); renderAll(); return;
    }
    var delQuery = db.from(SUPABASE_ALBUMS_TABLE).delete().eq("id", id);
    if (currentUser) delQuery = delQuery.eq("user_id", currentUser.id);
    var res = await delQuery;
    if (res.error) { showToast("Couldn't remove — try again."); return; }
    removeLocalAlbum(id); saveLocalFallback(); renderAll();
  }

  function populateFilterSelect() {
    var sel = document.getElementById("genreFilter");
    var current = sel.value;
    var options;
    if (viewMode === "music") {
      options = MUSIC_FORMATS.map(function (f) { return { value: f, label: f }; });
      sel.setAttribute("aria-label", "Filter by format");
    } else {
      var genres = Array.from(new Set(books.map(function (b) { return b.genre; }).filter(Boolean))).sort();
      options = genres.map(function (g) { return { value: g, label: g }; });
      sel.setAttribute("aria-label", "Filter by genre");
    }
    sel.innerHTML = '<option value="">' + (viewMode === "music" ? "All formats" : "All genres") + "</option>" +
      options.map(function (o) { return '<option value="' + escapeHtml(o.value) + '">' + escapeHtml(o.label) + "</option>"; }).join("");
    if (options.some(function (o) { return o.value === current; })) sel.value = current;
  }

  function matchesBookFilters(book, query, genre) {
    if (genre && book.genre !== genre) return false;
    if (!query) return true;
    var q = query.toLowerCase();
    return [book.title, book.author, book.genre, book.isbn].some(function (f) {
      return f && f.toLowerCase().indexOf(q) !== -1;
    });
  }
  function matchesAlbumFilters(album, query, format) {
    if (format && album.format !== format) return false;
    if (!query) return true;
    var q = query.toLowerCase();
    var hay = [album.title, album.artist, album.genre, album.format, (album.tracks || []).join(" ")];
    return hay.some(function (f) { return f && f.toLowerCase().indexOf(q) !== -1; });
  }

  function renderAll() {
    populateFilterSelect();
    renderBooks();
  }

  function renderBooks() {
    var query = document.getElementById("searchInput").value.trim();
    var genre = document.getElementById("genreFilter").value;
    var filtered = books.filter(function (b) { return matchesBookFilters(b, query, genre); });
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
          (b.quantity > 1 ? '<span class="qty-badge mono" title="' + b.quantity + ' copies">' + b.quantity + "</span>" : "") +
        "</article>"
      );
    }).join("");

    Array.prototype.forEach.call(grid.querySelectorAll(".edit-btn"), function (btn) {
      btn.addEventListener("click", function (e) { e.stopPropagation(); openEditForm(btn.getAttribute("data-id")); });
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

  function formatShort(f) {
    if (!f) return "—";
    if (f === "Vinyl") return "VINYL";
    if (f === "Cassette") return "TAPE";
    if (f === "Digital") return "DIGITAL";
    return f.toUpperCase();
  }

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
          '<div class="qty-row">' +
            '<span class="mono qty-label">Copies:</span>' +
            '<button type="button" class="qty-btn" id="qtyMinus" aria-label="One fewer copy">−</button>' +
            '<span class="mono qty-val" id="qtyVal">' + (b.quantity || 1) + "</span>" +
            '<button type="button" class="qty-btn" id="qtyPlus" aria-label="One more copy">+</button>' +
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
    function adjustQty(delta) {
      var nb = books.find(function (x) { return x.id === b.id; });
      if (!nb) return;
      nb.quantity = Math.max(1, (nb.quantity || 1) + delta);
      persistBook(nb);
      renderBookInfoModal(b.id);
    }
    document.getElementById("qtyMinus").addEventListener("click", function () { adjustQty(-1); });
    document.getElementById("qtyPlus").addEventListener("click", function () { adjustQty(1); });
  }

  /* ---------------- modal shell ---------------- */
  var overlay = document.getElementById("overlay");
  var modalBody = document.getElementById("modalBody");
  var activeStream = null;
  var scannerTarget = "books";

  function stopScanner() {
    if (window._catalogZxingReader) {
      try { window._catalogZxingReader.reset(); } catch (e) {}
      window._catalogZxingReader = null;
    }
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
    currentEditAlbumId = null;
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
    currentEditAlbumId = null;
    renderOptionScreen();
  });
  document.getElementById("searchInput").addEventListener("input", renderAll);
  document.getElementById("genreFilter").addEventListener("change", renderAll);

  /* ---------------- books: add flow ---------------- */
  function renderOptionScreen() {
    stopScanner();
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
        '<button class="option-tile" id="optLookup">' +
          '<span class="opt-icon"><svg viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="5.5" stroke="currentColor" stroke-width="1.4"/><path d="M13.5 13.5L17 17" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></span>' +
          '<span><strong>Search by title, author, or ISBN</strong><span>Type what you know and fill in the rest.</span></span>' +
        "</button>" +
      "</div>"
    );
    document.getElementById("optScratch").addEventListener("click", function () { renderScratchForm(null); });
    document.getElementById("optBarcode").addEventListener("click", function () { scannerTarget = "books"; renderBarcodeScreen(); });
    document.getElementById("optLookup").addEventListener("click", renderLookupScreen);
  }

  function openEditForm(id) {
    var b = books.find(function (x) { return x.id === id; });
    if (!b) return;
    currentEditId = id;
    renderScratchForm(b);
  }

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
      // Duplicate ISBN -> offer to bump the existing book's quantity.
      if (!isEdit && isb) {
        var norm = isb.replace(/[-\s]/g, "");
        var dupe = books.find(function (x) {
          return norm && (x.isbn || "").replace(/[-\s]/g, "") === norm;
        });
        if (dupe) {
          if (confirm('One of this book already exists ("' + dupe.title + '"). Would you like me to up the quantity?')) {
            dupe.quantity = (dupe.quantity || 1) + 1;
            persistBook(dupe);
            showToast('"' + dupe.title + '" — quantity is now ' + dupe.quantity + ".");
          }
          closeModal();
          return;
        }
      }
      var book = {
        id: isEdit ? prefill.id : uid(),
        title: t, author: a, genre: g, isbn: isb,
        quantity: (prefill && prefill.quantity) || 1,
        addedAt: (prefill && prefill.addedAt) || new Date().toISOString()
      };
      persistBook(book);
      showToast(isEdit ? "Changes saved." : '"' + t + '" added to the shelf.');
      closeModal();
    });
  }

  /* ---------------- books: Open Library lookup ---------------- */
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
          var ed = await fetchJson("https://openlibrary.org/isbn/" + encodeURIComponent(cleanIsbn) + ".json");
          var cand = { title: ed.title || "", author: "", genre: genreFromSubjects(ed.subjects), isbn: cleanIsbn };
          if (ed.authors && ed.authors.length && ed.authors[0].key) {
            try {
              var auth = await fetchJson("https://openlibrary.org" + ed.authors[0].key + ".json");
              cand.author = auth.name || "";
            } catch (eAuth) {}
          }
          candidates = [cand];
        } catch (eIsbn) {
          var sr = await fetchJson("https://openlibrary.org/search.json?isbn=" + encodeURIComponent(cleanIsbn) + "&fields=title,author_name,subject,isbn&limit=5");
          candidates = (sr.docs || []).map(docToCandidate).filter(function (c) { return c.title || c.author; });
        }
      } else {
        var data = await fetchJson("https://openlibrary.org/search.json?q=" + encodeURIComponent(query) + "&fields=title,author_name,subject,isbn&limit=5");
        candidates = (data.docs || []).map(docToCandidate).filter(function (c) { return c.title || c.author; });
      }

      if (candidates.length === 0) {
        renderScratchForm(scratchPrefill, {
          backLabel: backLabel, onBack: renderOptionScreen,
          note: "Couldn't find that one in Open Library — no trouble, just fill in what you know below."
        });
      } else if (candidates.length === 1) {
        renderReviewForm(candidates[0], backLabel);
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

  function renderReviewForm(candidate, backLabel) {
    renderScratchForm(
      { title: candidate.title || "", author: candidate.author || "", genre: candidate.genre || "", isbn: candidate.isbn || "" },
      {
        backLabel: backLabel, onBack: renderOptionScreen, reviewMode: true,
        note: "Filled in live from Open Library — give it a quick check before saving."
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
      '<p class="modal-sub">Line the barcode up in the frame. If your camera won\'t cooperate, you can always type the number in below.</p>' +
      '<div class="scan-wrap" id="scanWrap">' +
        '<video id="scanVideo" playsinline muted></video>' +
        '<div class="scan-frame"></div><div class="scan-line"></div>' +
      "</div>" +
      '<p class="status-line" id="scanStatus"><span class="spinner"></span> Starting camera…</p>' +
      '<div class="lookup-row">' +
        '<input id="manualIsbn" type="text" placeholder="Or type the barcode here">' +
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

  function onBarcodeFound(value, statusEl) {
    stopScanner();
    statusEl.innerHTML = "Found " + escapeHtml(value) + " — looking it up…";
    runLookup(value, "Scan the barcode");
  }

  async function startScanner() {
    var statusEl = document.getElementById("scanStatus");
    var video = document.getElementById("scanVideo");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      statusEl.innerHTML = "Camera access isn't available here — type the number below instead.";
      return;
    }
    try {
      activeStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    } catch (e) {
      statusEl.innerHTML = "Couldn't get to the camera (permission denied or unavailable) — type the number below instead.";
      return;
    }
    video.srcObject = activeStream;
    await video.play().catch(function () {});
    statusEl.innerHTML = '<span class="spinner"></span> Watching for a barcode…';

    if ("BarcodeDetector" in window) {
      try {
        var detector = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
        window._catalogScanTimer = setInterval(async function () {
          if (!activeStream) return;
          try {
            var codes = await detector.detect(video);
            if (codes && codes.length) onBarcodeFound(codes[0].rawValue, statusEl);
          } catch (e2) {}
        }, 400);
        return;
      } catch (e3) {}
    }

    try {
      var ZXing = await loadZXing();
      if (!ZXing || !activeStream) throw new Error("zxing unavailable");
      var reader = new ZXing.BrowserMultiFormatReader();
      window._catalogZxingReader = reader;
      reader.decodeFromVideoElement(video, function (result, err) {
        if (result && activeStream) {
          try { reader.reset(); } catch (e) {}
          onBarcodeFound(result.getText(), statusEl);
        }
      });
    } catch (e4) {
      statusEl.innerHTML = "Barcode scanning isn't available in this browser — type the number below instead.";
    }
  }

  /* ---------------- session / boot ---------------- */
  function showApp(user) {
    currentUser = { id: user.id, username: emailToUsername(user.email, user.user_metadata && user.user_metadata.username) };
    setBootStatus("");
    document.getElementById("whoami").textContent = currentUser.username;
    var logoutBtn = document.getElementById("logoutBtn");
    logoutBtn.hidden = false;
    if (!logoutBtn._wired) {
      logoutBtn._wired = true;
      logoutBtn.addEventListener("click", async function () {
        if (db && db.auth) { try { await db.auth.signOut(); } catch (e) {} }
        window.location.href = "login.html";
      });
    }
    usingLocalFallback = false;
    books = [];
    albums = [];
    renderAll();
    loadDataForUser(currentUser.id);
  }

  function showLocalOnly() {
    sessionStorage.setItem("catalogLocalOnly", "1");
    setBootStatus("");
    document.getElementById("whoami").textContent = "";
    document.getElementById("logoutBtn").hidden = true;
    initLocalOnlyMode();
  }

  async function getSessionWithRetries(tries) {
    for (var i = 0; i < tries; i++) {
      try {
        var r = await db.auth.getSession();
        var s = r && r.data && r.data.session;
        if (s && s.user) return s;
      } catch (e) {}
      if (i < tries - 1) await new Promise(function (res) { setTimeout(res, 1200); });
    }
    return null;
  }

  async function boot() {
    if (sessionStorage.getItem("catalogLocalOnly")) {
      showLocalOnly();
      return;
    }
    try {
      await connectSupabase();
      setBootStatus("Checking for an existing session…");
      var session = await getSessionWithRetries(4);
      if (session && session.user) {
        showApp(session.user);
        return;
      }
      setBootStatus("");
      window.location.href = "login.html";
    } catch (e) {
      setBootStatus("Couldn't reach the account service: " + ((e && e.message) || "unknown") + " — use \u201cSkip for now\u201d on the login page to catalog in this browser.");
    }
  }
  boot();
})();
