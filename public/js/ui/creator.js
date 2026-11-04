// Character creator: the game's first screen. Almost no text: icons, swatches and tooltips.
//   open({ initial }) -> Promise<params>   character params (docs/ARCHITECTURE.md), plus `name` if one was typed
// Left: a photo zone (drop, click, paste or webcam) that asks Claude for a character (api.avatar),
// shown only when /api/status says the AI is on. Right: a live 3D turntable, swatches and icon chips,
// 🎲 random, ✓ done. The photo is downscaled in the browser and sent once; nothing is stored.
import * as THREE from 'three';
import { openModal, closeModal } from './modal.js';
import { api } from '../api.js';
import {
  buildHuman, normalizeCharacter, randomCharacter, disposeModel, DEFAULT_CHARACTER,
  HAIR_STYLES, GLASSES, FACIAL_HAIR, TOP_STYLES, ACCESSORIES,
  SKIN_TONES, HAIR_COLORS, EYE_COLORS, CLOTH_COLORS, SHOE_COLORS,
} from '../engine/humans.js';

const CSS_HREF = '/css/creator.css';
const MAX_SIDE = 768;
const JPEG_Q = 0.85;
const TIP = {
  photo: 'Photo → you (sent to Claude once, never saved)',
  offline: 'Photo → you needs Claude (no API key on this server)',
  cam: 'Webcam',
  snap: 'Snap',
  cancel: 'Cancel',
  dice: 'Random',
  ok: 'Done',
  name: 'Name (optional)',
  any: 'Any colour',
};

// ---------------------------------------------------------------------------------------------
// icons: small inline SVGs drawn in ink, coloured from CSS variables set on the card
//   --sk skin, --hc hair, --ec eyes, --tc top, --bc bottoms, --fc shoes, --ac accessory

const INK = '#2b2233';
const S = `stroke="${INK}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"`;
const svg = (body, vb = '0 0 32 32') => `<svg viewBox="${vb}" aria-hidden="true" focusable="false">${body}</svg>`;
const VB_FACE = '5 7.5 22 22', VB_HAIR = '1.5 1.5 29 29', VB_WIDE = '1 1 30 30';
const FACE = `<circle cx="16" cy="18" r="9" fill="var(--sk)" ${S}/><ellipse cx="12.6" cy="19" rx="1.25" ry="1.7" fill="${INK}"/><ellipse cx="19.4" cy="19" rx="1.25" ry="1.7" fill="${INK}"/>`;
const SMILE = `<path d="M14.2 22.8 Q16 24.4 17.8 22.8" fill="none" ${S}/>`;
const hair = (d, extra = '') => `<path d="${d}" fill="var(--hc)" ${S} ${extra}/>`;
const NONE = `<circle cx="16" cy="16" r="9" fill="none" ${S}/><path d="M9.6 22.4 L22.4 9.6" fill="none" ${S}/>`;
const STACHE = `<path d="M11 23.2 C12.5 21.2 15 21.6 16 22.9 C17 21.6 19.5 21.2 21 23.2 C19 25 17 24.2 16 23.8 C15 24.2 13 25 11 23.2 Z" fill="var(--hc)" ${S}/>`;
const TEE_BODY = 'M11 6 L5.5 8.5 L3 14 L7.5 16 L9.5 12.5 L9.5 27 L22.5 27 L22.5 12.5 L24.5 16 L29 14 L26.5 8.5 L21 6 C20 8.5 12 8.5 11 6 Z';
const LONG_BODY = 'M11 6.5 L6 9 L3.5 25 L8 25.5 L9.5 14 L9.5 27.5 L22.5 27.5 L22.5 14 L24 25.5 L28.5 25 L26 9 L21 6.5 C20 9 12 9 11 6.5 Z';
const DROP = (v) => `<path d="M16 4 C16 4 7 15 7 20 A9 9 0 0 0 25 20 C25 15 16 4 16 4 Z" fill="var(${v})" ${S}/>`;

