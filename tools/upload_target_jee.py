"""
Upload the Target JEE MAIN 2027 papers to test.satyansh.blog in the right folders.

Run it from inside the "Target JEE MAIN 2027" folder:
    python upload_target_jee.py            (shows what will be uploaded, uploads nothing)
    python upload_target_jee.py --upload   (uploads)

What it does
  Topic Wise Tests\\Level 1..3\\JSON\\*.json  -> folder "Topic-wise",  sub-folder = chapter,
                                                name "<Chapter> | Test 1/2/3"
  Full Syllabus Tests\\Level 1..4\\JSON\\*.json -> folder "Full Syllabus", sub-folder = "Tests 01-25" etc.,
                                                name "Tests 01-25 | Full Syllabus Test 07"
  JEE MAIN 2026\\Full Papers (Retyped)\\JSON\\*.json (if present) -> folder "JEE Main 3-Hour",
                                                sub-folder "JEE Main 2026 PYQ"
No level is ever written in a name, so students do not see Level 1/2/3/4.

The Web App URL is read from config.js of the test portal (or asked once and saved in
upload_config.json). The admin password is asked every time and never saved.
uploaded_log.json remembers what went up, so a re-run skips those papers.
Needs only Python 3 (no pip installs).
"""
import getpass, glob, json, os, re, sys, time, urllib.request

HERE = os.getcwd()
CFG = os.path.join(HERE, "upload_config.json")
LOG = os.path.join(HERE, "uploaded_log.json")
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
    # JEE Main 2026 retyped papers
    for f in sorted(glob.glob(os.path.join(HERE, "JEE MAIN 2026", "Full Papers (Retyped)", "JSON", "*.json"))):
        p = json.load(open(f, encoding="utf-8"))
        title = (p.get("settings") or {}).get("paperName") or os.path.splitext(os.path.basename(f))[0]
        title = title.split(" | ")[-1]
        items.append((f, "main3h", f"JEE Main 2026 PYQ | {title}"))
    return items

def post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), headers={"Content-Type": "text/plain;charset=utf-8"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))

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
    cfg = json.load(open(CFG)) if os.path.exists(CFG) else {}
    url = cfg.get("url") or input(f"Web App URL [Enter = {DEFAULT_URL[:50]}...]: ").strip() or DEFAULT_URL
    json.dump({"url": url}, open(CFG, "w"))
    pw = getpass.getpass("Admin password: ")
    if not post(url, {"action": "admin", "op": "login", "password": pw}).get("ok"):
        print("Wrong password."); return
    log = json.load(open(LOG)) if os.path.exists(LOG) else {}
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
            r = post(url, {"action": "admin", "op": "savePaper", "password": pw, "paper": p})
            if r.get("ok"):
                log[key] = {"name": name, "id": r.get("id"), "at": time.strftime("%Y-%m-%d %H:%M")}
                json.dump(log, open(LOG, "w"), indent=1); ok += 1; print("  ok  ", name)
            else: fail += 1; print("  FAIL", name, "-", r.get("error"))
        except Exception as e:
            fail += 1; print("  FAIL", name, "-", e)
    print(f"\nUploaded {ok}, skipped {skip} (already up), failed {fail}. Re-run to retry failures.")

if __name__ == "__main__":
    main()
