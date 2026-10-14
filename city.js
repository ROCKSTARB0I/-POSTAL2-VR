// Procedural town: a 5x5 grid of blocks, twelve enterable shops with interiors,
// filler high-rises, street furniture, road markings and a navigation graph for
// the crowd. Everything static is baked into a handful of big vertex buffers.
import { MeshBuilder, FACES_NO_BOTTOM } from './gfx.js';
import * as T from './textures.js';
import { rngFrom, rand, randI, pick } from './math.js';

export const ROAD = 12;          // road corridor width
export const BLOCK = 40;         // block interior
export const PITCH = BLOCK + ROAD;
export const GRIDN = 5;          // 5x5 blocks
export const TOWN = PITCH * GRIDN;
const WALL_T = 0.5;
const SHOP_H = 5.2;
const CEIL_H = 3.9;
const SIDEWALK_W = 3.2;

// road centre lines run along x = i*PITCH and z = j*PITCH
export const roadAt = i => i * PITCH;

const SHOPS = [
  { key: 'home', name: 'HOME', sub: 'IT IS NOT MUCH', facade: 'desertMint', front: '#3f6f4a', floor: 'wood', wall: '#cdc6b6', kit: 'home' },
  { key: 'bank', name: 'BANK', sub: 'YOUR MONEY, OUR RULES', facade: 'adobeWhite', front: '#2f6f7c', floor: 'tile', wall: '#d8d2c2', kit: 'bank', queue: 4.5 },
  { key: 'grocery', name: 'GROCERY', sub: 'FRESH ENOUGH', facade: 'sunBleach', front: '#c0392b', floor: 'tile', wall: '#d9d6cc', kit: 'aisles' },
  { key: 'library', name: 'LIBRARY', sub: 'QUIET PLEASE', facade: 'adobeTan', front: '#4a5b8c', floor: 'carpet', wall: '#cfc6ae', kit: 'library' },
  { key: 'gunshop', name: 'GUN SHOP', sub: 'PERMITS WHILE-U-WAIT', facade: 'cinder', front: '#7a5a2a', floor: 'concrete', wall: '#c6bfae', kit: 'guns', queue: 3.5 },
  { key: 'church', name: 'CHURCH', sub: 'ALL WELCOME', facade: 'adobeWhite', front: '#8a7a4a', floor: 'wood', wall: '#e0dac8', kit: 'church' },
  { key: 'postoffice', name: 'POST OFFICE', sub: 'NEXT WINDOW PLEASE', facade: 'adobeTan', front: '#1f5aa8', floor: 'tile', wall: '#d4cfc0', kit: 'post', queue: 6 },
  { key: 'police', name: 'POLICE', sub: 'TO SERVE AND BILL', facade: 'panelGrey', front: '#16336b', floor: 'tile', wall: '#c8cdd4', kit: 'police', queue: 5 },
  { key: 'clinic', name: 'CLINIC', sub: 'TAKE A NUMBER', facade: 'adobePink', front: '#2f8a6a', floor: 'tile', wall: '#dfe4e0', kit: 'clinic', queue: 5.5 },
  { key: 'mall', name: 'MALL', sub: 'RETAIL THERAPY', facade: 'sunBleach', front: '#8e44ad', floor: 'tile', wall: '#d6d2c8', kit: 'mall' },
  { key: 'bar', name: 'BAR', sub: 'OPEN SINCE NOON', facade: 'terracotta', front: '#b8860b', floor: 'wood', wall: '#8f7a5c', kit: 'bar' },
  { key: 'hardware', name: 'HARDWARE', sub: 'SHOVELS IN STOCK', facade: 'turquoise', front: '#d35400', floor: 'concrete', wall: '#cdc6b6', kit: 'hardware' },
];

// which block holds what -- LAYOUT[row z][col x]
const LAYOUT = [
  ['home', 'fill', 'grocery', 'fill', 'library'],
  ['hardware', 'park', 'fill', 'bar', 'fill'],
  ['bank', 'fill', 'mall', 'fill', 'clinic'],
  ['fill', 'church', 'fill', 'lot', 'fill'],
  ['gunshop', 'fill', 'police', 'fill', 'postoffice'],
];

const FILL_FACADES = ['adobeTan', 'adobeWhite', 'adobePink', 'terracotta', 'cinder', 'sunBleach', 'brickTan', 'turquoise'];

