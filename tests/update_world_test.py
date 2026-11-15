#!/usr/bin/env python3
"""Checks tools/update_world.py on a played world: an old Kingdom Quest copy (renamed folder, older version) and
another pack inside; the update swaps in the current packs, keeps the other pack, and leaves the world untouched.
Usage: python3 tests/update_world_test.py /tmp/pk/PrincessKingdom.mcworld"""
import filecmp, hashlib, json, os, shutil, subprocess, sys, tempfile, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ADDONS = os.path.join(HERE, "..", "addons")
fails = 0
def check(ok, msg):
    global fails
    if not ok:
        fails += 1
        print("FAIL: " + msg)

src = sys.argv[1]
tmp = tempfile.mkdtemp()
old = os.path.join(tmp, "old")
with zipfile.ZipFile(src) as z:
    z.extractall(old)
bp_uuid = json.load(open(os.path.join(ADDONS, "KingdomQuest_BP", "manifest.json")))["header"]["uuid"]
# make it look like an older, played world: Minecraft renames the pack folders, an older version, another pack
os.rename(os.path.join(old, "behavior_packs", "KingdomQuest_BP"), os.path.join(old, "behavior_packs", "kq_bp_0"))
m = os.path.join(old, "behavior_packs", "kq_bp_0", "manifest.json")
d = json.load(open(m)); d["header"]["version"] = [1, 7, 1]; json.dump(d, open(m, "w"))
os.makedirs(os.path.join(old, "behavior_packs", "other"))
json.dump({"format_version": 2, "header": {"uuid": "11111111-2222-3333-4444-555555555555", "version": [2, 0, 0], "name": "Other"}},
          open(os.path.join(old, "behavior_packs", "other", "manifest.json"), "w"))
json.dump([{"pack_id": bp_uuid, "version": [1, 7, 1]}, {"pack_id": "11111111-2222-3333-4444-555555555555", "version": [2, 0, 0]}],
          open(os.path.join(old, "world_behavior_packs.json"), "w"))
with open(os.path.join(old, "db", "PLAYED"), "w") as f:
    f.write("Havana's builds")
played = os.path.join(tmp, "PrincessKingdom.mcworld")
with zipfile.ZipFile(played, "w") as z:
    for r, _, files in os.walk(old):
        for fn in files:
            z.write(os.path.join(r, fn), os.path.relpath(os.path.join(r, fn), old))

out = subprocess.run([sys.executable, os.path.join(HERE, "..", "tools", "update_world.py"), played, "--out", os.path.join(tmp, "out")],
                     capture_output=True, text=True)
check(out.returncode == 0, "tool runs: " + out.stderr[-300:])
print(out.stdout.strip())
new = os.path.join(tmp, "new")
with zipfile.ZipFile(os.path.join(tmp, "out", "PrincessKingdom (updated).mcworld")) as z:
    z.extractall(new)
for kind, pack in (("behavior", "KingdomQuest_BP"), ("resource", "KingdomQuest_RP")):
    want = json.load(open(os.path.join(ADDONS, pack, "manifest.json")))["header"]
    folders = [n for n in os.listdir(os.path.join(new, kind + "_packs"))
               if json.load(open(os.path.join(new, kind + "_packs", n, "manifest.json")))["header"]["uuid"] == want["uuid"]]
    check(folders == [pack], "%s: exactly one copy, the new one (%s)" % (pack, folders))
    cmp = filecmp.dircmp(os.path.join(ADDONS, pack), os.path.join(new, kind + "_packs", pack))
    def same(c):
        return not (c.left_only or c.right_only or c.diff_files) and all(same(s) for s in c.subdirs.values())
    check(same(cmp), pack + ": the copy matches addons/")
    lst = json.load(open(os.path.join(new, "world_%s_packs.json" % kind)))
    check({"pack_id": want["uuid"], "version": want["version"]} in lst, pack + ": the world uses the new version")
lst = json.load(open(os.path.join(new, "world_behavior_packs.json")))
check(any(e["pack_id"].startswith("11111111") for e in lst) and os.path.isdir(os.path.join(new, "behavior_packs", "other")),
      "other packs kept")
check(not any(e["pack_id"] == bp_uuid and e["version"] == [1, 7, 1] for e in lst), "old version dropped from the list")
def digest(root):
    h = {}
    for r, _, files in os.walk(root):
        for fn in files:
            rel = os.path.relpath(os.path.join(r, fn), root)
            if rel.split(os.sep)[0] in ("behavior_packs", "resource_packs") or rel.startswith("world_"):
                continue
            h[rel] = hashlib.sha256(open(os.path.join(r, fn), "rb").read()).hexdigest()
    return h
check(digest(old) == digest(new), "the world itself (db, level.dat, name, icon) is untouched")
shutil.rmtree(tmp)
print("%d failed" % fails if fails else "OK")
sys.exit(1 if fails else 0)
