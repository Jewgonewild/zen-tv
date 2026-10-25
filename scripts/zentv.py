#!/usr/bin/env python3
"""Zen TV setup helper. Reads settings.json from the repo root.

  python3 scripts/zentv.py pair      pair with the TV (press Allow on the TV once)
  python3 scripts/zentv.py apps      list apps installed on the TV, matched to the app keys settings use
  python3 scripts/zentv.py icons     fetch the TV's icons for the apps in settings, shaped to the tiles
  python3 scripts/zentv.py poweron   create a SmartThings rule: TV turns on -> open Zen TV
  python3 scripts/zentv.py config D  write D/config.js (settings + TMDB key): the build or preview folder
  python3 scripts/zentv.py package D set the app's name and icon (settings "appName", "icon") in build D

The installer (python3 install.py) runs these for you.

Keys and tokens live in ~/.zen-tv (never in the repo): tmdb-key, tv-token, st-token.
"""
import base64
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import warnings

warnings.filterwarnings("ignore")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAUNCHER = os.path.join(ROOT, "launcher")
SECRETS = os.path.expanduser("~/.zen-tv")
APP_ID = "ZenTVHome1.Launcher"
TILE_W, TILE_H, ICON_SIZE = 336, 189, 280  # app tile, and the size the TV's square icon is drawn at


def settings():
    path = os.path.join(ROOT, "settings.json")
    if not os.path.exists(path):
        sys.exit("No settings.json yet: run python3 install.py, or copy settings.example.json to settings.json.")
    try:
        with open(path) as f:
            s = json.load(f)
    except ValueError as e:
        sys.exit("settings.json isn't valid JSON (%s). Fix it, or rerun python3 install.py." % e)
    if not isinstance(s, dict):
        sys.exit("settings.json should hold one { ... } object.")
    return s


def secrets_dir():
    """~/.zen-tv, readable only by you: it holds keys and tokens."""
    os.makedirs(SECRETS, mode=0o700, exist_ok=True)
    os.chmod(SECRETS, 0o700)
    return SECRETS


def catalog_apps():
    """The app keys catalog.js knows, with their store IDs (parsed from the JS, no JS engine needed)."""
    with open(os.path.join(LAUNCHER, "catalog.js")) as f:
        text = f.read()
    return {m.group(1): {"name": m.group(2), "store": m.group(3)}
            for m in re.finditer(r'(\w+):\s*\{ name: "([^"]+)",\s*store: "(\d+)"', text)}


def tv():
    from samsungtvws import SamsungTVWS
    ip = str(settings().get("tvIp") or "").strip()
    if not ip:
        sys.exit("Set tvIp in settings.json to your TV's IP address.")
    return SamsungTVWS(host=ip, port=8002, name="Zen TV Setup",
                       token_file=os.path.join(secrets_dir(), "tv-token"), timeout=10)


def cmd_pair():
    print("Connecting... if the TV asks to allow \"Zen TV Setup\", choose Allow.")
    t = tv()
    t.open()
    t.close()
    token_file = os.path.join(SECRETS, "tv-token")
    if os.path.exists(token_file):
        os.chmod(token_file, 0o600)
    print("Paired. Token saved in", token_file)


def installed_apps():
    return tv().app_list() or []


def cmd_apps():
    known = {v["store"]: k for k, v in catalog_apps().items()}
    s = settings()
    wanted = set(k for k in s.get("apps", []) + s.get("alsoInstalled", []) if isinstance(k, str))
    print("%-34s %-16s %s" % ("App on the TV", "Store ID", "Key for settings.json"))
    found = set()
    for a in sorted(installed_apps(), key=lambda a: a.get("name", "").lower()):
        key = known.get(a.get("appId"), "")
        found.add(key)
        print("%-34s %-16s %s" % (a.get("name", "")[:33], a.get("appId", ""), key or "(custom: add as an object)"))
    missing = sorted(k for k in wanted if k not in found)
    if missing:
        print("\nIn settings.json but not found on the TV: " + ", ".join(missing))
        print("Install them from the TV's app store, or remove them from settings.json.")