export function buildCity(renderer) {
  const rng = rngFrom(0x504f5354);           // "POST"
  const builders = new Map();                // texture key -> MeshBuilder
  const texes = new Map();                   // texture key -> GL texture
  const meta = new Map();                    // texture key -> draw options

  function B(key, makeCanvas, opts) {
    if (!builders.has(key)) {
      builders.set(key, new MeshBuilder());
      texes.set(key, renderer.texture(makeCanvas(), opts && opts.texOpts));
      meta.set(key, opts || {});
    }
    return builders.get(key);
  }

  const colliders = [];
  const addBox = (x0, z0, x1, z1, top = 99) => {
    colliders.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), top });
  };

  const shops = [];
  const props = { lamps: [], hydrants: [] };
  const carSpots = [];

  // ---------------------------------------------------------------- ground --
  const road = B('asphalt', T.asphalt);
  road.ground(-40, -40, TOWN + PITCH + 40, TOWN + PITCH + 40, 0, 8, [0.82, 0.82, 0.84]);

  const walk = B('sidewalk', T.sidewalkTex);
  const grassB = B('sand', T.sandTex);
  const scrubB = B('dry', T.dryGrassTex);
  const dirtB = B('dirt', T.dirtTex);

  // markings
  const dash = B('dash', T.roadDash, { alphaMode: 1, texOpts: { wrap: true } });
  const xwalk = B('xwalk', T.crosswalkTex, { alphaMode: 1 });

  for (let i = 0; i <= GRIDN; i++) {
    const c = roadAt(i);
    // centre dashes, both axes
    for (let s = 0; s <= GRIDN; s++) {
      const a = roadAt(s) - PITCH / 2;
      if (s === 0) continue;
      // along X (road runs in z)
      dash.ground(c - 0.32, a - PITCH / 2 + 8, c + 0.32, a + PITCH / 2 - 8, 0.02, 6, [1, 1, 1]);
      dash.ground(a - PITCH / 2 + 8, c - 0.32, a + PITCH / 2 - 8, c + 0.32, 0.02, 6, [1, 1, 1]);
    }
    // crosswalks at every intersection
    for (let j = 0; j <= GRIDN; j++) {
      const cz = roadAt(j);
      xwalk.ground(c - ROAD / 2 + 0.4, cz - ROAD / 2 - 2.6, c + ROAD / 2 - 0.4, cz - ROAD / 2 + 0.2, 0.03, 4, [1, 1, 1]);
      xwalk.ground(c - ROAD / 2 + 0.4, cz + ROAD / 2 - 0.2, c + ROAD / 2 - 0.4, cz + ROAD / 2 + 2.6, 0.03, 4, [1, 1, 1]);
    }
  }

  // ------------------------------------------------------------- the blocks --
  for (let gz = 0; gz < GRIDN; gz++) {
    for (let gx = 0; gx < GRIDN; gx++) {
      const x0 = roadAt(gx) + ROAD / 2, x1 = roadAt(gx + 1) - ROAD / 2;
      const z0 = roadAt(gz) + ROAD / 2, z1 = roadAt(gz + 1) - ROAD / 2;
      // kerb + sidewalk ring
      walk.ground(x0, z0, x1, z1, 0.16, 4, [1, 1, 1]);
      const k = B('kerb', () => T.sidewalkTex(), {});
      // kerb faces
      const kerbTint = [0.78, 0.78, 0.76];
      k.box((x0 + x1) / 2, 0.08, z0 + 0.05, x1 - x0, 0.16, 0.1, { uv: 4, tint: kerbTint, faces: { pz: 1, nz: 1, px: 0, nx: 0, py: 0, ny: 0 } });
      k.box((x0 + x1) / 2, 0.08, z1 - 0.05, x1 - x0, 0.16, 0.1, { uv: 4, tint: kerbTint, faces: { pz: 1, nz: 1, px: 0, nx: 0, py: 0, ny: 0 } });
      k.box(x0 + 0.05, 0.08, (z0 + z1) / 2, 0.1, 0.16, z1 - z0, { uv: 4, tint: kerbTint, faces: { px: 1, nx: 1, pz: 0, nz: 0, py: 0, ny: 0 } });
      k.box(x1 - 0.05, 0.08, (z0 + z1) / 2, 0.1, 0.16, z1 - z0, { uv: 4, tint: kerbTint, faces: { px: 1, nx: 1, pz: 0, nz: 0, py: 0, ny: 0 } });

      const kind = LAYOUT[gz][gx];
      const lot = {
        x0: x0 + SIDEWALK_W, z0: z0 + SIDEWALK_W,
        x1: x1 - SIDEWALK_W, z1: z1 - SIDEWALK_W,
        gx, gz,
      };

      if (kind === 'park') buildPark(lot);
      else if (kind === 'lot') buildParkingLot(lot);
      else if (kind === 'fill') buildFillers(lot);
      else buildShop(SHOPS.find(s => s.key === kind), lot);

      // street furniture along the block edges
      streetFurniture(x0, z0, x1, z1, gx, gz);
    }
  }

  // --------------------------------------------------------- outer skyline --
  buildOuterRing();
  mesas();
  welcomeSign();
  // power lines down the north-south highways
  for (let i = 0; i <= GRIDN; i++) {
    const x = roadAt(i) + ROAD / 2 + 1.2;
    let prev = null;
    for (let j = 0; j <= GRIDN; j++) {
      const z = roadAt(j) + 14;
      powerPole(x, z, 0);
      if (prev !== null) wire(x, prev, x, z, 7.9, 1.1);
      if (prev !== null) wire(x, prev, x, z, 7.2, 1.3);
      prev = z;
    }
  }

  // ------------------------------------------------------------------------
  function buildShop(spec, lot) {
    // The entrance faces whichever road side the block index points at, so the
    // twelve shops don't all open the same way.
    const dir = (lot.gx * 3 + lot.gz * 7) % 4;     // 0:-Z 1:+X 2:+Z 3:-X
    const lotW = lot.x1 - lot.x0, lotD = lot.z1 - lot.z0;
    const w = Math.min(lotW - 6, 30), d = Math.min(lotD - 6, 24);
    let cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
    const forecourt = 5;
    if (dir === 0) cz = lot.z0 + forecourt + d / 2;
    if (dir === 2) cz = lot.z1 - forecourt - d / 2;
    if (dir === 3) cx = lot.x0 + forecourt + w / 2;
    if (dir === 1) cx = lot.x1 - forecourt - w / 2;

    const bw = (dir === 1 || dir === 3) ? d : w;
    const bd = (dir === 1 || dir === 3) ? w : d;
    const yaw = [0, Math.PI / 2, Math.PI, -Math.PI / 2][dir];   // rotation of "front"

    const shop = {
      ...spec, cx, cz, w: bw, d: bd, dir, yaw,
      x0: cx - bw / 2, x1: cx + bw / 2, z0: cz - bd / 2, z1: cz + bd / 2,
    };

    // grass apron around the building
    grassB.ground(lot.x0, lot.z0, lot.x1, lot.z1, 0.17, 5, [1, 1, 1]);
    scrubPatch(lot);
    // concrete forecourt in front of the door
    const fc = frontRect(shop, forecourt + 0.6);
    B('walk2', T.sidewalkTex).ground(fc.x0, fc.z0, fc.x1, fc.z1, 0.19, 4, [1.02, 1.0, 0.98]);

    const facadeKey = 'fac:' + spec.facade;
    const fac = B(facadeKey, () => T.facade(spec.facade));
    const front = B('sf:' + spec.front, () => T.storefront(spec.front));
    const roofB = B('roof', T.roofTex);
    const iwall = B('iw:' + spec.wall, () => T.interiorWall(spec.wall));
    const ifloor = B('ifl:' + spec.floor, () => T.interiorFloor(spec.floor));
    const iceil = B('ceil', T.ceilingTex);

    // --- shell: four walls, door gap in the front one
    const doorW = 3.4, doorH = 2.9;
    const inner = { x0: shop.x0 + WALL_T, x1: shop.x1 - WALL_T, z0: shop.z0 + WALL_T, z1: shop.z1 - WALL_T };

    // side/back walls (facade outside, plaster inside -- two thin boxes)
    const walls = [
      { side: 0, x0: shop.x0, x1: shop.x1, z0: shop.z0, z1: shop.z0 + WALL_T },
      { side: 2, x0: shop.x0, x1: shop.x1, z0: shop.z1 - WALL_T, z1: shop.z1 },
      { side: 3, x0: shop.x0, x1: shop.x0 + WALL_T, z0: shop.z0, z1: shop.z1 },
      { side: 1, x0: shop.x1 - WALL_T, x1: shop.x1, z0: shop.z0, z1: shop.z1 },
    ];
    for (const wl of walls) {
      const isFront = wl.side === dir;
      const horiz = wl.side === 0 || wl.side === 2;
      const len = horiz ? wl.x1 - wl.x0 : wl.z1 - wl.z0;
      const b = isFront ? front : fac;
      if (!isFront) {
        emitWall(b, wl, 0, SHOP_H, horiz, 4);
        addBox(wl.x0, wl.z0, wl.x1, wl.z1);
      } else {
        // split around the doorway
        const midA = horiz ? (wl.x0 + wl.x1) / 2 : (wl.z0 + wl.z1) / 2;
        const a0 = (horiz ? wl.x0 : wl.z0), a1 = (horiz ? wl.x1 : wl.z1);
        const g0 = midA - doorW / 2, g1 = midA + doorW / 2;
        const segA = horiz ? { ...wl, x1: g0 } : { ...wl, z1: g0 };
        const segB = horiz ? { ...wl, x0: g1 } : { ...wl, z0: g1 };
        emitWall(b, segA, 0, SHOP_H, horiz, 4);
        emitWall(b, segB, 0, SHOP_H, horiz, 4);
        emitWall(b, horiz ? { ...wl, x0: g0, x1: g1 } : { ...wl, z0: g0, z1: g1 }, doorH, SHOP_H, horiz, 4);
        addBox(segA.x0, segA.z0, segA.x1, segA.z1);
        addBox(segB.x0, segB.z0, segB.x1, segB.z1);
        // door position + facing
        const dPos = horiz
          ? { x: midA, z: (wl.z0 + wl.z1) / 2 }
          : { x: (wl.x0 + wl.x1) / 2, z: midA };
        shop.door = { x: dPos.x, z: dPos.z, yaw };
        const ox = [0, 1, 0, -1][dir], oz = [-1, 0, 1, 0][dir];
        shop.out = { x: ox, z: oz };
        shop.entry = { x: dPos.x + ox * 3.2, z: dPos.z + oz * 3.2 };
        shop.street = { x: dPos.x + ox * 6.5, z: dPos.z + oz * 6.5 };
      }
    }

    // plaster lining inside, so you aren't looking at brickwork from the sofa
    {
      const gap = doorW / 2, T2 = 0.07;
      const panels = [
        { side: 0, x0: inner.x0, x1: inner.x1, z0: inner.z0, z1: inner.z0 + T2, horiz: true, mid: cx },
        { side: 2, x0: inner.x0, x1: inner.x1, z0: inner.z1 - T2, z1: inner.z1, horiz: true, mid: cx },
        { side: 3, x0: inner.x0, x1: inner.x0 + T2, z0: inner.z0, z1: inner.z1, horiz: false, mid: cz },
        { side: 1, x0: inner.x1 - T2, x1: inner.x1, z0: inner.z0, z1: inner.z1, horiz: false, mid: cz },
      ];
      for (const pn of panels) {
        if (pn.side === dir) {
          const a = pn.horiz ? { ...pn, x1: pn.mid - gap } : { ...pn, z1: pn.mid - gap };
          const b2 = pn.horiz ? { ...pn, x0: pn.mid + gap } : { ...pn, z0: pn.mid + gap };
          emitWall(iwall, a, 0.24, CEIL_H, pn.horiz, 3);
          emitWall(iwall, b2, 0.24, CEIL_H, pn.horiz, 3);
          emitWall(iwall, pn.horiz ? { ...pn, x0: pn.mid - gap, x1: pn.mid + gap }
            : { ...pn, z0: pn.mid - gap, z1: pn.mid + gap }, doorH, CEIL_H, pn.horiz, 3);
        } else {
          emitWall(iwall, pn, 0.24, CEIL_H, pn.horiz, 3);
        }
      }
    }

    // floor + ceiling
    ifloor.ground(inner.x0, inner.z0, inner.x1, inner.z1, 0.24, 4, [1.12, 1.10, 1.06]);
    iceil.ground(inner.x0, inner.z0, inner.x1, inner.z1, CEIL_H, 4, [1.1, 1.08, 1.04], true);
    // roof slab + parapet
    roofB.box(cx, SHOP_H + 0.2, cz, bw, 0.4, bd, { uv: 6, tint: [1, 1, 1] });
    const par = B('fac:' + spec.facade, () => T.facade(spec.facade));
    par.box(cx, SHOP_H + 0.75, shop.z0 + 0.2, bw, 0.7, 0.4, { uv: 4 });
    par.box(cx, SHOP_H + 0.75, shop.z1 - 0.2, bw, 0.7, 0.4, { uv: 4 });
    par.box(shop.x0 + 0.2, SHOP_H + 0.75, cz, 0.4, 0.7, bd, { uv: 4 });
    par.box(shop.x1 - 0.2, SHOP_H + 0.75, cz, 0.4, 0.7, bd, { uv: 4 });

    // sign over the entrance
    const sgn = B('sign:' + spec.key, () => T.sign(spec.name, '#15161c', signColor(spec.key), spec.sub),
      { alphaMode: 0, texOpts: { wrap: false } });
    const nx = [0, 1, 0, -1][dir], nz = [-1, 0, 1, 0][dir];
    sgn.panel(shop.door.x + nx * (WALL_T / 2 + 0.14), SHOP_H - 0.75, shop.door.z + nz * (WALL_T / 2 + 0.14),
      Math.min(bw - 1.5, 9), 2.25, yaw);
    // blade sign sticking out over the street
    sgn.panel(shop.door.x + nx * 1.6 + nz * 0.1, SHOP_H - 2.6, shop.door.z + nz * 1.6 - nx * 0.1,
      3.2, 0.9, yaw + Math.PI / 2);
    sgn.panel(shop.door.x + nx * 1.6 + nz * 0.1, SHOP_H - 2.6, shop.door.z + nz * 1.6 - nx * 0.1,
      3.2, 0.9, yaw + Math.PI / 2, null, true);

    // awning
    const aw = B('awn:' + spec.front, () => T.storefront(spec.front));
    aw.box(shop.door.x + nx * 1.1, doorH + 0.55, shop.door.z + nz * 1.1,
      dir % 2 ? 2.6 : Math.min(bw - 1, 10), 0.28, dir % 2 ? Math.min(bd - 1, 10) : 2.6, { uv: 3, tint: [1.05, 1.05, 1.05] });

    // interior fittings
    shop.inner = inner;
    fitOut(shop, inner);
    shops.push(shop);
  }

  function emitWall(b, wl, y0, y1, horiz, uv) {
    const cx = (wl.x0 + wl.x1) / 2, cz = (wl.z0 + wl.z1) / 2;
    const w = wl.x1 - wl.x0, d = wl.z1 - wl.z0;
    if (w <= 0.001 || d <= 0.001 || y1 <= y0) return;
    b.box(cx, (y0 + y1) / 2, cz, w, y1 - y0, d, { uv, tint: [1, 1, 1], uvOffset: [0, y0 / uv] });
  }

  function frontRect(shop, depth) {
    const d = shop.dir;
    if (d === 0) return { x0: shop.x0 - 1, x1: shop.x1 + 1, z0: shop.z0 - depth, z1: shop.z0 };
    if (d === 2) return { x0: shop.x0 - 1, x1: shop.x1 + 1, z0: shop.z1, z1: shop.z1 + depth };
    if (d === 3) return { x0: shop.x0 - depth, x1: shop.x0, z0: shop.z0 - 1, z1: shop.z1 + 1 };
    return { x0: shop.x1, x1: shop.x1 + depth, z0: shop.z0 - 1, z1: shop.z1 + 1 };
  }

  // ---- interior furniture kits --------------------------------------------
  function fitOut(shop, inner) {
    const wood = B('wood', T.woodTex);
    const metal = B('metal', () => T.metalTex('#8f9296'));
    const shelfB = B('shelf', T.shelfTex);
    const iw = B('iw:' + shop.wall, () => T.interiorWall(shop.wall));
    const cxm = (inner.x0 + inner.x1) / 2, czm = (inner.z0 + inner.z1) / 2;
    const back = backPoint(shop, inner, 3.0);
    const kit = shop.kit;

    // the errand spot: a step in front of the counter, near the back wall
    shop.spot = { x: back.sx, z: back.sz };

    const counter = (cx, cz, w, d, tex) => {
      tex.box(cx, 0.55, cz, w, 1.1, d, { uv: 2, tint: [1.05, 1.05, 1.05] });
      metal.box(cx, 1.16, cz, w + 0.24, 0.12, d + 0.24, { uv: 2, tint: [1.1, 1.1, 1.1] });
      addBox(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, 1.2);
    };

    if (kit === 'aisles' || kit === 'mall' || kit === 'hardware') {
      const along = shop.dir % 2 === 0;
      const n = 3;
      for (let i = 0; i < n; i++) {
        const t = (i + 1) / (n + 1);
        if (along) {
          const zx = inner.z0 + (inner.z1 - inner.z0) * t;
          shelfB.box(cxm, 1.15, zx, (inner.x1 - inner.x0) - 5, 2.3, 1.2, { uv: 2.3 });
          addBox(cxm - ((inner.x1 - inner.x0) - 5) / 2, zx - 0.6, cxm + ((inner.x1 - inner.x0) - 5) / 2, zx + 0.6, 2.3);
        } else {
          const xx = inner.x0 + (inner.x1 - inner.x0) * t;
          shelfB.box(xx, 1.15, czm, 1.2, 2.3, (inner.z1 - inner.z0) - 5, { uv: 2.3 });
          addBox(xx - 0.6, czm - ((inner.z1 - inner.z0) - 5) / 2, xx + 0.6, czm + ((inner.z1 - inner.z0) - 5) / 2, 2.3);
        }
      }
      counter(back.cx, back.cz, back.horiz ? 5 : 1.2, back.horiz ? 1.2 : 5, wood);
    } else if (kit === 'bank' || kit === 'post' || kit === 'police' || kit === 'clinic') {
      counter(back.cx, back.cz, back.horiz ? 9 : 1.4, back.horiz ? 1.4 : 9, wood);
      // teller glass
      const gl = B('glass', T.glassDoorTex, { alphaMode: 0 });
      gl.box(back.cx, 1.85, back.cz, back.horiz ? 9 : 0.2, 1.3, back.horiz ? 0.2 : 9, { uv: 2, tint: [1, 1, 1] });
      // waiting-room chairs
      for (let i = 0; i < 4; i++) {
        const ox = back.horiz ? inner.x0 + 2 + i * 2 : cxm + (i - 2) * 0.1;
        const oz = back.horiz ? czm + 2.2 : inner.z0 + 2 + i * 2;
        metal.box(ox, 0.45, oz, 0.7, 0.1, 0.7, { uv: 1, tint: [0.8, 0.85, 0.95] });
        metal.box(ox, 0.75, oz - 0.3, 0.7, 0.7, 0.1, { uv: 1, tint: [0.8, 0.85, 0.95] });
      }
      // velvet rope queue posts
      for (let i = 0; i < 3; i++) {
        const t = i * 1.8;
        const px = back.horiz ? cxm - 2 + t : back.cx + 2.5;
        const pz = back.horiz ? back.cz + 3.2 : czm - 2 + t;
        metal.cylinder(px, 0, pz, 0.09, 1.0, 8, [0.9, 0.8, 0.4]);
      }
    } else if (kit === 'library') {
      for (let i = 0; i < 4; i++) {
        const t = (i + 1) / 5;
        const xx = inner.x0 + (inner.x1 - inner.x0) * t;
        shelfB.box(xx, 1.3, czm, 1.1, 2.6, (inner.z1 - inner.z0) - 6, { uv: 2.6, tint: [0.95, 0.92, 0.88] });
        addBox(xx - 0.55, czm - ((inner.z1 - inner.z0) - 6) / 2, xx + 0.55, czm + ((inner.z1 - inner.z0) - 6) / 2, 2.6);
      }
      counter(back.cx, back.cz, back.horiz ? 4 : 1.2, back.horiz ? 1.2 : 4, wood);
    } else if (kit === 'church') {
      const rows = 6;
      for (let i = 0; i < rows; i++) {
        const t = (i + 1) / (rows + 2);
        const zz = inner.z0 + (inner.z1 - inner.z0) * t;
        wood.box(cxm, 0.45, zz, (inner.x1 - inner.x0) - 6, 0.18, 0.5, { uv: 2, tint: [0.9, 0.8, 0.7] });
        wood.box(cxm, 0.75, zz - 0.28, (inner.x1 - inner.x0) - 6, 0.8, 0.14, { uv: 2, tint: [0.9, 0.8, 0.7] });
        addBox(cxm - ((inner.x1 - inner.x0) - 6) / 2, zz - 0.35, cxm + ((inner.x1 - inner.x0) - 6) / 2, zz + 0.35, 0.9);
      }
      wood.box(back.cx, 0.6, back.cz, 1.6, 1.2, 0.9, { uv: 2, tint: [0.85, 0.7, 0.55] });
      addBox(back.cx - 0.8, back.cz - 0.45, back.cx + 0.8, back.cz + 0.45, 1.3);
      const goldB = B('metal', () => T.metalTex('#8f9296'));
      goldB.box(back.cx, 2.4, back.cz + (shop.dir === 2 ? -0.4 : 0.4), 0.22, 1.6, 0.22, { uv: 1, tint: [1.4, 1.2, 0.6] });
      goldB.box(back.cx, 2.6, back.cz + (shop.dir === 2 ? -0.4 : 0.4), 1.0, 0.22, 0.22, { uv: 1, tint: [1.4, 1.2, 0.6] });
    } else if (kit === 'bar') {
      counter(back.cx, back.cz, back.horiz ? 8 : 1.3, back.horiz ? 1.3 : 8, wood);
      shelfB.box(back.bx, 1.5, back.bz, back.horiz ? 8 : 0.6, 2.4, back.horiz ? 0.6 : 8, { uv: 2.2 });
      for (let i = 0; i < 5; i++) {
        const ox = back.horiz ? back.cx - 3.2 + i * 1.6 : back.cx + 1.8;
        const oz = back.horiz ? back.cz + 1.8 : back.cz - 3.2 + i * 1.6;
        B('metal', () => T.metalTex('#8f9296')).cylinder(ox, 0, oz, 0.22, 0.95, 10, [0.8, 0.7, 0.6]);
      }
      for (let i = 0; i < 3; i++) {
        const tx = inner.x0 + 2.5 + i * 3.2, tz = inner.z0 + 2.6;
        wood.cylinder(tx, 0, tz, 0.55, 0.95, 12, [0.9, 0.75, 0.6]);
        addBox(tx - 0.55, tz - 0.55, tx + 0.55, tz + 0.55, 1.0);
      }
    } else if (kit === 'guns') {
      counter(back.cx, back.cz, back.horiz ? 6 : 1.3, back.horiz ? 1.3 : 6, wood);
      shelfB.box(back.bx, 1.4, back.bz, back.horiz ? 8 : 0.5, 2.2, back.horiz ? 0.5 : 8, { uv: 2.2 });
      const rack = B('metal', () => T.metalTex('#6d7076'));
      for (let i = 0; i < 6; i++) {
        const ox = back.horiz ? back.bx0 + i * 1.2 : back.bx + 0.3;
        const oz = back.horiz ? back.bz + 0.3 : back.bz0 + i * 1.2;
        rack.box(ox, 1.7, oz, 0.9, 0.1, 0.1, { uv: 1, tint: [0.5, 0.5, 0.55], ry: back.horiz ? 0 : Math.PI / 2 });
      }
    } else if (kit === 'home') {
      // couch, tv, table, bed
      const cloth = B('metal', () => T.metalTex('#7a5f8c'));
      cloth.box(inner.x0 + 2.4, 0.42, czm, 1.1, 0.84, 3.0, { uv: 2, tint: [0.75, 0.6, 0.85] });
      cloth.box(inner.x0 + 1.9, 0.85, czm, 0.3, 0.9, 3.0, { uv: 2, tint: [0.68, 0.54, 0.78] });
      addBox(inner.x0 + 1.7, czm - 1.5, inner.x0 + 3.0, czm + 1.5, 0.9);
      const tv = B('metal', () => T.metalTex('#26282c'));
      tv.box(inner.x1 - 2.0, 1.1, czm, 0.25, 1.3, 2.2, { uv: 2, tint: [0.25, 0.25, 0.3] });
      tv.box(inner.x1 - 2.0, 0.35, czm, 0.7, 0.7, 1.4, { uv: 2, tint: [0.4, 0.4, 0.45] });
      addBox(inner.x1 - 2.4, czm - 1.1, inner.x1 - 1.6, czm + 1.1, 1.8);
      wood.box(cxm, 0.35, inner.z0 + 2.4, 2.0, 0.7, 1.1, { uv: 2, tint: [0.95, 0.85, 0.7] });
      addBox(cxm - 1, inner.z0 + 1.85, cxm + 1, inner.z0 + 2.95, 0.8);
      // bed
      cloth.box(cxm + 2.5, 0.3, inner.z1 - 2.4, 2.0, 0.6, 2.6, { uv: 2, tint: [0.9, 0.9, 0.95] });
      addBox(cxm + 1.5, inner.z1 - 3.7, cxm + 3.5, inner.z1 - 1.1, 0.7);
    }

    // ceiling lights (unlit emissive panels)
    const lamp = B('lamp', () => T.blob('255,244,214', 0.5), { alphaMode: 2, unlit: true, blend: true, texOpts: { wrap: false } });
    for (let i = -1; i <= 1; i += 2) for (let j = -1; j <= 1; j += 2) {
      lamp.ground(cxm + i * 3.4 - 1.1, czm + j * 3.4 - 1.1, cxm + i * 3.4 + 1.1, czm + j * 3.4 + 1.1, CEIL_H - 0.06, 2.2, [1, 1, 1]);
    }
  }

  // Where the counter goes: against the wall opposite the door.
  function backPoint(shop, inner, inset) {
    const d = shop.dir, horiz = d === 0 || d === 2;
    let cx, cz, bx, bz, sx, sz;
    if (d === 0) { cz = inner.z1 - inset; cx = (inner.x0 + inner.x1) / 2; bz = inner.z1 - 0.4; bx = cx; sz = cz - 1.6; sx = cx; }
    else if (d === 2) { cz = inner.z0 + inset; cx = (inner.x0 + inner.x1) / 2; bz = inner.z0 + 0.4; bx = cx; sz = cz + 1.6; sx = cx; }
    else if (d === 3) { cx = inner.x1 - inset; cz = (inner.z0 + inner.z1) / 2; bx = inner.x1 - 0.4; bz = cz; sx = cx - 1.6; sz = cz; }
    else { cx = inner.x0 + inset; cz = (inner.z0 + inner.z1) / 2; bx = inner.x0 + 0.4; bz = cz; sx = cx + 1.6; sz = cz; }
    return { cx, cz, bx, bz, sx, sz, horiz, bx0: bx - 3.5, bz0: bz - 3.5 };
  }

  // ---- non-shop blocks -----------------------------------------------------
  function buildPark(lot) {
    grassB.ground(lot.x0 - SIDEWALK_W + 1, lot.z0 - SIDEWALK_W + 1, lot.x1 + SIDEWALK_W - 1, lot.z1 + SIDEWALK_W - 1, 0.18, 6, [1, 1, 1]);
    scrubB.ground(lot.x0 + 4, lot.z0 + 4, lot.x1 - 4, lot.z1 - 4, 0.185, 5, [1, 1, 1]);
    const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
    dirtB.ground(cx - 9, cz - 2.2, cx + 9, cz + 2.2, 0.19, 4, [1, 1, 1]);
    dirtB.ground(cx - 2.2, cz - 9, cx + 2.2, cz + 9, 0.19, 4, [1, 1, 1]);
    // fountain
    const stone = B('metal', () => T.metalTex('#9a978e'));
    stone.cylinder(cx, 0.18, cz, 3.2, 0.9, 16, [1.0, 1.0, 0.98]);
    stone.cylinder(cx, 1.0, cz, 0.5, 1.6, 10, [0.95, 0.95, 0.92]);
    addBox(cx - 3.2, cz - 3.2, cx + 3.2, cz + 3.2, 1.0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.3;
      tree(cx + Math.cos(a) * 13, cz + Math.sin(a) * 13, 1 + rng() * 0.5);
    }
    for (let i = 0; i < 4; i++) {
      bench(cx + [1, -1, 0, 0][i] * 5.5, cz + [0, 0, 1, -1][i] * 5.5, [Math.PI / 2, -Math.PI / 2, 0, Math.PI][i]);
    }
  }

  function buildParkingLot(lot) {
    B('asphalt', T.asphalt).ground(lot.x0 - 2, lot.z0 - 2, lot.x1 + 2, lot.z1 + 2, 0.17, 8, [0.9, 0.9, 0.92]);
    const line = B('line', T.roadLine, { alphaMode: 1 });
    for (let i = 0; i <= 8; i++) {
      const x = lot.x0 + 2 + i * ((lot.x1 - lot.x0 - 4) / 8);
      line.ground(x - 0.1, lot.z0 + 2, x + 0.1, lot.z0 + 8, 0.19, 3, [1, 1, 1]);
      line.ground(x - 0.1, lot.z1 - 8, x + 0.1, lot.z1 - 2, 0.19, 3, [1, 1, 1]);
    }
    for (let i = 0; i < 8; i++) {
      if (rng() < 0.45) continue;
      const x = lot.x0 + 3.6 + i * ((lot.x1 - lot.x0 - 4) / 8);
      carSpots.push({ x, z: lot.z0 + 5, yaw: 0 });
      carSpots.push({ x, z: lot.z1 - 5, yaw: Math.PI });
    }
    // a couple of light poles
    lampPost(lot.x0 + 4, (lot.z0 + lot.z1) / 2, 0);
    lampPost(lot.x1 - 4, (lot.z0 + lot.z1) / 2, Math.PI);
  }

  function buildFillers(lot) {
    B('walk2', T.sidewalkTex).ground(lot.x0 - 1, lot.z0 - 1, lot.x1 + 1, lot.z1 + 1, 0.17, 4, [0.96, 0.96, 0.94]);
    const n = randI(rng, 2, 3);
    const cols = n === 2 ? [[0, 0.55], [0.58, 1]] : [[0, 0.36], [0.38, 0.68], [0.70, 1]];
    for (const [a, b] of cols) {
      const x0 = lot.x0 + (lot.x1 - lot.x0) * a + 0.6;
      const x1 = lot.x0 + (lot.x1 - lot.x0) * b - 0.6;
      const z0 = lot.z0 + rand(rng, 0, 3), z1 = lot.z1 - rand(rng, 0, 3);
      tower(x0, z0, x1, z1, rand(rng, 4.6, 11));
    }
  }

  function tower(x0, z0, x1, z1, h) {
    const key = pick(rng, FILL_FACADES);
    const b = B('fac:' + key, () => T.facade(key));
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
    b.box(cx, h / 2, cz, w, h, d, { uv: 4, gradient: 0.22, faces: FACES_NO_BOTTOM });
    // ground floor storefront band
    const sfc = pick(rng, ['#b03a34', '#2f6f7c', '#7a5a2a', '#385a8a', '#5f7a35']);
    B('sf:' + sfc, () => T.storefront(sfc)).box(cx, 1.75, cz, w + 0.12, 3.5, d + 0.12, { uv: 4, faces: FACES_NO_BOTTOM });
    B('roof', T.roofTex).box(cx, h + 0.15, cz, w, 0.3, d, { uv: 6 });
    b.box(cx, h + 0.75, z0 + 0.25, w, 1.0, 0.5, { uv: 4 });
    b.box(cx, h + 0.75, z1 - 0.25, w, 1.0, 0.5, { uv: 4 });
    b.box(x0 + 0.25, h + 0.75, cz, 0.5, 1.0, d, { uv: 4 });
    b.box(x1 - 0.25, h + 0.75, cz, 0.5, 1.0, d, { uv: 4 });
    // rooftop clutter
    const mtl = B('metal', () => T.metalTex('#8f9296'));
    for (let i = 0; i < 3; i++) {
      const ux = rand(rng, x0 + 2, x1 - 2), uz = rand(rng, z0 + 2, z1 - 2);
      mtl.box(ux, h + 0.9, uz, rand(rng, 1.2, 2.4), 1.2, rand(rng, 1.2, 2.4), { uv: 2, tint: [0.85, 0.86, 0.88] });
    }
    addBox(x0, z0, x1, z1);
  }

  function buildOuterRing() {
    const lo = -34, hi = TOWN + 34;
    for (let i = -1; i <= GRIDN; i++) {
      const a0 = roadAt(i) + ROAD / 2, a1 = roadAt(i + 1) - ROAD / 2;
      if (a1 <= a0) continue;
      tower(a0, lo, a1, -ROAD / 2 - 2, rand(rng, 5, 13));
      tower(a0, TOWN + ROAD / 2 + 2, a1, hi, rand(rng, 5, 13));
      tower(lo, a0, -ROAD / 2 - 2, a1, rand(rng, 5, 13));
      tower(TOWN + ROAD / 2 + 2, a0, hi, a1, rand(rng, 5, 13));
    }
  }

  // ---- street furniture ----------------------------------------------------
  function streetFurniture(x0, z0, x1, z1, gx, gz) {
    lampPost(x0 + 1.4, z0 + 1.4, Math.PI * 0.25);
    lampPost(x1 - 1.4, z1 - 1.4, Math.PI * 1.25);
    if ((gx + gz) % 2 === 0) {
      hydrant(x0 + 1.2, (z0 + z1) / 2 + 6);
      trashCan(x1 - 1.3, (z0 + z1) / 2 - 5);
    } else {
      trashCan(x0 + 1.3, (z0 + z1) / 2 + 4);
      hydrant(x1 - 1.2, (z0 + z1) / 2 - 7);
    }
    if ((gx * 5 + gz) % 3 === 0) mailbox((x0 + x1) / 2 + 3, z0 + 1.3);
    if ((gx * 3 + gz) % 4 === 1) busStop((x0 + x1) / 2, z1 - 1.6, Math.PI);
    // curbside parking
    for (let i = 0; i < 3; i++) {
      if (rng() < 0.5) continue;
      carSpots.push({ x: x0 + 6 + i * 11, z: z0 - ROAD / 2 + 2.6, yaw: Math.PI / 2, street: true });
    }
    for (let i = 0; i < 3; i++) {
      if (rng() < 0.5) continue;
      carSpots.push({ x: x0 + 6 + i * 11, z: z1 + ROAD / 2 - 2.6, yaw: -Math.PI / 2, street: true });
    }
    // trees along two edges
    for (let i = 0; i < 3; i++) {
      tree(x0 + 8 + i * 12, z0 + 1.5, 0.9 + rng() * 0.4);
      tree(x1 - 8 - i * 12, z1 - 1.5, 0.9 + rng() * 0.4);
    }
  }

  function lampPost(x, z, yaw) {
    const m = B('metal', () => T.metalTex('#6f7378'));
    m.cylinder(x, 0.16, z, 0.11, 5.4, 8, [0.55, 0.57, 0.6]);
    m.box(x + Math.cos(yaw) * 0.7, 5.5, z + Math.sin(yaw) * 0.7, 1.6, 0.14, 0.14, { uv: 1, tint: [0.55, 0.57, 0.6], ry: -yaw });
    const g = B('lamp', () => T.blob('255,236,190', 0.5), { alphaMode: 2, unlit: true, blend: true, texOpts: { wrap: false } });
    g.ground(x + Math.cos(yaw) * 1.4 - 0.5, z + Math.sin(yaw) * 1.4 - 0.5,
      x + Math.cos(yaw) * 1.4 + 0.5, z + Math.sin(yaw) * 1.4 + 0.5, 5.36, 1, [1, 1, 1]);
    addBox(x - 0.2, z - 0.2, x + 0.2, z + 0.2, 5.5);
  }

  function hydrant(x, z) {
    const m = B('metal', () => T.metalTex('#b03026'));
    m.cylinder(x, 0.16, z, 0.22, 0.62, 8, [1.3, 0.4, 0.35]);
    m.box(x, 0.86, z, 0.55, 0.16, 0.3, { uv: 1, tint: [1.3, 0.4, 0.35] });
    m.cylinder(x, 0.78, z, 0.12, 0.2, 6, [1.3, 0.4, 0.35]);
    addBox(x - 0.3, z - 0.3, x + 0.3, z + 0.3, 0.9);
  }

  function trashCan(x, z) {
    const m = B('metal', () => T.metalTex('#4f5a4a'));
    m.cylinder(x, 0.16, z, 0.36, 0.95, 10, [0.8, 0.9, 0.8]);
    addBox(x - 0.4, z - 0.4, x + 0.4, z + 0.4, 1.0);
  }

  function mailbox(x, z) {
    const m = B('metal', () => T.metalTex('#2f5fa8'));
    m.box(x, 0.75, z, 0.7, 0.9, 0.5, { uv: 1, tint: [0.55, 0.8, 1.35] });
    m.cylinder(x, 0.16, z, 0.08, 0.35, 6, [0.4, 0.42, 0.45]);
    addBox(x - 0.4, z - 0.3, x + 0.4, z + 0.3, 1.2);
  }

  function bench(x, z, yaw) {
    const w = B('wood', T.woodTex);
    w.box(x, 0.46, z, 1.8, 0.12, 0.6, { uv: 1.5, ry: yaw, tint: [1, 0.95, 0.9] });
    w.box(x - Math.sin(yaw) * 0.26, 0.78, z - Math.cos(yaw) * 0.26, 1.8, 0.6, 0.1, { uv: 1.5, ry: yaw, tint: [1, 0.95, 0.9] });
    B('metal', () => T.metalTex('#4a4d52')).box(x, 0.2, z, 1.7, 0.4, 0.12, { uv: 1, ry: yaw, tint: [0.5, 0.5, 0.55] });
    addBox(x - 1, z - 0.5, x + 1, z + 0.5, 0.9);
  }

  function busStop(x, z, yaw) {
    const m = B('metal', () => T.metalTex('#5a5f66'));
    m.box(x, 1.4, z, 4.2, 0.12, 1.8, { uv: 2, ry: yaw, tint: [0.7, 0.75, 0.8] });
    m.box(x - 2.0, 0.75, z, 0.14, 1.5, 1.7, { uv: 2, ry: yaw, tint: [0.6, 0.65, 0.7] });
    m.box(x + 2.0, 0.75, z, 0.14, 1.5, 1.7, { uv: 2, ry: yaw, tint: [0.6, 0.65, 0.7] });
    bench(x, z - 0.4, yaw);
    const p = B('poster:sale', () => T.posterTex('sale'), { texOpts: { wrap: false } });
    p.panel(x + 2.1, 1.0, z, 1.2, 1.6, yaw + Math.PI / 2);
    addBox(x - 2.2, z - 0.9, x + 2.2, z + 0.9, 1.6);
  }

  // A street tree in Paradise is a palm, a saguaro, or a dead-looking shrub.
  function tree(x, z, scale) {
    const roll = rng();
    if (roll < 0.55) palm(x, z, scale);
    else if (roll < 0.85) cactus(x, z, scale);
    else scrubBush(x, z, scale);
  }

  function palm(x, z, scale) {
    const h = (5.5 + rng() * 3.5) * scale;
    const w = B('palmtrunk', () => T.metalTex('#9a8560'));
    // trunk in segments so it can lean
    const lean = rand(rng, -0.35, 0.35), leanZ = rand(rng, -0.3, 0.3);
    const seg = 7;
    for (let i = 0; i < seg; i++) {
      const t = i / seg, tt = t * t;
      const sx = x + lean * tt * 2.2, sz = z + leanZ * tt * 2.2;
      w.box(sx, 0.16 + h * (t + 0.5 / seg), sz, 0.46 - t * 0.16, h / seg + 0.05, 0.46 - t * 0.16,
        { uv: 1.2, tint: [0.86, 0.74, 0.55], ry: i * 0.4 });
    }
    const tx = x + lean * 2.2, tz = z + leanZ * 2.2, ty = 0.16 + h;
    const fr = B('frond', T.frondTex, { alphaMode: 1, twoSided: true });
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng() * 0.3;
      const len = (2.6 + rng() * 1.4) * scale, wid = 1.5 * scale;
      const droop = 0.8 + rng() * 0.7;
      const cx1 = Math.cos(a), cz1 = Math.sin(a);
      // frond quad: from the crown outward and drooping down
      const p0 = [tx, ty + 0.2, tz];
      const p1 = [tx + cx1 * len, ty + 0.2 - droop, tz + cz1 * len];
      const half = [-cz1 * wid / 2, 0, cx1 * wid / 2];
      fr.quad(
        [p0[0] + half[0], p0[1], p0[2] + half[2]],
        [p1[0] + half[0], p1[1], p1[2] + half[2]],
        [p1[0] - half[0], p1[1], p1[2] - half[2]],
        [p0[0] - half[0], p0[1], p0[2] - half[2]],
        [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], [1, 1, 1]);
    }
    // coconuts
    w.box(tx, ty + 0.05, tz, 0.55, 0.4, 0.55, { uv: 1, tint: [0.7, 0.6, 0.4] });
    addBox(x - 0.35, z - 0.35, x + 0.35, z + 0.35, 3);
  }

  function cactus(x, z, scale) {
    const c = B('cactus', T.cactusTex);
    const h = (3.2 + rng() * 2.4) * scale;
    const tint = [0.9, 1.05, 0.85];
    c.cylinder(x, 0.16, z, 0.34 * scale, h, 9, tint, 2);
    const arms = randI(rng, 0, 2);
    for (let i = 0; i < arms; i++) {
      const side = i === 0 ? 1 : -1;
      const ay = 0.16 + h * rand(rng, 0.35, 0.6);
      const reach = 0.75 * scale;
      c.box(x + side * reach * 0.55, ay, z, reach * 1.3, 0.44 * scale, 0.44 * scale, { uv: 2, tint });
      c.cylinder(x + side * reach, ay, z, 0.24 * scale, h * rand(rng, 0.3, 0.5), 8, tint, 2);
    }
    addBox(x - 0.4, z - 0.4, x + 0.4, z + 0.4, h);
  }

  function scrubBush(x, z, scale) {
    const b = B('scrub', T.scrubTex, { alphaMode: 1, twoSided: true });
    const r = 1.5 * scale;
    b.panel(x, 0.16 + r / 2, z, r * 1.6, r, 0);
    b.panel(x, 0.16 + r / 2, z, r * 1.6, r, 0, null, true);
    b.panel(x, 0.16 + r / 2, z, r * 1.6, r, Math.PI / 2);
    b.panel(x, 0.16 + r / 2, z, r * 1.6, r, Math.PI / 2, null, true);
  }

  function scrubPatch(lot) {
    for (let i = 0; i < 5; i++) {
      if (rng() < 0.45) continue;
      scrubBush(rand(rng, lot.x0 + 1, lot.x1 - 1), rand(rng, lot.z0 + 1, lot.z1 - 1), 0.7 + rng() * 0.6);
    }
  }

  // Power lines strung along the highway, and the mesas past the town line.
  function powerPole(x, z, ry) {
    const w = B('wood', T.woodTex);
    w.box(x, 4.4, z, 0.32, 8.6, 0.32, { uv: 3, tint: [0.72, 0.6, 0.46], ry });
    w.box(x, 8.0, z, 3.4, 0.22, 0.22, { uv: 2, tint: [0.72, 0.6, 0.46], ry });
    w.box(x, 7.3, z, 2.6, 0.18, 0.18, { uv: 2, tint: [0.72, 0.6, 0.46], ry });
    addBox(x - 0.3, z - 0.3, x + 0.3, z + 0.3, 8);
  }

  function wire(x0, z0, x1, z1, y, sag) {
    const w = B('wire', () => T.metalTex('#2a2a2c'));
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps, t1 = (i + 1) / steps;
      const ax = x0 + (x1 - x0) * t0, az = z0 + (z1 - z0) * t0;
      const bx = x0 + (x1 - x0) * t1, bz = z0 + (z1 - z0) * t1;
      const ay = y - Math.sin(t0 * Math.PI) * sag, by = y - Math.sin(t1 * Math.PI) * sag;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2, my = (ay + by) / 2;
      const len = Math.hypot(bx - ax, bz - az, by - ay);
      const ry = Math.atan2(bx - ax, bz - az);
      w.box(mx, my, mz, 0.06, 0.06, len, { uv: 2, tint: [0.25, 0.25, 0.28], ry });
    }
  }

  function mesas() {
    const rock = B('rock', T.rockTex);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rng() * 0.2;
      const dist = rand(rng, 420, 720);
      const cx = TOWN / 2 + Math.cos(a) * dist;
      const cz = TOWN / 2 + Math.sin(a) * dist;
      const w = rand(rng, 90, 260), h = rand(rng, 40, 130), d = rand(rng, 80, 220);
      rock.box(cx, h / 2, cz, w, h, d, { uv: 26, tint: [1, 0.96, 0.9], gradient: 0.25, faces: FACES_NO_BOTTOM, ry: rng() * 0.7 });
      // a smaller shoulder next to it
      rock.box(cx + rand(rng, -w, w), h * 0.32, cz + rand(rng, -d, d), w * 0.6, h * 0.64, d * 0.6,
        { uv: 26, tint: [0.95, 0.9, 0.84], gradient: 0.25, faces: FACES_NO_BOTTOM, ry: rng() * 0.7 });
    }
    // the flat desert floor the town sits on
    B('sand', T.sandTex).ground(-900, -900, TOWN + 900, TOWN + 900, -0.05, 24, [1, 1, 1]);
  }

  function welcomeSign() {
    const x = roadAt(2), z = -ROAD / 2 - 12;
    const w = B('wood', T.woodTex);
    w.box(x - 5, 3, z, 0.4, 6, 0.4, { uv: 2, tint: [0.7, 0.58, 0.44] });
    w.box(x + 5, 3, z, 0.4, 6, 0.4, { uv: 2, tint: [0.7, 0.58, 0.44] });
    const sg = B('sign:welcome', () => T.sign('PARADISE', '#2a1c14', '#ffcf6a', 'POPULATION: DROPPING'),
      { texOpts: { wrap: false } });
    sg.panel(x, 4.6, z, 11, 2.75, 0);
    sg.panel(x, 4.6, z, 11, 2.75, 0, null, true);
    addBox(x - 5.4, z - 0.4, x + 5.4, z + 0.4, 6);
  }

  // -------------------------------------------------------------- nav graph --
  // Nodes sit on the pavement ring around each block, not down the middle of
  // the road -- otherwise the whole town wanders into traffic and gets run over.
  const nav = [];
  const ringOf = new Map();
  const INSET = 1.7;
  for (let gz = 0; gz < GRIDN; gz++) {
    for (let gx = 0; gx < GRIDN; gx++) {
      const x0 = roadAt(gx) + ROAD / 2 + INSET, x1 = roadAt(gx + 1) - ROAD / 2 - INSET;
      const z0 = roadAt(gz) + ROAD / 2 + INSET, z1 = roadAt(gz + 1) - ROAD / 2 - INSET;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      // eight nodes clockwise round the pavement, midpoints flagged by side
      const ring = [
        { x: x0, z: z0 }, { x: mx, z: z0, side: 'n' }, { x: x1, z: z0 },
        { x: x1, z: mz, side: 'e' }, { x: x1, z: z1 }, { x: mx, z: z1, side: 's' },
        { x: x0, z: z1 }, { x: x0, z: mz, side: 'w' },
      ].map(n => ({ ...n, links: [] }));
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        a.links.push(b); b.links.push(a);
        nav.push(a);
      }
      ringOf.set(gx + ',' + gz, ring);
    }
  }
  // street crossings: join facing kerb midpoints of neighbouring blocks
  const sideNode = (gx, gz, side) => {
    const r = ringOf.get(gx + ',' + gz);
    return r && r.find(n => n.side === side);
  };
  for (let gz = 0; gz < GRIDN; gz++) {
    for (let gx = 0; gx < GRIDN; gx++) {
      const east = sideNode(gx, gz, 'e'), eastNb = sideNode(gx + 1, gz, 'w');
      if (east && eastNb) { east.links.push(eastNb); eastNb.links.push(east); }
      const south = sideNode(gx, gz, 's'), southNb = sideNode(gx, gz + 1, 'n');
      if (south && southNb) { south.links.push(southNb); southNb.links.push(south); }
    }
  }

  // ---------------------------------------------------------------- finish --
  const batches = [];
  for (const [k, b] of builders) {
    const mesh = b.build(renderer.gl);
    if (!mesh.count) continue;
    const o = meta.get(k) || {};
    batches.push({ key: k, mesh, tex: texes.get(k), alphaMode: o.alphaMode || 0, unlit: !!o.unlit, blend: !!o.blend, twoSided: !!o.twoSided });
  }
  // opaque first, blended last
  batches.sort((a, b) => (a.blend ? 1 : 0) - (b.blend ? 1 : 0));

  // spatial hash for collision queries
  const CELL = 8;
  const hash = new Map();
  const hkey = (cx, cz) => cx + ',' + cz;
  colliders.forEach((c, idx) => {
    for (let cx = Math.floor(c.x0 / CELL); cx <= Math.floor(c.x1 / CELL); cx++)
      for (let cz = Math.floor(c.z0 / CELL); cz <= Math.floor(c.z1 / CELL); cz++) {
        const k = hkey(cx, cz);
        if (!hash.has(k)) hash.set(k, []);
        hash.get(k).push(idx);
      }
  });

  return {
    batches, colliders, shops, nav, carSpots,
    bounds: { min: -ROAD / 2 - 1, max: TOWN + ROAD / 2 + 1 },
    shopByKey: k => shops.find(s => s.key === k),

    // Push a circle out of every box it overlaps. Returns true if it moved.
    resolve(p, radius, height = 1.8) {
      let hit = false;
      const cx0 = Math.floor((p.x - radius) / CELL), cx1 = Math.floor((p.x + radius) / CELL);
      const cz0 = Math.floor((p.z - radius) / CELL), cz1 = Math.floor((p.z + radius) / CELL);
      for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
        const list = hash.get(hkey(cx, cz));
        if (!list) continue;
        for (const idx of list) {
          const c = colliders[idx];
          if (c.top < 0.35) continue;                     // low kerbs: step over
          const nx = Math.max(c.x0, Math.min(p.x, c.x1));
          const nz = Math.max(c.z0, Math.min(p.z, c.z1));
          const dx = p.x - nx, dz = p.z - nz;
          const d2 = dx * dx + dz * dz;
          if (d2 > radius * radius) continue;
          hit = true;
          if (d2 > 1e-6) {
            const d = Math.sqrt(d2), push = radius - d;
            p.x += (dx / d) * push; p.z += (dz / d) * push;
          } else {
            // centre inside the box: shove out the nearest face
            const l = p.x - c.x0, r = c.x1 - p.x, u = p.z - c.z0, dn = c.z1 - p.z;
            const m = Math.min(l, r, u, dn);
            if (m === l) p.x = c.x0 - radius; else if (m === r) p.x = c.x1 + radius;
            else if (m === u) p.z = c.z0 - radius; else p.z = c.z1 + radius;
          }
        }
      }
      return hit;
    },

    // Ray vs. world boxes, for bullets. Returns distance or Infinity.
    rayHit(ox, oy, oz, dx, dy, dz, maxD) {
      let best = maxD;
      for (const c of colliders) {
        if (c.top < 0.4) continue;
        const t = raySlab(ox, oy, oz, dx, dy, dz, c.x0, 0, c.z0, c.x1, c.top, c.z1, best);
        if (t !== null && t < best) best = t;
      }
      return best;
    },
  };
}

function raySlab(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1, maxT) {
  let tmin = 0, tmax = maxT;
  const axes = [[ox, dx, x0, x1], [oy, dy, y0, y1], [oz, dz, z0, z1]];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-8) { if (o < lo || o > hi) return null; continue; }
    let t1 = (lo - o) / d, t2 = (hi - o) / d;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin;
}

function signColor(key) {
  return {
    home: '#8de08d', bank: '#7fe3ff', grocery: '#ffd24a', library: '#c9b6ff',
    gunshop: '#ff9f5a', church: '#ffe9a8', postoffice: '#7fb6ff', police: '#9ecbff',
    clinic: '#8dffd0', mall: '#ff9ede', bar: '#ffcf5a', hardware: '#ffb86b',
  }[key] || '#ffd24a';
}