const ICON = {
  hair: {
    short: svg(`${FACE}${hair('M6 18.5 A10 10 0 0 1 26 18.5 C23 14 18 12.5 12.5 14.8 C10 15.8 8 17 6 18.5 Z')}<path d="M15.5 8.6 C14.8 6.2 17.2 5.2 18.2 6.6" fill="none" ${S}/>`, VB_HAIR),
    buzz: svg(`${FACE}${hair('M6.8 17 A9.3 9.3 0 0 1 25.2 17 C20 13.8 12 13.8 6.8 17 Z', 'opacity=".8"')}`, VB_HAIR),
    long: svg(`${hair('M5.5 19 A10.5 10.5 0 0 1 26.5 19 L27.5 30 L4.5 30 Z')}${FACE}${hair('M6 18.5 A10 10 0 0 1 26 18.5 C24 14 20 12 16 13.6 C12 12 8 14 6 18.5 Z')}`, VB_HAIR),
    bob: svg(`${hair('M5 24.5 C3.6 5.5 28.4 5.5 27 24.5 Z')}${FACE}${hair('M7.4 15.8 A8.9 8.9 0 0 1 24.6 15.8 Z')}`, VB_HAIR),
    ponytail: svg(`${hair('M21.5 11.5 C28.5 10 30.5 17.5 27.8 27 C26 21.5 25 17.2 21 15 Z')}${FACE}${hair('M6.5 17.6 A9.6 9.6 0 0 1 25.5 17.6 C21 13.6 12 13.6 6.5 17.6 Z')}<circle cx="22.6" cy="12.4" r="1.9" fill="#ff7ab8" ${S}/>`, VB_HAIR),
    curly: svg(`${FACE}${hair('M5.6 20.5 C3 17 5 13 7.2 12.6 C6.6 9 10 7 12.6 8 C13.6 5.4 18.4 5.4 19.4 8 C22 7 25.4 9 24.8 12.6 C27 13 29 17 26.4 20.5 C25 15.5 20 13.6 16 13.6 C12 13.6 7 15.5 5.6 20.5 Z')}`, VB_HAIR),
    bun: svg(`<circle cx="16" cy="6.4" r="3.8" fill="var(--hc)" ${S}/>${FACE}${hair('M6.5 17.6 A9.6 9.6 0 0 1 25.5 17.6 C21 13.8 11 13.8 6.5 17.6 Z')}`, VB_HAIR),
    spiky: svg(`${FACE}${hair('M6.5 18 L5 10.5 L9.5 12 L9.5 5.5 L13.5 9.5 L16 3.5 L18.5 9.5 L22.5 5.5 L22.5 12 L27 10.5 L25.5 18 C21.5 14 10.5 14 6.5 18 Z')}`, VB_HAIR),
    afro: svg(`<circle cx="16" cy="15.5" r="13" fill="var(--hc)" ${S}/>${FACE}${hair('M8 16.4 C9 12.4 23 12.4 24 16.4 C20 14.6 12 14.6 8 16.4 Z')}`, VB_HAIR),
    braids: svg(`${[6.6, 25.4].map((x) => [21, 24.2, 27.4].map((y) => `<circle cx="${x}" cy="${y}" r="2.1" fill="var(--hc)" ${S}/>`).join('')).join('')}${FACE}${hair('M6.5 18 A9.6 9.6 0 0 1 25.5 18 C23 14.5 18.5 13 16 12.2 C13.5 13 9 14.5 6.5 18 Z')}`, VB_HAIR),
    bald: svg(`${FACE}<path d="M11.6 11.8 C13.2 10.6 15.4 10.3 17 10.5" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`, VB_HAIR),
  },
  facial: {
    none: svg(`${FACE}${SMILE}`, VB_FACE),
    mustache: svg(`${FACE}${STACHE}`, VB_FACE),
    beard: svg(`${FACE}<path d="M7.3 19.6 C7.5 29.4 24.5 29.4 24.7 19.6 C23 23.6 20 25.4 16 25.4 C12 25.4 9 23.6 7.3 19.6 Z" fill="var(--hc)" ${S}/>${STACHE}`, VB_FACE),
    stubble: svg(`${FACE}${SMILE}${[[9.6, 22.4], [11, 24.6], [13.2, 26], [16, 26.4], [18.8, 26], [21, 24.6], [22.4, 22.4]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".95" fill="var(--hc)"/>`).join('')}`, VB_FACE),
  },
  freckles: {
    false: svg(`${FACE}${SMILE}`, VB_FACE),
    true: svg(`${FACE}${SMILE}${[[10, 21.6], [11.6, 22.9], [9.4, 23.4], [22, 21.6], [20.4, 22.9], [22.6, 23.4]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".85" fill="#b0643c"/>`).join('')}`, VB_FACE),
  },
  glasses: {
    none: svg(NONE, VB_WIDE),
    round: svg(`<circle cx="9.8" cy="17" r="5.6" fill="#e6f6ff" ${S}/><circle cx="22.2" cy="17" r="5.6" fill="#e6f6ff" ${S}/><path d="M15.4 16.4 Q16 14.8 16.6 16.4 M4.2 16 L2 14.4 M27.8 16 L30 14.4" fill="none" ${S}/>`, '1 6 30 22'),
    square: svg(`<rect x="3.6" y="12" width="11.2" height="9.2" rx="2.4" fill="#e6f6ff" ${S}/><rect x="17.2" y="12" width="11.2" height="9.2" rx="2.4" fill="#e6f6ff" ${S}/><path d="M14.8 15.4 L17.2 15.4" fill="none" ${S}/>`, '1 6 30 22'),
  },
  top: {
    tee: svg(`<path d="${TEE_BODY}" fill="var(--tc)" ${S}/>`, VB_WIDE),
    hoodie: svg(`<path d="M11 6.5 C10.4 2.4 21.6 2.4 21 6.5 Z" fill="var(--tc)" ${S}/><path d="${LONG_BODY}" fill="var(--tc)" ${S}/><path d="M12 19.5 L20 19.5 L21 24 L11 24 Z M14.5 9 L14.5 13 M17.5 9 L17.5 13" fill="none" ${S}/>`, VB_WIDE),
    sweater: svg(`<path d="${LONG_BODY}" fill="var(--tc)" ${S}/><path d="M9.5 15.5 L22.5 15.5 L22.5 18.6 L9.5 18.6 Z" fill="#fffdf6" ${S}/><path d="M9.5 25 L22.5 25" fill="none" ${S}/>`, VB_WIDE),
    shirt: svg(`<path d="M11 6 L5.5 8.5 L3 18 L7.5 19 L9.5 12.5 L9.5 27 L22.5 27 L22.5 12.5 L24.5 19 L29 18 L26.5 8.5 L21 6 Z" fill="var(--tc)" ${S}/><path d="M11 6 L16 10.5 L12.6 12.6 Z M21 6 L16 10.5 L19.4 12.6 Z" fill="#fffdf6" ${S}/><circle cx="16" cy="15" r=".9" fill="${INK}"/><circle cx="16" cy="19" r=".9" fill="${INK}"/><circle cx="16" cy="23" r=".9" fill="${INK}"/>`, VB_WIDE),
    dress: svg(`<circle cx="10.4" cy="8" r="2.8" fill="var(--tc)" ${S}/><circle cx="21.6" cy="8" r="2.8" fill="var(--tc)" ${S}/><path d="M12 5.5 L20 5.5 L21 12 L27.5 27.5 L4.5 27.5 L11 12 Z" fill="var(--tc)" ${S}/><path d="M11 12.4 L21 12.4" fill="none" stroke="var(--bc)" stroke-width="2.6"/>`, VB_WIDE),
  },
  accessory: {
    none: svg(NONE, VB_WIDE),
    cap: svg(`<path d="M7 19.5 C7 9.5 25 9.5 25 18.6 L30 20 L7 20 Z" fill="var(--ac)" ${S}/><circle cx="16" cy="10.6" r="1.3" fill="${INK}"/>`, VB_WIDE),
    beanie: svg(`<path d="M7 20 C7 8.4 25 8.4 25 20 Z" fill="var(--ac)" ${S}/><rect x="5.6" y="18" width="20.8" height="5.4" rx="2.2" fill="var(--ac)" ${S}/><circle cx="16" cy="7.6" r="2.9" fill="#fffdf6" ${S}/>`, VB_WIDE),
    headband: svg(`<circle cx="16" cy="19" r="9" fill="var(--sk)" ${S}/><path d="M7.4 17 A9 9 0 0 1 24.6 17" fill="none" stroke="${INK}" stroke-width="5.4" stroke-linecap="round"/><path d="M7.4 17 A9 9 0 0 1 24.6 17" fill="none" stroke="var(--ac)" stroke-width="2.6" stroke-linecap="round"/>`, VB_WIDE),
    bow: svg(`<path d="M16 16 L5.5 9.5 L5.5 22.5 Z M16 16 L26.5 9.5 L26.5 22.5 Z" fill="var(--ac)" ${S}/><circle cx="16" cy="16" r="2.8" fill="var(--ac)" ${S}/>`, VB_WIDE),
    earrings: svg([9.5, 22.5].map((x) => `<path d="M${x} 7 L${x} 13" fill="none" ${S}/><circle cx="${x}" cy="7" r="1.6" fill="#ffd35a" ${S}/><path d="M${x} 13 C${x - 4} 17 ${x - 3} 23 ${x} 23 C${x + 3} 23 ${x + 4} 17 ${x} 13 Z" fill="#ffd35a" ${S}/>`).join('')),
  },
  row: {
    skin: svg(DROP('--sk')),
    eyes: svg(`<path d="M3 16 C8 8 24 8 29 16 C24 24 8 24 3 16 Z" fill="#fff" ${S}/><circle cx="16" cy="16" r="4.6" fill="var(--ec)" ${S}/>`),
    hair: svg(DROP('--hc')),
    top: svg(`<path d="${TEE_BODY}" fill="var(--tc)" ${S}/>`),
    bottom: svg(`<path d="M9 5 L23 5 L24.4 27 L18.4 27 L16 13.5 L13.6 27 L7.6 27 Z" fill="var(--bc)" ${S}/>`),
    shoes: svg(`<path d="M3.5 22 C3.5 15.5 8.5 13 11.5 14 C14.5 15 17 17.2 22 17.6 C26.5 18 28.5 20.5 28.5 23 L28.5 25.5 L3.5 25.5 Z" fill="var(--fc)" ${S}/><path d="M3.5 22.5 L28.5 22.5" fill="none" ${S}/>`),
  },
  tab: {
    face: svg(`<circle cx="16" cy="16" r="11" fill="var(--sk)" ${S}/><ellipse cx="12" cy="15.4" rx="1.5" ry="2" fill="${INK}"/><ellipse cx="20" cy="15.4" rx="1.5" ry="2" fill="${INK}"/><path d="M12.6 20.4 Q16 23.4 19.4 20.4" fill="none" ${S}/>`),
    clothes: svg(`<path d="${TEE_BODY}" fill="var(--tc)" ${S}/>`),
    extras: svg(`<circle cx="9.8" cy="20" r="5" fill="#e6f6ff" ${S}/><circle cx="22.2" cy="20" r="5" fill="#e6f6ff" ${S}/><path d="M14.8 19.4 Q16 18 17.2 19.4" fill="none" ${S}/><path d="M16 9 L9.5 5 L9.5 13 Z M16 9 L22.5 5 L22.5 13 Z" fill="var(--ac)" ${S}/><circle cx="16" cy="9" r="1.9" fill="var(--ac)" ${S}/>`),
  },
};
ICON.tab.hair = ICON.hair.short;

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const NAMES = {
  facialHair: { none: 'Clean-shaven' },
  freckles: { false: 'No freckles', true: 'Freckles' },
  glasses: { none: 'No glasses', round: 'Round glasses', square: 'Square glasses' },
  accessory: { none: 'Nothing' },
};
const tipOf = (field, v) => NAMES[field]?.[String(v)] || cap(String(v));

