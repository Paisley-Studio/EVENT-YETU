// THE NEXT CHAPTER: admin dashboard
import {
  app, db, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection, getDocs, query, orderBy, limit,
  onSnapshot, serverTimestamp, writeBatch, money, fmtDate, toDate, esc, compressImage, makeRef, normalizePhone,
} from './fb.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import { DEFAULT_SETTINGS, DEFAULT_GIFTS, STATUS, mergeDeep } from './defaults.js';
import { renderInvitation, renderThankYou, renderReceipt, toPDF, toPNG, TEMPLATES } from './cards.js';

const auth = getAuth(app);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const COLS = ['contributions', 'pledges', 'giftOffers', 'requests', 'reminders', 'wisdom', 'guestbook', 'gifts', 'giftReveals', 'invitations', 'thankyous', 'visits', 'activity', 'admins'];
const A = { user: null, settings: null, data: Object.fromEntries(COLS.map((c) => [c, []])), view: 'overview', sub: {}, f: {}, charts: {}, unsubs: [], media: new Map(), dirty: false };
const SITE = new URL('../', location.href).href;
const ms = (t) => toDate(t)?.getTime?.() || Date.now();
const today = () => new Date().toISOString().slice(0, 10);
const imgSrc = (p) => (p && String(p).startsWith('assets/') ? '../' + p : p);
const nameOf = (r) => (r.anonymous ? 'Anonymous' : r.name || '-');
const maskPhone = (p) => (p ? String(p).replace(/^254(\d{3})\d{3}(\d{3})$/, '0$1•••$2') : '-');
const telPhone = (p) => (p ? '+' + String(p).replace(/^0/, '254') : '');

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
let tT;
function toast(msg, err = false) { const t = $('#toast'); t.textContent = msg; t.classList.toggle('err', err); t.classList.add('on'); clearTimeout(tT); tT = setTimeout(() => t.classList.remove('on'), 3200); }
function dlg(html) { $('#dlgBody').innerHTML = html; $('#dlg').hidden = false; setTimeout(() => $('#dlgBody input, #dlgBody textarea, #dlgBody select')?.focus(), 50); return $('#dlgBody'); }
function closeDlg() { $('#dlg').hidden = true; $('#dlgBody').innerHTML = ''; }
document.addEventListener('click', (e) => { if (e.target.closest('[data-x]')) closeDlg(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#dlg').hidden) closeDlg(); });

function confirmDlg(text, okLabel = 'Confirm', danger = false) {
  return new Promise((res) => {
    const b = dlg(`<h3>${esc(text)}</h3><div class="toolbar"><span class="sp"></span><button class="b b--ghost" data-x>Cancel</button><button class="b ${danger ? 'b--bad' : 'b--primary'}" id="cOk">${esc(okLabel)}</button></div>`);
    $('#cOk', b).onclick = () => { closeDlg(); res(true); };
    $('#dlg').addEventListener('click', function h(e) { if (e.target.closest('[data-x]')) { res(false); $('#dlg').removeEventListener('click', h); } });
  });
}

const PILL = {
  SUCCESS: 'ok', PAID: 'ok', APPROVED: 'ok', RECEIVED: 'ok', SENT: 'ok', DONE: 'ok', ACCEPTED: 'info',
  PENDING: 'warn', OFFERED: 'warn', SCHEDULED: 'info', OPEN: 'warn', REMINDER_SENT: 'info', ARRANGEMENT_PENDING: 'info', COLLECTION_REQUESTED: 'warn', CALLED: 'info',
  FAILED: 'bad', REJECTED: 'bad', CANCELLED: 'mute', OPTED_OUT: 'mute', NONE: 'mute',
};
const pill = (s) => `<span class="st st--${PILL[s] || 'mute'}">${esc(String(s || '-').replaceAll('_', ' '))}</span>`;

async function resolveMedia(src) {
  if (!src || !String(src).startsWith('media:')) return imgSrc(src);
  const id = src.slice(6);
  if (A.media.has(id)) return A.media.get(id);
  const d = await getDoc(doc(db, 'media', id)); const v = d.exists() ? d.data().data : '';
  A.media.set(id, v); return v;
}
async function uploadMedia(file, max = 1600, kind = 'photo') {
  const data = await compressImage(file, max, 0.8);
  if (data.length > 900000) throw new Error('Image is too large even after compression. Try a smaller one.');
  const ref = await addDoc(collection(db, 'media'), { data, kind, at: serverTimestamp(), by: A.user.uid });
  A.media.set(ref.id, data);
  return 'media:' + ref.id;
}

function csv(rows, filename) {
  if (!rows.length) return toast('Nothing to export', true);
  const keys = Object.keys(rows[0]);
  const cell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const text = '﻿' + [keys.join(','), ...rows.map((r) => keys.map((k) => cell(r[k])).join(','))].join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function log(label) { try { await addDoc(collection(db, 'activity'), { type: 'admin', label: String(label).slice(0, 200), vid: A.user.email || A.user.uid, at: serverTimestamp() }); } catch { /* ignore */ } }
const sorted = (col) => [...A.data[col]].sort((a, b) => ms(b.at) - ms(a.at));
const coupleNames = () => `${A.settings.couple.partnerA} & ${A.settings.couple.partnerB}`;
function tpl(s, vars) { return String(s || '').replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? ''); }

// ---------------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------------
function showOnly(id) { ['auth', 'denied', 'app'].forEach((x) => ($('#' + x).hidden = x !== id)); $('#boot').hidden = true; }
const authErr = (e) => ({ 'auth/invalid-credential': 'Email or password is incorrect.', 'auth/wrong-password': 'Email or password is incorrect.', 'auth/user-not-found': 'No account with that email.', 'auth/too-many-requests': 'Too many attempts. Try again in a few minutes.', 'auth/email-already-in-use': 'That email already has an account. Sign in instead.', 'auth/weak-password': 'Use at least 8 characters.' }[e.code] || e.message);

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); const f = new FormData(e.target); $('#authErr').textContent = '';
  try { await signInWithEmailAndPassword(auth, f.get('email'), f.get('password')); } catch (err) { $('#authErr').textContent = authErr(err); }
});
$('#claimToggle')?.addEventListener('click', () => { $('#claimForm').hidden = !$('#claimForm').hidden; });
$('#claimForm').addEventListener('submit', async (e) => {
  e.preventDefault(); const f = new FormData(e.target); $('#authErr').textContent = '';
  try {
    const lock = await getDoc(doc(db, 'config', 'lock')).catch(() => null);
    if (lock?.exists()) { $('#authErr').textContent = 'An owner already exists. Ask them to add you.'; return; }
    const cred = await createUserWithEmailAndPassword(auth, f.get('email'), f.get('password'));
    await claimOwner(cred.user);
    location.reload();
  } catch (err) { $('#authErr').textContent = authErr(err); }
});
async function claimOwner(user) {
  const b = writeBatch(db);
  b.set(doc(db, 'admins', user.uid), { email: user.email, role: 'owner', at: serverTimestamp() });
  b.set(doc(db, 'config', 'lock'), { by: user.uid, at: serverTimestamp() });
  await b.commit();
}
$('#resetPw').addEventListener('click', async () => {
  const email = $('#loginForm [name=email]').value; if (!email) { $('#authErr').textContent = 'Enter your email above first.'; return; }
  try { await sendPasswordResetEmail(auth, email); toast('Password reset email sent'); } catch (err) { $('#authErr').textContent = authErr(err); }
});
document.addEventListener('click', (e) => { if (e.target.closest('[data-logout]')) signOut(auth).then(() => location.reload()); });
$('#deniedClaim').addEventListener('click', async () => { try { await claimOwner(A.user); location.reload(); } catch (err) { toast('Could not claim: ' + err.message, true); } });

onAuthStateChanged(auth, async (user) => {
  if (location.hash === '#demo' && ['localhost', '127.0.0.1'].includes(location.hostname)) return;
  A.user = user;
  if (!user) return showOnly('auth');
  let isAdmin = false;
  try { isAdmin = (await getDoc(doc(db, 'admins', user.uid))).exists(); } catch { isAdmin = false; }
  if (!isAdmin) {
    $('#myUid').textContent = user.uid;
    try { const lock = await getDoc(doc(db, 'config', 'lock')); $('#deniedClaim').hidden = lock.exists(); } catch { /* ignore */ }
    return showOnly('denied');
  }
  $('#whoami').textContent = user.email;
  await startApp();
});

// ---------------------------------------------------------------------------
// DATA
// ---------------------------------------------------------------------------
async function startApp() {
  const snap = await getDoc(doc(db, 'settings', 'site'));
  if (!snap.exists()) { await setDoc(doc(db, 'settings', 'site'), DEFAULT_SETTINGS); toast('Default content created. Edit it under Content & settings'); }
  A.settings = mergeDeep(DEFAULT_SETTINGS, snap.exists() ? snap.data() : {});
  onSnapshot(doc(db, 'settings', 'site'), (s) => { A.settings = mergeDeep(DEFAULT_SETTINGS, s.data() || {}); });
  for (const c of COLS) {
    const q = ['visits', 'activity', 'giftReveals'].includes(c) ? query(collection(db, c), orderBy('at', 'desc'), limit(c === 'visits' ? 5000 : 500)) : collection(db, c);
    A.unsubs.push(onSnapshot(q, (s) => { A.data[c] = s.docs.map((d) => ({ id: d.id, ...d.data() })); onData(c); }, (err) => console.warn(c, err.message)));
  }
  showOnly('app');
  render();
}

let renderT, syncT;
function onData() {
  updateBadges();
  clearTimeout(renderT);
  renderT = setTimeout(() => {
    const busy = document.activeElement && $('#views').contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (!$('#dlg').hidden || busy || STATIC_VIEWS.has(A.view)) { A.dirty = true; return; }
    render(true);
  }, 400);
  clearTimeout(syncT); syncT = setTimeout(() => syncStats(false), 2500);
}
document.addEventListener('focusout', () => setTimeout(() => { if (A.dirty && !STATIC_VIEWS.has(A.view) && $('#dlg').hidden && !$('#views').contains(document.activeElement)) { A.dirty = false; render(true); } }, 200));

function computeStats() {
  const d = A.data;
  const ok = d.contributions.filter((c) => c.status === 'SUCCESS');
  const openPl = d.pledges.filter((p) => ['PENDING', 'REMINDER_SENT'].includes(p.status));
  const vids = new Set();
  [...ok, ...d.pledges.filter((p) => p.status !== 'CANCELLED'), ...d.giftOffers, ...d.requests, ...d.wisdom, ...d.guestbook, ...d.reminders].forEach((x) => vids.add(x.vid || x.ref || x.id));
  return {
    confirmedTotal: ok.reduce((s, c) => s + (+c.amount || 0), 0),
    confirmedCount: ok.length,
    pledgedOutstanding: openPl.reduce((s, p) => s + (+p.amount || 0), 0),
    pledgeCount: openPl.length,
    giftsReceived: d.giftOffers.filter((g) => g.status === 'RECEIVED').length,
    giftOffersOpen: d.giftOffers.filter((g) => ['OFFERED', 'ACCEPTED', 'ARRANGEMENT_PENDING', 'COLLECTION_REQUESTED'].includes(g.status)).length,
    wisdomApproved: d.wisdom.filter((w) => w.status === 'APPROVED').length,
    guestbookCount: d.guestbook.filter((g) => g.status !== 'REJECTED').length,
    participants: vids.size,
    target: +A.settings.finance.target || 0,
  };
}
let lastStats = '';
let syncStats = async function (manual) {
  const s = computeStats(); const key = JSON.stringify(s);
  if (!manual && key === lastStats) return;
  try { await setDoc(doc(db, 'public', 'stats'), { ...s, updatedAt: serverTimestamp() }); lastStats = key; if (manual) toast('Public statistics synced ✓'); } catch (e) { if (manual) toast('Sync failed: ' + e.message, true); }
}
$('#syncStats').addEventListener('click', () => syncStats(true));

function dueState(r) { if (r.status !== 'SCHEDULED') return null; return r.date < today() ? 'overdue' : r.date === today() ? 'today' : 'upcoming'; }
function updateBadges() {
  const d = A.data;
  const set = (k, n) => { const el = $(`[data-badge=${k}]`); if (el) el.textContent = n || ''; };
  set('finance', d.contributions.filter((c) => c.status === 'PENDING').length);
  set('gifts', d.giftOffers.filter((g) => ['OFFERED', 'COLLECTION_REQUESTED'].includes(g.status)).length + d.requests.filter((r) => r.status === 'OPEN').length);
  set('reminders', d.reminders.filter((r) => ['overdue', 'today'].includes(dueState(r))).length);
  set('wisdom', d.wisdom.filter((w) => w.status === 'PENDING').length);
  set('guestbook', d.guestbook.filter((g) => g.status === 'PENDING').length);
}

// ---------------------------------------------------------------------------
// ROUTER
// ---------------------------------------------------------------------------
const TITLES = { overview: 'Overview', finance: 'Finance', gifts: 'Gifts', reminders: 'Reminders', wisdom: 'Wisdom & blessings', guestbook: 'Guestbook', invitations: 'Invitations', thankyou: 'Thank-you notes', content: 'Content & settings', reports: 'Reports', activity: 'Activity log', numbers: 'Public numbers' };
const STATIC_VIEWS = new Set(['content', 'invitations', 'thankyou', 'numbers']);
$('#sideNav').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]'); if (!b) return;
  A.view = b.dataset.view; $$('#sideNav button').forEach((x) => x.classList.toggle('is-on', x === b));
  setSide(false); A.dirty = false; render();
});
function setSide(open) { $('#side').classList.toggle('open', open); $('#sideBackdrop').hidden = !open; $('#burger').setAttribute('aria-expanded', open); }
$('#burger').addEventListener('click', () => setSide(!$('#side').classList.contains('open')));
$('#sideClose').addEventListener('click', () => setSide(false));
$('#sideBackdrop').addEventListener('click', () => setSide(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setSide(false); });

