// THE NEXT CHAPTER: public experience
import {
  db, doc, getDoc, setDoc, addDoc, updateDoc, collection, getDocs, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, arrayUnion, loadSettings, track, makeRef, visitorId, money,
  normalizePhone, esc, compressImage, rateOk, logActivity, withTimeout,
} from './fb.js';
import { DEFAULT_GIFTS } from './defaults.js';
import { renderInvitation, renderThankYou, renderReceipt, toPDF, toPNG, printCanvas, TEMPLATES, sealRim } from './cards.js';
import { icon } from './icons.js';

const { gsap, ScrollTrigger } = window;
gsap.registerPlugin(ScrollTrigger);

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const params = new URLSearchParams(location.search);
const get = (o, path) => path.split('.').reduce((a, k) => a?.[k], o);

const S = {
  settings: null, gifts: [], stats: {}, vid: visitorId(), sid: null, lenis: null,
  invSig: null, invRef: null, invTemplate: 'noir', mediaCache: new Map(),
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function splitChars(el) {
  if (!el || el.dataset.splitDone) return [];
  const text = el.textContent;
  el.textContent = '';
  el.setAttribute('aria-label', text);
  const chars = [];
  text.split(/(\s+)/).forEach((part) => {
    if (/^\s+$/.test(part)) { el.appendChild(document.createTextNode(' ')); return; }
    const w = document.createElement('span'); w.className = 'word'; w.setAttribute('aria-hidden', 'true');
    [...part].forEach((c) => { const s = document.createElement('span'); s.className = 'char'; s.textContent = c; w.appendChild(s); chars.push(s); });
    el.appendChild(w);
  });
  el.dataset.splitDone = '1';
  return chars;
}
function splitWords(el) {
  const text = el.textContent.trim(); el.textContent = '';
  return text.split(/\s+/).map((w, i) => {
    const s = document.createElement('span'); s.className = 'word'; s.textContent = w;
    el.appendChild(s); el.appendChild(document.createTextNode(' ')); return s;
  });
}

let toastT;
function toast(msg, err = false, ico) {
  const t = $('#toast'); t.innerHTML = icon(ico || (err ? 'alert' : 'checkCircle')) + `<span>${esc(msg)}</span>`; t.classList.toggle('is-err', err); t.classList.add('is-on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('is-on'), 3800);
}

async function resolveSrc(src) {
  if (!src || !String(src).startsWith('media:')) return src;
  const id = src.slice(6);
  if (S.mediaCache.has(id)) return S.mediaCache.get(id);
  try { const d = await withTimeout(getDoc(doc(db, 'media', id)), 4000, 'media'); const v = d.exists() ? d.data().data : ''; S.mediaCache.set(id, v); return v; } catch { return ''; }
}

function coupleNames() { const c = S.settings.couple; return `${c.partnerA} & ${c.partnerB}`; }

function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h; }

function lockScroll(on) { if (on) S.lenis?.stop(); else S.lenis?.start(); }

// ---------------------------------------------------------------------------
// Visitor session tracking (no accounts, no personal data)
// ---------------------------------------------------------------------------
async function startVisit() {
  try {
    S.sid = sessionStorage.getItem('tnc_sid');
    if (S.sid) return;
    S.sid = makeRef('S') + Date.now().toString(36).toUpperCase();
    sessionStorage.setItem('tnc_sid', S.sid);
    await setDoc(doc(db, 'visits', S.sid), {
      vid: S.vid, at: serverTimestamp(), lastAt: serverTimestamp(),
      ref: (document.referrer || 'direct').slice(0, 120),
      device: /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
      invite: (params.get('to') || '').slice(0, 60), agreed: false, sections: [], participated: false,
    });
  } catch (e) { console.warn('[TNC] visit', e.message); }
}
function visitUpdate(data) { if (S.sid) updateDoc(doc(db, 'visits', S.sid), { ...data, lastAt: serverTimestamp() }).catch(() => {}); }
const seen = new Set();
function sectionSeen(name) { if (seen.has(name)) return; seen.add(name); visitUpdate({ sections: arrayUnion(name) }); track('section_view', { section: name }); }
function participated(kind) { visitUpdate({ participated: true }); track('participate', { kind }); }

// ---------------------------------------------------------------------------
// LOADER: coin rolls in from the right → spins → unveils THE NEXT CHAPTER
// ---------------------------------------------------------------------------
function runLoader(ready) {
  return new Promise((resolve) => {
    const coin = $('#coin'), track = $('.coin-track'), shadow = $('.coin-shadow');
    const lines = $$('.loader-title .lt-line');
    const chars = lines.flatMap((l) => splitChars(l));
    const repeat = sessionStorage.getItem('tnc_seen_loader');
    const dist = Math.min(innerWidth * 0.62, 900);
    const turns = (dist / (Math.PI * 168)) * 360;

    gsap.set(track, { x: dist });
    gsap.set(coin, { rotationZ: turns });
    gsap.set(chars, { yPercent: 115, opacity: 0 });
    gsap.set('.loader-title', { autoAlpha: 0, height: 0 });

    const speed = reduce ? 0.25 : repeat ? 0.7 : 1;
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
    tl.timeScale(1 / speed);
    tl.to('#loaderBar', { scaleX: 0.6, duration: 1.2, ease: 'power1.inOut' }, 0)
      .to(track, { x: 0, duration: 1.15, ease: 'power3.out' }, 0.05)
      .to(coin, { rotationZ: 0, duration: 1.15, ease: 'power3.out' }, 0.05)
      .fromTo(shadow, { opacity: 0, scaleX: .4 }, { opacity: 1, scaleX: 1, duration: 1 }, 0.05)
      .to(track, { y: -18, duration: .16, ease: 'power2.out' }, 1.15)
      .to(track, { y: 0, duration: .36, ease: 'bounce.out' }, 1.31)
      .to('.coin-shine', { backgroundPosition: '-60% 0', duration: .7, ease: 'power2.inOut' }, 1.35)
      .to(coin, { rotationY: 360, duration: .85, ease: 'power3.inOut' }, 1.4)
      .addLabel('unveil', 2.1)
      .to(track, { scale: .42, y: -12, duration: .75, ease: 'expo.inOut' }, 'unveil')
      .to(shadow, { opacity: 0, duration: .3 }, 'unveil')
      .to('.loader-title', { autoAlpha: 1, height: 'auto', duration: .75, ease: 'expo.inOut' }, 'unveil')
      .to(chars, { yPercent: 0, opacity: 1, duration: .8, stagger: 0.03, ease: 'expo.out' }, 'unveil+=0.2')
      .to('.loader-tag', { opacity: 1, y: 0, duration: .6 }, 'unveil+=0.6')
      .to('#loaderBar', { scaleX: 0.9, duration: .8 }, 'unveil');

    Promise.all([ready, new Promise((r) => tl.eventCallback('onComplete', r))]).then(() => {
      sessionStorage.setItem('tnc_seen_loader', '1');
      // the words have settled: go straight into the consent form
      S.onCurtain?.();
      const out = gsap.timeline({ onComplete: () => { $('#loader').remove(); resolve(); } });
      out.to('#loaderBar', { scaleX: 1, duration: .2 })
        .to('.loader-stage', { yPercent: -18, opacity: 0, duration: .6, ease: 'power3.in' }, 0)
        .to('.loader-progress', { opacity: 0, duration: .2 }, 0)
        .to('.loader-curtain--l', { xPercent: -100, duration: .95, ease: 'expo.inOut' }, .15)
        .to('.loader-curtain--r', { xPercent: 100, duration: .95, ease: 'expo.inOut' }, .15);
    });
  });
}

// ---------------------------------------------------------------------------
// GATE: the five-minute agreement
// ---------------------------------------------------------------------------
function gateNeeded() { return true; } // the agreement is mandatory on every visit

function showGate() {
  return new Promise((resolve) => {
    const gate = $('#gate'); gate.hidden = false;
    document.body.classList.add('is-gated');
    const card = $('.gate-card', gate), bye = $('.gate-bye', gate);
    gsap.fromTo('.gate-bg img', { scale: 1.35 }, { scale: 1.12, duration: 3, ease: 'power2.out' });
    gsap.from(card.children, { y: 40, opacity: 0, duration: 1.1, stagger: .08, ease: 'expo.out', delay: .35 });
    const box = $('#agreeBox'), go = $('#agreeGo');
    let autoT; box.addEventListener('change', () => { go.disabled = !box.checked; clearTimeout(autoT); $('#agreeHint').textContent = box.checked ? 'Wonderful. Here we go…' : 'Tick the box to begin'; if (box.checked) autoT = setTimeout(() => leave('agreed'), 700); });
    let left = false;
    const leave = (mode) => {
      if (left) return; left = true;
      if (mode === 'agreed') S.autoAdvance = true;
      try { sessionStorage.setItem('tnc_gate', mode); } catch { /* ignore */ }
      if (mode === 'agreed') { visitUpdate({ agreed: true }); track('agree_journey'); logActivity('agree', 'Agreed to walk the journey'); }
      else track('skip_intro');
      gsap.timeline({ onComplete: () => { gate.remove(); document.body.classList.remove('is-gated'); resolve(); } })
        .to(card, { y: -60, opacity: 0, duration: .7, ease: 'expo.in' })
        .to(gate, { clipPath: 'inset(0 0 100% 0)', duration: 1.1, ease: 'expo.inOut' }, '-=.2');
    };
    go.addEventListener('click', () => leave('agreed'));
    $('#gateExit').addEventListener('click', () => {
      track('exit_intro');
      gsap.to(card, { opacity: 0, y: 20, duration: .4, onComplete: () => { card.hidden = true; bye.hidden = false; gsap.from(bye, { opacity: 0, y: 20, duration: .6 }); } });
    });
    $('#gateBack').addEventListener('click', () => { bye.hidden = true; card.hidden = false; gsap.fromTo(card, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: .6 }); });
  });
}

// ---------------------------------------------------------------------------
// Content binding
// ---------------------------------------------------------------------------
async function applySettings() {
  const st = S.settings;
  $$('[data-bind]').forEach((el) => { const v = get(st, el.dataset.bind); if (v != null && typeof v !== 'object') el.textContent = v; });
  await Promise.all($$('[data-bind-src]').map(async (el) => { const v = await resolveSrc(get(st, el.dataset.bindSrc)); if (v) el.src = v; }));
  $$('[data-monogram]').forEach((el) => (el.textContent = (st.brand.monogram || 'M').slice(0, 3)));
  if ((st.brand.monogram || '').length > 1) $$('[data-monogram]').forEach((el) => el.classList.add('coin-letter--sm'));
  document.title = `${st.brand.title.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase())} · ${coupleNames()}`;

  const to = (params.get('to') || '').trim().slice(0, 40);
  if (to) { $('#heroGreeting').textContent = `Dear ${to}, you are invited`; $('#invName').value = to; }

  const d = new Date(st.occasion.date);
  if (!isNaN(d)) {
    $('#heroDate').textContent = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    $('#odDay').textContent = d.getDate();
    $('#odMonth').textContent = d.toLocaleDateString('en-GB', { month: 'long' });
    $('#odYear').textContent = d.getFullYear();
    $('#odTime').textContent = d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  if (st.occasion.venueMapUrl) { const a = $('#venueMap'); a.href = st.occasion.venueMapUrl; a.hidden = false; }
  $('#countdown').hidden = !st.occasion.showCountdown;
  $('#yr').textContent = new Date().getFullYear();
  $('#mTarget').textContent = money(st.finance.target);
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------
function buildMilestones() {
  const track = $('#reelTrack');
  track.innerHTML = S.settings.couple.milestones.map((m) =>
    `<article class="ms"><i class="ms-dot"></i><div class="ms-year">${esc(m.year)}</div><h4>${esc(m.title)}</h4><p>${esc(m.text)}</p></article>`).join('') +
    `<article class="ms ms--end"><span>to be continued…</span></article>`;
}

async function buildOrbit() {
  const ring = $('#orbitRing');
  const items = await Promise.all(S.settings.gallery.map(async (g) => ({ ...g, src: await resolveSrc(g.src) })));
  const list = items.filter((g) => g.src);
  ring.innerHTML = list.map((g, i) => `<button class="orbit-card" data-i="${i}" aria-label="${esc(g.caption || 'Photo')}"><img src="${esc(g.src)}" alt="${esc(g.caption || '')}" loading="lazy" /></button>`).join('');
  S.orbitItems = list;
}

function buildChips() {
  const wrap = $('#amountChips'), input = $('#formNow [name=amount]');
  wrap.innerHTML = S.settings.finance.presets.map((a) => `<button type="button" class="chip" data-amt="${a}">${money(a)}</button>`).join('') + `<button type="button" class="chip" data-amt="">Custom</button>`;
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    $$('.chip', wrap).forEach((c) => c.classList.toggle('is-on', c === b));
    input.value = b.dataset.amt; if (!b.dataset.amt) input.focus();
  });
  input.addEventListener('input', () => $$('.chip', wrap).forEach((c) => c.classList.toggle('is-on', c.dataset.amt === input.value)));
}