const TABS = [
  { id: 'face', tip: 'Face', rows: [
    { field: 'skin', palette: SKIN_TONES, icon: ICON.row.skin, tip: 'Skin' },
    { field: 'eyeColor', palette: EYE_COLORS, icon: ICON.row.eyes, tip: 'Eyes' },
    { field: 'facialHair', options: FACIAL_HAIR, icons: ICON.facial },
    { field: 'freckles', options: [false, true], icons: ICON.freckles },
  ] },
  { id: 'hair', tip: 'Hair', rows: [
    { field: 'hairStyle', options: HAIR_STYLES, icons: ICON.hair },
    { field: 'hairColor', palette: HAIR_COLORS, icon: ICON.row.hair, tip: 'Hair colour' },
  ] },
  { id: 'clothes', tip: 'Clothes', rows: [
    { field: 'topStyle', options: TOP_STYLES, icons: ICON.top },
    { field: 'topColor', palette: CLOTH_COLORS, icon: ICON.row.top, tip: 'Top' },
    { field: 'bottomColor', palette: CLOTH_COLORS, icon: ICON.row.bottom, tip: 'Bottoms' },
    { field: 'shoeColor', palette: SHOE_COLORS, icon: ICON.row.shoes, tip: 'Shoes' },
  ] },
  { id: 'extras', tip: 'Extras', rows: [
    { field: 'glasses', options: GLASSES, icons: ICON.glasses },
    { field: 'accessory', options: ACCESSORIES, icons: ICON.accessory },
  ] },
];

