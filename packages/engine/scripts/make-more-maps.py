#!/usr/bin/env python3
"""
Authoring helper (3 October): writes four more Seafarers maps. Like make-sea-maps.ts, the JSON files
are the source of truth once written and played; never re-run this over a map people have played
(hex order defines board ids). Run from the repo root: python3 packages/engine/scripts/make-more-maps.py
"""
import json

SIDE_DIR = [(1, 0), (0, 1), (-1, 1), (-1, 0), (0, -1), (1, -1)]
RES5 = ['wood', 'brick', 'sheep', 'wheat', 'ore']


def dist(a, b):
    dq, dr = a[0] - b[0], a[1] - b[1]
    return (abs(dq) + abs(dr) + abs(dq + dr)) // 2


def disc(c, r):
    """Hexes within distance r of c, in a fixed order (row by row)."""
    out = []
    for dr in range(-r, r + 1):
        for dq in range(-r, r + 1):
            if abs(dq) + abs(dr) + abs(dq + dr) <= 2 * r:
                out.append((c[0] + dq, c[1] + dr))
    return sorted(out, key=lambda h: (h[1], h[0]))


def board(land, pad=1):
    """Every hex within `pad` of land, as sea unless land; sorted by row so the order is fixed."""
    cells = set()
    for h in land:
        for x in disc(h, pad):
            cells.add(x)
    return sorted(cells, key=lambda h: (h[1], h[0]))


def coast_sides(island, land):
    """(hex, side) on an island whose neighbour is water, in a fixed order."""
    out = []
    for h in sorted(island, key=lambda h: (h[1], h[0])):
        for s, (dq, dr) in enumerate(SIDE_DIR):
            if (h[0] + dq, h[1] + dr) not in land:
                out.append((h, s))
    return out