function buildWisdomCats() {
  const wrap = $('#wisdomCats');
  wrap.innerHTML = S.settings.wisdomCategories.map((c, i) => `<button type="button" class="pill${i === 0 ? ' is-on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
  wrap.addEventListener('click', (e) => { const b = e.target.closest('.pill'); if (!b) return; $$('.pill', wrap).forEach((p) => p.classList.toggle('is-on', p === b)); });
}

async function loadGifts() {
  let gifts = [];
  try {
    const snap = await withTimeout(getDocs(query(collection(db, 'gifts'), where('active', '==', true))), 2500, 'gifts');
    gifts = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  } catch (e) { console.warn('[TNC] gifts', e.message); }
  if (!gifts.length) gifts = DEFAULT_GIFTS.map((g, i) => ({ id: `default-${i}`, ...g }));
  await Promise.all(gifts.map(async (g) => { g.img = await resolveSrc(g.img); }));
  S.gifts = gifts;
}

// ---------------------------------------------------------------------------
// INTRO (after loader/gate)
// ---------------------------------------------------------------------------
let introPlayed = false;
async function playIntro() {
  if (introPlayed) return; introPlayed = true;
  await S.scenesReady;
  document.body.classList.remove('is-loading');
  S.lenis?.start();
  ScrollTrigger.refresh();
  const chars = $$('.hero-title .ht').flatMap((el) => splitChars(el));
  const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
  tl.fromTo('.hero-media img', { scale: 1.45, filter: 'brightness(.12) contrast(1.15) saturate(.6) blur(8px)' }, { scale: 1.12, filter: 'brightness(.62) contrast(1.15) saturate(.6) blur(0px)', duration: 2.8, ease: 'power3.out' }, 0)
    .from('.letterbox--top', { yPercent: -100, duration: 1.2 }, 0)
    .from('.letterbox--bot', { yPercent: 100, duration: 1.2 }, 0)
    .from('.hero-eyebrow', { y: 20, opacity: 0, duration: 1 }, .5)
    .from(chars, { yPercent: 120, rotateX: -80, opacity: 0, duration: 1.4, stagger: .05, clearProps: 'transform,opacity' }, .6)
    .from('.hero-names', { y: 30, opacity: 0, duration: 1.2 }, 1.3)
    .from('.hero-meta > *, .hero-scroll', { opacity: 0, y: 14, duration: 1, stagger: .1 }, 1.6)
    .from('#nav', { yPercent: -120, duration: 1.2 }, 1.4);
  if (params.get('optout')) setTimeout(() => optOutFlow(params.get('optout')), 900);
  // after agreeing, glide on to Chapter I by itself (unless the visitor already started scrolling)
  if (S.autoAdvance && !params.get('optout')) {
    tl.eventCallback('onComplete', () => setTimeout(() => {
      if (scrollY > 40) return;
      const st = ScrollTrigger.getAll().find((t) => t.trigger === $('#story') && t.pin);
      const target = st ? st.start + (st.end - st.start) * 0.55 : '#story';
      S.lenis ? S.lenis.scrollTo(target, { duration: 3.6, easing: (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2) }) : $('#story').scrollIntoView({ behavior: 'smooth' });
    }, 900));
  }
}

// ---------------------------------------------------------------------------
// SCROLL SCENES
// ---------------------------------------------------------------------------
function initScenes() {
  const mm = gsap.matchMedia();

  // global progress
  gsap.to('.scene-progress i', { scaleX: 1, ease: 'none', scrollTrigger: { trigger: 'main', start: 'top top', end: 'bottom bottom', scrub: true } });

  // HERO: dolly into the moon, bars open, title drifts away
  gsap.timeline({ scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom top', scrub: true } })
    .to('.hero-media img', { scale: 1.75, yPercent: 8, ease: 'none' }, 0)
    .to('.hero-content', { yPercent: -45, opacity: 0, scale: .92, ease: 'none' }, 0)
    .to('.hero-scroll, .hero-meta', { opacity: 0, ease: 'none' }, 0)
    .to('.letterbox--top', { scaleY: 0, ease: 'none' }, 0)
    .to('.letterbox--bot', { scaleY: 0, ease: 'none' }, 0);

  // TITLE CARDS: pinned intertitles that rise, hold, then push through the camera
  $$('.title-card').forEach((card) => {
    const chars = splitChars($('.tc-title', card));
    const ghost = $('.tc-ghost', card); if (ghost) ghost.textContent = card.dataset.chapter || '';
    gsap.fromTo($('.tc-bg img', card) || [], { scale: 1.25 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: card, start: 'top bottom', end: 'bottom top', scrub: true } });
    gsap.fromTo(ghost || [], { scale: .7, opacity: 0 }, { scale: 1.1, opacity: 1, ease: 'none', scrollTrigger: { trigger: card, start: 'top 80%', end: 'top top', scrub: true } });
    gsap.timeline({ scrollTrigger: { trigger: card, start: 'top top', end: '+=85%', pin: true, scrub: 0.6, onEnter: () => sectionSeen(card.id) } })
      .from($('.tc-num', card), { letterSpacing: '1.4em', opacity: 0, duration: .4 })
      .from(chars, { yPercent: 130, rotateX: -90, opacity: 0, stagger: .03, duration: .5, ease: 'power3.out' }, '<.05')
      .from($('.tc-sub', card) || [], { y: 30, opacity: 0, duration: .3 }, '-=.2')
      .from($('.tc-line', card), { scaleY: 0, duration: .3 }, '-=.2')
      .to({}, { duration: .35 })
      .to($('.tc-inner', card), { scale: 1.3, opacity: .0, filter: 'blur(6px)', duration: .45, ease: 'power2.in' })
      .to(ghost || [], { scale: 1.6, opacity: 0, duration: .45, ease: 'power2.in' }, '<');
  });

  // STORY: portraits reveal like a projector shutter; text lights up word by word
  $$('.portrait').forEach((p, i) => {
    gsap.fromTo($('.portrait-img', p), { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', ease: 'none', scrollTrigger: { trigger: p, start: 'top 90%', end: 'top 35%', scrub: true } });
    gsap.fromTo($('img', p), { scale: 1.5, yPercent: -10 }, { scale: 1, yPercent: 0, ease: 'none', scrollTrigger: { trigger: p, start: 'top bottom', end: 'bottom top', scrub: true } });
    gsap.to(p, { yPercent: i ? -18 : 10, ease: 'none', scrollTrigger: { trigger: '.story-couple', start: 'top bottom', end: 'bottom top', scrub: true } });
    gsap.from($('figcaption', p), { y: 40, opacity: 0, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: p, start: 'top 50%' } });
  });
  gsap.fromTo('.story-amp', { rotate: -25, scale: .5, opacity: 0 }, { rotate: 0, scale: 1, opacity: 1, ease: 'none', scrollTrigger: { trigger: '.story-couple', start: 'top 80%', end: 'center center', scrub: true } });
  const words = splitWords($('#storyText'));
  if (!reduce) gsap.to(words, { opacity: 1, stagger: .1, ease: 'none', scrollTrigger: { trigger: '#storyText', start: 'top 80%', end: 'bottom 45%', scrub: true } });
  gsap.from('.story-msg', { y: 60, opacity: 0, duration: 1.4, ease: 'expo.out', scrollTrigger: { trigger: '.story-msg', start: 'top 85%', onEnter: () => sectionSeen('story-text') } });

  // MILESTONES: pinned horizontal reel
  const track = $('#reelTrack');
  const reelTween = gsap.to(track, {
    x: () => -(track.scrollWidth - innerWidth), ease: 'none',
    scrollTrigger: { trigger: '#milestones', start: 'top top', end: () => '+=' + Math.max(track.scrollWidth - innerWidth, 400), pin: true, scrub: 0.8, invalidateOnRefresh: true, onEnter: () => sectionSeen('milestones') },
  });
  $$('.ms').forEach((m) => {
    gsap.from($('.ms-year', m) || m, { yPercent: 60, opacity: 0, ease: 'power2.out', scrollTrigger: { trigger: m, containerAnimation: reelTween, start: 'left 95%', end: 'left 55%', scrub: true } });
  });

  initOrbit();

  // OCCASION
  gsap.fromTo('.occ-bg', { yPercent: -10 }, { yPercent: 10, ease: 'none', scrollTrigger: { trigger: '.occasion', start: 'top bottom', end: 'bottom top', scrub: true } });
  gsap.from('.occ-main > *', { y: 50, opacity: 0, duration: 1.2, stagger: .12, ease: 'expo.out', scrollTrigger: { trigger: '.occasion', start: 'top 65%', onEnter: () => sectionSeen('occasion-details') } });
  gsap.from('.od-day', { yPercent: 100, opacity: 0, duration: 1.6, ease: 'expo.out', scrollTrigger: { trigger: '.occ-side', start: 'top 75%' } });
  gsap.from('.od-rest > *, .occ-venue, .countdown > div', { x: 30, opacity: 0, duration: 1, stagger: .08, ease: 'expo.out', scrollTrigger: { trigger: '.occ-side', start: 'top 70%' } });

  // DOORS
  gsap.from('.door', { y: 90, rotateX: -18, opacity: 0, duration: 1.2, stagger: .12, ease: 'expo.out', scrollTrigger: { trigger: '.doors', start: 'top 95%' } });

  // GIVE: split-screen wipe
  gsap.fromTo('.give-left', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 1.4, ease: 'expo.inOut', scrollTrigger: { trigger: '#give', start: 'top 70%', onEnter: () => sectionSeen('give') } });
  gsap.from('.give-left > *', { x: -40, opacity: 0, duration: 1.2, stagger: .1, delay: .5, ease: 'expo.out', scrollTrigger: { trigger: '#give', start: 'top 70%' } });
  gsap.from('.give-right > *', { y: 40, opacity: 0, duration: 1.1, stagger: .1, ease: 'expo.out', scrollTrigger: { trigger: '.give-right', start: 'top 75%' } });

  // SHOWCASE + NUMBERS
  gsap.from('.sc-blob-wrap', { scale: .6, rotate: -12, opacity: 0, duration: 1.6, ease: 'expo.out', scrollTrigger: { trigger: '#gifts', start: 'top 70%', onEnter: () => sectionSeen('gifts') } });
  gsap.from('.sc-copy > *', { y: 40, opacity: 0, duration: 1.1, stagger: .08, ease: 'expo.out', scrollTrigger: { trigger: '.sc-copy', start: 'top 80%' } });
  ScrollTrigger.create({ trigger: '#gifts', start: 'top 80%', end: 'bottom 20%', onToggle: (s) => (s.isActive ? startShowcase() : stopShowcase()) });
  gsap.from('.console', { y: 60, opacity: 0, duration: 1.1, ease: 'expo.out', scrollTrigger: { trigger: '#console', start: 'top 85%' } });
  gsap.from('.tile', { y: 30, scale: .6, opacity: 0, duration: .7, ease: 'back.out(2)', stagger: { each: .025, from: 'start' }, clearProps: 'transform,opacity', scrollTrigger: { trigger: '#tiles', start: 'top 85%', onEnter: startAttract, onLeaveBack: stopAttract, onEnterBack: startAttract, onLeave: stopAttract } });

  // WISDOM
  gsap.from('.wisdom-form-wrap > *', { y: 40, opacity: 0, duration: 1.1, stagger: .08, ease: 'expo.out', scrollTrigger: { trigger: '#wisdom', start: 'top 70%', onEnter: () => sectionSeen('wisdom') } });
  gsap.from('.wall', { x: 200, opacity: 0, duration: 1.6, ease: 'expo.out', scrollTrigger: { trigger: '.wall', start: 'top 85%' } });

  // IMPACT
  const ih = $('.impact-head h2'); const ic = splitChars(ih);
  gsap.from(ic, { yPercent: 110, opacity: 0, duration: 1.2, stagger: .03, ease: 'expo.out', scrollTrigger: { trigger: '.impact', start: 'top 70%', onEnter: () => sectionSeen('impact') } });
  ScrollTrigger.create({ trigger: '.impact-grid', start: 'top 80%', once: true, onEnter: () => { S.impactVisible = true; renderStats(true); } });
  gsap.from('.stat', { y: 40, opacity: 0, duration: 1, stagger: .1, ease: 'expo.out', scrollTrigger: { trigger: '.stats', start: 'top 85%' } });

  // GUESTBOOK: the book opens
  mm.add('(min-width: 961px)', () => {
    gsap.timeline({ scrollTrigger: { trigger: '.guestbook', start: 'top 80%', end: 'top 15%', scrub: 1, onEnter: () => sectionSeen('guestbook') } })
      .fromTo('.gb-book', { rotateX: 35, y: 120, scale: .85 }, { rotateX: 0, y: 0, scale: 1, ease: 'none' }, 0)
      .fromTo('.gb-page--left', { rotateY: 75 }, { rotateY: 0, ease: 'none' }, 0);
  });
  mm.add('(max-width: 960px)', () => {
    gsap.from('.gb-book', { y: 80, opacity: 0, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: '.guestbook', start: 'top 80%', onEnter: () => sectionSeen('guestbook') } });
  });

  // INVITATION: card swings in
  gsap.fromTo('.inv-card', { rotateY: -40, rotateX: 12, y: 120, opacity: 0 }, { rotateY: 0, rotateX: 0, y: 0, opacity: 1, ease: 'none', scrollTrigger: { trigger: '#invite', start: 'top 85%', end: 'top 25%', scrub: 1, onEnter: () => { sectionSeen('invite'); renderInvite(); } } });
  gsap.from('.inv-copy > *', { y: 40, opacity: 0, duration: 1.1, stagger: .08, ease: 'expo.out', scrollTrigger: { trigger: '.inv-copy', start: 'top 80%' } });

  // SHARE
  gsap.from('.share > *', { y: 40, opacity: 0, duration: 1.1, stagger: .08, ease: 'expo.out', scrollTrigger: { trigger: '.share', start: 'top 75%', onEnter: () => sectionSeen('share') } });

  // FINALE: credits roll, letterbox closes
  gsap.timeline({ scrollTrigger: { trigger: '.finale', start: 'top top', end: 'bottom bottom', scrub: true, onEnter: () => sectionSeen('finale') } })
    .fromTo('.credits > *', { y: '35vh', opacity: 0 }, { y: 0, opacity: 1, stagger: .08, ease: 'power2.out' }, 0)
    .fromTo('.letterbox', { scaleY: 0 }, { scaleY: 1, immediateRender: false, ease: 'none' }, .3);

  // THE END: fireworks + thanks, once per visit
  ScrollTrigger.create({ trigger: '.finale', start: 'center center', once: true, onEnter: () => { fireworks(9); confetti(null, 160); toast(`Thank you for walking with us. With love, ${coupleNames()}`, false, "heart"); track('journey_complete'); } });

  // GUESTBOOK SEAL: stamped when the book opens
  ScrollTrigger.create({ trigger: '.guestbook', start: 'top 45%', once: true, onEnter: () => {
    gsap.fromTo('#gbSeal', { scale: 2.6, opacity: 0, rotate: -60 }, { scale: 1, opacity: 1, rotate: -14, duration: .9, ease: 'back.out(2.2)', delay: .4 });
    gsap.fromTo('.gb-book', { x: 0 }, { keyframes: { x: [0, -4, 4, -2, 0] }, duration: .35, delay: 1.05 });
  } });

  // Pinned scenes must be measured top-to-bottom, otherwise later pins ignore the
  // spacing of earlier ones and leave dead black gaps between chapters.
  const order = new Map([...document.querySelectorAll('main *, main')].map((e, i) => [e, i]));
  ScrollTrigger.sort((a, b) => (order.get(a.trigger) ?? 1e9) - (order.get(b.trigger) ?? 1e9));

  // Nav hide/show
  let lastY = 0;
  ScrollTrigger.create({
    start: 0, end: 'max',
    onUpdate: (self) => {
      const y = self.scroll();
      $('#nav').classList.toggle('is-hidden', y > lastY && y > innerHeight * .6);
      $('#nav').classList.toggle('is-solid', y > innerHeight * .5);
      lastY = y;
    },
  });
}

// ---------------------------------------------------------------------------
// CURVED CAROUSEL: photos ride the inside of a curve (edges come closer), drifting on their own.
// Drag/swipe sideways to browse, tap to view full size. No scroll pinning: scrolling moves on to the next chapter.
// ---------------------------------------------------------------------------
function initOrbit() {
  const ring = $('#orbitRing'), stage = $('#orbitStage'), src = $$('.orbit-card', ring);
  if (!src.length) return;
  const n = src.length;
  let cards = [], R = 900, cw = 220, step = .3, total = 1;
  const layout = () => {
    const w = stage.clientWidth || innerWidth, h = stage.clientHeight || innerHeight * .5;
    cw = Math.round(Math.max(130, Math.min(w < 640 ? w * .46 : w * .19, h * .62, 280)));
    R = Math.max(380, Math.min(w * .68, 1000));
    stage.style.perspective = Math.round(R * 1.15) + 'px';
    step = (cw * 1.1) / R;
    // repeat the photos until the curve is longer than what's visible, so it loops seamlessly
    const copies = Math.ceil(Math.max(n, Math.ceil((Math.PI * 1.1) / step)) / n);
    if (cards.length !== n * copies) {
      ring.innerHTML = Array.from({ length: copies }, () => src.map((c) => c.outerHTML).join('')).join('');
      cards = $$('.orbit-card', ring);
    }
    total = cards.length * step;
    cards.forEach((c) => c.style.setProperty('--cw', cw + 'px'));
  };
  layout();
  addEventListener('resize', layout);

  const st = { off: 0, vel: 0, hover: false, visible: false };
  const pxToRad = (px) => px / R;
  let down = false, lx = 0, moved = 0;
  stage.addEventListener('pointerdown', (e) => { down = true; lx = e.clientX; moved = 0; st.vel = 0; });
  addEventListener('pointermove', (e) => { if (!down) return; const dx = e.clientX - lx; lx = e.clientX; moved += Math.abs(dx); st.off -= pxToRad(dx); st.vel = -pxToRad(dx); });
  addEventListener('pointerup', () => { down = false; });
  addEventListener('pointercancel', () => { down = false; });
  stage.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') st.hover = true; });
  stage.addEventListener('pointerleave', () => { st.hover = false; });
  stage.addEventListener('click', (e) => { const c = e.target.closest('.orbit-card'); if (c && moved < 6) openLightbox(+c.dataset.i); });

  // entrance: the strip rises and opens up as the section scrolls in (no pin)
  gsap.fromTo(stage, { opacity: 0, y: 90, scale: .9 }, { opacity: 1, y: 0, scale: 1, ease: 'none', scrollTrigger: { trigger: '#gallery', start: 'top 85%', end: 'top 25%', scrub: true } });
  ScrollTrigger.create({ trigger: '#gallery', start: 'top 70%', onEnter: () => sectionSeen('gallery') });
  new IntersectionObserver(([en]) => { st.visible = en.isIntersecting; }, { rootMargin: '100px' }).observe(stage);

  let lastIdx = -1;
  const maxA = 1.25; // radians either side of centre that are drawn
  gsap.ticker.add(() => {
    if (!st.visible) return;
    if (!down) { st.off += st.vel; st.vel *= 0.93; if (Math.abs(st.vel) < 1e-5) st.vel = 0; }
    if (!reduce && !down && !st.hover) st.off += pxToRad(0.55);
    let best = 0, bestA = 9;
    for (let k = 0; k < cards.length; k++) {
      let a = (k * step - st.off) % total; if (a < -total / 2) a += total; if (a >= total / 2) a -= total;
      const c = cards[k];
      if (Math.abs(a) > maxA) { if (c.style.visibility !== 'hidden') c.style.visibility = 'hidden'; continue; }
      if (c.style.visibility === 'hidden') c.style.visibility = '';
      const x = R * Math.sin(a), z = R * (1 - Math.cos(a)) - 60;
      c.style.transform = `translate3d(${x.toFixed(1)}px,0,${z.toFixed(1)}px) rotateY(${(-a).toFixed(4)}rad)`;
      c.style.zIndex = String(1000 - Math.round(Math.abs(a) * 100));
      if (Math.abs(a) < bestA) { bestA = Math.abs(a); best = +c.dataset.i; }
    }
    if (best !== lastIdx) {
      lastIdx = best;
      const cap = $('#orbitCaption'); cap.textContent = S.orbitItems[best]?.caption || ' ';
      gsap.fromTo(cap, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .5 });
    }
  });
}

function openLightbox(i) {
  const list = S.orbitItems, n = list.length; if (!n) return;
  i = ((i % n) + n) % n;
  const g = list[i];
  openModal(`<figure class="lb"><img src="${esc(g.src)}" alt="${esc(g.caption || '')}" />
    ${n > 1 ? `<button class="lb-nav lb-prev" data-lb="${i - 1}" aria-label="Previous photo">‹</button><button class="lb-nav lb-next" data-lb="${i + 1}" aria-label="Next photo">›</button>` : ''}
    <figcaption>${esc(g.caption || '')}</figcaption><p class="lb-count">${i + 1} / ${n}</p></figure>`, true);
  $$('#modalBody [data-lb]').forEach((b) => b.addEventListener('click', () => openLightbox(+b.dataset.lb)));
  const key = (e) => { if (e.key === 'ArrowRight') openLightbox(i + 1); if (e.key === 'ArrowLeft') openLightbox(i - 1); };
  addEventListener('keydown', key);
  let sx = null; const box = $('#modalBody .lb');
  box.addEventListener('pointerdown', (e) => { sx = e.clientX; });
  box.addEventListener('pointerup', (e) => { if (sx !== null && Math.abs(e.clientX - sx) > 50 && !e.target.closest('.lb-nav')) openLightbox(i + (e.clientX < sx ? 1 : -1)); sx = null; });
  S.modalCleanup = () => removeEventListener('keydown', key);
}

// ---------------------------------------------------------------------------
// GIFT SHOWCASE: morphing blob, gifts fly in and out
// ---------------------------------------------------------------------------
const blob = { r: Array(8).fill(220), rot: 0 };
function blobPath(r, rot) {
  const n = r.length, cx = 300, cy = 300, pts = r.map((rad, i) => { const a = (i / n) * Math.PI * 2 + rot; return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]; });
  let d = '';
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    if (i === 0) d += `M${p1[0].toFixed(1)},${p1[1].toFixed(1)}`;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d + 'Z';
}
function drawBlob() { $('#blobPath').setAttribute('d', blobPath(blob.r, blob.rot)); }

let scIdx = 0, scTimer = null;
function buildShowcase() {
  const list = S.gifts.filter((g) => g.img);
  S.scGifts = list.length ? list : S.gifts;
  $('#scList').innerHTML = S.scGifts.map((g, i) => `<button aria-label="${esc(g.name)}" data-i="${i}">${g.img ? `<img src="${esc(g.img)}" alt="" loading="lazy" />` : icon('gift')}</button>`).join('');
  $('#scList').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; stopShowcase(); showGift(+b.dataset.i); startShowcase(); });
  drawBlob();
  showGift(0, true);
  if (!reduce) {
    gsap.to('.sc-float--a', { y: -30, x: 10, duration: 3, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    gsap.to('.sc-float--b', { y: 24, x: -14, duration: 2.4, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    gsap.to('.sc-float--c', { y: -18, rotate: 30, duration: 3.6, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    gsap.to(blob, { rot: Math.PI * 2, duration: 40, repeat: -1, ease: 'none', onUpdate: drawBlob });
  }
}
function showGift(i, first = false) {
  const list = S.scGifts; if (!list.length) return;
  scIdx = (i + list.length) % list.length;
  const g = list[scIdx];
  const color = g.color || '#6D011A';
  const sec = $('#gifts'), img = $('#scImg img'), name = $('#scName');
  sec.style.setProperty('--sc-color', color);
  sec.style.backgroundColor = `color-mix(in srgb, ${color} 14%, #f3efe6)`;
  $$('#scList button').forEach((b) => b.classList.toggle('is-on', +b.dataset.i === scIdx));
  const target = blob.r.map(() => 190 + Math.random() * 80);
  gsap.to(blob.r, { ...Object.fromEntries(target.map((v, k) => [k, v])), duration: 1.4, ease: 'elastic.out(1,.6)', onUpdate: drawBlob });
  if (first) { img.src = g.img || ''; name.textContent = g.name; return; }
  gsap.timeline()
    .to(img, { x: 160, y: -120, rotate: 28, scale: .55, opacity: 0, duration: .55, ease: 'power3.in' })
    .to(name, { y: -30, opacity: 0, duration: .4, ease: 'power2.in' }, 0)
    .add(() => { img.src = g.img || ''; name.textContent = g.name; })
    .fromTo(img, { x: -120, y: 160, rotate: -22, scale: .5, opacity: 0 }, { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1, duration: 1.1, ease: 'expo.out' })
    .fromTo(name, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: .9, ease: 'expo.out' }, '<.1')
    .fromTo('.sc-float', { scale: 0 }, { scale: 1, duration: .8, stagger: .08, ease: 'back.out(2)' }, '<');
}
function startShowcase() { if (scTimer || reduce) return; scTimer = setInterval(() => showGift(scIdx + 1), 3200); }
function stopShowcase() { clearInterval(scTimer); scTimer = null; }

// ---------------------------------------------------------------------------
// NUMBERS GAME + SCRATCH & REVEAL
// ---------------------------------------------------------------------------
function usedNumbers() { try { return JSON.parse(localStorage.getItem('tnc_used') || '{}'); } catch { return {}; } }
const HOOKS = [
  ['Oops!', "Now you're on the hook."],
  ['Bro.', 'No backing out now.'],
  ['Bold move!', 'We like you already.'],
  ['Gotcha!', 'The universe has spoken.'],
  ['Eish!', 'This one is serious business.'],
  ['Locked in!', 'Your number chose you, not the other way round.'],
  ['Too late!', 'No refunds on curiosity.'],
  ['Ayee!', 'The couple is watching. Act natural.'],
];
const KUDOS = ['Great taste, legend.', 'Look at you, generous soul.', 'The couple will love this.', 'Main character energy.', 'Absolute class move.', 'Certified good friend.'];
const rand = (a) => a[Math.floor(Math.random() * a.length)];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let gameBusy = false, attractT = null;

function lcd(num, msg) {
  if (num != null) $('#lcdNum').textContent = num;
  if (msg != null) { const m = $('#lcdMsg'); m.textContent = msg; gsap.fromTo(m, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: .4 }); }
}
function startAttract() { /* kept calm on purpose */ }
function stopAttract() { clearInterval(attractT); attractT = null; }

