// Figure 1 of the IDF-B: VITAL staged architecture (light, document style)
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const W = 1700, H = 1450;
const F = "'DejaVu Sans', Arial, sans-serif";
const C = {
  blue: ['#EAF2F8', '#5B7FA6'], violet: ['#F0EDF7', '#7A6AA6'], green: ['#EDF5EE', '#5E8F66'],
  sand: ['#FAF4E6', '#A58A4E'], rose: ['#F8ECEE', '#A9606C'], grey: ['#F2F3F5', '#7C8592'],
};
const box = (x, y, w, h, col, title, lines) => {
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${C[col][0]}" stroke="${C[col][1]}" stroke-width="2.4"/>`;
  s += `<text x="${x + w / 2}" y="${y + 36}" font-family="${F}" font-size="27" font-weight="700" fill="#222" text-anchor="middle">${title}</text>`;
  lines.forEach((l, i) => { s += `<text x="${x + w / 2}" y="${y + 70 + i * 28}" font-family="${F}" font-size="20.5" fill="#333" text-anchor="middle">${l}</text>`; });
  return s;
};
const arrow = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#333" stroke-width="2.6" marker-end="url(#a)"/>`;

const cx = 850, bw = 760, bx = cx - bw / 2;
let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#333"/></marker></defs>
<rect width="${W}" height="${H}" fill="#FAFAFA"/>
<text x="${cx}" y="52" font-family="${F}" font-size="32" font-weight="700" fill="#222" text-anchor="middle">VITAL Staged Monitoring and Escalation Architecture</text>`;
const rows = [
  ['blue', 'Sensing Node (ESP32)', ['MAX30102 red/IR PPG · MLX90614 skin temperature', 'Shared I²C bus · 1 packet per second over Wi-Fi']],
  ['violet', 'Signal-Quality Gate', ['Perfusion index · waveform roughness · beat-to-beat jump', 'Quality q (0–100); readings with q &lt; 40 rejected']],
  ['green', 'Session Binding and Window Features', ['Accepted readings attributed to the logged-in user', '10-s window: HR mean / SD / range, SpO₂, body temp']],
  ['sand', 'Personal Anomaly Scoring', ['Robust per-vital baseline (median, MAD) → s_z', 'Isolation Forest on window features → s_IF']],
  ['sand', 'Steady-Trend Projection', ['Linear fit over 10 min; both halves must agree', '15-min projection → time-to-threshold t_cross']],
  ['rose', 'Severity Decision', ['Normal · Watch · Early warning · Critical', 'Sustained-limit rules + anomaly + projection']],
];
let y = 90;
const bh = 132, gap = 58;
rows.forEach(([col, t, l], i) => {
  s += box(bx, y, bw, bh, col, t, l);
  if (i < rows.length - 1) s += arrow(cx, y + bh, cx, y + bh + gap - 4);
  y += bh + gap;
});
// side box: baseline training loop
const sx = 70, sw = 310, sy = 90 + 3 * (bh + gap) - 6;
s += `<rect x="${sx}" y="${sy}" width="${sw}" height="${bh + 12}" rx="8" fill="#FFFFFF" stroke="#7C8592" stroke-width="2"/>
<text x="${sx + sw / 2}" y="${sy + 34}" font-family="${F}" font-size="21" font-weight="700" fill="#222" text-anchor="middle">Personal Model Store</text>
<text x="${sx + sw / 2}" y="${sy + 64}" font-family="${F}" font-size="17" fill="#444" text-anchor="middle">trained only on windows</text>
<text x="${sx + sw / 2}" y="${sy + 88}" font-family="${F}" font-size="17" fill="#444" text-anchor="middle">with quality q ≥ 60;</text>
<text x="${sx + sw / 2}" y="${sy + 112}" font-family="${F}" font-size="17" fill="#444" text-anchor="middle">retrained every 60 windows</text>`;
s += arrow(sx + sw, sy + 66, bx - 4, sy + 66);
s += `<path d="M ${bx} ${90 + 2 * (bh + gap) + bh / 2} H ${sx + sw / 2} V ${sy - 4}" fill="none" stroke="#7C8592" stroke-width="2.2" stroke-dasharray="9 7" marker-end="url(#a)"/>`;
// side box: calibration
const rx = 1320, rw = 310;
s += `<rect x="${rx}" y="${sy}" width="${rw}" height="${bh + 12}" rx="8" fill="#FFFFFF" stroke="#7C8592" stroke-width="2"/>
<text x="${rx + rw / 2}" y="${sy + 34}" font-family="${F}" font-size="21" font-weight="700" fill="#222" text-anchor="middle">Per-User Calibration</text>
<text x="${rx + rw / 2}" y="${sy + 64}" font-family="${F}" font-size="17" fill="#444" text-anchor="middle">skin-to-body offset δ_u</text>
<text x="${rx + rw / 2}" y="${sy + 88}" font-family="${F}" font-size="17" fill="#444" text-anchor="middle">from a reference</text>
<text x="${rx + rw / 2}" y="${sy + 112}" font-family="${F}" font-size="17" fill="#444" text-anchor="middle">thermometer reading</text>`;
s += arrow(rx, sy + 66, bx + bw + 4, sy + 66);
// escalation tiers
const tiers = [
  ['Local', 'OLED + user page', 'no data leaves'],
  ['Guardian', 'Telegram message', 'name + reason'],
  ['Supervisor', 'Admin station', 'red tile + log'],
  ['City', 'Ward summary (MQTT)', 'counts only, k ≥ 10'],
];
const tw = 360, tg = 30, tx0 = (W - (4 * tw + 3 * tg)) / 2;
s += `<text x="${cx}" y="${y + 6}" font-family="${F}" font-size="24" font-weight="700" fill="#222" text-anchor="middle">Severity-Tiered Escalation (disclosure grows only with severity)</text>`;
const ty = y + 30;
tiers.forEach(([t, a, b], i) => {
  const x = tx0 + i * (tw + tg);
  s += `<rect x="${x}" y="${ty}" width="${tw}" height="118" rx="8" fill="${C.green[0]}" stroke="${C.green[1]}" stroke-width="2.2"/>
  <text x="${x + tw / 2}" y="${ty + 36}" font-family="${F}" font-size="24" font-weight="700" fill="#222" text-anchor="middle">${t}</text>
  <text x="${x + tw / 2}" y="${ty + 70}" font-family="${F}" font-size="19" fill="#333" text-anchor="middle">${a}</text>
  <text x="${x + tw / 2}" y="${ty + 98}" font-family="${F}" font-size="18" fill="#555" text-anchor="middle">${b}</text>`;
});
s += `<text x="${cx}" y="${ty + 160}" font-family="${F}" font-size="18" fill="#555" text-anchor="middle">Identity and location reach 108 / hospital only for a critical alert, and only with prior user consent.</text>`;
s += `</svg>`;

(async () => {
  const out = path.join(__dirname, 'fig1_architecture.png');
  await sharp(Buffer.from(s)).resize(W, H).png().toFile(out);
  console.log(out, 'height used', ty + 180);
})();
