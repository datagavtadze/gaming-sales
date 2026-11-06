/* ZX Gaming: Steam games and prices load from the Python API or directly in the browser. */
let games = [];
const searchBox = document.getElementById("search");
const homeContent = document.getElementById("home-content");
const results = document.getElementById("results");
const resultsTitle = document.getElementById("results-title");
const resultsGrid = document.getElementById("results-grid");
const noResults = document.getElementById("no-results");
const nameList = document.getElementById("game-names");
const salesGrid = document.getElementById("sales-grid");
const statusLine = document.getElementById("data-status");
const featured = document.getElementById("featured-game");
const refreshButton = document.getElementById("refresh-deals");

function clean(value) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function steamSearchTerm(value) {
  const aliases = {
    gta5: "Grand Theft Auto V", gtav: "Grand Theft Auto V", grandtheftauto5: "Grand Theft Auto V",
    rdr2: "Red Dead Redemption 2", bg3: "Baldur's Gate 3", re4: "Resident Evil 4",
    cs2: "Counter-Strike 2", hades2: "Hades II", witcher3: "The Witcher 3: Wild Hunt"
  };
  return aliases[clean(value)] || value;
}
function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value));
}
function priceMarkup(game) {
  if (Number(game.salePrice) === 0) return '<span class="now free">Free</span>';
  const old = Number(game.normalPrice), sale = Number(game.salePrice);
  const discounted = old > sale + 0.001;
  return `${discounted ? `<span class="old">${money(old)}</span>` : ""}<span class="now">${money(sale)}</span>`;
}
function card(game, index) {
  const hue = (index * 47) % 360;
  const reduction = Number(game.savings) || 0;
  const url = buyPageUrl(game);
  return `<article class="card cut">
    ${reduction > 0 ? `<span class="discount">-${Math.round(reduction)}%</span>` : ""}
    <span class="genre">${escapeHtml(game.storeName || "PC deal")}</span>
    <div class="cover" style="--c1:hsl(${hue} 55% 28%); --c2:hsl(${(hue + 40) % 360} 90% 62%);" aria-hidden="true">
      ${game.thumb ? `<img src="${escapeHtml(game.thumb)}" alt="" loading="lazy" onerror="this.remove()">` : `<span class="cover-letter">${escapeHtml((game.title || "?")[0])}</span>`}
    </div>
    <div class="card-body"><h3>${escapeHtml(game.title)}</h3>
      <p>${game.metacriticScore ? `Metacritic ${escapeHtml(game.metacriticScore)}. ` : ""}${game.steamRatingText ? `${escapeHtml(game.steamRatingText)} on Steam. ` : ""}${game.normalPrice && Number(game.normalPrice) > Number(game.salePrice) ? `Save ${Math.round(reduction)}% at ${escapeHtml(game.storeName || "this store")}.` : `Current store price from ${escapeHtml(game.storeName || "this store")}.`}</p>
      <div class="card-foot"><div class="price">${priceMarkup(game)}</div>
        <a class="buy" href="${escapeHtml(url)}">Buy game</a></div>
    </div></article>`;
}
function featuredCard(game) {
  if (!game) {
    featured.innerHTML = `<div class="cover" style="--c1:#5B2A86; --c2:#FF5C8A;" aria-hidden="true"></div><div class="hero-info"><span class="pill">Steam catalog</span><h1 id="gotd-title">No games found</h1><p>Try refreshing later to load Steam prices.</p></div>`;
    return;
  }
  const pct = Math.round(Number(game.savings) || 0);
  featured.innerHTML = `<div class="cover" style="--c1:#5B2A86; --c2:#FF5C8A;" aria-hidden="true">${game.thumb ? `<img src="${escapeHtml(game.thumb)}" alt="">` : `<span class="cover-letter">${escapeHtml(game.title[0])}</span>`}</div>
    <div class="hero-info"><span class="pill">Featured Steam game</span><h1 id="gotd-title">${escapeHtml(game.title)}</h1>
    <p>${game.storeName ? `Available now at ${escapeHtml(game.storeName)}.` : "Current PC game deal."} Prices update daily.</p>
    <div class="price">${pct ? `<span class="discount">-${pct}%</span>` : ""}${priceMarkup(game)}</div>
    <a class="buy" href="${escapeHtml(buyPageUrl(game))}">Buy game</a></div>`;
}
function buyPageUrl(game) {
  const params = new URLSearchParams({
    title: game.title || "Game",
    price: String(game.salePrice ?? ""),
    store: game.storeName || "PC store",
    steamAppID: String(game.steamAppID || ""),
    dealUrl: game.dealUrl || ""
  });
  return `buy.html?${params}`;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;"}[char]));
}
function search() {
  const query = searchBox.value.trim();
  if (!query) { homeContent.hidden = false; results.hidden = true; return; }
  homeContent.hidden = true; results.hidden = false;
  const q = clean(query);
  const cached = games.filter(game => clean(game.title).includes(q));
  renderResults(cached, query, cached.length ? "" : "Searching Steam prices…");
  const requestId = ++searchRequest;
  clearTimeout(searchTimer);
  if (q.length < 2) return;
  searchTimer = setTimeout(async () => {
    try {
      let response = await fetch(`/api/search?title=${encodeURIComponent(query)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Search API not available");
      const data = await response.json();
      if (requestId === searchRequest && searchBox.value.trim() === query) renderResults(data.games || [], query);
    } catch (_) {
      try {
        const found = await searchSteamInBrowser(query);
        if (requestId === searchRequest && searchBox.value.trim() === query) renderResults(found, query);
      } catch (error) {
        if (requestId === searchRequest && searchBox.value.trim() === query) {
          renderResults(cached, query, cached.length ? "Showing saved matches; live search is unavailable." : "Could not search Steam right now.");
        }
      }
    }
  }, 450);
}
let searchTimer = 0;
let searchRequest = 0;
function renderResults(found, query, note = "") {
  resultsGrid.innerHTML = found.map(card).join("");
  resultsGrid.hidden = !found.length;
  noResults.hidden = !!found.length && !note;
  resultsTitle.textContent = found.length ? `${found.length} Steam result${found.length === 1 ? "" : "s"}` : "No Steam games found";
  noResults.textContent = note || `No Steam listing matches “${query}”. Try another title.`;
}
async function searchSteamInBrowser(title) {
  title = steamSearchTerm(title);
  let storeId = "";
  try { storeId = localStorage.getItem("zx-steam-store-id") || ""; } catch (_) {}
  if (!storeId) {
    const storesResponse = await fetch("https://www.cheapshark.com/api/1.0/stores");
    if (!storesResponse.ok) throw new Error("Steam store lookup failed");
    const stores = await storesResponse.json();
    storeId = String(stores.find(store => (store.storeName || "").toLowerCase() === "steam")?.storeID || "");
    if (!storeId) throw new Error("Steam store not found");
    try { localStorage.setItem("zx-steam-store-id", storeId); } catch (_) {}
  }
  const response = await fetch(`https://www.cheapshark.com/api/1.0/deals?storeID=${encodeURIComponent(storeId)}&title=${encodeURIComponent(title)}&sortBy=DealRating&pageSize=60`);
  if (!response.ok) throw new Error("Steam search failed");
  const deals = await response.json();
  const seen = new Set();
  return deals.filter(deal => {
    const name = (deal.title || "").toLowerCase();
    if (!name || seen.has(name)) return false;
    seen.add(name); return true;
  }).map(deal => ({
    title: deal.title, salePrice: Number(deal.salePrice), normalPrice: Number(deal.normalPrice),
    savings: Number(deal.savings) || 0, dealID: deal.dealID,
    dealUrl: `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(deal.dealID)}`,
    storeName: "Steam", thumb: deal.thumb || "", metacriticScore: deal.metacriticScore || "",
    steamRatingText: deal.steamRatingText || "", steamAppID: deal.steamAppID || ""
  }));
}
async function loadDeals(refresh = false) {
  statusLine.textContent = refresh ? "Refreshing current deals…" : "Loading current game deals…";
  try {
    let data;
    try {
      const response = await fetch(`/api/games${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      data = await response.json();
    } catch (serverError) {
      data = await loadDealsFromBrowserCache(refresh);
    }
    games = data.games || [];
    const topDeals = games;
    const featuredGame = topDeals[0]; featuredCard(featuredGame);
    salesGrid.innerHTML = topDeals.map(card).join("");
    nameList.innerHTML = games.map(game => `<option value="${escapeHtml(game.title)}">`).join("");
    statusLine.textContent = data.updatedAt ? `Prices checked ${new Date(data.updatedAt).toLocaleString()} · ${games.length} Steam games` : `${games.length} Steam games`;
    if (searchBox.value.trim()) search();
  } catch (error) {
    statusLine.textContent = "Could not load current prices. Check the connection and refresh.";
    featured.innerHTML = `<div class="cover" style="--c1:#5B2A86; --c2:#FF5C8A;" aria-hidden="true"></div><div class="hero-info"><span class="pill">Steam catalog</span><h1 id="gotd-title">Prices unavailable</h1><p>Check your internet connection and refresh this page.</p></div>`;
    console.error("Deal feed error:", error);
  }
}
async function loadDealsFromBrowserCache(forceRefresh = false) {
  const key = "zx-gaming-games-v2";
  let saved;
  try { saved = JSON.parse(localStorage.getItem(key) || "null"); } catch (_) {}
  const now = Date.now();
  if (saved?.games?.length && now - saved.fetchedAt < (forceRefresh ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000)) return saved;

  try {
  const storeResponse = await fetch("https://www.cheapshark.com/api/1.0/stores");
  if (!storeResponse.ok) throw new Error("Could not load the Steam store information");
  const stores = await storeResponse.json();
  const steamStore = stores.find(store => (store.storeName || "").toLowerCase() === "steam");
  if (!steamStore) throw new Error("Steam store was not found in the deal service");
  const dealResponse = await fetch(`https://www.cheapshark.com/api/1.0/deals?storeID=${encodeURIComponent(steamStore.storeID)}&sortBy=DealRating&pageSize=60`);
  if (!dealResponse.ok) throw new Error("Could not load current Steam deals");
  const deals = await dealResponse.json();
  const storeNames = Object.fromEntries(stores.map(store => [String(store.storeID), store.storeName]));
  const seen = new Set();
  const currentGames = deals.filter(deal => {
    const title = (deal.title || "").toLocaleLowerCase();
    if (!title || seen.has(title)) return false;
    seen.add(title); return true;
  }).map(deal => ({
    title: deal.title, salePrice: Number(deal.salePrice), normalPrice: Number(deal.normalPrice),
    savings: Number(deal.savings) || 0, dealID: deal.dealID,
    dealUrl: `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(deal.dealID)}`,
    storeName: storeNames[String(deal.storeID)] || "PC store", thumb: deal.thumb || "",
    metacriticScore: deal.metacriticScore || "", steamRatingText: deal.steamRatingText || "",
    steamAppID: deal.steamAppID || ""
  }));
  const result = { games: currentGames, updatedAt: new Date(now).toISOString(), fetchedAt: now, source: "CheapShark" };
  try { localStorage.setItem(key, JSON.stringify(result)); } catch (_) {}
  return result;
  } catch (error) {
    if (saved?.games?.length) return saved;
    throw error;
  }
}
searchBox.addEventListener("input", search);
refreshButton.addEventListener("click", () => loadDeals(true));
loadDeals();
