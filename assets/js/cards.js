// Card engine: invitations, thank-you notes and M-Pesa transaction acknowledgements.
// Renders to a high-resolution canvas (A-series ratio 1:√2), then exports print-ready PDFs (A4 / A5).
// Requires jsPDF UMD (window.jspdf) for PDF export.

const W = 1748, H = 2480; // ≈ A5 @ 300dpi / A4 @ 212dpi
export const TEMPLATES = {
  noir:     { bg: '#0B0B0B', ink: '#FFFCEF', accent: '#9E1B32', soft: 'rgba(255,252,239,.55)', frame: '#6D011A', label: 'Noir' },
  ivory:    { bg: '#FFFCEF', ink: '#3A0010', accent: '#7F0020', soft: 'rgba(58,0,16,.6)',     frame: '#7F0020', label: 'Ivory' },
  burgundy: { bg: '#6D011A', ink: '#FFFCEF', accent: '#FFFCEF', soft: 'rgba(255,252,239,.7)', frame: '#FFFCEF', label: 'Burgundy' },
};

const imgCache = new Map();
export function loadImg(src) {
  if (!src) return Promise.resolve(null);
  if (imgCache.has(src)) return imgCache.get(src);
  const p = new Promise((res) => {
    const i = new Image();
    if (!src.startsWith('data:')) i.crossOrigin = 'anonymous';
    i.onload = () => res(i); i.onerror = () => res(null); i.src = src;
  });
  imgCache.set(src, p); return p;
}

async function fontsReady() {
  try {
    await Promise.all([
      document.fonts.load('300 80px Quicksand'), document.fonts.load('500 40px Quicksand'),
      document.fonts.load('700 40px Quicksand'), document.fonts.load('120px "Great Vibes"'),
    ]);
  } catch { /* fallback fonts are fine */ }
}

function cover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const iw = img.width * s, ih = img.height * s;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

function wrap(ctx, text, x, y, maxW, lh, align = 'center', maxLines = 8) {
  ctx.textAlign = align;
  const words = String(text || '').split(/\s+/);
  let line = '', lines = [];
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] += '…'; }
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
  return y + lines.length * lh;
}

function spaced(ctx, text, x, y, spacing) {
  // letter-spaced centered text (canvas letterSpacing isn't universal yet)
  const chars = [...String(text)];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let cx = x - total / 2; ctx.textAlign = 'left';
  chars.forEach((c, i) => { ctx.fillText(c, cx, y); cx += widths[i] + spacing; });
}

function frame(ctx, t) {
  ctx.strokeStyle = t.frame; ctx.lineWidth = 4;
  ctx.strokeRect(70, 70, W - 140, H - 140);
  ctx.lineWidth = 1.5; ctx.globalAlpha = 0.6;
  ctx.strokeRect(96, 96, W - 192, H - 192);
  ctx.globalAlpha = 1;
  // corner flourishes
  ctx.fillStyle = t.frame;
  for (const [x, y] of [[96, 96], [W - 96, 96], [96, H - 96], [W - 96, H - 96]]) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-12, -12, 24, 24); ctx.restore();
  }
}

function monogram(ctx, t, x, y, r, letters = 'TNC') {
  ctx.save();
  ctx.strokeStyle = t.accent; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r - 10, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = t.ink; ctx.font = `500 ${r * 0.62}px Quicksand`; ctx.textBaseline = 'middle';
  spaced(ctx, letters, x, y + 2, r * 0.08);
  ctx.restore(); ctx.textBaseline = 'alphabetic';
}

function divider(ctx, t, y, w = 360) {
  ctx.strokeStyle = t.accent; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(W / 2 - w / 2, y); ctx.lineTo(W / 2 - 22, y); ctx.moveTo(W / 2 + 22, y); ctx.lineTo(W / 2 + w / 2, y); ctx.stroke();
  ctx.fillStyle = t.accent; ctx.save(); ctx.translate(W / 2, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-8, -8, 16, 16); ctx.restore();
}

