"""
Move ALL papers and results from the Google Sheet (Apps Script) to Supabase.  Run once.

Before running:
  1. Supabase -> SQL Editor: run backend/test_papers.sql
  2. Apps Script: paste the new backend/Code.gs (v2.2) and redeploy with
     Manage deployments -> Edit -> New version (same Web App URL)

Then:
    python migrate_sheets_to_supabase.py            (checks both sides, moves nothing)
    python migrate_sheets_to_supabase.py --go       (moves papers + results)

You are asked for: the Apps Script admin password, and your teacher login
(the email + password of the account that hosts the Live Quiz). Nothing is saved.

Safe to run again: papers keep their old IDs (overwritten with the sheet copy),
results already moved are skipped. The Google Sheet itself is never changed.
Needs only Python 3 (no pip installs).
"""
import getpass, json, re, sys, time, urllib.error, urllib.request
from datetime import datetime

APPS_URL = "https://script.google.com/macros/s/AKfycby0H8pi7yDw8Fh3oYvcVPMYsBB1jXDnybLQ2653OH8BwGw-GXE7IQ6X63uyn5edTZI/exec"
SB_URL = "https://axznixboebvixkigojvj.supabase.co"
SB_KEY = "sb_publishable_g3vreHGOHm7lu4b91Qtahw_4uH-loXh"


def http(url, body, headers=None, timeout=180):
    h = {"Content-Type": "application/json"}
    h.update(headers or {})
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            txt = r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        txt = e.read().decode("utf-8", "replace")
        try:
            j = json.loads(txt)
            raise RuntimeError(j.get("message") or j.get("msg") or j.get("error_description") or txt[:300])
        except ValueError:
            raise RuntimeError(f"HTTP {e.code}: {txt[:300]}")
    return json.loads(txt) if txt else None


def norm_date(v):
    """sheet dates may arrive as "Mon Nov 16 2026 10:00:00 GMT+0530 (India Standard Time)": make them ISO"""
    v = str(v or "").strip()
    m = re.match(r"^\w{3} (\w{3} \d{1,2} \d{4} \d\d:\d\d:\d\d) GMT([+-]\d{4})", v)
    if m:
        try:
            return datetime.strptime(m.group(1) + " " + m.group(2), "%b %d %Y %H:%M:%S %z").isoformat()
        except ValueError:
            return v
    return v


def apps(op, pw, **extra):
    body = {"action": "admin", "op": op, "password": pw}
    body.update(extra)
    req = urllib.request.Request(APPS_URL, data=json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "text/plain;charset=utf-8"})
    with urllib.request.urlopen(req, timeout=180) as r:
        j = json.loads(r.read().decode("utf-8"))
    if not j.get("ok"):
        raise RuntimeError(j.get("error") or "Apps Script request failed")
    return j


class Supa:
    def __init__(self, email, password):
        self.email, self.password = email, password
        self.login()

    def login(self):
        j = http(f"{SB_URL}/auth/v1/token?grant_type=password", {"email": self.email, "password": self.password},
                 {"apikey": SB_KEY})
        self.token, self.at = j["access_token"], time.time()

    def rpc(self, fn, args=None):
        if time.time() - self.at > 45 * 60:
            self.login()
        return http(f"{SB_URL}/rest/v1/rpc/{fn}", args or {},
                    {"apikey": SB_KEY, "Authorization": "Bearer " + self.token})


def main():
    go = "--go" in sys.argv
    pw = getpass.getpass("Apps Script admin password (typing will not show): ")
    try:
        apps("login", pw)
    except Exception as e:
        print("  Apps Script:", e); return
    print("Apps Script: OK")
    print("\nNow your test.satyansh.blog login: the SAME email + password you use to log in on the site")
    print("(the account that shows the Host Control button).")
    sb = None
    for tries in range(3):
        email = input("Email: ").strip()
        spw = getpass.getpass("Password (typing will not show): ")
        try:
            sb = Supa(email, spw)
            break
        except Exception as e:
            if "invalid login" in str(e).lower():
                print("  Wrong email or password. Try again (forgot it? use 'Forgot password' on test.satyansh.blog).")
            elif "not confirmed" in str(e).lower():
                print("  This email is not confirmed yet. Open the confirmation mail first.")
            else:
                print("  Could not log in:", e)
    if sb is None:
        return
    try:
        before = sb.rpc("tp_admin_counts")
    except Exception as e:
        msg = str(e)
        if "teacher account" in msg:
            print("  Logged in, but this account is not the teacher (Live Quiz host) account. Use that account's email.")
        elif "Could not find the function" in msg or "does not exist" in msg:
            print("  Supabase is not set up yet: run backend/test_papers.sql in Supabase -> SQL Editor first.")
        else:
            print("  Supabase error:", msg)
        return
    print("Supabase: OK  (now has", before, ")")

    plist = apps("exportPapers", pw)["papers"]
    first = apps("exportResults", pw, offset=0, limit=1)
    total = first["total"]
    print(f"\nGoogle Sheet: {len(plist)} papers, {total} results")
    if not go:
        print("\nNothing moved. Run again with --go to move everything.")
        return

    print("\nMoving papers…")
    okp = bad = 0
    for i, p in enumerate(plist, 1):
        try:
            full = apps("getPaper", pw, id=p["id"])["paper"]
            sb.rpc("tp_admin_import_paper", {"p_id": p["id"], "p_paper": full, "p_active": bool(p["active"]),
                                            "p_order": int(p.get("order") or 0), "p_category": p.get("category") or "",
                                            "p_created": norm_date(p.get("created")), "p_updated": norm_date(p.get("updated"))})
            okp += 1
            print(f"  [{i}/{len(plist)}] ok   {p['name']}")
        except Exception as e:
            bad += 1
            print(f"  [{i}/{len(plist)}] FAIL {p['name']} - {e}")

    print("\nMoving results…")
    ins = skip = linked = 0
    off = 0
    while off < total:
        rows = apps("exportResults", pw, offset=off, limit=300)["rows"]
        if not rows:
            break
        for r in rows:
            r["time"] = norm_date(r.get("time"))
        for k in range(0, len(rows), 150):
            r = sb.rpc("tp_admin_import_attempts", {"p_rows": rows[k:k + 150]})
            ins += r["inserted"]; skip += r["skipped"]; linked += r["linked"]
        off += len(rows)
        print(f"  {off}/{total} rows read")

    after = sb.rpc("tp_admin_counts")
    print("\n================ CHECK ================")
    print(f"Papers : sheet {len(plist)}  ->  Supabase {after['papers']}   (failed: {bad})")
    print(f"Results: sheet {total}  ->  Supabase {after['fromSheet']} from the sheet   "
          f"(new now: {ins}, already there: {skip})")
    print(f"Results linked to a student account this run: {linked};  without an account in total: {after['noAccount']}")
    print("   (results without an account still show for a student whose email or phone matches)")
    if bad == 0 and after["fromSheet"] == total:
        print("\nAll moved. Next: set BACKEND: \"supabase\" in config.js (or ask Claude to switch it).")
    else:
        print("\nSomething did not move. Run the same command again; moved items are skipped.")


if __name__ == "__main__":
    main()
