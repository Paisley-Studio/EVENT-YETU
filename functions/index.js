/**
 * THE NEXT CHAPTER: Cloud Functions (Node 20, firebase-functions v2)
 *
 *  stkPush         POST /api/stkPush        → starts an M-Pesa STK Push (Daraja)
 *  mpesaCallback   POST /api/mpesaCallback  → Safaricom result callback (token-protected, idempotent)
 *  verifyPending   every 5 min              → STK Query for payments whose callback never arrived
 *  paystackInit    POST /api/paystackInit   → opens a Paystack checkout (card / M-Pesa via Paystack)
 *  paystackVerify  POST /api/paystackVerify → server-side check after the popup reports success
 *  paystackWebhook POST /api/paystackWebhook→ Paystack events (HMAC-signed with the secret key)
 *  Paystack keys are entered by the owner in Admin → Content & settings → Finance & payments.
 *  syncStats       on writes                → recomputes public/stats (confirmed vs pledged kept separate)
 *  sendReminders   daily 09:00 EAT          → sends consented reminders by SMS (Africa's Talking) if configured
 *
 * Secrets (never in frontend code):
 *   firebase functions:secrets:set MPESA_CONSUMER_KEY
 *   firebase functions:secrets:set MPESA_CONSUMER_SECRET
 *   firebase functions:secrets:set MPESA_PASSKEY
 *   firebase functions:secrets:set MPESA_CALLBACK_TOKEN      (any long random string)
 *   firebase functions:secrets:set AT_API_KEY                (optional, for SMS reminders)
 * Params (functions/.env): MPESA_SHORTCODE, MPESA_ENV=sandbox|production, MPESA_TYPE=paybill|till,
 *   PUBLIC_BASE_URL=https://your-site.web.app, AT_USERNAME, AT_SENDER_ID
 */
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { defineSecret, defineString } = require('firebase-functions/params');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
setGlobalOptions({ region: 'europe-west1', maxInstances: 10 });

const MPESA_CONSUMER_KEY = defineSecret('MPESA_CONSUMER_KEY');
const MPESA_CONSUMER_SECRET = defineSecret('MPESA_CONSUMER_SECRET');
const MPESA_PASSKEY = defineSecret('MPESA_PASSKEY');
const MPESA_CALLBACK_TOKEN = defineSecret('MPESA_CALLBACK_TOKEN');
const AT_API_KEY = defineSecret('AT_API_KEY');
const MPESA_SHORTCODE = defineString('MPESA_SHORTCODE', { default: '174379' });
const MPESA_ENV = defineString('MPESA_ENV', { default: 'sandbox' });
const MPESA_TYPE = defineString('MPESA_TYPE', { default: 'paybill' });
const PUBLIC_BASE_URL = defineString('PUBLIC_BASE_URL', { default: '' });
const AT_USERNAME = defineString('AT_USERNAME', { default: '' });
const AT_SENDER_ID = defineString('AT_SENDER_ID', { default: '' });
// Only our own site may call the payment API from a browser.
const ALLOWED_ORIGINS = ['https://event-yetu.online', 'https://www.event-yetu.online', 'https://mesh-9b2f3.web.app', 'https://mesh-9b2f3.firebaseapp.com'];
const safeEqual = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const MPESA_SECRETS = [MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_PASSKEY, MPESA_CALLBACK_TOKEN];

const darajaBase = () => (MPESA_ENV.value() === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke');
const ts = () => { const d = new Date(Date.now() + 3 * 3600 * 1000); return d.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14); }; // EAT
const normalizePhone = (p) => { const d = String(p || '').replace(/\D/g, ''); if (/^0[17]\d{8}$/.test(d)) return '254' + d.slice(1); if (/^254[17]\d{8}$/.test(d)) return d; if (/^[17]\d{8}$/.test(d)) return '254' + d; return null; };

async function darajaToken() {
  const auth = Buffer.from(`${MPESA_CONSUMER_KEY.value()}:${MPESA_CONSUMER_SECRET.value()}`).toString('base64');
  const r = await fetch(`${darajaBase()}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${auth}` } });
  if (!r.ok) throw new Error(`Daraja auth failed (${r.status})`);
  return (await r.json()).access_token;
}
function password(stamp) { return Buffer.from(`${MPESA_SHORTCODE.value()}${MPESA_PASSKEY.value()}${stamp}`).toString('base64'); }