function buildTiles() {
  const count = +S.settings.game?.tiles || Math.min(Math.max(S.gifts.length, 12), 30);
  const rnd = mulberry(hash(S.vid));
  const order = Array.from({ length: count }, (_, i) => i % S.gifts.length);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  S.tileMap = order;
  const used = usedNumbers();
  $('#tiles').innerHTML = order.map((_, i) => `<button class="tile${used[i + 1] ? ' is-used' : ''}" data-n="${i + 1}" aria-label="Number ${i + 1}${used[i + 1] ? ' (revealed)' : ''}"><span>${i + 1}</span>${used[i + 1] ? icon('check') : ''}</button>`).join('');
  $('#tiles').addEventListener('pointermove', (e) => { const t = e.target.closest('.tile'); if (!t) return; const r = t.getBoundingClientRect(); t.style.setProperty('--mx', `${e.clientX - r.left}px`); t.style.setProperty('--my', `${e.clientY - r.top}px`); });
  $('#tiles').addEventListener('click', (e) => { const t = e.target.closest('.tile'); if (t) pickNumber(+t.dataset.n, t); });
}

function hookBanner(title, line) {
  const el = document.createElement('div');
  el.className = 'hook';
  el.innerHTML = `${icon('hook')}<b>${esc(title)}</b><span>${esc(line)}</span>`;
  document.body.appendChild(el);
  gsap.timeline({ onComplete: () => el.remove() })
    .fromTo(el, { scale: .3, rotate: -10, opacity: 0 }, { scale: 1, rotate: 0, opacity: 1, duration: .55, ease: 'back.out(2.4)' })
    .fromTo($('.ico', el), { rotate: -40, y: -30 }, { rotate: 0, y: 0, duration: .8, ease: 'elastic.out(1,.4)' }, 0)
    .to(el, { y: -80, opacity: 0, duration: .5, ease: 'power2.in' }, '+=1.1');
}

async function pickNumber(n, tile) {
  const gift = S.gifts[S.tileMap[n - 1]];
  if (gameBusy) return;
  if (usedNumbers()[n]) { lcd(String(n).padStart(2, '0'), 'Already yours. Here it is again.'); openScratch(n, gift); return; }
  gameBusy = true; stopAttract();
  track('gift_pick', { number: n });
  tile.classList.add('is-pressed'); setTimeout(() => tile.classList.remove('is-pressed'), 160);
  const [h1, h2] = rand(HOOKS);
  lcd(String(n).padStart(2, '0'), `${h1} ${h2}`);
  const con = $('#console'); con.classList.remove('is-shake'); void con.offsetWidth; con.classList.add('is-shake');
  if (!reduce) {
    hookBanner(h1, h2);
    // chase lights that slow down like a roulette
    const tiles = $$('.tile');
    for (let i = 0; i < 18; i++) {
      const t = tiles[Math.floor(Math.random() * tiles.length)];
      t.classList.add('is-lit'); await wait(45 + i * 9); t.classList.remove('is-lit');
    }
    lcd(null, 'Drum roll...');
    for (const c of ['3', '2', '1']) { lcd(c); gsap.fromTo('#lcdNum', { scale: 1.7, opacity: .3 }, { scale: 1, opacity: 1, duration: .38, ease: 'back.out(3)' }); await wait(430); }
  }
  tile.classList.add('is-pick');
  gsap.fromTo(tile, { scale: 1.25 }, { scale: 1, duration: .6, ease: 'elastic.out(1,.4)', clearProps: 'transform' });
  await wait(450);
  tile.classList.remove('is-pick'); tile.classList.add('is-used');
  if (!tile.querySelector('.ico')) tile.insertAdjacentHTML('beforeend', icon('check'));
  lcd(String(n).padStart(2, '0'), 'Now scratch your card!');
  gameBusy = false;
  openScratch(n, gift, true);
}

