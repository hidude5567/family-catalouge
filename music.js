(function () {
  "use strict";

  /* ---------------- constants & utils ---------------- */
  var MUSIC_FORMATS = ["CD","Vinyl","Cassette","Digital","Other"];
  var MUSIC_GENRE_SUGGESTIONS = ["Rock","Pop","Hip-Hop","Jazz","Classical","Country","Folk","Electronic","R&B","Metal","Punk","Blues","Reggae","Soundtrack","Children's","Holiday","Comedy","Other"];
  var SPINE_COLORS = ["#C98A4B","#8A5A8E","#4B7A6D","#A85454","#5A7AB0","#B08A3C","#7A6AA8","#4B8A9E"];
  var DISC_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="12" r="2.2" stroke="currentColor" stroke-width="1.4"/><path d="M12 3.5a8.5 8.5 0 016.8 3.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

  function albumCoverUrl(album) {
    if (!album) return null;
    return album.cover || null;
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
    return (crypto.randomUUID ? crypto.randomUUID() : "a-" + Date.now() + "-" + Math.random().toString(16).slice(2));
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
  function fetchDiscogs(path, ms) {
    if (DISCOGS_PROXY) {
      // proxy mode: server holds the token; only /database/search and
      // /releases/* are allowed through. Supabase verifies JWT on edge
      // functions by default, so we send the project's anon key (which is
      // already public in this file — it's meant for browsers).
      return fetch(DISCOGS_PROXY + "?path=" + encodeURIComponent(path), {
        headers: { Authorization: "Bearer " + SUPABASE_ANON_KEY },
        signal: AbortSignal.timeout(ms || 15000)
      }).then(function (res) {
        if (!res.ok) throw new Error("proxy http " + res.status);
        return res.json();
      });
    }
    var headers = { "User-Agent": "FamilyCatalog/1.0" };
    if (DISCOGS_TOKEN) headers["Authorization"] = "Discogs token=" + DISCOGS_TOKEN;
    return fetch(DISCOGS_API + path, {
      headers: headers,
      signal: AbortSignal.timeout(ms || 15000)
    }).then(function (res) {
      if (res.status === 401) throw new Error("discogs token missing or invalid");
      if (!res.ok) throw new Error("http " + res.status);
      return res.json();
    });
  }
  function discogsConfigured() {
    return !!(DISCOGS_PROXY || DISCOGS_TOKEN);
  }

  /* ---------------- state ---------------- */
  var albums = [];
  var usingLocalFallback = false;
  var db = null;
  var currentEditAlbumId = null;
  var localKey = "catalog-albums-local-v1";
  var currentUser = null;
  var albumsChannel = null;

  /* ---------------- discogs config ----------------
     Discogs' database search requires a personal access token (browser
     apps can't do their OAuth flow without a server). Getting one is free
     and takes ~3 minutes:
       1. Log in at discogs.com
       2. Go to discogs.com/settings/developers
       3. Click "Generate token"
       4. Paste it between the quotes below
     One token serves the whole family app. Without it, album lookup is
     disabled (manual entry still works). */
  /* Two ways to reach Discogs:
     (A) PROXY (recommended for a public app): one token lives on the
         server, everyone shares it. Deploy the edge function described
         in the README notes, paste its URL below.
     (B) DIRECT: each user pastes their own token. Only sensible for
         personal use. */
  var DISCOGS_PROXY = "https://wgyrpvrzafubezcxqrzy.supabase.co/functions/v1/discogs-proxy";
  var DISCOGS_TOKEN = "";
  var DISCOGS_API = "https://api.discogs.com";

  var SUPABASE_URL = "https://wgyrpvrzafubezcxqrzy.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndneXJwdnJ6YWZ1YmV6Y3hxcnp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxODI2NjYsImV4cCI6MjEwNTc1ODY2Nn0.rGn52ohlPcbKKoiRU3vsd1IrPeE5id6eriDD_JR8jco";
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
        reject(new Error("Timed out loading the account library."));
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
        reject(new Error("The account library failed to load."));
      };
      document.head.appendChild(s);
    });
  }
  async function connectSupabase() {
    var supa = await loadSupabaseClient();
    if (!supa || !supa.createClient) throw new Error("Account library loaded but createClient is missing.");
    db = supa.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        fetch: function (url, options) {
          return fetch(url, Object.assign({}, options, { signal: AbortSignal.timeout(15000) }));
        }
      }
    });
  }

  /* ---------------- local storage ---------------- */
  function loadLocalFallback() {
    try {
      var raw = localStorage.getItem(localKey);
      albums = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(albums)) albums = [];
    } catch (e) { albums = []; }
    renderAll();
  }
  function saveLocalFallback() {
    try { localStorage.setItem(localKey, JSON.stringify(albums)); } catch (e) {}
  }
  function upsertLocalAlbum(album) {
    var idx = albums.findIndex(function (a) { return a.id === album.id; });
    if (idx >= 0) albums[idx] = album; else albums.push(album);
  }
  function removeLocalAlbum(id) { albums = albums.filter(function (a) { return a.id !== id; }); }

  function setSyncNote(text) { document.getElementById("syncNote").textContent = text; }

  function applyRemoteAlbumRows(rows, keepLocalIds) {
    if (!Array.isArray(rows)) return; // never blank the shelf on a bad payload
    var cloudIds = {};
    albums = rows.map(function (r) {
      cloudIds[String(r.id)] = true;
      return {
        id: String(r.id), title: r.title || "", artist: r.artist || "",
        format: r.format || "", year: r.year || null, genre: r.genre || "",
        tracks: String(r.tracks || "").split("\n").map(function (t) { return t.trim(); }).filter(Boolean),
        mbid: r.mbid || "",
        cover: r.cover || "",
        addedAt: r.added_at || r.addedAt || new Date().toISOString()
      };
    });
    // keep albums that only exist in this browser so nothing ever disappears
    if (keepLocalIds && keepLocalIds.length) {
      keepLocalIds.forEach(function (a) { if (!cloudIds[a.id]) albums.push(a); });
    }
    saveLocalFallback();
    renderAll();
  }

  async function loadAlbumsForUser(userId) {
    if (albumsChannel) { try { db.removeChannel(albumsChannel); } catch (e) {} albumsChannel = null; }
    async function fetchAlbums() {
      return db.from(SUPABASE_ALBUMS_TABLE).select("*").eq("user_id", userId).order("added_at", { ascending: true });
    }
    // Whatever happens below, this page never ends up blank: local copies
    // render immediately, and a failed cloud fetch degrades to a note.
    try {
      renderAll();
    } catch (e) {}
    var localOnly = albums.slice();
    var res;
    try {
      res = await fetchAlbums();
    } catch (netErr) {
      res = { error: { message: String((netErr && netErr.message) || "network") } };
    }
    if (res.error && (/schema|Failed to fetch|network|timeout/i.test(res.error.message || ""))) {
      await new Promise(function (r) { setTimeout(r, 2000); });
      try {
        res = await fetchAlbums();
      } catch (netErr2) {
        res = { error: { message: String((netErr2 && netErr2.message) || "network") } };
      }
    }
    if (res.error) {
      usingLocalFallback = true;
      console.warn("The Catalog: albums sync unavailable (" + (res.error.message || "unknown") + ") — keeping browser copies.");
      setSyncNote("Saved to this browser (cloud sync unavailable for albums — check the 'albums' table exists in Supabase).");
      saveLocalFallback();
      renderAll();
      return;
    }
    usingLocalFallback = false;
    setSyncNote("Your music shelf, saved and synced to Supabase.");
    applyRemoteAlbumRows(res.data || [], localOnly);
    albumsChannel = db.channel("catalog-albums-changes-" + userId)
      .on("postgres_changes", { event: "*", schema: "public", table: SUPABASE_ALBUMS_TABLE, filter: "user_id=eq." + userId },
        function () {
          fetchAlbums().then(function (r2) {
            if (!r2.error) applyRemoteAlbumRows(r2.data || [], localSnapshot());
          }).catch(function () {});
        })
      .subscribe();
  }

  // small helper: current in-memory list, used to preserve browser-only
  // albums when a realtime refresh partially fails
  function localSnapshot() {
    return albums.slice();
  }

  async function persistAlbum(album) {
    upsertLocalAlbum(album);
    saveLocalFallback();
    renderAll();
    if (usingLocalFallback || !db) return;
    var row = {
      id: album.id, title: album.title, artist: album.artist,
      format: album.format || null, year: album.year || null,
      genre: album.genre || null, tracks: (album.tracks || []).join("\n"),
      mbid: album.mbid || null,
      added_at: album.addedAt, user_id: currentUser ? currentUser.id : null
    };
    var res = await db.from(SUPABASE_ALBUMS_TABLE).upsert(row, { onConflict: "id" });
    if (res.error) {
      console.warn("The Catalog: album sync failed — kept in this browser.");
      setSyncNote("Saved to this browser (cloud sync for albums failed — is the 'albums' table set up in Supabase?).");
    }
  }

  async function deleteAlbumById(id) {
    removeLocalAlbum(id);
    saveLocalFallback();
    renderAll();
    if (usingLocalFallback || !db) return;
    var delQuery = db.from(SUPABASE_ALBUMS_TABLE).delete().eq("id", id);
    if (currentUser) delQuery = delQuery.eq("user_id", currentUser.id);
    await delQuery;
  }

  /* ---------------- rendering ---------------- */
  function populateFormatFilter() {
    var sel = document.getElementById("formatFilter");
    sel.innerHTML = '<option value="">All formats</option>' + MUSIC_FORMATS.map(function (f) {
      return '<option value="' + f + '">' + f + "</option>";
    }).join("");
  }

  function matchesAlbumFilters(album, query, format) {
    if (format && album.format !== format) return false;
    if (!query) return true;
    var q = query.toLowerCase();
    var hay = [album.title, album.artist, album.genre, album.format, (album.tracks || []).join(" ")];
    return hay.some(function (f) { return f && f.toLowerCase().indexOf(q) !== -1; });
  }


  /* Cover images on filtered networks often start loading then get their
     connection reset (load-then-disappear). Retry a few times before
     giving up on the placeholder icon. */
  function armCoverImages(root) {
    Array.prototype.forEach.call(root.querySelectorAll(".cover-img"), function (img) {
      if (img._armed) return;
      img._armed = true;
      var tries = 0;
      img.addEventListener("error", function () {
        tries++;
        if (tries < 3 && img.src) {
          setTimeout(function () {
            img.src = img.src.split("#")[0] + "#retry" + tries;
          }, 900 * tries);
        } else {
          img.style.display = "none";
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

  function renderAll() {
    var query = document.getElementById("searchInput").value.trim();
    var format = document.getElementById("formatFilter").value;
    var filtered = albums.filter(function (a) { return matchesAlbumFilters(a, query, format); });
    filtered.sort(function (a, b) { return (a.title || "").localeCompare(b.title || ""); });

    var grid = document.getElementById("grid");
    var countEl = document.getElementById("shelfCount");

    if (albums.length === 0) {
      countEl.textContent = "";
      grid.innerHTML = '<div class="empty-state"><h3>No albums yet</h3><p>Add your first CD or record — track lists included — to start the music shelf.</p></div>';
      return;
    }
    if (filtered.length === 0) {
      countEl.textContent = albums.length + (albums.length === 1 ? " album in the collection" : " albums in the collection");
      grid.innerHTML = '<div class="empty-state"><h3>No matches</h3><p>Try a different search — song titles count too.</p></div>';
      return;
    }
    countEl.textContent = filtered.length + " of " + albums.length + (albums.length === 1 ? " album" : " albums") + " shown";

    grid.innerHTML = filtered.map(function (a, i) {
      var color = spineColor(a.genre || a.format);
      var cover = albumCoverUrl(a);
      return (
        '<article class="card" data-id="' + a.id + '" tabindex="0" role="button" aria-label="View ' + escapeHtml(a.title || "Untitled") + '" style="--spine:' + color + '; animation-delay:' + Math.min(i * 0.03, 0.4) + 's">' +
          '<div class="card-cover album-cover">' +
            '<div class="cover-fallback">' + DISC_ICON_SVG + '</div>' +
            (cover ? '<img class="cover-img" src="' + cover + '" alt="" loading="lazy">' : '') +
            '<div class="card-tab mono">' + escapeHtml(formatShort(a.format)) + "</div>" +
            '<div class="card-actions">' +
              '<button class="icon-btn edit-btn" data-id="' + a.id + '" aria-label="Edit ' + escapeHtml(a.title) + '"><svg viewBox="0 0 20 20" fill="none"><path d="M13.5 3.5l3 3-9 9-3.6.6.6-3.6 9-9z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></button>' +
              '<button class="icon-btn del-btn" data-id="' + a.id + '" aria-label="Remove ' + escapeHtml(a.title) + '"><svg viewBox="0 0 20 20" fill="none"><path d="M4 6h12M8 6V4.5h4V6M6 6l.7 9.5A1 1 0 007.7 16.5h4.6a1 1 0 001-1L14 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
            "</div>" +
          "</div>" +
          '<div class="card-body">' +
            "<h3>" + escapeHtml(a.title || "Untitled") + "</h3>" +
            '<p class="author">' + escapeHtml(a.artist || "Unknown artist") + "</p>" +
            '<div class="meta-row"><span class="genre-tag">' + escapeHtml(a.genre || a.format || "Unfiled") + "</span>" +
            (a.year ? '<span class="mono view-isbn">' + escapeHtml(String(a.year)) + "</span>" : "") + "</div>" +
          "</div>" +
        "</article>"
      );
    }).join("");

    armCoverImages(grid);

    Array.prototype.forEach.call(grid.querySelectorAll(".edit-btn"), function (btn) {
      btn.addEventListener("click", function (e) { e.stopPropagation(); openAlbumEditForm(btn.getAttribute("data-id")); });
    });
    Array.prototype.forEach.call(grid.querySelectorAll(".del-btn"), function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var a = albums.find(function (x) { return x.id === btn.getAttribute("data-id"); });
        if (a && confirm('Remove "' + a.title + '" from the music shelf?')) {
          deleteAlbumById(a.id);
          showToast("Removed from the collection.");
        }
      });
    });
    Array.prototype.forEach.call(grid.querySelectorAll(".card"), function (card) {
      card.addEventListener("click", function (e) {
        if (e.target.closest(".icon-btn")) return;
        renderAlbumInfoModal(card.getAttribute("data-id"));
      });
      card.addEventListener("keydown", function (e) {
        if ((e.key === "Enter" || e.key === " ") && !e.target.closest(".icon-btn")) {
          e.preventDefault();
          renderAlbumInfoModal(card.getAttribute("data-id"));
        }
      });
    });
  }

  function renderAlbumInfoModal(id) {
    var a = albums.find(function (x) { return x.id === id; });
    if (!a) return;
    var color = spineColor(a.genre || a.format);
    var cover = albumCoverUrl(a);
    var added = a.addedAt ? new Date(a.addedAt) : null;
    var addedStr = (added && !isNaN(added.getTime())) ? added.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";
    var tracksHtml;
    if (a.tracks && a.tracks.length) {
      tracksHtml = '<p class="view-added" style="margin-bottom:0.3rem;">Songs on this ' + escapeHtml((a.format || "album").toLowerCase()) + ":</p>" +
        '<ol class="track-list">' + a.tracks.map(function (t) { return "<li>" + escapeHtml(t) + "</li>"; }).join("") + "</ol>";
    } else {
      tracksHtml = '<p class="view-added">No track list saved for this one yet.</p>';
    }

    openModal(
      '<div class="view-book" style="--spine:' + color + '">' +
        '<div class="view-cover album-cover">' +
          '<div class="cover-fallback">' + DISC_ICON_SVG + '</div>' +
          (cover ? '<img class="cover-img" src="' + cover + '" alt="">' : '') +
        "</div>" +
        '<div class="view-info">' +
          '<h2 id="modalTitle">' + escapeHtml(a.title || "Untitled") + "</h2>" +
          '<p class="view-author">' + escapeHtml(a.artist || "Unknown artist") + "</p>" +
          '<div class="view-meta-row">' +
            '<span class="genre-tag">' + escapeHtml(a.format || "Unfiled") + "</span>" +
            (a.genre ? '<span class="genre-tag">' + escapeHtml(a.genre) + "</span>" : "") +
            (a.year ? '<span class="mono view-isbn">' + escapeHtml(String(a.year)) + "</span>" : "") +
          "</div>" +
          tracksHtml +
          (addedStr ? '<p class="view-added">Added ' + addedStr + "</p>" : "") +
          '<p class="view-added discogs-link-row"><a class="discogs-link" href="' + escapeHtml(discogsReleaseUrl(a) || "https://www.discogs.com/search/") + '" target="_blank" rel="noopener">Check on Discogs ↗</a></p>' +
          '<div class="form-actions">' +
            '<button type="button" class="btn btn-danger" id="viewDeleteBtn">Remove</button>' +
            '<button type="button" class="btn btn-ghost" id="viewCloseBtn">Close</button>' +
            '<button type="button" class="btn btn-primary" id="viewEditBtn">Edit</button>' +
          "</div>" +
        "</div>" +
      "</div>"
    );
    armCoverImages(document.getElementById("modalBody"));
    document.getElementById("viewCloseBtn").addEventListener("click", closeModal);
    document.getElementById("viewEditBtn").addEventListener("click", function () { openAlbumEditForm(a.id); });
    document.getElementById("viewDeleteBtn").addEventListener("click", function () {
      if (confirm('Remove "' + a.title + '" from the music shelf?')) {
        deleteAlbumById(a.id);
        showToast("Removed from the collection.");
        closeModal();
      }
    });
  }

  /* ---------------- modal shell ---------------- */
  var overlay = document.getElementById("overlay");
  var modalBody = document.getElementById("modalBody");
  function closeModal() {
    overlay.hidden = true;
    modalBody.innerHTML = "";
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
    currentEditAlbumId = null;
    renderAlbumOptionScreen();
  });
  document.getElementById("searchInput").addEventListener("input", renderAll);
  document.getElementById("formatFilter").addEventListener("change", renderAll);

  /* ---------------- add flow ---------------- */

  function discogsReleaseUrl(album) {
    if (!album) return null;
    if (album.mbid) return "https://www.discogs.com/release/" + encodeURIComponent(album.mbid);
    var parts = [];
    if (album.artist) parts.push(album.artist);
    if (album.title) parts.push(album.title);
    if (!parts.length) return null;
    return "https://www.discogs.com/search/?q=" + encodeURIComponent(parts.join(" - ")) + "&type=release";
  }

  function renderAlbumOptionScreen() {
    openModal(
      '<h2 id="modalTitle">Add an album</h2>' +
      '<p class="modal-sub">Choose how you\'d like to bring in the details.</p>' +
      '<div class="option-list">' +
        '<button class="option-tile" id="optScratch">' +
          '<span class="opt-icon"><svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="10" r="1.8" stroke="currentColor" stroke-width="1.4"/></svg></span>' +
          '<span><strong>Enter it myself</strong><span>Type in the album, artist, and song list by hand.</span></span>' +
        "</button>" +
        '<button class="option-tile" id="optLookup">' +
          '<span class="opt-icon"><svg viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="5.5" stroke="currentColor" stroke-width="1.4"/><path d="M13.5 13.5L17 17" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></span>' +
          '&nbsp;<span><strong>Search by album, artist, or UPC</strong><span>Looked up live in Discogs — track list included.</span></span>' +
        "</button>" +
      "</div>"
    );
    document.getElementById("optScratch").addEventListener("click", function () { renderAlbumForm(null); });
    document.getElementById("optLookup").addEventListener("click", renderMusicLookupScreen);
  }

  function openAlbumEditForm(id) {
    var a = albums.find(function (x) { return x.id === id; });
    if (!a) return;
    currentEditAlbumId = id;
    renderAlbumForm(a);
  }

  function renderAlbumForm(prefill, opts) {
    opts = opts || {};
    var isEdit = !!(prefill && prefill.id);
    var title = prefill && prefill.title || "";
    var artist = prefill && prefill.artist || "";
    var format = prefill && prefill.format || "CD";
    var year = prefill && prefill.year || "";
    var genre = prefill && prefill.genre || "";
    var tracks = prefill && prefill.tracks ? prefill.tracks.join("\n") : "";

    openModal(
      (opts.backLabel ? '<button class="back-link" id="backBtn">‹ ' + escapeHtml(opts.backLabel) + "</button>" : "") +
      '<h2 id="modalTitle">' + (isEdit ? "Edit album" : opts.reviewMode ? "Check the details" : "Enter it myself") + "</h2>" +
      '<p class="modal-sub">' + (opts.reviewMode ? "Here's what turned up — fix anything that's off before saving." : "Fields marked with * are required. Put each song on its own line so you can search them later.") + "</p>" +
      (opts.note ? '<div class="lookup-note">' + opts.note + "</div>" : "") +
      '<form id="albumForm">' +
        '<div class="field"><label for="aTitle">Album title *</label><input id="aTitle" type="text" required value="' + escapeHtml(title) + '"></div>' +
        '<div class="field"><label for="aArtist">Artist *</label><input id="aArtist" type="text" required value="' + escapeHtml(artist) + '"></div>' +
        '<div class="field"><label for="aFormat">Format</label><select id="aFormat">' +
          MUSIC_FORMATS.map(function (f) { return '<option value="' + f + '"' + (f === format ? " selected" : "") + '>' + f + "</option>"; }).join("") +
        "</select></div>" +
        '<div class="field"><label for="aYear">Year</label><input id="aYear" type="number" min="1900" max="2100" value="' + escapeHtml(String(year)) + '" placeholder="e.g. 1977"></div>' +
        '<div class="field"><label for="aGenre">Genre</label><input id="aGenre" type="text" list="musicGenreOptions" value="' + escapeHtml(genre) + '" placeholder="e.g. Rock">' +
          '<datalist id="musicGenreOptions">' + MUSIC_GENRE_SUGGESTIONS.map(function (g) { return '<option value="' + g + '">'; }).join("") + "</datalist>" +
        "</div>" +
        '<div class="field"><label for="aTracks">Songs (one per line)</label><textarea id="aTracks" rows="8" placeholder="1. Song One&#10;2. Song Two&#10;3. Song Three">' + escapeHtml(tracks) + "</textarea></div>" +
        '<div class="field"><label for="aCover">Cover image URL</label><input id="aCover" type="text" value="' + escapeHtml((prefill && prefill.cover) || "") + '" placeholder="https://… (auto-filled from Discogs; paste any image link)">' +
          '<div class="field-hint">Leave blank to use the record-icon placeholder.</div>' +
        "</div>" +
        '<div class="field-error" id="formError" style="display:none;"></div>' +
        '<div class="form-actions">' +
          (isEdit ? '<button type="button" class="btn btn-danger" id="deleteBtn">Remove</button>' : "") +
          '<button type="button" class="btn btn-ghost" id="cancelBtn">Cancel</button>' +
          '<button type="submit" class="btn btn-primary">' + (isEdit ? "Save changes" : "Add to collection") + "</button>" +
        "</div>" +
      "</form>"
    );

    if (opts.backLabel) {
      document.getElementById("backBtn").addEventListener("click", function () {
        if (opts.onBack) opts.onBack(); else renderAlbumOptionScreen();
      });
    }
    document.getElementById("cancelBtn").addEventListener("click", closeModal);
    if (isEdit) {
      document.getElementById("deleteBtn").addEventListener("click", function () {
        if (confirm('Remove "' + prefill.title + '" from the music shelf?')) {
          deleteAlbumById(prefill.id);
          showToast("Removed from the collection.");
          closeModal();
        }
      });
    }

    document.getElementById("albumForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var t = document.getElementById("aTitle").value.trim();
      var ar = document.getElementById("aArtist").value.trim();
      var f = document.getElementById("aFormat").value;
      var yr = parseInt(document.getElementById("aYear").value, 10) || null;
      var g = document.getElementById("aGenre").value.trim();
      var trackList = document.getElementById("aTracks").value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
      var coverUrl = document.getElementById("aCover").value.trim();
      var errEl = document.getElementById("formError");
      if (!t || !ar) {
        errEl.textContent = "Album title and artist are needed before this goes on the music shelf.";
        errEl.style.display = "block";
        return;
      }
      var album = {
        id: isEdit ? prefill.id : uid(),
        title: t, artist: ar, format: f, year: yr, genre: g,
        tracks: trackList,
        mbid: (prefill && prefill.mbid) || "",
        cover: coverUrl,
        addedAt: (prefill && prefill.addedAt) || new Date().toISOString()
      };
      persistAlbum(album);
      showToast(isEdit ? "Changes saved." : '"' + t + '" added to the collection.');
      closeModal();
    });
  }

  /* ---------------- MusicBrainz lookup ---------------- */
  function renderMusicLookupScreen() {
    openModal(
      '<button class="back-link" id="backBtn">‹ Back</button>' +
      '<h2 id="modalTitle">Search by album, artist, or UPC</h2>' +
      '<p class="modal-sub">Looked up live in Discogs — album art, format, and the full track list come along for the ride.</p>' +
      '<div class="lookup-row">' +
        '<input id="lookupInput" type="text" placeholder="e.g. Rumours Fleetwood Mac, or a UPC barcode number">' +
        '<button class="btn btn-primary" id="lookupGo">Look up</button>' +
      "</div>" +
      '<p class="status-line" id="lookupStatus"></p>'
    );
    document.getElementById("backBtn").addEventListener("click", renderAlbumOptionScreen);
    var input = document.getElementById("lookupInput");
    input.focus();
    var go = document.getElementById("lookupGo");
    function run() {
      var q = input.value.trim();
      if (!q) return;
      runMusicLookup(q, "Search by album, artist, or UPC");
    }
    go.addEventListener("click", run);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); run(); } });
  }

  async function runMusicLookup(query, backLabel) {
    var statusEl = document.getElementById("lookupStatus");
    var go = document.getElementById("lookupGo");
    if (statusEl) statusEl.innerHTML = '<span class="spinner"></span> Searching Discogs…';
    if (go) go.disabled = true;

    if (!discogsConfigured()) {
      renderAlbumForm({}, {
        backLabel: backLabel, onBack: renderAlbumOptionScreen,
        note: "Album lookup isn't connected to Discogs yet — the site owner needs to deploy the lookup proxy (see the notes in music.js), or paste a token at the top of music.js for personal use. Until then, enter albums by hand below."
      });
      return;
    }

    var digits = query.replace(/[-\s]/g, "");
    var looksLikeUpc = /^\d{8,14}$/.test(digits);
    var searchQ = looksLikeUpc ? "barcode:" + digits : query;
    var scratchPrefill = looksLikeUpc ? {} : { title: query };

    function fmtFromDiscogs(formats) {
      var f = (formats && formats.length && formats[0].name || "").toLowerCase();
      if (f.indexOf("vinyl") !== -1) return "Vinyl";
      if (f.indexOf("cassette") !== -1) return "Cassette";
      if (f.indexOf("cd") !== -1 || f.indexOf("album") !== -1) return "CD";
      if (f.indexOf("file") !== -1 || f.indexOf("digital") !== -1) return "Digital";
      return "Other";
    }
    function releaseToCandidate(r) {
      var artist = (r.artists || []).map(function (a) { return a.name; }).filter(Boolean).join(", ");
      var img = (r.images && r.images.length && (r.images[0].uri || r.images[0].resource_url)) || "";
      return {
        mbid: String(r.id),
        title: r.title || "",
        artist: artist,
        year: r.year || null,
        format: fmtFromDiscogs(r.formats),
        trackCount: r.tracklist ? r.tracklist.length : 0,
        cover: img
      };
    }

    try {
      var data = await fetchDiscogs("/database/search?q=" + encodeURIComponent(searchQ) + "&type=release&per_page=5");
      var candidates = (data.results || []).map(releaseToCandidate).filter(function (c) { return c.title || c.artist; });

      if (candidates.length === 0) {
        renderAlbumForm(scratchPrefill, {
          backLabel: backLabel, onBack: renderAlbumOptionScreen,
          note: "Couldn't find that one in Discogs — no trouble, just fill in what you know below."
        });
      } else if (candidates.length === 1) {
        await renderAlbumReview(candidates[0], backLabel);
      } else {
        renderMusicCandidateScreen(candidates, query, backLabel);
      }
    } catch (e) {
      var raw = String((e && e.message) || "unknown");
      var note;
      if (DISCOGS_PROXY && /proxy http 4/i.test(raw)) {
        note = "The Discogs proxy isn't there yet (" + raw + "). In Supabase: Edge Functions → create a function named exactly discogs-proxy → paste in discogs-proxy.ts → add the DISCOGS_TOKEN secret → deploy.";
      } else if (/proxy http 500|token not configured/i.test(raw)) {
        note = "The proxy is deployed but its DISCOGS_TOKEN secret is missing or wrong — add it in the function's Secrets (discogs.com → Settings → Developers → Generate token).";
      } else if (DISCOGS_PROXY && /Failed to fetch|network|timeout/i.test(raw)) {
        note = "Your browser couldn't reach the proxy at all (" + raw + "). Either it isn't deployed yet, or this network is blocking it (school filters block unknown domains — try a phone hotspot to confirm).";
      } else if (/token/i.test(raw)) {
        note = "Discogs rejected the token — check the DISCOGS_TOKEN secret or the token at the top of music.js.";
      } else {
        note = "The lookup didn't go through (" + raw + ") — fill in the details by hand.";
      }
      renderAlbumForm({ title: scratchPrefill.title || "", artist: "", format: "CD", tracks: [] }, {
        backLabel: backLabel, onBack: renderAlbumOptionScreen, note: note
      });
    }
  }

  async function fetchMusicRelease(dgid) {
    var rel = await fetchDiscogs("/releases/" + encodeURIComponent(dgid));
    var tracks = (rel.tracklist || []).map(function (t) {
      return String(t.title || "").trim();
    }).filter(Boolean);
    var artist = (rel.artists || []).map(function (a) { return a.name; }).filter(Boolean).join(", ");
    var img = (rel.images && rel.images.length && (rel.images[0].uri || rel.images[0].resource_url)) || "";
    var f = ((rel.formats && rel.formats.length && rel.formats[0].name) || "").toLowerCase();
    var format = "Other";
    if (f.indexOf("vinyl") !== -1) format = "Vinyl";
    else if (f.indexOf("cassette") !== -1) format = "Cassette";
    else if (f.indexOf("cd") !== -1 || f.indexOf("album") !== -1) format = "CD";
    else if (f.indexOf("file") !== -1 || f.indexOf("digital") !== -1) format = "Digital";
    var genre = "";
    if (rel.genres && rel.genres.length) {
      genre = String(rel.genres[0]);
      genre = genre.charAt(0).toUpperCase() + genre.slice(1);
    } else if (rel.styles && rel.styles.length) {
      genre = String(rel.styles[0]);
      genre = genre.charAt(0).toUpperCase() + genre.slice(1);
    }
    return {
      mbid: String(rel.id),
      title: rel.title || "",
      artist: artist,
      year: rel.year || null,
      format: format,
      genre: genre,
      tracks: tracks,
      cover: img
    };
  }

  async function renderAlbumReview(candidate, backLabel) {
    var statusEl = document.getElementById("lookupStatus");
    if (statusEl) statusEl.innerHTML = '<span class="spinner"></span> Fetching the track list…';
    try {
      var full = await fetchMusicRelease(candidate.mbid);
      full.genre = full.genre || candidate.genre || "";
      if (!full.cover && candidate.cover) full.cover = candidate.cover;
      renderAlbumForm(full, {
        backLabel: backLabel, onBack: renderAlbumOptionScreen, reviewMode: true,
        note: "Filled in live from Discogs — give it a quick check before saving."
      });
    } catch (e) {
      renderAlbumForm({ title: candidate.title, artist: candidate.artist, format: candidate.format || "CD", year: candidate.year, genre: "", tracks: [], mbid: candidate.mbid }, {
        backLabel: backLabel, onBack: renderAlbumOptionScreen, reviewMode: true,
        note: "Found the album, but the track list didn't come through — add the songs below by hand."
      });
    }
  }

  function renderMusicCandidateScreen(candidates, query, backLabel) {
    openModal(
      '<button class="back-link" id="backBtn">‹ Back</button>' +
      '<h2 id="modalTitle">A few albums match "' + escapeHtml(query) + '"</h2>' +
      '<p class="modal-sub">Pick the one you mean — you\'ll get a chance to fix any details next.</p>' +
      '<div class="option-list">' +
        candidates.map(function (c, i) {
          return (
            '<button class="option-tile candidate-tile" data-idx="' + i + '">' +
              '<span class="opt-icon"><svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="10" r="1.8" stroke="currentColor" stroke-width="1.4"/></svg></span>' +
              '<span><strong>' + escapeHtml(c.title || "Untitled") + '</strong><span>' +
                escapeHtml(c.artist || "Unknown artist") +
                (c.year ? " · " + c.year : "") +
                (c.format ? " · " + escapeHtml(c.format) : "") +
                (c.trackCount ? " · " + c.trackCount + " songs" : "") +
              "</span></span>" +
            "</button>"
          );
        }).join("") +
        '<button class="option-tile" id="noneMatch">' +
          '<span class="opt-icon"><svg viewBox="0 0 20 20" fill="none"><path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span>' +
          '<span><strong>None of these</strong><span>Enter the details myself instead.</span></span>' +
        "</button>" +
      "</div>"
    );
    document.getElementById("backBtn").addEventListener("click", renderAlbumOptionScreen);
    document.getElementById("noneMatch").addEventListener("click", function () {
      renderAlbumForm({ title: query, tracks: [] }, { backLabel: backLabel, onBack: renderAlbumOptionScreen });
    });
    Array.prototype.forEach.call(document.querySelectorAll(".candidate-tile"), function (btn) {
      btn.addEventListener("click", function () {
        renderAlbumReview(candidates[Number(btn.getAttribute("data-idx"))], backLabel);
      });
    });
  }

  /* ---------------- session / boot ---------------- */
  function showApp(user) {
    currentUser = { id: user.id, username: emailToUsername(user.email, user.user_metadata && user.user_metadata.username) };
    document.getElementById("whoami").textContent = currentUser.username;
    var logoutBtn = document.getElementById("logoutBtn");
    logoutBtn.hidden = false;
    document.getElementById("loginLink").hidden = true;
    if (!logoutBtn._wired) {
      logoutBtn._wired = true;
      logoutBtn.addEventListener("click", async function () {
        if (db && db.auth) { try { await db.auth.signOut(); } catch (e) {} }
        window.location.href = "login.html";
      });
    }
    loadAlbumsForUser(currentUser.id);
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
    // Local-first: your albums appear instantly, even if the account
    // service or CDN is slow/blocked. Cloud sync upgrades in the background.
    try { loadLocalFallback(); } catch (e) {}
    setSyncNote("Saved to this browser. Checking for your account…");
    try {
      await connectSupabase();
      var session = await getSessionWithRetries(3);
      if (session && session.user) {
        showApp(session.user);
      } else {
        usingLocalFallback = true;
        setSyncNote('Saved to this browser only — log in to sync your music shelf.');
        document.getElementById("loginLink").hidden = false;
      }
    } catch (e) {
      usingLocalFallback = true;
      setSyncNote("Saved to this browser only (account service unreachable).");
      document.getElementById("loginLink").hidden = false;
    }
  }
  populateFormatFilter();
  boot();
})();
