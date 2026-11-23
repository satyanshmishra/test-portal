"""
Upload the Target JEE MAIN 2027 papers to test.satyansh.blog in the right folders.

Run it from inside the "Target JEE MAIN 2027" folder:
    python upload_target_jee.py            (shows what will be uploaded, uploads nothing)
    python upload_target_jee.py --upload   (uploads)
    python upload_target_jee.py --upload --fix-folders   (moves already-uploaded papers to the right folder)

What it does
  Topic Wise Tests\\Level 1..3\\JSON\\*.json  -> folder "Topic-wise",  sub-folder = chapter,
                                                name "<Chapter> | Test 1/2/3"
  Full Syllabus Tests\\Level 1..4\\JSON\\*.json -> folder "Full Syllabus", sub-folder = "Tests 01-25" etc.,
                                                name "Tests 01-25 | Full Syllabus Test 07"
  JEE MAIN 2026\\Full Papers (Retyped)\\JSON\\*.json (if present) -> folder "JEE Main 3-Hour",
                                                sub-folder "JEE Main 2026 PYQ"
  JEE MAIN 2025\\Full Papers (Retyped)\\JSON\\*.json (if present) -> folder "JEE Main 3-Hour",
                                                sub-folder "JEE Main 2025 PYQ"
  Practice Sheets\\<Topic>\\*.json        -> folder "Practice Sheets", sub-folder = topic,
                                                name "<Topic> | Sheet 1" (number from the file name)
No level is ever written in a name, so students do not see Level 1/2/3/4.

Uploads go to Supabase (the portal's database since Nov 2026). You log in with your teacher
account (the email + password of the Live Quiz host account); the password is asked every time
and never saved (the email is remembered in upload_config.json).
    python upload_target_jee.py --upload --sheets   (old way: Google Sheet / Apps Script admin password)
uploaded_log.json remembers what went up, so a re-run skips those papers (paper IDs stayed the same
when the papers moved to Supabase, so the old log is still right).
Needs only Python 3 (no pip installs).
"""
import getpass, glob, json, os, re, sys, time, urllib.error, urllib.request

HERE = os.getcwd()
CFG = os.path.join(HERE, "upload_config.json")
LOG = os.path.join(HERE, "uploaded_log.json")
SB_URL = "https://axznixboebvixkigojvj.supabase.co"
SB_KEY = "sb_publishable_g3vreHGOHm7lu4b91Qtahw_4uH-loXh"
DEFAULT_URL = "https://script.google.com/macros/s/AKfycby0H8pi7yDw8Fh3oYvcVPMYsBB1jXDnybLQ2653OH8BwGw-GXE7IQ6X63uyn5edTZI/exec"

def nice_chapter(stem):
    s = stem.replace("_", " ").strip()
    s = re.sub(r"\s+", " ", s)
    s = s.replace(" and ", " & ")
    return s

def plan():
    items = []
    # Topic-wise
    for lvl in (1, 2, 3):
        for f in sorted(glob.glob(os.path.join(HERE, "Topic Wise Tests", f"Level {lvl}", "JSON", "*.json"))):
            stem = os.path.splitext(os.path.basename(f))[0]
            stem = re.sub(r"[\s_-]*(L\d|Level\s*\d|Test\s*\d)$", "", stem, flags=re.I)
            ch = nice_chapter(stem)
            items.append((f, "topic", f"{ch} | Test {lvl}"))
    # Full syllabus
    for lvl in (1, 2, 3, 4):
        for f in sorted(glob.glob(os.path.join(HERE, "Full Syllabus Tests", f"Level {lvl}", "JSON", "*.json"))):
            m = re.findall(r"\d+", os.path.basename(f))
            if not m: print("  ! skipped (no test number):", f); continue
            n = int(m[-1]); a = (n - 1) // 25 * 25 + 1
            items.append((f, "full", f"Tests {a:02d}-{a+24:02d} | Full Syllabus Test {n:02d}"))
    # JEE Main 2026 and 2025 retyped papers
    for yr in ("2026", "2025", "2024"):
        for f in sorted(glob.glob(os.path.join(HERE, f"JEE MAIN {yr}", "Full Papers (Retyped)", "JSON", "*.json"))):
            p = json.load(open(f, encoding="utf-8"))
            title = (p.get("settings") or {}).get("paperName") or os.path.splitext(os.path.basename(f))[0]
            title = title.split(" | ")[-1]
            if yr in ("2025", "2024"):
                title = re.sub(r"^JEE Main \d{4}\s*[\u2013-]\s*", "", title)
            items.append((f, "main3h", f"JEE Main {yr} PYQ | {title}"))
    # Practice sheets: Practice Sheets\<Topic>\*.json  (or Practice Sheets\<Topic>\JSON\*.json)
    #   -> folder "Practice Sheets", sub-folder = topic, name "<Topic> | Sheet 1" (from the file name)
    sroot = os.path.join(HERE, "Practice Sheets")
    for d in sorted(glob.glob(os.path.join(sroot, "*"))):
        if not os.path.isdir(d): continue
        topic = nice_chapter(os.path.basename(d))
        files = sorted(glob.glob(os.path.join(d, "*.json")) + glob.glob(os.path.join(d, "JSON", "*.json")),
                       key=lambda x: [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", os.path.basename(x))])
        for f in files:
            stem = os.path.splitext(os.path.basename(f))[0]
            m = re.findall(r"\d+", stem)
            title = f"Sheet {int(m[-1])}" if m else nice_chapter(stem)
            items.append((f, "sheet", f"{topic} | {title}"))
    return items

def post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), headers={"Content-Type": "text/plain;charset=utf-8"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))

