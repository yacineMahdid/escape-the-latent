// Tiny synthesized sound effects (no audio files). sfx('paper' | 'pin' | 'ding' | 'buzz' | 'stamp' | 'pop' | 'tick').
let ctx = null;
let muted = false;
try { muted = localStorage.getItem('etl-muted') === '1'; } catch { /* storage blocked */ }

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(a, { type = 'sine', f0, f1 = f0, t = 0.2, vol = 0.2, delay = 0 }) {
  const o = a.createOscillator(); const g = a.createGain();
  const t0 = a.currentTime + delay;
  o.type = type; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + t);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + t);
  o.connect(g).connect(a.destination); o.start(t0); o.stop(t0 + t + 0.02);
}

function noise(a, { t = 0.12, vol = 0.18, freq = 2400, q = 0.8, delay = 0 }) {
  const n = Math.floor(a.sampleRate * t);
  const buf = a.createBuffer(1, n, a.sampleRate); const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = a.createGain(); g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination); src.start(a.currentTime + delay);
}

const SOUNDS = {
  paper: (a) => noise(a, { t: 0.1, vol: 0.14, freq: 3200 }),
  pin: (a) => { tone(a, { type: 'triangle', f0: 1400, f1: 900, t: 0.06, vol: 0.12 }); },
  tick: (a) => tone(a, { type: 'square', f0: 1800, f1: 1700, t: 0.025, vol: 0.05 }),
  pop: (a) => tone(a, { type: 'sine', f0: 500, f1: 900, t: 0.09, vol: 0.16 }),
  stamp: (a) => { noise(a, { t: 0.08, vol: 0.25, freq: 300, q: 0.6 }); tone(a, { type: 'sine', f0: 140, f1: 70, t: 0.14, vol: 0.25 }); },
  buzz: (a) => { tone(a, { type: 'square', f0: 160, f1: 120, t: 0.22, vol: 0.06 }); },
  ding: (a) => { tone(a, { f0: 1320, t: 0.9, vol: 0.16 }); tone(a, { f0: 1980, t: 0.6, vol: 0.06, delay: 0.01 }); },
  win: (a) => { [784, 988, 1175, 1568].forEach((f, i) => tone(a, { type: 'triangle', f0: f, t: 0.28, vol: 0.12, delay: i * 0.09 })); },
};

export function sfx(name) {
  if (muted) return;
  const play = SOUNDS[name]; if (!play) return;
  try { const a = ac(); if (a) play(a); } catch { /* audio unavailable */ }
}

export function setMuted(v) { muted = !!v; try { localStorage.setItem('etl-muted', muted ? '1' : '0'); } catch { /* ignore */ } }
export const isMuted = () => muted;