// Shared abuse limits for anything that starts a payment. Returns an error message, or null when allowed.
async function rateLimit(req, phone) {
  // one request per phone per 60s, max 5 per IP per 10 min
  const since = admin.firestore.Timestamp.fromMillis(Date.now() - 60 * 1000);
  const recent = await db.collection('contributions').where('phone', '==', phone).where('at', '>', since).limit(1).get();
  if (!recent.empty) return 'A request was just sent to this number. Please check your phone or wait a minute.';
  const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  const ipRef = db.doc(`ratelimits/${Buffer.from(ip || 'unknown').toString('hex').slice(0, 60)}`);
  const ok = await db.runTransaction(async (t) => {
    const s = await t.get(ipRef); const now = Date.now();
    const hits = ((s.exists && s.data().hits) || []).filter((x) => now - x < 10 * 60 * 1000);
    if (hits.length >= 5) return false;
    t.set(ipRef, { hits: [...hits, now] }); return true;
  });
  if (!ok) return 'Too many attempts. Please try again in a few minutes.';

  // caps that can't be dodged by faking IP headers: max 5 requests per phone per day, max 30 per minute site-wide
  const day = admin.firestore.Timestamp.fromMillis(Date.now() - 24 * 3600 * 1000);
  const perPhone = await db.collection('contributions').where('phone', '==', phone).where('at', '>', day).limit(5).get();
  if (perPhone.size >= 5) return 'This number has had several payment requests today. Please try again tomorrow or pay via Paybill.';
  const globalOk = await db.runTransaction(async (t) => {
    const g = db.doc('ratelimits/_global'); const s = await t.get(g); const now = Date.now();
    const hits = ((s.exists && s.data().hits) || []).filter((x) => now - x < 60 * 1000);
    if (hits.length >= 30) return false;
    t.set(g, { hits: [...hits, now] }); return true;
  });
  if (!globalOk) return 'Payments are busy right now. Please try again in a minute.';
  return null;
}
const checkOrigin = (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return false; }
  const origin = req.headers.origin || '';
  if (origin && !ALLOWED_ORIGINS.includes(origin)) { res.status(403).json({ error: 'Forbidden' }); return false; }
  if (!String(req.headers['content-type'] || '').includes('application/json')) { res.status(415).json({ error: 'Unsupported request' }); return false; }
  return true;
};

