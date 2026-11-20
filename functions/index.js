/**
 * THE NEXT CHAPTER: Cloud Functions (Node 20, firebase-functions v2)
 *
 *  stkPush         POST /api/stkPush        → starts an M-Pesa STK Push (Daraja)
 *  mpesaCallback   POST /api/mpesaCallback  → Safaricom result callback (token-protected, idempotent)
 *  verifyPending   every 5 min              → STK Query for payments whose callback never arrived
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

// ---------------------------------------------------------------------------
// STK PUSH
// ---------------------------------------------------------------------------
exports.stkPush = onRequest({ secrets: MPESA_SECRETS, cors: true }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { amount: rawAmount, phone: rawPhone, name = '', anonymous = false, vid = '', ref = '' } = req.body || {};
    const amount = Math.round(Number(rawAmount));
    const phone = normalizePhone(rawPhone);
    if (!Number.isFinite(amount) || amount < 10 || amount > 250000) return res.status(400).json({ error: 'Please enter an amount between KES 10 and 250,000.' });
    if (!phone) return res.status(400).json({ error: 'Please enter a valid M-Pesa number.' });

    const settings = (await db.doc('settings/site').get()).data() || {};
    if (settings.finance && settings.finance.mpesaEnabled === false) return res.status(503).json({ error: 'M-Pesa payments are paused right now.' });

    // rate limit: one request per phone per 60s, max 5 per IP per 10 min
    const since = admin.firestore.Timestamp.fromMillis(Date.now() - 60 * 1000);
    const recent = await db.collection('contributions').where('phone', '==', phone).where('at', '>', since).limit(1).get();
    if (!recent.empty) return res.status(429).json({ error: 'A request was just sent to this number. Please check your phone or wait a minute.' });
    const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
    const ipRef = db.doc(`ratelimits/${Buffer.from(ip || 'unknown').toString('hex').slice(0, 60)}`);
    const ok = await db.runTransaction(async (t) => {
      const s = await t.get(ipRef); const now = Date.now();
      const hits = ((s.exists && s.data().hits) || []).filter((x) => now - x < 10 * 60 * 1000);
      if (hits.length >= 5) return false;
      t.set(ipRef, { hits: [...hits, now] }); return true;
    });
    if (!ok) return res.status(429).json({ error: 'Too many attempts. Please try again in a few minutes.' });

    const docRef = db.collection('contributions').doc();
    const cleanRef = String(ref).replace(/[^A-Z0-9-]/gi, '').slice(0, 20) || `TNC-${docRef.id.slice(0, 6).toUpperCase()}`;
    await docRef.set({
      amount, phone, name: String(name).slice(0, 80), anonymous: !!anonymous, vid: String(vid).slice(0, 30), ref: cleanRef,
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
    if (req.query.token !== MPESA_CALLBACK_TOKEN.value()) { logger.warn('Callback with bad token'); return res.status(403).json({ ResultCode: 1, ResultDesc: 'Forbidden' }); }
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
