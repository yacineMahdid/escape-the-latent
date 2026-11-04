// Keyboard state for movement + edge-triggered actions.
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

// Game keys count only while play is on (not on the title, in the creator or during a scene change) and no modal is
// open: a key that a dialogue, menu or board handles is not also a game key (Esc closing the pause menu must not
// reopen it). Capture phase, so this runs before any modal's own key handling.
let enabled = true;
window.addEventListener('keydown', (e) => {
  if (!enabled || typingInField(e) || isModalOpen()) return;
  const a = MAP[e.code];
  if (!a) return;
  if (!down.has(a) && !e.repeat) pressed.add(a);
  down.add(a);
  if (a !== 'menu') e.preventDefault();
}, true);
window.addEventListener('keyup', (e) => { const a = MAP[e.code]; if (a) down.delete(a); });
window.addEventListener('blur', () => { down.clear(); pressed.clear(); });

export const input = {
  // off: keys are left to the page (title and ending buttons work with the keyboard); on/off both forget held keys
  setEnabled(on) { enabled = !!on; down.clear(); pressed.clear(); },
  get enabled() { return enabled; },
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