// ---------------------------------------------------------------------------------------------
// small helpers

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// h('button', { class, title, onclick, html (trusted static SVG only), text }, ...children)
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids) if (kid != null && kid !== false) e.append(kid);
  return e;
}

function ensureCss() {
  if (document.querySelector(`link[href="${CSS_HREF}"]`)) return Promise.resolve();
  const link = h('link', { rel: 'stylesheet', href: CSS_HREF });
  const loaded = new Promise((r) => { link.onload = r; link.onerror = r; });
  document.head.appendChild(link);
  return Promise.race([loaded, wait(1500)]);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(Object.assign(new Error('unreadable image'), { code: 'type' }));
    img.src = src;
  });
}

// Any drawable (image, video frame) -> JPEG data URL, longest side <= 768 px.
export function toJpegDataUrl(src, w, h0) {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h0, 1));
  const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h0 * k));
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, cw, ch);
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, cw, ch);
  return c.toDataURL('image/jpeg', JPEG_Q);
}

async function fileToDataUrl(file) {
  if (!file || !/^image\//.test(file.type || '')) throw Object.assign(new Error('not an image'), { code: 'type' });
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return toJpegDataUrl(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function errorTip(e) {
  if (e?.code === 'type') return 'Not a photo';
  if (e?.code === 'cam') return 'No camera';
  if (e?.status === 503 || e?.body?.offline) return TIP.offline;
  if (e?.status === 413) return 'Too big';
  if (typeof e?.body?.error === 'string' && e.body.error) return e.body.error;
  if (e instanceof TypeError) return 'No connection';
  return 'The mirror is cloudy. Try another photo.';
}

// ---------------------------------------------------------------------------------------------
// live 3D preview: its own small renderer, a paper pedestal and a turntable

function createPreview(canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (e) {
    console.warn('creator: no WebGL preview', e);
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff8ee, 0x8a9a6a, 1.55));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.9);
  sun.position.set(-2.8, 5.2, 4.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0005;
  Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2.8, bottom: -1.2, near: 0.5, far: 20 });
  scene.add(sun);

  const table = new THREE.Group();
  scene.add(table);
  const paperM = new THREE.MeshStandardMaterial({ color: 0xfffdf6, roughness: 0.95 });
  const inkM = new THREE.MeshStandardMaterial({ color: 0x2b2233, roughness: 0.9 });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.08, 64), paperM);
  top.position.y = -0.04;
  top.receiveShadow = true;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.07, 64), inkM);
  rim.position.y = -0.095;
  table.add(top, rim);

  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
  let model = null, swap = null, alive = true, raf = 0, last = performance.now();
  let yaw = 0.45, vel = 0, dragging = false, moved = 0, lastX = 0, idle = 2, w = 0, hgt = 0, present = null;

  function frameCamera() {
    const cw = canvas.clientWidth || 1, ch = canvas.clientHeight || 1;
    if (cw === w && ch === hgt) return;
    w = cw; hgt = ch;
    renderer.setSize(cw, ch, false);
    camera.aspect = cw / ch;
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(1.45 / t, 1.3 / (t * camera.aspect));
    camera.position.set(0, 1.28, dist);
    camera.lookAt(0, 0.93, 0);
    camera.updateProjectionMatrix();
  }

  function finishSwap() {
    if (!swap) return;
    if (swap.from) { table.remove(swap.from); disposeModel(swap.from); }
    swap.to.scale.setScalar(1);
    model = swap.to;
    swap = null;
  }

  function setModel(params, { poof = false } = {}) {
    finishSwap();
    const next = buildHuman(params);
    table.add(next);
    if (model && poof && !reducedMotion()) {
      next.scale.setScalar(0.001);
      swap = { t: 0, from: model, to: next };
      return;
    }
    if (model) { table.remove(model); disposeModel(model); }
    model = next;
    next.userData.hop?.();
  }

  const easeBack = (x) => 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2;
  function loop(now) {
    if (!alive) return;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    frameCamera();
    if (!dragging) {
      idle += dt;
      if (present !== null) {
        yaw += (present - yaw) * Math.min(1, dt * 6);
        if (Math.abs(present - yaw) < 0.003) present = null;
      } else if (idle > 1.4) {
        // turntable: slow while the face is toward you, quicker round the back
        const back = (1 - Math.cos(yaw)) / 2;
        yaw += dt * (0.28 + 1.1 * back);
        vel = 0;
      } else { yaw += vel * dt; vel *= Math.pow(0.04, dt); }
    }
    table.rotation.y = yaw;
    if (swap) {
      swap.t += dt;
      const a = Math.min(1, swap.t / 0.16);
      if (swap.from) {
        swap.from.scale.set(1 + 0.25 * a, Math.max(0.001, 1 - a), 1 + 0.25 * a);
        if (a >= 1) { table.remove(swap.from); disposeModel(swap.from); swap.from = null; }
      }
      const b = Math.min(1, Math.max(0, (swap.t - 0.14) / 0.45));
      swap.to.scale.setScalar(Math.max(0.001, easeBack(b)));
      swap.to.userData.animate?.(dt, { moving: false, facing: 0 });
      if (b >= 1) { const m = swap.to; finishSwap(); m.userData.hop?.(); }
    } else if (model) {
      model.userData.animate?.(dt, { moving: false, facing: 0 });
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  // drag to spin, tap to hop
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; moved = 0; lastX = e.clientX; vel = 0;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    moved += Math.abs(dx);
    yaw += dx * 0.012;
    vel = dx * 0.012 * 60;
  });
  const up = () => {
    if (!dragging) return;
    dragging = false;
    idle = 0;
    if (moved < 4) (swap?.to || model)?.userData.hop?.();
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  return {
    setModel,
    hop() { model?.userData.hop?.(); },
    // swing round to a three-quarter front view and hold it a moment (after every change)
    present() {
      const goal = 0.38;
      const d = Math.atan2(Math.sin(goal - yaw), Math.cos(goal - yaw));
      present = yaw + d;
      idle = -2.6;
      vel = 0;
    },
    dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      finishSwap();
      if (model) disposeModel(model);
      disposeModel(table);
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
  };
}

