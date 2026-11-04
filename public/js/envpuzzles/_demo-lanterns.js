// Dev-only demo for the environmental puzzle API: light three lanterns in the village, left to right.
export default {
  mount(w, spec, api) {
    const { THREE } = w;
    const spots = spec.spots || ['lane-left', 'lane-mid', 'bridge'];
    const items = []; let next = 0;
    const lanterns = spots.map((anchor, i) => {
      const a = w.anchors[anchor];
      const g = new THREE.Group(); g.position.set(a[0] + 1.4, a[1], a[2] - 0.6);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.6, 8), new THREE.MeshLambertMaterial({ color: 0x3a3440 })); pole.position.y = 0.8; g.add(pole);
      const glass = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), new THREE.MeshLambertMaterial({ color: 0x777777, emissive: 0x000000 })); glass.position.y = 1.75; g.add(glass);
      w.scene.add(g);
      const lit = (on) => { glass.material.color.set(on ? 0xffe28a : 0x777777); glass.material.emissive.set(on ? 0xffb030 : 0x000000); };
      const it = w.addInteractable({
        label: `Lantern ${i + 1}`, icon: '🏮', pos: { x: g.position.x, y: a[1], z: g.position.z }, radius: 1.6,
        onInteract: async () => {
          if (i !== next) { w.sfx('buzz'); w.toast('Out of order! They all go dark.', 1800); next = 0; lanterns.forEach((l) => l.lit(false)); return; }
          lit(true); w.sfx('ding'); next++;
          api.onProgress?.(`🏮 ${next}/${spots.length}`);
          if (next === spots.length) api.onSolved();
        },
      });
      items.push(it);
      return { g, lit };
    });
    return { destroy() { items.forEach((it) => w.removeInteractable(it)); lanterns.forEach((l) => w.scene.remove(l.g)); } };
  },
};
