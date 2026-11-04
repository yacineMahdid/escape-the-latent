// Explain-it conversation (owner: terminal).
//
//   open({ challenge, regionId, speaker: { name, color? } }) -> Promise<{ pass: boolean, feedback: string }>
//
// A speech bubble: the speaker's name tag and question, a roomy answer card, ➤ to send it to
// api.grade. Pass -> ✓ continue. Not yet -> the villager's reply stays above the card while you
// rewrite; ➤ sends again. Grading trouble shows the server's own word or two ("… busy"), else "…?".
// feedback is '' when nothing was graded (the player backed out first). Drafts live in localStorage
// `etl-explain-<regionId>-<challengeId>` until the answer passes. Explain-kind fundamentals call this
// too, with challenge = { id, type: 'explain', title, question, rubric, offline }.
import { openModal, closeModal, topModal } from './modal.js';
import { api } from '../api.js';
import { h, icon, store, ensureCss, renderInline } from './terminal.js';

const MAX_CHARS = 6000;                 // the server's limit
const draftKey = (regionId, id) => `etl-explain-${regionId}-${id}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// the server's error bodies are already short and in-world ("… busy", "✕ too long")
const errorWord = (err) => {
  const said = err?.body?.error;
  return typeof said === 'string' && said.trim() && said.trim().length <= 40 ? said.trim() : '…?';
};

export async function open({ challenge = {}, regionId = 'local', speaker = {} } = {}) {
  await ensureCss();
  const root = document.getElementById('ui-root') || document.body;
  const id = challenge.id || 'explain';
  const key = draftKey(regionId, id);
  const name = speaker?.name || '…';

  return new Promise((resolve) => {
    let closed = false;
    let passed = false;
    let lastFeedback = '';
    let phase = 'edit';                  // edit | wait | pass  (a failed answer is back in edit, reply shown)
    let typing = null;
    let grading = null;                  // AbortController of the request in flight

    // ---- pieces
    const tag = h('div', { class: 'ex-tag', text: name });
    if (speaker?.color) tag.style.background = speaker.color;
    const question = renderInline(challenge.question || challenge.title || '…', h('div', { class: 'ex-q' }));
    const replyText = h('span', { class: 'ex-reply-text' });
    const meter = h('span', { class: 'ex-meter', 'aria-hidden': 'true' }, h('i'));
    const reply = h('div', { class: 'ex-reply', 'aria-live': 'polite' }, h('span', { class: 'ex-reply-mark' }), replyText, meter);
    reply.hidden = true;
    const dots = h('div', { class: 'ex-dots', role: 'status', 'aria-label': 'Thinking' }, h('i'), h('i'), h('i'));
    dots.hidden = true;

    const ta = h('textarea', { class: 'ex-ta', rows: '6', maxlength: String(MAX_CHARS), spellcheck: 'true', placeholder: '✎', 'aria-label': 'Your explanation' });
    ta.value = store.get(key) || '';

    const btn = (act, ico, tip, cls = '') => h('button', { class: `ex-key ${cls}`.trim(), type: 'button', 'data-act': act, title: tip, 'aria-label': tip }, icon(ico));
    const laterKey = btn('later', 'close', 'Later · Esc');
    const sendKey = btn('send', 'send', 'Send · Ctrl+Enter', 'go');
    const doneKey = btn('done', 'test', 'Continue', 'go');

    const bubble = h('div', { class: 'ex-bubble', role: 'dialog', 'aria-modal': 'true', 'aria-label': challenge.title || name },
      tag,
      question,
      reply,
      dots,
      h('div', { class: 'ex-answer' },
        h('div', { class: 'ex-card' }, ta),
        h('div', { class: 'ex-foot' }, h('span', { class: 'ex-keys' }, laterKey, sendKey, doneKey))));
    const overlay = h('div', { class: 'ex-overlay' }, bubble);

    // ---- state
    function setPhase(p) {
      phase = p;
      bubble.dataset.phase = p;
      sendKey.hidden = p === 'pass';
      sendKey.disabled = p === 'wait' || !ta.value.trim();
      sendKey.classList.toggle('is-waiting', p === 'wait');
      laterKey.hidden = p === 'pass';
      doneKey.hidden = p !== 'pass';
      ta.readOnly = p !== 'edit';
      dots.hidden = p !== 'wait';
    }

    async function say(text, mood, score) {
      typing?.cancel();
      reply.hidden = false;
      reply.dataset.mood = mood;
      reply.querySelector('.ex-reply-mark').textContent = mood === 'pass' ? '✓' : mood === 'fail' ? '✗' : '';
      const showMeter = mood === 'fail' && typeof score === 'number' && Number.isFinite(score) && score > 0;
      meter.hidden = !showMeter;
      if (showMeter) {
        meter.firstChild.style.width = `${Math.round(Math.max(0, Math.min(1, score)) * 100)}%`;
        meter.title = `${Math.round(score * 100)}%`;
      }
      let stop = false;
      typing = { cancel: () => { stop = true; } };
      const full = String(text);
      replyText.textContent = '';
      for (let i = 0; i < full.length && !stop; i += 2) {
        replyText.textContent = full.slice(0, i + 2);
        await wait(12);
      }
      replyText.textContent = '';
      renderInline(full, replyText);
    }

    const caretToEnd = () => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); };

    async function send() {
      if (phase !== 'edit' || closed) return;
      const answer = ta.value.trim();
      if (!answer) { ta.focus(); return; }
      store.set(key, ta.value);
      typing?.cancel();
      setPhase('wait');
      reply.hidden = true;
      reply.title = '';
      const ctrl = new AbortController();
      grading = ctrl;
      let res = null;
      let error = null;
      try {
        // signal: closing the bubble hangs up, so the server can drop the grading call
        res = await api.grade({ regionId, challengeId: id, answer: answer.slice(0, MAX_CHARS), signal: ctrl.signal });
      } catch (err) {
        error = err;
      }
      if (grading === ctrl) grading = null;
      if (closed) return;
      if (error || !res || typeof res.pass !== 'boolean') {
        console.warn('[explain] grading failed', error || res);
        setPhase('edit');
        const word = errorWord(error);
        say(word, 'error');
        reply.title = word === '…?' ? (error?.message || 'No answer') : '';
        caretToEnd();
        return;
      }
      lastFeedback = String(res.feedback || '');
      const shown = lastFeedback || (res.pass ? '✓' : '…');
      if (res.pass) {
        passed = true;
        store.del(key);
        setPhase('pass');
        bubble.classList.add('is-pass');
        say(shown, 'pass');
        doneKey.focus();
      } else {
        setPhase('edit');                  // the reply stays up as a hint; keep typing, ➤ sends again
        say(shown, 'fail', res.score);
        caretToEnd();
      }
    }

    function finish() {
      if (closed) return;
      closed = true;
      typing?.cancel();
      grading?.abort();
      grading = null;
      window.removeEventListener('keydown', onKey);
      if (!passed && ta.value.trim()) store.set(key, ta.value);
      else if (!passed) store.del(key);
      closeModal(overlay);
      overlay.classList.add('is-closing');
      setTimeout(() => overlay.remove(), 200);
      resolve({ pass: passed, feedback: lastFeedback });
    }

    // ---- wiring
    ta.addEventListener('input', () => { if (phase === 'edit') sendKey.disabled = !ta.value.trim(); });
    // Ctrl/Cmd+Enter: send, or continue once passed, wherever the focus is
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter' || e.isComposing || e.repeat || topModal() !== overlay) return;
      e.preventDefault();
      if (phase === 'pass') finish(); else send();
    };
    window.addEventListener('keydown', onKey);
    sendKey.addEventListener('click', send);
    laterKey.addEventListener('click', finish);
    doneKey.addEventListener('click', finish);
    reply.addEventListener('pointerdown', () => typing?.cancel());

    setPhase('edit');
    root.append(overlay);
    openModal(overlay, { onEscape: finish });
    requestAnimationFrame(caretToEnd);
  });
}

export default { open };
