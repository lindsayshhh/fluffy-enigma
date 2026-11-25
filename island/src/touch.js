// On-screen controls for phones and tablets: a floating joystick on the left,
// drag-to-look on the right, and buttons for the actions keys normally do.
export const isTouchDevice = () =>
  (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;

export class TouchControls {
  // actions: { interact, journal, pause, camera } callbacks from main.js
  constructor(player, actions) {
    this.player = player;
    this.actions = actions;
    this.move = { x: 0, y: 0 };
    this.joyId = null;
    this.lookId = null;
    this.lookLast = null;

    const root = document.createElement('div');
    root.id = 'touch';
    root.className = 'hidden'; // shown once play starts
    root.innerHTML = `
      <div class="joy"><div class="knob"></div></div>
      <button class="tb act" aria-label="Interact"><span></span></button>
      <button class="tb jump" aria-label="Jump">Jump</button>
      <button class="tb dive" aria-label="Dive">Dive</button>
      <button class="tb small cam" aria-label="Camera">Camera</button>
      <button class="tb small journal" aria-label="Journal">Journal</button>
      <button class="tb small pause" aria-label="Pause">II</button>`;
    document.body.appendChild(root);
    this.root = root;
    this.joy = root.querySelector('.joy');
    this.knob = root.querySelector('.knob');
    this.actBtn = root.querySelector('.act');
    this.diveBtn = root.querySelector('.dive');

    const press = (sel, fn) => {
      const b = root.querySelector(sel);
      b.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn(true);
      }, { passive: false });
      b.addEventListener('touchend', (e) => {
        e.preventDefault();
        fn(false);
      }, { passive: false });
    };
    press('.act', (down) => down && actions.interact());
    press('.jump', (down) => (player.touchJump = down));
    press('.dive', (down) => (player.touchDive = down));
    press('.journal', (down) => down && actions.journal());
    press('.cam', (down) => down && actions.camera && actions.camera());
    press('.pause', (down) => down && actions.pause());

    const canvas = document.getElementById('c');
    canvas.addEventListener('touchstart', (e) => this.start(e), { passive: false });
    canvas.addEventListener('touchmove', (e) => this.moveTouch(e), { passive: false });
    canvas.addEventListener('touchend', (e) => this.end(e), { passive: false });
    canvas.addEventListener('touchcancel', (e) => this.end(e), { passive: false });
  }

  start(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth * 0.45 && this.joyId === null) {
        this.joyId = t.identifier;
        this.joyOrigin = { x: t.clientX, y: t.clientY };
        this.joy.style.left = `${t.clientX}px`;
        this.joy.style.top = `${t.clientY}px`;
        this.joy.classList.add('on');
        this.setKnob(0, 0);
      } else if (this.lookId === null) {
        this.lookId = t.identifier;
        this.lookLast = { x: t.clientX, y: t.clientY };
      }
    }
  }

  moveTouch(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === this.joyId) {
        const R = 55;
        let dx = (t.clientX - this.joyOrigin.x) / R;
        let dy = (t.clientY - this.joyOrigin.y) / R;
        const len = Math.hypot(dx, dy);
        if (len > 1) {
          dx /= len;
          dy /= len;
        }
        this.move.x = dx;
        this.move.y = dy;
        this.setKnob(dx * R, dy * R);
      } else if (t.identifier === this.lookId) {
        const p = this.player;
        if (p.enabled) {
          p.yaw -= (t.clientX - this.lookLast.x) * 0.006;
          p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch - (t.clientY - this.lookLast.y) * 0.006));
        }
        this.lookLast = { x: t.clientX, y: t.clientY };
      }
    }
    this.player.touchMove = this.move;
  }

  end(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === this.joyId) {
        this.joyId = null;
        this.move.x = 0;
        this.move.y = 0;
        this.joy.classList.remove('on');
      } else if (t.identifier === this.lookId) {
        this.lookId = null;
      }
    }
    this.player.touchMove = this.move;
  }

  setKnob(x, y) {
    this.knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  }

  // Called every frame: show the action button only when there's something
  // to do, and the dive button only while swimming.
  update(label, playing) {
    this.root.classList.toggle('hidden', !playing);
    const span = this.actBtn.querySelector('span');
    if (label) {
      if (span.textContent !== label) span.textContent = label;
      this.actBtn.classList.add('show');
    } else this.actBtn.classList.remove('show');
    this.diveBtn.classList.toggle('show', !!this.player.swimming);
  }
}