function openScratch(n, gift, fresh = false) {
  const already = usedNumbers()[n];
  openModal(`
    <p class="eyebrow">Number ${n}</p>
    <h3>${already ? 'Your revealed gift idea' : 'Scratch to reveal'}</h3>
    <div class="scratch-stage" id="scStage">
      <div class="scratch" id="scratch">
        <div class="scratch-under" style="--su-color:${esc(gift.color || '#6D011A')}">
          <div class="su-img">${gift.img ? `<img src="${esc(gift.img)}" alt="" />` : `<span class="su-ph">${icon('gift')}</span>`}</div>
          <div class="su-txt"><h4>${esc(gift.name)}</h4><p>${esc(gift.note || gift.category || '')}</p></div>
        </div>
        <canvas id="scratchCanvas" aria-label="Scratch card: drag to scratch, or press Enter"></canvas>
      </div>
    </div>
    <p class="scratch-hint" id="scratchHint">Use your finger or mouse to scratch</p>
    <div id="scratchAfter" hidden></div>
  `);
  if (fresh && !reduce) gsap.from('#scratch', { y: 240, rotate: -18, scale: .5, opacity: 0, duration: 1.1, ease: 'back.out(1.5)', delay: .1 });
  const wrap = $('#scratch'), canvas = $('#scratchCanvas'), stage = $('#scStage');
  const reveal = () => {
    if (wrap.classList.contains('is-done')) return;
    wrap.classList.add('is-done'); $('#scratchHint').hidden = true;
    stage.classList.add('is-live');
    if (!already) {
      const u = usedNumbers(); u[n] = gift.id; try { localStorage.setItem('tnc_used', JSON.stringify(u)); } catch { /* ignore */ }
      addDoc(collection(db, 'giftReveals'), { giftId: gift.id, giftName: gift.name, number: n, vid: S.vid, at: serverTimestamp() }).catch(() => {});
      track('gift_reveal', { gift: gift.name });
      // KUDOS moment
      const k = document.createElement('div'); k.className = 'kudos';
      k.innerHTML = `<b>KUDOS!</b><span>${esc(rand(KUDOS))}</span>`;
      stage.appendChild(k);
      gsap.timeline({ onComplete: () => k.remove() })
        .fromTo(k, { scale: 3, opacity: 0, rotate: -12 }, { scale: 1, opacity: 1, rotate: -4, duration: .6, ease: 'back.out(2)' })
        .to(k, { scale: 1.08, duration: .25, yoyo: true, repeat: 3 })
        .to(k, { y: -60, opacity: 0, duration: .5, ease: 'power2.in' }, '+=.5');
      gsap.fromTo(wrap, { scale: 1 }, { keyframes: { scale: [1, 1.07, .98, 1] }, duration: .8, ease: 'power2.out' });
      confetti(wrap, 160); fireworks(3);
      lcd(String(n).padStart(2, '0'), `Kudos! ${gift.name}`);
    }
    gsap.fromTo('.su-img img', { scale: 1.3 }, { scale: 1, duration: 1.2, ease: 'expo.out' });
    showGiftChoices(gift);
  };
  if (already) { canvas.remove(); reveal(); return; }
  scratchCard(canvas, reveal);
}

function scratchCard(canvas, onDone) {
  const r = { width: canvas.offsetWidth, height: canvas.offsetHeight }, dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = r.width * dpr; canvas.height = r.height * dpr;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const g = ctx.createLinearGradient(0, 0, r.width, r.height);
  g.addColorStop(0, '#4a0012'); g.addColorStop(.45, '#8f0a28'); g.addColorStop(.55, '#b4324f'); g.addColorStop(1, '#3A0010');
  ctx.fillStyle = g; ctx.fillRect(0, 0, r.width, r.height);
  ctx.globalAlpha = .12; ctx.fillStyle = '#FFFCEF'; ctx.font = '600 13px Quicksand';
  for (let y = 18; y < r.height; y += 26) for (let x = (y / 26) % 2 ? 0 : 30; x < r.width; x += 60) ctx.fillText('TNC ✦', x, y);
  ctx.globalAlpha = 1; ctx.fillStyle = '#FFFCEF'; ctx.textAlign = 'center';
  ctx.font = '700 30px Quicksand'; ctx.fillText('SCRATCH', r.width / 2, r.height / 2 - 6);
  ctx.font = '500 14px Quicksand'; ctx.fillText('to reveal your surprise', r.width / 2, r.height / 2 + 20);
  ctx.globalCompositeOperation = 'destination-out'; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 46;
  let down = false, last = null, moves = 0, done = false;
  const pos = (e) => { const b = canvas.getBoundingClientRect(), k = canvas.offsetWidth / (b.width || 1); return [(e.clientX - b.left) * k, (e.clientY - b.top) * k]; };
  const check = () => {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data; let clear = 0, total = 0;
    for (let i = 3; i < data.length; i += 4 * 40) { total++; if (data[i] < 20) clear++; }
    if (!done && clear / total > 0.5) { done = true; onDone(); }
  };
  canvas.addEventListener('pointerdown', (e) => { down = true; last = pos(e); canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.arc(last[0], last[1], 23, 0, Math.PI * 2); ctx.fill(); });
  canvas.addEventListener('pointermove', (e) => {
    if (!down) return; const p = pos(e);
    ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(p[0], p[1]); ctx.stroke(); last = p;
    if (++moves % 12 === 0) check();
  });
  const up = () => { if (down) { down = false; check(); } };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  // keyboard fallback
  canvas.tabIndex = 0;
  canvas.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); done = true; onDone(); } });
}

function showGiftChoices(gift) {
  const el = $('#scratchAfter'); el.hidden = false;
  el.innerHTML = `
    <p class="muted center">A suggestion, never an obligation. What feels right?</p>
    <div class="choices">
      <button class="choice" data-c="offer"><i>${icon('heart')}</i><span>I would love to offer this gift<small>We'll note it and arrange the details with you</small></span></button>
      <button class="choice" data-c="different"><i>${icon('repeat')}</i><span>Let me offer something different<small>Pick another number</small></span></button>
      <button class="choice" data-c="custom"><i>${icon('sparkles')}</i><span>I have something else in mind<small>Tell us about any gift at all</small></span></button>
      <button class="choice" data-c="call"><i>${icon('phone')}</i><span>I'd like someone to call me<small>Talk it through personally</small></span></button>
      <button class="choice" data-c="remind"><i>${icon('calendar')}</i><span>Remind me on another date<small>One gentle reminder, no pressure</small></span></button>
    </div>`;
  gsap.from($$('.choice', el), { y: 20, opacity: 0, stagger: .07, duration: .7, ease: 'expo.out' });
  el.addEventListener('click', (e) => {
    const c = e.target.closest('.choice')?.dataset.c; if (!c) return;
    track('gift_choice', { choice: c });
    if (c === 'different') { closeModal(); S.lenis?.scrollTo('#numbers', { offset: -40 }); toast('Pick any other number', false, 'dice'); return; }
    openForm(c, gift);
  });
}

// ---------------------------------------------------------------------------
// FORMS IN MODALS (gift offers, custom gifts, calls, collection, reminders)
// ---------------------------------------------------------------------------
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };
const F = {
  name: (req) => `<label class="field"><span>Your name ${req ? '' : '<em>(optional)</em>'}</span><input name="name" maxlength="80" ${req ? 'required' : ''} autocomplete="name" /></label>`,
  phone: (req, note = '') => `<label class="field"><span>Phone ${req ? '' : '<em>(optional)</em>'}${note}</span><input name="phone" type="tel" placeholder="07XX XXX XXX" ${req ? 'required' : ''} autocomplete="tel" /></label>`,
  hp: '<input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true" />',
};

function openForm(kind, gift = null) {
  const giftName = gift?.name || '';
  const forms = {
    offer: {
      title: `Offer: ${esc(giftName)}`, intro: 'Wonderful! Nothing is final until you are ready. We will simply note your kind intention.',
      body: `${F.name()}${F.phone(false)}
        <label class="field"><span>How would you like to hand it over?</span><select name="arrangement"><option>I'll deliver it myself</option><option>Please collect it from me</option><option>Let's discuss</option></select></label>
        <label class="field"><span>A personal message <em>(optional)</em></span><textarea name="message" rows="3" maxlength="600"></textarea></label>`,
      cta: 'Offer this gift',
    },
    custom: {
      title: 'Something else in mind', intro: 'Any gift at all: a dining table, household shopping, a skill, a surprise. We would love to hear it.',
      body: `<label class="field"><span>Describe your gift</span><textarea name="description" rows="3" maxlength="600" required placeholder="I have a beautiful dining table I would love you to have."></textarea></label>
        <label class="field"><span>Photo <em>(optional)</em></span><input type="file" name="photo" accept="image/*" /></label>
        <label class="field"><span>A personal message <em>(optional)</em></span><textarea name="message" rows="2" maxlength="600"></textarea></label>
        ${F.name()}${F.phone(false)}
        <label class="field"><span>Delivery or collection</span><select name="arrangement"><option>I'll deliver it myself</option><option>Please collect it from me</option><option>Let's discuss</option></select></label>`,
      cta: 'Offer my gift',
    },
    call: {
      title: 'Request a call', intro: 'Someone close to the couple will give you a friendly call.',
      body: `${F.name(true)}${F.phone(true)}
        <label class="field"><span>Best time to call <em>(optional)</em></span><input name="bestTime" maxlength="80" placeholder="Weekday evenings" /></label>
        <label class="field"><span>About <em>(optional)</em></span><input name="giftName" maxlength="120" value="${esc(giftName)}" /></label>`,
      cta: 'Request a call',
    },
    collection: {
      title: 'Arrange gift collection', intro: 'Have a gift ready? Tell us where and when suits you and we will reach out.',
      body: `<label class="field"><span>Your gift</span><input name="description" maxlength="200" required value="${esc(giftName)}" /></label>
        ${F.name(true)}${F.phone(true)}
        <label class="field"><span>Collection area / location</span><input name="location" maxlength="160" placeholder="e.g. Kilimani, Nairobi" /></label>
        <label class="field"><span>Suggested date</span><input type="date" name="date" min="${tomorrow()}" /></label>`,
      cta: 'Request collection',
    },
    remind: {
      title: 'Remind me later', intro: `We'll send one friendly note about ${giftName ? `<b>${esc(giftName)}</b>` : 'your gift'} on the date you choose. Nothing more.`,
      body: `<label class="field"><span>Remind me on</span><input type="date" name="date" min="${tomorrow()}" required /></label>
        ${F.phone(true, ' <em>(for the reminder)</em>')}${F.name()}
        <label class="check"><input type="checkbox" name="consent" checked required /><span></span>I'm happy to receive this one reminder</label>`,
      cta: 'Set my reminder',
    },
  };
  const f = forms[kind];
  openModal(`<h3>${f.title}</h3><p class="muted">${f.intro}</p><form id="mForm" novalidate>${f.body}${F.hp}<button class="btn btn--ivory btn--block btn--lg" type="submit">${f.cta} <span class="arr">→</span></button></form>`);
  $('#mForm').addEventListener('submit', (e) => { e.preventDefault(); submitForm(kind, e.target, gift); });
}

function bad(form, name, msg) {
  const el = form.querySelector(`[name=${name}]`)?.closest('.field'); el?.classList.remove('is-bad'); void el?.offsetWidth; el?.classList.add('is-bad');
  toast(msg, true); return false;
}
// Busy state: circling loader + label + bouncing bubbles, so people can see something is happening.
function busy(btn, on, label = 'Just a moment') {
  if (!btn) return;
  btn.disabled = on; btn.setAttribute('aria-busy', on ? 'true' : 'false');
  if (on) {
    if (!btn.classList.contains('is-busy')) btn.dataset.t = btn.innerHTML;
    btn.classList.add('is-busy');
    btn.innerHTML = `<span class="spin" aria-hidden="true"></span><span class="busy-l">${esc(label)}</span><span class="bubbles" aria-hidden="true"><i></i><i></i><i></i></span>`;
  } else {
    btn.classList.remove('is-busy');
    if (btn.dataset.t) btn.innerHTML = btn.dataset.t;
  }
}

async function submitForm(kind, form, gift) {
  const fd = new FormData(form), v = (k) => String(fd.get(k) || '').trim();
  if (v('website')) { closeModal(); return; } // honeypot
  const btn = form.querySelector('[type=submit]');
  const phoneRaw = v('phone'), phone = phoneRaw ? normalizePhone(phoneRaw) : '';
  if (phoneRaw && !phone) return bad(form, 'phone', 'Please enter a valid Safaricom/Airtel number, e.g. 0712 345 678');
  if (!rateOk('form_' + kind, 8000)) return toast('Just sent! Give it a few seconds', false, 'heart');
  const base = { name: v('name').slice(0, 80), phone: phone || '', vid: S.vid, ref: makeRef('G'), at: serverTimestamp() };
  try {
    busy(btn, true, 'Sending');
    if (kind === 'offer') {
      await addDoc(collection(db, 'giftOffers'), { ...base, type: 'suggested', giftId: gift?.id || '', giftName: gift?.name || '', description: gift?.name || '', message: v('message').slice(0, 600), arrangement: v('arrangement'), status: 'OFFERED' });
      logActivity('gift_offer', `Gift offered: ${gift?.name}`);
      return thankYou('gift', base.name, base.ref);
    }
    if (kind === 'custom') {
      if (!v('description')) { busy(btn, false); return bad(form, 'description', 'Tell us a little about your gift'); }
      let photo = '';
      const file = fd.get('photo');
      if (file && file.size) photo = await compressImage(file, 900, 0.72);
      await addDoc(collection(db, 'giftOffers'), { ...base, type: 'custom', giftId: '', giftName: v('description').slice(0, 120), description: v('description').slice(0, 600), photo, message: v('message').slice(0, 600), arrangement: v('arrangement'), status: 'OFFERED' });
      logActivity('gift_custom', 'Custom gift offered');
      return thankYou('gift', base.name, base.ref);
    }
    if (kind === 'call') {
      if (!base.name) { busy(btn, false); return bad(form, 'name', 'Please add your name'); }
      if (!phone) { busy(btn, false); return bad(form, 'phone', 'We need a number to call you'); }
      await addDoc(collection(db, 'requests'), { ...base, kind: 'call', bestTime: v('bestTime').slice(0, 80), giftName: v('giftName').slice(0, 120), status: 'OPEN' });
      logActivity('call_request', 'Call requested');
      return thankYou('gift', base.name, base.ref, 'Thank you! Someone will give you a call soon.');
    }
    if (kind === 'collection') {
      if (!v('description')) { busy(btn, false); return bad(form, 'description', 'What gift are we collecting?'); }
      if (!base.name) { busy(btn, false); return bad(form, 'name', 'Please add your name'); }
      if (!phone) { busy(btn, false); return bad(form, 'phone', 'We need a number to arrange collection'); }
      await addDoc(collection(db, 'giftOffers'), { ...base, type: 'collection', giftId: gift?.id || '', giftName: v('description').slice(0, 120), description: v('description').slice(0, 600), location: v('location').slice(0, 160), date: v('date'), arrangement: 'Please collect it from me', status: 'COLLECTION_REQUESTED' });
      logActivity('collection_request', 'Gift collection requested');
      return thankYou('gift', base.name, base.ref, 'Thank you! We will reach out to arrange collection.');
    }
    if (kind === 'remind') {
      if (!v('date') || v('date') < tomorrow()) { busy(btn, false); return bad(form, 'date', 'Please choose a future date'); }
      if (!phone) { busy(btn, false); return bad(form, 'phone', 'We need a number to send the reminder'); }
      if (!fd.get('consent')) { busy(btn, false); return toast('Please confirm you are happy to receive the reminder', true); }
      await addDoc(collection(db, 'reminders'), { ...base, kind: 'gift', refId: gift?.id || '', giftName: gift?.name || '', date: v('date'), consent: true, status: 'SCHEDULED' });
      logActivity('gift_reminder', `Gift reminder set for ${v('date')}`);
      participated('gift_reminder');
      closeModal(); confetti();
      return toast(`Done! We'll send one gentle reminder on ${new Date(v('date')).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`, false, 'calendar');
    }
  } catch (err) {
    console.error(err); busy(btn, false);
    toast('Something went wrong saving that. Please try again.', true);
  }
}

