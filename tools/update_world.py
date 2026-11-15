#!/usr/bin/env python3
"""Update a Princess Kingdom world that is already being played to the newest Kingdom Quest, keeping everything.

On the iPad: Minecraft > Play > the pencil next to the world > Export World. Send that .mcworld here, then:

    python3 tools/update_world.py PrincessKingdom.mcworld --out /tmp/updated

The world itself (land, builds, inventories, story progress, Graham) is copied untouched; only the Kingdom Quest
behaviour and resource packs inside it are swapped for the ones in addons/, and world_*_packs.json is pointed at
their new version. Any other packs in the world are left as they are. Map changes made since the world was built
reach it through addons/KingdomQuest_BP/scripts/world_fixes.js (the script applies those in game).

Importing the result on the iPad adds it as another world (the old one stays until you delete it): play the new one.
"""
import argparse, json, os, shutil, sys, tempfile, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ADDONS = os.path.join(HERE, "..", "addons")
PACKS = (("behavior", "KingdomQuest_BP"), ("resource", "KingdomQuest_RP"))


def header(manifest_path):
    with open(manifest_path, encoding="utf-8-sig") as f:
        return json.load(f)["header"]


def world_root(tmp):
    """The folder holding level.dat (exports put it at the top, but be forgiving)."""
    for root, _, files in os.walk(tmp):
        if "level.dat" in files:
            return root
    sys.exit("That file has no level.dat: is it a Minecraft world?")


def update(src, out_dir):
    tmp = tempfile.mkdtemp()
    with zipfile.ZipFile(src) as z:
        for n in z.namelist():
            if n.startswith("/") or ".." in n.split("/"):
                sys.exit("Odd file name in the world: " + n)
        z.extractall(tmp)
    root = world_root(tmp)
    report = []
    for kind, pack in PACKS:
        new = header(os.path.join(ADDONS, pack, "manifest.json"))
        folder = os.path.join(root, kind + "_packs")
        os.makedirs(folder, exist_ok=True)
        old_versions = []
        for name in os.listdir(folder):
            m = os.path.join(folder, name, "manifest.json")
            if os.path.isfile(m) and header(m)["uuid"] == new["uuid"]:
                old_versions.append(header(m)["version"])
                shutil.rmtree(os.path.join(folder, name))
        shutil.copytree(os.path.join(ADDONS, pack), os.path.join(folder, pack))
        listing = os.path.join(root, "world_%s_packs.json" % kind)
        entries = []
        if os.path.exists(listing):
            with open(listing, encoding="utf-8-sig") as f:
                entries = json.load(f)
        entries = [e for e in entries if e.get("pack_id") != new["uuid"]]
        entries.insert(0, {"pack_id": new["uuid"], "version": new["version"]})
        with open(listing, "w") as f:
            json.dump(entries, f, indent=2)
        was = ", ".join(".".join(map(str, v)) for v in old_versions) or "none"
        report.append("%s: %s -> %s" % (pack, was, ".".join(map(str, new["version"]))))
        if old_versions and max(old_versions) >= new["version"]:
            report.append("  (warning: not newer than what the world had; Minecraft may keep its old copy - bump VERSION)")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, os.path.splitext(os.path.basename(src))[0] + " (updated).mcworld")
    if os.path.exists(out):
        os.remove(out)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for r, _, files in os.walk(root):
            for fn in files:
                full = os.path.join(r, fn)
                z.write(full, os.path.relpath(full, root))
    shutil.rmtree(tmp)
    return out, report


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("world", help="the exported .mcworld")
    ap.add_argument("--out", default=".", help="folder for the updated .mcworld")
    a = ap.parse_args()
    out, report = update(a.world, a.out)
    print("\n".join(report))
    print("Wrote " + out)