function render(keepScroll = false) {
  const y = scrollY;
  Object.values(A.charts).forEach((c) => c.destroy()); A.charts = {};
  $('#viewTitle').textContent = TITLES[A.view];
  const v = VIEWS[A.view]();
  $('#views').innerHTML = v.html;
  v.after?.();
  if (keepScroll) scrollTo(0, y); else scrollTo(0, 0);
}
function subtabs(view, tabs) {
  const cur = A.sub[view] || tabs[0][0];
  return { cur, html: `<div class="subtabs" data-subview="${view}">${tabs.map(([k, l]) => `<button data-sub="${k}" class="${k === cur ? 'is-on' : ''}">${l}</button>`).join('')}</div>` };
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-sub]'); if (!b) return;
  A.sub[b.closest('[data-subview]').dataset.subview] = b.dataset.sub; render();
});
// generic filter inputs: data-f="key"
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-f]'); if (!el) return;
  A.f[el.dataset.f] = el.value; clearTimeout(el._t);
  el._t = setTimeout(() => { const pos = el.selectionStart; render(true); const n = $(`[data-f="${el.dataset.f}"]`); if (n && n.tagName === 'INPUT') { n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* ignore */ } } }, el.tagName === 'SELECT' ? 0 : 250);
});
const fval = (k, d = '') => A.f[k] ?? d;
const match = (r, q) => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase());
const table = (head, rows, empty = 'Nothing here yet.') => `<div class="tbl-wrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${head.length}"><div class="empty">${empty}</div></td></tr>`}</tbody></table></div>`;
const opts = (list, cur) => list.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(String(l).replaceAll('_', ' '))}</option>`; }).join('');

// ---------------------------------------------------------------------------
// ACTIONS (delegated)
// ---------------------------------------------------------------------------
const ACT = {};
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  e.preventDefault();
  try { await ACT[b.dataset.act]?.(b.dataset, b); } catch (err) { console.error(err); toast(err.message || 'Action failed', true); }
});
document.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-chg]'); if (!el) return;
  try { await ACT[el.dataset.chg]?.({ ...el.dataset, value: el.type === 'checkbox' ? el.checked : el.value }, el); } catch (err) { console.error(err); toast(err.message || 'Update failed', true); }
});
const find = (col, id) => A.data[col].find((x) => x.id === id);
async function upd(col, id, data, msg) { await updateDoc(doc(db, col, id), { ...data, updatedAt: serverTimestamp() }); if (msg) { toast(msg); log(msg); } }

async function autoThank(category, name, source) {
  if (A.settings.autoThankYou === false) return;
  try { await addDoc(collection(db, 'thankyous'), { ref: makeRef('TY'), name: name || 'Friend', category, message: A.settings.thankyou[category] || A.settings.thankyou.general, source: source || '', auto: true, vid: 'admin', at: serverTimestamp() }); } catch { /* ignore */ }
}

// ============================================================================
// VIEWS
// ============================================================================
const VIEWS = {};