// ---------------------------------------------------------------------------
// FINANCIAL: Contribute now (M-Pesa STK) and Pledge now, pay later
// ---------------------------------------------------------------------------
function initGive() {
  const tabs = $('.tabs');
  tabs.addEventListener('click', (e) => {
    const t = e.target.closest('.tab'); if (!t) return;
    tabs.dataset.on = t.dataset.tab;
    $$('.tab', tabs).forEach((b) => { b.classList.toggle('is-on', b === t); b.setAttribute('aria-selected', b === t); });
    $$('.panel').forEach((p) => p.classList.toggle('is-on', p.dataset.panel === t.dataset.tab));
  });
  $('#formLater [name=date]').min = tomorrow();
  if (S.settings.finance.paystackEnabled !== false) {
    $('#phoneLbl').textContent = 'Phone number';
    $('#emailField').hidden = false;
    const f = $('#formNow');
    f.querySelector('[type=submit]').innerHTML = 'Continue to secure payment <span class="arr">→</span>';
    f.querySelector('.fine').textContent = 'Pay securely with M-Pesa or card through Paystack. Nothing is charged until you confirm.';
  }

  $('#formNow').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target, fd = new FormData(form);
    if (fd.get('website')) return;
    const amount = Math.round(+fd.get('amount'));
    if (!amount || amount < 10) return bad(form, 'amount', 'Please choose or enter an amount (min KES 10)');
    if (amount > 250000) return bad(form, 'amount', 'M-Pesa allows up to KES 250,000 per transaction');
    const phone = normalizePhone(fd.get('phone'));
    if (!phone) return bad(form, 'phone', 'Please enter a valid M-Pesa number, e.g. 0712 345 678');
    if (!rateOk('stk', 20000)) return toast('Please wait a few seconds before trying again');
    const email = String(fd.get('email') || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return bad(form, 'email', 'Please enter a valid email, or leave it empty');
    const payload = { amount, phone, email, name: String(fd.get('name') || '').trim().slice(0, 80), anonymous: !!fd.get('anonymous'), vid: S.vid, ref: makeRef('TNC') };
    track('contribute_start', { amount });
    await startPayment(payload, form.querySelector('[type=submit]'));
  });

  $('#formLater').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target, fd = new FormData(form);
    if (fd.get('website')) return;
    const amount = Math.round(+fd.get('amount'));
    if (!amount || amount < 10) return bad(form, 'amount', 'Please enter the amount you would like to pledge');
    const date = String(fd.get('date') || '');
    if (!date || date < tomorrow()) return bad(form, 'date', 'Please choose a future reminder date');
    const rawPhone = String(fd.get('phone') || '').trim(), phone = rawPhone ? normalizePhone(rawPhone) : '';
    if (rawPhone && !phone) return bad(form, 'phone', 'Please enter a valid phone number');
    const consent = !!fd.get('consent') && !!phone;
    if (!rateOk('pledge', 15000)) return toast('Just recorded! Give it a few seconds', false, 'heart');
    const btn = form.querySelector('[type=submit]'); busy(btn, true, 'Saving your pledge');
    try {
      const name = String(fd.get('name') || '').trim().slice(0, 80);
      const ref = makeRef('PL');
      const pledgeRef = doc(collection(db, 'pledges'));
      const remRef = consent ? doc(collection(db, 'reminders')) : null;
      await setDoc(pledgeRef, { amount, name, phone: phone || '', date, consent, reminderId: remRef?.id || '', ref, vid: S.vid, status: 'PENDING', reminderStatus: consent ? 'SCHEDULED' : 'NONE', at: serverTimestamp() });
      if (remRef) await setDoc(remRef, { kind: 'pledge', refId: pledgeRef.id, giftName: '', name, phone, date, consent: true, status: 'SCHEDULED', vid: S.vid, ref, at: serverTimestamp() });
      logActivity('pledge', `Pledge recorded: ${money(amount)}`);
      participated('pledge'); track('pledge', { amount });
      form.reset(); busy(btn, false);
      const nice = new Date(date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
      openModal(`<div class="center"><div class="big-check"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
        <h3 style="padding:0">Your pledge is recorded</h3>
        <p class="muted">Thank you${name ? ', ' + esc(name) : ''}! You pledged <b>${money(amount)}</b>.
        ${consent ? `We'll send one friendly reminder on <b>${nice}</b>.` : 'No reminders will be sent.'}
        It's a kind intention, not a payment, and you are free to change your mind anytime.</p>
        <dl class="kv"><dt>Pledge reference</dt><dd>${ref}</dd></dl></div>
        <div class="modal-actions" style="justify-content:center"><button class="btn btn--ivory" id="tyNext">Get a thank-you note</button></div>`);
      confetti();
      $('#tyNext').addEventListener('click', () => thankYou('financial', name, ref));
    } catch (err) { console.error(err); busy(btn, false); toast('Could not record the pledge. Please try again.', true); }
  });
}

// The payment API runs on Firebase. When the site is served from elsewhere (e.g. Vercel on the custom domain),
// /api/* doesn't exist there, so call Firebase Hosting directly (CORS allows our domains).
const API_HOST = 'https://mesh-9b2f3.web.app';
const api = (path) => (/^https?:/.test(path) || /\.(web\.app|firebaseapp\.com)$/.test(location.hostname) || location.hostname === 'localhost' ? path : API_HOST + path);

async function startPayment(p, btn) {
  const fin = S.settings.finance;
  if (fin.paystackEnabled !== false) return paystackPayment(p, btn);
  return stkPayment(p, btn);
}

async function stkPayment(p, btn) {
  const fin = S.settings.finance;
  busy(btn, true, `Sending ${money(p.amount)} request`);
  let res = null;
  if (fin.mpesaEnabled && fin.stkEndpoint) {
    try {
      const { email, ...stk } = p;
      const r = await fetch(api(fin.stkEndpoint), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stk) });
      const ct = r.headers.get('content-type') || '';
      res = ct.includes('json') ? await r.json() : null;
      if (!r.ok && res) { busy(btn, false); return toast(res.error || 'M-Pesa request failed. Please try again.', true); }
    } catch { res = null; }
  }
  busy(btn, false);
  if (res?.ok && res.id) return awaitPayment(res.id, p);
  return manualPayment(p);
}

// ---- Paystack checkout (keys are configured by the owner in the admin; the secret never reaches the browser) ----
let paystackJs = null;
const loadPaystack = () => (paystackJs ??= new Promise((ok, fail) => {
  const s = document.createElement('script'); s.src = 'https://js.paystack.co/v2/inline.js'; s.async = true;
  s.onload = () => (window.PaystackPop ? ok(window.PaystackPop) : fail(new Error('Paystack unavailable')));
  s.onerror = () => { paystackJs = null; fail(new Error('Paystack unavailable')); };
  document.head.appendChild(s);
}));
async function paystackPayment(p, btn) {
  busy(btn, true, `Preparing ${money(p.amount)}`);
  let res = null;
  try {
    const [r] = await Promise.all([fetch(api('/api/paystackInit'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }), loadPaystack().catch(() => null)]);
    res = (r.headers.get('content-type') || '').includes('json') ? await r.json() : null;
    if (res?.fallback) { busy(btn, false); return stkPayment(p, btn); } // no Paystack keys saved: use the M-Pesa prompt
    if (!r.ok) { busy(btn, false); if (res?.error) return toast(res.error, true); return manualPayment(p); }
  } catch { busy(btn, false); return manualPayment(p); }
  busy(btn, false);
  if (!res?.ok || !res.accessCode) return manualPayment(p);
  const verify = () => fetch(api('/api/paystackVerify'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: res.id }) }).catch(() => {});
  let Pop = null; try { Pop = await loadPaystack(); } catch { Pop = null; }
  if (!Pop) { window.location.href = res.url; return; } // popup script blocked: use Paystack's hosted page
  awaitPayment(res.id, p, 'paystack');
  // Paystack docs: resumeTransaction(accessCode). Callbacks aren't documented for it, so we don't rely on them:
  // the server is polled (it asks Paystack itself) and the webhook confirms too.
  let stopped = false, tries = 0;
  const poll = async () => {
    if (stopped || !$('#payBox')) return;
    const out = await verify().then((r) => r?.json?.()).catch(() => null);
    if (out?.outcome && out.outcome !== 'pending') return; // settled; the status listener shows the result
    if (++tries < 120) setTimeout(poll, 5000);
  };
  const prev = S.modalCleanup; S.modalCleanup = () => { stopped = true; prev?.(); };
  setTimeout(poll, 8000);
  try {
    new Pop().resumeTransaction(res.accessCode, { onSuccess: () => { tries = 0; verify(); } });
  } catch { window.location.href = res.url; }
}

function awaitPayment(id, p, via = 'mpesa') {
  openModal(via === 'paystack'
    ? `<div class="center" id="payBox"><div class="phone-anim"><span>PAY</span></div>
    <h3 style="padding:0">Complete your payment</h3>
    <p class="muted">Finish paying <b>${money(p.amount)}</b> in the secure Paystack window.</p>
    <p class="fine">Waiting for confirmation…</p></div>`
    : `<div class="center" id="payBox"><div class="phone-anim"><span>M-PESA</span></div>
    <h3 style="padding:0">Check your phone</h3>
    <p class="muted">We've sent a request for <b>${money(p.amount)}</b> to <b>${p.phone.replace(/^254(\d{3})\d{3}(\d{3})$/, '0$1•••$2')}</b>. Enter your M-Pesa PIN to complete.</p>
    <p class="fine">Waiting for confirmation from Safaricom…</p></div>`);
  let done = false;
  const unsub = onSnapshot(doc(db, 'contributionStatus', id), (snap) => {
    const d = snap.data(); if (!d || done) return;
    if (d.status === 'SUCCESS') { done = true; unsub(); paymentSuccess(d, p); }
    if (d.status === 'FAILED') {
      done = true; unsub();
      $('#payBox').innerHTML = `<h3 style="padding:0">Payment not completed</h3><p class="muted">${esc(d.resultDesc || 'The request was cancelled or timed out.')} No money was taken.</p><div class="modal-actions" style="justify-content:center"><button class="btn btn--ivory" data-close>Try again</button><button class="btn btn--ghost" id="toPledge">Pledge instead</button></div>`;
      $('#toPledge').addEventListener('click', () => { closeModal(); $('[data-tab=later]').click(); });
    }
  }, () => {});
  S.modalCleanup = () => unsub();
  setTimeout(() => {
    if (done) return; unsub();
    const box = $('#payBox'); if (!box) return;
    box.querySelector('.fine').textContent = "We haven't heard back yet. If you completed the payment, it will reflect as soon as it is confirmed. Thank you!";
  }, 120000);
}

function paymentSuccess(d, p) {
  participated('contribution'); track('contribute_success', { amount: d.amount });
  const name = p.anonymous ? '' : p.name;
  $('#payBox').innerHTML = `<div class="big-check"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
    <h3 style="padding:0">Asante sana${name ? ', ' + esc(name) : ''}!</h3>
    <p class="muted">Your contribution of <b>${money(d.amount)}</b> is confirmed.</p>
    <dl class="kv"><dt>Receipt</dt><dd>${esc(d.mpesaRef || '')}</dd><dt>Reference</dt><dd>${esc(d.ref || p.ref)}</dd></dl>
    <div class="modal-actions" style="justify-content:center"><button class="btn btn--ghost" id="dlReceipt">Transaction acknowledgement (PDF)</button><button class="btn btn--ivory" id="tyNext">Thank-you note</button></div>`;
  confetti();
  $('#dlReceipt').addEventListener('click', async () => {
    const c = S.settings.couple;
    const cv = await renderReceipt({ title: S.settings.brand.title, amount: d.amount, mpesaRef: d.mpesaRef, ref: d.ref || p.ref, name: p.name, anonymous: p.anonymous, phoneMasked: p.phone.replace(/^254(\d{3})\d{3}(\d{3})$/, '0$1•••$2'), dateText: new Date().toLocaleString('en-GB'), partnerA: c.partnerA, partnerB: c.partnerB });
    toPDF(cv, { size: 'a5', filename: `TNC-Acknowledgement-${d.mpesaRef || p.ref}.pdf` });
  });
  $('#tyNext').addEventListener('click', () => thankYou('financial', name, d.ref || p.ref));
}

async function manualPayment(p) {
  const fin = S.settings.finance;
  const hasManual = fin.paybill || fin.till;
  if (hasManual) {
    try { await addDoc(collection(db, 'contributions'), { amount: p.amount, name: p.name, phone: p.phone, anonymous: p.anonymous, ref: p.ref, vid: S.vid, status: 'PENDING', method: 'MANUAL', at: serverTimestamp() }); } catch (e) { console.warn(e); }
    participated('contribution_manual');
  }
  openModal(`<h3>${hasManual ? 'Pay via M-Pesa' : 'M-Pesa is resting for a moment'}</h3>
    ${hasManual ? `<p class="muted">The automatic prompt isn't available right now, but you can pay directly. Once the couple confirms receipt, it will reflect in the progress.</p>
      <dl class="kv">${fin.paybill ? `<dt>Paybill</dt><dd>${esc(fin.paybill)}</dd><dt>Account</dt><dd>${esc(fin.account || p.ref)}</dd>` : `<dt>Till number</dt><dd>${esc(fin.till)}</dd>`}<dt>Amount</dt><dd>${money(p.amount)}</dd><dt>Your reference</dt><dd>${p.ref}</dd></dl>`
      : `<p class="muted">We couldn't reach M-Pesa just now. You're very welcome to record a pledge instead and we'll send you one gentle reminder.</p>`}
    <div class="modal-actions">${hasManual ? '<button class="btn btn--ivory" data-close>Done</button>' : '<button class="btn btn--ivory" id="toPledge">Make a pledge instead</button>'}</div>`);
  $('#toPledge')?.addEventListener('click', () => { closeModal(); $('[data-tab=later]').click(); const f = $('#formLater'); f.amount.value = p.amount; f.name.value = p.name; });
}

// ---------------------------------------------------------------------------
// THANK-YOU NOTES (every form of participation receives appreciation)
// ---------------------------------------------------------------------------
async function thankYou(category, name, ref, headline) {
  participated(category);
  const st = S.settings, msg = st.thankyou[category] || st.thankyou.general;
  const tyRef = makeRef('TY');
  openModal(`<div class="center">
      <h3 style="padding:0">${esc(headline || 'Thank you so much!')}</h3>
      <p class="muted">A personal note for you to keep.</p>
      <label class="field" style="text-align:left"><span>Name on your note</span><input id="tyName" maxlength="60" value="${esc(name || '')}" placeholder="Friend" /></label>
      <div class="ty-preview"><canvas id="tyCanvas"></canvas></div>
      <div class="modal-actions" style="justify-content:center">
        <button class="btn btn--ivory" id="tyA5">Download A5 PDF</button><button class="btn btn--ghost" id="tyA4">A4 PDF</button><button class="btn btn--ghost" id="tyPng">Image</button>
      </div></div>`, false, true);
  confetti();
  let canvas;
  const render = async () => {
    const photo = await resolveSrc(st.couple.heroImage);
    const sig = await resolveSrc(st.couple.signature);
    canvas = await renderThankYou({ name: $('#tyName')?.value.trim() || 'Friend', category, message: msg, partnerA: st.couple.partnerA, partnerB: st.couple.partnerB, occasion: st.occasion.title, ref: tyRef, photo, coupleSignature: sig, monogram: st.brand.monogram, eventDate: st.occasion.date }, st.thankyouTemplate || 'ivory');
    const prev = $('#tyCanvas'); if (!prev) return;
    prev.width = 520; prev.height = 737; prev.getContext('2d').drawImage(canvas, 0, 0, 520, 737);
  };
  await render();
  let t; $('#tyName').addEventListener('input', () => { clearTimeout(t); t = setTimeout(render, 350); });
  let saved = false;
  const save = () => { if (saved) return; saved = true; addDoc(collection(db, 'thankyous'), { ref: tyRef, name: ($('#tyName')?.value.trim() || 'Friend').slice(0, 60), category, message: msg.slice(0, 500), source: ref || '', vid: S.vid, at: serverTimestamp() }).catch(() => {}); };
  $('#tyA5').addEventListener('click', () => { save(); toPDF(canvas, { size: 'a5', filename: `Thank-You-${tyRef}.pdf` }); });
  $('#tyA4').addEventListener('click', () => { save(); toPDF(canvas, { size: 'a4', filename: `Thank-You-${tyRef}.pdf` }); });
  $('#tyPng').addEventListener('click', () => { save(); toPNG(canvas, `Thank-You-${tyRef}.png`); });
}

// ---------------------------------------------------------------------------
// WISDOM
// ---------------------------------------------------------------------------
function initWisdom() {
  $('#formWisdom').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target, fd = new FormData(form);
    if (fd.get('website')) return;
    const message = String(fd.get('message') || '').trim();
    if (message.length < 3) return bad(form, 'message', 'Please write a few words');
    if (!rateOk('wisdom', 20000)) return toast('Thank you! Please wait a moment before sharing again');
    const category = $('#wisdomCats .pill.is-on')?.dataset.cat || 'Personal messages';
    const btn = form.querySelector('[type=submit]'); busy(btn, true, 'Sharing your words');
    try {
      const ref = makeRef('W');
      await addDoc(collection(db, 'wisdom'), { name: String(fd.get('name') || '').trim().slice(0, 80), message: message.slice(0, 1500), category, public: !!fd.get('public'), status: 'PENDING', vid: S.vid, ref, at: serverTimestamp() });
      logActivity('wisdom', `Wisdom shared: ${category}`);
      form.reset(); busy(btn, false);
      const isBlessing = /prayer|bless/i.test(category);
      thankYou(isBlessing ? 'blessing' : 'wisdom', String(fd.get('name') || ''), ref, fd.get('public') ? 'Thank you! It will appear on the wall once approved.' : 'Thank you! Your message will be kept private.');
    } catch (err) { console.error(err); busy(btn, false); toast('Could not send. Please try again.', true); }
  });
  try {
    onSnapshot(query(collection(db, 'wisdom'), where('status', '==', 'APPROVED'), where('public', '==', true), orderBy('at', 'desc'), limit(40)), (snap) => {
      const list = snap.docs.map((d) => d.data());
      renderWall(list);
    }, (err) => { console.warn('[TNC] wall', err.message); renderWall([]); });
  } catch { renderWall([]); }
}
function renderWall(list) {
  const items = list.length ? list : [{ message: 'Your words could be the very first on this wall.', name: 'The Next Chapter', category: 'Waiting for you' }];
  const card = (w) => `<article class="wcard"><q>${esc(w.message.length > 220 ? w.message.slice(0, 220) + '…' : w.message)}</q><footer><span>${esc(w.name || 'Anonymous')}</span><span>${esc(w.category)}</span></footer></article>`;
  const half = Math.ceil(items.length / 2);
  const a = items.slice(0, half), b = items.slice(half).length ? items.slice(half) : items;
  const fill = (arr) => { let out = [...arr]; while (out.length < 6) out = out.concat(arr); return out.map(card).join(''); };
  const ah = fill(a), bh = fill(b);
  $('#wallA').innerHTML = ah + ah; $('#wallB').innerHTML = bh + bh;
}

// ---------------------------------------------------------------------------
// IMPACT (live stats)
// ---------------------------------------------------------------------------
function initStats() {
  onSnapshot(doc(db, 'public', 'stats'), (snap) => { S.raw = snap.data() || {}; applyAdjust(); renderStats(); }, () => renderStats());
  // admins can top up / correct the public numbers (e.g. money or gifts received outside the site)
  onSnapshot(doc(db, 'settings', 'site'), (snap) => {
    const d = snap.data() || {};
    S.settings.impactAdjust = d.impactAdjust || {};
    if (d.finance?.target) S.settings.finance.target = d.finance.target;
    applyAdjust(); renderStats();
  }, () => {});
}
const ADJ_KEYS = ['confirmedTotal', 'confirmedCount', 'pledgedOutstanding', 'giftsReceived', 'wisdomApproved', 'participants'];
function applyAdjust() {
  const raw = S.raw || {}, adj = S.settings.impactAdjust || {};
  S.stats = { ...raw };
  ADJ_KEYS.forEach((k) => { S.stats[k] = Math.max(0, (+raw[k] || 0) + (+adj[k] || 0)); });
}
function renderStats(animate = false) {
  const s = S.stats || {}, target = +S.settings.finance.target || 1;
  const conf = +s.confirmedTotal || 0, pl = +s.pledgedOutstanding || 0;
  const cPct = Math.min(conf / target, 1), pPct = Math.min(pl / target, 1 - cPct);
  $('.meter-confirmed').style.width = (cPct * 100).toFixed(2) + '%';
  $('.meter-pledged').style.width = (pPct * 100).toFixed(2) + '%';
  $('#mConfirmed').textContent = money(conf); $('#mPledged').textContent = money(pl);
  $('#mRemaining').textContent = money(Math.max(target - conf, 0));
  $('#wisdomCount').textContent = s.wisdomApproved || 0;
  if (!S.impactVisible) return;
  const C = 540.35;
  $('#ringConfirmed').style.strokeDashoffset = C * (1 - cPct);
  const pl2 = $('#ringPledged'); pl2.style.strokeDashoffset = C * (1 - pPct); pl2.style.transform = `rotate(${cPct * 360}deg)`;
  const pctObj = { v: parseFloat($('#ringPct').textContent) || 0 };
  gsap.to(pctObj, { v: cPct * 100, duration: animate ? 2 : 1, ease: 'power3.out', onUpdate: () => ($('#ringPct').textContent = Math.round(pctObj.v) + '%') });
  $$('[data-stat]').forEach((el) => {
    const to = +s[el.dataset.stat] || 0, isMoney = el.hasAttribute('data-money');
    const o = { v: animate ? 0 : +el.dataset.v || 0 };
    gsap.to(o, { v: to, duration: animate ? 2.2 : 1, ease: 'power3.out', onUpdate: () => (el.textContent = isMoney ? money(o.v) : Math.round(o.v).toLocaleString()) });
    el.dataset.v = to;
  });
}

// ---------------------------------------------------------------------------
// SIGNATURE PAD
// ---------------------------------------------------------------------------
class SigPad {
  constructor(canvas, color = '#3A0010') {
    this.c = canvas; this.color = color; this.strokes = 0; this.fit();
    let pts = [];
    const pos = (e) => { const r = this.c.getBoundingClientRect(), k = this.c.offsetWidth / (r.width || 1); return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k }; };
    canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); if (this.isEmpty() && Math.abs(canvas.width - canvas.offsetWidth * this.dpr) > 2) this.fit(); canvas.setPointerCapture(e.pointerId); pts = [pos(e)]; this.drawing = true; this.strokes++; });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.drawing) return; const p = pos(e); pts.push(p);
      if (pts.length >= 3) {
        const [a, b, c] = pts.slice(-3), m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, m2 = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
        const ctx = this.ctx; ctx.beginPath(); ctx.moveTo(m1.x, m1.y); ctx.quadraticCurveTo(b.x, b.y, m2.x, m2.y);
        const dist = Math.hypot(c.x - b.x, c.y - b.y); ctx.lineWidth = Math.max(1.4, 3.6 - dist * 0.08); ctx.stroke();
        this.bounds(c);
      }
    });
    const up = () => { this.drawing = false; this.onChange?.(); };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  }
  fit() {
    const r = { width: this.c.offsetWidth, height: this.c.offsetHeight }, dpr = Math.min(devicePixelRatio || 1, 2);
    this.c.width = Math.max(1, r.width * dpr); this.c.height = Math.max(1, r.height * dpr);
    this.ctx = this.c.getContext('2d'); this.ctx.scale(dpr, dpr);
    Object.assign(this.ctx, { strokeStyle: this.color, lineCap: 'round', lineJoin: 'round', lineWidth: 2.6 });
    this.dpr = dpr; this.b = null; this.strokes = 0;
  }
  bounds(p) { const b = this.b || { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; this.b = { x0: Math.min(b.x0, p.x), y0: Math.min(b.y0, p.y), x1: Math.max(b.x1, p.x), y1: Math.max(b.y1, p.y) }; }
  clear() { this.fit(); this.onChange?.(); }
  isEmpty() { return !this.b || this.b.x1 - this.b.x0 < 8; }
  toDataURL(maxW = 600) {
    if (this.isEmpty()) return '';
    const pad = 8, d = this.dpr, b = this.b;
    const sx = Math.max(0, (b.x0 - pad) * d), sy = Math.max(0, (b.y0 - pad) * d);
    const sw = Math.min(this.c.width - sx, (b.x1 - b.x0 + pad * 2) * d), sh = Math.min(this.c.height - sy, (b.y1 - b.y0 + pad * 2) * d);
    const s = Math.min(1, maxW / sw), o = document.createElement('canvas');
    o.width = Math.round(sw * s); o.height = Math.round(sh * s);
    o.getContext('2d').drawImage(this.c, sx, sy, sw, sh, 0, 0, o.width, o.height);
    return o.toDataURL('image/png');
  }
}

// ---------------------------------------------------------------------------
// GUESTBOOK
// ---------------------------------------------------------------------------
function sealSVG(letter, rim) {
  const pts = []; const n = 240;
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; const r = 50 * (1.07 + 0.03 * Math.sin(a * 9 + .4) + 0.02 * Math.sin(a * 17 + 1.3) + 0.012 * Math.sin(a * 31 + 2.1)); pts.push(`${(60 + Math.cos(a) * r).toFixed(2)},${(60 + Math.sin(a) * r).toFixed(2)}`); }
  return `<svg viewBox="0 0 120 120" role="img" aria-label="Wax seal"><defs>
    <radialGradient id="sw" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#b0213f"/><stop offset=".55" stop-color="#7F0020"/><stop offset="1" stop-color="#3A0010"/></radialGradient>
    <radialGradient id="si" cx="65%" cy="70%" r="70%"><stop offset="0" stop-color="#6D011A"/><stop offset="1" stop-color="#8f0a28"/></radialGradient>
    <path id="rimPath" d="M60,60 m-41,0 a41,41 0 1,1 82,0 a41,41 0 1,1 -82,0"/></defs>
    <polygon points="${pts.join(' ')}" fill="url(#sw)"/>
    <circle cx="60" cy="60" r="39" fill="url(#si)" stroke="rgba(0,0,0,.4)" stroke-width="1"/>
    <circle cx="60" cy="60.6" r="39" fill="none" stroke="rgba(255,190,200,.3)" stroke-width=".8"/>
    <circle cx="60" cy="60" r="30" fill="none" stroke="rgba(255,190,200,.28)" stroke-width=".8" stroke-dasharray="1.5 2.5"/>
    <text x="60" y="61" text-anchor="middle" dominant-baseline="central" font-family="Quicksand" font-weight="700" font-size="36" fill="rgba(255,170,185,.45)" dy="1.4">${esc(letter)}</text>
    <text x="60" y="61" text-anchor="middle" dominant-baseline="central" font-family="Quicksand" font-weight="700" font-size="36" fill="rgba(0,0,0,.55)" dy="-1">${esc(letter)}</text>
    <text x="60" y="61" text-anchor="middle" dominant-baseline="central" font-family="Quicksand" font-weight="700" font-size="36" fill="#5a0014">${esc(letter)}</text>
    <text font-family="Quicksand" font-weight="700" font-size="6.4" letter-spacing=".6" fill="rgba(255,214,222,.9)"><textPath href="#rimPath" startOffset="0" textLength="252" lengthAdjust="spacing">${esc(rim)}</textPath></text>
  </svg>`;
}

// Center-crop an uploaded photo into a square portrait (like a profile picture).
function squarePortrait(file, size = 420) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('Please choose a photo'));
    if (file.size > 15 * 1024 * 1024) return reject(new Error('That photo is too large (max 15 MB)'));
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height), c = document.createElement('canvas'); c.width = c.height = size;
      c.getContext('2d').drawImage(img, (img.width - s) / 2, Math.max(0, (img.height - s) * 0.35), s, s, 0, 0, size, size);
      URL.revokeObjectURL(img.src); resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('Could not read that photo'));
    img.src = URL.createObjectURL(file);
  });
}

function initGuestbook() {
  const st = S.settings;
  $('#gbSeal').innerHTML = sealSVG((st.brand.monogram || 'M').slice(0, 2), sealRim(st.couple.partnerA, st.couple.partnerB, st.occasion.date).repeat(1));
  const pad = new SigPad($('#gbSig'));
  let rT; addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { if (pad.isEmpty()) pad.fit(); }, 300); });
  $('[data-clear=gbSig]').addEventListener('click', () => pad.clear());
  ScrollTrigger.create({ trigger: '.guestbook', start: 'top bottom', once: true, onEnter: () => setTimeout(() => pad.fit(), 1200) });
  $('#formGuest').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target, fd = new FormData(form);
    if (fd.get('website')) return;
    const name = String(fd.get('name') || '').trim();
    if (!name) return bad(form, 'name', 'Please write your name');
    if (pad.isEmpty()) { toast('Please add your signature', true, 'pen'); return; }
    if (!rateOk('guest', 20000)) return toast('Thank you! Please wait a moment');
    const btn = form.querySelector('[type=submit]'); busy(btn, true, 'Signing the guestbook');
    try {
      const ref = makeRef('GB');
      await addDoc(collection(db, 'guestbook'), { name: name.slice(0, 80), message: String(fd.get('message') || '').trim().slice(0, 500), signature: pad.toDataURL(500), public: !!fd.get('public'), status: 'PENDING', vid: S.vid, ref, at: serverTimestamp() });
      logActivity('guestbook', `Guestbook signed by ${name.slice(0, 40)}`);
      form.reset(); pad.clear(); busy(btn, false);
      thankYou('general', name, ref, 'Thank you for signing our book!');
    } catch (err) { console.error(err); busy(btn, false); toast('Could not save your entry. Please try again.', true); }
  });
  onSnapshot(query(collection(db, 'guestbook'), where('status', '==', 'APPROVED'), where('public', '==', true), orderBy('at', 'desc'), limit(30)), (snap) => {
    if (snap.empty) return;
    $('#gbGallery').innerHTML = snap.docs.map((d) => { const g = d.data(); return `<div class="gb-entry">${g.signature ? `<img src="${esc(g.signature)}" alt="Signature of ${esc(g.name)}" loading="lazy" />` : ''}<b>${esc(g.name)}</b>${g.message ? `<p>${esc(g.message)}</p>` : ''}</div>`; }).join('');
  }, (err) => console.warn('[TNC] guestbook', err.message));
}

// ---------------------------------------------------------------------------
// INVITATION CARD GENERATOR
// ---------------------------------------------------------------------------
let invCanvas = null, invTimer;
function initInvite() {
  S.invTemplate = S.settings.invitation.template || 'noir';
  $('#tplPick').innerHTML = Object.entries(TEMPLATES).map(([k, t]) => `<button class="tpl${k === S.invTemplate ? ' is-on' : ''}" data-k="${k}" role="radio" aria-checked="${k === S.invTemplate}"><i style="background:${t.bg};box-shadow:0 0 0 1px rgba(255,255,255,.15), inset 0 0 0 4px ${t.bg}, inset 0 0 0 5px ${t.frame}"></i>${t.label}</button>`).join('');
  $('#tplPick').addEventListener('click', (e) => { const b = e.target.closest('.tpl'); if (!b) return; S.invTemplate = b.dataset.k; $$('.tpl').forEach((x) => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-checked', x === b); }); renderInvite(true); });
  $('#invName').addEventListener('input', () => { clearTimeout(invTimer); S.invRef = null; invTimer = setTimeout(() => renderInvite(), 400); });
  $('#invSign').addEventListener('click', () => {
    openModal(`<h3>Sign your invitation</h3><p class="muted">Your signature will appear on your personal card.</p><div class="sig"><canvas id="invSigPad"></canvas><button type="button" class="link sig-clear">Clear</button></div><div class="modal-actions"><button class="btn btn--ivory" id="invSigOk">Add signature</button></div>`);
    const c = $('#invSigPad'); c.style.background = '#fff';
    const pad = new SigPad(c, '#111');
    $('.modal .sig-clear').addEventListener('click', () => pad.clear());
    $('#invSigOk').addEventListener('click', () => { if (pad.isEmpty()) return toast('Draw your signature first', true, 'pen'); S.invSig = pad.toDataURL(600); S.invRef = null; closeModal(); renderInvite(true); toast('Signed', false, 'pen'); });
  });
  const av = $('#invAvatar'), pin = $('#invPhoto');
  av.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pin.click(); } });
  pin.addEventListener('change', async () => {
    const f = pin.files[0]; if (!f) return;
    try {
      S.guestPhoto = await squarePortrait(f, 420);
      $('#invAvatarImg').src = S.guestPhoto; $('#invAvatarImg').hidden = false; av.classList.add('has-img'); $('#invPhotoRm').hidden = false;
      S.invRef = null; renderInvite(true); toast('Looking good! Your photo is on the card', false, 'camera');
    } catch (err) { toast(err.message, true); }
    pin.value = '';
  });
  $('#invPhotoRm').addEventListener('click', () => { S.guestPhoto = ''; $('#invAvatarImg').hidden = true; av.classList.remove('has-img'); $('#invPhotoRm').hidden = true; S.invRef = null; renderInvite(true); });
  const celebrate = () => { fireworks(4); confetti($('#invCard'), 90); toast('Your invitation is ready. See you there!', false, 'party'); };
  const ensure = async () => { if (!invCanvas) await renderInvite(); await saveInvite(); return invCanvas; };
  $('#invA5').addEventListener('click', async () => { const c = await ensure(); toPDF(c, { size: 'a5', filename: `Invitation-${S.invRef}.pdf` }); celebrate(); track('invite_download', { size: 'a5' }); });
  $('#invA4').addEventListener('click', async () => { const c = await ensure(); toPDF(c, { size: 'a4', filename: `Invitation-${S.invRef}.pdf` }); celebrate(); track('invite_download', { size: 'a4' }); });
  $('#invPrint').addEventListener('click', async () => { printCanvas(await ensure()); track('invite_print'); });
  $('#invShare').addEventListener('click', async () => {
    await ensure();
    const link = shareLink($('#invName').value.trim());
    const text = shareText(link);
    if (navigator.canShare) {
      try {
        const blob = await new Promise((r) => invCanvas.toBlob(r, 'image/jpeg', .9));
        const file = new File([blob], `Invitation-${S.invRef}.jpg`, { type: 'image/jpeg' });
        if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
      } catch { /* fall through */ }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  });
  // subtle 3D tilt
  const card = $('#invCard');
  $('.inv-preview').addEventListener('pointermove', (e) => { const r = card.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; gsap.to(card, { rotateY: x * 14, rotateX: -y * 14, duration: .6, ease: 'power2.out' }); });
  $('.inv-preview').addEventListener('pointerleave', () => gsap.to(card, { rotateY: 0, rotateX: 0, duration: 1, ease: 'elastic.out(1,.5)' }));
}
async function renderInvite(flip = false) {
  const st = S.settings, c = st.couple, o = st.occasion;
  if (!S.invRef) S.invRef = makeRef('INV');
  const photo = await resolveSrc(st.invitation.photo || c.heroImage);
  invCanvas = await renderInvitation({ partnerA: c.partnerA, partnerB: c.partnerB, title: o.title, date: o.date, venue: o.venue, message: st.invitation.message, families: st.invitation.families, photo, recipient: $('#invName').value.trim(), ref: S.invRef, signature: S.invSig, guestPhoto: S.guestPhoto, monogram: st.brand.monogram }, S.invTemplate);
  const prev = $('#invCanvas'); prev.width = 874; prev.height = 1240;
  const draw = () => prev.getContext('2d').drawImage(invCanvas, 0, 0, 874, 1240);
  if (flip && !reduce) gsap.timeline().to('#invCard', { rotateY: 90, duration: .35, ease: 'power2.in' }).add(draw).to('#invCard', { rotateY: 0, duration: .7, ease: 'expo.out' });
  else draw();
  $('#invRef').textContent = `Invitation reference: ${S.invRef}`;
}
let savedRefs = new Set();
async function saveInvite() {
  if (savedRefs.has(S.invRef)) return; savedRefs.add(S.invRef);
  try { await setDoc(doc(db, 'invitations', S.invRef), { ref: S.invRef, recipient: $('#invName').value.trim().slice(0, 60), template: S.invTemplate, signature: S.invSig || '', guestPhoto: S.guestPhoto || '', vid: S.vid, at: serverTimestamp() }); logActivity('invitation', 'Invitation generated'); } catch (e) { console.warn(e); }
}

// ---------------------------------------------------------------------------
// SHARE
// ---------------------------------------------------------------------------
function shareLink(name) { const u = new URL(location.origin + location.pathname); if (name) u.searchParams.set('to', name); return u.toString(); }
function shareText(link) { return S.settings.share.whatsapp.replaceAll('{couple}', coupleNames()).replaceAll('{link}', link); }
function initShare() {
  const ta = $('#shareText'), wa = $('#shareWa');
  ta.value = shareText(shareLink(''));
  const upd = () => (wa.href = `https://wa.me/?text=${encodeURIComponent(ta.value)}`); upd();
  ta.addEventListener('input', upd);
  wa.addEventListener('click', () => track('share', { method: 'whatsapp' }));
  $('#shareCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(shareLink('')); toast('Link copied', false, 'link'); track('share', { method: 'copy' }); } catch { toast('Copy failed. Long-press the address bar instead.', true); } });
  if (navigator.share) { const b = $('#shareNative'); b.hidden = false; b.addEventListener('click', () => navigator.share({ text: ta.value }).catch(() => {})); }
}

// ---------------------------------------------------------------------------
// REMINDER OPT-OUT (?optout=<reminderId>)
// ---------------------------------------------------------------------------
function optOutFlow(id) {
  openModal(`<h3>Stop reminders?</h3><p class="muted">We'll make sure you don't receive any further reminders for this. No hard feelings, ever.</p><div class="modal-actions"><button class="btn btn--ivory" id="optYes">Yes, stop reminders</button><button class="btn btn--ghost" data-close>Keep it</button></div>`);
  $('#optYes').addEventListener('click', async () => {
    try { await updateDoc(doc(db, 'reminders', id.slice(0, 40)), { status: 'OPTED_OUT', optOutAt: serverTimestamp() }); closeModal(); toast('Done. No more reminders. Thank you!'); }
    catch { toast('That link has expired or is invalid.', true); }
  });
}

// ---------------------------------------------------------------------------
// MODAL
// ---------------------------------------------------------------------------
function openModal(html, wide = false, keepOpen = false) {
  S.modalCleanup?.(); S.modalCleanup = null;
  const m = $('#modal'), box = $('.modal-box', m);
  box.classList.toggle('modal-box--wide', wide);
  box.setAttribute('data-lenis-prevent', '');
  $('#modalBody').innerHTML = html;
  if (m.hidden) {
    m.hidden = false; lockScroll(true);
    gsap.fromTo('.modal-backdrop', { opacity: 0 }, { opacity: 1, duration: .4 });
    gsap.fromTo(box, { y: 60, opacity: 0, scale: .96 }, { y: 0, opacity: 1, scale: 1, duration: .7, ease: 'expo.out' });
  } else gsap.fromTo('#modalBody', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: .5, ease: 'expo.out' });
  setTimeout(() => box.querySelector('input:not([type=hidden]):not(.hp), button:not(.modal-x)')?.focus({ preventScroll: true }), 120);
}
function closeModal() {
  const m = $('#modal'); if (m.hidden) return;
  S.modalCleanup?.(); S.modalCleanup = null;
  gsap.to('.modal-box', { y: 40, opacity: 0, duration: .35, ease: 'power2.in' });
  gsap.to('.modal-backdrop', { opacity: 0, duration: .35, onComplete: () => { m.hidden = true; $('#modalBody').innerHTML = ''; lockScroll(false); } });
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// ---------------------------------------------------------------------------
// CONFETTI (hearts + petals in brand colours)
// ---------------------------------------------------------------------------
// Particle engine: confetti (hearts + petals) and fireworks, brand colours only
const FX = { parts: [], rockets: [], running: false, ctx: null };
const FX_COLORS = ['#ff5c7a', '#FFFCEF', '#C25B6E', '#ffd6de', '#b0213f', '#ffffff'];
function fxHeart(ctx, s) { ctx.beginPath(); ctx.moveTo(0, s * .3); ctx.bezierCurveTo(0, 0, -s * .5, 0, -s * .5, s * .3); ctx.bezierCurveTo(-s * .5, s * .6, 0, s * .8, 0, s); ctx.bezierCurveTo(0, s * .8, s * .5, s * .6, s * .5, s * .3); ctx.bezierCurveTo(s * .5, 0, 0, 0, 0, s * .3); ctx.fill(); }
function fxStart() {
  if (FX.running) return;
  const c = $('#confetti'), dpr = Math.min(devicePixelRatio || 1, 2);
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  FX.ctx = c.getContext('2d'); FX.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  FX.running = true; requestAnimationFrame(fxTick);
}
function fxTick() {
  const ctx = FX.ctx; ctx.clearRect(0, 0, innerWidth, innerHeight);
  FX.rockets = FX.rockets.filter((r) => {
    r.vy += .12; r.x += r.vx; r.y += r.vy;
    ctx.globalAlpha = .5; ctx.fillStyle = r.color; ctx.fillRect(r.x - 1, r.y + 2, 2, 16);
    ctx.globalAlpha = 1; ctx.fillStyle = '#FFFCEF'; ctx.beginPath(); ctx.arc(r.x, r.y, 2.4, 0, 7); ctx.fill();
    if (r.vy >= -0.6) { fxExplode(r.x, r.y, r.color); return false; }
    return true;
  });
  FX.parts = FX.parts.filter((p) => {
    p.vx *= p.drag; p.vy = p.vy * p.drag + p.g; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life++;
    const a = 1 - p.life / p.max; if (a <= 0) return false;
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = p.c; ctx.translate(p.x, p.y); ctx.rotate(p.r);
    if (p.kind === 'heart') fxHeart(ctx, p.s * 1.4);
    else if (p.kind === 'spark') { ctx.beginPath(); ctx.arc(0, 0, p.s, 0, 7); ctx.fill(); }
    else ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
    ctx.restore(); return true;
  });
  if (FX.parts.length || FX.rockets.length) requestAnimationFrame(fxTick);
  else { ctx.clearRect(0, 0, innerWidth, innerHeight); FX.running = false; }
}
function fxExplode(x, y, color) {
  const n = 80, ring = Math.random() < .4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * .2, sp = ring ? 4.6 : 1.5 + Math.random() * 4.5;
    FX.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: .05, drag: .975, s: 1.6 + Math.random() * 1.6, kind: Math.random() < .12 ? 'heart' : 'spark', c: Math.random() < .55 ? color : '#FFFCEF', life: 0, max: 60 + Math.random() * 45, r: 0, vr: .1 });
  }
}
function confetti(originEl, amount = 120) {
  if (reduce) return;
  const r = originEl?.getBoundingClientRect?.() || { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
  const ox = r.left + r.width / 2, oy = r.top + r.height / 2;
  for (let i = 0; i < amount; i++) {
    FX.parts.push({ x: ox, y: oy, vx: (Math.random() - .5) * 17, vy: -Math.random() * 15 - 4, g: .35, drag: .99, s: 6 + Math.random() * 8, r: Math.random() * 6, vr: (Math.random() - .5) * .3, c: FX_COLORS[(Math.random() * FX_COLORS.length) | 0], kind: Math.random() < .35 ? 'heart' : 'petal', life: 0, max: 140 });
  }
  fxStart();
}
function fireworks(count = 6) {
  if (reduce) return;
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      FX.rockets.push({ x: innerWidth * (.12 + .76 * Math.random()), y: innerHeight + 10, vx: (Math.random() - .5) * 1.6, vy: -Math.sqrt(2 * .12 * innerHeight * (.45 + .3 * Math.random())), color: FX_COLORS[(Math.random() * 5) | 0] });
      fxStart();
    }, i * 320);
  }
}

