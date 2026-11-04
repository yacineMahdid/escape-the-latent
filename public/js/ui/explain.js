// Explain-it conversation (owner: terminal).
//
//   open({ challenge, regionId, speaker: { name, color? } }) -> Promise<{ pass: boolean, feedback: string }>
//
// A speech bubble: the speaker's name tag and question, a roomy answer card with a tiny word count,
// ➤ to send it to api.grade. Pass -> ✓ continue. Not yet -> the villager's reply, then ↺ retry or
// ✕ later. Offline grading shows a tiny ⦸; network trouble shows "…?". Explain-kind fundamentals
// call this too, with challenge = { id, type: 'explain', title, question, rubric, offline }.
import { openModal, closeModal, topModal } from './modal.js';
import { api } from '../api.js';
import { h, icon, store, ensureCss, renderInline } from './terminal.js';

const MAX_CHARS = 6000;                 // the server's limit
const draftKey = (regionId, id) => `etl-explain-${regionId}-${id}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const words = (s) => (String(s).match(/\S+/g) || []).length;
// the offline grader appends "(You touched on 1 of 2 key ideas.)"; the meter shows that instead
const OFFLINE_TALLY = /\s*\(You touched on \d+ of \d+ key ideas?\.\)\s*$/i;

let statusP = null;
const serverStatus = () => (statusP ??= api.status().catch(() => { statusP = null; return null; }));

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
    let phase = 'edit';                  // edit | wait | pass | fail
    let typing = null;

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
    const count = h('span', { class: 'ex-count', title: 'Words' });
    const offline = h('span', { class: 'ex-off', title: 'Offline: graded by keywords' }, icon('offline'));
    offline.hidden = true;

    const btn = (act, ico, tip, cls = '') => h('button', { class: `ex-key ${cls}`.trim(), type: 'button', 'data-act': act, title: tip, 'aria-label': tip }, icon(ico));
    const laterKey = btn('later', 'close', 'Later · Esc');
    const sendKey = btn('send', 'send', 'Send · Ctrl+Enter', 'go');
    const retryKey = btn('retry', 'reset', 'Try again');
    const doneKey = btn('done', 'test', 'Continue', 'go');

    const bubble = h('div', { class: 'ex-bubble', role: 'dialog', 'aria-modal': 'true', 'aria-label': challenge.title || name },
      tag,
      question,
      reply,
      dots,
      h('div', { class: 'ex-card' }, ta),
      h('div', { class: 'ex-foot' }, h('span', { class: 'ex-meta' }, icon('pen', 'etl-ico ex-pen'), count, offline), h('span', { class: 'ex-keys' }, laterKey, retryKey, sendKey, doneKey)));
    const overlay = h('div', { class: 'ex-overlay' }, bubble);

    // ---- state
    function setPhase(p) {
      phase = p;
      bubble.dataset.phase = p;
      sendKey.hidden = !(p === 'edit' || p === 'wait');
      sendKey.disabled = p === 'wait' || !ta.value.trim();
      sendKey.classList.toggle('is-waiting', p === 'wait');
      laterKey.hidden = p === 'pass';
      retryKey.hidden = p !== 'fail';
      doneKey.hidden = p !== 'pass';
      ta.readOnly = p === 'wait' || p === 'pass';
      dots.hidden = p !== 'wait';
    }

    function updateCount() {
      const n = words(ta.value);
      count.textContent = String(n);
      count.title = `${n} word${n === 1 ? '' : 's'}`;
      if (phase === 'edit') sendKey.disabled = !ta.value.trim();
    }

    async function say(text, mood, score) {
      typing?.cancel();
      reply.hidden = false;
      reply.dataset.mood = mood;
      reply.querySelector('.ex-reply-mark').textContent = mood === 'pass' ? '✓' : mood === 'fail' ? '✗' : '';
      const showMeter = typeof score === 'number' && Number.isFinite(score) && score > 0 && mood !== 'error';
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

    async function send() {
      if (phase !== 'edit' || closed) return;
      const answer = ta.value.trim();
      if (!answer) { ta.focus(); return; }
      store.set(key, ta.value);
      setPhase('wait');
      reply.hidden = true;
      let res = null;
      let error = null;
      try {
        res = await api.grade({ regionId, challengeId: id, answer: answer.slice(0, MAX_CHARS) });
      } catch (err) {
        error = err;
      }
      if (closed) return;
      if (error || !res || typeof res.pass !== 'boolean') {
        console.warn('[explain] grading failed', error || res);
        setPhase('edit');
        await say('…?', 'error');
        reply.title = error?.message || 'No answer';
        ta.focus();
        return;
      }
      reply.title = '';
      if (res.offline) offline.hidden = false;
      lastFeedback = String(res.feedback || '');
      const shown = lastFeedback.replace(OFFLINE_TALLY, '') || (res.pass ? '✓' : '…');
      if (res.pass) {
        passed = true;
        store.del(key);
        setPhase('pass');
        bubble.classList.add('is-pass');
        say(shown, 'pass', res.score);
        doneKey.focus();
      } else {
        setPhase('fail');
        say(shown, 'fail', res.score);
        retryKey.focus();
      }
    }

    function retry() {
      if (phase !== 'fail') return;
      setPhase('edit');
      updateCount();
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }

    function finish() {
      if (closed) return;
      closed = true;
      typing?.cancel();
      window.removeEventListener('keydown', onKey);
      if (!passed) store.set(key, ta.value);
      closeModal(overlay);
      overlay.classList.add('is-closing');
      setTimeout(() => overlay.remove(), 200);
      resolve({ pass: passed, feedback: lastFeedback });
    }

    // ---- wiring
    ta.addEventListener('input', () => {
      updateCount();
      if (phase === 'fail') { setPhase('edit'); updateCount(); }   // typing again is a retry
    });
    // Ctrl/Cmd+Enter: send, or continue / try again, wherever the focus is
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter' || e.isComposing || e.repeat || topModal() !== overlay) return;
      e.preventDefault();
      if (phase === 'pass') finish(); else if (phase === 'fail') retry(); else send();
    };
    window.addEventListener('keydown', onKey);
    sendKey.addEventListener('click', send);
    retryKey.addEventListener('click', retry);
    laterKey.addEventListener('click', finish);
    doneKey.addEventListener('click', finish);
    reply.addEventListener('pointerdown', () => typing?.cancel());

    setPhase('edit');
    updateCount();
    root.append(overlay);
    openModal(overlay, { onEscape: finish });
    serverStatus().then((s) => { if (s && s.ai === false && !closed) offline.hidden = false; });
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
  });
}

export default { open };