function grain(ctx, alpha = 0.05) {
  const g = ctx.createImageData(256, 256);
  for (let i = 0; i < g.data.length; i += 4) { const v = Math.random() * 255; g.data[i] = g.data[i + 1] = g.data[i + 2] = v; g.data[i + 3] = 255 * alpha; }
  const c = document.createElement('canvas'); c.width = c.height = 256; c.getContext('2d').putImageData(g, 0, 0);
  ctx.save(); ctx.fillStyle = ctx.createPattern(c, 'repeat'); ctx.fillRect(0, 0, W, H); ctx.restore();
}

function fmtEventDate(iso) {
  const d = new Date(iso); if (isNaN(d)) return iso || '';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
}
function fmtTime(iso) { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase(); }


// ---------------- WAX SEAL: engraved monogram, names around the rim ----------------
export function drawSeal(ctx, x, y, r, { letter = 'M', rim = '' } = {}) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(-0.18);
  // irregular wax edge
  ctx.beginPath();
  const steps = 360;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const rr = r * (1.07 + 0.03 * Math.sin(a * 9 + .4) + 0.02 * Math.sin(a * 17 + 1.3) + 0.012 * Math.sin(a * 31 + 2.1));
    const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = r * 0.18; ctx.shadowOffsetY = r * 0.06;
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r * 1.1);
  g.addColorStop(0, '#b0213f'); g.addColorStop(0.55, '#7F0020'); g.addColorStop(1, '#3A0010');
  ctx.fillStyle = g; ctx.fill();
  ctx.shadowColor = 'transparent';
  // pressed inner disc
  const g2 = ctx.createRadialGradient(r * 0.2, r * 0.25, r * 0.1, 0, 0, r * 0.8);
  g2.addColorStop(0, '#6D011A'); g2.addColorStop(1, '#8f0a28');
  ctx.beginPath(); ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2); ctx.fillStyle = g2; ctx.fill();
  ctx.lineWidth = r * 0.025;
  ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.arc(0, -r * 0.01, r * 0.78, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,190,200,.35)'; ctx.beginPath(); ctx.arc(0, r * 0.012, r * 0.78, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([r * 0.02, r * 0.035]); ctx.strokeStyle = 'rgba(255,190,200,.3)';
  ctx.beginPath(); ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  // engraved letter
  ctx.font = `700 ${r * 0.72}px Quicksand`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,170,185,.45)'; ctx.fillText(letter, 0, r * 0.03 + r * 0.025);
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillText(letter, 0, r * 0.03 - r * 0.02);
  ctx.fillStyle = '#5a0014'; ctx.fillText(letter, 0, r * 0.03);
  // rim text
  if (rim) {
    ctx.font = `700 ${r * 0.13}px Quicksand`;
    const chars = [...rim]; const step = (Math.PI * 2) / chars.length;
    chars.forEach((c, i) => {
      ctx.save(); ctx.rotate(-Math.PI / 2 + i * step); ctx.translate(0, -r * 0.89);
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillText(c, 0, -r * 0.012);
      ctx.fillStyle = 'rgba(255,214,222,.85)'; ctx.fillText(c, 0, 0);
      ctx.restore();
    });
  }
  ctx.restore(); ctx.textBaseline = 'alphabetic';
}
export function sealRim(a, b, iso) {
  const d = new Date(iso);
  const date = isNaN(d) ? '' : `${String(d.getDate()).padStart(2, '0')} · ${String(d.getMonth() + 1).padStart(2, '0')} · ${d.getFullYear()}`;
  return `${String(a || '').toUpperCase()} & ${String(b || '').toUpperCase()}  ✦  ${date}  ✦  `;
}