// ---------------------------------------------------------------------------
// CHROME: cursor, nav, menu, doors tilt, countdown
// ---------------------------------------------------------------------------
function initChrome() {
  const cur = $('.cursor');
  if (matchMedia('(hover:hover) and (pointer:fine)').matches) {
    const xTo = gsap.quickTo(cur, 'x', { duration: .35, ease: 'power3' }), yTo = gsap.quickTo(cur, 'y', { duration: .35, ease: 'power3' });
    addEventListener('pointermove', (e) => { xTo(e.clientX); yTo(e.clientY); });
    document.addEventListener('pointerover', (e) => cur.classList.toggle('is-hover', !!e.target.closest('a, button, .tile, .orbit-card, input, textarea, select, canvas')));
  }
  const burger = $('#navBurger'), menu = $('#menu');
  burger.addEventListener('click', () => {
    const open = burger.getAttribute('aria-expanded') !== 'true';
    burger.setAttribute('aria-expanded', open);
    if (open) { menu.hidden = false; requestAnimationFrame(() => menu.classList.add('is-open')); gsap.from('.menu li', { y: 40, opacity: 0, stagger: .06, duration: .8, delay: .25, ease: 'expo.out' }); lockScroll(true); }
    else { menu.classList.remove('is-open'); setTimeout(() => (menu.hidden = true), 800); lockScroll(false); }
  });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]'); if (!a) return;
    const id = a.getAttribute('href'); if (id.length < 2 && id !== '#top') return;
    e.preventDefault();
    if (burger.getAttribute('aria-expanded') === 'true') burger.click();
    S.lenis ? S.lenis.scrollTo(id === '#top' ? 0 : id, { duration: 2, easing: (t) => 1 - Math.pow(1 - t, 4) }) : $(id)?.scrollIntoView({ behavior: 'smooth' });
  });
  $$('[data-open]').forEach((b) => b.addEventListener('click', () => openForm(b.dataset.open)));
  $$('[data-tilt]').forEach((el) => {
    el.addEventListener('pointermove', (e) => { const r = el.getBoundingClientRect(); gsap.to(el, { rotateY: ((e.clientX - r.left) / r.width - .5) * 12, rotateX: -((e.clientY - r.top) / r.height - .5) * 12, duration: .5, ease: 'power2.out' }); });
    el.addEventListener('pointerleave', () => gsap.to(el, { rotateY: 0, rotateX: 0, duration: .9, ease: 'elastic.out(1,.5)' }));
  });
  // countdown
  const target = new Date(S.settings.occasion.date).getTime();
  const pad = (n) => String(Math.max(0, n)).padStart(2, '0');
  const tickCd = () => {
    let diff = Math.max(0, target - Date.now()) / 1000;
    const d = Math.floor(diff / 86400); diff -= d * 86400; const h = Math.floor(diff / 3600); diff -= h * 3600; const m = Math.floor(diff / 60); const s = Math.floor(diff - m * 60);
    $('[data-cd=d]').textContent = pad(d); $('[data-cd=h]').textContent = pad(h); $('[data-cd=m]').textContent = pad(m); $('[data-cd=s]').textContent = pad(s);
  };
  if (!isNaN(target)) { tickCd(); setInterval(tickCd, 1000); }
}