def spread(items, n):
    """n items spread evenly along a list."""
    return [items[(i * len(items)) // n] for i in range(n)]


def check_gap(islands, gap):
    for i, a in enumerate(islands):
        for b in islands[i + 1:]:
            d = min(dist(x, y) for x in a for y in b)
            assert d - 1 >= gap, (a, b, d)


def place(shapes, fixed, gap, radius):
    """
    Put each island shape (offsets from its first hex) where it is as far as possible from the land
    already placed, at least `gap` sea tiles away, and within `radius` of the centre. Deterministic.
    """
    placed = [list(f) for f in fixed]
    cands = disc((0, 0), radius)
    for shape in shapes:
        best, best_d = None, -1
        for a in cands:
            isl = [(a[0] + dq, a[1] + dr) for dq, dr in shape]
            if any(dist(h, (0, 0)) > radius for h in isl):
                continue
            if not placed:
                # The first island goes in the middle.
                score = -sum(dist(x, (0, 0)) for x in isl)
                if best is None or score > best_d:
                    best, best_d = isl, score
                continue
            d = min(dist(x, y) for x in isl for p in placed for y in p)
            # Far enough, but no farther than needed: the closest spot that keeps the gap, ties to
            # the one most out of the way of the rest.
            if d - 1 < gap:
                continue
            score = -d * 100 + sum(min(dist(x, y) for p in placed for y in p) for x in isl)
            if best is None or score > best_d:
                best, best_d = isl, score
        assert best is not None, shape
        placed.append(best)
    return placed[len(fixed):]


def numbers_for(n):
    """n number tokens, the classic spread repeated (no 7)."""
    base = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]
    out = []
    while len(out) < n:
        out += base
    # Take an even slice across the spread rather than the low end first.
    return sorted(spread(sorted(out), n))


def make(id_, name, islands, pools_of, *, start=None, harbors_on, n_harbors=9, win=13, island_vp=2,
         pirate=None, pad=2, robber='desert'):
    land = {h for isl in islands for h in isl}
    cells = board(land, pad)
    pool_hexes = {}
    hexes = []
    for h in cells:
        if h not in land:
            hexes.append({'q': h[0], 'r': h[1], 't': 'sea'})
            continue
        i = next(k for k, isl in enumerate(islands) if h in isl)
        pool = pools_of[i]
        if isinstance(pool, str) and pool in ('gold-fixed',):
            hexes.append({'q': h[0], 'r': h[1], 't': 'gold', 'n': 6})
            continue
        pool_hexes.setdefault(pool, 0)
        pool_hexes[pool] += 1
        hexes.append({'q': h[0], 'r': h[1], 't': 'random', 'pool': pool, 'n': 'random'})
    sides = []
    for i in harbors_on:
        sides += coast_sides(islands[i], land)
    chosen = spread(sides, n_harbors)
    harbors = [{'q': h[0], 'r': h[1], 'side': s, 't': 'random'} for h, s in chosen]
    m = {
        'format': 1, 'id': id_, 'name': name, 'modules': ['seafarers'], 'players': [3, 4], 'winVP': win,
        'specialVP': {'newIsland': island_vp}, 'hexes': hexes, 'pools': {}, 'harbors': harbors,
        'harborPool': ['any', 'any', 'any', 'any', 'wood', 'brick', 'sheep', 'wheat', 'ore'][:n_harbors],
        'start': 'all' if start is None else sorted([list(h) for h in start], key=lambda h: (h[0], h[1])),
        'robber': robber,
        'pirate': list(pirate) if pirate else None,
    }
    return m, pool_hexes


def terrain_mix(n, gold=0, desert=0):
    """n tiles: gold and deserts as asked, the rest spread over the five resources."""
    rest = n - gold - desert
    out = [RES5[i % 5] for i in range(rest)]
    return sorted(out) + ['gold'] * gold + ['desert'] * desert


def finish(m, pool_hexes, pools):
    for name, (gold, desert) in pools.items():
        n = pool_hexes[name]
        terr = terrain_mix(n, gold, desert)
        m['pools'][name] = {'terrain': terr, 'numbers': numbers_for(n - desert)}
    return m


CLASSIC_HOME = {'terrain': ['wood'] * 4 + ['brick'] * 3 + ['sheep'] * 4 + ['wheat'] * 4 + ['ore'] * 3 + ['desert'],
                'numbers': [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]}

maps = []

# 1. Classic and the Isles, far apart: the classic island and six small isles, each at least two
#    sea tiles from the home island and from each other.
home = disc((-4, 0), 2)
TRI = [(0, 0), (1, 0), (0, 1)]
TRI2 = [(0, 0), (1, 0), (1, -1)]
PAIR = [(0, 0), (1, 0)]
isles = place([TRI, TRI2, TRI, TRI2, TRI, TRI2, PAIR], [home], 2, 6)
check_gap([home] + isles, 2)
m, ph = make('classic-isles-far', 'Classic and the Isles, far apart', [home] + isles,
             ['home'] + ['isles'] * len(isles), start=home, harbors_on=[0], pirate=None, pad=1)
m['pools']['home'] = CLASSIC_HOME
# The home island is the classic island moved 4 to the west: its harbors go where the classic
# board's do (spread evenly, two would share a corner and no board could be made).
with open('packages/engine/maps/classic.json') as f:
    m['harbors'] = [dict(h, q=h['q'] - 4) for h in json.load(f)['harbors']]
n = ph['isles']
m['pools']['isles'] = {'terrain': terrain_mix(n, gold=3), 'numbers': numbers_for(n)}
maps.append(m)

# 2. Archipelago: nine small islands one sea tile apart, no home island: start anywhere.
arch = place([TRI, TRI2, TRI, TRI2, TRI, TRI2, TRI, TRI2, PAIR, PAIR], [], 1, 5)
check_gap(arch, 1)
m, ph = make('archipelago', 'Archipelago', arch, ['isles'] * len(arch), harbors_on=range(len(arch)), pirate=None, pad=1)
n = ph['isles']
m['pools']['isles'] = {'terrain': terrain_mix(n, gold=2, desert=1), 'numbers': numbers_for(n - 1)}
maps.append(m)

# 3. The Crossing: two big islands facing each other across a wide channel, with gold isles in the
#    middle. Start on either big island.
west = [h for h in disc((-4, 1), 2) if h != (-2, -1) and h != (-6, 3)] + [(-6, 2)]
west = sorted(set(west))
east = [(-q, -r) for q, r in west]
mid = [[(0, -2)], [(0, 2)], [(0, 0), (1, -1)]]
mid = [[(0, -3), (1, -3)], [(-1, 3), (0, 3)], [(0, 0)]]
check_gap([west, east] + mid, 1)
check_gap([west, east], 3)
m, ph = make('the-crossing', 'The Crossing', [west, east] + mid, ['west', 'east', 'mid', 'mid', 'mid'],
             start=west + east, harbors_on=[0, 1], n_harbors=9, pirate=(-1, 0), win=14)
for side in ('west', 'east'):
    k = ph[side]
    m['pools'][side] = {'terrain': terrain_mix(k, desert=1), 'numbers': numbers_for(k - 1)}
k = ph['mid']
m['pools']['mid'] = {'terrain': ['gold'] * 3 + ['ore', 'wheat'], 'numbers': [4, 5, 9, 10, 6]}
maps.append(m)

# 4. The Atoll: a ring of land around a wide lagoon, broken by three inlets into three arcs, with a
#    rich island (two gold fields) in the middle.
ring4 = [h for h in disc((0, 0), 4) if dist(h, (0, 0)) == 4]
inlets = {(4, 0), (-4, 4), (0, -4)}
arc = [h for h in ring4 if h not in inlets]
# Split the ring into its arcs (each a group of touching land hexes).
arcs = []
left = set(arc)
while left:
    seed = min(left)
    part, stack = {seed}, [seed]
    while stack:
        x = stack.pop()
        for dq, dr in SIDE_DIR:
            y = (x[0] + dq, x[1] + dr)
            if y in left and y not in part:
                part.add(y)
                stack.append(y)
    left -= part
    arcs.append(sorted(part))
centre = disc((0, 0), 1)
check_gap(arcs, 1)
for a in arcs:
    check_gap([a, centre], 2)
m, ph = make('atoll', 'The Atoll', arcs + [centre], ['ring'] * len(arcs) + ['heart'],
             start=[h for a in arcs for h in a], harbors_on=range(len(arcs)), pirate=None, win=13, pad=1)
k = ph['ring']
m['pools']['ring'] = {'terrain': terrain_mix(k, desert=1), 'numbers': numbers_for(k - 1)}
m['pools']['heart'] = {'terrain': ['gold', 'gold', 'wood', 'brick', 'sheep', 'wheat', 'ore'], 'numbers': [3, 4, 5, 6, 8, 9, 10]}
maps.append(m)

for m in maps:
    with open(f"packages/engine/maps/{m['id']}.json", 'w') as f:
        json.dump(m, f, indent=2)
        f.write('\n')
    land = sum(1 for h in m['hexes'] if h['t'] != 'sea')
    print(m['id'], len(m['hexes']), 'hexes', land, 'land', {k: len(v['terrain']) for k, v in m['pools'].items()})