// paper confetti + a little cloud over the stage
function poof(layer, big = true) {
  if (reducedMotion()) return;
  const colors = ['#ff7ab8', '#ffd35a', '#3ec7b5', '#8fd3ff', '#b39cff', '#fffdf6'];
  const n = big ? 18 : 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
    const d = (big ? 110 : 70) + Math.random() * 70;
    const bit = h('i', { class: 'cr-bit', style: `--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 30}px;--r:${(Math.random() - 0.5) * 900}deg;background:${colors[i % colors.length]};animation-delay:${Math.random() * 60}ms` });
    layer.append(bit);
  }
  for (let i = 0; i < (big ? 6 : 3); i++) {
    const a = (i / 6) * Math.PI * 2;
    layer.append(h('b', { class: 'cr-cloud', style: `--dx:${Math.cos(a) * 46}px;--dy:${Math.sin(a) * 30}px;animation-delay:${i * 25}ms` }));
  }
  setTimeout(() => layer.replaceChildren(), 1000);
}

// ---------------------------------------------------------------------------------------------
// the creator

let current = null;

export function open({ initial } = {}) {
  if (current) return current;
  current = new Promise((resolve) => {
    run(initial, resolve).catch((e) => {
      console.error('creator failed', e);
      resolve(normalizeCharacter(initial || DEFAULT_CHARACTER));
    });
  }).finally(() => { current = null; });
  return current;
}