function initLenis() {
  if (reduce || !window.Lenis) return;
  S.lenis = new window.Lenis({ lerp: 0.085, smoothWheel: true, wheelMultiplier: 0.9 });
  S.lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => S.lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  S.lenis.stop();
}

// ---------------------------------------------------------------------------
// PHONES: one slide per swipe. Fast flicks can't rush the film; every swipe
// moves exactly one scene (pinned chapters advance one beat at a time).
// ---------------------------------------------------------------------------
function initSlides() {
  const touch = matchMedia('(pointer: coarse)').matches || params.has('slides');
  if (!touch) return;
  document.documentElement.classList.add('is-slides');
  let stops = [], busy = false, sx = 0, sy = 0, axis = null, tracking = false;
  const hint = $('#swipeHint');
  const absTop = (el) => el.getBoundingClientRect().top + scrollY;
  const build = () => {
    const vh = innerHeight, list = [];
    const pins = new Map(ScrollTrigger.getAll().filter((t) => t.pin).map((t) => [t.trigger, t]));
    [...$('main').children].forEach((block) => {
      const el = block.classList.contains('pin-spacer') ? block.firstElementChild : block;
      const st = pins.get(el);
      if (st) {
        const d = st.end - st.start;
        if (el.classList.contains('title-card')) list.push(st.start + d * 0.55);
        else if (el.id === 'milestones') { const n = $$('.ms', el).length; for (let i = 0; i <= n; i++) list.push(st.start + d * (i / n)); }
        else { [0, 0.34, 0.67, 1].forEach((f) => list.push(st.start + d * f)); }
        return;
      }
      const top = absTop(el), h = el.offsetHeight;
      list.push(top);
      if (h > vh * 1.12) { for (let y = top + vh * 0.85; y < top + h - vh; y += vh * 0.85) list.push(y); list.push(top + h - vh); }
    });
    const max = document.documentElement.scrollHeight - vh;
    stops = [];
    [...new Set(list.map((y) => Math.round(Math.min(Math.max(y, 0), max))))].sort((a, b) => a - b)
      .forEach((y) => { if (!stops.length || y - stops[stops.length - 1] > vh * 0.2) stops.push(y); });
  };
  ScrollTrigger.addEventListener('refresh', build); build();

  let hintT;
  const showHint = () => {
    const last = stops[stops.length - 1];
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    const on = !busy && !typing && scrollY < last - 40 && $('#modal').hidden && !document.body.classList.contains('is-loading') && !document.body.classList.contains('is-gated');
    hint.classList.toggle('is-on', on);
    clearTimeout(hintT); if (on) hintT = setTimeout(() => hint.classList.remove('is-on'), 2600);
  };
  const go = (dir) => {
    if (busy) return;
    build();
    const y = scrollY;
    const target = dir > 0 ? stops.find((s) => s > y + 24) : [...stops].reverse().find((s) => s < y - 24);
    if (target == null) return;
    busy = true; hint.classList.remove('is-on');
    const done = () => { busy = false; setTimeout(showHint, 250); };
    if (S.lenis) S.lenis.scrollTo(target, { duration: 1.15, easing: (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2), lock: true, force: true, onComplete: done });
    else { scrollTo({ top: target, behavior: 'smooth' }); setTimeout(done, 900); }
  };
  const free = (t) => t.closest('.modal, textarea, input, select, canvas, .menu, #gate, .gb-gallery, label');
  addEventListener('touchstart', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    tracking = !typing && !free(e.target) && $('#modal').hidden && !document.body.classList.contains('is-loading') && !document.body.classList.contains('is-gated');
    axis = null; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
  }, { passive: true });
  addEventListener('touchmove', (e) => {
    if (!tracking) return;
    const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
    if (!axis && Math.hypot(dx, dy) > 6) axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (axis === 'y' && e.cancelable) e.preventDefault();      // vertical: we own it
    if (axis === 'x') tracking = false;                         // horizontal: carousels/keypad scroll natively
  }, { passive: false });
  addEventListener('touchend', (e) => {
    if (!tracking || axis !== 'y') return;
    const dy = sy - e.changedTouches[0].clientY;
    if (Math.abs(dy) > 28) go(dy > 0 ? 1 : -1);
  }, { passive: true });
  S.slidesGo = go;
  setTimeout(showHint, 4500);
}

