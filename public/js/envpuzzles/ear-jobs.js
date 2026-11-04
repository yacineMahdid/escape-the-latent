// Ear Jobs (Attendale / Attention Is All You Need, challenge e1): the finale, played in the village itself.
// The Sentence 'the bunny gave the frog a pie .' stands as eight paper word posts on the main path right
// of the bridge. Ring a post (E): four coloured strings zip from that word to wherever each of the Bell's
// four ears listens. Every ear always does one job (pink: one word back, sky: who gave the pie, gold: the
// full stop, teal: little words find their thing, and it fans out evenly from any other word). Nobody
// tells the player the jobs: they ring a few posts, read the strings and tag the four ears on Dabble's
// FAIR PROGRAM board down on the bank. All four right: every ear fires from every post at once, solved.
// Otherwise Dabble only says how many tags are wrong.
// The paper (Section 4, last paragraph; Figures 3-5): attention distributions can be inspected, and
// individual heads clearly learn different jobs (positional, syntactic, staring at the end of the
// sentence). The figures draw one word's attention with one colour per head, as the strings do here.
// Spec: content/extra-draft/attention.json, challenge e1 (positions, weights, string rules, board flow).
// Test hooks: each post's interactable has it.postIndex = i (two posts are both 'the'); the board's has
// it.boardOf = 'e1'. The root group is named 'ear-jobs'; its userData holds { query, chosen, weights }.
const INK = '#2b2233';
const CREAM = '#fffdf6';
const FONT = 'Fredoka, "Arial Rounded MT Bold", "Trebuchet MS", Verdana, sans-serif';
const fill = (tpl, vars) => String(tpl ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
const easeBack = (u) => { const c = 1.9; const v = Math.min(1, Math.max(0, u)) - 1; return 1 + (c + 1) * v * v * v + c * v * v; };
const easeOut = (u) => 1 - (1 - Math.min(1, Math.max(0, u))) ** 3;

// Layout (spec.posts.where, spec.board.where), in world units.
const POST = { x0: 22.8, dx: 2.1, y: 0, z: 1.0, r: 0.3 };  // the row ends at 37.5: on screen even when the camera stops at x 30
const CARD = { w: 0.95, h: 0.5, y: 1.35 };
const TOP = CARD.y + CARD.h / 2;            // card tops: where the strings start and land
const SLOT = [-0.37, -0.17, 0.17, 0.37];    // each ear's spot along a card's top edge (the bell sits in the middle)
const LIFT = 0.13;                          // each ear's arcs ride a little higher than the one before
// The board stands at the bank's back edge right of Dabble, where no tall foreground grass hides it.
const BOARD = { x: 16.9, y: -0.95, z: 7.2, w: 2.0, h: 1.6, faceY: 1.75, head: 0.32 };
const PX = 400;                             // canvas pixels per world unit on the board
const PEAK = 0.85;                          // spec.attention: the weight an ear puts on the word it looks for
const LITTLE = /^(the|a|an)$/i;

const DEFAULT_EARS = [
  { id: 'pink', color: '#ff7ab8', name: 'Pink ear', job: 'back' },
  { id: 'sky', color: '#8fd3ff', name: 'Sky ear', job: 'giver' },
  { id: 'gold', color: '#ffd35a', name: 'Gold ear', job: 'stop' },
  { id: 'teal', color: '#3ec7b5', name: 'Teal ear', job: 'little' },
];

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}
// the biggest bold font size <= max that fits text into width
function fitFont(g, text, width, max, min = 10) {
  let s = max;
  for (; s > min; s -= 2) { g.font = `700 ${s}px ${FONT}`; if (g.measureText(text).width <= width) break; }
  g.font = `700 ${s}px ${FONT}`;
  return s;
}