// ---------------------------------------------------------------------------
// STK PUSH
// ---------------------------------------------------------------------------
exports.stkPush = onRequest({ secrets: MPESA_SECRETS, cors: ALLOWED_ORIGINS }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const origin = req.headers.origin || '';
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return res.status(403).json({ error: 'Forbidden' });
  if (!String(req.headers['content-type'] || '').includes('application/json')) return res.status(415).json({ error: 'Unsupported request' });
  try {
    const { amount: rawAmount, phone: rawPhone, name = '', anonymous = false, vid = '', ref = '' } = (req.body && typeof req.body === 'object') ? req.body : {};
    const amount = Math.round(Number(rawAmount));
    const phone = normalizePhone(rawPhone);
    if (!Number.isFinite(amount) || amount < 10 || amount > 250000) return res.status(400).json({ error: 'Please enter an amount between KES 10 and 250,000.' });
    if (!phone) return res.status(400).json({ error: 'Please enter a valid M-Pesa number.' });

    const settings = (await db.doc('settings/site').get()).data() || {};
    if (settings.finance && settings.finance.mpesaEnabled === false) return res.status(503).json({ error: 'M-Pesa payments are paused right now.' });

    const limited = await rateLimit(req, phone);
    if (limited) return res.status(429).json({ error: limited });

    const docRef = db.collection('contributions').doc();
    const cleanRef = String(ref).replace(/[^A-Z0-9-]/gi, '').slice(0, 20) || `TNC-${docRef.id.slice(0, 6).toUpperCase()}`;
    await docRef.set({
      amount, phone, name: String(name).replace(/[<>]/g, '').slice(0, 80), anonymous: anonymous === true, vid: String(vid).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30), ref: cleanRef,
      status: 'PENDING', method: 'STK', at: FieldValue.serverTimestamp(),
    });
    await db.doc(`contributionStatus/${docRef.id}`).set({ status: 'PENDING', amount, ref: cleanRef, at: FieldValue.serverTimestamp() });

    const stamp = ts();
    const base = PUBLIC_BASE_URL.value() || `https://${req.headers.host}`;
    const token = await darajaToken();
    const r = await fetch(`${darajaBase()}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        BusinessShortCode: MPESA_SHORTCODE.value(), Password: password(stamp), Timestamp: stamp,
        TransactionType: MPESA_TYPE.value() === 'till' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
        Amount: amount, PartyA: phone, PartyB: MPESA_SHORTCODE.value(), PhoneNumber: phone,
        CallBackURL: `${base}/api/mpesaCallback?token=${encodeURIComponent(MPESA_CALLBACK_TOKEN.value())}`,
        AccountReference: cleanRef.slice(0, 12), TransactionDesc: 'The Next Chapter',
      }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok || out.ResponseCode !== '0') {
      const msg = out.errorMessage || out.ResponseDescription || 'M-Pesa could not start the payment.';
      await docRef.update({ status: 'FAILED', resultDesc: msg });
      await db.doc(`contributionStatus/${docRef.id}`).set({ status: 'FAILED', resultDesc: msg }, { merge: true });
      logger.warn('STK push rejected', out);
      return res.status(502).json({ error: msg });
    }
    await docRef.update({ checkoutRequestId: out.CheckoutRequestID, merchantRequestId: out.MerchantRequestID });
    await db.collection('activity').add({ type: 'stk', label: `M-Pesa request sent: KES ${amount}`, vid: String(vid).slice(0, 30), at: FieldValue.serverTimestamp() });
    return res.json({ ok: true, id: docRef.id, checkoutRequestId: out.CheckoutRequestID });
  } catch (e) {
    logger.error('stkPush', e);
    return res.status(500).json({ error: 'Payment service unavailable. Please try again shortly.' });
  }
});

// ---------------------------------------------------------------------------
// CALLBACK: secure (token), idempotent, duplicate-receipt protected
// ---------------------------------------------------------------------------
async function settle(contribRef, data, result) {
  // result: { code, desc, receipt, amount, phone }
  return db.runTransaction(async (t) => {
    const snap = await t.get(contribRef);
    if (!snap.exists) return 'missing';
    const c = snap.data();
    if (c.status === 'SUCCESS' || c.status === 'FAILED') return 'already-final';
    if (result.code === 0) {
      if (result.receipt) {
        const dup = await t.get(db.collection('contributions').where('mpesaRef', '==', result.receipt).limit(1));
        if (!dup.empty && dup.docs[0].id !== contribRef.id) {
          t.update(contribRef, { status: 'FAILED', resultDesc: 'Duplicate receipt', flagged: true });
          t.set(db.doc(`contributionStatus/${contribRef.id}`), { status: 'FAILED', resultDesc: 'Duplicate transaction' }, { merge: true });
          return 'duplicate';
        }
      }
      const amount = Math.round(Number(result.amount || c.amount));
      const mismatch = amount !== c.amount;
      t.update(contribRef, { status: 'SUCCESS', mpesaRef: result.receipt || '', amount, amountRequested: c.amount, amountMismatch: mismatch, confirmedAt: FieldValue.serverTimestamp(), resultDesc: result.desc || 'Confirmed' });
      t.set(db.doc(`contributionStatus/${contribRef.id}`), { status: 'SUCCESS', amount, mpesaRef: result.receipt || '', ref: c.ref, at: FieldValue.serverTimestamp() }, { merge: true });
      t.set(db.collection('activity').doc(), { type: 'payment', label: `Payment confirmed: KES ${amount}`, vid: c.vid || '', at: FieldValue.serverTimestamp() });
      return 'success';
    }
    t.update(contribRef, { status: 'FAILED', resultCode: result.code, resultDesc: result.desc || 'Not completed' });
    t.set(db.doc(`contributionStatus/${contribRef.id}`), { status: 'FAILED', resultDesc: result.desc || 'Not completed' }, { merge: true });
    return 'failed';
  });
}

exports.mpesaCallback = onRequest({ secrets: [MPESA_CALLBACK_TOKEN] }, async (req, res) => {
  // Always ACK Safaricom so it doesn't retry forever; we never trust the body without matching our own pending record.
  const ack = () => res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  try {
    if (req.method !== 'POST' || !safeEqual(req.query.token, MPESA_CALLBACK_TOKEN.value())) { logger.warn('Callback with bad token'); return res.status(403).json({ ResultCode: 1, ResultDesc: 'Forbidden' }); }
    const cb = req.body && req.body.Body && req.body.Body.stkCallback;
    if (!cb || !cb.CheckoutRequestID) return ack();
    const q = await db.collection('contributions').where('checkoutRequestId', '==', cb.CheckoutRequestID).limit(1).get();
    if (q.empty) { logger.warn('Callback for unknown checkout', cb.CheckoutRequestID); return ack(); }
    const items = Object.fromEntries(((cb.CallbackMetadata && cb.CallbackMetadata.Item) || []).map((i) => [i.Name, i.Value]));
    const outcome = await settle(q.docs[0].ref, q.docs[0].data(), { code: Number(cb.ResultCode), desc: cb.ResultDesc, receipt: items.MpesaReceiptNumber, amount: items.Amount, phone: items.PhoneNumber });
    logger.info('Callback settled', { id: q.docs[0].id, outcome });
    return ack();
  } catch (e) { logger.error('mpesaCallback', e); return ack(); }
});

// ---------------------------------------------------------------------------
// VERIFY: STK Query for pending payments (covers lost callbacks)
// ---------------------------------------------------------------------------
exports.verifyPending = onSchedule({ schedule: 'every 5 minutes', secrets: MPESA_SECRETS }, async () => {
  const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 2 * 60 * 1000);
  const q = await db.collection('contributions').where('status', '==', 'PENDING').where('method', '==', 'STK').where('at', '<', cutoff).limit(20).get();
  if (q.empty) return;
  const token = await darajaToken();
  for (const d of q.docs) {
    const c = d.data();
    if (!c.checkoutRequestId) { await settle(d.ref, c, { code: 1, desc: 'Request was not accepted' }); continue; }
    const stamp = ts();
    const r = await fetch(`${darajaBase()}/mpesa/stkpushquery/v1/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ BusinessShortCode: MPESA_SHORTCODE.value(), Password: password(stamp), Timestamp: stamp, CheckoutRequestID: c.checkoutRequestId }),
    });
    const out = await r.json().catch(() => ({}));
    if (out.ResultCode === undefined) continue; // still processing
    const code = Number(out.ResultCode);
    // STK Query does not return the receipt number; a success here is recorded and the receipt may be added by the admin.
    await settle(d.ref, c, { code, desc: out.ResultDesc, receipt: '', amount: c.amount });
  }
});

