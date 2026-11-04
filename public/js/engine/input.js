// Keyboard state for movement + edge-triggered actions. Ignored while a modal is open.
import { isModalOpen } from '../ui/modal.js';

const down = new Set();
const pressed = new Set();
const MAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  Space: 'act', KeyE: 'act', Enter: 'act', KeyB: 'book', KeyM: 'map', Escape: 'menu',
};

function typingInField(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || t.tagName === 'SELECT');
}

window.addEventListener('keydown', (e) => {
  if (typingInField(e)) return;
  const a = MAP[e.code];
  if (!a) return;
  if (!down.has(a)) pressed.add(a);
  down.add(a);
  if (a !== 'menu' && !isModalOpen()) e.preventDefault();
});
window.addEventListener('keyup', (e) => { const a = MAP[e.code]; if (a) down.delete(a); });
window.addEventListener('blur', () => { down.clear(); pressed.clear(); });

export const input = {
  axis() {
    if (isModalOpen()) return { x: 0, z: 0 };
    return { x: (down.has('right') ? 1 : 0) - (down.has('left') ? 1 : 0), z: (down.has('down') ? 1 : 0) - (down.has('up') ? 1 : 0) };
  },
  // true once per key press; swallowed while a modal is open
  take(action) {
    const had = pressed.has(action);
    pressed.delete(action);
    return had && !isModalOpen();
  },
  clear() { pressed.clear(); },
};
