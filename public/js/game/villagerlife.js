// Villagers potter about near their spot, like in Animal Crossing: they stroll a few steps, stop, look around,
// hop now and then, and when the player comes close they stop, turn to face them and wave. A villager who is
// talking, held by a world puzzle, or standing on a narrow spot (canWander false) stays put but stays lively.
//
//   const life = createVillagerLife({ mesh, home: [x, y, z], world, player, collider, canWander });
//   each frame: life.update(dt, { talking, held })   (moves the mesh and its collider, animates it)
//   life.goHome()                                     snap back to the home spot (before a puzzle uses them)
import { sampleHeight } from '../engine/walk.js';

const WALK_SPEED = 1.1;      // world units per second: an amble
const NEAR = 3.4;            // the player this close: stop and face them
const RANGE = [0.7, 1.9];    // how far from home a stroll may go
const turnToward = (from, to, k) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * k;

export function createVillagerLife({ mesh, home, world, player, collider, canWander = true, baseYaw = 0 }) {
  const [hx, hy, hz] = home;
  const pos = { x: hx, y: hy, z: hz };
  let state = 'idle', timer = 1 + Math.random() * 3, target = null;
  let act = null, actT = 0, walk = 0, yaw = baseYaw, faceGoal = baseYaw;
  let noticed = false, idleSince = 0;

  const others = () => world.colliders.filter((c) => c !== collider);
  const blocked = (x, z, r) => others().some((c) => !c.disabled && (c.type === 'circle'
    ? Math.hypot(x - c.x, z - c.z) < c.r + r
    : x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r));
  // flat ground on the same layer, nothing in the way, and room round it (wider side to side than front to back,
  // so the narrow riverbank still works): no stopping on stairs, at a ledge or in a doorway
  const okSpot = (x, z) => {
    const y = sampleHeight(world.zones, x, z, hy);
    if (y === null || Math.abs(y - hy) > 0.2 || blocked(x, z, (collider?.r ?? 0.55) + 0.2)) return false;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, px = x + Math.cos(a) * 1.1, pz = z + Math.sin(a) * 0.55;
      const py = sampleHeight(world.zones, px, pz, hy);
      if (py === null || Math.abs(py - hy) > 0.25) return false;
    }
    // leave the player a lane on one side (the riverbank is shallow)
    const lane = (dz) => { const y2 = sampleHeight(world.zones, x, z + dz, hy); return y2 !== null && Math.abs(y2 - hy) < 0.25; };
    if (!lane(1.35) && !lane(-1.35)) return false;
    // don't stop right behind a lamp post or a pole (the camera looks from +z)
    if (world.colliders.some((c) => !c.disabled && c.type === 'circle' && c.r < 0.4 && c.z > z && c.z - z < 3 && Math.abs(c.x - x) < 0.8)) return false;
    return Math.hypot(x - player.pos.x, z - player.pos.z) > 2.2;
  };
  const clearPath = (x0, z0, x1, z1) => {
    for (let k = 1; k <= 6; k++) {
      const u = k / 6, x = x0 + (x1 - x0) * u, z = z0 + (z1 - z0) * u;
      const y = sampleHeight(world.zones, x, z, hy);
      if (y === null || Math.abs(y - hy) > 0.35 || blocked(x, z, (collider?.r ?? 0.55) + 0.05)) return false;
    }
    return true;
  };
  function pickStroll() {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2, d = RANGE[0] + Math.random() * (RANGE[1] - RANGE[0]);
      const x = hx + Math.cos(a) * d, z = hz + Math.sin(a) * d;
      if (okSpot(x, z) && clearPath(pos.x, pos.z, x, z)) return { x, z };
    }
    return null;
  }
  function startAct(name) { act = name; actT = 0; }
  function setIdle(min = 2, max = 6) { state = 'idle'; timer = min + Math.random() * (max - min); target = null; idleSince = 0; }

  function place() {
    mesh.position.set(pos.x, pos.y, pos.z);
    if (collider) { collider.x = pos.x; collider.z = pos.z; }
  }
  place();

  return {
    get pos() { return pos; },
    // back on the home spot, facing the camera (a puzzle uses them); never onto the player
    goHome() {
      setIdle(); yaw = faceGoal = baseYaw; mesh.rotation.y = yaw;
      if (Math.hypot(player.pos.x - hx, player.pos.z - hz) < (collider?.r ?? 0.55) + 0.5) return;
      pos.x = hx; pos.y = hy; pos.z = hz; place();
    },
    update(dt, { talking = false, held = false } = {}) {
      const dp = Math.hypot(player.pos.x - pos.x, player.pos.z - pos.z);
      const near = dp < NEAR && Math.abs(player.pos.y - pos.y) < 1.5;
      const toPlayer = Math.atan2(player.pos.x - pos.x, player.pos.z - pos.z);
      if (act) { actT += dt; if (actT > (act === 'look' ? 1.8 : act === 'wave' ? 1.5 : act === 'happy' ? 0.75 : 0.5)) act = null; }

      if (talking || held) {
        state = 'idle'; target = null; idleSince = 0;
        if (talking) faceGoal = toPlayer;
      } else if (near) {
        // stop, turn to the player; the first time they come close, a little wave
        if (state === 'walk') setIdle();
        idleSince = 0;
        faceGoal = toPlayer;
        if (!noticed) { noticed = true; startAct(Math.random() < 0.6 ? 'wave' : 'happy'); }
      } else {
        if (dp > NEAR + 2) noticed = false;
        if (state === 'walk' && target) {
          const dx = target.x - pos.x, dz = target.z - pos.z, d = Math.hypot(dx, dz);
          if (d < 0.08) setIdle(2.5, 7);
          else {
            const s = Math.min(d, WALK_SPEED * dt), nx = pos.x + (dx / d) * s, nz = pos.z + (dz / d) * s;
            const ny = sampleHeight(world.zones, nx, nz, pos.y);
            if (ny === null || blocked(nx, nz, (collider?.r ?? 0.55) + 0.02) || Math.hypot(nx - player.pos.x, nz - player.pos.z) < 1.2) setIdle(1, 3);
            else { pos.x = nx; pos.z = nz; pos.y += (ny - pos.y) * Math.min(1, dt * 12); faceGoal = Math.atan2(dx, dz); }
          }
        } else {
          idleSince += dt;
          timer -= dt;
          // after a while standing, turn back toward the camera (the diorama's front)
          if (idleSince > 2.5) faceGoal = baseYaw;
          if (timer <= 0) {
            const r = Math.random();
            if (canWander && r < 0.55 && (target = pickStroll())) { state = 'walk'; act = null; }
            else { setIdle(2, 5); if (r < 0.75) startAct('look'); else if (r < 0.9) startAct('hop'); }
          }
        }
      }
      walk += ((state === 'walk' ? 1 : 0) - walk) * Math.min(1, dt * 8);
      yaw = turnToward(yaw, faceGoal, Math.min(1, dt * (talking ? 6 : 7)));
      mesh.rotation.y = yaw;
      place();
      mesh.userData.animate?.(dt, { talking, walk, act, actT });
    },
  };
}
