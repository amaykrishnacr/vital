// Shared helpers for every VITAL page.

async function api(path, opts = {}) {
  const init = { headers: { "Content-Type": "application/json" }, credentials: "same-origin" };
  if (opts.body !== undefined) { init.method = "POST"; init.body = JSON.stringify(opts.body); }
  if (opts.method) init.method = opts.method;
  const res = await fetch(path, init);
  if (res.status === 401) { location.href = "/login"; throw new Error("login required"); }
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok && data.ok !== true) throw new Error(data.error || ("HTTP " + res.status));
  return data;
}

function toast(text, err = false) {
  let box = document.getElementById("toast");
  if (!box) { box = document.createElement("div"); box.id = "toast"; document.body.appendChild(box); }
  const t = document.createElement("div");
  t.className = "toast" + (err ? " err" : "");
  t.textContent = text;
  box.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

const fmt = {
  n(v, d = 0) { return v === null || v === undefined || isNaN(v) ? "--" : Number(v).toFixed(d); },
  time(ts) { return ts ? new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--"; },
  dt(ts) { return ts ? new Date(ts * 1000).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "--"; },
  ago(ts) {
    if (!ts) return "never";
    const s = Date.now() / 1000 - ts;
    if (s < 60) return Math.round(s) + " s ago";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    const d = Math.round(s / 86400); return d + (d === 1 ? " day ago" : " days ago");
  },
  esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); },
};

// Scrolling patient-monitor trace. push() new samples; they are drawn at the
// device's sample rate so the line moves smoothly between network updates.
class Monitor {
  constructor(canvas, { color = "#2BE38A", seconds = 5, fs = 25, grid = 40, glow = true, invert = false } = {}) {
    this.c = canvas; this.ctx = canvas.getContext("2d");
    this.color = color; this.fs = fs; this.n = Math.round(seconds * fs);
    this.grid = grid; this.glow = glow; this.invert = invert;
    this.buf = []; this.queue = []; this.carry = 0; this.last = performance.now();
    this.lo = null; this.hi = null; this.running = false;
  }
  push(samples) {
    for (const v of samples) if (v !== null && v !== undefined) this.queue.push(this.invert ? -v : v);
    if (this.queue.length > this.fs * 3) this.queue.splice(0, this.queue.length - this.fs);   // catch up
  }
  clear() { this.buf = []; this.queue = []; this.lo = this.hi = null; }
  start() { if (!this.running) { this.running = true; requestAnimationFrame(t => this.frame(t)); } }
  frame(t) {
    const dt = (t - this.last) / 1000; this.last = t;
    let k = dt * this.fs + this.carry;
    const take = Math.floor(k); this.carry = k - take;
    for (let i = 0; i < take && this.queue.length; i++) this.buf.push(this.queue.shift());
    if (this.buf.length > this.n) this.buf.splice(0, this.buf.length - this.n);
    this.draw();
    requestAnimationFrame(tt => this.frame(tt));
  }
  draw() {
    const c = this.c, dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const x = this.ctx; x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
    if (this.grid) {
      x.strokeStyle = "#1A2740"; x.lineWidth = 1; x.beginPath();
      for (let gx = 0; gx <= w; gx += this.grid) { x.moveTo(gx + .5, 0); x.lineTo(gx + .5, h); }
      for (let gy = 0; gy <= h; gy += this.grid) { x.moveTo(0, gy + .5); x.lineTo(w, gy + .5); }
      x.stroke();
    }
    const b = this.buf; if (b.length < 2) return;
    let lo = Infinity, hi = -Infinity;
    for (const v of b) { if (v < lo) lo = v; if (v > hi) hi = v; }
    this.lo = this.lo === null ? lo : this.lo + (lo - this.lo) * .08;
    this.hi = this.hi === null ? hi : this.hi + (hi - this.hi) * .08;
    const span = Math.max(this.hi - this.lo, 1e-6), pad = h * .14;
    x.lineWidth = 2.6; x.lineJoin = "round"; x.strokeStyle = this.color;
    if (this.glow) { x.shadowColor = this.color; x.shadowBlur = 10; }
    x.beginPath();
    const step = w / (this.n - 1), off = this.n - b.length;
    b.forEach((v, i) => {
      const px = (i + off) * step, py = h - pad - (v - this.lo) / span * (h - 2 * pad);
      i ? x.lineTo(px, py) : x.moveTo(px, py);
    });
    x.stroke(); x.shadowBlur = 0;
    const lastY = h - pad - (b[b.length - 1] - this.lo) / span * (h - 2 * pad);
    x.fillStyle = this.color; x.beginPath(); x.arc(w - 3, lastY, 4, 0, 7); x.fill();
  }
}

// Feed new samples from a /api/live response into a Monitor, avoiding duplicates.
function feed(monitor, samples, state, key = "ir") {
  const fresh = samples.filter(s => s[0] > (state[key] ?? -1));
  if (fresh.length) state[key] = fresh[fresh.length - 1][0];
  monitor.push(fresh.map(s => s[1]));
}
