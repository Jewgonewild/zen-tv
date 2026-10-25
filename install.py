#!/usr/bin/env python3
"""Zen TV installer: a setup page in your browser that configures and installs Zen TV.

  python3 install.py

It runs only on this computer (127.0.0.1) and stops when you close this window (Ctrl+C). It writes
settings.json, keeps keys and tokens in ~/.zen-tv (never in the repo), and runs the same steps as
scripts/zentv.py and scripts/deploy.sh. Rerun it any time to change something.
"""
import base64
import io
import json
import os
import re
import secrets
import socket
import subprocess
import sys
import threading
import urllib.error
import urllib.request
import urllib.parse
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.realpath(__file__))
LAUNCHER = os.path.join(ROOT, "launcher")
INSTALLER = os.path.join(ROOT, "installer")
SETTINGS = os.path.join(ROOT, "settings.json")
EXAMPLE = os.path.join(ROOT, "settings.example.json")
SECRETS = os.path.expanduser("~/.zen-tv")
ST_TOKEN_FILE = os.path.join(SECRETS, "st-token")
CUSTOM_ICON = os.path.join(SECRETS, "icon.png")
PORT = 8765
MAX_BODY = 15 * 1024 * 1024  # largest request accepted (an uploaded icon is the biggest)
TOKEN = secrets.token_urlsafe(18)  # every URL carries it, so other web pages can't call this server

sys.path.insert(0, os.path.join(ROOT, "scripts"))
import zentv  # noqa: E402  (catalog parsing; its TV commands run as subprocesses, see run_job)


# ---------- Settings and secrets ----------

SETTINGS_LOCK = threading.Lock()


def read_settings():
    """settings.json, or the example before the first save. A broken file reads as the example (state()
    reports why), so the page can still load and save over it."""
    try:
        with open(SETTINGS if os.path.exists(SETTINGS) else EXAMPLE) as f:
            s = json.load(f)
        if isinstance(s, dict):
            return s
    except ValueError:
        pass
    with open(EXAMPLE) as f:
        return json.load(f)


def settings_error():
    if not os.path.exists(SETTINGS):
        return ""
    try:
        with open(SETTINGS) as f:
            return "" if isinstance(json.load(f), dict) else "settings.json isn't a { ... } object"
    except ValueError as e:
        return "settings.json isn't valid JSON (%s); saving here replaces it" % e


IP_OR_HOST = re.compile(r"[A-Za-z0-9][A-Za-z0-9.:-]*")


def write_settings(s):
    """Checked, then written whole (a temp file renamed over it), so a reader never sees half a file."""
    if not isinstance(s, dict):
        raise ValueError("settings must be an object")
    tv_ip = s.get("tvIp")
    if tv_ip and not (isinstance(tv_ip, str) and IP_OR_HOST.fullmatch(tv_ip)):
        raise ValueError("that doesn't look like an IP address")
    with SETTINGS_LOCK:
        tmp = SETTINGS + ".tmp"
        with open(tmp, "w") as f:
            json.dump(s, f, indent=2, ensure_ascii=False)
            f.write("\n")
        os.replace(tmp, SETTINGS)


def write_secret(path, value):
    """A key or token, readable only by you (created that way, never briefly open to others)."""
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    if os.path.dirname(path) == SECRETS:
        os.chmod(SECRETS, 0o700)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with open(fd, "w") as f:
        f.write(value)
    os.chmod(path, 0o600)


def tmdb_key_file(s):
    """Where the TMDB key lives: settings.json "tmdbKeyFile" (what deploy reads), ~/.zen-tv by default."""
    return os.path.expanduser(s.get("tmdbKeyFile") or "~/.zen-tv/tmdb-key")


def tizen_home(s):
    return os.path.expanduser(s.get("tizenStudio") or "~/tizen-studio")


