"""Serve ZX Gaming and cache CheapShark PC game deals, refreshed every day."""
from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
CACHE_FILE = ROOT / "deals-cache.json"
API = "https://www.cheapshark.com/api/1.0"
REFRESH_SECONDS = 24 * 60 * 60
MANUAL_REFRESH_MIN_SECONDS = 60 * 60
lock = threading.Lock()
cache: dict = {"games": [], "updatedAt": None}
steam_store_id: str | None = None


def fetch_json(url: str):
    req = Request(url, headers={"User-Agent": "ZXGamingDeals/1.0 (daily game price display)"})
    with urlopen(req, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def refresh_data() -> dict:
    """Get current Steam offers from CheapShark and save a daily snapshot."""
    global steam_store_id
    stores = fetch_json(f"{API}/stores")
    store_names = {str(s["storeID"]): s.get("storeName", "PC store") for s in stores}
    steam_store_id = next((store_id for store_id, name in store_names.items() if name.casefold() == "steam"), None)
    if steam_store_id is None:
        raise RuntimeError("Steam store was not returned by CheapShark")
    deals = fetch_json(f"{API}/deals?storeID={steam_store_id}&sortBy=DealRating&pageSize=60")
    games = normalize_deals(deals, store_names)
    updated = datetime.now(timezone.utc).isoformat(timespec="seconds")
    fresh = {"games": games, "updatedAt": updated, "source": "CheapShark", "catalogVersion": 2}
    CACHE_FILE.write_text(json.dumps(fresh, ensure_ascii=False, indent=2), encoding="utf-8")
    return fresh


def normalize_deals(deals: list, store_names: dict) -> list:
    games = []
    seen = set()
    for deal in deals:
        title, deal_id = deal.get("title"), deal.get("dealID")
        if not title or not deal_id or title.casefold() in seen:
            continue
        seen.add(title.casefold())
        try:
            sale, normal = float(deal.get("salePrice", 0)), float(deal.get("normalPrice", 0))
        except (TypeError, ValueError):
            continue
        games.append({
            "title": title,
            "salePrice": sale,
            "normalPrice": normal,
            "savings": float(deal.get("savings", 0) or 0),
            "dealID": deal_id,
            "dealUrl": f"https://www.cheapshark.com/redirect?{urlencode({'dealID': deal_id})}",
            "storeName": store_names.get(str(deal.get("storeID")), "PC store"),
            "thumb": deal.get("thumb", ""),
            "metacriticScore": deal.get("metacriticScore", ""),
            "steamRatingText": deal.get("steamRatingText", ""),
            "steamAppID": deal.get("steamAppID", ""),
        })
    return games


def search_steam_games(title: str) -> dict:
    global steam_store_id
    if not steam_store_id:
        stores = fetch_json(f"{API}/stores")
        steam_store_id = next((str(s["storeID"]) for s in stores if s.get("storeName", "").casefold() == "steam"), None)
    if not steam_store_id:
        raise RuntimeError("Steam store was not returned by CheapShark")
    aliases = {
        "gta5": "Grand Theft Auto V",
        "gtav": "Grand Theft Auto V",
        "grandtheftauto5": "Grand Theft Auto V",
        "rdr2": "Red Dead Redemption 2",
        "bg3": "Baldur's Gate 3",
        "re4": "Resident Evil 4",
        "cs2": "Counter-Strike 2",
        "hades2": "Hades II",
        "witcher3": "The Witcher 3: Wild Hunt",
    }
    normalized = "".join(ch for ch in title.casefold() if ch.isalnum())
    lookup_title = aliases.get(normalized, title)
    query = urlencode({"storeID": steam_store_id, "title": lookup_title, "sortBy": "DealRating", "pageSize": 60})
    games = normalize_deals(fetch_json(f"{API}/deals?{query}"), {steam_store_id: "Steam"})
    return {"games": games, "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "source": "CheapShark"}


def load_cache() -> None:
    global cache
    try:
        cache = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        cache = {"games": [], "updatedAt": None, "source": "CheapShark"}


def daily_refresh() -> None:
    while True:
        time.sleep(REFRESH_SECONDS)
        try:
            with lock:
                global cache
                cache = refresh_data()
                print(f"Refreshed {len(cache['games'])} game deals.", flush=True)
        except Exception as exc:
            print(f"Daily price refresh failed; keeping cached prices: {exc}", flush=True)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        global cache
        parsed = urlparse(self.path)
        if parsed.path == "/api/search":
            title = parse_qs(parsed.query).get("title", [""])[0].strip()
            if len(title) < 2:
                self.send_error(400, "Search needs at least two characters")
                return
            try:
                data = search_steam_games(title)
            except Exception as exc:
                self.send_error(502, f"Could not search Steam prices: {exc}")
                return
            body = json.dumps(data).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/api/games":
            query = parse_qs(parsed.query)
            if query.get("refresh") == ["1"]:
                try:
                    with lock:
                        last = datetime.fromisoformat(cache["updatedAt"]) if cache.get("updatedAt") else None
                        age = (datetime.now(timezone.utc) - last).total_seconds() if last else REFRESH_SECONDS
                        # Avoid repeated API calls when visitors click refresh rapidly.
                        if age >= MANUAL_REFRESH_MIN_SECONDS:
                            cache = refresh_data()
                except Exception as exc:
                    self.send_error(502, f"Could not refresh prices: {exc}")
                    return
            body = json.dumps(cache).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/api/refresh":
            self.send_response(307)
            self.send_header("Location", "/api/games?refresh=1")
            self.end_headers()
            return
        self.path = "/index.html" if parsed.path == "/" else parsed.path
        super().do_GET()


def main() -> None:
    global cache
    load_cache()
    # Update once at startup if no data exists or the last snapshot is a day old.
    try:
        previous = datetime.fromisoformat(cache["updatedAt"]) if cache.get("updatedAt") else None
        stale = cache.get("catalogVersion") != 2 or previous is None or (datetime.now(timezone.utc) - previous).total_seconds() >= REFRESH_SECONDS
        if stale:
            cache = refresh_data()
            print(f"Loaded {len(cache['games'])} current game deals.", flush=True)
    except Exception as exc:
        print(f"Price API unavailable; using saved data if available: {exc}", flush=True)
    threading.Thread(target=daily_refresh, daemon=True).start()
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), Handler)
    display_host = "127.0.0.1" if host == "0.0.0.0" else host
    print(f"ZX Gaming is running at http://{display_host}:{port} (Ctrl+C to stop)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
