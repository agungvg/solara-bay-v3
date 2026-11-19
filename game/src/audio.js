// Solara Bay — audio.js (v3 rewrite)
// WebAudio synthesis only — no audio files. init() must be called from a
// user gesture (the Play button); every other method is a safe no-op
// until then, and calls made early are remembered as intent and honoured
// once the context exists.
//
// Sounds: a low engine hum (saw + sub-oscillator through a lowpass, with
// filtered noise for exhaust texture), a two-tone siren driven by an LFO
// so the wail is smooth, a gunshot crack (noise burst + low thump), and
// short melodic blips for pickups and mission-complete jingles. All gains
// ramp with setTargetAtTime / exponential ramps so nothing clicks.

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let noiseBuf = null;

  // Engine chain: osc pair -> filter -> gain -> master.
  let eng = null; // { osc, sub, filter, gain, noise }

  // Siren chain: tone osc (frequency wobbled by an LFO) -> gain -> master.
  let sir = null; // { osc, lfo, gain }

  // Intent remembered before init(): engine/siren asked to turn on early.
  let wantEngine = false;
  let wantSiren = false;

  function sharedNoise(seconds) {
    if (noiseBuf && noiseBuf.duration >= seconds) return noiseBuf;
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    if (!noiseBuf || len > noiseBuf.length) noiseBuf = buf;
    return buf;
  }

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return true;
    }
    let AC = null;
    try {
      AC = window.AudioContext || window.webkitAudioContext;
    } catch (err) {
      AC = null; // no WebAudio in this environment
    }
    if (!AC) return false;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.6;
      master.connect(ctx.destination);
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      // Honour any engine/siren intent recorded before init().
      if (wantEngine) { wantEngine = false; engine(true); }
      if (wantSiren) { wantSiren = false; siren(true); }
      return true;
    } catch (err) {
      ctx = null;
      master = null;
      return false;
    }
  }

  function ready() {
    return !!ctx && !!master;
  }

  // Fade a gain to silence, then stop the given nodes a moment later so
  // the tail never clicks. Shared by every looping voice on shutdown.
  function fadeOutStop(gain, nodes, holdMs) {
    try { gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05); } catch (err) { /* ignore */ }
    setTimeout(() => {
      for (const n of nodes) {
        try { n.stop(); } catch (err) { /* already stopped */ }
      }
    }, holdMs || 250);
  }

  // ---------------------------------------------------------- engine hum
  function engine(on) {
    if (!ready()) { wantEngine = !!on; return; }
    try {
      if (on && !eng) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 55;

        const sub = ctx.createOscillator();
        sub.type = 'square';
        sub.frequency.value = 27.5;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 420;
        filter.Q.value = 0.8;

        const subGain = ctx.createGain();
        subGain.gain.value = 0.4;

        const gain = ctx.createGain();
        gain.gain.value = 0;

        osc.connect(filter);
        sub.connect(subGain);
        subGain.connect(filter);
        filter.connect(gain);
        gain.connect(master);
        osc.start();
        sub.start();

        // Looping filtered noise for exhaust texture.
        const src = ctx.createBufferSource();
        src.buffer = sharedNoise(1);
        src.loop = true;
        const nFilter = ctx.createBiquadFilter();
        nFilter.type = 'lowpass';
        nFilter.frequency.value = 240;
        const nGain = ctx.createGain();
        nGain.gain.value = 0.25;
        src.connect(nFilter);
        nFilter.connect(nGain);
        nGain.connect(gain);
        src.start();

        eng = { osc, sub, filter, gain, noise: src };
        gain.gain.setTargetAtTime(0.14, ctx.currentTime, 0.2);
      } else if (on && eng) {
        eng.gain.gain.setTargetAtTime(0.14, ctx.currentTime, 0.2);
      } else if (!on && eng) {
        eng.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      }
      wantEngine = !!on;
    } catch (err) { /* ignore */ }
  }

  // Tie engine pitch to speed (0..1) while driving.
  function engineSpeed(v) {
    if (!ready() || !eng || !wantEngine) return;
    try {
      const s = Math.max(0, Math.min(1, v));
      const t = ctx.currentTime;
      eng.osc.frequency.setTargetAtTime(55 + s * 110, t, 0.1);
      eng.sub.frequency.setTargetAtTime(27.5 + s * 55, t, 0.1);
      eng.filter.frequency.setTargetAtTime(420 + s * 900, t, 0.1);
    } catch (err) { /* ignore */ }
  }

  // ---------------------------------------------------------- police siren
  // A triangle tone whose frequency is wobbled by a slow sine LFO — a
  // smooth two-tone wail with no timer ticks and no stepping.
  function siren(on) {
    if (!ready()) { wantSiren = !!on; return; }
    try {
      if (on && !sir) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = 825; // centre of the wail

        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 1.3; // ~0.77 s per full wail cycle
        const lfoDepth = ctx.createGain();
        lfoDepth.gain.value = 125; // swings 700 <-> 950 Hz
        lfo.connect(lfoDepth);
        lfoDepth.connect(osc.frequency);

        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(master);
        osc.start();
        lfo.start();
        gain.gain.setTargetAtTime(0.05, ctx.currentTime, 0.1);
        sir = { osc, lfo, gain };
      } else if (!on && sir) {
        const old = sir;
        sir = null;
        fadeOutStop(old.gain, [old.osc, old.lfo], 250);
      }
      wantSiren = !!on;
    } catch (err) { /* ignore */ }
  }

  // ---------------------------------------------------------- one-shots
  function gunshot() {
    if (!ready()) return;
    try {
      const t = ctx.currentTime;
      // Crack: a short burst of high-passed noise.
      const src = ctx.createBufferSource();
      src.buffer = sharedNoise(0.12);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 900;
      const crack = ctx.createGain();
      crack.gain.setValueAtTime(0.5, t);
      crack.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      src.connect(hp);
      hp.connect(crack);
      crack.connect(master);
      src.start(t);
      src.stop(t + 0.14);
      // Thump: a sine that drops from 150 Hz to 45 Hz underneath.
      sweepTone(150, 45, t, 0.12, 'sine', 0.6);
    } catch (err) { /* ignore */ }
  }

  // One soft note with a pitch sweep: quick attack, exponential decay.
  function sweepTone(fromFreq, toFreq, at, dur, type, vol) {
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(fromFreq, at);
    osc.frequency.exponentialRampToValueAtTime(toFreq, at + dur * 0.85);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol || 0.25, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + dur);
    osc.connect(gain).connect(master);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  // One soft note: quick attack, exponential decay — no clicks.
  function noteTone(freq, at, dur, type, vol) {
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(vol || 0.25, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, at + dur);
    osc.connect(gain).connect(master);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  function arpeggio(notes, gap, dur, type, vol) {
    if (!ready()) return;
    try {
      const t = ctx.currentTime;
      notes.forEach((f, i) => noteTone(f, t + i * gap, dur, type, vol));
    } catch (err) { /* ignore */ }
  }

  function pickup() {
    arpeggio([660, 990], 0.09, 0.18, 'sine', 0.3);
  }

  function jingle() {
    // C5 E5 G5 C6 — mission complete.
    arpeggio([523.25, 659.25, 783.99, 1046.5], 0.13, 0.22, 'triangle', 0.28);
  }

  function setMuted(m) {
    muted = !!m;
    if (!ready()) return;
    try {
      const level = muted ? 0 : 0.6;
      master.gain.setTargetAtTime(level, ctx.currentTime, 0.05);
    } catch (err) { /* ignore */ }
  }

  const api = {
    init,
    engine,
    siren,
    gunshot,
    pickup,
    jingle,
    setMuted,
    // Extras for the integrator (not required by the spec):
    engineSpeed,
    get isMuted() {
      return muted;
    },
    get isReady() {
      return ready();
    },
  };
  return api;
}