function avatar(ctx, img, x, y, r, ring) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 30;
  ctx.beginPath(); ctx.arc(x, y, r + 12, 0, Math.PI * 2); ctx.fillStyle = ring; ctx.fill();
  ctx.restore(); ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
  cover(ctx, img, x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

// ---------------- INVITATION ----------------
export async function renderInvitation(data, templateKey = 'noir') {
  await fontsReady();
  const t = TEMPLATES[templateKey] || TEMPLATES.noir;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = t.bg; ctx.fillRect(0, 0, W, H);

  // Arched photograph
  const photo = await loadImg(data.photo);
  const ax = W / 2, aw = 760, ah = 860, ay = 300;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(ax - aw / 2, ay + ah); ctx.lineTo(ax - aw / 2, ay + aw / 2);
  ctx.arc(ax, ay + aw / 2, aw / 2, Math.PI, 0); ctx.lineTo(ax + aw / 2, ay + ah); ctx.closePath();
  ctx.clip();
  if (photo) { cover(ctx, photo, ax - aw / 2, ay, aw, ah); }
  else { ctx.fillStyle = t.accent; ctx.fillRect(ax - aw / 2, ay, aw, ah); }
  const fade = ctx.createLinearGradient(0, ay + ah * 0.55, 0, ay + ah);
  fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, templateKey === 'ivory' ? 'rgba(255,252,239,.35)' : 'rgba(0,0,0,.45)');
  ctx.fillStyle = fade; ctx.fillRect(ax - aw / 2, ay, aw, ah);
  ctx.restore();
  ctx.strokeStyle = t.accent; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(ax - aw / 2 - 24, ay + ah + 10); ctx.lineTo(ax - aw / 2 - 24, ay + aw / 2);
  ctx.arc(ax, ay + aw / 2, aw / 2 + 24, Math.PI, 0); ctx.lineTo(ax + aw / 2 + 24, ay + ah + 10); ctx.stroke();

  frame(ctx, t);
  monogram(ctx, t, W / 2, 200, 62);
  if (data.guestPhoto) { const gp = await loadImg(data.guestPhoto); if (gp) avatar(ctx, gp, W / 2, ay + ah - 40, 108, templateKey === 'ivory' ? '#7F0020' : '#FFFCEF'); }

  ctx.fillStyle = t.soft; ctx.font = '500 34px Quicksand';
  spaced(ctx, data.recipient ? `DEAR ${String(data.recipient).toUpperCase()}` : 'YOU ARE INVITED', W / 2, 1270, 10);

  ctx.fillStyle = t.ink; ctx.font = '300 128px Quicksand'; ctx.textAlign = 'center';
  ctx.fillText(data.partnerA || '', W / 2, 1420);
  ctx.fillStyle = t.accent; ctx.font = '150px "Great Vibes", cursive';
  ctx.fillText('&', W / 2, 1545);
  ctx.fillStyle = t.ink; ctx.font = '300 128px Quicksand';
  ctx.fillText(data.partnerB || '', W / 2, 1670);

  divider(ctx, t, 1740);
  ctx.fillStyle = t.soft; ctx.font = '400 38px Quicksand';
  let y = wrap(ctx, data.message, W / 2, 1820, 1220, 54, 'center', 3);

  ctx.fillStyle = t.ink; ctx.font = '700 46px Quicksand';
  spaced(ctx, String(data.title || '').toUpperCase(), W / 2, y + 50, 6);
  ctx.font = '500 38px Quicksand'; ctx.fillStyle = t.accent;
  spaced(ctx, fmtEventDate(data.date), W / 2, y + 120, 5);
  ctx.fillStyle = t.ink; ctx.font = '400 36px Quicksand'; ctx.textAlign = 'center';
  ctx.fillText([fmtTime(data.date), data.venue].filter(Boolean).join('  ·  '), W / 2, y + 180);
  if (data.families) { ctx.fillStyle = t.soft; ctx.font = 'italic 400 30px Quicksand'; wrap(ctx, data.families, W / 2, y + 240, 1200, 42, 'center', 2); }

  // footer: reference + signature
  ctx.fillStyle = t.soft; ctx.font = '500 24px Quicksand';
  spaced(ctx, `INVITATION REF · ${data.ref || ''}`, W / 2, H - 140, 5);
  if (data.signature) {
    const s = await loadImg(data.signature);
    if (s) {
      const sw = 420, sh = (s.height / s.width) * sw;
      ctx.save();
      if (templateKey !== 'ivory') ctx.filter = 'invert(1)';
      ctx.drawImage(s, 170, H - 220 - sh, sw, sh); ctx.restore();
      ctx.fillStyle = t.soft; ctx.font = '400 22px Quicksand'; ctx.textAlign = 'left';
      ctx.fillText('signed by guest', 170, H - 196);
    }
  }
  grain(ctx, templateKey === 'ivory' ? 0.025 : 0.05);
  drawSeal(ctx, W - 250, H - 330, 150, { letter: data.monogram || 'M', rim: sealRim(data.partnerA, data.partnerB, data.date) });
  return c;
}

