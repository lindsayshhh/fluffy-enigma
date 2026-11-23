const $ = (sel) => document.querySelector(sel);

function fmtTime(hour) {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour % 1) * 60);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

export class UI {
  constructor(audio) {
    this.audio = audio;
    this.toastsEl = $('#toasts');
    this.promptEl = $('#prompt');
    this.dlg = $('#dialogue');
    this.narr = $('#narration');
    this.mg = $('#minigame');
    this.modal = null;
    this._handler = null;
    this.handlerSince = 0;
    this.lastHud = 0;
    addEventListener('keydown', (e) => {
      // Ignore the very keypress that opened this panel.
      if (this._handler && e.timeStamp > this.handlerSince) this._handler(e);
    });
  }

  get typing() {
    return performance.now() < (this.speakUntil || 0);
  }

  get keyHandler() {
    return this._handler;
  }
  set keyHandler(fn) {
    this._handler = fn;
    this.handlerSince = performance.now();
  }

  // ------------------------------------------------------------ HUD
  hud(s, game, force) {
    const now = performance.now();
    if (!force && now - this.lastHud < 200) return;
    this.lastHud = now;
    $('#clock').textContent = fmtTime(s.hour);
    $('#day').textContent = `Day ${s.day} of 3`;
    for (const k of ['fun', 'relax', 'energy', 'sunburn']) {
      const el = document.querySelector(`.meter[data-k="${k}"]`);
      el.querySelector('i').style.width = `${s[k]}%`;
      el.querySelector('b').textContent = Math.round(s[k]);
      el.classList.toggle('warn', k === 'sunburn' ? s[k] > 60 : k !== 'fun' && k !== 'relax' ? s[k] < 18 : s[k] < 20);
    }
    $('#bliss').textContent = Math.round(s.bliss + s.memories.length * 12);
    $('#credits').textContent = `$${s.credits}`;
    const st = [];
    if (s.sunscreen > 0) st.push(`<span title="Sunscreen">🧴 ${s.sunscreen.toFixed(1)}h</span>`);
    if (s.items.phone) st.push('<span title="Your work phone. It buzzes.">📱</span>');
    if (s.items.snack) st.push('<span title="Churro to go">🥨 churro</span>');
    if (s.items.coconut) st.push('<span title="A coconut with history">🥥</span>');
    if (s.items.voucher) st.push('<span title="Snorkel voucher">🎟️</span>');
    if (s.items.sandal) st.push('<span title="A sandal with GARY written inside">🩴 sandal</span>');
    if (s.items.ring) st.push('<span title="A gold ring from Kevin\'s nest">💍 ring</span>');
    if (s.shells) st.push(`<span title="Pretty shells">🐚 ${s.shells}</span>`);
    $('#status').innerHTML = st.join('');
  }

  prompt(label, key = 'E') {
    if (label) {
      this.promptEl.innerHTML = `<kbd>${key}</kbd> ${esc(label)}`;
      this.promptEl.classList.add('show');
    } else this.promptEl.classList.remove('show');
  }