// ---------------------------------------------------------------------------
// BOOT
// ---------------------------------------------------------------------------
async function boot() {
  history.scrollRestoration = 'manual'; scrollTo(0, 0);
  initLenis();
  startVisit();
  const needGate = gateNeeded();
  if (needGate) S.onCurtain = () => showGate().then(playIntro);
  const ready = (async () => {
    const giftsP = loadGifts();                       // runs in parallel with settings
    S.settings = await loadSettings();
    await Promise.all([applySettings(), giftsP, buildOrbit()]);
    buildMilestones(); buildChips(); buildWisdomCats(); buildShowcase(); buildTiles();
    initChrome(); initGive(); initWisdom(); initStats(); initGuestbook(); initInvite(); initShare();
    await Promise.race([Promise.all($$('img').filter((i) => !i.complete).slice(0, 8).map((i) => new Promise((r) => { i.onload = i.onerror = r; }))), new Promise((r) => setTimeout(r, 900))]);
  })();
  let scenesDone; S.scenesReady = new Promise((r) => (scenesDone = r));
  await runLoader(ready);
  initScenes(); initSlides(); scenesDone();
  ScrollTrigger.refresh();
  if (!needGate) playIntro();
  addEventListener('load', () => ScrollTrigger.refresh());
}

boot().catch((e) => {
  console.error('[TNC] boot failed', e);
  $('#loader')?.remove(); $('#gate')?.remove();
  document.body.classList.remove('is-loading', 'is-gated');
});

// ---------------------------------------------------------------------------
// BUILT BY: Keypole Technologies contact modal
// The email address is never rendered on the page or kept as plain text in the source;
// it is assembled only when the visitor taps "Email us" and handed straight to their mail app.
// ---------------------------------------------------------------------------
const KP = {
  m: () => ['moc.liamg', '828ignawmhsem'].map((x) => [...x].reverse().join('')).reverse().join('@'),
  phones: [['0115 721 877', '254115721877'], ['0182 450 860', '254182450860']],
};
function openKeypole() {
  openModal(`<div class="kp-modal">
    <div class="kp-mark" aria-hidden="true">KP</div>
    <p class="kp-eyebrow">Keypole Technologies</p>
    <h3 id="modalTitle">Need a system like this?</h3>
    <p class="muted">Digital invitations, ruracio &amp; wedding sites, M-Pesa contributions, gift registries, guestbooks, event dashboards and more, designed and built for you.</p>
    <ul aria-label="What we build"><li>Weddings &amp; Ruracio</li><li>Events</li><li>M-Pesa payments</li><li>Websites</li><li>Business systems</li></ul>
    <div class="kp-actions">
      <button type="button" class="btn btn--ivory btn--lg" id="kpMail">Email us <span class="arr">→</span></button>
      <div class="kp-phones">${KP.phones.map(([t, n]) => `<a href="tel:+${n}" aria-label="Call ${t}"><small>Call</small><b>${t}</b></a>`).join('')}</div>
      <div class="kp-phones">${KP.phones.map(([t, n]) => `<a href="https://wa.me/${n}?text=${encodeURIComponent('Hello Keypole Technologies, I saw The Next Chapter and would like a system like this.')}" target="_blank" rel="noopener" aria-label="WhatsApp ${t}"><small>WhatsApp</small><b>${t}</b></a>`).join('')}</div>
    </div>
    <button type="button" class="btn btn--ghost kp-close" data-close>Close</button>
  </div>`);
  $('#kpMail').addEventListener('click', () => {
    const subject = encodeURIComponent('Enquiry: a system like The Next Chapter');
    const body = encodeURIComponent('Hello Keypole Technologies,\n\nI saw The Next Chapter and would like a similar system.\n\nMy name:\nMy event / business:\nWhat I need:\n\nThank you.');
    location.href = `mailto:${KP.m()}?subject=${subject}&body=${body}`;
  });
}
document.getElementById('kpCredit')?.addEventListener('click', openKeypole);