def cert_profiles(s):
    """Certificate profiles from Tizen Studio's profiles.xml: (names, active)."""
    for data in (os.path.join(os.path.dirname(tizen_home(s)), "tizen-studio-data"),
                 os.path.expanduser("~/tizen-studio-data")):
        path = os.path.join(data, "profile", "profiles.xml")
        if os.path.exists(path):
            text = open(path, encoding="utf-8").read()
            active = re.search(r'<profiles[^>]*active="([^"]*)"', text)
            return re.findall(r'<profile name="([^"]+)"', text), active.group(1) if active else ""
    return [], ""


def computer_ip():
    """This computer's address on the home network (no traffic is sent)."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("10.255.255.255", 1))
        return sock.getsockname()[0]
    except OSError:
        return ""
    finally:
        sock.close()


def module_ok(name):
    try:
        __import__(name)
        return True
    except ImportError:
        return False


def state():
    s = read_settings()
    profiles, active = cert_profiles(s)
    home = tizen_home(s)
    cat = zentv.catalog_apps()
    return {
        "settings": s,
        "saved": os.path.exists(SETTINGS),
        "settingsError": settings_error(),
        "checks": {
            "python": sys.version.split()[0],
            "packages": module_ok("samsungtvws") and module_ok("PIL"),
            "tizenCli": os.path.exists(os.path.join(home, "tools", "ide", "bin", "tizen")),
            "sdb": os.path.exists(os.path.join(home, "tools", "sdb")),
        },
        "certProfiles": profiles,
        "activeProfile": active,
        "tmdbKeySaved": os.path.exists(tmdb_key_file(s)),
        "stTokenSaved": os.path.exists(ST_TOKEN_FILE),
        "tvPaired": os.path.exists(os.path.join(SECRETS, "tv-token")),
        "customIcon": os.path.exists(CUSTOM_ICON),
        "computerIp": computer_ip(),
        "apps": [{"key": k, "name": v["name"]} for k, v in cat.items()],
        "iconPresets": sorted(f[:-4] for f in os.listdir(os.path.join(INSTALLER, "icons")) if f.endswith(".png")),
    }


# ---------- Checks that talk to the network ----------

def test_tmdb_key(key):
    path = "https://api.themoviedb.org/3/configuration"
    headers = {}
    if len(key) > 40:  # a v4 read access token
        headers["Authorization"] = "Bearer " + key
    else:
        path += "?api_key=" + urllib.parse.quote(key, safe="")
    try:
        with urllib.request.urlopen(urllib.request.Request(path, headers=headers), timeout=10) as r:
            return r.status == 200
    except (urllib.error.URLError, OSError):
        return False


NO_PROXY = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # LAN only, never via a proxy


def probe_tv(ip):
    try:
        with NO_PROXY.open("http://%s:8001/api/v2/" % ip, timeout=0.8) as r:
            d = json.loads(r.read(65536)).get("device", {})
        return {"ip": ip, "name": d.get("name") or "Samsung TV", "model": d.get("modelName", ""),
                "developerIp": d.get("developerIP", "")}
    except Exception:  # noqa: BLE001 - not a TV, or not answering
        return None


def find_tvs():
    ip = computer_ip()
    if not ip:
        return []
    base = ip.rsplit(".", 1)[0]
    with ThreadPoolExecutor(64) as pool:
        found = pool.map(probe_tv, ["%s.%d" % (base, n) for n in range(1, 255)])
    return [t for t in found if t]


def tv_apps():
    """Apps installed on the paired TV, matched to catalog keys (needs pairing)."""
    known = {v["store"]: k for k, v in zentv.catalog_apps().items()}
    out = subprocess.run([sys.executable, "-c",
                          "import json,sys; sys.path.insert(0,'scripts'); import zentv; "
                          "print(json.dumps(zentv.installed_apps()))"],
                         cwd=ROOT, capture_output=True, text=True, timeout=30)
    if out.returncode:
        raise RuntimeError((out.stderr or out.stdout).strip().splitlines()[-1] if (out.stderr or out.stdout) else "failed")
    apps = json.loads(out.stdout.strip().splitlines()[-1])
    return [{"name": a.get("name", ""), "store": a.get("appId", ""), "key": known.get(a.get("appId"), "")}
            for a in sorted(apps, key=lambda a: a.get("name", "").lower())]


def developer_mode(ip, s):
    sdb = os.path.join(tizen_home(s), "tools", "sdb")
    if not os.path.exists(sdb):
        return False, "Tizen Studio's sdb wasn't found. Install Tizen Studio first (step 1)."
    out = subprocess.run([sdb, "connect", ip], capture_output=True, text=True, timeout=20)
    text = (out.stdout + out.stderr).strip()
    if "connected to" in text:
        return True, "Developer Mode is on and accepts this computer."
    return False, "The TV didn't accept the connection. Check Developer Mode is on with this computer's IP, and that the TV was restarted after."


def save_icon(data_url):
    """An uploaded image as the app icon: centre-cropped to the TV's icon shape (512x423)."""
    import warnings
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = 40000000  # a photo is fine; a decompression bomb is refused
    raw = base64.b64decode(data_url.split(",", 1)[1])
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        img = Image.open(io.BytesIO(raw)).convert("RGBA")
    w, h = img.size
    target = 512 / 423
    if w / h > target:
        nw = int(h * target)
        img = img.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = int(w / target)
        img = img.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    img = img.resize((512, 423), Image.LANCZOS)
    os.makedirs(SECRETS, mode=0o700, exist_ok=True)
    img.save(CUSTOM_ICON, "PNG")