def fetch_icon(conn_tv, path):
    """Ask the TV for an app icon (base64 PNG over its remote-control channel)."""
    conn = conn_tv.open()
    conn.settimeout(8)
    conn_tv._ws_send({"method": "ms.channel.emit",
                      "params": {"event": "ed.apps.icon", "to": "host", "data": {"iconPath": path}}})
    deadline = time.time() + 10
    while time.time() < deadline:
        msg = json.loads(conn.recv())
        if msg.get("event") == "ed.apps.icon":
            data = msg.get("data", {}).get("imageBase64")
            return base64.b64decode(data) if data else None
    return None


def shape_tile(png_bytes):
    """The TV's square icon at the size the tiles use, centred on a 16:9 tile, with each row's edge
    colour carried out to the sides: solid and gradient icons both fill the tile without a seam."""
    from PIL import Image
    icon = Image.open(io.BytesIO(png_bytes)).convert("RGB").resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS)
    top = (ICON_SIZE - TILE_H) // 2
    icon = icon.crop((0, top, ICON_SIZE, top + TILE_H))
    out = Image.new("RGB", (TILE_W, TILE_H))
    x0 = (TILE_W - ICON_SIZE) // 2
    out.paste(icon, (x0, 0))
    for y in range(TILE_H):
        left, right = icon.getpixel((1, y)), icon.getpixel((ICON_SIZE - 2, y))
        for x in range(x0):
            out.putpixel((x, y), left)
        for x in range(x0 + ICON_SIZE, TILE_W):
            out.putpixel((x, y), right)
    buf = io.BytesIO()
    out.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def cmd_icons():
    s = settings()
    known = catalog_apps()
    apps = []
    for a in s.get("apps", []):
        if isinstance(a, str) and a in known:
            apps.append((a, known[a]["store"]))
        elif isinstance(a, dict) and a.get("key") and a.get("store"):
            if not re.fullmatch(r"\w+", str(a["key"])):  # it becomes a file name
                print("  skipped %r: an app key may only use letters, digits and _" % a["key"])
                continue
            apps.append((a["key"], str(a["store"])))
    on_tv = {a.get("appId"): a for a in installed_apps()}
    t = tv()
    os.makedirs(os.path.join(LAUNCHER, "icons"), exist_ok=True)
    for key, store in apps:
        paths = []
        if on_tv.get(store, {}).get("icon"):
            paths.append(on_tv[store]["icon"])
        paths.append("/opt/share/webappservice/apps_icon/FirstScreen/%s/250x250.png" % store)
        png = None
        for p in paths:
            try:
                png = fetch_icon(t, p)
            except Exception:  # noqa: BLE001 - try the next path
                png = None
            if png:
                break
        if not png:
            print("  %-10s no icon on the TV (the tile will show its name)" % key)
            continue
        with open(os.path.join(LAUNCHER, "icons", key + ".png"), "wb") as f:
            f.write(shape_tile(png))
        print("  %-10s saved" % key)
    t.close()