  toast(text, kind = 'neutral') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toastsEl.appendChild(el);
    while (this.toastsEl.children.length > 6) this.toastsEl.firstChild.remove();
    setTimeout(() => el.classList.add('out'), 3200);
    setTimeout(() => el.remove(), 3800);
  }

  memory(text) {
    const el = $('#memory');
    el.innerHTML = `<small>New memory</small>${esc(text)}`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.memT);
    this.memT = setTimeout(() => el.classList.remove('show'), 5200);
  }

  setUnderwater(v) {
    document.body.classList.toggle('underwater', v);
  }

  // ------------------------------------------------------------ dialogue
  dialogue(ch, text, choices, onChoose) {
    this.prompt(null);
    const d = this.dlg;
    d.style.setProperty('--accent', ch.color);
    d.querySelector('.who').textContent = ch.name;
    d.querySelector('.title').textContent = ch.title;
    const body = d.querySelector('.text');
    const list = d.querySelector('.choices');
    list.innerHTML = '';
    d.classList.add('show');
    let shown = 0;
    const full = text;
    clearInterval(this.typer);
    body.textContent = '';
    // Lips move for roughly as long as the line would take to say aloud.
    this.speakUntil = performance.now() + Math.min(9000, full.length * 55);
    const finish = () => {
      clearInterval(this.typer);
      body.textContent = full;
      shown = full.length;
      list.classList.add('ready');
    };
    list.classList.remove('ready');
    body.onclick = finish;
    this.typer = setInterval(() => {
      shown += 2;
      body.textContent = full.slice(0, shown);
      if (shown >= full.length) finish();
    }, 14);
    choices.forEach((c, i) => {
      const b = document.createElement('button');
      b.innerHTML = `<kbd>${i + 1}</kbd> ${esc(c)}`;
      b.onclick = () => {
        if (shown < full.length) return finish();
        this.audio.blip('click');
        onChoose(i);
      };
      list.appendChild(b);
    });
    this.keyHandler = (e) => {
      const n = parseInt(e.key, 10);
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (shown < full.length) finish();
        else if (choices.length === 1) {
          this.audio.blip('click');
          onChoose(0);
        }
      } else if (n >= 1 && n <= choices.length) {
        if (shown < full.length) return finish();
        this.audio.blip('click');
        onChoose(n - 1);
      }
    };
  }

  closeDialogue() {
    this.speakUntil = 0;
    clearInterval(this.typer);
    this.dlg.classList.remove('show');
    this.keyHandler = null;
  }

  // ------------------------------------------------------------ narration
  narrate(cards, done, timePasses) {
    this.prompt(null);
    const n = this.narr;
    let i = 0;
    const show = () => {
      n.querySelector('.card').textContent = cards[i];
      n.querySelector('.time').style.display = timePasses ? '' : 'none';
      n.querySelector('.next').textContent = i < cards.length - 1 ? 'Continue' : 'Done';
    };
    const next = () => {
      this.audio.blip('click');
      i++;
      if (i >= cards.length) {
        n.classList.remove('show');
        this.keyHandler = null;
        n.querySelector('.next').onclick = null;
        done();
      } else show();
    };
    show();
    n.classList.add('show');
    n.querySelector('.next').onclick = next;
    this.keyHandler = (e) => {
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE') {
        e.preventDefault();
        next();
      }
    };
  }

  // ------------------------------------------------------------ minigames
  volleyball(done) {
    const m = this.mg;
    m.className = 'show volley';
    m.innerHTML = `
      <h2>Beach Volleyball vs. Nana Pearl</h2>
      <p class="sub">Press <kbd>Space</kbd> (or click) when the ball is in the gold zone. Two clean hits in a rally wins the point. First to 3.</p>
      <div class="score"><span>You <b id="vy">0</b></span><span>Pearl <b id="vp">0</b></span></div>
      <div class="track"><div class="zone"></div><div class="ball"></div></div>
      <div class="call">Pearl serves...</div>`;
    const ball = m.querySelector('.ball');
    const zone = m.querySelector('.zone');
    const call = m.querySelector('.call');
    let you = 0;
    let her = 0;
    let hits = 0;
    let speed = 2.4;
    let w = 0.22;
    let phase = Math.random() * 6;
    let wait = 0;
    let idle = 0;
    let last = performance.now();
    let over = false;
    const pearlLines = ['Too slow, rookie!', 'My hip is titanium. What\'s your excuse?', 'Ha! Ricardo could do better and he\'s been dead since 1998.', "That's going on my fridge."];
    const yourLines = ['Nice!', 'Clean hit!', 'Pearl looks mildly impressed.', 'The crowd (Brenda) goes wild!'];
    const setZone = () => {
      zone.style.left = `${(0.5 - w / 2) * 100}%`;
      zone.style.width = `${w * 100}%`;
    };
    setZone();
    const press = () => {
      if (over || wait > 0) return;
      const x = (Math.sin(phase) + 1) / 2;
      idle = 0;
      if (Math.abs(x - 0.5) < w / 2) {
        hits++;
        this.audio.blip('hit');
        if (hits >= 2) {
          you++;
          hits = 0;
          call.textContent = `POINT! ${yourLines[(you + her) % yourLines.length]}`;
          speed += 0.45;
          w *= 0.88;
          wait = 1.1;
        } else {
          call.textContent = 'Good hit! Pearl digs it out... here it comes again!';
          speed += 0.25;
          wait = 0.5;
        }
      } else {
        miss();
      }
      setZone();
      update();
    };
    const miss = () => {
      her++;
      hits = 0;
      this.audio.blip('miss');
      call.textContent = `Pearl scores. "${pearlLines[her % pearlLines.length]}"`;
      speed = Math.max(2.4, speed - 0.2);
      wait = 1.1;
    };
    const update = () => {
      m.querySelector('#vy').textContent = you;
      m.querySelector('#vp').textContent = her;
      if (you >= 3 || her >= 3) {
        over = true;
        setTimeout(() => {
          m.className = '';
          this.keyHandler = null;
          m.onclick = null;
          done(you, her);
        }, 1200);
      }
    };
    m.onclick = press;
    this.keyHandler = (e) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        press();
      }
    };
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!over) {
        if (wait > 0) {
          wait -= dt;
          if (wait <= 0) call.textContent = hits ? 'Return it!' : 'Pearl serves...';
        } else {
          phase += dt * speed;
          idle += dt;
          if (idle > 3.2) {
            idle = 0;
            miss();
            update();
          }
        }
        const x = (Math.sin(phase) + 1) / 2;
        ball.style.left = `${x * 100}%`;
        requestAnimationFrame(loop);
      }
    };
    requestAnimationFrame(loop);
  }

  fishing(done) {
    const m = this.mg;
    m.className = 'show fish';
    m.innerHTML = `
      <h2>Fishing off the dock</h2>
      <p class="sub">Watch the bobber. When it dips, strike with <kbd>Space</kbd> (or click). Too early and you'll spook them.</p>
      <div class="pond"><div class="ripple"></div><div class="bobber"><i></i></div></div>
      <div class="casts"></div>
      <div class="call">Casting...</div>`;
    const bob = m.querySelector('.bobber');
    const ripple = m.querySelector('.ripple');
    const call = m.querySelector('.call');
    const castsEl = m.querySelector('.casts');
    const results = [];
    let state = 'wait';
    let timer = 1.6 + Math.random() * 3;
    let t = 0;
    let last = performance.now();
    let over = false;
    const showCasts = () => {
      const icon = { caught: '🐟', early: '💨', missed: '〰️' };
      castsEl.textContent = [0, 1, 2].map((i) => (results[i] ? icon[results[i]] : '·')).join('  ');
    };
    showCasts();
    const finishCast = (r, text) => {
      results.push(r);
      showCasts();
      call.textContent = text;
      state = 'pause';
      timer = 1.3;
      this.audio.blip(r === 'caught' ? 'good' : 'miss');
    };
    const strike = () => {
      if (over) return;
      if (state === 'wait') finishCast('early', 'Too early! The ripples settle. Nothing there.');
      else if (state === 'bite') finishCast('caught', 'Got something! Reeling it in...');
    };
    m.onclick = strike;
    this.keyHandler = (e) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        strike();
      }
    };
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      timer -= dt;
      let dip = 0;
      if (state === 'wait') {
        dip = Math.sin(t * 2.2) * 3 + (Math.random() < 0.02 ? 4 : 0); // idle bobbing and the odd nibble
        if (timer <= 0) {
          state = 'bite';
          timer = 0.85;
          call.textContent = 'BITE! Strike now!';
          this.audio.blip('hit');
        }
      } else if (state === 'bite') {
        dip = 22 + Math.sin(t * 30) * 4;
        if (timer <= 0) finishCast('missed', 'It got away.');
      } else if (state === 'pause' && timer <= 0) {
        if (results.length >= 3) {
          over = true;
          m.className = '';
          m.onclick = null;
          this.keyHandler = null;
          done(results);
          return;
        }
        state = 'wait';
        timer = 1.6 + Math.random() * 3;
        call.textContent = 'You cast again. The line settles...';
      }
      bob.style.transform = `translate(-50%, calc(-50% + ${dip}px))`;
      ripple.style.opacity = state === 'bite' ? 1 : 0.35;
      ripple.style.transform = `translate(-50%, -50%) scale(${1 + (state === 'bite' ? 0.6 + Math.sin(t * 20) * 0.2 : Math.sin(t * 2) * 0.1)})`;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  yoga(done) {
    const m = this.mg;
    m.className = 'show yoga';
    m.innerHTML = `
      <h2>Sunset Yoga with Marisol</h2>
      <p class="sub">Keep your balance centered. Use <kbd>A</kbd>/<kbd>D</kbd>, the arrow keys, or move the mouse.</p>
      <div class="pose"></div>
      <div class="track"><div class="zone"></div><div class="needle"></div></div>
      <div class="timer"><i></i></div>
      <div class="call"></div>`;
    const poses = [
      ['Downward Dez', '"Imagine you are a bartender who has seen everything."'],
      ['Reluctant Pelican', '"Lift one leg. Resent it a little. That\'s the pose."'],
      ['Tax Season Release', '"Exhale every spreadsheet you have ever opened."'],
    ];
    const needle = m.querySelector('.needle');
    const poseEl = m.querySelector('.pose');
    const call = m.querySelector('.call');
    const bar = m.querySelector('.timer i');
    let p = 0;
    let x = 0;
    let v = 0;
    let t = 0;
    let good = 0;
    let total = 0;
    let push = 0;
    const keys = new Set();
    let last = performance.now();
    const POSE_T = 8;
    const show = () => {
      poseEl.innerHTML = `<b>${poses[p][0]}</b><span>${poses[p][1]}</span>`;
    };
    show();
    const onMove = (e) => {
      push += e.movementX * 0.004;
    };
    document.addEventListener('mousemove', onMove);
    this.keyHandler = (e) => keys.add(e.code);
    const up = (e) => keys.delete(e.code);
    addEventListener('keyup', up);
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      const diff = 0.9 + p * 0.55;
      v += (Math.sin(t * 1.7 + p) * 0.6 + Math.sin(t * 3.1) * 0.4 + (Math.random() - 0.5) * 2) * diff * dt;
      v += x * 0.9 * dt * diff; // instability: lean begets lean
      const input = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      v -= input * 2.4 * dt;
      v -= push;
      push = 0;
      v *= 0.96;
      x = Math.max(-1, Math.min(1, x + v * dt * 1.6));
      if (Math.abs(x) >= 1) v *= -0.3;
      total += dt;
      if (Math.abs(x) < 0.25) good += dt;
      needle.style.left = `${(x + 1) * 50}%`;
      needle.classList.toggle('off', Math.abs(x) >= 0.25);
      call.textContent = Math.abs(x) < 0.25 ? 'Balanced. Breathe.' : Math.abs(x) < 0.6 ? 'Wobbling...' : 'Dancing with gravity!';
      bar.style.width = `${(t / POSE_T) * 100}%`;
      if (t >= POSE_T) {
        t = 0;
        p++;
        x *= 0.3;
        v = 0;
        if (p >= poses.length) {
          document.removeEventListener('mousemove', onMove);
          removeEventListener('keyup', up);
          m.className = '';
          this.keyHandler = null;
          done(good / total);
          return;
        }
        show();
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------ panels
  openPanel(id, html, onClose) {
    const el = $(id);
    if (html !== undefined) el.querySelector('.body').innerHTML = html;
    el.classList.add('show');
    const close = () => {
      el.classList.remove('show');
      this.keyHandler = null;
      if (onClose) onClose();
    };
    el.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close));
    this.keyHandler = (e) => {
      if (e.code === 'KeyJ' || e.code === 'Escape' || e.code === 'Enter') {
        e.preventDefault();
        close();
      }
    };
    return close;
  }

  journal(entries, s, onClose) {
    const quests = entries.length
      ? entries.map((e) => `<li class="${e.done ? 'done' : ''}">${esc(e.text)}</li>`).join('')
      : '<li>Nothing yet. Go talk to people. Everyone here has a story, and most of them are a little ridiculous.</li>';
    const mems = s.memories.length ? s.memories.map((m) => `<li><em>Day ${m.day}</em> ${esc(m.text)}</li>`).join('') : '<li>No memories yet. Make some.</li>';
    this.openPanel('#journal', `<h3>Things to look into</h3><ul class="quests">${quests}</ul><h3>Memories (${s.memories.length})</h3><ul class="mems">${mems}</ul>`, onClose);
  }

  postcard(sum, last, onNext) {
    const lines = {
      bed: 'You fell asleep to the sound of the sea under the floorboards.',
      tired: 'You ran out of energy and fell asleep exactly where you stood. Classic.',
      late: 'You fell asleep on the sand under the stars. Technically very romantic.',
    };
    const mems = sum.memories.length ? sum.memories.map((m) => `<li>${esc(m.text)}</li>`).join('') : '<li>A quiet day. Those count too.</li>';
    $('#postcard .body').innerHTML = `
      <div class="pc">
        <div class="pc-left">
          <div class="stamp">🌴</div>
          <h2>Greetings from<br><span>Palmera Cay</span></h2>
          <p class="pc-day">Day ${sum.day}</p>
        </div>
        <div class="pc-right">
          <p class="hand">${esc(lines[sum.reason] || lines.bed)}</p>
          <ul>${mems}</ul>
          <p class="pc-stat">Bliss today: <b>${Math.round(sum.bliss)}</b></p>
        </div>
      </div>`;
    const el = $('#postcard');
    el.querySelector('.go').textContent = last ? 'Pack your bags →' : `Wake up on Day ${sum.day + 1} →`;
    el.classList.add('show');
    const go = () => {
      el.classList.remove('show');
      this.keyHandler = null;
      onNext();
    };
    el.querySelector('.go').onclick = go;
    this.keyHandler = (e) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        go();
      }
    };
  }

  finale(r) {
    const mems = r.memories.length ? r.memories.map((m) => `<li><em>Day ${m.day}</em> ${esc(m.text)}</li>`).join('') : '<li>You did... nothing memorable. Bold.</li>';
    $('#finale .body').innerHTML = `
      <p class="kicker">Your vacation rating</p>
      <div class="big">${r.score}</div>
      <h2>${esc(r.title)}</h2>
      <p class="stats">${r.bliss} bliss · ${r.memories.length} memories · ${r.shells} shells · $${r.credits} left · phone: ${r.phone ? 'still has 212 unread emails' : 'gone, and good riddance'}</p>
      <ul class="mems">${mems}</ul>`;
    document.body.classList.add('ui-free');
    $('#finale').classList.add('show');
    $('#finale .again').onclick = () => location.reload();
  }
}
