# The Next Chapter (TNC)

A cinematic, personal invitation and participation platform. Visitors walk through the couple's story, and can give, gift, share wisdom and sign the guestbook. They leave with a keepsake card. Built with HTML, CSS and JS on Firebase.

```
index.html              The experience: loader → agreement → story → occasion → participate → impact → guestbook → invitation → credits
admin/index.html        Admin dashboard (Firebase Auth)
setup/index.html        First-time setup wizard (connection → owner account → couple & event → done)
assets/css/site.css     Public styles (palette: #000 · #6D011A · #7F0020 · #FFFCEF · #FFF, font Quicksand)
assets/css/admin.css    Admin styles
assets/js/fb.js         Firebase init + shared helpers (your web config lives here)
assets/js/defaults.js   Default content: everything is editable in admin
assets/js/site.js       Scenes, animations (GSAP + ScrollTrigger + Lenis), forms, scratch card, signature pad
assets/js/cards.js      Invitation / thank-you / M-Pesa acknowledgement renderer → A4 & A5 PDFs (jsPDF)
assets/js/admin.js      Dashboard logic
assets/img/             Your images, renamed (art-* = story & gallery, gift-* = gift suggestions)
functions/index.js      M-Pesa STK Push + callback + verification, live stats, SMS reminders
firestore.rules         Security rules (visitors can only create well-formed submissions)
```

## 1. One-time Firebase setup (project `mesh-9b2f3`)

1. **Create Firestore.** Firebase Console → *Build → Firestore Database → Create database* (production mode, region `eur3` or nearest). **The site cannot save anything until this is done.** It currently shows default content.
2. **Enable sign-in.** *Build → Authentication → Get started → Email/Password → Enable.*
3. **Deploy the rules, indexes and hosting** (needs the Firebase CLI: `npm i -g firebase-tools`, then `firebase login`):
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes,hosting
   ```
4. **Run the setup wizard** at `https://mesh-9b2f3.web.app/setup/` (also linked from the admin sign-in page). It checks the database connection, then creates the **owner** admin account (the first account becomes owner and sign-up then locks). Next it saves the couple and event basics and loads the starter gift suggestions. Do this right after deploying. To add more admins, have them create an account (they'll see their user ID) and paste it in *Content & settings → Admins*.
5. Edit everything in *Content & settings*: names, photos, story, milestones, gallery, date and venue, target, texts and reminder messages.

## 2. M-Pesa (Daraja STK Push)

Cloud Functions need the **Blaze** (pay-as-you-go) plan. Daraja credentials are stored as server secrets and are **never** placed in the website code.

```bash
cd functions && npm install && cd ..
cp functions/.env.example functions/.env          # set MPESA_SHORTCODE, MPESA_ENV, MPESA_TYPE, PUBLIC_BASE_URL
firebase functions:secrets:set MPESA_CONSUMER_KEY
firebase functions:secrets:set MPESA_CONSUMER_SECRET
firebase functions:secrets:set MPESA_PASSKEY
firebase functions:secrets:set MPESA_CALLBACK_TOKEN   # any long random string
firebase functions:secrets:set AT_API_KEY             # optional (Africa's Talking SMS); enter "none" to skip
firebase deploy --only functions,hosting
```

- Start with `MPESA_ENV=sandbox` (shortcode `174379`) and test. Switch to `production` with your real shortcode/passkey when ready.
- Flow: visitor → `/api/stkPush` → PIN prompt on their phone → Safaricom → `/api/mpesaCallback?token=…`. The callback checks the token, is idempotent, and rejects duplicate receipts. A job every 5 minutes runs an **STK Query** on payments whose callback never arrived.
- Only `SUCCESS` payments count towards the target. Pledges are always shown separately and hatched, never as money received.
- **Without functions deployed**, set a Paybill/Till in *Content → Finance*. Visitors then get manual payment instructions, and the payment stays `PENDING` until you verify the M-Pesa code in *Finance*.

## 3. Reminders

Pledge and gift reminders are only stored when the visitor gives a phone number and consents. Every message carries a one-tap opt-out link (`/?optout=<id>`).

- **Without an SMS provider:** *Admin → Reminders* lists what is due today. Send each one with the WhatsApp or SMS button (pre-filled, gentle wording), then *Mark sent*.
- **With Africa's Talking:** set `AT_USERNAME` (+ optional `AT_SENDER_ID`) and the `AT_API_KEY` secret. Due reminders then go out daily at 09:00 EAT and are marked SENT automatically.

## 4. Run locally

```bash
python -m http.server 5520     # then open http://127.0.0.1:5520
```
- `http://127.0.0.1:5520/admin/#demo` previews the full dashboard with **sample data** (localhost only, nothing is saved).
- `?to=Aunt%20Wanjiku` personalises the hero and the invitation card. *Admin → Invitations* bulk-creates these links.

## 5. How the brief's core rules are enforced

| Rule | Where |
|---|---|
| Pledge ≠ payment, kept separate | `pledges` vs `contributions`; stats compute them apart; UI hatches pledged amounts |
| Only verified M-Pesa updates confirmed totals | Visitors can only create `PENDING`. `SUCCESS` is set by the callback, STK Query or admin verify (rules enforce this) |
| Revealing a gift ≠ obligation | `giftReveals` is analytics only; offers are separate and need explicit choice |
| Only physically received gifts count | Public counter = `giftOffers.status == RECEIVED` |
| Only approved wisdom is public / counted | Rules only expose `APPROVED && public`; private messages can never be published |
| No public ranking, anonymity, no accounts | No leaderboard anywhere; anonymous toggle; visitors never sign in |
| Respectful, consent-based reminders | Consent checkbox, opt-out link, gentle templates |
| Thank-you note ≠ receipt | Separate designs; the note says "not a payment receipt" |

**Stack note:** the brief proposed Django, PostgreSQL and ReportLab. As requested, this build is HTML/CSS/JS on Firebase: Firestore, Auth, Cloud Functions for Daraja, and jsPDF for print-ready A4/A5 PDFs. The data model mirrors the brief's models as Firestore collections.