def st_request(method, path, token, body=None):
    req = urllib.request.Request("https://api.smartthings.com/v1" + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            text = r.read().decode() or "{}"
    except urllib.error.HTTPError as e:
        if e.code == 401:
            sys.exit("SmartThings didn't accept the token (it may have expired): make a new one.")
        sys.exit("SmartThings refused the request (%s): %s" % (e.code, e.read().decode()[:300]))
    except urllib.error.URLError as e:
        sys.exit("Couldn't reach SmartThings (%s). Check the internet connection." % e.reason)
    return json.loads(text)


RULE_NAME = "TV on -> open Zen TV"


def cmd_poweron():
    token_file = os.path.join(secrets_dir(), "st-token")
    if not os.path.exists(token_file):
        sys.exit("Create a SmartThings token at https://account.smartthings.com/tokens (scopes: devices, "
                 "locations, rules) and save it as " + token_file)
    token = open(token_file).read().strip()
    devices = st_request("GET", "/devices", token).get("items", [])
    tvs = [d for d in devices if any(c.get("id") == "custom.launchapp"
                                     for comp in d.get("components", []) for c in comp.get("capabilities", []))]
    if not tvs:
        sys.exit("No Samsung TV found in SmartThings. Add the TV in the SmartThings app first.")
    names = [d.get("label") or d.get("name") or d["deviceId"] for d in tvs]
    if len(tvs) > 1 and not sys.stdin.isatty():
        sys.exit("SmartThings has several TVs (%s). Run python3 scripts/zentv.py poweron in a terminal "
                 "to choose one." % ", ".join(names))
    tv_dev = tvs[0]
    if len(tvs) > 1:
        for i, n in enumerate(names):
            print(i, n)
        choice = input("Which TV? ").strip()
        if not choice.isdigit() or int(choice) >= len(tvs):
            sys.exit("No TV numbered %r." % choice)
        tv_dev = tvs[int(choice)]
    dev_id, loc_id = tv_dev["deviceId"], tv_dev["locationId"]
    # Rerunning replaces the rule rather than adding a second one
    for old in st_request("GET", "/rules?locationId=" + loc_id, token).get("items", []):
        if old.get("name") == RULE_NAME:
            st_request("DELETE", "/rules/%s?locationId=%s" % (old["id"], loc_id), token)
    rule = {
        "name": RULE_NAME,
        "actions": [{"if": {
            "changes": {"equals": {
                "left": {"device": {"devices": [dev_id], "component": "main", "capability": "switch", "attribute": "switch"}},
                "right": {"string": "on"}}},
            "then": [
                {"sleep": {"duration": {"value": {"integer": 1}, "unit": "Second"}}},
                {"command": {"devices": [dev_id], "commands": [{
                    "component": "main", "capability": "custom.launchapp", "command": "launchApp",
                    "arguments": [{"string": APP_ID}]}]}}]}}]}
    made = st_request("POST", "/rules?locationId=" + loc_id, token, rule)
    print("Created rule \"%s\" for %s (%s)." % (made.get("name"), tv_dev.get("label"), made.get("id")))
    print("Also turn off Settings > General > Smart Features > Autorun Smart Hub on the TV.")


def cmd_config(out_dir):
    """config.js (settings + TMDB key) into a build or preview folder: never the repo's launcher/, so the
    key can't be left behind there."""
    s = settings()
    key_file = os.path.expanduser(str(s.get("tmdbKeyFile") or "~/.zen-tv/tmdb-key"))
    s["tmdbKey"] = open(key_file).read().strip().strip('"') if os.path.exists(key_file) else ""
    for private in ("tizenStudio", "tmdbKeyFile", "certificateProfile"):
        s.pop(private, None)
    path = os.path.join(out_dir, "config.js")
    with open(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
        f.write("window.ZEN_SETTINGS = " + json.dumps(s, indent=1) + ";\n")
    print("Settings written (TMDB key: %s)" % ("present" if s["tmdbKey"] else "none, landscapes only"))


ICON_PRESETS = os.path.join(ROOT, "installer", "icons")  # zen.png, dawn.png, ... (settings "icon")
CUSTOM_ICON = os.path.join(SECRETS, "icon.png")  # an uploaded icon ("icon": "custom")


def cmd_package(build):
    """In a build folder: the app's name in config.xml and its icon (the TV's app list shows both)."""
    from xml.sax.saxutils import escape
    s = settings()
    name = str(s.get("appName") or "Zen TV").strip()[:40] or "Zen TV"
    config_xml = os.path.join(build, "config.xml")
    with open(config_xml, encoding="utf-8") as f:
        text = f.read()
    start, end = text.index("<name>") + len("<name>"), text.index("</name>")
    with open(config_xml, "w", encoding="utf-8") as f:
        f.write(text[:start] + escape(name) + text[end:])
    icon = str(s.get("icon") or "zen")
    src = CUSTOM_ICON if icon == "custom" else os.path.join(ICON_PRESETS, os.path.basename(icon) + ".png")
    if os.path.exists(src):
        with open(src, "rb") as f_in, open(os.path.join(build, "icon.png"), "wb") as f_out:
            f_out.write(f_in.read())
    else:
        print("Icon %s not found; keeping the default" % icon)


COMMANDS = {"pair": cmd_pair, "apps": cmd_apps, "icons": cmd_icons, "poweron": cmd_poweron}
WITH_FOLDER = {"config": cmd_config, "package": cmd_package}

if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] in WITH_FOLDER:
        WITH_FOLDER[sys.argv[1]](sys.argv[2])
    elif len(sys.argv) == 2 and sys.argv[1] in COMMANDS:
        COMMANDS[sys.argv[1]]()
    else:
        sys.exit(__doc__)