// A word card's face: cream cut paper with the word in ink (the full stop drawn as a fat dot).
function drawCard(word) {
  return (g, W, H) => {
    g.clearRect(0, 0, W, H);
    g.fillStyle = CREAM; roundRect(g, 3, 3, W - 6, H - 6, 18); g.fill();
    g.fillStyle = 'rgba(160,140,110,.10)'; for (let i = 0; i < 70; i++) g.fillRect((i * 53) % W, (i * 37) % H, 2, 2);
    g.fillStyle = INK; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (word === '.') { g.beginPath(); g.arc(W / 2, H * 0.6, 19, 0, Math.PI * 2); g.fill(); return; }
    fitFont(g, word, W - 40, 74);
    g.fillText(word, W / 2, H * 0.6);
  };
}
// The board's face: the header and four printed program lines (rows: y px; dots: [x0, x1] px).
function drawBoard(head, rows, dots) {
  return (g, W, H) => {
    g.clearRect(0, 0, W, H);
    g.fillStyle = CREAM; roundRect(g, 4, 4, W - 8, H - 8, 30); g.fill();
    g.fillStyle = 'rgba(160,140,110,.10)'; for (let i = 0; i < 200; i++) g.fillRect((i * 97) % W, (i * 61) % H, 2, 2);
    g.fillStyle = INK; g.textAlign = 'center'; g.textBaseline = 'middle';
    fitFont(g, 'FAIR PROGRAM', W - 90, Math.round(head * 0.56));
    g.fillText('FAIR PROGRAM', W / 2, head * 0.45);
    // a pink paper swash under the header
    const x0 = W * 0.2, x1 = W * 0.8, sy = head * 0.84;
    g.strokeStyle = '#ff7ab8'; g.lineWidth = 8; g.lineCap = 'round'; g.beginPath();
    for (let x = x0; x <= x1; x += 6) { const y = sy + Math.sin((x - x0) / 24) * 4; x === x0 ? g.moveTo(x, y) : g.lineTo(x, y); }
    g.stroke();
    // dotted program lines from each ear to its tag
    g.fillStyle = 'rgba(43,34,51,.3)';
    for (const y of rows) for (let x = dots[0]; x <= dots[1]; x += 15) { g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill(); }
  };
}
// A paper luggage tag: blank (a faint writing line) or with the chosen job.
function drawTag(color, text) {
  return (g, W, H) => {
    g.clearRect(0, 0, W, H);
    g.beginPath(); g.moveTo(34, 5); g.lineTo(W - 12, 5); g.quadraticCurveTo(W - 5, 5, W - 5, 12); g.lineTo(W - 5, H - 12);
    g.quadraticCurveTo(W - 5, H - 5, W - 12, H - 5); g.lineTo(34, H - 5); g.lineTo(6, H / 2); g.closePath();
    g.fillStyle = '#fffaf0'; g.fill();
    g.lineWidth = 5; g.lineJoin = 'round'; g.strokeStyle = INK; g.stroke();
    g.fillStyle = color; g.fillRect(40, 9, 16, H - 18);
    g.fillStyle = INK; g.beginPath(); g.arc(24, H / 2, 6, 0, Math.PI * 2); g.fill();
    if (!text) {
      g.strokeStyle = 'rgba(43,34,51,.22)'; g.lineWidth = 4; g.setLineDash([14, 12]);
      g.beginPath(); g.moveTo(84, H * 0.68); g.lineTo(W - 40, H * 0.68); g.stroke(); g.setLineDash([]);
      return;
    }
    g.fillStyle = INK; g.textAlign = 'left'; g.textBaseline = 'middle';
    const room = W - 100, one = fitFont(g, text, room, Math.round(H * 0.56), 20);
    const ws = text.split(' ');
    if (one >= H * 0.42 || ws.length < 2) { g.fillText(text, 74, H / 2 + 2); return; }
    let best = null; // the most even split into two lines
    for (let k = 1; k < ws.length; k++) { const a = ws.slice(0, k).join(' '), b = ws.slice(k).join(' '); const m = Math.max(a.length, b.length); if (!best || m < best.m) best = { a, b, m }; }
    const s1 = Math.min(fitFont(g, best.a, room, Math.round(H * 0.4), 20), fitFont(g, best.b, room, Math.round(H * 0.4), 20));
    g.font = `700 ${s1}px ${FONT}`;
    g.fillText(best.a, 74, H * 0.3 + 2); g.fillText(best.b, 74, H * 0.7 + 2);
  };
}