// ---------------- OVERVIEW ----------------
VIEWS.overview = () => {
  const s = computeStats(), d = A.data, t = s.target || 1;
  const cp = Math.min(s.confirmedTotal / t, 1), pp = Math.min(s.pledgedOutstanding / t, 1 - cp);
  const visits = d.visits.length, agreed = d.visits.filter((v) => v.agreed).length, part = d.visits.filter((v) => v.participated).length;
  const collReq = d.giftOffers.filter((g) => g.status === 'COLLECTION_REQUESTED').length;
  const kpi = (label, val, sub = '', cls = '') => `<div class="card kpi ${cls}"><span>${label}</span><b>${val}</b><small>${sub}</small></div>`;
  const fun = [['Visitors', visits], ['Agreed to journey', agreed], ['Participated', part]];
  return {
    html: `
    <div class="grid g-4">
      <div class="card kpi kpi--hero"><span>Confirmed contributions${+(A.settings.impactAdjust || {}).confirmedTotal ? ` · public shows ${money(s.confirmedTotal + +A.settings.impactAdjust.confirmedTotal)}` : ''}</span><b>${money(s.confirmedTotal)}</b>
        <div class="progress" role="img" aria-label="${Math.round(cp * 100)}% of target confirmed, ${Math.round(pp * 100)}% pledged"><i class="p-c" style="width:${cp * 100}%"></i><i class="p-p" style="width:${pp * 100}%"></i></div>
        <div class="legend"><span><i style="background:var(--ivory)"></i>Confirmed ${Math.round(cp * 100)}%</span><span><i style="background:repeating-linear-gradient(45deg,#fff 0 2px,transparent 2px 4px);border:1px solid rgba(255,255,255,.6)"></i>Pledged ${Math.round(pp * 100)}%</span><span>Target ${money(t)} · Remaining ${money(Math.max(t - s.confirmedTotal, 0))}</span></div></div>
      ${kpi('Outstanding pledges', money(s.pledgedOutstanding), `${s.pledgeCount} open pledges · not received`, 'kpi--hatch')}
      ${kpi('Confirmed contributors', s.confirmedCount, `${d.contributions.filter((c) => c.status === 'PENDING').length} pending verification`)}
      ${kpi('Gifts received', s.giftsReceived, `${s.giftOffersOpen} open offers`)}
      ${kpi('Collection requests', collReq, `${d.requests.filter((r) => r.status === 'OPEN').length} call requests open`)}
      ${kpi('Approved wisdom', s.wisdomApproved, `${d.wisdom.filter((w) => w.status === 'PENDING').length} awaiting moderation`)}
      ${kpi('Guestbook entries', d.guestbook.length, `${d.guestbook.filter((g) => g.status === 'PENDING').length} awaiting approval`)}
      ${kpi('Participants', s.participants, 'Unique people who took part')}
      ${kpi('Visitors', visits, `${agreed} agreed to the journey · ${d.giftReveals.length} gift reveals`)}
      ${kpi('Remaining to target', money(Math.max(t - s.confirmedTotal, 0)), 'Based on confirmed payments only')}
    </div>
    <div class="grid g-2" style="margin-top:16px">
      <div class="card"><div class="card-h"><div><h3>Visits per day</h3><p class="muted small">Last 30 days</p></div></div><div class="chart-box"><canvas id="chVisits" role="img" aria-label="Bar chart of visits per day over the last 30 days"></canvas></div></div>
      <div class="card"><div class="card-h"><div><h3>Confirmed contributions per day</h3><p class="muted small">KES, last 30 days (verified payments only)</p></div></div><div class="chart-box"><canvas id="chMoney" role="img" aria-label="Bar chart of confirmed contributions per day"></canvas></div></div>
      <div class="card"><div class="card-h"><h3>Visitor journey</h3></div><div class="funnel">${fun.map(([l, n]) => `<div><span>${l}</span><span class="bar"><i style="width:${visits ? (n / visits) * 100 : 0}%"></i></span><b>${n}</b></div>`).join('')}</div>
        <p class="muted small" style="margin-top:1rem">${d.visits.filter((v) => v.device === 'mobile').length} mobile · ${d.visits.filter((v) => v.device === 'desktop').length} desktop · ${d.visits.filter((v) => v.invite).length} via personalised links</p></div>
      <div class="card"><div class="card-h"><h3>Latest activity</h3><button class="lnk" data-act="goto" data-v="activity">View all</button></div><div class="feed">${sorted('activity').slice(0, 12).map((a) => `<div><span>${esc(a.label)}</span><time>${fmtDate(a.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></div>`).join('') || '<p class="muted">No activity yet.</p>'}</div></div>
    </div>`,
    after: () => {
      const days = [...Array(30)].map((_, i) => { const x = new Date(); x.setDate(x.getDate() - 29 + i); return x.toISOString().slice(0, 10); });
      const key = (t) => toDate(t)?.toISOString?.().slice(0, 10);
      const vc = Object.fromEntries(days.map((k) => [k, 0])); d.visits.forEach((v) => { const k = key(v.at); if (k in vc) vc[k]++; });
      const mc = Object.fromEntries(days.map((k) => [k, 0])); d.contributions.filter((c) => c.status === 'SUCCESS').forEach((c) => { const k = key(c.confirmedAt || c.at); if (k in mc) mc[k] += +c.amount || 0; });
      const lbl = days.map((k) => new Date(k).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
      A.charts.v = barChart('chVisits', lbl, Object.values(vc), 'Visits', (v) => v);
      A.charts.m = barChart('chMoney', lbl, Object.values(mc), 'Confirmed', money);
    },
  };
};
function barChart(id, labels, data, label, fmt) {
  const el = document.getElementById(id); if (!el || !window.Chart) return { destroy() {} };
  return new window.Chart(el, {
    type: 'bar',
    data: { labels, datasets: [{ label, data, backgroundColor: '#7F0020', hoverBackgroundColor: '#3A0010', borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', maxBarThickness: 14 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#0b0b0b', padding: 10, displayColors: false, callbacks: { label: (c) => `${label}: ${fmt(c.raw)}` } } },
      scales: { x: { grid: { display: false }, ticks: { color: '#8f8385', font: { family: 'Quicksand', size: 10 }, maxRotation: 0, autoSkipPadding: 12 } }, y: { beginAtZero: true, grid: { color: '#f1ebe0' }, border: { display: false }, ticks: { color: '#8f8385', font: { family: 'Quicksand', size: 10 }, precision: 0, callback: (v) => (fmt === money ? (v >= 1000 ? v / 1000 + 'k' : v) : v) } } },
    },
  });
}
ACT.goto = ({ v }) => $(`[data-view=${v}]`).click();

// ---------------- FINANCE ----------------
VIEWS.finance = () => {
  const st = subtabs('finance', [['tx', 'Transactions'], ['pledges', 'Pledges']]);
  const q = fval('finQ');
  if (st.cur === 'tx') {
    const sf = fval('txStatus');
    const rows = sorted('contributions').filter((c) => (!sf || c.status === sf) && match(c, q));
    const sum = rows.filter((r) => r.status === 'SUCCESS').reduce((s, r) => s + (+r.amount || 0), 0);
    return {
      html: `${st.html}<div class="toolbar"><input type="search" placeholder="Search name, ref, receipt…" data-f="finQ" value="${esc(q)}" />
        <select data-f="txStatus"><option value="">All statuses</option>${opts(STATUS.contribution, sf)}</select>
        <span class="muted small">${rows.length} shown · ${money(sum)} confirmed</span><span class="sp"></span>
        <button class="b b--ghost" data-act="goto" data-v="numbers">Edit public contributor count</button><button class="b b--ghost" data-act="exportTx">Export CSV</button><button class="b b--primary" data-act="recordPay">+ Add contribution</button></div>
        ${table(['Date', 'Reference', 'Contributor', 'Phone', 'Amount', 'Method', 'M-Pesa receipt', 'Status', ''], rows.map((c) => `<tr>
          <td>${fmtDate(c.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td><td class="mono">${esc(c.ref)}</td>
          <td>${esc(nameOf(c))}${c.anonymous && c.name ? `<br><small class="muted">(${esc(c.name)})</small>` : ''}</td><td class="mono">${esc(maskPhone(c.phone))}</td>
          <td class="num">${money(c.amount)}</td><td>${esc(c.method || 'STK')}</td><td class="mono">${esc(c.mpesaRef || '-')}${c.resultDesc && c.status === 'FAILED' ? `<br><small class="muted">${esc(c.resultDesc)}</small>` : ''}</td><td>${pill(c.status)}</td>
          <td><div class="acts"><button class="b b--ghost b--sm" data-act="editTx" data-id="${c.id}">Edit</button>${c.status === 'PENDING' ? `<button class="b b--ok b--sm" data-act="verifyTx" data-id="${c.id}">Verify</button><button class="b b--bad b--sm" data-act="failTx" data-id="${c.id}">Mark failed</button>` : ''}
          ${c.status === 'SUCCESS' ? `<button class="b b--ghost b--sm" data-act="ackTx" data-id="${c.id}">Acknowledgement</button><button class="b b--ghost b--sm" data-act="tyFor" data-cat="financial" data-name="${esc(nameOf(c))}">Thank-you</button>` : ''}</div></td></tr>`), 'No transactions yet.')}`,
    };
  }
  const sf = fval('plStatus');
  const rows = sorted('pledges').filter((p) => (!sf || p.status === sf) && match(p, q));
  return {
    html: `${st.html}<div class="toolbar"><input type="search" placeholder="Search…" data-f="finQ" value="${esc(q)}" />
      <select data-f="plStatus"><option value="">All statuses</option>${opts(STATUS.pledge, sf)}</select>
      <span class="muted small">Outstanding: <b>${money(A.data.pledges.filter((p) => ['PENDING', 'REMINDER_SENT'].includes(p.status)).reduce((s, p) => s + (+p.amount || 0), 0))}</b> (promised, not received)</span><span class="sp"></span>
      <button class="b b--ghost" data-act="exportPl">Export CSV</button><button class="b b--primary" data-act="editPledge">+ Add pledge</button></div>
      ${table(['Pledged on', 'Ref', 'Name', 'Phone', 'Amount', 'Remind on', 'Reminder', 'Status', ''], rows.map((p) => {
        const rem = find('reminders', p.reminderId);
        return `<tr><td>${fmtDate(p.at)}</td><td class="mono">${esc(p.ref)}</td><td>${esc(p.name || 'Anonymous')}</td><td class="mono">${esc(maskPhone(p.phone))}</td>
        <td class="num">${money(p.amount)}</td><td>${esc(p.date || '-')}</td><td>${pill(rem?.status || p.reminderStatus || 'NONE')}</td><td>${pill(p.status)}</td>
        <td><div class="acts"><button class="b b--ghost b--sm" data-act="editPledge" data-id="${p.id}">Edit</button>${['PENDING', 'REMINDER_SENT'].includes(p.status) ? `<button class="b b--ok b--sm" data-act="plPaid" data-id="${p.id}">Record as paid</button>${p.phone ? `<button class="b b--ghost b--sm" data-act="waRem" data-id="${p.reminderId || ''}" data-pledge="${p.id}">WhatsApp</button>` : ''}<button class="b b--ghost b--sm" data-act="plCancel" data-id="${p.id}">Cancel</button>` : ''}</div></td></tr>`;
      }), 'No pledges yet.')}`,
  };
};
ACT.verifyTx = ({ id }) => {
  const c = find('contributions', id);
  const b = dlg(`<h3>Verify payment</h3><p class="muted">Confirm you received <b>${money(c.amount)}</b> from ${esc(nameOf(c))} (${esc(maskPhone(c.phone))}). Only verified payments count towards the target.</p>
    <label class="f"><span>M-Pesa receipt / transaction code</span><input id="vRef" class="mono" placeholder="e.g. SLK4XYZ123" required /></label>
    <label class="f"><span>Amount received (KES)</span><input id="vAmt" type="number" value="${+c.amount || 0}" /></label>
    <div class="toolbar"><span class="sp"></span><button class="b b--ghost" data-x>Cancel</button><button class="b b--ok" id="vOk">Mark as confirmed</button></div>`);
  $('#vOk', b).onclick = async () => {
    const ref = $('#vRef').value.trim().toUpperCase(), amt = Math.round(+$('#vAmt').value);
    if (!ref) return toast('Enter the transaction code', true);
    if (A.data.contributions.some((x) => x.id !== id && (x.mpesaRef || '').toUpperCase() === ref)) return toast('Duplicate: this receipt is already recorded on another transaction', true);
    await upd('contributions', id, { status: 'SUCCESS', mpesaRef: ref, amount: amt, confirmedAt: serverTimestamp(), verifiedBy: A.user.email }, `Payment verified: ${money(amt)} (${ref})`);
    await setDoc(doc(db, 'contributionStatus', id), { status: 'SUCCESS', amount: amt, mpesaRef: ref, ref: c.ref, at: serverTimestamp() });
    autoThank('financial', nameOf(c), c.ref); closeDlg();
  };
};
ACT.failTx = async ({ id }) => { if (!(await confirmDlg('Mark this transaction as failed?', 'Mark failed', true))) return; await upd('contributions', id, { status: 'FAILED', resultDesc: 'Marked failed by admin' }, 'Transaction marked failed'); await setDoc(doc(db, 'contributionStatus', id), { status: 'FAILED', resultDesc: 'Not completed', at: serverTimestamp() }, { merge: true }); };
ACT.ackTx = async ({ id }) => {
  const c = find('contributions', id), cp = A.settings.couple;
  const cv = await renderReceipt({ title: A.settings.brand.title, amount: c.amount, mpesaRef: c.mpesaRef, ref: c.ref, name: c.name, anonymous: c.anonymous, phoneMasked: maskPhone(c.phone), dateText: toDate(c.confirmedAt || c.at)?.toLocaleString('en-GB') || '', partnerA: cp.partnerA, partnerB: cp.partnerB });
  toPDF(cv, { size: 'a5', filename: `TNC-Acknowledgement-${c.mpesaRef || c.ref}.pdf` });
};
ACT.recordPay = ({ pledge } = {}) => {
  const p = pledge ? find('pledges', pledge) : null;
  const open = A.data.pledges.filter((x) => ['PENDING', 'REMINDER_SENT'].includes(x.status));
  const b = dlg(`<h3>${p ? 'Record pledge as paid' : 'Record external payment'}</h3><p class="muted">For payments confirmed outside the automatic M-Pesa flow (direct M-Pesa, cash, bank).</p>
    <div class="row"><label class="f"><span>Name</span><input id="rName" value="${esc(p?.name || '')}" /></label><label class="f"><span>Phone</span><input id="rPhone" value="${esc(p?.phone || '')}" /></label></div>
    <div class="row"><label class="f"><span>Amount (KES)</span><input id="rAmt" type="number" value="${p?.amount || ''}" required /></label><label class="f"><span>Method</span><select id="rMethod">${opts(['MPESA_DIRECT', 'CASH', 'BANK', 'OTHER'])}</select></label></div>
    <label class="f"><span>Receipt / transaction code</span><input id="rRef" class="mono" placeholder="M-Pesa code or receipt no." /></label>
    <label class="f"><span>Linked pledge <em>(optional)</em></span><select id="rPledge"><option value="">None</option>${open.map((x) => `<option value="${x.id}" ${x.id === p?.id ? 'selected' : ''}>${esc(x.ref)} · ${esc(x.name || 'Anonymous')} · ${money(x.amount)}</option>`).join('')}</select></label>
    <label class="tog"><input type="checkbox" id="rAnon" /> Show as anonymous</label>
    <div class="toolbar"><span class="sp"></span><button class="b b--ghost" data-x>Cancel</button><button class="b b--ok" id="rOk">Record confirmed payment</button></div>`);
  $('#rOk', b).onclick = async () => {
    const amt = Math.round(+$('#rAmt').value); if (!amt || amt < 1) return toast('Enter the amount', true);
    const code = $('#rRef').value.trim().toUpperCase();
    if (code && A.data.contributions.some((x) => (x.mpesaRef || '').toUpperCase() === code)) return toast('Duplicate receipt: already recorded', true);
    const pl = $('#rPledge').value, ref = makeRef('TNC');
    const r = await addDoc(collection(db, 'contributions'), { amount: amt, name: $('#rName').value.trim(), phone: normalizePhone($('#rPhone').value) || $('#rPhone').value.trim(), anonymous: $('#rAnon').checked, ref, method: $('#rMethod').value, mpesaRef: code, pledgeId: pl, status: 'SUCCESS', vid: pl ? find('pledges', pl)?.vid || 'admin' : 'admin', at: serverTimestamp(), confirmedAt: serverTimestamp(), verifiedBy: A.user.email });
    await setDoc(doc(db, 'contributionStatus', r.id), { status: 'SUCCESS', amount: amt, mpesaRef: code, ref, at: serverTimestamp() });
    if (pl) {
      await upd('pledges', pl, { status: 'PAID', paidAt: serverTimestamp(), contributionId: r.id });
      const rem = find('pledges', pl)?.reminderId; if (rem && find('reminders', rem)?.status === 'SCHEDULED') await upd('reminders', rem, { status: 'CANCELLED' });
    }
    log(`External payment recorded: ${money(amt)}`); autoThank('financial', $('#rName').value.trim(), ref);
    closeDlg(); toast('Payment recorded ✓');
  };
};
ACT.plPaid = ({ id }) => ACT.recordPay({ pledge: id });
ACT.plCancel = async ({ id }) => { if (!(await confirmDlg('Cancel this pledge? It will no longer count as outstanding.', 'Cancel pledge', true))) return; const p = find('pledges', id); await upd('pledges', id, { status: 'CANCELLED' }, 'Pledge cancelled'); if (p.reminderId && find('reminders', p.reminderId)?.status === 'SCHEDULED') await upd('reminders', p.reminderId, { status: 'CANCELLED' }); };
ACT.exportTx = () => csv(sorted('contributions').map((c) => ({ date: toDate(c.at)?.toISOString() || '', ref: c.ref, name: c.name, anonymous: !!c.anonymous, phone: c.phone, amount: c.amount, method: c.method || 'STK', mpesa_receipt: c.mpesaRef || '', status: c.status, confirmed_at: toDate(c.confirmedAt)?.toISOString() || '' })), `tnc-transactions-${today()}.csv`);
ACT.editTx = ({ id }) => {
  const c = find('contributions', id);
  const b = dlg(`<h3>Edit contribution</h3><p class="muted">Ref <span class="mono">${esc(c.ref || '-')}</span>. Changes apply to the records and the public totals.</p>
    <div class="row"><label class="f"><span>Name</span><input id="eName" value="${esc(c.name || '')}" maxlength="80" /></label><label class="f"><span>Phone</span><input id="ePhone" value="${esc(c.phone || '')}" /></label></div>
    <div class="row"><label class="f"><span>Amount (KES)</span><input id="eAmt" type="number" min="1" value="${+c.amount || 0}" /></label><label class="f"><span>Method</span><select id="eMethod">${opts(['STK', 'MANUAL', 'MPESA_DIRECT', 'CASH', 'BANK', 'OTHER'], c.method || 'STK')}</select></label></div>
    <div class="row"><label class="f"><span>Receipt / transaction code</span><input id="eRef" class="mono" value="${esc(c.mpesaRef || '')}" /></label><label class="f"><span>Status</span><select id="eStatus">${opts(STATUS.contribution, c.status)}</select></label></div>
    <label class="tog"><input type="checkbox" id="eAnon" ${c.anonymous ? 'checked' : ''} /> Show as anonymous</label>
    <div class="toolbar"><button class="b b--bad" id="eDel">Delete</button><span class="sp"></span><button class="b b--ghost" data-x>Cancel</button><button class="b b--primary" id="eOk">Save changes</button></div>`);
  $('#eDel', b).onclick = async () => {
    if (!(await confirmDlg('Delete this contribution permanently?', 'Delete', true))) return;
    await deleteDoc(doc(db, 'contributions', id)); deleteDoc(doc(db, 'contributionStatus', id)).catch(() => {});
    toast('Deleted'); log(`Contribution ${c.ref || id} deleted`);
  };
  $('#eOk', b).onclick = async () => {
    const amt = Math.round(+$('#eAmt').value); if (!amt || amt < 1) return toast('Enter a valid amount', true);
    const code = $('#eRef').value.trim().toUpperCase(), status = $('#eStatus').value;
    if (code && A.data.contributions.some((x) => x.id !== id && (x.mpesaRef || '').toUpperCase() === code)) return toast('Duplicate: this receipt is already recorded on another transaction', true);
    const data = { name: $('#eName').value.trim(), phone: normalizePhone($('#ePhone').value) || $('#ePhone').value.trim(), amount: amt, method: $('#eMethod').value, mpesaRef: code, anonymous: $('#eAnon').checked, status };
    if (status === 'SUCCESS' && c.status !== 'SUCCESS') Object.assign(data, { confirmedAt: serverTimestamp(), verifiedBy: A.user.email });
    await upd('contributions', id, data, `Contribution ${c.ref || ''} edited`);
    await setDoc(doc(db, 'contributionStatus', id), { status, amount: amt, mpesaRef: code, ref: c.ref || '', at: serverTimestamp() }, { merge: true });
    closeDlg();
  };
};
ACT.editPledge = ({ id } = {}) => {
  const p = id ? find('pledges', id) : { name: '', phone: '', amount: '', date: '', status: 'PENDING' };
  const b = dlg(`<h3>${id ? 'Edit pledge' : 'Add pledge'}</h3><p class="muted">${id ? `Ref <span class="mono">${esc(p.ref || '-')}</span>.` : 'For promises made in person, by phone or on WhatsApp.'} Pledges are promises and never count as money received.</p>
    <div class="row"><label class="f"><span>Name</span><input id="pName" value="${esc(p.name || '')}" maxlength="80" placeholder="Who pledged?" /></label><label class="f"><span>Phone <em>(optional)</em></span><input id="pPhone" value="${esc(p.phone || '')}" placeholder="07XX XXX XXX" /></label></div>
    <div class="row"><label class="f"><span>Amount (KES)</span><input id="pAmt" type="number" min="1" value="${p.amount || ''}" /></label><label class="f"><span>Expected / remind on</span><input id="pDate" type="date" value="${esc(p.date || '')}" /></label></div>
    ${id ? `<label class="f"><span>Status</span><select id="pStatus">${opts(STATUS.pledge, p.status)}</select></label>` : '<label class="tog"><input type="checkbox" id="pRem" /> Schedule a reminder on that date (needs a phone number and their consent)</label>'}
    <div class="toolbar">${id ? '<button class="b b--bad" id="pDel">Delete</button>' : ''}<span class="sp"></span><button class="b b--ghost" data-x>Cancel</button><button class="b b--primary" id="pOk">${id ? 'Save changes' : 'Add pledge'}</button></div>`);
  if (id) $('#pDel', b).onclick = async () => {
    if (!(await confirmDlg('Delete this pledge permanently?', 'Delete', true))) return;
    await deleteDoc(doc(db, 'pledges', id));
    if (p.reminderId && find('reminders', p.reminderId)?.status === 'SCHEDULED') await upd('reminders', p.reminderId, { status: 'CANCELLED' });
    toast('Pledge deleted'); log('Pledge deleted');
  };
  $('#pOk', b).onclick = async () => {
    const amt = Math.round(+$('#pAmt').value); if (!amt || amt < 1) return toast('Enter the pledged amount', true);
    const name = $('#pName').value.trim(); if (!name) return toast('Enter who pledged', true);
    const phone = normalizePhone($('#pPhone').value) || '', date = $('#pDate').value || '';
    if ($('#pPhone').value.trim() && !phone) return toast('That phone number looks invalid', true);
    if (id) {
      const status = $('#pStatus').value, rem = p.reminderId && find('reminders', p.reminderId);
      await upd('pledges', id, { name, phone, amount: amt, date, status }, `Pledge ${p.ref || ''} edited`);
      if (rem) await upd('reminders', rem.id, { name, phone, date, ...(['PAID', 'CANCELLED'].includes(status) && rem.status === 'SCHEDULED' ? { status: 'CANCELLED' } : {}) });
    } else {
      const wantRem = $('#pRem').checked;
      if (wantRem && (!phone || !date)) return toast('A reminder needs a phone number and a date', true);
      const ref = makeRef('PL');
      const pr = await addDoc(collection(db, 'pledges'), { amount: amt, name, phone, date, consent: wantRem, ref, vid: 'admin', status: 'PENDING', reminderStatus: wantRem ? 'SCHEDULED' : 'NONE', reminderId: '', addedBy: A.user.email, at: serverTimestamp() });
      if (wantRem) {
        const r = await addDoc(collection(db, 'reminders'), { kind: 'pledge', refId: pr.id, name, phone, date, consent: true, status: 'SCHEDULED', vid: 'admin', ref, at: serverTimestamp() });
        await updateDoc(doc(db, 'pledges', pr.id), { reminderId: r.id });
      }
      toast('Pledge added ✓'); log(`Pledge added: ${money(amt)} from ${name}`);
    }
    closeDlg();
  };
};
ACT.exportPl = () => csv(sorted('pledges').map((p) => ({ date: toDate(p.at)?.toISOString() || '', ref: p.ref, name: p.name, phone: p.phone, amount: p.amount, remind_on: p.date, reminder_status: find('reminders', p.reminderId)?.status || p.reminderStatus, status: p.status })), `tnc-pledges-${today()}.csv`);

// ---------------- GIFTS ----------------
const GIFT_TYPE = { suggested: 'Suggested', custom: 'Custom', collection: 'Collection' };
VIEWS.gifts = () => {
  const st = subtabs('gifts', [['offers', 'Gift offers'], ['suggestions', 'Suggestions & game'], ['reveals', 'Reveals'], ['calls', 'Call requests']]);
  const q = fval('gQ');
  if (st.cur === 'suggestions') {
    const gifts = [...A.data.gifts].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    return {
      html: `${st.html}<div class="card" style="margin-bottom:16px"><div class="card-h"><div><h3>Numbers game</h3><p class="muted small">Visitors see numbered tiles; each hides one of the active suggestions below (shuffled per visitor).</p></div></div>
        <div class="row"><label class="f"><span>Number of tiles (0 = automatic)</span><input type="number" min="0" max="30" value="${+A.settings.game?.tiles || 0}" data-chg="setTiles" /></label>
        <div class="f"><span>Gift categories</span><div class="chips">${A.settings.giftCategories.map((c, i) => `<span>${esc(c)}<button data-act="rmCat" data-list="giftCategories" data-i="${i}" aria-label="Remove">×</button></span>`).join('')}</div><div class="toolbar"><input id="newGiftCat" placeholder="New category" style="padding:.5em .7em;border:1px solid var(--line);border-radius:9px" /><button class="b b--ghost b--sm" data-act="addCat" data-list="giftCategories" data-input="newGiftCat">Add</button></div></div></div></div>
        <div class="toolbar"><span class="muted small">${gifts.filter((g) => g.active).length} active suggestions</span><span class="sp"></span>${!gifts.length ? '<button class="b b--ghost" data-act="seedGifts">Import default suggestions</button>' : ''}<button class="b b--primary" data-act="editGift">+ Add suggestion</button></div>
        <div class="tiles" id="giftTiles">${gifts.map((g) => `<div class="tile"><img data-src="${esc(g.img || '')}" alt="" style="background:${esc(g.color || '#6D011A')}" />
          <div class="tile-b"><b>${esc(g.name)}</b><small class="muted">${esc(g.category || '')} · #${g.order ?? '-'}</small>
          <label class="tog" style="margin:0"><input type="checkbox" ${g.active ? 'checked' : ''} data-chg="giftActive" data-id="${g.id}" /> Active</label>
          <div class="acts"><button class="b b--ghost b--sm" data-act="editGift" data-id="${g.id}">Edit</button><button class="b b--bad b--sm" data-act="delGift" data-id="${g.id}">Delete</button></div></div></div>`).join('') || '<p class="muted">No suggestions yet. The site currently shows the built-in defaults. Import them to edit.</p>'}</div>`,
      after: () => $$('#giftTiles img[data-src]').forEach(async (i) => { const s = await resolveMedia(i.dataset.src); if (s) i.src = s; else i.style.minHeight = '120px'; }),
    };
  }
  if (st.cur === 'reveals') {
    const counts = {}; A.data.giftReveals.forEach((r) => { counts[r.giftName] = (counts[r.giftName] || 0) + 1; });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]); const max = top[0]?.[1] || 1;
    return {
      html: `${st.html}<div class="grid g-2"><div class="card"><h3>Most revealed</h3><p class="muted small">A reveal is curiosity, not a commitment.</p><div class="funnel" style="margin-top:1rem">${top.map(([n, c]) => `<div><span class="clip" style="-webkit-line-clamp:1">${esc(n)}</span><span class="bar"><i style="width:${(c / max) * 100}%"></i></span><b>${c}</b></div>`).join('') || '<p class="muted">No reveals yet.</p>'}</div></div>
        <div class="card"><h3>Recent reveals</h3>${table(['When', 'Number', 'Gift'], sorted('giftReveals').slice(0, 40).map((r) => `<tr><td>${fmtDate(r.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td><td>#${r.number}</td><td>${esc(r.giftName)}</td></tr>`))}</div></div>`,
    };
  }
  if (st.cur === 'calls') {
    const rows = sorted('requests').filter((r) => match(r, q));
    return {
      html: `${st.html}<div class="toolbar"><input type="search" placeholder="Search…" data-f="gQ" value="${esc(q)}" /><span class="sp"></span><button class="b b--ghost" data-act="exportCalls">Export CSV</button></div>
      ${table(['Requested', 'Name', 'Phone', 'Best time', 'About', 'Status', ''], rows.map((r) => `<tr><td>${fmtDate(r.at)}</td><td>${esc(r.name)}</td><td class="mono"><a href="tel:${telPhone(r.phone)}">${esc(r.phone)}</a></td><td>${esc(r.bestTime || '-')}</td><td>${esc(r.giftName || '-')}</td>
        <td><select data-chg="reqStatus" data-id="${r.id}">${opts(['OPEN', 'CALLED', 'DONE', 'CANCELLED'], r.status)}</select></td>
        <td><div class="acts"><a class="b b--ghost b--sm" href="https://wa.me/${String(r.phone).replace(/\D/g, '')}?text=${encodeURIComponent(tpl(A.settings.reminders.call, { name: r.name, couple: coupleNames() }))}" target="_blank" rel="noopener">WhatsApp</a></div></td></tr>`), 'No call requests yet.')}`,
    };
  }
  // offers
  const tf = fval('gType'), sf = fval('gStatus');
  const rows = sorted('giftOffers').filter((g) => (!tf || g.type === tf) && (!sf || g.status === sf) && match({ ...g, photo: '' }, q));
  return {
    html: `${st.html}<div class="toolbar"><input type="search" placeholder="Search gifts, names…" data-f="gQ" value="${esc(q)}" />
      <select data-f="gType"><option value="">All types</option>${opts(Object.entries(GIFT_TYPE), tf)}</select>
      <select data-f="gStatus"><option value="">All statuses</option>${opts(STATUS.gift, sf)}</select><span class="sp"></span>
      <span class="muted small">Only <b>RECEIVED</b> gifts count on the public counter.</span><button class="b b--ghost" data-act="exportGifts">Export CSV</button><button class="b b--primary" data-act="editOffer">+ Add gift</button></div>
    ${table(['Date', 'Type', 'Gift', 'From', 'Arrangement', 'Message', 'Status', ''], rows.map((g) => `<tr><td>${fmtDate(g.at)}</td><td>${esc(GIFT_TYPE[g.type] || g.type)}</td>
      <td>${g.photo ? `<img class="thumb" src="${esc(g.photo)}" alt="" data-act="viewImg" data-src="${esc(g.photo)}" style="cursor:zoom-in;margin-bottom:.3rem" />` : ''}<b>${esc(g.giftName || '-')}</b>${g.description && g.description !== g.giftName ? `<div class="clip muted small">${esc(g.description)}</div>` : ''}</td>
      <td>${esc(g.name || 'Anonymous')}<br><span class="mono small">${g.phone ? `<a href="tel:${telPhone(g.phone)}">${esc(g.phone)}</a>` : ''}</span></td>
      <td>${esc(g.arrangement || '')}${g.location ? `<br><small>${esc(g.location)}</small>` : ''}${g.date ? `<br><small>Suggested: ${esc(g.date)}</small>` : ''}</td>
      <td><div class="clip">${esc(g.message || '')}</div></td>
      <td><select data-chg="giftStatus" data-id="${g.id}">${opts(STATUS.gift, g.status)}</select></td>
      <td><div class="acts"><button class="b b--ghost b--sm" data-act="editOffer" data-id="${g.id}">Edit</button>${g.status !== 'RECEIVED' ? `<button class="b b--ok b--sm" data-act="giftReceived" data-id="${g.id}">Mark received</button>` : `<button class="b b--ghost b--sm" data-act="tyFor" data-cat="gift" data-name="${esc(g.name || 'Friend')}">Thank-you</button>`}</div></td></tr>`), 'No gift offers yet.')}`,
  };
};
ACT.giftStatus = async ({ id, value }) => { const g = find('giftOffers', id); await upd('giftOffers', id, { status: value, ...(value === 'RECEIVED' ? { receivedAt: serverTimestamp() } : {}) }, `Gift "${g.giftName}" → ${value}`); if (value === 'RECEIVED') autoThank('gift', g.name, g.ref); };
ACT.editOffer = ({ id } = {}) => {
  const g = id ? find('giftOffers', id) : { type: 'custom', giftName: '', description: '', name: '', phone: '', message: '', arrangement: 'Handed over in person', status: 'RECEIVED', photo: '' };
  const sugg = [...A.data.gifts].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)).map((x) => x.name);
  let photo = g.photo || '';
  const b = dlg(`<h3>${id ? 'Edit gift' : 'Add gift'}</h3><p class="muted">Record a gift given outside the website, and who gave it. Only <b>RECEIVED</b> gifts count on the public counter.</p>
    <div class="row"><label class="f"><span>Gift</span><input id="oGift" list="oSugg" value="${esc(g.giftName || '')}" maxlength="120" placeholder="e.g. Microwave" /><datalist id="oSugg">${sugg.map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist></label>
      <label class="f"><span>Type</span><select id="oType">${opts(Object.entries(GIFT_TYPE), g.type)}</select></label></div>
    <div class="row"><label class="f"><span>Given by</span><input id="oName" value="${esc(g.name || '')}" maxlength="80" placeholder="e.g. The Kamau Family" /></label><label class="f"><span>Phone <em>(optional)</em></span><input id="oPhone" value="${esc(g.phone || '')}" /></label></div>
    <label class="f"><span>Description <em>(optional)</em></span><input id="oDesc" value="${esc(g.description && g.description !== g.giftName ? g.description : '')}" maxlength="600" /></label>
    <label class="f"><span>Their message <em>(optional)</em></span><textarea id="oMsg" rows="2" maxlength="600">${esc(g.message || '')}</textarea></label>
    <div class="row"><label class="f"><span>Arrangement</span><input id="oArr" value="${esc(g.arrangement || '')}" maxlength="60" /></label><label class="f"><span>Status</span><select id="oStatus">${opts(STATUS.gift, g.status)}</select></label></div>
    <label class="uploader"><img id="oPrev" style="max-height:120px;border-radius:8px" alt="" ${photo ? `src="${esc(photo)}"` : ''} /><span>Photo of the gift <em>(optional)</em></span><input type="file" accept="image/*" id="oFile" /></label>
    <div class="toolbar" style="margin-top:1rem">${id ? '<button class="b b--bad" id="oDel">Delete</button>' : ''}<span class="sp"></span><button class="b b--ghost" data-x>Cancel</button><button class="b b--primary" id="oOk">${id ? 'Save changes' : 'Add gift'}</button></div>`);
  $('#oFile', b).onchange = async (e) => { try { photo = await compressImage(e.target.files[0], 900, 0.75); $('#oPrev').src = photo; } catch (err) { toast(err.message, true); } };
  if (id) $('#oDel', b).onclick = async () => { if (!(await confirmDlg('Delete this gift record permanently?', 'Delete', true))) return; await deleteDoc(doc(db, 'giftOffers', id)); toast('Deleted'); log(`Gift "${g.giftName}" deleted`); };
  $('#oOk', b).onclick = async () => {
    const giftName = $('#oGift').value.trim(); if (!giftName) return toast('Enter the gift', true);
    const name = $('#oName').value.trim(); if (!name) return toast('Enter who gave it', true);
    const status = $('#oStatus').value;
    const data = { type: $('#oType').value, giftName, description: $('#oDesc').value.trim() || giftName, name, phone: normalizePhone($('#oPhone').value) || $('#oPhone').value.trim(), message: $('#oMsg').value.trim(), arrangement: $('#oArr').value.trim(), status, photo };
    if (status === 'RECEIVED' && g.status !== 'RECEIVED') data.receivedAt = serverTimestamp();
    if (id) await upd('giftOffers', id, data, `Gift "${giftName}" edited`);
    else {
      const ref = makeRef('G');
      await addDoc(collection(db, 'giftOffers'), { ...data, ref, vid: 'admin', addedBy: A.user.email, at: serverTimestamp() });
      toast('Gift added ✓'); log(`Gift "${giftName}" from ${name} added`);
      if (status === 'RECEIVED') autoThank('gift', name, ref);
    }
    closeDlg();
  };
};
ACT.giftReceived = ({ id }) => ACT.giftStatus({ id, value: 'RECEIVED' });
ACT.reqStatus = ({ id, value }) => upd('requests', id, { status: value }, `Call request → ${value}`);
ACT.viewImg = ({ src }) => dlg(`<img src="${esc(src)}" style="width:100%;border-radius:12px" alt="" />`);
ACT.exportGifts = () => csv(sorted('giftOffers').map((g) => ({ date: toDate(g.at)?.toISOString() || '', ref: g.ref, type: g.type, gift: g.giftName, description: g.description, name: g.name, phone: g.phone, arrangement: g.arrangement, location: g.location || '', suggested_date: g.date || '', message: g.message, has_photo: !!g.photo, status: g.status })), `tnc-gifts-${today()}.csv`);
ACT.exportCalls = () => csv(sorted('requests').map((r) => ({ date: toDate(r.at)?.toISOString() || '', name: r.name, phone: r.phone, best_time: r.bestTime, about: r.giftName, status: r.status })), `tnc-call-requests-${today()}.csv`);
ACT.giftActive = ({ id, value }) => upd('gifts', id, { active: value }, value ? 'Suggestion activated' : 'Suggestion hidden');
ACT.setTiles = async ({ value }) => { await setDoc(doc(db, 'settings', 'site'), { game: { tiles: Math.max(0, Math.min(30, +value || 0)) } }, { merge: true }); toast('Saved'); };
ACT.delGift = async ({ id }) => { if (await confirmDlg('Delete this gift suggestion?', 'Delete', true)) { await deleteDoc(doc(db, 'gifts', id)); toast('Deleted'); log('Gift suggestion deleted'); } };
ACT.seedGifts = async () => {
  const b = writeBatch(db);
  DEFAULT_GIFTS.forEach((g, i) => b.set(doc(collection(db, 'gifts')), { ...g, order: i + 1, active: true, at: serverTimestamp() }));
  await b.commit(); toast('Default suggestions imported'); log('Imported default gift suggestions');
};
ACT.editGift = ({ id }) => {
  const g = id ? find('gifts', id) : { name: '', category: A.settings.giftCategories[0], note: '', color: '#6D011A', img: '', order: A.data.gifts.length + 1, active: true };
  let img = g.img || '';
  const b = dlg(`<h3>${id ? 'Edit' : 'New'} gift suggestion</h3>
    <label class="f"><span>Gift name</span><input id="gName" value="${esc(g.name)}" maxlength="80" /></label>
    <div class="row"><label class="f"><span>Category</span><select id="gCat">${opts(A.settings.giftCategories, g.category)}</select></label><label class="f"><span>Display order</span><input id="gOrder" type="number" value="${g.order ?? 1}" /></label></div>
    <label class="f"><span>Short note shown on reveal</span><input id="gNote" value="${esc(g.note || '')}" maxlength="120" /></label>
    <div class="row"><label class="f"><span>Showcase colour</span><input id="gColor" type="color" value="${esc(g.color || '#6D011A')}" /></label><label class="tog" style="align-self:end"><input type="checkbox" id="gActive" ${g.active ? 'checked' : ''} /> Active in game</label></div>
    <label class="uploader" id="gUp"><img id="gPrev" style="max-height:140px;border-radius:8px" alt="" /><span>Click to upload a photo</span><input type="file" accept="image/*" id="gFile" /></label>
    <div class="toolbar" style="margin-top:1rem"><span class="sp"></span><button class="b b--ghost" data-x>Cancel</button><button class="b b--primary" id="gSave">Save</button></div>`);
  if (img) resolveMedia(img).then((s) => s && ($('#gPrev').src = s));
  $('#gFile', b).onchange = async (e) => { try { img = await compressImage(e.target.files[0], 900, 0.8); $('#gPrev').src = img; } catch (err) { toast(err.message, true); } };
  $('#gSave', b).onclick = async () => {
    const data = { name: $('#gName').value.trim(), category: $('#gCat').value, note: $('#gNote').value.trim(), color: $('#gColor').value, order: +$('#gOrder').value || 0, active: $('#gActive').checked, img };
    if (!data.name) return toast('Name is required', true);
    if (id) await upd('gifts', id, data, `Gift "${data.name}" updated`); else { await addDoc(collection(db, 'gifts'), { ...data, at: serverTimestamp() }); toast('Suggestion added'); log(`Gift "${data.name}" added`); }
    closeDlg();
  };
};
ACT.addCat = async ({ list, input }) => {
  const v = $('#' + input).value.trim(); if (!v) return;
  const arr = [...A.settings[list], v]; await setDoc(doc(db, 'settings', 'site'), { [list]: arr }, { merge: true }); A.settings[list] = arr; render(true); toast('Category added');
};
ACT.rmCat = async ({ list, i }) => { const arr = A.settings[list].filter((_, k) => k !== +i); await setDoc(doc(db, 'settings', 'site'), { [list]: arr }, { merge: true }); A.settings[list] = arr; render(true); };

// ---------------- REMINDERS ----------------
VIEWS.reminders = () => {
  const ff = fval('rFilter', 'due');
  const rows = [...A.data.reminders].sort((a, b) => String(a.date).localeCompare(String(b.date))).filter((r) => {
    const s = dueState(r);
    if (ff === 'due') return s === 'overdue' || s === 'today';
    if (ff === 'upcoming') return s === 'upcoming';
    if (ff === 'sent') return r.status === 'SENT';
    if (ff === 'opted') return ['OPTED_OUT', 'CANCELLED'].includes(r.status);
    return true;
  });
  const due = A.data.reminders.filter((r) => ['overdue', 'today'].includes(dueState(r))).length;
  return {
    html: `<div class="card" style="margin-bottom:16px"><p class="muted small" style="margin:0">Reminders are sent only to visitors who gave a phone number and consented. ${A.settings.smsProvider ? 'Automatic SMS is configured on the server: due reminders are sent daily and marked SENT.' : 'Use the WhatsApp/SMS buttons to send each friendly message, then mark it sent. (Automatic SMS can be enabled in the Cloud Function, see README.)'} Each message includes a one-tap opt-out link.</p></div>
      <div class="toolbar"><select data-f="rFilter">${opts([['due', `Due now (${due})`], ['upcoming', 'Upcoming'], ['sent', 'Sent'], ['opted', 'Opted out / cancelled'], ['all', 'All']], ff)}</select><span class="sp"></span><button class="b b--ghost" data-act="exportRem">Export CSV</button></div>
      ${table(['Date', 'Kind', 'Name', 'Phone', 'About', 'Status', 'Message', ''], rows.map((r) => {
        const s = dueState(r);
        return `<tr><td><b>${esc(r.date)}</b><br>${s ? `<span class="st st--${s === 'overdue' ? 'bad' : s === 'today' ? 'warn' : 'info'}">${s}</span>` : ''}</td><td>${esc(r.kind)}</td><td>${esc(r.name || '-')}</td><td class="mono">${esc(r.phone || '-')}</td>
        <td>${r.kind === 'pledge' ? money(find('pledges', r.refId)?.amount) : esc(r.giftName || '-')}</td><td>${pill(r.status)}</td><td><div class="clip small">${esc(reminderText(r))}</div></td>
        <td><div class="acts">${r.status === 'SCHEDULED' && r.phone ? `<button class="b b--ghost b--sm" data-act="waRem" data-id="${r.id}">WhatsApp</button><a class="b b--ghost b--sm" href="sms:+${esc(r.phone)}?body=${encodeURIComponent(reminderText(r))}">SMS</a><button class="b b--ok b--sm" data-act="remSent" data-id="${r.id}">Mark sent</button><button class="b b--ghost b--sm" data-act="remCancel" data-id="${r.id}">Cancel</button>` : ''}</div></td></tr>`;
      }), ff === 'due' ? 'Nothing due right now.' : 'No reminders here.')}`,
  };
};
function reminderText(r) {
  const t = A.settings.reminders[r.kind] || A.settings.reminders.gift;
  const amount = r.kind === 'pledge' ? money(find('pledges', r.refId)?.amount) : '';
  return tpl(t, { name: r.name || 'friend', couple: coupleNames(), gift: r.giftName, date: r.date, amount }) + `\nOpt out: ${SITE}?optout=${r.id}`;
}
ACT.waRem = ({ id, pledge }) => {
  let r = find('reminders', id);
  if (!r && pledge) { const p = find('pledges', pledge); r = { id: '', kind: 'pledge', refId: p.id, name: p.name, phone: p.phone, date: p.date }; }
  window.open(`https://wa.me/${String(r.phone).replace(/\D/g, '')}?text=${encodeURIComponent(reminderText(r))}`, '_blank', 'noopener');
};
ACT.remSent = async ({ id }) => {
  const r = find('reminders', id);
  await upd('reminders', id, { status: 'SENT', sentAt: serverTimestamp(), sentBy: A.user.email }, `Reminder sent to ${r.name || r.phone}`);
  if (r.kind === 'pledge' && r.refId) { const p = find('pledges', r.refId); if (p && p.status === 'PENDING') await upd('pledges', p.id, { status: 'REMINDER_SENT', reminderStatus: 'SENT' }); }
};
ACT.remCancel = async ({ id }) => upd('reminders', id, { status: 'CANCELLED' }, 'Reminder cancelled');
ACT.exportRem = () => csv([...A.data.reminders].map((r) => ({ date: r.date, kind: r.kind, name: r.name, phone: r.phone, about: r.giftName || r.refId, status: r.status })), `tnc-reminders-${today()}.csv`);

// ---------------- WISDOM ----------------
VIEWS.wisdom = () => {
  const sf = fval('wStatus', 'PENDING'), cf = fval('wCat'), q = fval('wQ');
  const rows = sorted('wisdom').filter((w) => (!sf || w.status === sf) && (!cf || w.category === cf) && match(w, q));
  const cnt = (s) => A.data.wisdom.filter((w) => w.status === s).length;
  return {
    html: `<div class="grid g-4" style="margin-bottom:16px"><div class="card kpi"><span>Awaiting moderation</span><b>${cnt('PENDING')}</b></div><div class="card kpi"><span>Approved</span><b>${cnt('APPROVED')}</b><small>${A.data.wisdom.filter((w) => w.status === 'APPROVED' && w.public).length} on the public wall</small></div><div class="card kpi"><span>Private messages</span><b>${A.data.wisdom.filter((w) => !w.public).length}</b><small>never shown publicly</small></div><div class="card kpi"><span>Rejected</span><b>${cnt('REJECTED')}</b></div></div>
    <div class="toolbar"><input type="search" placeholder="Search messages…" data-f="wQ" value="${esc(q)}" /><select data-f="wStatus"><option value="">All</option>${opts(STATUS.moderation, sf)}</select><select data-f="wCat"><option value="">All categories</option>${opts(A.settings.wisdomCategories, cf)}</select><span class="sp"></span><button class="b b--ghost" data-act="wCats">Manage categories</button><button class="b b--ghost" data-act="exportWisdom">Export CSV</button><button class="b b--primary" data-act="editWisdom">+ Add words of wisdom</button></div>
    ${table(['Date', 'From', 'Category', 'Message', 'Visibility', 'Status', ''], rows.map((w) => `<tr><td>${fmtDate(w.at)}</td><td>${esc(w.name || 'Anonymous')}</td><td>${esc(w.category)}</td><td style="max-width:420px">${esc(w.message)}</td>
      <td>${w.public || w.hidden ? '<span class="st st--info">Public OK</span>' : '<span class="st st--mute">Private</span>'}${w.public || w.hidden ? `<br><label class="tog small" style="margin:.4rem 0 0"><input type="checkbox" ${w.hidden ? '' : 'checked'} data-chg="wVisible" data-id="${w.id}" /> on wall</label>` : ''}</td>
      <td>${pill(w.status)}</td><td><div class="acts"><button class="b b--ghost b--sm" data-act="editWisdom" data-id="${w.id}">Edit</button>${w.status !== 'APPROVED' ? `<button class="b b--ok b--sm" data-act="wSet" data-s="APPROVED" data-id="${w.id}">Approve</button>` : ''}${w.status !== 'REJECTED' ? `<button class="b b--bad b--sm" data-act="wSet" data-s="REJECTED" data-id="${w.id}">Reject</button>` : ''}<button class="b b--ghost b--sm" data-act="delDoc" data-col="wisdom" data-id="${w.id}">Delete</button></div></td></tr>`), sf === 'PENDING' ? 'All caught up. No messages awaiting moderation.' : 'No messages.')}`,
  };
};
ACT.wSet = async ({ id, s }) => { const w = find('wisdom', id); await upd('wisdom', id, { status: s, moderatedAt: serverTimestamp() }, `Wisdom ${s.toLowerCase()}`); if (s === 'APPROVED') autoThank(/prayer|bless/i.test(w.category) ? 'blessing' : 'wisdom', w.name, w.ref); };
// "on wall" uses the public flag only when the visitor allowed it; hiding sets public=false (private messages can never be made public)
ACT.wVisible = async ({ id, value }) => { const w = find('wisdom', id); if (!w.public && !w.hidden) return toast('The visitor asked for this to stay private', true); await upd('wisdom', id, { public: !!value, hidden: !value }, value ? 'Shown on wall' : 'Hidden from wall'); };
ACT.editWisdom = ({ id } = {}) => {
  const w = id ? find('wisdom', id) : { name: '', category: A.settings.wisdomCategories[0], message: '', public: true, status: 'APPROVED' };
  const onWall = id ? !!w.public && !w.hidden : true;
  const b = dlg(`<h3>${id ? 'Edit words of wisdom' : 'Add words of wisdom'}</h3><p class="muted">For advice and blessings shared by card, WhatsApp, phone or in person.</p>
    <div class="row"><label class="f"><span>Given by</span><input id="wName" value="${esc(w.name || '')}" maxlength="80" placeholder="e.g. Grandma Njeri" /></label><label class="f"><span>Category</span><select id="wCat">${opts(A.settings.wisdomCategories, w.category)}</select></label></div>
    <label class="f"><span>Their words</span><textarea id="wMsg" rows="5" maxlength="1500">${esc(w.message || '')}</textarea></label>
    <div class="row"><label class="f"><span>Status</span><select id="wStatus">${opts(STATUS.moderation, w.status)}</select></label><label class="tog" style="align-self:end"><input type="checkbox" id="wPub" ${onWall ? 'checked' : ''} /> Show on the public wall</label></div>
    <div class="toolbar">${id ? '<button class="b b--bad" id="wDel">Delete</button>' : ''}<span class="sp"></span><button class="b b--ghost" data-x>Cancel</button><button class="b b--primary" id="wOk">${id ? 'Save changes' : 'Add'}</button></div>`);
  if (id) $('#wDel', b).onclick = () => ACT.delDoc({ col: 'wisdom', id });
  $('#wOk', b).onclick = async () => {
    const message = $('#wMsg').value.trim(); if (!message) return toast('Enter the words of wisdom', true);
    const name = $('#wName').value.trim(), category = $('#wCat').value, status = $('#wStatus').value, pub = $('#wPub').checked;
    // a visitor who asked for privacy keeps it: admins can't publish their message
    if (id && pub && !w.public && !w.hidden && w.vid !== 'admin') return toast('The visitor asked for this to stay private', true);
    if (id) await upd('wisdom', id, { name, category, message, status, public: pub, hidden: !pub && (w.public || w.hidden || w.vid === 'admin') }, 'Wisdom edited');
    else {
      const ref = makeRef('W');
      await addDoc(collection(db, 'wisdom'), { name, category, message, status, public: pub, hidden: !pub, ref, vid: 'admin', addedBy: A.user.email, at: serverTimestamp(), moderatedAt: serverTimestamp() });
      toast('Words of wisdom added ✓'); log(`Wisdom from ${name || 'Anonymous'} added`);
      if (status === 'APPROVED') autoThank(/prayer|bless/i.test(category) ? 'blessing' : 'wisdom', name, ref);
    }
    closeDlg();
  };
};
ACT.wCats = () => {
  const b = dlg(`<h3>Wisdom categories</h3><div class="chips">${A.settings.wisdomCategories.map((c, i) => `<span>${esc(c)}<button data-act="rmCat" data-list="wisdomCategories" data-i="${i}">×</button></span>`).join('')}</div><div class="toolbar"><input id="newWCat" placeholder="New category" style="padding:.5em .7em;border:1px solid var(--line);border-radius:9px;flex:1" /><button class="b b--primary b--sm" id="addW">Add</button></div>`);
  $('#addW', b).onclick = async () => { await ACT.addCat({ list: 'wisdomCategories', input: 'newWCat' }); ACT.wCats(); };
};
ACT.exportWisdom = () => csv(sorted('wisdom').map((w) => ({ date: toDate(w.at)?.toISOString() || '', name: w.name, category: w.category, message: w.message, public_permission: !!w.public, status: w.status })), `tnc-wisdom-${today()}.csv`);
ACT.delDoc = async ({ col, id }) => { if (await confirmDlg('Delete permanently? This cannot be undone.', 'Delete', true)) { await deleteDoc(doc(db, col, id)); toast('Deleted'); log(`Deleted from ${col}`); } };

// ---------------- GUESTBOOK ----------------
VIEWS.guestbook = () => {
  const sf = fval('gbStatus'), q = fval('gbQ');
  const rows = sorted('guestbook').filter((g) => (!sf || g.status === sf) && match({ ...g, signature: '' }, q));
  return {
    html: `<div class="toolbar"><input type="search" placeholder="Search names…" data-f="gbQ" value="${esc(q)}" /><select data-f="gbStatus"><option value="">All</option>${opts(STATUS.moderation, sf)}</select><span class="muted small">${rows.length} entries</span><span class="sp"></span><button class="b b--ghost" data-act="exportGb">Export CSV</button><button class="b b--ghost" data-act="printGb">Print book</button></div>
    <div class="tiles">${rows.map((g) => `<div class="card gb">${g.signature ? `<img class="sig" src="${esc(g.signature)}" alt="Signature" />` : ''}<b>${esc(g.name)}</b><p>${esc(g.message || '')}</p>
      <div style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap">${pill(g.status)} ${g.public ? '<span class="st st--info">public OK</span>' : '<span class="st st--mute">private</span>'}</div>
      <small class="muted">${fmtDate(g.at)}</small>
      <div class="acts" style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.6rem">${g.status !== 'APPROVED' ? `<button class="b b--ok b--sm" data-act="gbSet" data-s="APPROVED" data-id="${g.id}">Approve</button>` : `<button class="b b--ghost b--sm" data-act="gbSet" data-s="PENDING" data-id="${g.id}">Hide</button>`}${g.status !== 'REJECTED' ? `<button class="b b--bad b--sm" data-act="gbSet" data-s="REJECTED" data-id="${g.id}">Reject</button>` : ''}${g.signature ? `<button class="b b--ghost b--sm" data-act="dlSig" data-id="${g.id}">PNG</button>` : ''}<button class="b b--ghost b--sm" data-act="delDoc" data-col="guestbook" data-id="${g.id}">Delete</button></div></div>`).join('') || '<div class="empty">No guestbook entries yet.</div>'}</div>`,
  };
};
ACT.gbSet = ({ id, s }) => upd('guestbook', id, { status: s }, `Guestbook entry → ${s}`);
ACT.dlSig = ({ id }) => { const g = find('guestbook', id); const a = document.createElement('a'); a.href = g.signature; a.download = `signature-${(g.name || 'guest').replace(/\W+/g, '-')}.png`; a.click(); };
ACT.exportGb = () => csv(sorted('guestbook').map((g) => ({ date: toDate(g.at)?.toISOString() || '', name: g.name, message: g.message, public_permission: !!g.public, has_signature: !!g.signature, status: g.status })), `tnc-guestbook-${today()}.csv`);
ACT.printGb = () => {
  const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print', true);
  const rows = sorted('guestbook').filter((g) => g.status !== 'REJECTED');
  w.document.write(`<html><head><title>Guestbook · The Next Chapter</title><link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@400;600&family=Great+Vibes&display=swap" rel="stylesheet"><style>body{font-family:Quicksand,sans-serif;color:#3A0010;padding:30px}h1{font-family:'Great Vibes';font-size:54px;text-align:center;margin:0 0 20px;color:#6D011A}.g{display:grid;grid-template-columns:1fr 1fr;gap:18px}.e{border:1px solid #eadfd0;border-radius:10px;padding:14px;break-inside:avoid}.e img{height:70px;max-width:100%;object-fit:contain}.e b{display:block}.e p{margin:.3rem 0 0;font-size:13px}</style></head><body><h1>Our Guestbook</h1><div class="g">${rows.map((g) => `<div class="e">${g.signature ? `<img src="${g.signature}">` : ''}<b>${esc(g.name)}</b><p>${esc(g.message || '')}</p></div>`).join('')}</div><script>setTimeout(()=>print(),800)<\/script></body></html>`);
  w.document.close();
};

// ---------------- INVITATIONS ----------------
VIEWS.invitations = () => {
  const inv = A.settings.invitation;
  return {
    html: `<div class="grid g-2">
      <div class="card"><h3>Invitation design</h3><p class="muted small">These details appear on every invitation visitors generate on the site.</p>
        <div class="f"><span>Default template</span><select id="iTpl">${opts(Object.entries(TEMPLATES).map(([k, t]) => [k, t.label]), inv.template)}</select></div>
        <label class="f"><span>Invitation message</span><textarea id="iMsg" rows="3" maxlength="300">${esc(inv.message)}</textarea></label>
        <label class="f"><span>Family details <em>(optional)</em></span><input id="iFam" value="${esc(inv.families || '')}" maxlength="160" /></label>
        <div class="f"><span>Invitation photo <small>(defaults to the hero image)</small></span><label class="uploader"><img id="iPhotoPrev" style="max-height:120px;border-radius:8px" alt="" /><span>Upload photo</span><input type="file" accept="image/*" id="iPhoto" /></label></div>
        <p class="muted small">Event title, date and venue come from <b>Content → Occasion</b>.</p>
        <div class="toolbar"><span class="sp"></span><button class="b b--primary" id="iSave">Save design</button></div></div>
      <div class="card"><h3>Personalised invitation</h3><p class="muted small">Generate a print-ready card for a specific guest.</p>
        <label class="f"><span>Guest name</span><input id="iName" placeholder="e.g. Uncle Peter" maxlength="60" /></label>
        <div class="preview-card" style="margin:0 auto 1rem"><canvas id="iPrev"></canvas></div>
        <div class="toolbar" style="justify-content:center"><button class="b b--ghost" id="iRefresh">Refresh preview</button><button class="b b--primary" data-act="invPdf" data-size="a5">A5 PDF</button><button class="b b--ghost" data-act="invPdf" data-size="a4">A4 PDF</button><button class="b b--ghost" data-act="invPng">PNG</button></div></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-h"><div><h3>Personalised invitation links</h3><p class="muted small">One name per line. Each guest gets a link that greets them by name and pre-fills their card.</p></div></div>
      <textarea id="iBulk" rows="4" style="width:100%;padding:.8em;border:1px solid var(--line);border-radius:10px" placeholder="Aunt Wanjiku&#10;Uncle Peter&#10;The Otieno Family"></textarea>
      <div class="toolbar" style="margin-top:.6rem"><button class="b b--primary" id="iLinks">Create links</button></div><div id="iLinkOut"></div></div>
    <div class="card" style="margin-top:16px"><div class="card-h"><h3>Generated invitations (${A.data.invitations.length})</h3><button class="b b--ghost" data-act="exportInv">Export CSV</button></div>
      ${table(['Created', 'Reference', 'Recipient', 'Template', 'Signed', ''], sorted('invitations').slice(0, 200).map((i) => `<tr><td>${fmtDate(i.at)}</td><td class="mono">${esc(i.ref)}</td><td>${esc(i.recipient || '-')}</td><td>${esc(i.template)}</td><td>${i.signature ? 'Yes' : '-'}</td><td><button class="b b--ghost b--sm" data-act="invRedo" data-id="${i.id}">Re-download</button></td></tr>`), 'No invitations generated yet.')}</div>`,
    after: () => {
      let photo = inv.photo || '';
      resolveMedia(photo || A.settings.couple.heroImage).then((s) => s && ($('#iPhotoPrev').src = s));
      $('#iPhoto').onchange = async (e) => { try { photo = await uploadMedia(e.target.files[0], 1600); $('#iPhotoPrev').src = await resolveMedia(photo); toast('Photo uploaded. Remember to save'); } catch (err) { toast(err.message, true); } };
      $('#iSave').onclick = async () => { await setDoc(doc(db, 'settings', 'site'), { invitation: { template: $('#iTpl').value, message: $('#iMsg').value.trim(), families: $('#iFam').value.trim(), photo } }, { merge: true }); A.settings.invitation = { ...A.settings.invitation, template: $('#iTpl').value, message: $('#iMsg').value.trim(), families: $('#iFam').value.trim(), photo }; toast('Invitation design saved'); log('Invitation design updated'); preview(); };
      const preview = async () => { A.invCanvas = await adminInvite($('#iName').value.trim(), A.invRef = makeRef('INV')); const c = $('#iPrev'); if (!c) return; c.width = 640; c.height = 907; c.getContext('2d').drawImage(A.invCanvas, 0, 0, 640, 907); };
      $('#iRefresh').onclick = preview; let t; $('#iName').oninput = () => { clearTimeout(t); t = setTimeout(preview, 450); }; $('#iTpl').onchange = () => { A.settings.invitation.template = $('#iTpl').value; preview(); };
      preview();
      $('#iLinks').onclick = () => {
        const names = $('#iBulk').value.split('\n').map((s) => s.trim()).filter(Boolean);
        $('#iLinkOut').innerHTML = table(['Guest', 'Link', ''], names.map((n) => { const link = `${SITE}?to=${encodeURIComponent(n)}`; const text = tpl(A.settings.share.whatsapp, { couple: coupleNames(), link }); return `<tr><td>${esc(n)}</td><td class="mono small">${esc(link)}</td><td><div class="acts"><button class="b b--ghost b--sm" data-act="copy" data-text="${esc(link)}">Copy</button><a class="b b--ghost b--sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">WhatsApp</a></div></td></tr>`; }));
      };
    },
  };
};
async function adminInvite(name, ref, signature = '', template, guestPhoto = '') {
  const st = A.settings, c = st.couple, o = st.occasion;
  const photo = await resolveMedia(st.invitation.photo || c.heroImage);
  return renderInvitation({ partnerA: c.partnerA, partnerB: c.partnerB, title: o.title, date: o.date, venue: o.venue, message: st.invitation.message, families: st.invitation.families, photo, recipient: name, ref, signature, guestPhoto, monogram: st.brand.monogram }, template || st.invitation.template);
}
ACT.invPdf = async ({ size }) => {
  if (!A.invCanvas) return;
  await setDoc(doc(db, 'invitations', A.invRef), { ref: A.invRef, recipient: $('#iName').value.trim(), template: A.settings.invitation.template, signature: '', vid: 'admin', at: serverTimestamp() });
  toPDF(A.invCanvas, { size, filename: `Invitation-${$('#iName').value.trim().replace(/\W+/g, '-') || 'Guest'}-${A.invRef}.pdf` });
};
ACT.invPng = () => A.invCanvas && toPNG(A.invCanvas, `Invitation-${A.invRef}.png`);
ACT.invRedo = async ({ id }) => { const i = find('invitations', id); toast('Rendering…'); const cv = await adminInvite(i.recipient, i.ref, i.signature, i.template, i.guestPhoto); toPDF(cv, { size: 'a5', filename: `Invitation-${i.ref}.pdf` }); };
ACT.exportInv = () => csv(sorted('invitations').map((i) => ({ date: toDate(i.at)?.toISOString() || '', ref: i.ref, recipient: i.recipient, template: i.template, signed: !!i.signature })), `tnc-invitations-${today()}.csv`);
ACT.copy = async ({ text }) => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Copy failed', true); } };

// ---------------- THANK-YOU NOTES ----------------
const TY_CATS = [['financial', 'Financial contribution'], ['gift', 'Gift'], ['wisdom', 'Advice & wisdom'], ['blessing', 'Blessings & prayers'], ['general', 'General participation']];
VIEWS.thankyou = () => {
  const ty = A.settings.thankyou;
  return {
    html: `<div class="grid g-2">
      <div class="card"><h3>Appreciation templates</h3><p class="muted small">The message used for each kind of participation. Notes are personal keepsakes, <b>not</b> payment receipts.</p>
        <div class="f"><span>Card design</span><select id="tyTpl">${opts(Object.entries(TEMPLATES).map(([k, t]) => [k, t.label]), A.settings.thankyouTemplate || 'ivory')}</select></div>
        ${TY_CATS.map(([k, l]) => `<label class="f"><span>${l}</span><textarea rows="2" data-ty="${k}" maxlength="400">${esc(ty[k])}</textarea></label>`).join('')}
        <label class="tog"><input type="checkbox" id="tyAuto" ${A.settings.autoThankYou !== false ? 'checked' : ''} /> Automatically create a note when participation is confirmed (payment verified, gift received, wisdom approved)</label>
        <div class="f"><span>Couple's signature <small>(optional, printed on notes)</small></span><canvas class="sigpad" id="cSig"></canvas><div class="toolbar" style="margin-top:.4rem"><button class="b b--ghost b--sm" id="cSigClear">Clear</button><span class="muted small" id="cSigState">${A.settings.couple.signature ? 'A signature is saved.' : 'No signature saved.'}</span></div></div>
        <div class="toolbar"><span class="sp"></span><button class="b b--primary" id="tySave">Save templates</button></div></div>
      <div class="card"><h3>Generate a note</h3>
        <div class="row"><label class="f"><span>Name</span><input id="tyName" maxlength="60" placeholder="Friend" /></label><label class="f"><span>Category</span><select id="tyCat">${opts(TY_CATS, 'general')}</select></label></div>
        <label class="f"><span>Custom message <em>(optional, overrides template)</em></span><textarea id="tyMsg" rows="2" maxlength="400"></textarea></label>
        <div class="preview-card" style="margin:0 auto 1rem"><canvas id="tyPrev"></canvas></div>
        <div class="toolbar" style="justify-content:center"><button class="b b--ghost" id="tyRefresh">Preview</button><button class="b b--primary" id="tyA5">A5 PDF</button><button class="b b--ghost" id="tyA4">A4 PDF</button></div></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-h"><h3>Generated notes (${A.data.thankyous.length})</h3><button class="b b--ghost" data-act="exportTy">Export CSV</button></div>
      ${table(['Created', 'Reference', 'Name', 'Category', 'Source', ''], sorted('thankyous').slice(0, 300).map((t) => `<tr><td>${fmtDate(t.at)}</td><td class="mono">${esc(t.ref)}</td><td>${esc(t.name)}</td><td>${esc(t.category)}</td><td>${t.auto ? 'Auto (admin)' : t.vid === 'admin' ? 'Admin' : 'Visitor download'}</td><td><button class="b b--ghost b--sm" data-act="tyRedo" data-id="${t.id}">Download</button></td></tr>`), 'No notes yet.')}</div>`,
    after: () => {
      const pad = sigPad($('#cSig'));
      $('#cSigClear').onclick = () => pad.clear();
      $('#tySave').onclick = async () => {
        const thankyou = {}; $$('[data-ty]').forEach((t) => (thankyou[t.dataset.ty] = t.value.trim()));
        const data = { thankyou, thankyouTemplate: $('#tyTpl').value, autoThankYou: $('#tyAuto').checked };
        if (!pad.isEmpty()) { const ref = await addDoc(collection(db, 'media'), { data: pad.toDataURL(), kind: 'signature', at: serverTimestamp(), by: A.user.uid }); data.couple = { signature: 'media:' + ref.id }; }
        await setDoc(doc(db, 'settings', 'site'), data, { merge: true });
        Object.assign(A.settings, { thankyou, thankyouTemplate: data.thankyouTemplate, autoThankYou: data.autoThankYou }); if (data.couple) A.settings.couple.signature = data.couple.signature;
        toast('Templates saved'); log('Thank-you templates updated'); prev();
      };
      const prev = async () => { A.tyCanvas = await adminThank($('#tyName').value.trim() || 'Friend', $('#tyCat').value, $('#tyMsg').value.trim(), A.tyRef = makeRef('TY')); const c = $('#tyPrev'); if (!c) return; c.width = 640; c.height = 907; c.getContext('2d').drawImage(A.tyCanvas, 0, 0, 640, 907); };
      $('#tyRefresh').onclick = prev; prev();
      const dl = async (size) => { await prev(); await addDoc(collection(db, 'thankyous'), { ref: A.tyRef, name: $('#tyName').value.trim() || 'Friend', category: $('#tyCat').value, message: $('#tyMsg').value.trim() || A.settings.thankyou[$('#tyCat').value], source: '', vid: 'admin', at: serverTimestamp() }); toPDF(A.tyCanvas, { size, filename: `Thank-You-${A.tyRef}.pdf` }); };
      $('#tyA5').onclick = () => dl('a5'); $('#tyA4').onclick = () => dl('a4');
    },
  };
};
async function adminThank(name, category, message, ref) {
  const st = A.settings;
  return renderThankYou({ name, category, message: message || st.thankyou[category] || st.thankyou.general, partnerA: st.couple.partnerA, partnerB: st.couple.partnerB, occasion: st.occasion.title, ref, photo: await resolveMedia(st.couple.heroImage), coupleSignature: await resolveMedia(st.couple.signature), monogram: st.brand.monogram, eventDate: st.occasion.date }, st.thankyouTemplate || 'ivory');
}
ACT.tyRedo = async ({ id }) => { const t = find('thankyous', id); const cv = await adminThank(t.name, t.category, t.message, t.ref); toPDF(cv, { size: 'a5', filename: `Thank-You-${t.ref}.pdf` }); };
ACT.tyFor = ({ cat, name }) => { A.sub.thankyou = null; $('[data-view=thankyou]').click(); setTimeout(() => { $('#tyName').value = name || ''; $('#tyCat').value = cat; $('#tyRefresh').click(); }, 100); };
ACT.exportTy = () => csv(sorted('thankyous').map((t) => ({ date: toDate(t.at)?.toISOString() || '', ref: t.ref, name: t.name, category: t.category, auto: !!t.auto })), `tnc-thankyou-notes-${today()}.csv`);

function sigPad(c) {
  const r = { width: c.offsetWidth, height: c.offsetHeight }, dpr = Math.min(devicePixelRatio || 1, 2);
  c.width = r.width * dpr; c.height = r.height * dpr; const ctx = c.getContext('2d'); ctx.scale(dpr, dpr);
  Object.assign(ctx, { strokeStyle: '#111', lineWidth: 2.4, lineCap: 'round', lineJoin: 'round' });
  let down = false, last, drawn = false;
  const p = (e) => { const b = c.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  c.onpointerdown = (e) => { down = true; last = p(e); c.setPointerCapture(e.pointerId); };
  c.onpointermove = (e) => { if (!down) return; const n = p(e); ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...n); ctx.stroke(); last = n; drawn = true; };
  c.onpointerup = () => (down = false);
  return { isEmpty: () => !drawn, clear: () => { ctx.clearRect(0, 0, c.width, c.height); drawn = false; }, toDataURL: () => c.toDataURL('image/png') };
}

// ---------------- CONTENT & SETTINGS ----------------
VIEWS.content = () => {
  const st = subtabs('content', [['story', 'Couple & story'], ['gallery', 'Gallery'], ['occasion', 'Occasion'], ['finance', 'Finance & M-Pesa'], ['texts', 'Website text'], ['messages', 'Reminders & sharing'], ['brand', 'Brand'], ['admins', 'Admins']]);
  const S = A.settings;
  const inp = (path, label, attrs = '') => `<label class="f"><span>${label}</span><input data-path="${path}" value="${esc(getPath(S, path) ?? '')}" ${attrs} /></label>`;
  const area = (path, label, rows = 3) => `<label class="f"><span>${label}</span><textarea data-path="${path}" rows="${rows}">${esc(getPath(S, path) ?? '')}</textarea></label>`;
  const photo = (path, label) => `<div class="f"><span>${label}</span><label class="uploader"><img data-photo-prev="${path}" style="max-height:130px;border-radius:8px" alt="" /><span>Upload new photo</span><input type="file" accept="image/*" data-photo="${path}" /></label><input type="hidden" data-path="${path}" value="${esc(getPath(S, path) || '')}" /></div>`;
  const save = '<div class="savebar"><button class="b b--primary" data-act="saveContent">Save changes</button></div>';
  let html = '';
  if (st.cur === 'story') {
    html = `<div class="card"><p class="section-title">The couple</p><div class="row">${inp('couple.partnerA', 'Partner one', 'maxlength="40"')}${inp('couple.partnerB', 'Partner two', 'maxlength="40"')}</div>
      <div class="row">${photo('couple.photoA', 'Partner one portrait')}${photo('couple.photoB', 'Partner two portrait')}${photo('couple.heroImage', 'Hero / cover image')}</div>
      <p class="section-title">Story</p>${area('couple.story', 'Our story', 5)}${area('couple.message', 'Personal message', 3)}
      <p class="section-title">Milestones</p><div id="msRows">${S.couple.milestones.map(msRow).join('')}</div><button class="b b--ghost b--sm" data-act="addMs">+ Add milestone</button>${save}</div>`;
  } else if (st.cur === 'gallery') {
    html = `<div class="card"><div class="card-h"><div><h3>Gallery: the 3D orbit</h3><p class="muted small">These images spin in the "Frames from our story" scene. 8–14 portrait images look best.</p></div></div>
      <div class="tiles" id="galTiles">${S.gallery.map((g, i) => galTile(g, i)).join('')}<label class="uploader"><span style="font-size:1.6rem">＋</span><span>Add photos</span><input type="file" accept="image/*" multiple id="galAdd" /></label></div>${save}</div>`;
  } else if (st.cur === 'occasion') {
    html = `<div class="card">${inp('occasion.title', 'Occasion title')}${inp('occasion.subtitle', 'Subtitle')}<div class="row">${inp('occasion.date', 'Date & time', 'type="datetime-local"')}${inp('occasion.venue', 'Venue')}</div>${inp('occasion.venueMapUrl', 'Map link (optional)', 'type="url" placeholder="https://maps.google.com/…"')}
      ${area('occasion.description', 'What the occasion means', 4)}${area('occasion.details', 'Additional information', 2)}<label class="tog"><input type="checkbox" data-path="occasion.showCountdown" ${S.occasion.showCountdown ? 'checked' : ''} /> Show countdown</label>${save}</div>`;
  } else if (st.cur === 'finance') {
    html = `<div class="card"><p class="section-title">Target</p><div class="row">${inp('finance.target', 'Financial target (KES)', 'type="number" min="0"')}${inp('finance.presets', 'Suggested amounts (comma separated)')}</div>
      <p class="section-title">M-Pesa</p><label class="tog"><input type="checkbox" data-path="finance.mpesaEnabled" ${S.finance.mpesaEnabled ? 'checked' : ''} /> Enable automatic M-Pesa STK Push</label>
      ${inp('finance.stkEndpoint', 'STK Push endpoint', 'placeholder="/api/stkPush"')}<p class="muted small">Daraja credentials live only on the server (Cloud Function secrets), never here. See README.</p>
      <p class="section-title">Manual payment fallback</p><p class="muted small">Shown when the STK prompt is unavailable. Such payments stay <b>PENDING</b> until you verify them.</p>
      <div class="row">${inp('finance.paybill', 'Paybill number')}${inp('finance.account', 'Account name')}${inp('finance.till', 'Or Till number')}</div>${save}</div>`;
  } else if (st.cur === 'texts') {
    html = `<div class="card"><p class="section-title">Five-minute agreement</p>${inp('texts.agreementTitle', 'Title')}${area('texts.agreementBody', 'Body', 2)}${inp('texts.agreementLabel', 'Agreement checkbox label')}
      <p class="section-title">Sections</p>${area('texts.participateIntro', 'Participation intro', 2)}${area('texts.impactIntro', 'Collective impact intro', 2)}${area('texts.guestbookIntro', 'Guestbook intro', 2)}${area('texts.finale', 'Closing credits line', 2)}${save}</div>`;
  } else if (st.cur === 'messages') {
    html = `<div class="card"><p class="section-title">WhatsApp sharing</p>${area('share.whatsapp', 'Share message: use {couple} and {link}', 3)}
      <p class="section-title">Reminder messages</p><p class="muted small">Placeholders: {name}, {couple}, {gift}, {date}, {amount}. An opt-out link is added automatically. Keep them gentle.</p>
      ${area('reminders.pledge', 'Pledge reminder', 3)}${area('reminders.gift', 'Gift reminder', 3)}${area('reminders.collection', 'Collection follow-up', 2)}${area('reminders.call', 'Call request follow-up', 2)}${save}</div>`;
  } else if (st.cur === 'brand') {
    html = `<div class="card"><div class="row">${inp('brand.title', 'Site title')}${inp('brand.monogram', 'Coin monogram (1–3 letters)', 'maxlength="3"')}</div>${inp('brand.tagline', 'Tagline (shown under the loader title)')}
      <p class="muted small">The coin that rolls in on load is engraved with this monogram.</p>${save}</div>`;
  } else if (st.cur === 'admins') {
    html = `<div class="card"><h3>Administrators</h3><p class="muted small">To add someone: they create an account on this admin page (it will say "Not authorised" and show their ID). Paste that ID here.</p>
      ${table(['Email / label', 'Role', 'UID', ''], A.data.admins.map((a) => `<tr><td>${esc(a.email || '-')}</td><td>${esc(a.role || 'admin')}</td><td class="mono small">${esc(a.id)}</td><td>${a.id !== A.user.uid && a.role !== 'owner' ? `<button class="b b--bad b--sm" data-act="rmAdmin" data-id="${a.id}">Remove</button>` : '<span class="muted small">you / owner</span>'}</td></tr>`))}
      <div class="row" style="margin-top:1rem"><label class="f"><span>User ID</span><input id="newAdminUid" class="mono" /></label><label class="f"><span>Email / label</span><input id="newAdminEmail" /></label></div><button class="b b--primary" data-act="addAdmin">Add admin</button></div>`;
  }
  return {
    html: st.html + html,
    after: () => {
      $$('[data-photo-prev]').forEach(async (img) => { const s = await resolveMedia(getPath(A.settings, img.dataset.photoPrev)); if (s) img.src = s; });
      $$('[data-photo]').forEach((inp) => (inp.onchange = async (e) => {
        try { toast('Uploading…'); const id = await uploadMedia(e.target.files[0], 1600); $(`input[type=hidden][data-path="${inp.dataset.photo}"]`).value = id; $(`[data-photo-prev="${inp.dataset.photo}"]`).src = await resolveMedia(id); toast('Uploaded. Click save to apply'); } catch (err) { toast(err.message, true); }
      }));
      $$('#galTiles img[data-src]').forEach(async (i) => { i.src = await resolveMedia(i.dataset.src); });
      const ga = $('#galAdd');
      if (ga) ga.onchange = async (e) => {
        toast('Uploading photos…');
        for (const f of e.target.files) { try { const id = await uploadMedia(f, 1400); A.settings.gallery.push({ src: id, caption: '' }); } catch (err) { toast(err.message, true); } }
        collectGallery(true); render(true); toast('Added. Remember to save');
      };
    },
  };
};
const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
function setPath(o, p, v) { const ks = p.split('.'); let x = o; ks.slice(0, -1).forEach((k) => (x = x[k] ??= {})); x[ks.at(-1)] = v; }
const msRow = (m) => `<div class="ms-row"><input data-ms="year" value="${esc(m.year)}" placeholder="Year" /><input data-ms="title" value="${esc(m.title)}" placeholder="Title" /><input data-ms="text" value="${esc(m.text)}" placeholder="Description" /><button class="b b--bad b--sm" data-act="rmMs">×</button></div>`;
const galTile = (g, i) => `<div class="tile" data-gi="${i}"><img data-src="${esc(g.src)}" alt="" /><div class="tile-b"><input data-gcap value="${esc(g.caption || '')}" placeholder="Caption" /><div class="acts"><button class="b b--ghost b--sm" data-act="galMove" data-i="${i}" data-d="-1" aria-label="Move left">←</button><button class="b b--ghost b--sm" data-act="galMove" data-i="${i}" data-d="1" aria-label="Move right">→</button><button class="b b--bad b--sm" data-act="galRm" data-i="${i}">Remove</button></div></div></div>`;
function collectGallery(keep) { const caps = $$('[data-gcap]'); if (caps.length) caps.forEach((c, i) => { if (A.settings.gallery[i]) A.settings.gallery[i].caption = c.value; }); return keep; }
ACT.addMs = () => $('#msRows').insertAdjacentHTML('beforeend', msRow({ year: '', title: '', text: '' }));
ACT.rmMs = (_, b) => b.closest('.ms-row').remove();
ACT.galMove = ({ i, d }) => { collectGallery(); const g = A.settings.gallery, a = +i, z = a + +d; if (z < 0 || z >= g.length) return; [g[a], g[z]] = [g[z], g[a]]; render(true); };
ACT.galRm = ({ i }) => { collectGallery(); A.settings.gallery.splice(+i, 1); render(true); };
ACT.saveContent = async () => {
  const data = {};
  $$('[data-path]').forEach((el) => {
    let v = el.type === 'checkbox' ? el.checked : el.value.trim();
    if (el.dataset.path === 'finance.target') v = Math.max(0, +v || 0);
    if (el.dataset.path === 'finance.presets') v = String(v).split(',').map((x) => Math.round(+x.trim())).filter((x) => x > 0);
    if (el.dataset.path === 'brand.monogram') v = String(v).toUpperCase().slice(0, 3);
    setPath(data, el.dataset.path, v);
  });
  if ($('#msRows')) data.couple = { ...(data.couple || {}), milestones: $$('.ms-row').map((r) => ({ year: $('[data-ms=year]', r).value.trim(), title: $('[data-ms=title]', r).value.trim(), text: $('[data-ms=text]', r).value.trim() })).filter((m) => m.title || m.year) };
  if ($('#galTiles')) { collectGallery(); data.gallery = A.settings.gallery; }
  await setDoc(doc(db, 'settings', 'site'), data, { merge: true });
  A.settings = mergeDeep(A.settings, data);
  if (data.finance?.target != null) syncStats(false);
  toast('Saved. The website is updated ✓'); log('Website content updated');
};
ACT.addAdmin = async () => {
  const uid = $('#newAdminUid').value.trim(); if (!/^[A-Za-z0-9]{20,40}$/.test(uid)) return toast('That does not look like a valid user ID', true);
  await setDoc(doc(db, 'admins', uid), { email: $('#newAdminEmail').value.trim(), role: 'admin', addedBy: A.user.email, at: serverTimestamp() }); toast('Admin added'); log('Admin added');
};
ACT.rmAdmin = async ({ id }) => { if (await confirmDlg('Remove this admin?', 'Remove', true)) { await deleteDoc(doc(db, 'admins', id)); toast('Admin removed'); log('Admin removed'); } };

// ---------------- REPORTS ----------------
VIEWS.reports = () => {
  const s = computeStats(), d = A.data;
  const R = [
    ['Financial contributions (confirmed)', d.contributions.filter((c) => c.status === 'SUCCESS').length, 'repConfirmed'],
    ['Payment transactions (all statuses)', d.contributions.length, 'exportTx'],
    ['Outstanding pledges', s.pledgeCount, 'repOutstanding'],
    ['All pledges', d.pledges.length, 'exportPl'],
    ['Gift offers (all)', d.giftOffers.length, 'exportGifts'],
    ['Gifts received', s.giftsReceived, 'repReceived'],
    ['Custom gift submissions', d.giftOffers.filter((g) => g.type === 'custom').length, 'repCustom'],
    ['Gift collection requests', d.giftOffers.filter((g) => g.type === 'collection').length, 'repCollection'],
    ['Call requests', d.requests.length, 'exportCalls'],
    ['Reminders', d.reminders.length, 'exportRem'],
    ['Wisdom messages', d.wisdom.length, 'exportWisdom'],
    ['Guestbook entries', d.guestbook.length, 'exportGb'],
    ['Invitations generated', d.invitations.length, 'exportInv'],
    ['Thank-you notes', d.thankyous.length, 'exportTy'],
    ['Visitor participation (sessions)', d.visits.length, 'repVisits'],
  ];
  return {
    html: `<div class="card" style="margin-bottom:16px"><div class="card-h"><div><h3>Summary</h3><p class="muted small">Generated ${new Date().toLocaleString('en-GB')}</p></div><button class="b b--ghost" onclick="print()">Print summary</button></div>
      <div class="grid g-4"><div><span class="muted small">Confirmed</span><h3>${money(s.confirmedTotal)}</h3></div><div><span class="muted small">Pledged (outstanding)</span><h3>${money(s.pledgedOutstanding)}</h3></div><div><span class="muted small">Remaining to target</span><h3>${money(Math.max(s.target - s.confirmedTotal, 0))}</h3></div><div><span class="muted small">Participants</span><h3>${s.participants}</h3></div></div></div>
      ${table(['Report', 'Records', ''], R.map(([l, n, a]) => `<tr><td>${l}</td><td class="num">${n}</td><td><button class="b b--ghost b--sm" data-act="${a}">Export CSV</button></td></tr>`))}`,
  };
};
ACT.repConfirmed = () => csv(sorted('contributions').filter((c) => c.status === 'SUCCESS').map((c) => ({ confirmed_at: toDate(c.confirmedAt || c.at)?.toISOString() || '', ref: c.ref, name: nameOf(c), amount: c.amount, method: c.method || 'STK', mpesa_receipt: c.mpesaRef })), `tnc-confirmed-contributions-${today()}.csv`);
ACT.repOutstanding = () => csv(sorted('pledges').filter((p) => ['PENDING', 'REMINDER_SENT'].includes(p.status)).map((p) => ({ ref: p.ref, name: p.name, phone: p.phone, amount: p.amount, remind_on: p.date, status: p.status })), `tnc-outstanding-pledges-${today()}.csv`);
const giftRep = (fn, name) => () => csv(sorted('giftOffers').filter(fn).map((g) => ({ date: toDate(g.at)?.toISOString() || '', gift: g.giftName, description: g.description, name: g.name, phone: g.phone, location: g.location || '', status: g.status, received_at: toDate(g.receivedAt)?.toISOString() || '' })), `tnc-${name}-${today()}.csv`);
ACT.repReceived = giftRep((g) => g.status === 'RECEIVED', 'gifts-received');
ACT.repCustom = giftRep((g) => g.type === 'custom', 'custom-gifts');
ACT.repCollection = giftRep((g) => g.type === 'collection', 'collection-requests');
ACT.repVisits = () => csv(sorted('visits').map((v) => ({ date: toDate(v.at)?.toISOString() || '', device: v.device, referrer: v.ref, invited_as: v.invite, agreed: !!v.agreed, participated: !!v.participated, sections_viewed: (v.sections || []).length })), `tnc-visitor-participation-${today()}.csv`);

// ---------------- PUBLIC NUMBERS (manual adjustments) ----------------
const ADJ = [
  ['confirmedTotal', 'Confirmed contributions', true, 'Money received outside the site (cash, bank, direct M-Pesa)'],
  ['confirmedCount', 'People who contributed', false, 'Everyone who gave money outside the site (count of people)'],
  ['pledgedOutstanding', 'Outstanding pledges', true, 'Promises made in person or by phone'],
  ['giftsReceived', 'Gifts received', false, 'Gifts handed over directly'],
  ['wisdomApproved', 'Words of wisdom & blessings', false, 'Messages received by card, WhatsApp, in person'],
  ['participants', 'People who took part', false, 'Everyone who joined in outside the site'],
];
VIEWS.numbers = () => {
  const s = computeStats(), adj = A.settings.impactAdjust || {};
  return {
    html: `<div class="card" style="margin-bottom:16px"><h3>What the public sees on the Collective Impact page</h3>
      <p class="muted small" style="margin:.3rem 0 0">Many people give, pledge or gift outside the website. Add those here so the public numbers tell the full story.
      Type either an <b>adjustment</b> (use a minus sign to reduce) or the exact number you want <b>shown publicly</b>. The other updates automatically.
      Your real records in Finance and Gifts are never changed, and reports still export the tracked figures.</p></div>
      <div class="tbl-wrap adj-table"><table><thead><tr><th>Number</th><th>Tracked by the site</th><th>Adjustment (+ / −)</th><th>Shown publicly</th></tr></thead><tbody>
      ${ADJ.map(([k, label, isMoney, hint]) => `<tr data-k="${k}" data-base="${+s[k] || 0}"><td><b>${label}</b><br><small class="muted">${hint}</small></td>
        <td class="num">${isMoney ? money(s[k]) : (+s[k] || 0)}</td>
        <td><input type="number" step="1" data-adj="${k}" value="${+adj[k] || 0}" /></td>
        <td><input type="number" step="1" min="0" data-show="${k}" value="${Math.max(0, (+s[k] || 0) + (+adj[k] || 0))}" /> <span class="delta" data-delta="${k}"></span></td></tr>`).join('')}
      </tbody></table></div>
      <p class="muted small" style="margin-top:.8rem">Target progress on the website uses the publicly shown confirmed amount. Pledges are always shown separately as promises, never as money received.</p>
      <div class="savebar"><button class="b b--ghost" id="adjReset">Reset all to tracked</button><button class="b b--primary" id="adjSave">Save public numbers</button></div>`,
    after: () => {
      const rowOf = (k) => $(`tr[data-k="${k}"]`);
      const paint = (k) => { const a = +$(`[data-adj="${k}"]`).value || 0, d = $(`[data-delta="${k}"]`); d.textContent = a ? (a > 0 ? `+${a.toLocaleString()}` : a.toLocaleString()) : ''; d.className = 'delta ' + (a > 0 ? 'up' : 'down'); };
      ADJ.forEach(([k]) => {
        const base = +rowOf(k).dataset.base;
        $(`[data-adj="${k}"]`).addEventListener('input', (e) => { $(`[data-show="${k}"]`).value = Math.max(0, base + Math.round(+e.target.value || 0)); paint(k); });
        $(`[data-show="${k}"]`).addEventListener('input', (e) => { $(`[data-adj="${k}"]`).value = Math.max(0, Math.round(+e.target.value || 0)) - base; paint(k); });
        paint(k);
      });
      $('#adjReset').onclick = () => ADJ.forEach(([k]) => { $(`[data-adj="${k}"]`).value = 0; $(`[data-show="${k}"]`).value = rowOf(k).dataset.base; paint(k); });
      $('#adjSave').onclick = async () => {
        const impactAdjust = {}; ADJ.forEach(([k]) => (impactAdjust[k] = Math.round(+$(`[data-adj="${k}"]`).value || 0)));
        try {
          await setDoc(doc(db, 'settings', 'site'), { impactAdjust }, { merge: true });
          A.settings.impactAdjust = impactAdjust;
          toast('Public numbers updated. The website shows them right away'); log('Public impact numbers adjusted');
        } catch (err) { toast('Could not save: ' + (err.message || 'check your connection'), true); }
      };
    },
  };
};

// ---------------- ACTIVITY ----------------
VIEWS.activity = () => {
  const q = fval('aQ');
  const rows = sorted('activity').filter((a) => match(a, q));
  return { html: `<div class="toolbar"><input type="search" placeholder="Filter…" data-f="aQ" value="${esc(q)}" /><span class="muted small">Latest ${rows.length} events</span></div>${table(['When', 'Type', 'Event', 'By'], rows.map((a) => `<tr><td>${fmtDate(a.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td><td>${esc(a.type)}</td><td>${esc(a.label)}</td><td class="mono small">${esc(a.type === 'admin' ? a.vid : 'visitor')}</td></tr>`))}` };
};

// ---------------------------------------------------------------------------
// LOCAL PREVIEW: http://localhost:PORT/admin/#demo shows the dashboard with sample data.
// Only on localhost; nothing is written (no Firestore listeners are attached).
// ---------------------------------------------------------------------------
if (['localhost', '127.0.0.1'].includes(location.hostname) && location.hash === '#demo') {
  const day = (n, h = 12) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h); return d; };
  const names = ['Aunt Wanjiku', 'Peter Otieno', 'Grace M.', 'Kevin', 'Mama Njeri', 'Brian K.', 'Faith', 'Uncle Sam', 'Diana', 'Tom'];
  const pick = (a, i) => a[i % a.length];
  const D = A.data;
  D.contributions = Array.from({ length: 14 }, (_, i) => ({ id: 'c' + i, ref: 'TNC-' + (100000 + i * 7919).toString(36).toUpperCase().slice(0, 6), name: pick(names, i), anonymous: i % 5 === 0, phone: '2547' + String(12345678 + i).slice(0, 8), amount: [500, 1000, 2000, 5000, 10000][i % 5], method: i % 4 ? 'STK' : 'MANUAL', status: i < 10 ? 'SUCCESS' : i < 12 ? 'PENDING' : 'FAILED', mpesaRef: i < 10 ? 'SLK' + (4000 + i) + 'XYZ' : '', vid: 'V' + i, at: day(i * 2), confirmedAt: day(i * 2) }));
  D.pledges = Array.from({ length: 6 }, (_, i) => ({ id: 'p' + i, ref: 'PL-' + (900 + i), name: pick(names, i + 3), phone: '2547' + String(22345678 + i).slice(0, 8), amount: [3000, 5000, 10000, 2000][i % 4], date: day(-i * 3 + 2).toISOString().slice(0, 10), status: i === 5 ? 'PAID' : i === 4 ? 'REMINDER_SENT' : 'PENDING', reminderStatus: 'SCHEDULED', reminderId: 'r' + i, vid: 'VP' + i, at: day(i + 1) }));
  D.reminders = D.pledges.map((p, i) => ({ id: 'r' + i, kind: 'pledge', refId: p.id, name: p.name, phone: p.phone, date: p.date, status: i === 4 ? 'SENT' : i === 5 ? 'CANCELLED' : 'SCHEDULED', consent: true, vid: p.vid, at: p.at }));
  D.gifts = DEFAULT_GIFTS.map((g, i) => ({ id: 'g' + i, ...g, order: i + 1, active: i < 14 }));
  D.giftOffers = [
    { id: 'o1', type: 'suggested', giftName: 'Premium Cookware Set', name: 'Grace M.', phone: '254712000111', arrangement: "I'll deliver it myself", message: 'Cook with love!', status: 'OFFERED', vid: 'VG1', at: day(1) },
    { id: 'o2', type: 'custom', giftName: 'Dining table', description: 'I have a beautiful dining table I would love you to have.', name: 'Uncle Sam', phone: '254722000222', arrangement: 'Please collect it from me', status: 'ARRANGEMENT_PENDING', vid: 'VG2', at: day(3) },
    { id: 'o3', type: 'collection', giftName: 'Microwave', description: 'Microwave', name: 'Diana', phone: '254733000333', location: 'Kilimani', date: day(-4).toISOString().slice(0, 10), status: 'COLLECTION_REQUESTED', vid: 'VG3', at: day(2) },
    { id: 'o4', type: 'suggested', giftName: 'Air Fryer', name: 'Tom', status: 'RECEIVED', vid: 'VG4', at: day(9) },
    { id: 'o5', type: 'suggested', giftName: 'Modern Tea Set', name: 'Faith', status: 'RECEIVED', vid: 'VG5', at: day(12) },
  ];
  D.requests = [{ id: 'q1', kind: 'call', name: 'Mama Njeri', phone: '254711000444', bestTime: 'Evenings', giftName: 'Washing Machine', status: 'OPEN', vid: 'VQ1', at: day(1) }];
  D.giftReveals = Array.from({ length: 30 }, (_, i) => ({ id: 'gr' + i, giftName: pick(DEFAULT_GIFTS, i * 3).name, number: (i % 16) + 1, at: day(i % 20) }));
  D.wisdom = [
    { id: 'w1', name: 'Grandma Rose', category: 'Marriage advice', message: 'Never go to bed angry. Talk it out, even if it takes all night.', public: true, status: 'PENDING', vid: 'VW1', at: day(0) },
    { id: 'w2', name: 'Peter', category: 'Funny marriage lessons', message: 'Learn to say "you are right" in three languages.', public: true, status: 'APPROVED', vid: 'VW2', at: day(2) },
    { id: 'w3', name: '', category: 'Prayers and blessings', message: 'May your home be filled with peace and laughter.', public: false, status: 'APPROVED', vid: 'VW3', at: day(4) },
  ];
  D.guestbook = [{ id: 'b1', name: 'Diana', message: 'So happy for you both!', public: true, status: 'PENDING', signature: '', vid: 'VB1', at: day(1) }, { id: 'b2', name: 'Kevin', message: 'Congratulations!', public: true, status: 'APPROVED', signature: '', vid: 'VB2', at: day(5) }];
  D.invitations = [{ id: 'INV-DEMO01', ref: 'INV-DEMO01', recipient: 'Uncle Peter', template: 'noir', at: day(2) }];
  D.thankyous = [{ id: 't1', ref: 'TY-DEMO01', name: 'Grace M.', category: 'gift', message: '', at: day(1) }];
  D.visits = Array.from({ length: 160 }, (_, i) => ({ id: 'v' + i, at: day(Math.floor((i * 7) % 30), 10), device: i % 3 ? 'mobile' : 'desktop', agreed: i % 4 !== 0, participated: i % 5 === 0, invite: i % 6 === 0 ? 'Guest' : '' }));
  D.activity = [{ id: 'a1', type: 'payment', label: 'Payment confirmed: KES 5,000', at: day(0, 15) }, { id: 'a2', type: 'wisdom', label: 'Wisdom shared: Marriage advice', at: day(0, 11) }, { id: 'a3', type: 'pledge', label: 'Pledge recorded: KES 10,000', at: day(1) }];
  D.admins = [{ id: 'demo', email: 'demo@localhost', role: 'owner' }];
  A.user = { uid: 'demo', email: 'demo@localhost (preview)' };
  A.settings = structuredClone(DEFAULT_SETTINGS);
  syncStats = async () => {}; // eslint-disable-line no-func-assign
  $('#whoami').textContent = A.user.email;
  showOnly('app'); updateBadges(); render();
  toast('Preview mode: sample data, nothing is saved');
}