// ---------------- THANK-YOU NOTE ----------------
const TY_TITLES = {
  financial: 'For your generosity', gift: 'For your thoughtful gift', wisdom: 'For your wisdom',
  blessing: 'For your blessings', general: 'For being part of our story',
};
export async function renderThankYou(data, templateKey = 'ivory') {
  await fontsReady();
  const t = TEMPLATES[templateKey] || TEMPLATES.ivory;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = t.bg; ctx.fillRect(0, 0, W, H);

  // top photo band
  const photo = await loadImg(data.photo);
  if (photo) {
    ctx.save(); ctx.beginPath(); ctx.rect(70, 70, W - 140, 900); ctx.clip(); cover(ctx, photo, 70, 70, W - 140, 900);
    const g = ctx.createLinearGradient(0, 400, 0, 970); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, t.bg);
    ctx.fillStyle = g; ctx.fillRect(70, 70, W - 140, 900); ctx.restore();
  }
  frame(ctx, t);
  monogram(ctx, t, W / 2, 900, 70);

  ctx.fillStyle = t.accent; ctx.font = '210px "Great Vibes", cursive'; ctx.textAlign = 'center';
  ctx.fillText('Thank you', W / 2, 1210);
  ctx.fillStyle = t.soft; ctx.font = '500 36px Quicksand';
  spaced(ctx, (TY_TITLES[data.category] || TY_TITLES.general).toUpperCase(), W / 2, 1300, 8);
  divider(ctx, t, 1370);

  ctx.fillStyle = t.ink; ctx.font = '300 92px Quicksand'; ctx.textAlign = 'center';
  ctx.fillText(`Dear ${data.name || 'Friend'},`, W / 2, 1520);
  ctx.font = '400 44px Quicksand'; ctx.fillStyle = t.ink;
  let y = wrap(ctx, data.message, W / 2, 1630, 1260, 66, 'center', 6);

  ctx.fillStyle = t.soft; ctx.font = '400 38px Quicksand';
  ctx.fillText('With love and gratitude,', W / 2, y + 90);
  ctx.fillStyle = t.accent; ctx.font = '120px "Great Vibes", cursive';
  ctx.fillText(`${data.partnerA || ''} & ${data.partnerB || ''}`, W / 2, y + 230);

  if (data.coupleSignature) {
    const s = await loadImg(data.coupleSignature);
    if (s) { const sw = 380, sh = (s.height / s.width) * sw; ctx.save(); if (templateKey !== 'ivory') ctx.filter = 'invert(1)'; ctx.drawImage(s, W / 2 - sw / 2, y + 260, sw, sh); ctx.restore(); }
  }
  ctx.fillStyle = t.soft; ctx.font = '500 24px Quicksand';
  spaced(ctx, `${String(data.occasion || '').toUpperCase()}  ·  ${data.dateText || new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()}  ·  REF ${data.ref || ''}`, W / 2, H - 140, 4);
  ctx.font = '400 20px Quicksand';
  spaced(ctx, 'A PERSONAL NOTE OF APPRECIATION · NOT A PAYMENT RECEIPT', W / 2, H - 108, 4);
  grain(ctx, 0.025);
  drawSeal(ctx, W - 240, H - 300, 120, { letter: data.monogram || 'M', rim: sealRim(data.partnerA, data.partnerB, data.eventDate) });
  return c;
}

