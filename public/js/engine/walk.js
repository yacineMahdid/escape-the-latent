// Walkable surfaces for the layered diorama, plus simple circle/rect colliders.
// A point is walkable if some zone contains it whose surface is within STEP of
// the current height, and no zone there rises more than STEP above you (cliff walls).
const STEP = 0.45;

export function surfaceY(zone, x, z) {
  if (zone.ramp) {
    // along z by default (y0 at z0, y1 at z1); axis: 'x' slopes along x instead (y0 at x0, y1 at x1)
    const t = zone.axis === 'x' ? (x - zone.x0) / (zone.x1 - zone.x0) : (z - zone.z0) / (zone.z1 - zone.z0);
    return zone.y0 + (zone.y1 - zone.y0) * t;
  }
  if (zone.arch) {
    const u = Math.min(1, Math.abs(x - zone.cx) / zone.half);
    return zone.base + zone.rise * Math.cos(u * Math.PI / 2);
  }
  return zone.y;
}

const inside = (zn, x, z) => x >= zn.x0 && x <= zn.x1 && z >= zn.z0 && z <= zn.z1;

export function sampleHeight(zones, x, z, currentY) {
  let best = null;
  for (const zn of zones) {
    if (!inside(zn, x, z)) continue;
    const y = surfaceY(zn, x, z);
    if (y > currentY + STEP) return null; // a wall (cliff face or stairs side)
    if (Math.abs(y - currentY) <= STEP && (best === null || y > best)) best = y;
  }
  return best;
}

function hitsCollider(colliders, x, z, radius) {
  for (const c of colliders) {
    if (c.disabled) continue;
    if (c.type === 'circle') { if (Math.hypot(x - c.x, z - c.z) < c.r + radius) return true; }
    else if (x > c.x0 - radius && x < c.x1 + radius && z > c.z0 - radius && z < c.z1 + radius) return true;
  }
  return false;
}

// Try to move from (x,z,y) by (dx,dz). Slides along obstacles. Returns the new {x,z,y}.
export function moveOnSurface(world, pos, dx, dz, radius = 0.38) {
  const tryMove = (nx, nz) => {
    if (hitsCollider(world.colliders, nx, nz, radius)) return null;
    const y = sampleHeight(world.zones, nx, nz, pos.y);
    if (y === null) return null;
    return { x: nx, z: nz, y };
  };
  return tryMove(pos.x + dx, pos.z + dz)
    || (dx && tryMove(pos.x + dx, pos.z))
    || (dz && tryMove(pos.x, pos.z + dz))
    || { x: pos.x, z: pos.z, y: pos.y };
}
