// All sound is synthesized: surf, wind, birds, crickets, a steel-pan loop
// at the bar, and little UI cues. Nothing to download.

export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.muted = false;
  }

  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.underFilter = ctx.createBiquadFilter();
    this.underFilter.type = 'lowpass';
    this.underFilter.frequency.value = 20000;
    this.underFilter.connect(this.master);
    this.master.connect(ctx.destination);

    const noise = (seconds, brown) => {
      const len = ctx.sampleRate * seconds;
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        let last = 0;
        for (let i = 0; i < len; i++) {
          const w = Math.random() * 2 - 1;
          if (brown) {
            last = (last + 0.02 * w) / 1.02;
            d[i] = last * 3.5;
          } else d[i] = w;
        }
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      return src;
    };

    // Surf: brown noise, swelling on a slow cycle like breaking waves.
    const surf = noise(6, true);
    const surfF = ctx.createBiquadFilter();
    surfF.type = 'lowpass';
    surfF.frequency.value = 900;
    this.surfGain = ctx.createGain();
    this.surfGain.gain.value = 0;
    this.surfSwell = ctx.createGain();
    this.surfSwell.gain.value = 0.6;
    surf.connect(surfF).connect(this.surfSwell).connect(this.surfGain).connect(this.underFilter);
    surf.start();
    const hiss = noise(4, false);
    const hissF = ctx.createBiquadFilter();
    hissF.type = 'bandpass';
    hissF.frequency.value = 3000;
    hissF.Q.value = 0.6;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    hiss.connect(hissF).connect(this.hissGain).connect(this.underFilter);
    hiss.start();

    // Wind through palms.
    const wind = noise(5, false);
    const windF = ctx.createBiquadFilter();
    windF.type = 'bandpass';
    windF.frequency.value = 500;
    windF.Q.value = 0.4;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.02;
    wind.connect(windF).connect(this.windGain).connect(this.underFilter);
    wind.start();
    this.windF = windF;

    // Underwater rumble.
    const deep = noise(5, true);
    const deepF = ctx.createBiquadFilter();
    deepF.type = 'lowpass';
    deepF.frequency.value = 220;
    this.deepGain = ctx.createGain();
    this.deepGain.gain.value = 0;
    deep.connect(deepF).connect(this.deepGain).connect(this.master);
    deep.start();

    // Rain: bright noise, plus a duller drumming layer for roofs.
    const rain = noise(4, false);
    const rainHi = ctx.createBiquadFilter();
    rainHi.type = 'highpass';
    rainHi.frequency.value = 1400;
    const rainLo = ctx.createBiquadFilter();
    rainLo.type = 'lowpass';
    rainLo.frequency.value = 9000;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rain.connect(rainHi).connect(rainLo).connect(this.rainGain).connect(this.underFilter);
    rain.start();
    const roof = noise(3, true);
    const roofF = ctx.createBiquadFilter();
    roofF.type = 'bandpass';
    roofF.frequency.value = 700;
    roofF.Q.value = 0.8;
    this.roofGain = ctx.createGain();
    this.roofGain.gain.value = 0;
    roof.connect(roofF).connect(this.roofGain).connect(this.underFilter);
    roof.start();
    this.nextThunder = ctx.currentTime + 8;
    this.noiseBuf = noise;

    // Bar music bus.
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0;
    this.musicGain.connect(this.underFilter);
    this.nextNote = ctx.currentTime + 0.5;
    this.step = 0;

    this.nextBird = ctx.currentTime + 2;
    this.nextCricket = ctx.currentTime + 1;
    this.t0 = ctx.currentTime;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }
  toggleMute() {
    this.muted = !this.muted;
    this.setVolume(this.volume);
    return this.muted;
  }

  tone(freq, dur, { type = 'sine', vol = 0.2, attack = 0.005, dest, at, slide } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = at ?? ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest || this.underFilter);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  pan(freq, at) {
    // Steel pan: a fundamental plus slightly inharmonic partials.
    const d = this.musicGain;
    this.tone(freq, 0.9, { vol: 0.16, dest: d, at });
    this.tone(freq * 2.01, 0.5, { vol: 0.06, dest: d, at });
    this.tone(freq * 3.03, 0.25, { vol: 0.03, dest: d, at });
  }

  thunder() {
    const ctx = this.ctx;
    const src = this.noiseBuf(4, true);
    src.loop = false;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 160;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.7, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.001, t + 3.8);
    src.connect(f).connect(g).connect(this.underFilter);
    src.start(t);
    src.stop(t + 4);
  }

  update(dt, { shore, underwater, night, barDist, wind, hour, rain = 0, underRoof = false }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const k = Math.min(1, dt * 2);
    const swell = 0.45 + 0.55 * Math.max(0, Math.sin((now - this.t0) * 0.85)) ** 2;
    this.surfSwell.gain.value = swell;
    const nearSea = Math.max(0, 1 - shore / 70);
    this.surfGain.gain.value += ((underwater ? 0.05 : 0.18 + nearSea * 0.5) - this.surfGain.gain.value) * k;
    this.hissGain.gain.value += ((underwater ? 0 : nearSea * 0.05 * swell) - this.hissGain.gain.value) * k;
    this.windGain.gain.value += ((underwater ? 0 : 0.015 + wind * 0.035) - this.windGain.gain.value) * k;
    this.windF.frequency.value = 400 + Math.sin(now * 0.2) * 150;
    this.deepGain.gain.value += ((underwater ? 0.5 : 0) - this.deepGain.gain.value) * k;
    this.rainGain.gain.value += ((underwater ? 0 : rain * (underRoof ? 0.08 : 0.16)) - this.rainGain.gain.value) * k;
    this.roofGain.gain.value += ((underRoof && !underwater ? rain * 0.35 : 0) - this.roofGain.gain.value) * k;
    if (rain > 0.7 && now > this.nextThunder) {
      this.nextThunder = now + 14 + Math.random() * 20;
      this.thunder();
    }
    this.underFilter.frequency.value = underwater ? 600 : 20000;

    // Steel pan loop from The Salty Coconut.
    const open = hour >= 10 && hour < 24.5;
    const mv = open ? Math.max(0, 1 - barDist / 55) ** 1.5 * 0.9 : 0;
    this.musicGain.gain.value += (mv - this.musicGain.gain.value) * k;
    if (mv > 0.01) {
      const scale = [392, 440, 494, 587, 659, 784, 880];
      const tune = [0, 2, 4, 2, 3, 4, 5, 4, 2, -1, 1, 2, 4, 2, 1, 0];
      const bass = [196, 196, 147, 147, 165, 165, 147, 196];
      while (this.nextNote < now + 0.2) {
        const s = tune[this.step % tune.length];
        if (s >= 0) this.pan(scale[s], this.nextNote);
        if (this.step % 2 === 0) this.tone(bass[(this.step / 2) % bass.length], 0.35, { type: 'triangle', vol: 0.08, dest: this.musicGain, at: this.nextNote });
        this.nextNote += 0.28;
        this.step++;
      }
    } else {
      this.nextNote = now + 0.2;
    }

    // Birds by day, crickets by night.
    if (!underwater && !night && rain < 0.3 && now > this.nextBird) {
      this.nextBird = now + 2 + Math.random() * 6;
      const base = 1800 + Math.random() * 1600;
      const n = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) this.tone(base, 0.09, { vol: 0.025, at: now + i * 0.12, slide: base * (1.2 + Math.random() * 0.4) });
    }
    if (!underwater && night && now > this.nextCricket) {
      this.nextCricket = now + 0.6 + Math.random() * 1.2;
      for (let i = 0; i < 3; i++) this.tone(4300 + Math.random() * 200, 0.04, { type: 'square', vol: 0.006, at: now + i * 0.06 });
    }
  }

  blip(kind) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (kind === 'good') {
      this.tone(660, 0.18, { vol: 0.06, dest: this.master });
      this.tone(990, 0.22, { vol: 0.05, at: t + 0.08, dest: this.master });
    } else if (kind === 'memory') {
      [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.5, { vol: 0.06, at: t + i * 0.09, dest: this.master }));
    } else if (kind === 'talk') {
      this.tone(440, 0.08, { vol: 0.04, dest: this.master });
    } else if (kind === 'click') {
      this.tone(880, 0.05, { vol: 0.03, dest: this.master });
    } else if (kind === 'pour') {
      for (let i = 0; i < 6; i++) this.tone(300 + Math.random() * 400, 0.1, { vol: 0.02, at: t + i * 0.05, type: 'triangle', dest: this.master });
    } else if (kind === 'rustle') {
      for (let i = 0; i < 8; i++) this.tone(2000 + Math.random() * 3000, 0.05, { vol: 0.015, at: t + i * 0.04, type: 'sawtooth', dest: this.master });
    } else if (kind === 'hit') {
      this.tone(180, 0.15, { vol: 0.2, type: 'triangle', slide: 90, dest: this.master });
    } else if (kind === 'miss') {
      this.tone(300, 0.3, { vol: 0.06, type: 'sawtooth', slide: 120, dest: this.master });
    }
  }

  buzz() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) this.tone(170, 0.35, { type: 'sawtooth', vol: 0.06, at: t + i * 0.5, dest: this.master });
  }

  gull() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) this.tone(1500, 0.22, { type: 'sawtooth', vol: 0.05, at: t + i * 0.25, slide: 900 });
  }

  gong() {
    if (!this.ctx) return;
    [110, 164.8, 220.5, 296, 391].forEach((f, i) => this.tone(f, 5 - i * 0.6, { vol: 0.12 / (i + 1), attack: 0.01 }));
  }

  whistle() {
    if (!this.ctx) return;
    this.tone(2600, 0.6, { type: 'square', vol: 0.04, slide: 2400 });
  }
}
