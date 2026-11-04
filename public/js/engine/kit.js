// Procedural "printed paper" textures. Every generator takes the shared rng.
import * as THREE from 'three';

export function createKit(r) {
  function grain(g, w, h, a) {
    const id = g.getImageData(0, 0, w, h), d = id.data;
    for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * a; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(id, 0, 0);
  }
  function mkTex(w, h, draw, gr = 12) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    draw(g, w, h);
    if (gr) grain(g, w, h, gr);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    return t;
  }
  function rep(t, x, y) { const c = t.clone(); c.repeat.set(x, y); c.needsUpdate = true; return c; }

  function groundTex(p) {
    return mkTex(256, 256, (g, w, h) => {
      g.fillStyle = p.base; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 70; i++) { g.fillStyle = p.blot[i % p.blot.length]; g.beginPath(); g.ellipse(r() * w, r() * h, 6 + r() * 16, 4 + r() * 8, r() * 3, 0, 7); g.fill(); }
      if (p.blades) { g.strokeStyle = p.blades; g.lineWidth = 2; for (let i = 0; i < 160; i++) { const x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 4, y - 5 - r() * 5); g.stroke(); } }
      if (p.ripples) { g.strokeStyle = p.ripples; g.lineWidth = 2.5; for (let y = 6; y < h; y += 16) { g.beginPath(); for (let x = 0; x <= w; x += 8) { const yy = y + Math.sin(x / 20 + y * 0.7) * 4; x ? g.lineTo(x, yy) : g.moveTo(x, yy); } g.stroke(); } }
      if (p.sparkle) { g.fillStyle = p.sparkle; for (let i = 0; i < 140; i++) { g.beginPath(); g.arc(r() * w, r() * h, 0.8 + r() * 1.6, 0, 7); g.fill(); } }
    }, p.grain ?? 12);
  }
  function cliffTex(p) {
    return mkTex(256, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, p.top); gr.addColorStop(1, p.bottom); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      if (p.hex) {
        const s = 20;
        for (let row = -1; row < h / (s * 1.5) + 1; row++) for (let col = -1; col < w / (s * 1.732) + 1; col++) {
          const cx = col * s * 1.732 + (row & 1) * s * 0.866, cy = row * s * 1.5;
          g.beginPath();
          for (let k = 0; k < 6; k++) { const a = Math.PI / 3 * k + Math.PI / 6; const px = cx + Math.cos(a) * s * 0.93, py = cy + Math.sin(a) * s * 0.93; k ? g.lineTo(px, py) : g.moveTo(px, py); }
          g.closePath(); g.fillStyle = p.hex[Math.abs(row * 7 + col * 3) % p.hex.length]; g.fill(); g.strokeStyle = p.stripe; g.lineWidth = 2.5; g.stroke();
        }
      } else if (p.strata) {
        let y = 14; while (y < h) { g.fillStyle = p.stripe; g.fillRect(0, y, w, 3 + r() * 5); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(0, y + 8, w, 2); y += 18 + r() * 16; }
      } else {
        for (let x = 0; x < w; x += 7) { g.fillStyle = p.stripe; g.globalAlpha = 0.4 + r() * 0.6; g.fillRect(x + r() * 3, 0, 2 + r() * 2, h); }
        g.globalAlpha = 1; for (let y = 60; y < h; y += 56) { g.fillStyle = p.stripe; g.fillRect(0, y, w, 3); }
      }
      g.fillStyle = p.band; g.fillRect(0, 0, w, 10);
    });
  }
  function pathTex(p) {
    return mkTex(256, 256, (g, w, h) => {
      g.fillStyle = p.base; g.fillRect(0, 0, w, h);
      if (p.pavers) {
        for (let y = 0; y < h; y += 42) for (let x = ((y / 42) & 1) * 32; x < w + 64; x += 64) { g.fillStyle = p.pebble; g.fillRect(x - 30, y + 2, 60, 38); g.fillStyle = p.base; g.fillRect(x - 27, y + 5, 54, 32); g.fillStyle = 'rgba(255,255,255,.2)'; g.fillRect(x - 24, y + 7, 40, 6); }
      } else if (p.cobble) {
        for (let i = 0; i < 70; i++) { const x = r() * w, y = r() * h, s = 10 + r() * 8; g.fillStyle = p.pebble; g.beginPath(); g.ellipse(x, y, s, s * 0.75, r() * 3, 0, 7); g.fill(); g.fillStyle = p.base; g.beginPath(); g.ellipse(x - 1, y - 1, s * 0.82, s * 0.6, 0, 0, 7); g.fill(); }
      } else {
        for (let i = 0; i < 40; i++) { const x = r() * w, y = r() * h, s = 6 + r() * 10; g.fillStyle = p.pebble; g.beginPath(); g.ellipse(x, y, s, s * 0.7, r() * 3, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.ellipse(x - 2, y - 2, s * 0.5, s * 0.3, 0, 0, 7); g.fill(); }
      }
    });
  }
  function waterTex(p) {
    return mkTex(256, 256, (g, w, h) => {
      g.fillStyle = p.base; g.fillRect(0, 0, w, h);
      if (p.ice) {
        g.strokeStyle = p.line; g.lineWidth = 2;
        for (let i = 0; i < 10; i++) { let x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 60; y += (r() - 0.5) * 40; g.lineTo(x, y); } g.stroke(); }
        g.fillStyle = 'rgba(255,255,255,.35)'; for (let i = 0; i < 8; i++) { g.beginPath(); g.ellipse(r() * w, r() * h, 30, 8, -0.3, 0, 7); g.fill(); }
      } else {
        g.strokeStyle = p.line; g.lineWidth = 5; g.lineCap = 'round';
        for (let i = 0; i < 14; i++) { const y = r() * h, x = r() * w, l = 30 + r() * 60; g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + l * 0.3, y - 6, x + l * 0.6, y + 6, x + l, y); g.stroke(); }
      }
    }, 6);
  }
  function fallTex(p) { return mkTex(128, 256, (g, w, h) => { g.fillStyle = p.base; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 10) { g.fillStyle = r() > 0.5 ? p.a : p.b; g.fillRect(x + r() * 4, 0, 3 + r() * 3, h); } }, 4); }
  function wallTex(base, line, kind) {
    return mkTex(256, 256, (g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h); g.fillStyle = line;
      if (kind === 'brick') { for (let y = 0; y < h; y += 32) { g.fillRect(0, y, w, 3); for (let x = ((y / 32) & 1) * 32; x < w; x += 64) g.fillRect(x, y, 3, 32); } }
      else if (kind === 'log') { for (let y = 0; y < h; y += 26) { g.fillRect(0, y, w, 4); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(0, y + 6, w, 4); g.fillStyle = line; } for (let i = 0; i < 14; i++) { g.beginPath(); g.arc(r() * w, r() * h, 4, 0, 7); g.fill(); } }
      else if (kind === 'adobe') { for (let i = 0; i < 26; i++) { g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,.14)' : line; g.beginPath(); g.ellipse(r() * w, r() * h, 10 + r() * 26, 6 + r() * 12, r() * 3, 0, 7); g.fill(); } g.strokeStyle = line; g.lineWidth = 2; for (let i = 0; i < 5; i++) { let x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 3; k++) { x += (r() - 0.5) * 24; y += 10 + r() * 10; g.lineTo(x, y); } g.stroke(); } }
      else if (kind === 'woven') { for (let y = 0; y < h; y += 16) for (let x = ((y / 16) & 1) * 16; x < w; x += 32) g.fillRect(x, y, 16, 14); }
      else { for (let x = 0; x < w; x += 42) g.fillRect(x, 0, 4, h); for (let i = 0; i < 20; i++) g.fillRect(r() * w, r() * h, 10, 2); }
      for (let i = 0; i < 12; i++) { g.fillStyle = 'rgba(255,255,255,.1)'; g.beginPath(); g.ellipse(r() * w, r() * h, 20, 10, 0, 0, 7); g.fill(); }
    });
  }
  function roofTex(base, dark) {
    return mkTex(256, 256, (g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 28) for (let x = ((y / 28) & 1) * 22; x < w + 44; x += 44) { g.fillStyle = dark; g.beginPath(); g.arc(x, y + 28, 22, Math.PI, 0); g.lineTo(x + 22, y + 28); g.fill(); g.fillStyle = base; g.beginPath(); g.arc(x, y + 26, 19, Math.PI, 0); g.fill(); }
    });
  }
  function thatchTex(base, dark) { return mkTex(256, 256, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 32) { g.fillStyle = dark; g.fillRect(0, y + 28, w, 4); for (let i = 0; i < 70; i++) { const x = r() * w; g.fillStyle = r() > 0.5 ? dark : 'rgba(255,255,255,.25)'; g.fillRect(x, y + r() * 10, 2, 18 + r() * 10); } } }); }
  function snowRoofTex() { return mkTex(256, 256, (g, w, h) => { g.fillStyle = '#f7fbff'; g.fillRect(0, 0, w, h); for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(170,200,235,.35)'; g.beginPath(); g.ellipse(r() * w, r() * h, 30, 10, 0, 0, 7); g.fill(); } g.fillStyle = 'rgba(150,185,230,.5)'; for (let x = 0; x < w; x += 32) { g.beginPath(); g.arc(x + 16, h, 16, Math.PI, 0); g.fill(); } }, 6); }
  function domeTex(base, dark, light, icon) {
    return mkTex(256, 256, (g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      for (let y = 10; y < h; y += 26) for (let x = ((y / 26) & 1) * 16; x < w; x += 32) {
        g.fillStyle = dark; g.beginPath();
        if (icon === 'palm') { g.arc(x, y - 4, 6, 0, 7); g.fill(); g.fillRect(x - 1, y - 2, 2, 9); }
        else if (icon === 'dead') { g.moveTo(x, y - 10); g.lineTo(x + 2, y + 6); g.lineTo(x - 2, y + 6); g.fill(); g.fillRect(x - 5, y - 4, 10, 1.5); g.fillRect(x - 4, y - 8, 1.5, 5); }
        else if (icon === 'dot') { g.arc(x, y, 3, 0, 7); g.fill(); }
        else { g.moveTo(x, y - 9); g.lineTo(x + 6, y + 5); g.lineTo(x - 6, y + 5); g.fill(); }
      }
      g.fillStyle = light; for (let y = 4; y < h; y += 8) for (let x = ((y / 8) & 1) * 4; x < w; x += 8) { g.beginPath(); g.arc(x, y, 1.2, 0, 7); g.fill(); }
    }, 6);
  }
  function leafTex(base, light, dark) {
    return mkTex(256, 256, (g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) { const x = r() * w, y = r() * h; g.fillStyle = r() > 0.5 ? light : dark; g.beginPath(); g.ellipse(x, y, 9, 5, r() * 3, 0, 7); g.fill(); }
      g.fillStyle = 'rgba(255,255,255,.25)'; for (let i = 0; i < 25; i++) { g.beginPath(); g.arc(r() * w, r() * h, 3, 0, 7); g.fill(); }
    });
  }
  function stripeTex(a, b, n = 8) { return mkTex(128, 128, (g, w, h) => { for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? a : b; g.fillRect(i * w / n, 0, w / n, h); } }, 6); }
  const wood = mkTex(128, 128, (g, w, h) => { g.fillStyle = '#b9824a'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 4) { g.fillStyle = `rgba(90,50,20,${r() * 0.25})`; g.fillRect(0, y, w, 1 + r() * 2); } g.fillStyle = 'rgba(60,30,10,.5)'; g.fillRect(0, 0, w, 3); });

  return { mkTex, rep, grain, groundTex, cliffTex, pathTex, waterTex, fallTex, wallTex, roofTex, thatchTex, snowRoofTex, domeTex, leafTex, stripeTex, wood };
}
