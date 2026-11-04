// Renderer, resize handling, the main loop and scene switching.
import * as THREE from 'three';

export function createEngine(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  host.appendChild(renderer.domElement);

  let current = null;
  const clock = new THREE.Clock();
  let elapsed = 0;

  function resize() {
    const w = host.clientWidth || window.innerWidth, h = host.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    if (current?.camera) { current.camera.aspect = w / h; current.camera.updateProjectionMatrix(); }
    current?.onResize?.(w, h);
  }
  window.addEventListener('resize', resize);

  // While a full-screen overlay (a puzzle board, a mini-game, the book, the terminal, the creator) covers the
  // world, it is redrawn only a few times a second: it is only a backdrop then, and slow GPUs need the time.
  const COVERS = '.puzzle-host, .bk-overlay, .term-overlay, .ex-overlay, .cr-overlay';
  let lastDraw = 0;
  function frame(now) {
    const dt = Math.min(clock.getDelta(), 1 / 20);
    elapsed += dt;
    if (current) {
      current.update?.(dt, elapsed);
      if (now - lastDraw > 150 || !document.querySelector(COVERS)) { renderer.render(current.scene, current.camera); lastDraw = now; }
    }
    requestAnimationFrame(frame);
  }

  return {
    renderer,
    get scene() { return current; },
    setScene(next) {
      const prev = current;
      current = next;
      resize();
      if (prev && prev !== next) prev.dispose?.();
    },
    start() { resize(); requestAnimationFrame(frame); },
    renderOnce() { if (current) { current.update?.(0.016, elapsed); renderer.render(current.scene, current.camera); } },
  };
}
