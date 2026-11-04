// Modal stack. While any modal is open, the game ignores movement/interaction keys.
const stack = [];

export function openModal(element, { onEscape } = {}) {
  stack.push({ element, onEscape });
  element.classList.add('etl-modal');
  return element;
}

export function closeModal(element) {
  const i = stack.findIndex((m) => m.element === element);
  if (i >= 0) stack.splice(i, 1);
}

export function isModalOpen() {
  return stack.length > 0;
}

export function topModal() {
  return stack[stack.length - 1]?.element ?? null;
}

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !stack.length) return;
  const top = stack[stack.length - 1];
  if (top.onEscape) {
    e.preventDefault();
    top.onEscape();
  }
});