export default {
  mount(w, spec, api) {
    const { THREE } = w;
    const words = spec.sentence?.length ? spec.sentence : ['the', 'bunny', 'gave', 'the', 'frog', 'a', 'pie', '.'];
    const ears = spec.ears?.length ? spec.ears : DEFAULT_EARS;
    const tags = spec.tags?.length ? spec.tags : [];
    const solution = spec.solution || Object.fromEntries(ears.map((e) => [e.id, e.job]));
    const giver = spec.speaker || 'dabble';
    const n = words.length;
    const GIVER = Math.max(0, words.indexOf('bunny'));                     // who gave the pie
    const STOP = words.includes('.') ? words.lastIndexOf('.') : n - 1;     // the full stop
    let destroyed = false, solved = false, query = -1, boardBusy = false, gen = 0; // gen: which ring's strings are current
    const chosen = ears.map(() => null); // tag id per ear

    // When word i is rung, ear `job` spreads one whole look over the n words (spec.attention).
    function weights(job, i) {
      let t = null;
      if (job === 'back') t = Math.max(0, i - 1);
      else if (job === 'giver') t = GIVER;
      else if (job === 'stop') t = STOP;
      else if (job === 'little') t = LITTLE.test(words[i]) ? Math.min(n - 1, i + 1) : null;
      if (t === null) return words.map(() => 1 / n); // nothing to find: an even fan ("teal shrugs")
      return words.map((_, j) => (j === t ? PEAK : (1 - PEAK) / (n - 1)));
    }

    const root = new THREE.Group(); root.name = 'ear-jobs';
    w.scene.add(root);
    const tweens = new Set();   // { t, dur, fn(u) }
    const loops = new Set();    // fn(dt, t)
    const textures = [];        // canvas textures ({ tex, paint }): redrawn once the web font arrives
    const interactables = [], colliders = [];

    // ---------- small builders (chunky toy style: MeshStandardMaterial, roughness ~0.8) ----------
    const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0, ...o });
    const mesh = (geo, mat, x, y, z, par) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); par.add(m); return m; };
    const group = (par, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); par.add(g); return g; };
    const canvasTex = (wpx, hpx, draw) => {
      const c = document.createElement('canvas'); c.width = wpx; c.height = hpx;
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const rec = { tex, c, draw };
      rec.paint = (d = rec.draw) => { rec.draw = d; d(c.getContext('2d'), wpx, hpx); tex.needsUpdate = true; };
      rec.paint(); textures.push(rec); return rec;
    };
    // A rounded plate w x h, d thick, centred (exact size; a small bevel).
    const plate = (pw, ph, d, rad, bev = 0.008) => {
      const s = new THREE.Shape(), x = -pw / 2 + bev, y = -ph / 2 + bev, W = pw - 2 * bev, H = ph - 2 * bev;
      const q = Math.min(rad, W / 2 - 0.0005, H / 2 - 0.0005);
      s.moveTo(x + q, y); s.lineTo(x + W - q, y); s.absarc(x + W - q, y + q, q, -Math.PI / 2, 0);
      s.lineTo(x + W, y + H - q); s.absarc(x + W - q, y + H - q, q, 0, Math.PI / 2);
      s.lineTo(x + q, y + H); s.absarc(x + q, y + H - q, q, Math.PI / 2, Math.PI);
      s.lineTo(x, y + q); s.absarc(x + q, y + q, q, Math.PI, Math.PI * 1.5);
      const dep = Math.max(0.0005, d - 2 * bev);
      const geo = new THREE.ExtrudeGeometry(s, { depth: dep, bevelEnabled: true, bevelSize: bev, bevelThickness: bev, bevelSegments: 2, curveSegments: 8 });
      geo.translate(0, 0, -dep / 2); return geo;
    };
    const tween = (dur, fn, delay = 0) => { const tw = { t: -delay, dur, fn }; tweens.add(tw); return tw; };
    // waits `sec` of game time (the animations' clock); destroy() releases every pending wait
    const pending = new Set();
    const gameWait = (sec) => new Promise((resolve) => { pending.add(resolve); tween(sec, (u) => { if (u >= 1) { pending.delete(resolve); resolve(); } }); });
    const unsub = w.onUpdate((dt, t) => {
      for (const tw of [...tweens]) { tw.t += dt; if (tw.t < 0) continue; const u = Math.min(1, tw.t / tw.dur); tw.fn(u); if (u >= 1) tweens.delete(tw); }
      for (const fn of loops) fn(dt, t);
    });

    // shared parts
    const wood = M(0x9a6a40), woodDark = M(0x7a5236), inkM = M(0x2b2233, { roughness: 0.7 });
    const brass = M(0xffd35a, { roughness: 0.38, metalness: 0.25, side: THREE.DoubleSide });
    const earCol = ears.map((e) => new THREE.Color(e.color));
    const thickM = earCol.map((c) => M(c, { roughness: 0.6, emissive: c, emissiveIntensity: 0.2 }));
    const thinM = earCol.map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.6, depthWrite: false }));
    const dotM = earCol.map((c) => M(c, { roughness: 0.5, emissive: c, emissiveIntensity: 0.15 }));
    const dotGeo = new THREE.SphereGeometry(0.052, 12, 8);
    const bellGeo = new THREE.LatheGeometry([[0, 0.205], [0.03, 0.2], [0.05, 0.18], [0.058, 0.13], [0.066, 0.07], [0.085, 0.022], [0.092, 0], [0.078, 0.008]].map(([r, y]) => new THREE.Vector2(r, y)), 18);

    // ---------- the eight word posts (spec.posts) ----------
    const overlaps = (x, z, r) => w.world.colliders.some((c) => !c.disabled && (c.type === 'circle'
      ? Math.hypot(x - c.x, z - c.z) < c.r + r + 0.05
      : x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r));
    const posts = words.map((word, i) => {
      let x = POST.x0 + POST.dx * i;
      // nudge sideways off anything already standing there (checked once, at start)
      for (const d of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9]) { if (!overlaps(x + d, POST.z, POST.r)) { x += d; break; } }
      const g = group(root, x, POST.y, POST.z);
      mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.08, 16), woodDark, 0, 0.04, 0, g);
      mesh(new THREE.CylinderGeometry(0.038, 0.045, TOP + 0.02, 8), wood, 0, (TOP + 0.02) / 2, -0.06, g);
      const card = group(g, 0, CARD.y, 0);
      mesh(plate(CARD.w + 0.06, CARD.h + 0.06, 0.04, 0.07), inkM, 0, 0, 0, card);
      const face = canvasTex(256, 136, drawCard(word));
      mesh(new THREE.PlaneGeometry(CARD.w, CARD.h), M(0xffffff, { map: face.tex, roughness: 0.9, alphaTest: 0.5 }), 0, 0, 0.021, card);
      // the tiny brass hand-bell on top, pivoting at its rim
      const bell = group(g, 0, TOP, -0.02);
      mesh(bellGeo, brass, 0, 0.004, 0, bell);
      mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.09, 8), wood, 0, 0.245, 0, bell);
      mesh(new THREE.SphereGeometry(0.034, 10, 8), wood, 0, 0.3, 0, bell);
      mesh(new THREE.SphereGeometry(0.026, 8, 6), brass, 0.0, 0.02, 0, bell);
      // where each ear listens most, a dot on the card (hidden until a ring)
      const dots = ears.map((_, k) => { const d = mesh(dotGeo, dotM[k], SLOT[k], CARD.h / 2 - 0.075, 0.03, card); d.scale.set(1, 1, 0.55); d.visible = false; return d; });
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      colliders.push(w.addCollider({ type: 'circle', x, z: POST.z, r: POST.r }));
      const it = w.addInteractable({
        label: word === '.' ? 'Ring the full stop' : `Ring '${word}'`, icon: '🔔', postIndex: i,
        pos: { x, y: POST.y, z: POST.z }, radius: 1.3, promptHeight: 2.2,
        onInteract: () => ring(i),
      });
      interactables.push(it);
      g.scale.setScalar(0.001);
      tween(0.45, (u) => g.scale.setScalar(Math.max(0.001, easeBack(u))), 0.2 + i * 0.09);
      return { i, word, x, g, bell, dots, wig: null, wigDelay: 0 };
    });
    loops.add((dt) => {
      for (const p of posts) {
        if (p.wig === null) continue;
        p.wig += dt;
        const t = p.wig - p.wigDelay;
        if (t < 0) continue;
        p.bell.rotation.z = Math.sin(t * 30) * 0.5 * Math.exp(-t * 4.5);
        if (t > 1.1) { p.wig = null; p.bell.rotation.z = 0; }
      }
    });

    // ---------- strings (spec.strings): one arc per ear and listened-to word ----------
    function arc(i, j, k) {
      const a = posts[i], b = posts[j], y0 = TOP + 0.01, z0 = POST.z, zo = (k - 1.5) * 0.18, lift = LIFT * k;
      const A = new THREE.Vector3(a.x + SLOT[k], y0, z0);
      if (i === j) { // a small loop above the post
        const h = 1.0 + lift;
        return new THREE.CubicBezierCurve3(A, new THREE.Vector3(A.x - 0.7, y0 + h, z0 + 2 * zo), new THREE.Vector3(A.x + 0.7, y0 + h, z0 + 2 * zo), A.clone());
      }
      const B = new THREE.Vector3(b.x + SLOT[k], y0, z0);
      const apex = 0.8 + 0.35 * Math.abs(i - j) + lift;
      return new THREE.QuadraticBezierCurve3(A, new THREE.Vector3((A.x + B.x) / 2, y0 + 2 * apex, z0 + 2 * zo), B);
    }
    // Draws ear k's strings from word i into par; they zip out over `zip` seconds after `delay`.
    function fire(par, i, k, { zip = 0.3, delay = 0, dots = true } = {}) {
      const wts = weights(ears[k].job, i), mine = gen;
      wts.forEach((wt, j) => {
        if (wt < 0.1) return;
        const thick = wt >= 0.5;
        const segs = thick ? 40 : 30, radial = thick ? 8 : 5;
        const geo = new THREE.TubeGeometry(arc(i, j, k), segs, thick ? 0.06 : 0.024, radial, false);
        const m = mesh(geo, thick ? thickM[k] : thinM[k], 0, 0, 0, par);
        m.renderOrder = thick ? 0 : 2;
        const total = geo.index.count;
        geo.setDrawRange(0, 0);
        tween(zip, (u) => { if (mine === gen) geo.setDrawRange(0, u >= 1 ? total : Math.ceil(easeOut(u) * segs) * radial * 6); }, delay);
        if (thick && dots) {
          const d = posts[j].dots[k];
          tween(0.18, (u) => { if (mine !== gen) return; const s = Math.max(0.001, easeBack(u)); d.visible = true; d.scale.set(s, s, 0.55 * s); }, delay + zip);
        }
      });
    }
    let strings = null;
    const clearStrings = () => {
      gen += 1;
      if (strings) { root.remove(strings); strings.traverse((o) => o.geometry?.dispose()); strings = null; }
      for (const p of posts) for (const d of p.dots) d.visible = false;
    };

    // ---------- the ring ripple ----------
    const ripple = mesh(new THREE.TorusGeometry(0.16, 0.014, 6, 28), new THREE.MeshBasicMaterial({ color: 0xffe79a, transparent: true, opacity: 0, depthWrite: false }), 0, 0, 0, root);
    ripple.rotation.x = Math.PI / 2; ripple.visible = false;

    function ring(i) {
      if (destroyed || solved) return;
      const p = posts[i];
      query = i;
      w.sfx('ding');
      p.wig = 0; p.wigDelay = 0;
      ripple.position.set(p.x, TOP + 0.1, POST.z - 0.02);
      ripple.visible = true;
      tween(0.55, (u) => { ripple.scale.setScalar(1 + u * 3.2); ripple.material.opacity = 0.85 * (1 - u); if (u >= 1) ripple.visible = false; });
      tween(0.25, (u) => { const k = Math.sin(u * Math.PI); p.g.scale.set(1 + 0.05 * k, 1 - 0.04 * k, 1 + 0.05 * k); });
      clearStrings();
      strings = group(root);
      ears.forEach((_, k) => fire(strings, i, k));
    }

    // ---------- Dabble's FAIR PROGRAM board (spec.board) ----------
    const B = group(root, BOARD.x, BOARD.y, BOARD.z);
    const legX = BOARD.w / 2 - 0.12, legH = BOARD.faceY + BOARD.h / 2 - 0.1;
    for (const s of [-1, 1]) {
      mesh(new THREE.CylinderGeometry(0.06, 0.075, legH, 8), wood, s * legX, legH / 2, -0.07, B).rotation.z = -s * 0.025;
      mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.07, 12), woodDark, s * legX, 0.035, -0.07, B);
    }
    const panel = group(B, 0, BOARD.faceY, 0); panel.rotation.x = -0.06;
    mesh(plate(BOARD.w + 0.08, BOARD.h + 0.08, 0.06, 0.12), inkM, 0, 0, 0, panel);
    // the header, then four program rows; positions in panel units (origin at the centre)
    const rowH = (BOARD.h - BOARD.head - 0.06) / ears.length;
    const rowY = ears.map((_, k) => BOARD.h / 2 - BOARD.head - rowH * (k + 0.5));
    const hornX = -BOARD.w / 2 + 0.31, tagX0 = -BOARD.w / 2 + 0.5, tagW = BOARD.w / 2 - 0.05 - tagX0, tagH = rowH - 0.05;
    const toPx = (x, y) => [(x + BOARD.w / 2) * PX, (BOARD.h / 2 - y) * PX];
    const faceTex = canvasTex(BOARD.w * PX, BOARD.h * PX, drawBoard(BOARD.head * PX, rowY.map((y) => toPx(0, y)[1]), [toPx(hornX + 0.05, 0)[0], toPx(tagX0 - 0.03, 0)[0]]));
    mesh(new THREE.PlaneGeometry(BOARD.w, BOARD.h), M(0xffffff, { map: faceTex.tex, roughness: 0.92, alphaTest: 0.5 }), 0, 0, 0.032, panel);
    // four paper ear-trumpets pinned down the left, each with its blank tag
    const hornGeo = new THREE.LatheGeometry([[0.026, 0], [0.028, 0.12], [0.038, 0.19], [0.058, 0.245], [0.092, 0.285], [0.108, 0.3], [0.099, 0.305]].map(([r, y]) => new THREE.Vector2(r, y)), 20);
    const rimGeo = new THREE.TorusGeometry(0.105, 0.013, 6, 24);
    const rows = ears.map((ear, k) => {
      const y = rowY[k];
      const horn = group(panel, hornX, y - 0.04, 0.09);
      horn.rotation.z = Math.PI / 2 - 0.42;
      mesh(hornGeo, M(earCol[k], { roughness: 0.75, side: THREE.DoubleSide }), 0, 0, 0, horn);
      mesh(rimGeo, inkM, 0, 0.302, 0, horn).rotation.x = Math.PI / 2;
      mesh(new THREE.SphereGeometry(0.038, 10, 8), brass, hornX, y - 0.04, 0.12, panel); // the pin holding it
      const tagRec = canvasTex(Math.round(tagW * PX), Math.round(tagH * PX), drawTag(ear.color, ''));
      const tagPiv = group(panel, tagX0 + tagW / 2, y, 0.045);
      mesh(new THREE.PlaneGeometry(tagW, tagH), M(0xffffff, { map: tagRec.tex, roughness: 0.9, alphaTest: 0.5, side: THREE.DoubleSide }), 0, 0, 0, tagPiv);
      return { horn, tagPiv, tagRec, ph: k * 1.7 };
    });
    B.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // a footprint as wide as the board at the bank's back edge: the lane in front stays open to Dabble and the pier
    colliders.push(w.addCollider({ type: 'rect', x0: BOARD.x - BOARD.w / 2 - 0.05, x1: BOARD.x + BOARD.w / 2 + 0.05, z0: BOARD.z - 0.2, z1: BOARD.z + 0.18 }));
    // the prompt sits on the board's right half, so standing at the board never picks Dabble next door
    const boardIt = w.addInteractable({
      label: 'Fair board', icon: '📋', boardOf: 'e1',
      pos: { x: BOARD.x + 0.4, y: BOARD.y, z: BOARD.z + 0.35 }, radius: 1.6, promptHeight: BOARD.faceY + BOARD.h / 2 + 0.5,
      onInteract: () => useBoard(),
    });
    interactables.push(boardIt);
    B.scale.setScalar(0.001);
    tween(0.5, (u) => B.scale.setScalar(Math.max(0.001, easeBack(u))), 0.1);

    const labelOf = (id) => tags.find((t) => t.id === id)?.label || '';
    function setTag(k, id) {
      chosen[k] = id;
      const r = rows[k];
      r.tagRec.paint(drawTag(ears[k].color, labelOf(id)));
      tween(0.3, (u) => { const s = Math.sin(u * Math.PI); r.tagPiv.rotation.z = s * 0.08; r.tagPiv.scale.setScalar(1 + 0.08 * s); });
    }
    function wobbleBoard() { tween(0.5, (u) => { panel.rotation.z = Math.sin(u * Math.PI * 5) * 0.035 * (1 - u); }); }

    async function useBoard() {
      if (destroyed || solved || boardBusy) return;
      boardBusy = true;
      try {
        const opts = [...tags.map((t) => t.label), 'Later'];
        const speaker = w.speakerOf(giver);
        for (let k = 0; k < ears.length; k++) {
          const pick = await w.ask(`${ears[k].name}'s job?`, opts, { speaker, neutral: true });
          if (destroyed || solved) return;
          if (!(pick >= 0 && pick < tags.length)) return; // Later (or Escape): what is set stays set
          setTag(k, tags[pick].id);
          w.sfx('pin');
        }
        const wrong = ears.filter((e, k) => chosen[k] !== solution[e.id]).length;
        if (wrong === 0) { await win(); return; }
        w.sfx('buzz'); wobbleBoard();
        const fb = spec.feedback || {};
        const lines = (wrong === 1 ? fb.wrongOne : fb.wrongMany) || ['Quack. {n} wrong.'];
        await w.speak(giver, lines.map((l) => fill(l, { n: wrong })));
      } finally { boardBusy = false; }
    }

    // All four right: every ear fires from every post at once, the tags flutter off up the hill.
    async function win() {
      solved = true;
      clearStrings();
      strings = group(root);
      posts.forEach((p, i) => { p.wig = 0; p.wigDelay = 0.06 * i; ears.forEach((_, k) => fire(strings, i, k, { zip: 0.3, delay: 0.06 * i, dots: false })); });
      w.sfx('win');
      gameWait(0.3).then(() => { if (!destroyed) w.sfx('ding'); });
      w.confetti(80);
      rows.forEach((r, k) => {
        tween(0.5, (u) => { r.horn.rotation.x = Math.sin(u * Math.PI * 4) * 0.4 * (1 - u); }, k * 0.08);
        const x0 = r.tagPiv.position.x, y0 = r.tagPiv.position.y;
        tween(0.85, (u) => {
          const e = easeOut(u);
          r.tagPiv.position.set(x0 - 1.4 * e, y0 + 2.2 * e + Math.sin(u * 9 + r.ph) * 0.08, 0.045 + 0.6 * e);
          r.tagPiv.rotation.z = Math.sin(u * 11 + r.ph) * 0.35;
          r.tagPiv.scale.setScalar(Math.max(0.001, 1 - 0.75 * e));
        }, 0.15 + k * 0.07);
      });
      await gameWait(1.2);
      if (destroyed) return;
      api.onSolved();
    }

    root.userData = { get query() { return query; }, chosen, weights, words };

    // text made before the Fredoka web font arrives is drawn again once it is there
    try {
      if (document.fonts && !document.fonts.check(`700 32px ${FONT}`)) {
        document.fonts.load(`700 32px Fredoka`).then(() => { if (!destroyed) for (const t of textures) t.paint(); }).catch(() => {});
      }
    } catch { /* no font loading API */ }

    return {
      destroy() {
        if (destroyed) return;
        destroyed = true;
        unsub?.();
        tweens.clear(); loops.clear();
        for (const resolve of pending) resolve(); // a burst cut short must not hold the scene busy
        pending.clear();
        for (const it of interactables) w.removeInteractable(it);
        for (const c of colliders) w.removeCollider(c);
        w.scene.remove(root);
        const geos = new Set([dotGeo, bellGeo, hornGeo, rimGeo]), mats = new Set([...thickM, ...thinM, ...dotM]), texs = new Set(textures.map((t) => t.tex));
        root.traverse((o) => {
          if (o.geometry) geos.add(o.geometry);
          for (const m of [o.material].flat()) if (m) { mats.add(m); if (m.map) texs.add(m.map); }
        });
        for (const x of [...geos, ...mats, ...texs]) { try { x.dispose?.(); } catch { /* already gone */ } }
      },
    };
  },
};
