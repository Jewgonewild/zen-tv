/* Zen TV's TMDB data: profiles, the taste score, background lists and the Trending/Classics rows.
   Written for the 2018 Tizen engine: plain ES5, no arrow functions or template strings. */
window.ZEN_TITLES = (function () {
  // Hand-picked favourites: [type, title, year]. Year keeps remakes apart (Cape Fear 1991, not 1962).
  // One textless scene per title.

  // Profiles, from settings.json (window.ZEN_SETTINGS) and the catalog's taste presets. Each has its
  // own favourites (backgrounds), Classics taste and Trending priorities; see catalog.js.
  var SETTINGS = window.ZEN_SETTINGS || {};
  var CATALOG = window.ZEN_CATALOG;
  var REGION = SETTINGS.region || "US";
  var PROFILES = {};
  (SETTINGS.profiles && SETTINGS.profiles.length ? SETTINGS.profiles : [{ name: "Home" }]).forEach(function (p, i) {
    var taste = CATALOG.tastes[p.taste] || CATALOG.tastes["crime-drama"];
    var name = p.name || "Profile " + (i + 1);
    var id = name.toLowerCase().replace(/[^a-z0-9]/g, "") || "p" + i;
    if (PROFILES[id]) id += i;
    PROFILES[id] = {
      id: id, name: name, initial: p.initial || name.charAt(0).toUpperCase(),
      color: CATALOG.colors[p.color] || CATALOG.colors.purple,
      picks: p.favorites || taste.favorites,
      classicGenres: taste.classicGenres, classicsRow: taste.classicsRow,
      favorGenres: p.genres || taste.favorGenres, trendingOwn: taste.trendingOwn
    };
  });
  // Where a profile keeps something on the TV (localStorage)
  function profileKey(base, profile) {
    return base + "." + profile.id;
  }

  function rand(n) { return Math.floor(Math.random() * n); }
  function pickSome(list, n) {
    var a = list.slice(), outList = [];
    while (a.length && outList.length < n) outList.push(a.splice(rand(a.length), 1)[0]);
    return outList;
  }
  // Local calendar date (toISOString would give tomorrow's date on US evenings)
  function isoDate(d) {
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }

  // Classic discoveries: each refresh digs a random page of well-loved older films in a few of the
  // profile's genres, plus acclaimed film and TV in its first genre, so titles that never trend keep
  // surfacing.
  function classics(genres) {
    var main = genres[0];
    return pickSome(genres, 3).map(function (g) {
      return "/discover/movie?with_genres=" + g + "&primary_release_date.lte=1999-12-31&vote_average.gte=7" +
        "&vote_count.gte=800&sort_by=vote_count.desc&without_genres=16&page=" + (1 + rand(5));
    }).concat([
      "/discover/movie?with_genres=" + main + "&sort_by=vote_count.desc&vote_count.gte=3000&without_genres=16&page=" + (1 + rand(5)),
      "/discover/tv?with_genres=" + main + "&without_genres=16&sort_by=vote_count.desc&vote_count.gte=300&page=" + (1 + rand(3))
    ]);
  }

  // Trending & new: what's hot this week, in theatres, coming soon, recently premiered, airing now
  function fresh() {
    var now = new Date();
    var sixMonthsAgo = new Date(now.getTime()); sixMonthsAgo.setMonth(now.getMonth() - 6);
    var inAWeek = new Date(now.getTime() + 7 * 86400000);
    return [
      "/trending/movie/week",
      "/trending/tv/week",
      "/movie/now_playing?region=" + REGION,
      "/movie/upcoming?region=" + REGION,
      "/discover/tv?sort_by=popularity.desc&first_air_date.gte=" + isoDate(sixMonthsAgo) + "&vote_count.gte=20&with_original_language=en",
      "/discover/tv?sort_by=popularity.desc&air_date.gte=" + isoDate(now) + "&air_date.lte=" + isoDate(inAWeek) +
        "&vote_count.gte=50&with_original_language=en&without_genres=10763,10767" // skip news & talk shows
    ];
  }

  var RECS_SEEDS = 10;      // favourites used for "Because you like …" each refresh
  var RECS_PER_SEED = 4;     // so one franchise (all the Batman films) can't flood the rotation
  var RECS_MIN_VOTES = 2000; // recommendations must be rated 7+ by at least this many people
  var IMAGE_CHOICES = 5;    // a pick shows one of its best few textless scenes, chosen per refresh

  var API = "https://api.themoviedb.org/3";

  // GET a TMDB path; a v4 read token (long) goes in a header, a v3 key in the query string.
  // At most MAX_IN_FLIGHT requests run at once, so a refresh never floods the TV's network/CPU.
  // urgent (search) jumps the queue, so it never waits behind a background refresh. XHR rather than
  // fetch so a request that hangs is given up after REQUEST_TIMEOUT_MS (Chrome 56 can't cancel a
  // fetch) instead of holding one of the six slots forever.
  var MAX_IN_FLIGHT = 6;
  var REQUEST_TIMEOUT_MS = 10000;
  var inFlight = 0, waiting = [];
  function tmdb(key, path, urgent) {
    return new Promise(function (resolve, reject) {
      var run = function () {
        var bearer = key.length > 40;
        var x = new XMLHttpRequest(), settled = false;
        var settle = function (ok, value) {
          if (settled) return;
          settled = true;
          inFlight--; pump();
          if (ok) resolve(value); else reject(value);
        };
        x.onload = function () {
          if (x.status < 200 || x.status >= 300) { settle(false, x.status); return; }
          var data;
          try { data = JSON.parse(x.responseText); } catch (e) { settle(false, "bad json"); return; }
          settle(true, data);
        };
        x.onerror = x.ontimeout = function () { settle(false, "no answer"); };
        try {
          x.open("GET", API + path + (bearer ? "" : (path.indexOf("?") < 0 ? "?" : "&") + "api_key=" + key));
          if (bearer) x.setRequestHeader("Authorization", "Bearer " + key);
          x.timeout = REQUEST_TIMEOUT_MS;
          x.send();
        } catch (e) { settle(false, "couldn't send"); } // never leave a slot taken
      };
      if (urgent) waiting.unshift(run); else waiting.push(run);
      pump();
    });
  }
  function pump() {
    while (!paused && inFlight < MAX_IN_FLIGHT && waiting.length) { inFlight++; waiting.shift()(); }
  }
  // While another app starts or is on screen, queued requests wait (requests already sent finish):
  // a launching app gets the TV's network and CPU to itself
  var paused = false;
  function setPaused(p) {
    paused = p;
    if (!p) pump();
  }

  // Picks never change, so their lookups (TMDB id + best textless images, or "not found") are cached
  // on the TV per profile: a restart costs a couple of requests instead of ~200. Each entry expires on
  // its own (with a random head start, so they don't all refetch in the same week).
  var PICKS_CACHE_KEY = "zen.picks.v2";
  var PICK_MAX_AGE_MS = 7 * 86400000;
  function readPicksCache(profile) {
    try { return JSON.parse(localStorage.getItem(profileKey(PICKS_CACHE_KEY, profile))) || {}; } catch (e) { return {}; }
  }
  function writePicksCache(profile, items) {
    try { localStorage.setItem(profileKey(PICKS_CACHE_KEY, profile), JSON.stringify(items)); } catch (e) {}
  }
  // TMDB genre IDs (movie and TV share most), shortened for the hero line
  var GENRES = {
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 99: "Documentary",
    18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music",
    9648: "Mystery", 10749: "Romance", 878: "Sci-Fi", 10770: "TV Movie", 53: "Thriller",
    10752: "War", 37: "Western", 10759: "Action", 10762: "Kids", 10763: "News", 10764: "Reality",
    10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk", 10768: "War & Politics"
  };
  var OVERVIEW_MAX = 200;
  var GENRE_IDS = {}; // name -> first id, for Watch Later items saved before they kept genre IDs
  Object.keys(GENRES).forEach(function (id) { if (!GENRE_IDS[GENRES[id]]) GENRE_IDS[GENRES[id]] = +id; });

  function entry(type, item, path, reason) {
    var genres = [];
    (item.genre_ids || []).forEach(function (g) {
      if (GENRES[g] && genres.indexOf(GENRES[g]) < 0 && genres.length < 2) genres.push(GENRES[g]);
    });
    return {
      id: type + item.id, tmdbId: item.id, type: type, path: path,
      title: item.title || item.name,
      year: (item.release_date || item.first_air_date || "").slice(0, 4),
      genres: genres,
      genreIds: (item.genre_ids || []).slice(),
      overview: (item.overview || "").slice(0, OVERVIEW_MAX), // the hero shows ~150; keeps caches small
      reason: reason || ""
    };
  }

  /* ---------- Taste: what a profile leans toward ---------- */
  // Genre weights: the profile's starting taste plus a point per genre for each title saved to its
  // Watch Later (capped, so twenty saved dramas can't drown everything else). Trending is ranked by
  // it, today's Classics lean on it, and saved titles seed "Because you saved …" backgrounds.
  var SAVE_CAP = 4;
  function savedGenres(it) {
    if (it.genreIds && it.genreIds.length) return it.genreIds;
    // older saves only have the hero line ("1995 · Crime · Drama")
    return (it.sub || "").split(" · ").map(function (name) { return GENRE_IDS[name]; }).filter(Boolean);
  }
  function taste(profile, saved) {
    var w = {}, counts = {};
    Object.keys(profile.favorGenres).forEach(function (g) { w[g] = profile.favorGenres[g]; });
    (saved || []).forEach(function (it) {
      savedGenres(it).forEach(function (g) { counts[g] = (counts[g] || 0) + 1; });
    });
    Object.keys(counts).forEach(function (g) { w[g] = (w[g] || 0) + Math.min(counts[g], SAVE_CAP); });
    return w;
  }
  function score(it, w) {
    return (it.genreIds || []).reduce(function (s, g) { return s + (w[g] || 0); }, 0);
  }
  // The strongest few genres, for fetching more of what the profile likes
  function topGenres(w, n) {
    return Object.keys(w).filter(function (g) { return w[g] > 0 && SKIP_GENRES.indexOf(+g) < 0; })
      .sort(function (a, b) { return w[b] - w[a] || a - b; }).slice(0, n);
  }
  // Highest value first; ties keep their order (Chrome 56's sort isn't stable, so index breaks ties)
  function rankBy(items, value) {
    return items.map(function (it, i) { return { it: it, v: value(it, i), i: i }; })
      .sort(function (a, b) { return b.v - a.v || a.i - b.i; })
      .map(function (x) { return x.it; });
  }

  // Resolve everything into { picks, recs, classics, fresh }, each a list of
  // { id, type: "movie"|"tv", title, year, path, reason } (path is a TMDB image path), one image
  // per title, no title repeated across groups. Picks resolve first so the rest can skip them.
  // profile: one of PROFILES; saved: its Watch Later items.
  var SAVED_SEEDS = 5; // most recent saves used for "Because you saved …"
  function load(key, profile, saved, done) {
    var seen = {};
    var out = { picks: [], recs: [], classics: [], fresh: [] };

    var cache = readPicksCache(profile), kept = {}; // kept: the picks cache to write back
    var cacheDirty = false;

    // A pick resolves to { hit, paths }: the TMDB search result and its best textless images (null
    // if TMDB doesn't have it). Each refresh shows one of those images at random.
    function resolvePick(p) {
      var type = p[0], cacheKey = p.join("|");
      var cached = cache[cacheKey];
      if (cached && Date.now() - cached.at < PICK_MAX_AGE_MS) kept[cacheKey] = cached;
      else cacheDirty = true;
      var lookup = kept[cacheKey] ? Promise.resolve(kept[cacheKey].found) : lookupPick(p).then(function (found) {
        // first lookups get a random head start on expiry, so a week later they don't all refetch at once
        kept[cacheKey] = { at: Date.now() - (cached ? 0 : rand(PICK_MAX_AGE_MS / 2)), found: found };
        return found;
      }, function (err) {
        // offline: an expired entry is still better than none (it's refetched on the next run)
        if (!cached) throw err;
        kept[cacheKey] = cached;
        return cached.found;
      });
      return lookup.then(function (found) {
        if (!found) return null;
        var path = found.paths.length ? found.paths[rand(found.paths.length)] : found.hit.backdrop_path;
        return path ? entry(type, found.hit, path) : null;
      }).catch(function () { return null; });
    }
    function lookupPick(p) {
      var type = p[0], yearParam = type === "tv" ? "first_air_date_year" : "primary_release_year";
      return tmdb(key, "/search/" + type + "?query=" + encodeURIComponent(p[1]) + "&" + yearParam + "=" + p[2])
        .then(function (d) {
          var r = d.results && d.results[0];
          if (!r) return null;
          // keep just the fields entry() needs, so the cache stays small
          var hit = { id: r.id, title: r.title, name: r.name, release_date: r.release_date,
            first_air_date: r.first_air_date, genre_ids: r.genre_ids,
            overview: (r.overview || "").slice(0, OVERVIEW_MAX), backdrop_path: r.backdrop_path };
          // include_image_language=null keeps only textless backdrops (no title lettering)
          return tmdb(key, "/" + type + "/" + r.id + "/images?include_image_language=null").then(function (imgs) {
            var paths = (imgs.backdrops || [])
              .filter(function (b) { return b.width >= 1920; })
              .sort(function (a, b) { return b.vote_average - a.vote_average; })
              .slice(0, IMAGE_CHOICES)
              .map(function (b) { return b.file_path; });
            return { hit: hit, paths: paths };
          });
        });
    }

    // minVotes (optional) keeps only well-regarded, live-action titles: rated 7+ with at least that
    // many votes, and not animation (genre 16)
    function fromList(path, reason, minVotes) {
      var type = path.indexOf("/tv") >= 0 ? "tv" : "movie";
      return tmdb(key, path).then(function (d) {
        // A random page past the end comes back empty; fall back to page 1
        if (!(d.results || []).length && /page=([2-9]|\d\d)/.test(path)) {
          return tmdb(key, path.replace(/page=\d+/, "page=1"));
        }
        return d;
      }).then(function (d) {
        return (d.results || []).filter(function (m) {
          return !minVotes || (m.vote_average >= 7 && m.vote_count >= minVotes &&
            (m.genre_ids || []).indexOf(16) < 0);
        }).slice(0, 20).map(function (m) {
          // trending lists mix types; media_type says which
          return m.backdrop_path ? entry(m.media_type || type, m, m.backdrop_path, reason) : null;
        });
      }).catch(function () { return []; });
    }
    function recsFor(it, reason) {
      return fromList("/" + it.type + "/" + it.tmdbId + "/recommendations", reason, RECS_MIN_VOTES)
        .then(function (l) { return l.slice(0, RECS_PER_SEED); });
    }

    function add(group, items) {
      items.forEach(function (it) {
        if (it && !seen[it.id]) { seen[it.id] = true; out[group].push(it); }
      });
    }
    function addLists(group) {
      return function (lists) { lists.forEach(function (l) { add(group, l); }); };
    }

    Promise.all(profile.picks.map(resolvePick)).then(function (resolved) {
      if (cacheDirty) writePicksCache(profile, kept); // only current picks: removed ones drop out
      add("picks", resolved);
      // Recommendations: from the latest Watch Later saves first, then a few random favourites
      var fromSaves = (saved || []).filter(function (it) { return it.tmdbId && it.type; }).slice(0, SAVED_SEEDS);
      return Promise.all(fromSaves.map(function (it) { return recsFor(it, "Because you saved " + it.title); })
        .concat(pickSome(out.picks, Math.max(0, RECS_SEEDS - fromSaves.length)).map(function (p) {
          return recsFor(p, "Because you like " + p.title);
        })));
    }).then(addLists("recs")).then(function () {
      return Promise.all(classics(profile.classicGenres).map(function (p) { return fromList(p, "Classic"); }));
    }).then(addLists("classics")).then(function () {
      return Promise.all(fresh().map(function (p) { return fromList(p, "Trending & new"); }));
    }).then(addLists("fresh")).then(function () {
      done(out);
    }).catch(function () { done(out); });
  }

  // The "Trending" and "Classics" rows are fetched once per calendar day (per profile) and kept on
  // the TV, so they change every day and a restart doesn't refetch them. variant: what else the
  // fetch depends on (e.g. the profile's top genres); a different one refetches.
  // build(finish) calls finish(items, complete): a result with failed requests is shown but not
  // kept, so a TV that starts before its Wi-Fi is up doesn't keep an empty row all day.
  // cacheOnly: answer from today's saved list or with null, never fetch (instant first paint).
  function daily(cacheKey, variant, build, done, cacheOnly) {
    var today = isoDate(new Date());
    try {
      var c = JSON.parse(localStorage.getItem(cacheKey));
      if (c && c.date === today && c.variant === variant && c.items.length) { done(c.items); return; }
    } catch (e) {}
    if (cacheOnly) { done(null); return; }
    build(function (items, complete) {
      if (items.length && complete) {
        try { localStorage.setItem(cacheKey, JSON.stringify({ date: today, variant: variant, items: items })); } catch (e) {}
      }
      done(items);
    });
  }
  var SKIP_GENRES = [16, 10763, 10764, 10767]; // animation, news, reality, talk
  function skipped(m, genres) {
    return (m.genre_ids || []).some(function (g) { return (genres || SKIP_GENRES).indexOf(g) >= 0; });
  }

  // "Trending": TMDB's trending-today list, kept only when it streams on one of this TV's apps
  // (US, subscription or free with ads), plus popular recent titles in the profile's top genres (or,
  // with trendingOwn, only titles in the profile's genres plus its own top-up queries),
  // ranked by the profile's taste (ties keep trending order). Titles actually trending today get a
  // head start, so a top-up only outranks them when it matches the profile's taste clearly better.
  // Re-ranked on every call, so a new save reorders it straight away.
  // providerApps: { tmdbProviderId: appKey }. done(row, all): the row's 20 and the full ranked list
  // (for "View more"), or done(null) when cacheOnly and not cached.
  var TRENDING_PAGES = 3; // 60 titles to check; about a third stream on the apps here
  var FAILURE_TOLERANCE = 0.05; // keep the day's list unless more than 5% of its requests failed

  // Which app a title streams on, shared by every profile and kept for a few days: both profiles see
  // many of the same trending titles, and most are still trending tomorrow, so the daily refresh only
  // looks up the ones it hasn't seen lately. { "tv123": { at, app (or null: not on an app here) } }
  var PROVIDER_CACHE_KEY = "zen.providers.v1", PROVIDER_CACHE_MS = 3 * 86400000;
  function readProviderCache() {
    try { return JSON.parse(localStorage.getItem(PROVIDER_CACHE_KEY)) || {}; } catch (e) { return {}; }
  }
  function writeProviderCache(cache) {
    var now = Date.now(), kept = {}, stored = readProviderCache();
    // merged with what's stored now: another refresh may have written since this one read it
    [stored, cache].forEach(function (c) {
      Object.keys(c).forEach(function (k) { if (now - c[k].at < PROVIDER_CACHE_MS) kept[k] = c[k]; });
    });
    try { localStorage.setItem(PROVIDER_CACHE_KEY, JSON.stringify(kept)); } catch (e) {}
  }
  var TRENDING_MAX = 20;
  var TOP_GENRES = 3;
  var TRENDING_HEAD_START = 3; // in genre-weight points
  function trendingToday(key, providerApps, profile, saved, done, cacheOnly) {
    var w = taste(profile, saved), top = topGenres(w, TOP_GENRES);
    var own = profile.trendingOwn;
    daily(profileKey("zen.trending.v4", profile), own ? "own" : top.join("|"), function (finish) {
      var lists = [], failed = 0, requests = 0;
      for (var i = 1; i <= TRENDING_PAGES; i++) lists.push("/trending/all/day?page=" + i);
      // what's popular lately in the genres this profile likes, on the apps here
      var yearAgo = new Date(); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
      var base = "?watch_region=" + REGION + "&with_watch_monetization_types=flatrate|ads&sort_by=popularity.desc" +
        "&with_watch_providers=" + Object.keys(providerApps).join("|") +
        "&without_genres=" + SKIP_GENRES.join("|") + "&vote_count.gte=200";
      function topUp(type, genres) {
        lists.push("/discover/" + type + base + "&with_genres=" + genres +
          (type === "movie" ? "&primary_release_date.gte=" : "&first_air_date.gte=") + isoDate(yearAgo));
      }
      if (own) own.topUps.forEach(function (q) { topUp(q.split(":")[0], q.split(":")[1]); });
      else if (top.length) { topUp("movie", top.join("|")); topUp("tv", top.join("|")); }
      Promise.all(lists.map(function (path) {
        var type = path.indexOf("/discover/tv") === 0 ? "tv" : path.indexOf("/discover/movie") === 0 ? "movie" : null;
        return tmdb(key, path).then(function (d) {
          return (d.results || []).map(function (m) { if (type) m.media_type = type; else m.trending = true; return m; });
        }).catch(function () { failed++; return []; });
      })).then(function (ds) {
        var seen = {}, titles = [];
        ds.forEach(function (results) {
          results.forEach(function (m) {
            var type = m.media_type;
            if ((type !== "movie" && type !== "tv") || !m.backdrop_path || skipped(m) || seen[type + m.id]) return;
            // trendingOwn: only the profile's genres, and nothing its taste leans against
            if (own && !((m.genre_ids || []).some(function (g) { return own.genres[type].indexOf(g) >= 0; }) &&
              score({ genreIds: m.genre_ids }, w) > 0)) return;
            seen[type + m.id] = true;
            titles.push(m);
          });
        });
        var known = readProviderCache(), now = Date.now();
        requests = lists.length + titles.length;
        return Promise.all(titles.map(function (m) {
          var id = m.media_type + m.id, hit = known[id];
          var lookup = hit && now - hit.at < PROVIDER_CACHE_MS ? Promise.resolve(hit.app) :
            tmdb(key, "/" + m.media_type + "/" + m.id + "/watch/providers").then(function (p) {
              var us = (p.results && p.results[REGION]) || {};
              var app = null;
              (us.flatrate || []).concat(us.ads || [], us.free || []).some(function (s) {
                app = providerApps[s.provider_id] || null;
                return !!app;
              });
              known[id] = { at: Date.now(), app: app };
              return app;
            });
          return lookup.then(function (app) {
            if (!app) return null;
            var e = entry(m.media_type, m, m.backdrop_path, "Trending");
            e.app = app;
            e.trending = !!m.trending;
            return e;
          }).catch(function () { failed++; return null; });
        })).then(function (items) {
          writeProviderCache(known);
          return items;
        });
      }).then(function (items) {
        finish(items.filter(Boolean), failed <= requests * FAILURE_TOLERANCE);
      }).catch(function () { finish([], false); });
    }, function (items) {
      if (!items) { done(null); return; }
      var ranked = rankBy(items, function (it) { return score(it, w) + (it.trending ? TRENDING_HEAD_START : 0); });
      done(ranked.slice(0, TRENDING_MAX), ranked);
    }, cacheOnly);
  }

  // "Classics": the highest-rated older films and shows on each of this TV's apps, in the profile's
  // genres (well-known ones only: lots of votes). Each app has a few dozen; every day picks a few,
  // favouring the profile's taste with a daily shuffle for variety. Services are interleaved so the
  // row mixes them. Shows skip fantasy and soaps: by rating alone, fan-favourite teen and kids' shows
  // outrank The Sopranos.
  // services: [{ app: "netflix", providers: "8|1796" }, …] (TMDB provider IDs, | = any of).
  // done(row, more): the row's 20 and a longer list for "View more", or done(null) when cacheOnly
  // and not cached.
  var CLASSICS_PER_QUERY = 3;
  var CLASSICS_MAX = 20;
  var CLASSICS_MORE_PER_QUERY = 8, CLASSICS_MORE_MAX = 96; // the "View more" grid
  var CLASSIC_POOL_MAX = 30; // per app and type: the best-rated 30 are plenty to rotate through
  var CLASSIC_YEARS = 15;
  var DAILY_SHUFFLE = 3; // how much the daily shuffle counts against taste (in genre-weight points)
  var CLASSIC_SKIP = {
    movie: SKIP_GENRES.concat([10751]),              // also family
    tv: SKIP_GENRES.concat([10751, 10762, 10765, 10766]) // also family, kids, sci-fi & fantasy, soap
  };
  // Same order all day, a new one tomorrow (a small seeded generator, so the pick is stable per day)
  function shuffleForDay(list, seed) {
    var a = list.slice();
    seed = seed % 2147483646 + 1; // Park–Miller: stays exact in JS numbers
    for (var i = a.length - 1; i > 0; i--) {
      seed = seed * 16807 % 2147483647;
      var j = seed % (i + 1);
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function classicsOnApps(key, services, profile, saved, done, cacheOnly) {
    var w = taste(profile, saved);
    var now = new Date();
    var dayNumber = Math.floor((now.getTime() - now.getTimezoneOffset() * 60000) / 86400000);
    // Fetched once a day: each app's pool of qualifying films and shows ({ app, movie, tv })
    daily(profileKey("zen.classics.v3", profile), "", function (finish) {
      var cutoff = isoDate(new Date(now.getFullYear() - CLASSIC_YEARS, now.getMonth(), now.getDate()));
      var failed = 0;
      function query(type, providers, page) {
        var q = profile.classicsRow[type];
        return "/discover/" + type + "?watch_region=" + REGION + "&with_watch_monetization_types=flatrate|ads" +
          "&sort_by=vote_average.desc&without_genres=" + CLASSIC_SKIP[type].join("|") +
          "&with_watch_providers=" + providers + "&page=" + page +
          (type === "movie" ? "&primary_release_date.lte=" : "&first_air_date.lte=") + cutoff +
          "&vote_average.gte=" + q.rating + "&vote_count.gte=" + q.votes +
          (q.genres ? "&with_genres=" + q.genres.join("|") : "");
      }
      // An app's best (two pages of 20, kept to CLASSIC_POOL_MAX)
      function pool(type, providers) {
        return Promise.all([1, 2].map(function (page) {
          return tmdb(key, query(type, providers, page)).catch(function () { failed++; return {}; });
        })).then(function (ds) {
          return (ds[0].results || []).concat(ds[1].results || [])
            .filter(function (m) { return m.backdrop_path && !skipped(m, CLASSIC_SKIP[type]); })
            .slice(0, CLASSIC_POOL_MAX)
            .map(function (m) { return entry(type, m, m.backdrop_path, "Classic"); });
        });
      }
      Promise.all(services.map(function (s) {
        return Promise.all([pool("movie", s.providers), pool("tv", s.providers)]).then(function (p) {
          return { app: s.app, movie: p[0], tv: p[1] };
        });
      })).then(function (pools) {
        var any = pools.some(function (p) { return p.movie.length || p.tv.length; });
        finish(any ? pools : [], failed <= services.length * 4 * FAILURE_TOLERANCE); // 4 requests per app
      }).catch(function () { finish([], false); });
    }, function (pools) {
      if (!pools) { done(null); return; }
      // Today's few per app: taste plus a daily shuffle, so the row leans toward what the profile
      // likes but still changes every day. The "View more" grid takes more of the same order.
      function todays(list, seed, n) {
        // never something the taste leans against (e.g. war dramas for a romance-comedy profile); a profile with its
        // own rows (trendingOwn) also skips titles its taste is neutral about
        var floor = profile.trendingOwn ? 1 : 0;
        list = list.filter(function (it) { return score(it, w) >= floor; });
        var shuffled = shuffleForDay(list, seed), len = shuffled.length;
        return rankBy(shuffled, function (it, i) { return score(it, w) + DAILY_SHUFFLE * (1 - i / len); })
          .slice(0, n);
      }
      function pick(perQuery, max) {
        var perService = pools.map(function (p, n) {
          var seed = dayNumber * 31 + n;
          var lists = [todays(p.movie, seed, perQuery), todays(p.tv, seed + 7, perQuery)];
          // alternate films and shows within a service
          var merged = [];
          for (var i = 0; i < perQuery; i++) {
            lists.forEach(function (l) { if (l[i]) { l[i].app = p.app; merged.push(l[i]); } });
          }
          return merged;
        });
        var seen = {}, out = [];
        for (var i = 0; out.length < max; i++) {
          var any = false;
          perService.forEach(function (l) {
            if (!l[i]) return;
            any = true;
            if (!seen[l[i].id] && out.length < max) { seen[l[i].id] = true; out.push(l[i]); }
          });
          if (!any) break;
        }
        return out;
      }
      done(pick(CLASSICS_PER_QUERY, CLASSICS_MAX), pick(CLASSICS_MORE_PER_QUERY, CLASSICS_MORE_MAX));
    }, cacheOnly);
  }

  return {
    profiles: PROFILES, profileKey: profileKey, region: REGION, toEntry: entry, setPaused: setPaused,
    load: load, api: tmdb, trendingToday: trendingToday, classicsOnApps: classicsOnApps
  };
})();