// ---------------------------------------------------------------------------
// PAYSTACK: keys are entered by the owner in the admin dashboard.
//   secrets/paystack       { secretKey }  write-only from the browser (rules: read never), read here via Admin SDK
//   paymentConfig/paystack { publicKey, secretHint, mode }  admin-readable status shown in the dashboard
// ---------------------------------------------------------------------------
const PAYSTACK_API = 'https://api.paystack.co';
let psCache = { key: '', exp: 0 };
async function paystackKey() {
  if (psCache.key && psCache.exp > Date.now()) return psCache.key;
  const s = await db.doc('secrets/paystack').get();
  const key = (s.exists && s.get('secretKey')) || '';
  psCache = { key, exp: Date.now() + 60 * 1000 };
  return key;
}
async function paystack(path, opts = {}) {
  const key = await paystackKey();
  if (!key) throw new Error('Paystack is not configured');
  const r = await fetch(`${PAYSTACK_API}${path}`, { ...opts, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const out = await r.json().catch(() => ({}));
  return { ok: r.ok && out.status === true, out };
}

// Ask Paystack (never the browser) what happened, then settle the contribution once.
async function paystackSettle(ref) {
  const snap = await ref.get();
  if (!snap.exists) return 'missing';
  const c = snap.data();
  if (c.method !== 'PAYSTACK' || c.status !== 'PENDING' || !c.paystackRef) return 'not-pending';
  const { out } = await paystack(`/transaction/verify/${encodeURIComponent(c.paystackRef)}`);
  const t = out.data || {};
  if (t.status === 'success') {
    if (t.currency && t.currency !== 'KES') return settle(ref, c, { code: 1, desc: `Unexpected currency ${t.currency}` });
    if (Math.round(Number(t.amount) / 100) < c.amount) logger.warn('Paystack paid less than requested', { id: ref.id, paid: t.amount, asked: c.amount });
    return settle(ref, c, { code: 0, desc: t.gateway_response || 'Confirmed', receipt: t.receipt_number || t.reference, amount: Math.round(Number(t.amount) / 100) });
  }
  if (t.status === 'failed' || t.status === 'reversed') return settle(ref, c, { code: 1, desc: t.gateway_response || 'Payment failed' });
  // abandoned / ongoing / pending: give the payer up to an hour before closing it
  const age = Date.now() - (c.at?.toMillis?.() || Date.now());
  if (age > 60 * 60 * 1000) return settle(ref, c, { code: 1, desc: 'Payment was not completed' });
  return 'pending';
}

exports.paystackInit = onRequest({ cors: ALLOWED_ORIGINS }, async (req, res) => {
  if (!checkOrigin(req, res)) return;
  try {
    const { amount: rawAmount, phone: rawPhone, email: rawEmail = '', name = '', anonymous = false, vid = '', ref = '' } = (req.body && typeof req.body === 'object') ? req.body : {};
    const amount = Math.round(Number(rawAmount));
    const phone = normalizePhone(rawPhone);
    const email = String(rawEmail).trim().toLowerCase();
    if (!Number.isFinite(amount) || amount < 10 || amount > 250000) return res.status(400).json({ error: 'Please enter an amount between KES 10 and 250,000.' });
    if (!phone) return res.status(400).json({ error: 'Please enter a valid phone number.' });
    if (email && !/^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[a-z]{2,}$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address, or leave it empty.' });

    const settings = (await db.doc('settings/site').get()).data() || {};
    // Paystack is used whenever keys are saved, unless the owner explicitly switched it off. Otherwise tell the site to use M-Pesa.
    if ((settings.finance && settings.finance.paystackEnabled === false) || !(await paystackKey())) return res.status(503).json({ error: 'Paystack is not set up.', fallback: true });

    const limited = await rateLimit(req, phone);
    if (limited) return res.status(429).json({ error: limited });

    const docRef = db.collection('contributions').doc();
    const cleanRef = String(ref).replace(/[^A-Z0-9-]/gi, '').slice(0, 20) || `TNC-${docRef.id.slice(0, 6).toUpperCase()}`;
    const paystackRef = `TNC-${docRef.id}`;
    const cleanVid = String(vid).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30);
    await docRef.set({
      amount, phone, name: String(name).replace(/[<>]/g, '').slice(0, 80), anonymous: anonymous === true, vid: cleanVid, ref: cleanRef,
      ...(email ? { email } : {}), paystackRef, status: 'PENDING', method: 'PAYSTACK', at: FieldValue.serverTimestamp(),
    });
    await db.doc(`contributionStatus/${docRef.id}`).set({ status: 'PENDING', amount, ref: cleanRef, at: FieldValue.serverTimestamp() });

    // Paystack requires an email; when the guest gives none we use a per-payment placeholder on our own domain.
    // Paystack rejects some placeholder addresses (e.g. on web.app), so use a plain one on our own domain.
    const placeholder = `guest${docRef.id.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)}@event-yetu.online`;
    const { ok, out } = await paystack('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        // per Paystack docs: amount is a string in the subunit (KES cents), metadata is stringified JSON
        email: email || placeholder, amount: String(amount * 100), currency: 'KES', reference: paystackRef,
        metadata: JSON.stringify({ contributionId: docRef.id, ref: cleanRef, phone, custom_fields: [{ display_name: 'Reference', variable_name: 'ref', value: cleanRef }] }),
      }),
    });
    if (!ok || !out.data?.access_code) {
      const msg = out.message || 'Paystack could not start the payment.';
      await docRef.update({ status: 'FAILED', resultDesc: msg });
      await db.doc(`contributionStatus/${docRef.id}`).set({ status: 'FAILED', resultDesc: msg }, { merge: true });
      logger.warn('Paystack initialize rejected', out);
      return res.status(502).json({ error: 'Online payment could not start. Please try again shortly.' });
    }
    await db.collection('activity').add({ type: 'stk', label: `Paystack checkout opened: KES ${amount}`, vid: cleanVid, at: FieldValue.serverTimestamp() });
    return res.json({ ok: true, id: docRef.id, accessCode: out.data.access_code, url: out.data.authorization_url });
  } catch (e) {
    logger.error('paystackInit', e);
    return res.status(500).json({ error: 'Payment service unavailable. Please try again shortly.' });
  }
});