def sb_http(url, body, token=None):
    h = {"Content-Type": "application/json", "apikey": SB_KEY}
    if token: h["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), headers=h)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            t = r.read().decode("utf-8")
            return json.loads(t) if t else None
    except urllib.error.HTTPError as e:
        t = e.read().decode("utf-8", "replace")
        try: j = json.loads(t); msg = j.get("message") or j.get("msg") or j.get("error_description") or t
        except ValueError: msg = t
        raise RuntimeError(str(msg)[:300])

class Backend:
    """the same four operations on Supabase (default) or the old Apps Script (--sheets)"""
    def __init__(self):
        self.sheets = "--sheets" in sys.argv
        cfg = {}
        if os.path.exists(CFG):
            try: cfg = json.load(open(CFG))
            except Exception: cfg = {}
        if self.sheets:
            u = cfg.get("url", "")
            self.url = u if u.startswith("https://script.google.com/") else DEFAULT_URL
            print("Web App:", self.url[:60] + "...")
            self.pw = getpass.getpass("Admin password (typing will not show): ")
            if not post(self.url, {"action": "admin", "op": "login", "password": self.pw}).get("ok"):
                raise SystemExit("Wrong password.")
            return
        email = cfg.get("email", "")
        e = input(f"Teacher login email{' [' + email + ']' if email else ''}: ").strip() or email
        pw = getpass.getpass("Password (typing will not show): ")
        try:
            self.token = sb_http(f"{SB_URL}/auth/v1/token?grant_type=password", {"email": e, "password": pw})["access_token"]
            self.rpc("tp_admin_counts")
        except Exception as ex:
            raise SystemExit("Login failed: " + str(ex))
        cfg = {k: v for k, v in cfg.items() if k != "url"}; cfg["email"] = e
        json.dump(cfg, open(CFG, "w"))
    def rpc(self, fn, args=None):
        return sb_http(f"{SB_URL}/rest/v1/rpc/{fn}", args or {}, self.token)
    def save(self, paper):
        if self.sheets: return post(self.url, {"action": "admin", "op": "savePaper", "password": self.pw, "paper": paper})
        try: return self.rpc("tp_admin_save", {"p_paper": paper})
        except Exception as ex: return {"ok": False, "error": str(ex)}
    def set_category(self, pid, cat):
        if self.sheets: return post(self.url, {"action": "admin", "op": "setCategory", "password": self.pw, "id": pid, "category": cat})
        try: return self.rpc("tp_admin_set", {"p_id": pid, "p_patch": {"category": cat}})
        except Exception as ex: return {"ok": False, "error": str(ex)}

def main():
    items = plan()
    if not items:
        print("No JSON files found. Run this from inside the 'Target JEE MAIN 2027' folder."); return
    by = {}
    for _, cat, name in items: by.setdefault(cat, []).append(name)
    for cat, names in by.items():
        print(f"\n[{cat}] {len(names)} papers"); [print("   ", n) for n in names[:6]]; len(names) > 6 and print("    ...")
    if "--upload" not in sys.argv:
        print("\nNothing uploaded. Check the names above, then run:  python upload_target_jee.py --upload"); return
    be = Backend()
    log = json.load(open(LOG)) if os.path.exists(LOG) else {}
    if "--fix-folders" in sys.argv:
        # move already-uploaded papers into their right folder
        cats = {os.path.relpath(f, HERE): cat for f, cat, _ in items}
        done = bad = 0
        for key, rec in log.items():
            cat = cats.get(key); pid = rec.get("id")
            if not cat or not pid: continue
            r = be.set_category(pid, cat)
            if r.get("ok"): done += 1
            else: bad += 1; print("  FAIL", rec.get("name"), "-", r.get("error"))
        print(f"Folders fixed: {done}, failed: {bad}"); return
    ok = fail = skip = 0
    for f, cat, name in items:
        key = os.path.relpath(f, HERE)
        if key in log: skip += 1; continue
        p = json.load(open(f, encoding="utf-8"))
        p.setdefault("settings", {})
        p["settings"]["paperName"] = name
        p["settings"]["category"] = cat
        p["settings"].setdefault("subject", "Mathematics")
        try:
            r = be.save(p)
            if r.get("ok"):
                log[key] = {"name": name, "id": r.get("id"), "at": time.strftime("%Y-%m-%d %H:%M")}
                json.dump(log, open(LOG, "w"), indent=1); ok += 1; print("  ok  ", name)
            else: fail += 1; print("  FAIL", name, "-", r.get("error"))
        except Exception as e:
            fail += 1; print("  FAIL", name, "-", e)
    print(f"\nUploaded {ok}, skipped {skip} (already up), failed {fail}. Re-run to retry failures.")

if __name__ == "__main__":
    main()
