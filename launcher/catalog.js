/* What Zen TV knows out of the box: streaming apps it can open, and taste presets for profiles.
   settings.json (see settings.example.json) picks from these. Plain ES5 for the TV's 2018 engine. */
window.ZEN_CATALOG = {
  // Apps, by the key settings.json uses.
  //   store      Samsung app-store ID: opened through the TV's own launch service, like its home bar,
  //              so the app opens with the same sign-in as from Samsung's home screen
  //   ids        Tizen app IDs, only tried if that service doesn't answer (some apps are installed
  //              under more than one ID; leave empty when unsure)
  //   providers  TMDB watch-provider IDs (JustWatch data), so Trending/Classics/Watch Later know which
  //              titles stream on this app. Empty for apps without movies/shows to look up.
  // `python3 scripts/zentv.py apps` lists what's installed on a TV, with store IDs.
  apps: {
    netflix:   { name: "Netflix",     store: "11101200001",   ids: ["org.tizen.netflix-app"], providers: [8, 1796] },
    youtube:   { name: "YouTube",     store: "111299001912",  ids: ["9Ur5IzDKqV.TizenYouTube"], providers: [] },
    prime:     { name: "Prime Video", store: "3201512006785", ids: ["evKhCgZelL.AmazonIgnitionLauncher2"], providers: [9, 119, 2100] },
    youtubetv: { name: "YouTube TV",  store: "3201707014489", ids: ["com.samsung.tv.cobalt-yttv"], providers: [] },
    appletv:   { name: "Apple TV",    store: "3201807016597", ids: ["com.samsung.tv.aria-video"], providers: [350] },
    paramount: { name: "Paramount+",  store: "3201710014981", ids: ["rJyOSqC6Up.CBSAllAccess"], providers: [531, 2303, 2616] },
    espn:      { name: "ESPN",        store: "3201708014618", ids: ["XtU8fQk2gN.ESPN"], providers: [] },
    hulu:      { name: "Hulu",        store: "3201601007625", ids: ["LBUAQX1exg.Hulu"], providers: [15] },
    disney:    { name: "Disney+",     store: "3201901017640", ids: [], providers: [337] },
    max:       { name: "Max",         store: "3202301029760", ids: [], providers: [1899, 384] },
    peacock:   { name: "Peacock",     store: "3202006020991", ids: [], providers: [386, 387] },
    spotify:   { name: "Spotify",     store: "3201606009684", ids: [], providers: [] }
  },

  // Profile avatar colours
  colors: {
    purple: "linear-gradient(145deg, #8e8cf6 0%, #5e5ce6 45%, #bf5af2 100%)",
    pink:   "linear-gradient(145deg, #ff9f8e 0%, #ff5e8a 50%, #d65ae6 100%)",
    blue:   "linear-gradient(145deg, #64d2ff 0%, #0a84ff 55%, #5e5ce6 100%)",
    green:  "linear-gradient(145deg, #7ee8a2 0%, #30d158 50%, #0a9e6e 100%)",
    orange: "linear-gradient(145deg, #ffd27a 0%, #ff9f0a 50%, #ff6b3d 100%)",
    teal:   "linear-gradient(145deg, #8ff0e8 0%, #40c8e0 50%, #0a84ff 100%)"
  },

  // Taste presets. A profile picks one with "taste" and can override its favourites or genre weights.
  //   favorites      [type, title, year]: the profile's own movie/TV backgrounds (year keeps remakes
  //                  apart); "Because you like …" recommendations grow from these
  //   classicGenres  TMDB genre IDs for the "Classic" backgrounds
  //   classicsRow    the Classics row's queries per type: genres to require (null = any) and the
  //                  rating / vote floors (rom-coms rate lower than crime epics)
  //   favorGenres    { genreId: weight }: the starting taste (negative = less of it); Watch Later
  //                  saves add to it
  //   trendingOwn    optional: Trending keeps only titles in these genres (per type) and tops up from
  //                  these queries ("a,b" = both genres, "a|b" = either)
  tastes: {
    "crime-drama": {
      favorites: [
        // Crime & prestige TV
        ["tv", "Breaking Bad", 2008], ["tv", "The Sopranos", 1999], ["tv", "Better Call Saul", 2015],
        ["tv", "The Wire", 2002], ["tv", "Boardwalk Empire", 2010], ["tv", "Ozark", 2017],
        ["tv", "Fargo", 2014], ["tv", "True Detective", 2014], ["tv", "Mad Men", 2007],
        ["tv", "Succession", 2018], ["tv", "Peaky Blinders", 2013], ["tv", "Narcos", 2015],
        ["tv", "Mindhunter", 2017], ["tv", "The Shield", 2002], ["tv", "Deadwood", 2004],
        ["tv", "Sons of Anarchy", 2008], ["tv", "Justified", 2010], ["tv", "Yellowstone", 2018],
        ["tv", "Dexter", 2006], ["tv", "Band of Brothers", 2001], ["tv", "Chernobyl", 2019],
        ["tv", "The Penguin", 2024], ["tv", "Mare of Easttown", 2021], ["tv", "The Night Of", 2016],
        ["tv", "Godfather of Harlem", 2019], ["tv", "Bosch", 2014], ["tv", "Billions", 2016],
        ["tv", "The Bear", 2022], ["tv", "Severance", 2022], ["tv", "House of Cards", 2013],
        ["tv", "Gomorrah", 2014], ["tv", "Line of Duty", 2012],
        // Classics: Scorsese, De Niro, Pacino
        ["movie", "The Godfather", 1972], ["movie", "The Godfather Part II", 1974], ["movie", "The Godfather Part III", 1990],
        ["movie", "Casino", 1995], ["movie", "Cape Fear", 1991], ["movie", "Goodfellas", 1990],
        ["movie", "Taxi Driver", 1976], ["movie", "The Irishman", 2019], ["movie", "The Departed", 2006],
        ["movie", "Raging Bull", 1980], ["movie", "Mean Streets", 1973], ["movie", "Gangs of New York", 2002],
        ["movie", "The Wolf of Wall Street", 2013], ["movie", "Killers of the Flower Moon", 2023],
        ["movie", "A Bronx Tale", 1993], ["movie", "Donnie Brasco", 1997], ["movie", "Carlito's Way", 1993],
        ["movie", "Scarface", 1983], ["movie", "Serpico", 1973], ["movie", "Dog Day Afternoon", 1975],
        ["movie", "The Untouchables", 1987], ["movie", "Once Upon a Time in America", 1984], ["movie", "Heat", 1995],
        // Crime & thrillers
        ["movie", "Chinatown", 1974], ["movie", "The French Connection", 1971], ["movie", "Miller's Crossing", 1990],
        ["movie", "No Country for Old Men", 2007], ["movie", "Sicario", 2015], ["movie", "Prisoners", 2013],
        ["movie", "Zodiac", 2007], ["movie", "Se7en", 1995], ["movie", "L.A. Confidential", 1997],
        ["movie", "The Usual Suspects", 1995], ["movie", "Reservoir Dogs", 1992], ["movie", "Pulp Fiction", 1994],
        ["movie", "Jackie Brown", 1997], ["movie", "Collateral", 2004], ["movie", "The Town", 2010],
        ["movie", "Mystic River", 2003], ["movie", "American Gangster", 2007], ["movie", "Training Day", 2001],
        ["movie", "Road to Perdition", 2002], ["movie", "The Silence of the Lambs", 1991], ["movie", "Hell or High Water", 2016],
        ["movie", "Wind River", 2017], ["movie", "Uncut Gems", 2019], ["movie", "Drive", 2011],
        ["movie", "The Dark Knight", 2008], ["movie", "Fargo", 1996], ["movie", "Blade Runner", 1982],
        // All-time classics
        ["movie", "Casablanca", 1942], ["movie", "Vertigo", 1958], ["movie", "North by Northwest", 1959],
        ["movie", "Rear Window", 1954], ["movie", "Lawrence of Arabia", 1962], ["movie", "The Good, the Bad and the Ugly", 1966],
        ["movie", "Once Upon a Time in the West", 1968], ["movie", "Bonnie and Clyde", 1967], ["movie", "The Deer Hunter", 1978],
        ["movie", "Apocalypse Now", 1979], ["movie", "Network", 1976], ["movie", "Jaws", 1975],
        ["movie", "Rocky", 1976], ["movie", "Raiders of the Lost Ark", 1981], ["movie", "Unforgiven", 1992],
        ["movie", "There Will Be Blood", 2007], ["movie", "Oppenheimer", 2023], ["movie", "Gladiator", 2000],
        ["movie", "Saving Private Ryan", 1998], ["movie", "The Shawshank Redemption", 1994]
      ],
      classicGenres: [80, 18, 53, 10752, 37, 9648], // crime, drama, thriller, war, western, mystery
      classicsRow: {
        movie: { genres: null, rating: 7.5, votes: 3000 },
        tv: { genres: [18, 80], rating: 8, votes: 1000 }
      },
      favorGenres: { 80: 2, 18: 1, 53: 1 } // crime first, then drama and thrillers
    },
    "romance-comedy": {
      favorites: [
        // Rom-coms
        ["movie", "When Harry Met Sally...", 1989], ["movie", "Notting Hill", 1999], ["movie", "You've Got Mail", 1998],
        ["movie", "Sleepless in Seattle", 1993], ["movie", "Pretty Woman", 1990], ["movie", "Crazy Rich Asians", 2018],
        ["movie", "Crazy, Stupid, Love.", 2011], ["movie", "The Proposal", 2009], ["movie", "10 Things I Hate About You", 1999],
        ["movie", "Clueless", 1995], ["movie", "Bridget Jones's Diary", 2001], ["movie", "The Holiday", 2006],
        ["movie", "Love Actually", 2003], ["movie", "The Big Sick", 2017], ["movie", "Palm Springs", 2020],
        ["movie", "Anyone But You", 2023], ["movie", "Mamma Mia!", 2008], ["movie", "Four Weddings and a Funeral", 1994],
        // Love stories
        ["movie", "Pride & Prejudice", 2005], ["movie", "The Notebook", 2004], ["movie", "Before Sunrise", 1995],
        ["movie", "Roman Holiday", 1953], ["movie", "Casablanca", 1942], ["movie", "La La Land", 2016],
        ["movie", "About Time", 2013], ["movie", "Past Lives", 2023], ["movie", "Eternal Sunshine of the Spotless Mind", 2004],
        ["movie", "Titanic", 1997], ["movie", "Call Me by Your Name", 2017], ["movie", "Silver Linings Playbook", 2012],
        // Mysteries
        ["movie", "Knives Out", 2019], ["movie", "Glass Onion: A Knives Out Mystery", 2022],
        ["movie", "Murder on the Orient Express", 2017], ["movie", "Death on the Nile", 2022],
        ["movie", "Gone Girl", 2014], ["movie", "Rear Window", 1954], ["movie", "Enola Holmes", 2020],
        // Shows
        ["tv", "Bridgerton", 2020], ["tv", "Normal People", 2020], ["tv", "Gilmore Girls", 2000],
        ["tv", "Only Murders in the Building", 2021], ["tv", "Emily in Paris", 2020], ["tv", "Outlander", 2014],
        ["tv", "Big Little Lies", 2017], ["tv", "Virgin River", 2019], ["tv", "Nobody Wants This", 2024],
        ["tv", "Sherlock", 2010], ["tv", "Jane the Virgin", 2014], ["tv", "The Marvelous Mrs. Maisel", 2017]
      ],
      classicGenres: [10749, 35, 18], // romance, comedy, drama
      classicsRow: {
        movie: { genres: [10749, 35, 18], rating: 7, votes: 1500 },
        tv: { genres: [35, 18], rating: 7.5, votes: 300 } // TMDB has no TV romance genre
      },
      // Romance first (a rom-com scores romance + comedy), then comedy, drama and some mystery; crime,
      // action, thrillers, war, horror and TV sci-fi/fantasy sink
      favorGenres: { 10749: 5, 35: 2, 18: 2, 9648: 1, 80: -3, 28: -2, 10759: -2, 53: -2, 27: -5, 10765: -2,
        10752: -4, 10768: -4 },
      trendingOwn: {
        genres: { movie: [10749, 35, 18], tv: [35, 18] },
        topUps: ["movie:10749", "movie:10749,35", "movie:18", "tv:18", "tv:35"]
      }
    }
  }
};