// Called by the browser right after the Paystack popup reports success. The browser's word is never trusted:
// we look the transaction up with Paystack ourselves.
exports.paystackVerify = onRequest({ cors: ALLOWED_ORIGINS }, async (req, res) => {
  if (!checkOrigin(req, res)) return;
  try {
    const id = String((req.body || {}).id || '');
    if (!/^[A-Za-z0-9]{15,40}$/.test(id)) return res.status(400).json({ error: 'Bad request' });
    const outcome = await paystackSettle(db.doc(`contributions/${id}`));
    return res.json({ ok: true, outcome });
  } catch (e) { logger.error('paystackVerify', e); return res.status(500).json({ error: 'Could not verify yet' }); }
});

// Paystack webhook: signature-checked with the secret key, then re-verified via the API.
exports.paystackWebhook = onRequest(async (req, res) => {
  try {
    const key = await paystackKey();
    const sig = String(req.headers['x-paystack-signature'] || '');
    const expected = key && req.rawBody ? crypto.createHmac('sha512', key).update(req.rawBody).digest('hex') : '';
    if (req.method !== 'POST' || !expected || !safeEqual(sig, expected)) { logger.warn('Paystack webhook with bad signature'); return res.sendStatus(401); }
    const ev = req.body || {};
    const reference = ev.data && ev.data.reference;
    if (reference && /^charge\./.test(ev.event || '')) {
      const q = await db.collection('contributions').where('paystackRef', '==', String(reference)).limit(1).get();
      if (!q.empty) logger.info('Paystack webhook settled', { id: q.docs[0].id, outcome: await paystackSettle(q.docs[0].ref) });
    }
    return res.sendStatus(200);
  } catch (e) { logger.error('paystackWebhook', e); return res.sendStatus(200); }
});

