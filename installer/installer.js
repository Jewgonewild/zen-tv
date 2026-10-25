/* Zen TV installer page: seven steps that edit settings.json (saved as you go) and run the setup
   commands on this computer through install.py. */
(function () {
  "use strict";

  var CAT = window.ZEN_CATALOG;
  var S = {};      // settings.json, as edited
  var ST = {};     // what install.py found (checks, saved keys, certificate profiles, ...)
  var current = 0;
  var tvApps = null;    // apps read from the TV: [{ name, store, key }]
  var foundTvs = null;  // TVs found on the network
  var devModeOk = false, installedOk = false, openAfter = true;
  var cityResults = [], cityQuery = "";
  var visited = {}; // steps seen this session: a step only shows as done once you've been through it

  var STEPS = [
    { id: "welcome", title: "Welcome" },
    { id: "look", title: "Name and icon" },
    { id: "theme", title: "Theme" },
    { id: "profiles", title: "Profiles" },
    { id: "tv", title: "Your TV and apps" },
    { id: "devmode", title: "Developer Mode and certificate" },
    { id: "install", title: "Install" }
  ];
  var THEMES = [
    { id: "glass", name: "Glass", desc: "Frosted glass over the photo, like Apple TV", sw: ["#20232c", "#ffffff", "#8e8cf6"] },
    { id: "midnight", name: "Midnight", desc: "Deep navy and violet, the photo dimmed into it", sw: ["#07081a", "#5a7bff", "#b85cff"] },
    { id: "paper", name: "Paper", desc: "Light and warm, with a serif title", sw: ["#f3efe6", "#1d1b16", "#8a5a2b"] },
    { id: "cinema", name: "Cinema", desc: "Black and gold, letterboxed, an italic serif", sw: ["#000000", "#d9b46a", "#f4efe4"] },
    { id: "nature", name: "Nature", desc: "Airy glass, mostly landscape photos", sw: ["#2f5d3a", "#ffffff", "#9fd3c7"] }
  ];
  var ICON_NAMES = { zen: "Zen TV", dawn: "Dawn", night: "Night", lake: "Lake" };
  var TASTE_NAMES = { "crime-drama": "Crime and drama", "romance-comedy": "Romance and comedy" };
  var MAX_PROFILES = 6;

  var $ = function (id) { return document.getElementById(id); };
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- Talking to install.py ---------- */
  function api(path, body) {
    return fetch("api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.error || "Request failed");
        return d;
      });
    });
  }
  var saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 300);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    return api("settings", { settings: S });
  }
  function refreshState() {
    return api("state").then(function (d) { ST = d; return d; });
  }
  // A long task (pairing, icons, install): show its output as it runs; resolves true if it worked
  function runJob(path, body, logEl) {
    logEl.textContent = "";
    return saveNow().then(function () { return api(path, body || {}); }).then(function (r) {
      return new Promise(function (resolve) {
        var misses = 0;
        (function poll() {
          api("job/" + r.job).then(function (j) {
            misses = 0;
            logEl.textContent = j.log.join("\n");
            logEl.scrollTop = logEl.scrollHeight;
            if (j.done) resolve(j.ok); else setTimeout(poll, 700);
          }).catch(function () {
            // the installer was closed or restarted: stop rather than wait forever
            if (++misses >= 5) {
              logEl.textContent += "\nLost touch with the installer. Is python3 install.py still running?";
              resolve(false);
            } else setTimeout(poll, 1500);
          });
        })();
      });
    }).catch(function (e) { logEl.textContent = e.message; return false; });
  }
  function say(el, ok, text) {
    el.className = "msg " + (ok ? "ok" : "bad");
    el.textContent = text;
  }

  /* ---------- Settings defaults ---------- */
  function withDefaults(s) {
    s.appName = s.appName || "Zen TV";
    s.icon = s.icon || "zen";
    s.theme = s.theme || "glass";
    if (s.recommendations === undefined) s.recommendations = true;
    s.region = s.region || "US";
    s.weather = s.weather || { units: "fahrenheit" }; // no location: the TV shows no weather until a city is picked
    s.apps = s.apps || ["netflix", "youtube", "prime"];
    s.alsoInstalled = s.alsoInstalled || [];
    s.profiles = s.profiles && s.profiles.length ? s.profiles : [{ name: "Eloise", initial: "E", color: "purple", taste: "crime-drama" }];
    s.certificateProfile = s.certificateProfile || "ZenTV";
    s.tizenStudio = s.tizenStudio || "~/tizen-studio";
    s.tmdbKeyFile = s.tmdbKeyFile || "~/.zen-tv/tmdb-key";
    return s;
  }

  /* ---------- Step list ---------- */
  function stepDone(i) {
    if (!visited[i] && STEPS[i].id !== "welcome") return false;
    switch (STEPS[i].id) {
      case "welcome": return ST.checks && ST.checks.packages && ST.checks.tizenCli;
      case "look": return !!S.appName;
      case "theme": return !!S.theme;
      case "profiles": return S.profiles.length > 0 && S.profiles.every(function (p) { return p.name; });
      case "tv": return !!S.tvIp && S.apps.length > 0;
      case "devmode": return devModeOk && ST.certProfiles && ST.certProfiles.indexOf(S.certificateProfile) >= 0;
      case "install": return installedOk;
    }
    return false;
  }
  function renderSteps() {
    $("step-list").innerHTML = STEPS.map(function (s, i) {
      return '<li><button type="button" data-step="' + i + '" class="' + (stepDone(i) ? "done" : "") + '"' +
        (i === current ? ' aria-current="step"' : "") + '><span class="num">' + (stepDone(i) && i !== current ? "✓" : i + 1) +
        "</span>" + esc(s.title) + "</button></li>";
    }).join("");
  }
  $("step-list").addEventListener("click", function (e) {
    var b = e.target.closest("[data-step]");
    if (b) go(+b.getAttribute("data-step"));
  });
  function go(i) {
    visited[current] = true;
    current = Math.max(0, Math.min(STEPS.length - 1, i));
    render();
    $("panel").focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  /* ---------- Steps ---------- */
  function head(title, lead) {
    return '<div class="eyebrow">Step ' + (current + 1) + " of " + STEPS.length + "</div><h1>" + esc(title) + "</h1>" +
      (lead ? '<p class="lead">' + lead + "</p>" : "");
  }
  function status(ok, text, level) {
    return '<div class="status ' + (level || (ok ? "ok" : "bad")) + '"><span class="dot"></span><span>' + text + "</span></div>";
  }
  function sw(name, checked, title, desc) {
    return '<label class="switch"><input type="checkbox" data-bind="' + name + '"' + (checked ? " checked" : "") +
      '><span class="track"></span><span><b>' + title + "</b>" + (desc ? '<span class="hint" style="font-size:14px">' + desc + "</span>" : "") + "</span></label>";
  }

  var RENDER = {
    welcome: function () {
      var c = ST.checks || {};
      var recs = S.recommendations !== false;
      return head("Set up Zen TV",
        "A calm home screen for your Samsung TV. This page sets it up for you: pick a look, add the people " +
        "who watch, choose your apps, then install it on the TV. Everything saves as you go.") +
        (ST.settingsError ? "<div class='card'>" + status(false, esc(ST.settingsError)) + "</div>" : "") +
        "<h2>This computer</h2><div class='card'>" +
        status(true, "Python " + esc(c.python)) +
        (c.packages ? status(true, "Python packages installed") :
          status(false, "Python packages missing") +
          "<div class='row'><button class='btn small' data-action='packages'>Install them</button></div><pre class='log' id='pkg-log'></pre>") +
        (c.tizenCli && c.sdb ? status(true, "Tizen Studio found") :
          status(false, "Tizen Studio not found") +
          "<p>Samsung's free tool for installing apps on its TVs. <a href='https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html' target='_blank' rel='noopener'>Download Tizen Studio</a>, " +
          "then in its Package Manager install <b>TV Extensions</b> and <b>Samsung Certificate Extension</b> (under Extension SDK).</p>") +
        "<label class='field' for='tizen-path'>Tizen Studio folder</label>" +
        "<div class='row'><input class='grow' type='text' id='tizen-path' data-bind='tizenStudio' value='" + esc(S.tizenStudio) + "'>" +
        "<button class='btn small' data-action='recheck'>Check again</button></div></div>" +
        "<h2>Recommendations</h2><div class='card roomy'>" +
        sw("recommendations", recs, "Show movie and TV recommendations",
          "Trending, Classics, Watch Later and search, with favourite and popular movies and shows as backgrounds. " +
          "Off: just your apps over landscape photos.") +
        (recs ? "<div class='subsection'><label class='field' for='tmdb-key'>TMDB key <span class='optional'>Optional</span></label>" +
          "<p class='explain'>Recommendations come from TMDB, The Movie Database: trending titles, favourites, and popular movies and shows. " +
          "The key is free at <a href='https://www.themoviedb.org/settings/api' target='_blank' rel='noopener'>themoviedb.org → Settings → API</a>.</p>" +
          "<p class='explain'>Without one, Zen TV keeps it simple with landscapes.</p>" +
          (ST.tmdbKeySaved ? "<div class='row saved-key'>" + status(true, "A key is saved") +
            "<button class='btn small' data-action='tmdb-remove'>Remove</button></div>" : "") +
          "<div class='row'><input class='grow' type='password' id='tmdb-key' autocomplete='off' placeholder='" +
          (ST.tmdbKeySaved ? "Paste a new key to replace it" : "API Key or Read Access Token") + "'>" +
          "<button class='btn' data-action='tmdb-save'>Test and save</button>" +
          "</div><p class='msg' id='tmdb-msg'></p></div>" : "") +
        "</div>";
    },

    look: function () {
      var presets = (ST.iconPresets || ["zen"]).slice().sort(function (a, b) { return (b === "zen") - (a === "zen"); });
      var icons = presets.map(function (p) {
        return "<button type='button' class='choice' role='radio' aria-checked='" + (S.icon === p) + "' data-action='icon' data-icon='" + p + "'>" +
          "<img src='installer/icons/" + esc(p) + ".png' alt=''>" + esc(ICON_NAMES[p] || p) + "</button>";
      }).join("") +
        "<button type='button' class='choice' role='radio' aria-checked='" + (S.icon === "custom") + "' data-action='upload'>" +
        "<span class='upload'>" + (ST.customIcon ? "✓" : "+") + "</span>" + (ST.customIcon ? "Your image" : "Upload your own") + "</button>";
      var w = S.weather || {};
      return head("Name and icon", "What Zen TV is called on your TV, and the icon in the TV's app list.") +
        "<label class='field' for='app-name'>Name</label>" +
        "<input type='text' id='app-name' maxlength='40' data-bind='appName' value='" + esc(S.appName) + "'>" +
        "<p class='hint'>Shown in the TV's app list and in the Controls menu.</p>" +
        "<h2>Icon</h2><div class='choices' role='radiogroup' aria-label='Icon'>" + icons + "</div>" +
        "<input type='file' id='icon-file' accept='image/*' class='sr-only' tabindex='-1'>" +
        "<p class='hint'>Your own image is cropped to the TV's icon shape (512 × 423).</p><p class='msg' id='icon-msg'></p>" +
        "<h2>Weather and clock</h2><div class='card'>" +
        "<label class='field' for='city'>Your city</label>" +
        "<div class='row'><input class='grow' type='search' id='city' placeholder='e.g. Lisbon' value='" + esc(cityQuery || w.city || "") + "'>" +
        "<button class='btn small' data-action='city'>Find</button></div>" +
        "<p class='hint'>" + (w.city ? "Weather for " + esc(w.city) + "." : w.latitude != null ?
          "Using the example location (New York) until you pick your city." : "No weather until you pick your city.") + "</p>" +
        "<div class='row' id='city-results' style='margin-top:10px'>" + cityResults.map(function (c, i) {
          return "<button class='btn small' data-action='pick-city' data-i='" + i + "'>" + esc(c.label) + "</button>";
        }).join("") + "</div>" +
        "<div class='row' style='margin-top:14px'><div class='grow'><label class='field' for='units'>Temperature</label>" +
        "<select id='units' data-bind='weather.units'><option value='fahrenheit'" + (w.units !== "celsius" ? " selected" : "") +
        ">Fahrenheit</option><option value='celsius'" + (w.units === "celsius" ? " selected" : "") + ">Celsius</option></select></div>" +
        "<div class='grow'><label class='field' for='region'>Country (for streaming info)</label>" +
        "<input type='text' id='region' maxlength='2' data-bind='region' value='" + esc(S.region) + "' style='text-transform:uppercase'></div></div>" +
        "<div style='margin-top:16px'>" + sw("clock24h", !!S.clock24h, "24-hour clock") + "</div></div>";
    },

    theme: function () {
      var recs = S.recommendations !== false;
      var box = function (mode, label) {
        var mine = (mode === "on") === recs;
        return "<figure class='preview-wrap'><div class='preview'><iframe data-recs='" + mode + "' title='" + label +
          " preview' tabindex='-1'></iframe>" + (mine ? "<span class='tag'>Your choice</span>" : "") + "</div>" +
          "<figcaption>" + label + "</figcaption></figure>";
      };
      return head("Theme", "The look for the whole TV. The previews are your home screen, live: with recommendations, and without.") +
        "<div class='choices' role='radiogroup' aria-label='Theme'>" + THEMES.map(function (t) {
          return "<button type='button' class='choice theme-choice' role='radio' aria-checked='" + (S.theme === t.id) +
            "' data-action='theme' data-theme='" + t.id + "'><div class='swatches'>" + t.sw.map(function (c) {
              return "<i style='background:" + c + "'></i>";
            }).join("") + "</div>" + esc(t.name) + "<small>" + esc(t.desc) + "</small></button>";
        }).join("") + "</div>" +
        "<div class='previews'>" +
        box("on", ST.tmdbKeySaved ? "With recommendations" : "With recommendations (needs a TMDB key)") +
        box("off", "Without: apps over landscapes") + "</div>";
    },

    profiles: function () {
      var recs = S.recommendations !== false;
      return head("Profiles", "One for each person who watches. Each keeps their own app order" +
        (recs ? ", Watch Later and recommendations" : "") + ". Switch from the top-left of the home screen.") +
        S.profiles.map(function (p, i) {
          var colors = Object.keys(CAT.colors).map(function (c) {
            return "<button type='button' role='radio' aria-label='" + c + "' aria-checked='" + (p.color === c) +
              "' data-action='color' data-i='" + i + "' data-color='" + c + "' style='background:" + CAT.colors[c] + "'></button>";
          }).join("");
          var tastes = Object.keys(CAT.tastes).map(function (t) {
            return "<option value='" + t + "'" + (p.taste === t ? " selected" : "") + ">" + esc(TASTE_NAMES[t] || t) + "</option>";
          }).join("");
          return "<div class='card profile-card'><div class='avatar' style='background:" + (CAT.colors[p.color] || CAT.colors.purple) + "'>" +
            esc(p.initial || "?") + "</div><div>" +
            "<label class='field' style='margin-top:0' for='pname-" + i + "'>Name</label>" +
            "<input type='text' id='pname-" + i + "' maxlength='16' data-profile='" + i + "' data-field='name' value='" + esc(p.name) + "'>" +
            "<label class='field'>Colour</label><div class='colors' role='radiogroup' aria-label='Colour'>" + colors + "</div>" +
            (recs ? "<label class='field' for='ptaste-" + i + "'>Taste to start from</label>" +
              "<select id='ptaste-" + i + "' data-profile='" + i + "' data-field='taste'>" + tastes + "</select>" +
              "<p class='hint'>Their Watch Later saves tune it from there.</p>" : "") +
            "</div><div>" + (S.profiles.length > 1 ? "<button class='btn small' data-action='remove-profile' data-i='" + i + "'>Remove</button>" : "") +
            "</div></div>";
        }).join("") +
        (S.profiles.length < MAX_PROFILES ? "<button class='btn' data-action='add-profile'>+ Add a profile</button>" : "");
    },

    tv: function () {
      var tvs = foundTvs ? (foundTvs.length ? foundTvs.map(function (t) {
        return "<button type='button' class='choice' style='text-align:left' role='radio' aria-checked='" + (S.tvIp === t.ip) +
          "' data-action='pick-tv' data-ip='" + esc(t.ip) + "'>" + esc(t.name) + "<small style='display:block;font-weight:400;color:var(--fg-dim)'>" +
          esc(t.model) + " · " + esc(t.ip) + "</small></button>";
      }).join("") : "<p>No Samsung TV answered. Is it on, and on the same Wi-Fi as this computer? You can also type its IP below.</p>") : "";
      return head("Your TV and apps", "Find the TV, then choose which apps get a tile.") +
        "<h2>Find your TV</h2><div class='card'><div class='row'><button class='btn' data-action='find-tv'>Find TVs on this network</button>" +
        "<span class='msg' id='find-msg'></span></div><div class='choices'>" + tvs + "</div>" +
        "<label class='field' for='tv-ip'>TV's IP address</label>" +
        "<input type='text' id='tv-ip' data-bind='tvIp' placeholder='e.g. 192.168.1.50' value='" + esc(S.tvIp || "") + "'>" +
        "<p class='hint'>On the TV: Settings → General → Network → Network Status → IP Settings.</p></div>" +
        "<h2>Apps on the home screen</h2><div class='card roomy'>" +
        "<p class='explain'>Zen TV can ask the TV which apps it has, and use their real icons on the tiles. " +
        (ST.tvPaired ? "This computer is already allowed to connect." :
          "The first time, the TV asks whether to allow <b>Zen TV Setup</b>: choose <b>Allow</b> with the remote.") + "</p>" +
        "<div class='row'><button class='btn' data-action='read-apps'" + (S.tvIp ? "" : " disabled") + ">Read apps from the TV</button>" +
        "<span class='msg' id='apps-msg'></span></div><pre class='log' id='apps-log'></pre>" + appList() +
        "<p class='hint'>Or pick them here by hand. Checked apps get a tile, in this order" +
        (tvApps ? "; unchecked ones on the TV still help Zen TV find where to watch." : ".") + "</p></div>";
    },

    devmode: function () {
      var profiles = ST.certProfiles || [];
      return head("Developer Mode and certificate",
        "Samsung TVs only install apps signed with your own certificate, from a computer you've allowed. " +
        "These two are done once, by you; the Check buttons confirm each worked.") +
        "<h2>1. Turn on Developer Mode</h2><div class='card'><ol class='guide'>" +
        "<li>Open <b>Apps</b><span>Press Home on the remote, then go to Apps.</span></li>" +
        "<li>Type <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd> <kbd>5</kbd><span>With the remote's number keys, or its on-screen number pad. A Developer Mode window opens.</span>" +
        "<span>No number keys? Use the <b>SmartThings</b> app on your phone: open your TV, tap the remote, then " +
        "<b>123</b> for a number pad.</span></li>" +
        "<li>Switch Developer mode <b>On</b></li>" +
        "<li>Enter this computer's IP: <code>" + esc(ST.computerIp || "?") + "</code><span>Then choose OK.</span></li>" +
        "<li>Restart the TV<span>Hold the power button on the remote until the TV turns off and back on.</span></li></ol>" +
        "<div class='row'><button class='btn' data-action='devmode'" + (S.tvIp ? "" : " disabled") + ">Check Developer Mode</button></div>" +
        "<p class='msg' id='dev-msg'></p></div>" +
        "<h2>2. Create your Samsung certificate</h2><div class='card'><ol class='guide'>" +
        "<li>Connect the TV in Tizen Studio<span>Tools → Device Manager → Remote Device Manager → <b>+</b>, enter the TV's IP (" +
        esc(S.tvIp || "from step 5") + "), then switch it to connected. This lets the certificate include your TV.</span></li>" +
        "<li>Open the Certificate Manager<span>Tools → Certificate Manager → <b>+</b> → <b>Samsung</b> → <b>TV</b>.</span></li>" +
        "<li>Name the profile<span>For example <code>ZenTV</code>.</span></li>" +
        "<li>Create an author certificate<span>Any name and a password you'll remember, then sign in with your Samsung account.</span></li>" +
        "<li>Create the distributor certificate<span>Keep privilege <b>Public</b>. Your TV's ID (DUID) should already be listed; then Finish.</span></li></ol>" +
        "<label class='field' for='cert'>Certificate profile</label>" +
        "<div class='row'><select class='grow' id='cert' data-bind='certificateProfile'>" +
        (profiles.length ? profiles.map(function (p) {
          return "<option" + (p === S.certificateProfile ? " selected" : "") + ">" + esc(p) + "</option>";
        }).join("") : "<option value=''>None found yet</option>") + "</select>" +
        "<button class='btn small' data-action='recheck'>Check again</button></div>" +
        (profiles.length ? status(profiles.indexOf(S.certificateProfile) >= 0, profiles.indexOf(S.certificateProfile) >= 0 ?
          "Using “" + esc(S.certificateProfile) + "”" + (ST.activeProfile === S.certificateProfile ? " (active in Tizen Studio)" : "") :
          "Choose your profile above") : status(false, "No certificate profiles found in Tizen Studio yet", "warn")) + "</div>";
    },

    install: function () {
      var recs = S.recommendations !== false;
      var rows = [
        ["Name", S.appName], ["Theme", (THEMES.filter(function (t) { return t.id === S.theme; })[0] || {}).name],
        ["Recommendations", recs ? (ST.tmdbKeySaved ? "On" : "On, but no TMDB key yet (landscapes only)") : "Off"],
        ["Profiles", S.profiles.map(function (p) { return p.name; }).join(", ")],
        ["Apps", S.apps.length + " tiles"], ["TV", S.tvIp || "not set"], ["Certificate", S.certificateProfile]
      ];
      return head("Install", "Builds Zen TV with your choices, signs it with your certificate and installs it on the TV.") +
        "<div class='card'>" + rows.map(function (r) {
          return "<div class='row' style='padding:5px 0'><span style='width:170px;color:var(--fg-dim)'>" + esc(r[0]) +
            "</span><span class='grow'>" + esc(r[1]) + "</span></div>";
        }).join("") + "</div>" +
        "<div style='margin:18px 0'>" + sw("_openAfter", openAfter, "Open Zen TV when it's installed",
          "Off: install quietly, so whatever is playing keeps playing.") + "</div>" +
        "<button class='btn primary' data-action='install'" + (S.tvIp ? "" : " disabled") + ">Install on the TV</button>" +
        "<p class='msg' id='install-msg'></p><pre class='log' id='install-log'></pre>" +
        "<h2>Open it when the TV turns on (optional)</h2><div class='card'>" +
        "<p>Uses the SmartThings app (with your TV added). Create a token at <a href='https://account.smartthings.com/tokens' target='_blank' rel='noopener'>account.smartthings.com/tokens</a> " +
        "with the <b>Devices</b>, <b>Locations</b> and <b>Rules</b> permissions, and paste it here.</p>" +
        "<div class='row'><input class='grow' type='password' id='st-token' autocomplete='off' placeholder='" +
        (ST.stTokenSaved ? "A token is saved (paste a new one to replace it)" : "SmartThings token") + "'>" +
        "<button class='btn' data-action='poweron'>Create the rule</button></div><pre class='log' id='st-log'></pre>" +
        "<p class='hint'>Also on the TV: Settings → General → Smart Features → turn off <b>Autorun Smart Hub</b>.</p></div>";
    }
  };

  function appList() {
    var known = {}; (ST.apps || []).forEach(function (a) { known[a.key] = a.name; });
    var onTv = null, others = 0;
    if (tvApps) {
      onTv = {};
      tvApps.forEach(function (a) { if (a.key) onTv[a.key] = true; else others++; });
    }
    var keys = S.apps.filter(function (k) { return typeof k === "string" && known[k]; });
    Object.keys(known).forEach(function (k) {
      if (keys.indexOf(k) < 0 && (!onTv || onTv[k])) keys.push(k);
    });
    return "<ul class='app-list'>" + keys.map(function (k) {
      var on = S.apps.indexOf(k) >= 0, pos = S.apps.indexOf(k);
      var missing = onTv && !onTv[k];
      return "<li class='" + (on ? "" : "off") + "'><input type='checkbox' aria-label='" + esc(known[k]) + "' data-action='toggle-app' data-key='" + k + "'" +
        (on ? " checked" : "") + "><span class='name'>" + esc(known[k]) + "</span>" +
        (missing ? "<span class='tag'>not on this TV</span>" : "") +
        (on ? "<button class='btn small' aria-label='Move " + esc(known[k]) + " up' data-action='app-up' data-key='" + k + "'" + (pos === 0 ? " disabled" : "") + ">↑</button>" +
          "<button class='btn small' aria-label='Move " + esc(known[k]) + " down' data-action='app-down' data-key='" + k + "'" +
          (pos === S.apps.length - 1 ? " disabled" : "") + ">↓</button>" : "") + "</li>";
    }).join("") + "</ul>" + (others ? "<p class='hint'>" + others + " other apps on the TV aren't in Zen TV's catalog.</p>" : "");
  }
  function syncAlsoInstalled() {
    if (!tvApps) return;
    S.alsoInstalled = tvApps.filter(function (a) { return a.key && S.apps.indexOf(a.key) < 0; }).map(function (a) { return a.key; });
  }

  function render() {
    renderSteps();
    var id = STEPS[current].id;
    $("panel").innerHTML = RENDER[id]() +
      "<div class='nav'><button class='btn' data-action='back'" + (current === 0 ? " disabled" : "") + ">Back</button>" +
      (current < STEPS.length - 1 ? "<button class='btn primary' data-action='next'>Continue</button>" : "<span></span>") + "</div>";
    if (id === "theme") loadPreview();
  }

  /* ---------- Live theme previews: the real home screen, with and without recommendations, scaled
     into the panel ---------- */
  function previewFrames() { return Array.prototype.slice.call(document.querySelectorAll(".preview iframe")); }
  function loadPreview() {
    var frames = previewFrames();
    if (!frames.length) return;
    fit();
    saveNow().then(function () {
      frames.forEach(function (frame) {
        frame.src = "launcher/index.html?theme=" + S.theme + "&recommendations=" + frame.getAttribute("data-recs") +
          "&t=" + Date.now();
      });
    });
  }
  function fit() {
    previewFrames().forEach(function (frame) {
      frame.style.transform = "scale(" + frame.parentNode.clientWidth / 1920 + ")";
    });
  }
  window.addEventListener("resize", fit);

  /* ---------- Edits ---------- */
  function setPath(path, value) {
    var parts = path.split("."), o = S;
    for (var i = 0; i < parts.length - 1; i++) o = o[parts[i]] = o[parts[i]] || {};
    o[parts[parts.length - 1]] = value;
  }
  $("panel").addEventListener("input", function (e) {
    var t = e.target;
    if (t.hasAttribute("data-bind")) {
      var key = t.getAttribute("data-bind");
      if (key === "_openAfter") { openAfter = t.checked; return; }
      var v = t.type === "checkbox" ? t.checked : t.value;
      if (key === "region") v = v.toUpperCase();
      if (key === "tvIp") v = v.trim();
      setPath(key, v);
      save();
      if (key === "recommendations") render();
      else renderSteps();
    } else if (t.hasAttribute("data-profile")) {
      var p = S.profiles[+t.getAttribute("data-profile")];
      p[t.getAttribute("data-field")] = t.value;
      if (t.getAttribute("data-field") === "name") {
        p.initial = (t.value.trim()[0] || "?").toUpperCase();
        t.closest(".profile-card").querySelector(".avatar").textContent = p.initial;
      }
      save();
      renderSteps();
    }
  });
  $("panel").addEventListener("change", function (e) {
    if (e.target.id === "icon-file" && e.target.files[0]) uploadIcon(e.target.files[0]);
    else if (e.target.id === "tizen-path") refreshState().then(render);
  });
  $("panel").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target.id === "city") { e.preventDefault(); findCity(); }
  });

  function uploadIcon(file) {
    if (file.size > 10 * 1024 * 1024) { say($("icon-msg"), false, "That image is over 10 MB: try a smaller one."); return; }
    var reader = new FileReader();
    reader.onload = function () {
      api("icon-upload", { dataUrl: reader.result }).then(function () {
        S.icon = "custom";
        save();
        return refreshState();
      }).then(render).catch(function (e) { say($("icon-msg"), false, "Couldn't use that image: " + e.message); });
    };
    reader.readAsDataURL(file);
  }

  function findCity() {
    var q = $("city").value.trim();
    if (!q) return;
    cityQuery = q;
    fetch("https://geocoding-api.open-meteo.com/v1/search?count=5&name=" + encodeURIComponent(q))
      .then(function (r) { return r.json(); }).then(function (d) {
        cityResults = (d.results || []).map(function (c) {
          return { label: [c.name, c.admin1, c.country].filter(Boolean).join(", "), name: c.name, lat: c.latitude, lon: c.longitude, cc: c.country_code };
        });
        if (!cityResults.length) cityResults = [{ label: "No match: try another spelling", none: true }];
        render();
      }).catch(function () { cityResults = [{ label: "Couldn't search (offline?)", none: true }]; render(); });
  }

  var ACTIONS = {
    back: function () { go(current - 1); },
    next: function () { go(current + 1); },
    recheck: function () { saveNow().then(refreshState).then(render); },
    packages: function () {
      runJob("packages", {}, $("pkg-log")).then(function () { return refreshState(); }).then(render);
    },
    "tmdb-save": function () {
      var key = $("tmdb-key").value.trim();
      if (!key) return say($("tmdb-msg"), false, "Paste your key first.");
      say($("tmdb-msg"), true, "Checking with TMDB…");
      S.tmdbKeyFile = "~/.zen-tv/tmdb-key"; // where the server saves it; a pending save mustn't undo that
      api("tmdb", { key: key }).then(function (r) {
        if (!r.ok) return say($("tmdb-msg"), false, r.message);
        return refreshState().then(function () {
          S.tmdbKeyFile = ST.settings.tmdbKeyFile; // the server moved it to ~/.zen-tv
          render();
          say($("tmdb-msg"), true, r.message);
        });
      }).catch(function (e) { say($("tmdb-msg"), false, e.message); });
    },
    "tmdb-remove": function () {
      api("tmdb", { key: "" }).then(function (r) {
        return refreshState().then(function () { render(); say($("tmdb-msg"), r.ok, r.message); });
      }).catch(function (e) { say($("tmdb-msg"), false, e.message); });
    },
    icon: function (b) { S.icon = b.getAttribute("data-icon"); save(); render(); },
    upload: function () { $("icon-file").click(); },
    city: findCity,
    "pick-city": function (b) {
      var c = cityResults[+b.getAttribute("data-i")];
      if (!c || c.none) return;
      var fahrenheit = ["US", "LR", "MM", "BS", "KY", "PW", "FM", "MH"].indexOf(c.cc) >= 0;
      S.weather = { latitude: c.lat, longitude: c.lon, units: fahrenheit ? "fahrenheit" : "celsius", city: c.name };
      if (c.cc) S.region = c.cc;
      cityResults = [];
      cityQuery = "";
      save();
      render();
    },
    theme: function (b) { S.theme = b.getAttribute("data-theme"); render(); },
    color: function (b) { S.profiles[+b.getAttribute("data-i")].color = b.getAttribute("data-color"); save(); render(); },
    "add-profile": function () {
      var colors = Object.keys(CAT.colors);
      S.profiles.push({ name: "", initial: "?", color: colors[S.profiles.length % colors.length], taste: "crime-drama" });
      save();
      render();
      var inputs = document.querySelectorAll("[data-field='name']");
      inputs[inputs.length - 1].focus();
    },
    "remove-profile": function (b) { S.profiles.splice(+b.getAttribute("data-i"), 1); save(); render(); },
    "find-tv": function (b) {
      b.disabled = true;
      say($("find-msg"), true, "Looking… (a few seconds)");
      api("find-tv", {}).then(function (r) {
        foundTvs = r.tvs;
        if (r.tvs.length === 1 && !S.tvIp) { S.tvIp = r.tvs[0].ip; save(); }
        render();
      }).catch(function (e) { b.disabled = false; say($("find-msg"), false, e.message); });
    },
    "pick-tv": function (b) { S.tvIp = b.getAttribute("data-ip"); save(); render(); },
    // Pairs first if this computer isn't allowed yet (the TV asks once), reads the installed apps, then
    // fetches the checked apps' icons
    "read-apps": function (b) {
      b.disabled = true;
      var paired = ST.tvPaired ? Promise.resolve(true) : (function () {
        say($("apps-msg"), true, "On the TV, choose Allow…");
        return runJob("pair", {}, $("apps-log")).then(function (ok) {
          return refreshState().then(function () { return ok && ST.tvPaired; });
        });
      })();
      paired.then(function (ok) {
        if (!ok) throw new Error("the TV didn't allow the connection. Try again and choose Allow on the TV");
        say($("apps-msg"), true, "Reading the apps…");
        return api("tv-apps", {});
      }).then(function (r) {
        tvApps = r.apps;
        S.apps = S.apps.filter(function (k) { return typeof k !== "string" || tvApps.some(function (a) { return a.key === k; }); });
        syncAlsoInstalled();
        render();
        say($("apps-msg"), true, "Getting their icons…");
        return runJob("icons", {}, $("apps-log")); // saves the settings first
      }).then(function (ok) {
        say($("apps-msg"), ok, ok ? "Apps and icons are in." : "Apps read; some icons didn't come through (those tiles show the app's name).");
      }).catch(function (e) {
        render();
        say($("apps-msg"), false, "Couldn't read the apps: " + e.message + ".");
      });
    },
    "toggle-app": function (b) {
      var k = b.getAttribute("data-key"), i = S.apps.indexOf(k);
      if (i >= 0) S.apps.splice(i, 1); else S.apps.push(k);
      syncAlsoInstalled();
      save();
      render();
    },
    "app-up": function (b) { moveApp(b.getAttribute("data-key"), -1); },
    "app-down": function (b) { moveApp(b.getAttribute("data-key"), 1); },
    devmode: function (b) {
      b.disabled = true;
      say($("dev-msg"), true, "Connecting to the TV…");
      saveNow().then(function () { return api("developer-mode", {}); }).then(function (r) {
        devModeOk = r.ok;
        renderSteps();
        b.disabled = false;
        say($("dev-msg"), r.ok, r.message);
      }).catch(function (e) { b.disabled = false; say($("dev-msg"), false, e.message); });
    },
    install: function (b) {
      b.disabled = true;
      say($("install-msg"), true, "Building and installing… (about a minute)");
      runJob("install", { open: openAfter }, $("install-log")).then(function (ok) {
        installedOk = ok;
        b.disabled = false;
        renderSteps();
        say($("install-msg"), ok, ok ? "Installed. Find it in the TV's Apps." : "Install didn't finish; the log below says why.");
      });
    },
    poweron: function (b) {
      var token = $("st-token").value.trim();
      if (!token && !ST.stTokenSaved) return say($("st-log"), false, "Paste a SmartThings token first.");
      b.disabled = true;
      runJob("poweron", { token: token }, $("st-log")).then(function () { b.disabled = false; return refreshState(); });
    }
  };
  function moveApp(k, d) {
    var i = S.apps.indexOf(k), j = i + d;
    if (i < 0 || j < 0 || j >= S.apps.length) return;
    S.apps.splice(j, 0, S.apps.splice(i, 1)[0]);
    save();
    render();
  }
  $("panel").addEventListener("click", function (e) {
    var b = e.target.closest("[data-action]");
    if (!b || b.disabled || !ACTIONS[b.getAttribute("data-action")]) return;
    if (b.type === "checkbox") { ACTIONS[b.getAttribute("data-action")](b); return; }
    e.preventDefault();
    ACTIONS[b.getAttribute("data-action")](b);
  });

  /* ---------- Donate panel (a native dialog: Esc and Close dismiss it; clicking outside does too) ---------- */
  var donate = $("donate");
  $("donate-open").addEventListener("click", function () { donate.showModal(); });
  $("donate-close").addEventListener("click", function () { donate.close(); });
  donate.addEventListener("click", function (e) {
    // the dialog's own padding counts as the dialog too: close only for clicks outside its box
    var r = donate.getBoundingClientRect();
    if (e.target === donate && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) donate.close();
  });

  refreshState().then(function () {
    S = withDefaults(ST.settings);
    render();
  }).catch(function (e) {
    $("panel").innerHTML = "<h1>Couldn't reach the installer</h1><p>" + esc(e.message) + ". Is <code>python3 install.py</code> still running?</p>";
  });
})();
