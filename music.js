(function () {
  "use strict";

  /* ---------------- constants & utils ---------------- */
  var MUSIC_FORMATS = ["CD","Vinyl","Cassette","Digital","Other"];
  var MUSIC_GENRE_SUGGESTIONS = ["Rock","Pop","Hip-Hop","Jazz","Classical","Country","Folk","Electronic","R&B","Metal","Punk","Blues","Reggae","Soundtrack","Children's","Holiday","Comedy","Other"];
  var SPINE_COLORS = ["#C98A4B","#8A5A8E","#4B7A6D","#A85454","#5A7AB0","#B08A3C","#7A6AA8","#4B8A9E"];
  var DISC_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="12" r="2.2" stroke="currentColor" stroke-width="1.4"/><path d="M12 3.5a8.5 8.5 0 016.8 3.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

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

  /* ---------------- state ---------------- */
  var albums = [];
  var usingLocalFallback = false;
  var db = null;
  var currentEditAlbumId = null;
  var localKey = "catalog-albums-local-v1";
  var currentUser = null;
  var albumsChannel = null;

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
    var cloudIds = {};
    albums = rows.map(function (r) {
      cloudIds[String(r.id)] = true;
      return {
        id: String(r.id), title: r.title || "", artist: r.artist || "",
        format: r.format || "", year: r.year || null, genre: r.genre || "",
        tracks: String(r.tracks || "").split("\n").map(function (t) { return t.trim(); }).filter(Boolean),
        mbid: r.mbid || "",
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
    var localOnly = albums.slice();
    var res = await fetchAlbums();
    if (res.error && /schema/i.test(res.error.message || "")) {
      await new Promise(function (r) { setTimeout(r, 2000); });
      res = await fetchAlbums();
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
        function () { fetchAlbums().then(function (r2) { if (!r2.error) applyRemoteAlbumRows(r2.data || []); }); })
      .subscribe();
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
      var cover = albumCoverUrl(a.mbid);
      return (
        '<article class="card" data-id="' + a.id + '" tabindex="0" role="button" aria-label="View ' + escapeHtml(a.title || "Untitled") + '" style="--spine:' + color + '; animation-delay:' + Math.min(i * 0.03, 0.4) + 's">' +
          '<div class="card-cover album-cover">' +
            '<div class="cover-fallback">' + DISC_ICON_SVG + '</div>' +
            (cover ? '<img class="cover-img" src="' + cover + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '') +
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
    var cover = albumCoverUrl(a.mbid);
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
          (cover ? '<img class="cover-img" src="' + cover + '" alt="" onerror="this.style.display=\'none\'">' : '') +
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
          '<div class="form-actions">' +
            '<button type="button" class="btn btn-danger" id="viewDeleteBtn">Remove</button>' +
            '<button type="button" class="btn btn-ghost" id="viewCloseBtn">Close</button>' +
            '<button type="button" class="btn btn-primary" id="viewEditBtn">Edit</button>' +
          "</div>" +
        "</div>" +
      "</div>"
    );
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
  var activeStream = null;

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
  function renderAlbumOptionScreen() {
    stopScanner();
    openModal(
      '<h2 id="modalTitle">Add an album</h2>' +
      '<p class="modal-sub">Choose how you\'d like to bring in the details.</p>' +
      '<div class="option-list">' +
        '<button class="option-tile" id="optScratch">' +
          '<span class="opt-icon"><svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="10" r="1.8" stroke="currentColor" stroke-width="1.4"/></svg></span>' +
          '<span><strong>Enter it myself</strong><span>Type in the album, artist, and song list by hand.</span></span>' +
        "</button>" +
        '<button class="option-tile" id="optBarcode">' +
          '<span class="opt-icon"><svg viewBox="0 0 20 20" fill="none"><path d="M3 4v12M6 4v12M8.5 4v12M11 4v12M13 4v12M16 4v12" stroke="currentColor" stroke-width="1.3"/></svg></span>' +
          '<span><strong>Scan the barcode</strong><span>Most CDs have a UPC on the back — scan it and I\'ll find the album.</span></span>' +
        "</button>" +
        '<button class="option-tile" id="optLookup">' +
          '<span class="opt-icon"><svg viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="5.5" stroke="currentColor" stroke-width="1.4"/><path d="M13.5 13.5L17 17" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></span>' +
          '<span><strong>Search by album, artist, or UPC</strong><span>Looked up live in MusicBrainz — track list included.</span></span>' +
        "</button>" +
      "</div>"
    );
    document.getElementById("optScratch").addEventListener("click", function () { renderAlbumForm(null); });
    document.getElementById("optBarcode").addEventListener("click", renderBarcodeScreen);
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
      '<p class="modal-sub">Looked up live in MusicBrainz — album art and the full track list come along for the ride.</p>' +
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

  function mapMediaFormat(s) {
    var v = String(s || "").toLowerCase();
    if (v.indexOf("vinyl") !== -1) return "Vinyl";
    if (v.indexOf("cassette") !== -1) return "Cassette";
    if (v.indexOf("cd") !== -1) return "CD";
    if (v.indexOf("digital") !== -1) return "Digital";
    return "Other";
  }
  function creditName(credits) {
    return (credits || []).map(function (c) { return c.name || (c.artist && c.artist.name) || ""; }).filter(Boolean).join(", ");
  }

  async function runMusicLookup(query, backLabel) {
    var statusEl = document.getElementById("lookupStatus");
    var go = document.getElementById("lookupGo");
    if (statusEl) statusEl.innerHTML = '<span class="spinner"></span> Searching MusicBrainz…';
    if (go) go.disabled = true;

    var digits = query.replace(/[-\s]/g, "");
    var looksLikeUpc = /^\d{8,14}$/.test(digits);
    var mbQuery = looksLikeUpc ? "barcode:" + digits : query;
    var scratchPrefill = looksLikeUpc ? {} : { title: query };

    function releaseToCandidate(r) {
      var media = r.media || [];
      return {
        mbid: r.id,
        title: r.title || "",
        artist: creditName(r["artist-credit"]),
        year: r.date ? parseInt(String(r.date).slice(0, 4), 10) || null : null,
        format: mapMediaFormat(media.length && media[0].format),
        trackCount: media.reduce(function (n, m) { return n + (m["track-count"] || 0); }, 0)
      };
    }

    try {
      var data = await fetchJson("https://musicbrainz.org/ws/2/release/?query=" + encodeURIComponent(mbQuery) + "&fmt=json&limit=5");
      var candidates = (data.releases || []).map(releaseToCandidate).filter(function (c) { return c.title || c.artist; });

      if (candidates.length === 0) {
        renderAlbumForm(scratchPrefill, {
          backLabel: backLabel, onBack: renderAlbumOptionScreen,
          note: "Couldn't find that one in MusicBrainz — no trouble, just fill in what you know below."
        });
      } else if (candidates.length === 1) {
        await renderAlbumReview(candidates[0], backLabel);
      } else {
        renderMusicCandidateScreen(candidates, query, backLabel);
      }
    } catch (e) {
      renderAlbumForm({ title: scratchPrefill.title || "", artist: "", format: "CD", tracks: [] }, {
        backLabel: backLabel, onBack: renderAlbumOptionScreen,
        note: "The lookup didn't go through (offline, or MusicBrainz is unreachable) — fill in the details by hand."
      });
    }
  }

  async function fetchMusicRelease(mbid) {
    var rel = await fetchJson("https://musicbrainz.org/ws/2/release/" + encodeURIComponent(mbid) + "?inc=recordings+artist-credits+tags&fmt=json");
    var tracks = [];
    (rel.media || []).forEach(function (m) {
      (m.tracks || []).forEach(function (t) {
        var name = t.title || (t.recording && t.recording.title) || "";
        if (name) tracks.push(name);
      });
    });
    var year = rel.date ? parseInt(String(rel.date).slice(0, 4), 10) || null : null;
    var genre = "";
    if (rel.tags && rel.tags.length && rel.tags[0].name) {
      var g = String(rel.tags[0].name);
      genre = g.charAt(0).toUpperCase() + g.slice(1);
    }
    return {
      mbid: mbid,
      title: rel.title || "",
      artist: creditName(rel["artist-credit"]),
      year: year,
      format: mapMediaFormat((rel.media && rel.media[0] && rel.media[0].format) || ""),
      genre: genre,
      tracks: tracks
    };
  }

  async function renderAlbumReview(candidate, backLabel) {
    var statusEl = document.getElementById("lookupStatus");
    if (statusEl) statusEl.innerHTML = '<span class="spinner"></span> Fetching the track list…';
    try {
      var full = await fetchMusicRelease(candidate.mbid);
      full.genre = full.genre || candidate.genre || "";
      renderAlbumForm(full, {
        backLabel: backLabel, onBack: renderAlbumOptionScreen, reviewMode: true,
        note: "Filled in live from MusicBrainz — give it a quick check before saving."
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
    document.getElementById("backBtn").addEventListener("click", function () { stopScanner(); renderAlbumOptionScreen(); });
    document.getElementById("manualIsbnGo").addEventListener("click", function () {
      var v = document.getElementById("manualIsbn").value.trim();
      if (!v) return;
      stopScanner();
      runMusicLookup(v, "Scan the barcode");
    });
    startScanner();
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

  function onBarcodeFound(value, statusEl) {
    stopScanner();
    statusEl.innerHTML = "Found " + escapeHtml(value) + " — looking it up…";
    runMusicLookup(value, "Scan the barcode");
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
    loadLocalFallback();
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