// Safety net for payments where neither the popup nor the webhook reported back.
exports.verifyPaystackPending = onSchedule({ schedule: 'every 10 minutes' }, async () => {
  if (!(await paystackKey())) return;
  const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 3 * 60 * 1000);
  const q = await db.collection('contributions').where('status', '==', 'PENDING').where('method', '==', 'PAYSTACK').where('at', '<', cutoff).limit(20).get();
  for (const d of q.docs) { try { await paystackSettle(d.ref); } catch (e) { logger.warn('verifyPaystackPending', d.id, e.message); } }
});

// ---------------------------------------------------------------------------
// PUBLIC STATS: confirmed vs pledged always kept separate
// ---------------------------------------------------------------------------
async function recompute() {
  const [contrib, pledges, gifts, wisdom, guest, requests, reminders, settings] = await Promise.all([
    db.collection('contributions').select('amount', 'status', 'vid').get(),
    db.collection('pledges').select('amount', 'status', 'vid').get(),
    db.collection('giftOffers').select('status', 'vid').get(),
    db.collection('wisdom').select('status', 'vid').get(),
    db.collection('guestbook').select('status', 'vid').get(),
    db.collection('requests').select('vid').get(),
    db.collection('reminders').select('vid').get(),
    db.doc('settings/site').get(),
  ]);
  const vids = new Set(); const add = (d) => vids.add(d.get('vid') || d.id);
  let confirmedTotal = 0, confirmedCount = 0, pledgedOutstanding = 0, pledgeCount = 0;
  contrib.forEach((d) => { if (d.get('status') === 'SUCCESS') { confirmedTotal += Number(d.get('amount')) || 0; confirmedCount++; add(d); } });
  pledges.forEach((d) => { const s = d.get('status'); if (s === 'PENDING' || s === 'REMINDER_SENT') { pledgedOutstanding += Number(d.get('amount')) || 0; pledgeCount++; } if (s !== 'CANCELLED') add(d); });
  let giftsReceived = 0, giftOffersOpen = 0;
  gifts.forEach((d) => { const s = d.get('status'); if (s === 'RECEIVED') giftsReceived++; else if (s !== 'CANCELLED') giftOffersOpen++; add(d); });
  let wisdomApproved = 0; wisdom.forEach((d) => { if (d.get('status') === 'APPROVED') wisdomApproved++; add(d); });
  let guestbookCount = 0; guest.forEach((d) => { if (d.get('status') !== 'REJECTED') guestbookCount++; add(d); });
  requests.forEach(add); reminders.forEach(add);
  const target = Number(((settings.data() || {}).finance || {}).target) || 500000;
  await db.doc('public/stats').set({ confirmedTotal, confirmedCount, pledgedOutstanding, pledgeCount, giftsReceived, giftOffersOpen, wisdomApproved, guestbookCount, participants: vids.size, target, updatedAt: FieldValue.serverTimestamp() });
}
for (const col of ['contributions', 'pledges', 'giftOffers', 'wisdom', 'guestbook', 'requests']) {
  exports[`stats_${col}`] = onDocumentWritten({ document: `${col}/{id}` }, async (e) => {
    const b = e.data.before.data() || {}, a = e.data.after.data() || {};
    if (e.data.before.exists && e.data.after.exists && b.status === a.status && b.amount === a.amount) return; // nothing that affects stats
    await recompute();
  });
}

