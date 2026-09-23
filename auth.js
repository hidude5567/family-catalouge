(function () {
  "use strict";

  /* ---------------- supabase config ----------------
     In Supabase: Project Settings -> API -> Project URL & anon public key. */
  var SUPABASE_URL = "https://wgyrpvrzafubezcxqrzy.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndneXJwdnJ6YWZ1YmV6Y3hxcnp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxODI2NjYsImV4cCI6MjEwNTc1ODY2Nn0.rGn52ohlPcbKKoiRU3vsd1IrPeE5id6eriDD_JR8jco";

  var AUTH_EMAIL_DOMAIN = "gmail.com"; // Supabase rejects fake TLDs like .local at signup
  function usernameToEmail(username) {
    var local = String(username).trim().toLowerCase().split("@")[0];
    return local.replace(/\s+/g, "") + "@" + AUTH_EMAIL_DOMAIN;
  }

  function friendlyAuthError(msg) {
    msg = String(msg || "");
    if (/already registered|already exists|duplicate/i.test(msg)) return "That username is already taken.";
    if (/invalid login credentials/i.test(msg)) return "Wrong username or password.";
    if (/email not confirmed|not.*confirmed/i.test(msg)) return "This project has email confirmation turned on — Supabase Dashboard → Authentication → Settings → turn \"Confirm email\" off, then try again.";
    if (/invalid.*(email|format)/i.test(msg)) return "Try a simpler username — letters and numbers only.";
    if (/password.*(least|short|6)/i.test(msg)) return "Password needs to be at least 6 characters.";
    if (/rate limit/i.test(msg)) return "Too many attempts — wait a moment and try again.";
    return msg || "Something went wrong — try again.";
  }

  var bootStatusEl = document.getElementById("bootStatus");
  function setBootStatus(text, isError) {
    if (!bootStatusEl) return;
    if (!text) { bootStatusEl.hidden = true; return; }
    bootStatusEl.hidden = false;
    bootStatusEl.textContent = text;
    bootStatusEl.classList.toggle("boot-status-error", !!isError);
  }

  /* Loads the Supabase client library from jsDelivr, but never hangs
     silently: if the CDN request doesn't finish within 8s (blocked host,
     bad network, CSP), this rejects with a clear reason instead of
     leaving the page stuck with no feedback. */
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
        settled = true;
        clearTimeout(timer);
        resolve(window.supabase || null);
      };
      s.onerror = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error("The account library failed to load from cdn.jsdelivr.net (network or CSP blocked it)."));
      };
      document.head.appendChild(s);
    });
  }

  var db = null;
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
    return db;
  }

  var authMode = "login";
  var lastAuthAttemptAt = 0;
  var AUTH_ATTEMPT_GAP_MS = 12000;

  function setAuthMode(mode) {
    authMode = mode;
    document.getElementById("tabLogin").classList.toggle("active", mode === "login");
    document.getElementById("tabLogin").setAttribute("aria-selected", mode === "login");
    document.getElementById("tabSignup").classList.toggle("active", mode === "signup");
    document.getElementById("tabSignup").setAttribute("aria-selected", mode === "signup");
    document.getElementById("authSubmit").textContent = mode === "login" ? "Log in" : "Create account";
    document.getElementById("authPass").setAttribute("autocomplete", mode === "login" ? "current-password" : "new-password");
    document.getElementById("authError").style.display = "none";
  }

  function wireForm() {
    document.getElementById("tabLogin").addEventListener("click", function () { setAuthMode("login"); });
    document.getElementById("tabSignup").addEventListener("click", function () { setAuthMode("signup"); });

    document.getElementById("authForm").addEventListener("submit", async function (e) {
      e.preventDefault();
      var username = document.getElementById("authUser").value.trim();
      var password = document.getElementById("authPass").value;
      var errEl = document.getElementById("authError");
      var submitBtn = document.getElementById("authSubmit");
      errEl.style.display = "none";

      if (!username || !password) return;
      if (Date.now() - lastAuthAttemptAt < AUTH_ATTEMPT_GAP_MS) {
        errEl.textContent = "Easy — give it a few seconds between attempts.";
        errEl.style.display = "block";
        return;
      }
      lastAuthAttemptAt = Date.now();
      if (!db) { errEl.textContent = "Accounts aren't available right now — see the status line above, or use \"Skip for now.\""; errEl.style.display = "block"; return; }

      submitBtn.disabled = true;
      setBootStatus(authMode === "login" ? "Logging in…" : "Creating your account…");

      var email = usernameToEmail(username);
      try {
        var result = (authMode === "login")
          ? await db.auth.signInWithPassword({ email: email, password: password })
          : await db.auth.signUp({ email: email, password: password, options: { data: { username: username } } });

        if (result.error) throw result.error;

        if (authMode === "signup" && !(result.data && result.data.session)) {
          setBootStatus("");
          submitBtn.disabled = false;
          errEl.textContent = "Account created — this project requires email confirmation, so sign-in can't complete automatically. Turn \"Confirm email\" off in Supabase, or log in manually.";
          errEl.style.display = "block";
          return;
        }

        if (result.data && result.data.session) {
          setBootStatus("Signed in — opening your shelf…");
          window.location.href = "index.html";
          return;
        }
        setBootStatus("");
        submitBtn.disabled = false;
      } catch (err) {
        setBootStatus("");
        submitBtn.disabled = false;
        errEl.textContent = friendlyAuthError(err && err.message);
        errEl.style.display = "block";
      }
    });

    document.getElementById("skipAuthBtn").addEventListener("click", function () {
      try { sessionStorage.setItem("catalogLocalOnly", "1"); } catch (e) {}
      window.location.href = "index.html";
    });
  }

  wireForm();
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  (async function boot() {
    try {
      await connectSupabase();
      setBootStatus("Checking for an existing session…");
      var sessionRes = await db.auth.getSession();
      var session = sessionRes && sessionRes.data && sessionRes.data.session;
      if (session && session.user) {
        setBootStatus("Already signed in — opening your shelf…");
        await wait(2000);
        window.location.href = "index.html";
        return;
      }
      setBootStatus("");
      document.getElementById("authSubmit").disabled = false;
    } catch (e) {
      setBootStatus("Couldn't reach the account service: " + (e && e.message ? e.message : "unknown error") + " — \"Skip for now\" still works.", true);
      document.getElementById("authSubmit").disabled = false;
    }
  })();
})();
