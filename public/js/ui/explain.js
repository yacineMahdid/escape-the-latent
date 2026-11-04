// Explain-it conversation (owner: terminal).
//
//   open({ challenge, regionId, speaker: { name, color? } }) -> Promise<{ pass: boolean, feedback: string }>
//
// A speech bubble: the speaker's name tag and question, a roomy answer card ("Explain it in your own
// words…"), and worded keys: Later (close, the draft is kept) and ➤ Send (to api.grade). While it is
// graded: "Thinking…". Pass -> "✓ Passed!" + the villager's reply, and ✓ Continue. Not yet -> "✗ Not
// yet" + the reply, which stays above the card while you rewrite; Send sends again. Grading trouble:
// "Couldn't check it (busy). Send again." (the server's own word, when it gave one). feedback is ''
// when nothing was graded (the player backed out first). Drafts live in localStorage
// `etl-explain-<regionId>-<challengeId>` until the answer passes. Explain-kind fundamentals call this
// too, with challenge = { id, type: 'explain', title, question, rubric, offline }.
import { openModal, closeModal, topModal } from './modal.js';
import { api } from '../api.js';
import { h, icon, store, ensureCss, renderInline } from './terminal.js';

const MAX_CHARS = 6000;                 // the server's limit
const draftKey = (regionId, id) => `etl-explain-${regionId}-${id}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// the server's error bodies are a word or two ("… busy", "✕ too slow"): keep the words, drop the mark
const errorWord = (err) => {
  const said = err?.body?.error;
  const word = typeof said === 'string' ? said.replace(/^[^\p{L}\p{N}]+/u, '').trim() : '';
  return word && word.length <= 40 ? word : '';
};
const VERDICT = { pass: '✓ Passed!', fail: '✗ Not yet' };

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
    // the verdict ("✓ Passed!", "✗ Not yet"), then the villager's reply in their own words
    const verdict = h('b', { class: 'ex-verdict' });
    const replyText = h('span', { class: 'ex-reply-text' });
    const meter = h('span', { class: 'ex-meter', 'aria-hidden': 'true' }, h('i'));
    const reply = h('div', { class: 'ex-reply', 'aria-live': 'polite' }, verdict, replyText, meter);
    reply.hidden = true;
    const dots = h('div', { class: 'ex-dots', role: 'status' }, h('i'), h('i'), h('i'), h('span', { class: 'ex-dots-txt', text: 'Thinking…' }));
    dots.hidden = true;

    const ta = h('textarea', { class: 'ex-ta', rows: '6', maxlength: String(MAX_CHARS), spellcheck: 'true', placeholder: 'Explain it in your own words…', 'aria-label': 'Your explanation' });
    ta.value = store.get(key) || '';

    const btn = (act, ico, words, tip, cls = '') => h('button', { class: `ex-key ${ico ? 'has-ico' : ''} ${cls}`.replace(/\s+/g, ' ').trim(), type: 'button', 'data-act': act, title: tip },
      ico ? icon(ico) : null, h('span', { class: 'ex-key-txt', text: words }));
    const laterKey = btn('later', null, 'Later', 'Esc · your answer is kept');
    const sendKey = btn('send', 'send', 'Send', 'Ctrl+Enter', 'go');
    const doneKey = btn('done', 'test', 'Continue', 'Ctrl+Enter', 'go');

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
      verdict.textContent = VERDICT[mood] || '';
      const showMeter = mood === 'fail' && typeof score === 'number' && Number.isFinite(score) && score > 0;
      meter.hidden = !showMeter;
      if (showMeter) {
        meter.firstChild.style.width = `${Math.round(Math.max(0, Math.min(1, score)) * 100)}%`;
        meter.title = `Score ${Math.round(score * 100)}%`;
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
        say(`Couldn't check it${word ? ` (${word})` : ''}. Send again.`, 'error');
        reply.title = word ? '' : (error?.message || 'No answer');
        caretToEnd();
        return;
      }
      lastFeedback = String(res.feedback || '');
      const shown = lastFeedback || (res.pass ? '' : 'Try again.');
      if (res.pass) {
        passed = true;
        store.del(key);
        setPhase('pass');
        bubble.classList.add('is-pass');
        say(shown, 'pass');
        doneKey.focus();
      } else {
        setPhase('edit');                  // the reply stays up as a hint; keep typing, Send sends again
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