# ---------- Long tasks (pairing, icons, install): run in the background, the page polls ----------

JOBS = {}
JOBS_LOCK = threading.Lock()


def run_job(args, stdin_text=None):
    job_id = secrets.token_hex(6)
    job = {"done": False, "ok": False, "log": []}
    with JOBS_LOCK:
        JOBS[job_id] = job

    def work():
        try:
            proc = subprocess.Popen(args, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    stdin=subprocess.DEVNULL, text=True, bufsize=1)
            for line in proc.stdout:
                job["log"].append(line.rstrip())
            job["ok"] = proc.wait() == 0
        except Exception as e:  # noqa: BLE001 - shown in the page's log
            job["log"].append("Couldn't run: %s" % e)
        job["done"] = True

    threading.Thread(target=work, daemon=True).start()
    return job_id


# ---------- HTTP ----------

TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css",
         ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2",
         ".json": "application/json"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # quiet: the page shows what matters

    # Only this computer, by name: blocks web pages that point their own domain at 127.0.0.1
    def allowed(self):
        host = (self.headers.get("Host") or "").split(":")[0]
        return host in ("127.0.0.1", "localhost")

    def send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "frame-ancestors 'self'")
        self.end_headers()
        self.wfile.write(data)

    def route(self):
        prefix = "/" + TOKEN + "/"
        path = self.path.split("?", 1)[0]
        if not self.allowed() or not path.startswith(prefix):
            self.send(404, {"error": "not found"})
            return None
        return path[len(prefix):]

    def do_GET(self):
        path = self.route()
        if path is None:
            return
        try:
            self.get(path)
        except Exception as e:  # noqa: BLE001 - reported to the page
            self.send(500, {"error": str(e)})

    def get(self, path):
        if path in ("", "index.html"):
            return self.file(os.path.join(INSTALLER, "index.html"))
        if path == "api/state":
            return self.send(200, state())
        if path.startswith("api/job/"):
            job = JOBS.get(path[8:])
            return self.send(200, job) if job else self.send(404, {"error": "no such job"})
        if path == "launcher/config.js":  # the live preview's settings, with the key if there is one
            s = read_settings()
            key_file = tmdb_key_file(s)
            is_key = os.path.basename(key_file) == "tmdb-key" and os.path.isfile(key_file) and \
                os.path.getsize(key_file) < 1024
            s["tmdbKey"] = open(key_file).read().strip() if is_key else ""
            return self.send(200, ("window.ZEN_SETTINGS = " + json.dumps(s) + ";\n").encode(), TYPES[".js"])
        for folder, base in (("installer/", INSTALLER), ("launcher/", LAUNCHER)):
            if path.startswith(folder):
                return self.file(os.path.join(base, path[len(folder):]))
        self.send(404, {"error": "not found"})

    def file(self, full):
        full = os.path.realpath(full)
        inside = full.startswith(INSTALLER + os.sep) or full.startswith(LAUNCHER + os.sep)
        if not inside or not os.path.isfile(full):
            return self.send(404, {"error": "not found"})
        with open(full, "rb") as f:
            self.send(200, f.read(), TYPES.get(os.path.splitext(full)[1], "application/octet-stream"))

    def do_POST(self):
        path = self.route()
        if path is None:
            return
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            return self.send(415, {"error": "JSON only"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if not 0 <= length <= MAX_BODY:
                return self.send(413, {"error": "That's too large (15 MB at most)."})
            body = json.loads(self.rfile.read(length) or b"{}")
            self.send(200, self.action(path, body))
        except Exception as e:  # noqa: BLE001 - reported to the page
            self.send(400, {"error": str(e)})

    def action(self, path, body):
        s = read_settings()
        if path == "api/settings":
            write_settings(body["settings"])
            return {"ok": True}
        if path == "api/tmdb":
            key = body.get("key", "").strip()
            if not key:
                path = tmdb_key_file(s)
                # Only a key this installer stored: a key file elsewhere may belong to something else
                if not os.path.realpath(path).startswith(os.path.realpath(SECRETS) + os.sep):
                    return {"ok": False, "message": "This key is kept in %s (tmdbKeyFile in settings.json); "
                                                    "remove it there." % path}
                if os.path.exists(path):
                    os.remove(path)
                return {"ok": True, "message": "Key removed"}
            if not test_tmdb_key(key):
                return {"ok": False, "message": "TMDB didn't accept that key. Copy the API Key (or Read Access Token) again."}
            # Always into ~/.zen-tv (never over a key file settings.json points elsewhere), and point there
            write_secret(os.path.join(SECRETS, "tmdb-key"), key)
            s["tmdbKeyFile"] = "~/.zen-tv/tmdb-key"
            write_settings(s)
            return {"ok": True, "message": "Key works and is saved in ~/.zen-tv"}
        if path == "api/packages":
            in_venv = sys.prefix != getattr(sys, "base_prefix", sys.prefix)
            args = [sys.executable, "-m", "pip", "install"] + ([] if in_venv else ["--user"]) + ["-r", "requirements.txt"]
            return {"job": run_job(args)}
        if path == "api/find-tv":
            return {"tvs": find_tvs()}
        if path == "api/pair":
            return {"job": run_job([sys.executable, "scripts/zentv.py", "pair"])}
        if path == "api/tv-apps":
            return {"apps": tv_apps()}
        if path == "api/icons":
            return {"job": run_job([sys.executable, "scripts/zentv.py", "icons"])}
        if path == "api/icon-upload":
            save_icon(body["dataUrl"])
            return {"ok": True}
        if path == "api/developer-mode":
            ok, message = developer_mode(s.get("tvIp", ""), s)
            return {"ok": ok, "message": message}
        if path == "api/install":
            flags = [] if body.get("open") else ["--no-open"]
            if os.path.exists(os.path.join(SECRETS, "tv-token")):
                # Paired: refresh the tiles' icons first (apps checked since reading them need theirs)
                script = '"$0" scripts/zentv.py icons || echo "(icons skipped)"; exec bash scripts/deploy.sh "$@"'
                return {"job": run_job(["bash", "-c", script, sys.executable] + flags)}
            return {"job": run_job(["bash", "scripts/deploy.sh"] + flags)}
        if path == "api/poweron":
            if body.get("token"):
                write_secret(ST_TOKEN_FILE, body["token"].strip())
            return {"job": run_job([sys.executable, "scripts/zentv.py", "poweron"])}
        raise ValueError("unknown action")


def main():
    server = None
    for port in range(PORT, PORT + 20):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
            break
        except OSError:
            continue
    if not server:
        sys.exit("No free port between %d and %d" % (PORT, PORT + 19))
    url = "http://127.0.0.1:%d/%s/" % (server.server_address[1], TOKEN)
    print("Zen TV installer: " + url)
    print("(opening it in your browser; press Ctrl+C here to stop)", flush=True)
    if "--no-browser" not in sys.argv:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