// ---------------------------------------------------------------------------
// REMINDERS: gentle, consent-based SMS (only if Africa's Talking is configured)
// ---------------------------------------------------------------------------
exports.sendReminders = onSchedule({ schedule: '0 9 * * *', timeZone: 'Africa/Nairobi', secrets: [AT_API_KEY] }, async () => {
  let apiKey = ''; try { apiKey = AT_API_KEY.value(); } catch { apiKey = ''; }
  if (!apiKey || !AT_USERNAME.value()) { logger.info('SMS provider not configured; reminders stay in the admin queue.'); return; }
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const settings = (await db.doc('settings/site').get()).data() || {};
  const couple = settings.couple ? `${settings.couple.partnerA} & ${settings.couple.partnerB}` : 'the couple';
  const tpls = settings.reminders || {};
  const base = PUBLIC_BASE_URL.value();
  const due = await db.collection('reminders').where('status', '==', 'SCHEDULED').where('date', '<=', today).limit(100).get();
  for (const d of due.docs) {
    const r = d.data();
    if (!r.consent || !r.phone) continue;
    let amount = '';
    if (r.kind === 'pledge' && r.refId) {
      const p = await db.doc(`pledges/${r.refId}`).get();
      if (!p.exists || !['PENDING', 'REMINDER_SENT'].includes(p.get('status'))) { await d.ref.update({ status: 'CANCELLED' }); continue; }
      amount = `KES ${Number(p.get('amount')).toLocaleString('en-KE')}`;
    }
    const msg = String(tpls[r.kind] || tpls.gift || 'A gentle note from {couple}. Thank you!')
      .replace(/\{(\w+)\}/g, (_, k) => ({ name: r.name || 'friend', couple, gift: r.giftName || '', date: r.date, amount }[k] ?? '')) +
      (base ? ` Opt out: ${base}/?optout=${d.id}` : '');
    const body = new URLSearchParams({ username: AT_USERNAME.value(), to: '+' + r.phone, message: msg });
    if (AT_SENDER_ID.value()) body.set('from', AT_SENDER_ID.value());
    const host = AT_USERNAME.value() === 'sandbox' ? 'api.sandbox.africastalking.com' : 'api.africastalking.com';
    const resp = await fetch(`https://${host}/version1/messaging`, { method: 'POST', headers: { apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (resp.ok) {
      await d.ref.update({ status: 'SENT', sentAt: FieldValue.serverTimestamp(), sentBy: 'sms' });
      if (r.kind === 'pledge' && r.refId) await db.doc(`pledges/${r.refId}`).update({ status: 'REMINDER_SENT', reminderStatus: 'SENT' }).catch(() => {});
    } else logger.warn('SMS failed', await resp.text());
  }
});