async function run(initial, resolve) {
  await ensureCss();
  const host = document.getElementById('ui-root') || document.body;
  let params = normalizeCharacter(initial || DEFAULT_CHARACTER);
  const initialName = params.name || '';
  delete params.name;
  let tab = 'face', closed = false, photoToken = 0, stream = null;

  // ---- DOM
  const fileInput = h('input', { type: 'file', accept: 'image/*', class: 'cr-file', hidden: true, tabindex: -1 });
  const photoImg = h('img', { class: 'cr-photo-img', alt: '', draggable: 'false' });
  const video = h('video', { class: 'cr-video', playsinline: true, muted: true, autoplay: true });
  const badge = h('div', { class: 'cr-badge', role: 'img' });
  const camBtn = h('button', { type: 'button', class: 'cr-mini cr-cam', title: TIP.cam, 'aria-label': TIP.cam, html: svg(`<rect x="3" y="9" width="19" height="15" rx="4" fill="#8fd3ff" ${S}/><path d="M22 14 L29 10 L29 23 L22 19 Z" fill="#8fd3ff" ${S}/><circle cx="12.5" cy="16.5" r="3.4" fill="#fffdf6" ${S}/>`) });
  const snapBtn = h('button', { type: 'button', class: 'cr-snap', title: TIP.snap, 'aria-label': TIP.snap });
  const camX = h('button', { type: 'button', class: 'cr-mini cr-camx', title: TIP.cancel, 'aria-label': TIP.cancel, text: '✕' });
  const photo = h('div', { class: 'cr-photo', role: 'button', tabindex: 0, title: TIP.photo, 'aria-label': TIP.photo },
    h('div', { class: 'cr-tape' }),
    h('div', { class: 'cr-frame' }, h('div', { class: 'cr-photo-icon', text: '📷' }), photoImg, video, h('div', { class: 'cr-spin' }), snapBtn),
    h('div', { class: 'cr-photo-foot' }, camBtn, camX),
    badge, fileInput);
  const offChip = h('div', { class: 'cr-offline', title: TIP.offline, 'aria-label': TIP.offline, role: 'img' }, h('span', { text: '📷' }), h('i', { text: '⦸' }));
  const canvas = h('canvas', { class: 'cr-canvas' });
  const poofLayer = h('div', { class: 'cr-poof' });
  const nameInput = h('input', { class: 'cr-name', type: 'text', placeholder: 'name', maxlength: 16, title: TIP.name, 'aria-label': TIP.name, autocomplete: 'off', spellcheck: 'false', value: initialName });
  const diceBtn = h('button', { type: 'button', class: 'cr-round cr-dice', title: TIP.dice, 'aria-label': TIP.dice, text: '🎲' });
  const okBtn = h('button', { type: 'button', class: 'cr-round cr-ok', title: TIP.ok, 'aria-label': TIP.ok, text: '✓' });
  const stage = h('div', { class: 'cr-stage' }, canvas, poofLayer, offChip, h('div', { class: 'cr-actions' }, diceBtn, nameInput, okBtn));
  const tabsEl = h('div', { class: 'cr-tabs', role: 'tablist' });
  const panel = h('div', { class: 'cr-panel', role: 'tabpanel' });
  const controls = h('div', { class: 'cr-controls' }, tabsEl, panel);
  const card = h('div', { class: 'cr-card etl-panel no-photo checking' }, photo, stage, controls);
  const overlay = h('div', { class: 'cr-overlay' }, card);
  nameInput.value = initialName;
  host.appendChild(overlay);
  openModal(overlay, { onEscape: () => { if (stream) stopCam(); } });

  // ---- preview
  const preview = createPreview(canvas);
  if (!preview) stage.classList.add('no-gl');
  let rebuildQueued = false, rebuildPoof = false;
  const rebuild = (poofIt = false) => {
    rebuildPoof = rebuildPoof || poofIt;
    if (rebuildQueued) return;
    rebuildQueued = true;
    requestAnimationFrame(() => {
      rebuildQueued = false;
      if (closed) return;
      preview?.setModel(params, { poof: rebuildPoof });
      preview?.present();
      rebuildPoof = false;
    });
  };

  // ---- controls
  function setVars() {
    const v = { '--sk': params.skin, '--hc': params.hairColor, '--ec': params.eyeColor, '--tc': params.topColor, '--bc': params.bottomColor, '--fc': params.shoeColor, '--ac': '#ff7ab8' };
    for (const [k, c] of Object.entries(v)) card.style.setProperty(k, c);
  }
  function sync() {
    setVars();
    for (const b of panel.querySelectorAll('[data-field]')) {
      const f = b.dataset.field;
      if (b.classList.contains('cr-any')) {
        const row = TABS.flatMap((t) => t.rows).find((r) => r.field === f);
        const custom = !row.palette.includes(params[f]);
        b.classList.toggle('on', custom);
        b.style.setProperty('--c', custom ? params[f] : '');
        b.querySelector('input').value = params[f];
      } else {
        const on = String(params[f]) === b.dataset.value;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
    for (const t of tabsEl.children) {
      const on = t.dataset.tab === tab;
      t.classList.toggle('on', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    }
  }
  function set(field, value) {
    if (params[field] === value) return;
    params = normalizeCharacter({ ...params, [field]: value });
    delete params.name;
    sync();
    rebuild();
  }
  function renderPanel() {
    panel.replaceChildren();
    const t = TABS.find((x) => x.id === tab);
    for (const row of t.rows) {
      const opts = h('div', { class: 'cr-opts' });
      if (row.palette) {
        for (const c of row.palette) {
          opts.append(h('button', { type: 'button', class: 'cr-sw', style: `--c:${c}`, 'data-field': row.field, 'data-value': c, 'aria-label': `${row.tip} ${c}`, onclick: () => set(row.field, c) }));
        }
        const input = h('input', { type: 'color', tabindex: -1, 'aria-label': `${row.tip}: ${TIP.any}` });
        input.addEventListener('input', () => set(row.field, input.value));
        opts.append(h('label', { class: 'cr-sw cr-any', title: TIP.any, 'data-field': row.field }, input));
        panel.append(h('div', { class: 'cr-row', title: row.tip }, h('div', { class: 'cr-row-icon', html: row.icon }), opts));
      } else {
        for (const v of row.options) {
          const tip = tipOf(row.field, v);
          opts.append(h('button', { type: 'button', class: 'cr-chip', title: tip, 'aria-label': tip, 'data-field': row.field, 'data-value': String(v), html: row.icons[String(v)], onclick: () => set(row.field, v) }));
        }
        panel.append(h('div', { class: 'cr-row cr-row-chips' }, opts));
      }
    }
    sync();
  }
  for (const t of TABS) {
    tabsEl.append(h('button', { type: 'button', class: 'cr-tab', role: 'tab', 'data-tab': t.id, title: t.tip, 'aria-label': t.tip, html: ICON.tab[t.id], onclick: () => { tab = t.id; renderPanel(); } }));
  }
  renderPanel();
  rebuild();

  diceBtn.addEventListener('click', () => {
    params = normalizeCharacter(randomCharacter());
    delete params.name;
    diceBtn.classList.remove('roll');
    void diceBtn.offsetWidth;
    diceBtn.classList.add('roll');
    sync();
    rebuild(true);
    poof(poofLayer, false);
  });

  // ---- photo -> Claude
  const setPhoto = (state, tip = '') => {
    photo.dataset.state = state;
    badge.textContent = state === 'error' ? '⦸' : state === 'done' ? '✓' : '';
    badge.title = tip;
    badge.setAttribute('aria-label', tip || state);
    photo.title = state === 'error' && tip ? `${tip}\n${TIP.photo}` : TIP.photo;
  };
  setPhoto('idle');
  async function sendPhoto(getDataUrl) {
    if (closed || card.classList.contains('no-photo')) return;
    const token = ++photoToken;
    setPhoto('busy');
    try {
      const dataUrl = await getDataUrl();
      if (token !== photoToken || closed) return;
      photoImg.src = dataUrl;
      photo.classList.add('has-img');
      const res = await api.avatar(dataUrl);
      if (token !== photoToken || closed) return;
      params = normalizeCharacter(res?.params || {});
      delete params.name;
      sync();
      rebuild(true);
      poof(poofLayer, true);
      setPhoto('done');
    } catch (e) {
      if (token !== photoToken || closed) return;
      console.warn('creator: avatar failed', e);
      setPhoto('error', errorTip(e));
    }
  }
  const pickFile = () => { if (!photo.dataset.state || photo.dataset.state === 'busy' || stream) return; fileInput.value = ''; fileInput.click(); };
  photo.addEventListener('click', (e) => { if (e.target.closest('button')) return; pickFile(); });
  photo.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === photo) { e.preventDefault(); pickFile(); } });
  fileInput.addEventListener('change', () => { const f = fileInput.files?.[0]; if (f) sendPhoto(() => fileToDataUrl(f)); });
  // drag & drop anywhere on the card
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  card.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; photo.classList.add('drag'); });
  card.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = card.classList.contains('no-photo') ? 'none' : 'copy'; });
  card.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) photo.classList.remove('drag'); });
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    photo.classList.remove('drag');
    const f = [...(e.dataTransfer?.files || [])].find((x) => /^image\//.test(x.type)) || e.dataTransfer?.files?.[0];
    if (f) sendPhoto(() => fileToDataUrl(f));
  });
  const onPaste = (e) => {
    if (closed) return;
    const f = [...(e.clipboardData?.files || [])].find((x) => /^image\//.test(x.type));
    if (f) { e.preventDefault(); sendPhoto(() => fileToDataUrl(f)); }
  };
  window.addEventListener('paste', onPaste);

  // ---- webcam (optional)
  const canCam = !!navigator.mediaDevices?.getUserMedia;
  camBtn.hidden = !canCam;
  function stopCam() {
    if (stream) stream.getTracks().forEach((tr) => tr.stop());
    stream = null;
    video.srcObject = null;
    photo.classList.remove('cam');
  }
  camBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (stream || photo.dataset.state === 'busy') return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false });
      if (closed) { stopCam(); return; }
      video.srcObject = stream;
      photo.classList.add('cam');
      setPhoto('idle');
      await video.play().catch(() => {});
    } catch (err) {
      stopCam();
      setPhoto('error', errorTip(Object.assign(err || {}, { code: 'cam' })));
    }
  });
  camX.addEventListener('click', (e) => { e.stopPropagation(); stopCam(); });
  snapBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!stream || !video.videoWidth) return;
    const dataUrl = toJpegDataUrl(video, video.videoWidth, video.videoHeight);
    stopCam();
    sendPhoto(async () => dataUrl);
  });

  // ---- is Claude here? (the photo path is only offered when it is)
  api.status().then((s) => {
    if (!closed && s?.ai) card.classList.remove('no-photo');
  }).catch(() => { /* offline: manual only */ }).finally(() => card.classList.remove('checking'));

  // ---- done
  return new Promise((done) => {
    const finish = () => {
      if (closed) return;
      closed = true;
      const out = normalizeCharacter({ ...params, name: nameInput.value });
      stopCam();
      window.removeEventListener('paste', onPaste);
      overlay.classList.add('out');
      setTimeout(() => {
        preview?.dispose();
        closeModal(overlay);
        overlay.remove();
        resolve(out);
        done();
      }, reducedMotion() ? 0 : 220);
    };
    okBtn.addEventListener('click', finish);
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(); } });
  });
}

export default { open };
