"""Checks that everything the Sneaky Heist packs refer to actually exists in the packs: geometry, textures,
render controllers, animations, particles and item icons. (Minecraft doesn't complain loudly when one is missing:
the thing just doesn't show up, like the 1.6.0 Golden Crown on your head.)

Usage: python3 tests/heist_pack_check.py addons/SneakyHeist_BP addons/SneakyHeist_RP
"""
import glob, json, os, re, sys

bp, rp = sys.argv[1], sys.argv[2]
problems = []


def load(path):
    with open(path) as f:
        return json.load(f)


def exists_texture(rel):
    return any(os.path.exists(os.path.join(rp, rel + ext)) for ext in (".png", ".tga"))


geometries = set()
for path in glob.glob(os.path.join(rp, "models", "**", "*.json"), recursive=True):
    for g in load(path).get("minecraft:geometry", []):
        geometries.add(g["description"]["identifier"])
    if not os.path.relpath(path, os.path.join(rp, "models")).startswith(("entity", "blocks")):
        problems.append(f"{path}: models should be in models/entity (or models/blocks)")

controllers = set()
for path in glob.glob(os.path.join(rp, "render_controllers", "*.json")):
    controllers.update(load(path).get("render_controllers", {}).keys())

animations = set()
for path in glob.glob(os.path.join(rp, "animations", "*.json")):
    animations.update(load(path).get("animations", {}).keys())

particles = set()
for path in glob.glob(os.path.join(rp, "particles", "*.json")):
    pe = load(path)["particle_effect"]
    particles.add(pe["description"]["identifier"])
    tex = pe["description"]["basic_render_parameters"]["texture"]
    if not exists_texture(tex):
        problems.append(f"{path}: texture {tex} is missing")

VANILLA_PARTICLES = {"minecraft:mob_portal", "minecraft:villager_happy", "minecraft:totem_particle", "minecraft:huge_explosion_emitter"}

for kind in ("entity", "attachables"):
    for path in glob.glob(os.path.join(rp, kind, "*.json")):
        root = load(path)
        desc = (root.get("minecraft:client_entity") or root.get("minecraft:attachable"))["description"]
        for g in desc.get("geometry", {}).values():
            if g not in geometries:
                problems.append(f"{path}: geometry {g} isn't in any model file")
        for t in desc.get("textures", {}).values():
            if not t.startswith("textures/misc/") and not exists_texture(t):
                problems.append(f"{path}: texture {t} is missing")
        for c in desc.get("render_controllers", []):
            name = c if isinstance(c, str) else list(c.keys())[0]
            if name not in controllers:
                problems.append(f"{path}: render controller {name} isn't in this pack (don't rely on Minecraft's own names)")
        for a in desc.get("animations", {}).values():
            if a not in animations:
                problems.append(f"{path}: animation {a} is missing")

icons = load(os.path.join(rp, "textures", "item_texture.json"))["texture_data"]
for name, data in icons.items():
    if not exists_texture(data["textures"]):
        problems.append(f"item_texture.json: {name} -> {data['textures']} is missing")
for path in glob.glob(os.path.join(bp, "items", "*.json")):
    comps = load(path)["minecraft:item"]["components"]
    icon = comps.get("minecraft:icon", {})
    icon = icon.get("textures", {}).get("default") if isinstance(icon, dict) else icon
    if icon not in icons:
        problems.append(f"{path}: icon {icon} isn't in item_texture.json")
    ident = load(path)["minecraft:item"]["description"]["identifier"]
    if "minecraft:wearable" in comps and not os.path.exists(os.path.join(rp, "attachables", ident.split(":")[1] + ".json")):
        problems.append(f"{path}: wearable but no attachable for {ident}")

script = open(os.path.join(bp, "scripts", "main.js")).read()
for pid in set(re.findall(r'"((?:heist|minecraft):[a-z_]+)"', script)):
    if pid.startswith("heist:") and re.search(r'spawnParticle\([^)]*' + re.escape(pid), script) or \
            re.search(r'particle\([^,]+,\s*"' + re.escape(pid) + '"', script):
        if pid not in particles and pid not in VANILLA_PARTICLES:
            problems.append(f"main.js: particle {pid} isn't defined")
for pid in set(re.findall(r'(?:particle\(\w+(?:\(\w+\))?,\s*|spawnParticle\()"([a-z_]+:[a-z_]+)"', script)):
    if pid not in particles and pid not in VANILLA_PARTICLES:
        problems.append(f"main.js: particle {pid} isn't defined")
for pid in set(re.findall(r'spawnParticle\("([a-z_]+:[a-z_]+)"', script)):
    if pid not in particles and pid not in VANILLA_PARTICLES:
        problems.append(f"main.js: particle {pid} isn't defined")

for p in problems:
    print("PROBLEM " + p)
print(f"{len(geometries)} models, {len(controllers)} render controllers, {len(animations)} animations, {len(particles)} particles, {len(icons)} icons checked")
print("ALL PASSED" if not problems else f"{len(problems)} PROBLEMS")
sys.exit(1 if problems else 0)