// ---------------- TRANSACTION ACKNOWLEDGEMENT (separate from thank-you notes) ----------------
export async function renderReceipt(data) {
  await fontsReady();
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#6D011A'; ctx.fillRect(0, 0, W, 360);
  const t = { ...TEMPLATES.burgundy };
  monogram(ctx, t, 230, 180, 80);
  ctx.fillStyle = '#FFFCEF'; ctx.textAlign = 'left'; ctx.font = '700 64px Quicksand';
  ctx.fillText('Transaction Acknowledgement', 360, 170);
  ctx.font = '400 34px Quicksand'; ctx.fillText(`${data.title || 'The Next Chapter'} · M-Pesa`, 360, 232);

  const rows = [
    ['Status', 'CONFIRMED'],
    ['Amount', `KES ${Number(data.amount || 0).toLocaleString('en-KE')}`],
    ['M-Pesa receipt', data.mpesaRef || '—'],
    ['Reference', data.ref || '—'],
    ['Contributor', data.anonymous ? 'Anonymous' : data.name || '—'],
    ['Phone', data.phoneMasked || '—'],
    ['Date confirmed', data.dateText || '—'],
    ['Received for', `${data.partnerA || ''} & ${data.partnerB || ''}`],
  ];
  let y = 560;
  for (const [k, v] of rows) {
    ctx.fillStyle = '#7a6a6d'; ctx.font = '500 34px Quicksand'; ctx.textAlign = 'left'; ctx.fillText(k.toUpperCase(), 180, y);
    ctx.fillStyle = '#1a0006'; ctx.font = '600 50px Quicksand'; ctx.textAlign = 'right'; ctx.fillText(String(v), W - 180, y);
    ctx.strokeStyle = '#eadfe1'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(180, y + 50); ctx.lineTo(W - 180, y + 50); ctx.stroke();
    y += 150;
  }
  ctx.fillStyle = '#7a6a6d'; ctx.font = '400 30px Quicksand'; ctx.textAlign = 'center';
  wrap(ctx, 'This document acknowledges a confirmed M-Pesa transaction recorded by The Next Chapter platform. It is separate from any personal thank-you note. For queries, quote the M-Pesa receipt number above.', W / 2, y + 120, 1300, 46, 'center', 4);
  ctx.fillStyle = '#6D011A'; ctx.fillRect(0, H - 40, W, 40);
  return c;
}

// ---------------- EXPORT ----------------
export function toPDF(canvas, { size = 'a5', filename = 'card.pdf' } = {}) {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) throw new Error('PDF library not loaded');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: size });
  const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
  const m = size === 'a4' ? 12 : 7; // print-safe margins
  const w = pw - m * 2, h = w * (H / W);
  const y = (ph - h) / 2;
  const img = canvas.toDataURL('image/jpeg', 0.95);
  pdf.addImage(img, 'JPEG', m, y, w, h, undefined, 'SLOW');
  // crop marks
  pdf.setDrawColor(160); pdf.setLineWidth(0.15);
  const L = 4;
  for (const [x0, y0, dx, dy] of [[m, y, -1, -1], [m + w, y, 1, -1], [m, y + h, -1, 1], [m + w, y + h, 1, 1]]) {
    pdf.line(x0 + dx * 1, y0, x0 + dx * (1 + L), y0); pdf.line(x0, y0 + dy * 1, x0, y0 + dy * (1 + L));
  }
  pdf.setProperties({ title: filename.replace(/\.pdf$/, ''), creator: 'The Next Chapter' });
  pdf.save(filename);
  return pdf;
}

export function toPNG(canvas, filename = 'card.png') {
  const a = document.createElement('a'); a.download = filename; a.href = canvas.toDataURL('image/png'); a.click();
}

export function printCanvas(canvas) {
  const w = window.open('', '_blank');
  if (!w) return alert('Please allow pop-ups to print.');
  w.document.write(`<html><head><title>Print</title><style>@page{size:A5;margin:7mm}body{margin:0;display:grid;place-items:center}img{width:100%;height:auto}</style></head><body><img src="${canvas.toDataURL('image/jpeg', 0.95)}" onload="setTimeout(()=>{print();},250)"></body></html>`);
  w.document.close();
}

export async function canvasToBlob(canvas) { return new Promise((r) => canvas.toBlob(r, 'image/png')); }
