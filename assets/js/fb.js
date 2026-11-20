// Shared Firebase bootstrap for the public site and the admin dashboard.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import {
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection, getDocs,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, Timestamp, writeBatch, increment, arrayUnion,
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
import { DEFAULT_SETTINGS, mergeDeep } from './defaults.js';

// Public web config (safe to ship: access is enforced by firestore.rules, not by hiding this).
export const firebaseConfig = {
  apiKey: 'AIzaSyDv98dMyRKweyEDC7bSHYAvPlb-Xa6kXl8',
  authDomain: 'mesh-9b2f3.firebaseapp.com',
  projectId: 'mesh-9b2f3',
  storageBucket: 'mesh-9b2f3.firebasestorage.app',
  messagingSenderId: '339721385220',
  appId: '1:339721385220:web:c0eb17bed64c3d90aacc51',
  measurementId: 'G-SG8CJCL5N5',
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export {
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection, getDocs, query, where, orderBy,
  limit, onSnapshot, serverTimestamp, Timestamp, writeBatch, increment, arrayUnion,
};

// ---- Analytics (lazy, never blocks the page; ad-blockers simply disable it) ----
let analyticsP = null;
function analytics() {
  if (!analyticsP) {
    analyticsP = import('https://www.gstatic.com/firebasejs/13.4.0/firebase-analytics.js')
      .then(async (m) => ((await m.isSupported()) ? { a: m.getAnalytics(app), m } : null))
      .catch(() => null);
  }
  return analyticsP;
}
export async function track(name, params = {}) {
  try { const x = await analytics(); if (x) x.m.logEvent(x.a, name, params); } catch { /* ignore */ }
}

// Never let a slow/unreachable backend freeze the experience.
export function withTimeout(p, ms = 4500, label = 'request') {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out`)), ms))]);
}

// ---- Settings ----
export async function loadSettings() {
  try {
    const snap = await withTimeout(getDoc(doc(db, 'settings', 'site')), 2500, 'settings');
    return mergeDeep(DEFAULT_SETTINGS, snap.exists() ? snap.data() : {});
  } catch (e) {
    console.warn('[TNC] settings fallback', e.message);
    return structuredClone(DEFAULT_SETTINGS);
  }
}

// ---- Helpers ----
export function makeRef(prefix = 'TNC') {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const r = crypto.getRandomValues(new Uint8Array(6));
  for (const n of r) s += abc[n % abc.length];
  return `${prefix}-${s}`;
}

export function visitorId() {
  try {
    let v = localStorage.getItem('tnc_vid');
    if (!v) { v = makeRef('V'); localStorage.setItem('tnc_vid', v); }
    return v;
  } catch { return 'V-ANON'; }
}

export const money = (n, cur = 'KES') =>
  `${cur} ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;

export function normalizePhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (/^0[17]\d{8}$/.test(d)) return '254' + d.slice(1);
  if (/^254[17]\d{8}$/.test(d)) return d;
  if (/^[17]\d{8}$/.test(d)) return '254' + d;
  return null;
}

export const toDate = (t) => (t?.toDate ? t.toDate() : t ? new Date(t) : null);
export const fmtDate = (t, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => {
  const d = toDate(t); return d && !isNaN(d) ? d.toLocaleDateString('en-GB', opts) : '';
};

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Downscale an image file to a JPEG data URL (keeps Firestore docs well under 1 MB).
export function compressImage(file, max = 1000, quality = 0.78) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('Please choose an image file.'));
    if (file.size > 15 * 1024 * 1024) return reject(new Error('Image is too large (max 15 MB).'));
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = URL.createObjectURL(file);
  });
}

// Small client-side rate limit so double-clicks and spam bursts don't flood the database.
export function rateOk(key, ms = 15000) {
  try {
    const k = 'tnc_rl_' + key, now = Date.now(), last = +localStorage.getItem(k) || 0;
    if (now - last < ms) return false;
    localStorage.setItem(k, String(now)); return true;
  } catch { return true; }
}

export async function logActivity(type, label, extra = {}) {
  try { await addDoc(collection(db, 'activity'), { type, label: String(label).slice(0, 200), ...extra, vid: visitorId(), at: serverTimestamp() }); } catch { /* ignore */ }
}
