# Digest hebdomadaire par email (Pro2/Pro3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send an automated weekly email (Mondays) to Pro2/Pro3 business locations summarizing their traffic stats, with a one-click unsubscribe link and a per-location preference toggle exposed on a new "Paramètres" page on the pro site.

**Architecture:** Backend adds a `notificationPreferences.weeklyDigestEmail` flag on `Location`, a new `businessDigest.service.js` (email content + HMAC-signed unsubscribe tokens + the send loop), a new cron tick calling it every Monday, a new public unsubscribe endpoint, and a new authenticated preference-toggle endpoint on the existing business profile routes. Frontend renames `/dashboard/account` to `/dashboard/settings`, adds a toggle wired to the new endpoint, and shows a confirmation banner after unsubscribe redirects back.

**Tech Stack:** Node.js (ESM) + Express + Mongoose + `node:test` (backend, `loocateme_backend`); Next.js (App Router) + TypeScript + Tailwind (frontend, `loocateme_website/loocateme_website`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-21-digest-hebdomadaire-pro-design.md`

## Global Constraints

- Backend is ESM (`"type": "module"` in `package.json`); tests run via `node --test tests/` using `node:test` + `node:assert/strict` — no DB connection, no mocking library. Existing tests stub Mongoose model statics directly (e.g. `Location.find = () => ...`) since those are mutable object properties; this works, but a plain function export (e.g. `sendMail`, `getLocationStats`) is a frozen ESM binding and **cannot** be reassigned from a test file — those must be passed as injectable parameters with real-implementation defaults instead (see Task 2).
- Frontend (`loocateme_website/loocateme_website`) has **no automated test runner installed** (`package.json` has no test script, no Jest/Vitest/RTL anywhere in the repo). Do not introduce one as part of this plan — verify frontend tasks manually via `npm run dev` in a browser, per the steps given in each task.
- All user-facing copy (emails, UI strings) is in French, matching the existing tone (`policyNotification.service.js`, dashboard pages).
- Frontend digest weekday index: 0 = lundi … 6 = dimanche (matches `Location.js` comment on `analytics.visitsByWeekday` and `businessStats.service.js`'s `MONGO_DOW_TO_MONDAY_FIRST`).
- Company identity for the CAN-SPAM footer (postal address) is copied verbatim from `POLICY_PRIVACY.md` §1: "Arnaud THERET, entrepreneur individuel (micro-entreprise), domicilié 53 rue de Paris, 60200 Compiègne, France."
- New secrets go in `.env.example` (tracked template), never in `.env` (untracked, local).

---

## Task 1: `Location` schema — notification preferences field

**Files:**
- Modify: `src/models/Location.js:118-123`
- Test: `tests/location.model.test.js` (new)

**Interfaces:**
- Produces: `Location` documents now default to `notificationPreferences.weeklyDigestEmail === true`. Later tasks (2, 3) read/write this exact path.

- [ ] **Step 1: Write the failing test**

Create `tests/location.model.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Location } from '../src/models/Location.js';

test('Location schema: notificationPreferences.weeklyDigestEmail defaults to true', () => {
  const doc = new Location({ name: 'Test Bar', ownerId: '000000000000000000000000' });
  assert.equal(doc.notificationPreferences.weeklyDigestEmail, true);
});

test('Location schema: notificationPreferences.weeklyDigestEmail can be set to false', () => {
  const doc = new Location({
    name: 'Test Bar',
    ownerId: '000000000000000000000000',
    notificationPreferences: { weeklyDigestEmail: false },
  });
  assert.equal(doc.notificationPreferences.weeklyDigestEmail, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/location.model.test.js`
Expected: FAIL — `TypeError: Cannot read properties of undefined (reading 'weeklyDigestEmail')` (the field doesn't exist yet).

- [ ] **Step 3: Add the field to the schema**

In `src/models/Location.js`, find the `sponsorship` block (currently lines 118-122):

```js
    sponsorship: {
      active: { type: Boolean, default: false, index: true },
      until: { type: Date },
      activatedAt: { type: Date },
    },
```

Insert immediately after it (still before the `events:` field / its preceding comment):

```js
    // Préférences de notification par email, indépendantes du palier d'abonnement
    // (un pro peut préconfigurer sa préférence même à un palier qui n'y donne pas
    // encore accès). Défaut à true : ce digest est un email de service lié à
    // l'abonnement payé, pas une newsletter marketing — désabonnement en un clic
    // fourni dans chaque envoi (cf. businessDigest.service.js).
    notificationPreferences: {
      weeklyDigestEmail: { type: Boolean, default: true },
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/location.model.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/models/Location.js tests/location.model.test.js
git commit -m "feat: add Location.notificationPreferences.weeklyDigestEmail field"
```

---

## Task 2: `businessDigest.service.js` — email content, unsubscribe tokens, send loop

**Files:**
- Create: `src/services/businessDigest.service.js`
- Modify: `.env.example:30` (add `DIGEST_UNSUBSCRIBE_SECRET`)
- Test: `tests/businessDigest.service.test.js` (new)

**Interfaces:**
- Consumes: `Location.find` (Mongoose static, stubbable), `User.findById` (Mongoose static, stubbable), `getLocationStats(locationId)` from `src/services/businessStats.service.js` (returns `{ views: { '7d': { current, previous, deltaPct } }, visitsByWeekday, ... }`, already implemented), `sendMail({ to, subject, text, html })` from `src/services/email.service.js` (already implemented).
- Produces (used by Task 3 and Task 5):
  - `buildDigestEmail({ location: { name }, stats, unsubscribeUrl }) => { subject: string, text: string, html: string }`
  - `signUnsubscribeToken(locationId) => string` (format `"<locationId>.<hex hmac>"`)
  - `verifyUnsubscribeToken(token) => string | null` (returns the `locationId` if valid, else `null`)
  - `sendBusinessWeeklyDigest({ sendMailFn?, getStatsFn? } = {}) => Promise<number>` (returns count of emails actually sent; both params default to the real `sendMail`/`getLocationStats` so production calls take no arguments)

- [ ] **Step 1: Write the failing tests**

Create `tests/businessDigest.service.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Location } from '../src/models/Location.js';
import { User } from '../src/models/User.js';
import {
  buildDigestEmail,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  sendBusinessWeeklyDigest,
} from '../src/services/businessDigest.service.js';

function statsWith({ current = 0, deltaPct = null, visitsByWeekday = [0, 0, 0, 0, 0, 0, 0] } = {}) {
  return { views: { '7d': { current, previous: 0, deltaPct } }, visitsByWeekday };
}

test('buildDigestEmail: normal case includes view count, trend and best weekday', () => {
  const location = { name: 'Le Central' };
  const stats = statsWith({ current: 42, deltaPct: 12.5, visitsByWeekday: [1, 2, 30, 4, 5, 6, 7] });
  const { subject, text } = buildDigestEmail({ location, stats, unsubscribeUrl: 'https://api.loocate.me/x' });
  assert.match(subject, /Le Central/);
  assert.match(text, /42 fois/);
  assert.match(text, /\+12\.5%/);
  assert.match(text, /mercredi/); // index 2 (0=lundi) has the max count (30)
  assert.match(text, /https:\/\/api\.loocate\.me\/x/);
});

test('buildDigestEmail: null deltaPct omits the trend percentage', () => {
  const stats = statsWith({ current: 10, deltaPct: null });
  const { text } = buildDigestEmail({ location: { name: 'X' }, stats, unsubscribeUrl: 'u' });
  assert.match(text, /10 fois/);
  assert.doesNotMatch(text, /%/);
});

test('buildDigestEmail: zero views uses the neutral no-traffic message', () => {
  const stats = statsWith({ current: 0 });
  const { text } = buildDigestEmail({ location: { name: 'X' }, stats, unsubscribeUrl: 'u' });
  assert.match(text, /Aucune vue/);
});

test('buildDigestEmail: all weekdays at zero omits the best-day line', () => {
  const stats = statsWith({ current: 5, visitsByWeekday: [0, 0, 0, 0, 0, 0, 0] });
  const { text } = buildDigestEmail({ location: { name: 'X' }, stats, unsubscribeUrl: 'u' });
  assert.doesNotMatch(text, /meilleur jour/);
});

test('signUnsubscribeToken / verifyUnsubscribeToken: valid round-trip returns the locationId', () => {
  const token = signUnsubscribeToken('64b000000000000000000001');
  assert.equal(verifyUnsubscribeToken(token), '64b000000000000000000001');
});

test('verifyUnsubscribeToken: rejects a tampered signature', () => {
  const token = signUnsubscribeToken('64b000000000000000000001');
  const lastChar = token.at(-1);
  const tampered = token.slice(0, -1) + (lastChar === '0' ? '1' : '0');
  assert.equal(verifyUnsubscribeToken(tampered), null);
});

test('verifyUnsubscribeToken: rejects malformed or missing tokens', () => {
  assert.equal(verifyUnsubscribeToken('not-a-valid-token'), null);
  assert.equal(verifyUnsubscribeToken(''), null);
  assert.equal(verifyUnsubscribeToken(undefined), null);
});

function stubLocationFind(locations) {
  const original = Location.find;
  let capturedFilter = null;
  Location.find = (filter) => {
    capturedFilter = filter;
    return { select: () => ({ lean: async () => locations }) };
  };
  return { getFilter: () => capturedFilter, restore: () => { Location.find = original; } };
}

function stubUserFindById(emailsById) {
  const original = User.findById;
  User.findById = (id) => ({
    select: () => ({ lean: async () => (emailsById[id] ? { email: emailsById[id] } : null) }),
  });
  return () => { User.findById = original; };
}

test('sendBusinessWeeklyDigest: queries only pro2/pro3 locations that have not opted out', async () => {
  const { getFilter, restore } = stubLocationFind([]);
  const restoreUser = stubUserFindById({});
  try {
    await sendBusinessWeeklyDigest();
    const filter = getFilter();
    assert.deepEqual(filter.businessTier, { $in: ['pro2', 'pro3'] });
    assert.deepEqual(filter['notificationPreferences.weeklyDigestEmail'], { $ne: false });
  } finally {
    restore();
    restoreUser();
  }
});

test('sendBusinessWeeklyDigest: sends one email per eligible location to its resolved owner email', async () => {
  const locations = [
    { _id: 'loc1', name: 'Le Central', ownerId: 'owner1' },
    { _id: 'loc2', name: 'Chez Momo', ownerId: 'owner2' },
  ];
  const { restore } = stubLocationFind(locations);
  const restoreUser = stubUserFindById({ owner1: 'pro1@example.com', owner2: 'pro2@example.com' });
  const sent = [];
  const sendMailFn = async (msg) => { sent.push(msg); };
  const getStatsFn = async () => statsWith({ current: 5, deltaPct: 25 });
  try {
    const count = await sendBusinessWeeklyDigest({ sendMailFn, getStatsFn });
    assert.equal(count, 2);
    assert.deepEqual(sent.map((m) => m.to), ['pro1@example.com', 'pro2@example.com']);
  } finally {
    restore();
    restoreUser();
  }
});

test('sendBusinessWeeklyDigest: skips a location whose owner has no resolvable email, without crashing', async () => {
  const locations = [{ _id: 'loc1', name: 'Le Central', ownerId: 'ghost' }];
  const { restore } = stubLocationFind(locations);
  const restoreUser = stubUserFindById({});
  const sent = [];
  const sendMailFn = async (msg) => { sent.push(msg); };
  const getStatsFn = async () => statsWith({ current: 1 });
  try {
    const count = await sendBusinessWeeklyDigest({ sendMailFn, getStatsFn });
    assert.equal(count, 0);
    assert.equal(sent.length, 0);
  } finally {
    restore();
    restoreUser();
  }
});

test('sendBusinessWeeklyDigest: a send failure on one location does not stop the others', async () => {
  const locations = [
    { _id: 'loc1', name: 'A', ownerId: 'owner1' },
    { _id: 'loc2', name: 'B', ownerId: 'owner2' },
  ];
  const { restore } = stubLocationFind(locations);
  const restoreUser = stubUserFindById({ owner1: 'a@example.com', owner2: 'b@example.com' });
  const sent = [];
  const sendMailFn = async (msg) => {
    if (msg.to === 'a@example.com') throw new Error('SMTP down');
    sent.push(msg);
  };
  const getStatsFn = async () => statsWith({ current: 1 });
  try {
    const count = await sendBusinessWeeklyDigest({ sendMailFn, getStatsFn });
    assert.equal(count, 1);
    assert.equal(sent[0].to, 'b@example.com');
  } finally {
    restore();
    restoreUser();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/businessDigest.service.test.js`
Expected: FAIL — `Cannot find module '../src/services/businessDigest.service.js'` (file doesn't exist yet).

- [ ] **Step 3: Create the service**

Create `src/services/businessDigest.service.js`:

```js
import crypto from 'crypto';
import { Location } from '../models/Location.js';
import { User } from '../models/User.js';
import { getLocationStats } from './businessStats.service.js';
import { sendMail } from './email.service.js';

const UNSUBSCRIBE_SECRET = process.env.DIGEST_UNSUBSCRIBE_SECRET || '';

const WEEKDAY_LABELS_FR = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

// Identité légale reprise de POLICY_PRIVACY.md §1 — exigée par CAN-SPAM (adresse
// postale de l'expéditeur) pour tout email envoyé à des destinataires US.
const COMPANY_FOOTER =
  "LoocateMe est édité par Arnaud THERET, entrepreneur individuel (micro-entreprise), domicilié 53 rue de Paris, 60200 Compiègne, France.";

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// index 0 = lundi ... 6 = dimanche (cf. Location.analytics.visitsByWeekday). Retourne
// null si aucune visite sur la fenêtre (pas de jour "meilleur" à afficher).
function bestWeekdayLabel(visitsByWeekday) {
  if (!Array.isArray(visitsByWeekday) || visitsByWeekday.every((v) => !v)) return null;
  let bestIndex = 0;
  for (let i = 1; i < visitsByWeekday.length; i += 1) {
    if (visitsByWeekday[i] > visitsByWeekday[bestIndex]) bestIndex = i;
  }
  return WEEKDAY_LABELS_FR[bestIndex];
}

export function buildDigestEmail({ location, stats, unsubscribeUrl }) {
  const siteUrl = process.env.BUSINESS_SITE_PUBLIC_URL || 'http://localhost:3000';
  const statsUrl = `${siteUrl}/dashboard/stats`;
  const { current, deltaPct } = stats.views['7d'];
  const best = bestWeekdayLabel(stats.visitsByWeekday);

  const trendSuffix = deltaPct !== null ? ` (${deltaPct >= 0 ? '+' : ''}${deltaPct}% vs semaine précédente)` : '';
  const viewsLine = current > 0
    ? `Votre fiche a été vue ${current} fois cette semaine${trendSuffix}.`
    : 'Aucune vue sur votre fiche cette semaine, pensez à booster votre visibilité.';
  const bestLine = best ? `Votre meilleur jour a été ${best}.` : '';

  const subject = `Votre semaine sur LoocateMe Pro — ${location.name}`;
  const text = [
    viewsLine,
    bestLine,
    '',
    `Voir toutes vos statistiques : ${statsUrl}`,
    '',
    COMPANY_FOOTER,
    `Se désabonner de ce résumé hebdomadaire : ${unsubscribeUrl}`,
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <p>${escapeHtml(viewsLine)}</p>
    ${bestLine ? `<p>${escapeHtml(bestLine)}</p>` : ''}
    <p><a href="${statsUrl}">Voir toutes vos statistiques</a></p>
    <p style="color:#888;font-size:12px;">${escapeHtml(COMPANY_FOOTER)}<br/><a href="${unsubscribeUrl}">Se désabonner de ce résumé hebdomadaire</a></p>
  `;

  return { subject, text, html };
}

export function signUnsubscribeToken(locationId) {
  const id = String(locationId);
  const signature = crypto.createHmac('sha256', UNSUBSCRIBE_SECRET).update(id).digest('hex');
  return `${id}.${signature}`;
}

// Retourne le locationId si le token est valide, sinon null. Comparaison en temps
// constant pour ne pas laisser fuiter d'information sur la signature attendue.
export function verifyUnsubscribeToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dotIndex = token.lastIndexOf('.');
  if (dotIndex <= 0) return null;
  const id = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);
  const expected = crypto.createHmac('sha256', UNSUBSCRIBE_SECRET).update(id).digest('hex');
  const signatureBuf = Buffer.from(signature, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (signatureBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(signatureBuf, expectedBuf)) return null;
  return id;
}

// Boucle sur les lieux Pro2/Pro3 n'ayant pas désactivé le digest et envoie un email
// récapitulatif hebdomadaire à leur propriétaire. sendMailFn/getStatsFn sont
// injectables pour les tests (ce sont des exports de fonction ESM, non mockables
// depuis l'extérieur du module) ; en production, sendBusinessWeeklyDigest() est
// appelé sans argument par cron.service.js. Retourne le nombre d'emails envoyés.
export async function sendBusinessWeeklyDigest({ sendMailFn = sendMail, getStatsFn = getLocationStats } = {}) {
  const locations = await Location.find({
    businessTier: { $in: ['pro2', 'pro3'] },
    'notificationPreferences.weeklyDigestEmail': { $ne: false },
  })
    .select('_id name ownerId')
    .lean();

  const apiBaseUrl = process.env.API_PUBLIC_URL || process.env.BASE_URL || 'https://api.loocate.me';

  let sentCount = 0;
  for (const location of locations) {
    try {
      const owner = await User.findById(location.ownerId).select('email').lean();
      if (!owner?.email) continue;

      const stats = await getStatsFn(location._id);
      const unsubscribeUrl = `${apiBaseUrl}/api/business/digest/unsubscribe?token=${encodeURIComponent(signUnsubscribeToken(location._id))}`;
      const { subject, text, html } = buildDigestEmail({ location, stats, unsubscribeUrl });

      await sendMailFn({ to: owner.email, subject, text, html });
      sentCount += 1;
    } catch (e) {
      console.error(`[businessDigest] Failed to send weekly digest for location ${location._id}:`, e?.message || e);
    }
  }
  return sentCount;
}
```

- [ ] **Step 4: Add the new env var to `.env.example`**

In `.env.example`, immediately after the line `BUSINESS_SITE_PUBLIC_URL=https://pro.loocate.me`, insert:

```
# Secret HMAC dédié à la signature des liens de désabonnement du digest hebdomadaire
# pro (businessDigest.service.js) — distinct de JWT_ACCESS_SECRET/JWT_REFRESH_SECRET.
DIGEST_UNSUBSCRIBE_SECRET=replace-with-strong-digest-secret
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/businessDigest.service.test.js`
Expected: PASS (11 tests).

- [ ] **Step 6: Commit**

```bash
git add src/services/businessDigest.service.js tests/businessDigest.service.test.js .env.example
git commit -m "feat: add business weekly digest email content, unsubscribe tokens and send loop"
```

---

## Task 3: Notification preferences endpoint

**Files:**
- Modify: `src/controllers/businessProfile.controller.js:87` (insert after `getCheckinQr`)
- Modify: `src/routes/businessProfile.routes.js:22` (insert after the checkin-qr route)
- Test: `tests/businessProfile.controller.test.js` (new)

**Interfaces:**
- Consumes: `req.location` (Mongoose document, already loaded by `requireLocationOwner` middleware — not re-tested here, only the controller logic is).
- Produces: `PUT /api/business/locations/:locationId/notification-preferences` — body `{ weeklyDigestEmail: boolean }`, response `{ location }` on success, `400 { code: 'INVALID_BODY' }` if `weeklyDigestEmail` isn't a boolean.

- [ ] **Step 1: Write the failing test**

Create `tests/businessProfile.controller.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { BusinessProfileController } from '../src/controllers/businessProfile.controller.js';

function makeLocation(overrides = {}) {
  return {
    notificationPreferences: { weeklyDigestEmail: true },
    saveCalls: 0,
    save() { this.saveCalls += 1; return Promise.resolve(this); },
    ...overrides,
  };
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

const throwOnNext = (err) => { throw err; };

test('updateNotificationPreferences: disables the weekly digest and persists it', async () => {
  const location = makeLocation();
  const req = { location, body: { weeklyDigestEmail: false } };
  const res = makeRes();
  await BusinessProfileController.updateNotificationPreferences(req, res, throwOnNext);
  assert.equal(location.notificationPreferences.weeklyDigestEmail, false);
  assert.equal(location.saveCalls, 1);
  assert.equal(res.body.location.notificationPreferences.weeklyDigestEmail, false);
});

test('updateNotificationPreferences: re-enables the weekly digest', async () => {
  const location = makeLocation({ notificationPreferences: { weeklyDigestEmail: false } });
  const req = { location, body: { weeklyDigestEmail: true } };
  const res = makeRes();
  await BusinessProfileController.updateNotificationPreferences(req, res, throwOnNext);
  assert.equal(location.notificationPreferences.weeklyDigestEmail, true);
});

test('updateNotificationPreferences: rejects a non-boolean value without saving', async () => {
  const location = makeLocation();
  const req = { location, body: { weeklyDigestEmail: 'yes' } };
  const res = makeRes();
  await BusinessProfileController.updateNotificationPreferences(req, res, throwOnNext);
  assert.equal(res.statusCode, 400);
  assert.equal(location.saveCalls, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/businessProfile.controller.test.js`
Expected: FAIL — `TypeError: BusinessProfileController.updateNotificationPreferences is not a function`.

- [ ] **Step 3: Add the controller handler**

In `src/controllers/businessProfile.controller.js`, immediately after the `getCheckinQr` handler's closing `},` (right before `updateCover: async (req, res, next) => {`), insert:

```js
  // Indépendant du palier (cf. Task 1) : un pro peut préconfigurer sa préférence
  // même à un palier qui n'y donne pas encore accès.
  updateNotificationPreferences: async (req, res, next) => {
    try {
      const { weeklyDigestEmail } = req.body;
      if (typeof weeklyDigestEmail !== 'boolean') {
        return res.status(400).json({ code: 'INVALID_BODY', message: 'weeklyDigestEmail doit être un booléen' });
      }
      req.location.notificationPreferences = req.location.notificationPreferences || {};
      req.location.notificationPreferences.weeklyDigestEmail = weeklyDigestEmail;
      await req.location.save({ validateModifiedOnly: true });
      return res.json({ location: req.location });
    } catch (err) {
      next(err);
    }
  },

```

- [ ] **Step 4: Add the route**

In `src/routes/businessProfile.routes.js`, immediately after:

```js
router.get('/locations/:locationId/checkin-qr', requireAuth, requireLocationOwner, BusinessProfileController.getCheckinQr);
```

insert:

```js

// Préférence de notification, indépendante du palier (cf. contrôleur).
router.put(
  '/locations/:locationId/notification-preferences',
  requireAuth,
  requireLocationOwner,
  BusinessProfileController.updateNotificationPreferences
);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/businessProfile.controller.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/controllers/businessProfile.controller.js src/routes/businessProfile.routes.js tests/businessProfile.controller.test.js
git commit -m "feat: add PUT notification-preferences endpoint for business locations"
```

---

## Task 4: Unsubscribe endpoint (public)

**Files:**
- Create: `src/controllers/businessDigest.controller.js`
- Create: `src/routes/businessDigest.routes.js`
- Modify: `src/server.js:32` (import) and `src/server.js:183` (mount)
- Test: `tests/businessDigest.controller.test.js` (new)

**Interfaces:**
- Consumes: `verifyUnsubscribeToken` and `signUnsubscribeToken` from Task 2's `src/services/businessDigest.service.js`; `Location.updateOne` (Mongoose static, stubbable).
- Produces: `GET /api/business/digest/unsubscribe?token=...` — no auth required, always responds with a redirect (`302`) to `${BUSINESS_SITE_PUBLIC_URL}/dashboard/settings?digest=unsubscribed|error`, never a raw JSON error (it's a link clicked from an email client).

- [ ] **Step 1: Write the failing tests**

Create `tests/businessDigest.controller.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Location } from '../src/models/Location.js';
import { BusinessDigestController } from '../src/controllers/businessDigest.controller.js';
import { signUnsubscribeToken } from '../src/services/businessDigest.service.js';

function makeRes() {
  return {
    redirectedTo: null,
    redirect(url) { this.redirectedTo = url; },
  };
}

function stubLocationUpdateOne(matchedCount) {
  const original = Location.updateOne;
  const calls = [];
  Location.updateOne = async (filter, update) => {
    calls.push({ filter, update });
    return { matchedCount };
  };
  return { calls, restore: () => { Location.updateOne = original; } };
}

test('unsubscribe: valid token disables the digest and redirects to the success page', async () => {
  const token = signUnsubscribeToken('64b000000000000000000001');
  const { calls, restore } = stubLocationUpdateOne(1);
  const req = { query: { token } };
  const res = makeRes();
  try {
    await BusinessDigestController.unsubscribe(req, res);
    assert.equal(calls[0].filter._id, '64b000000000000000000001');
    assert.equal(calls[0].update['notificationPreferences.weeklyDigestEmail'], false);
    assert.match(res.redirectedTo, /digest=unsubscribed/);
  } finally {
    restore();
  }
});

test('unsubscribe: missing token redirects to the error page without touching the DB', async () => {
  const { calls, restore } = stubLocationUpdateOne(1);
  const req = { query: {} };
  const res = makeRes();
  try {
    await BusinessDigestController.unsubscribe(req, res);
    assert.equal(calls.length, 0);
    assert.match(res.redirectedTo, /digest=error/);
  } finally {
    restore();
  }
});

test('unsubscribe: tampered token redirects to the error page without touching the DB', async () => {
  const token = signUnsubscribeToken('64b000000000000000000001');
  const lastChar = token.at(-1);
  const tampered = token.slice(0, -1) + (lastChar === '0' ? '1' : '0');
  const { calls, restore } = stubLocationUpdateOne(1);
  const req = { query: { token: tampered } };
  const res = makeRes();
  try {
    await BusinessDigestController.unsubscribe(req, res);
    assert.equal(calls.length, 0);
    assert.match(res.redirectedTo, /digest=error/);
  } finally {
    restore();
  }
});

test('unsubscribe: well-signed token for a location that no longer exists redirects to the error page', async () => {
  const token = signUnsubscribeToken('64b000000000000000000001');
  const { restore } = stubLocationUpdateOne(0);
  const req = { query: { token } };
  const res = makeRes();
  try {
    await BusinessDigestController.unsubscribe(req, res);
    assert.match(res.redirectedTo, /digest=error/);
  } finally {
    restore();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/businessDigest.controller.test.js`
Expected: FAIL — `Cannot find module '../src/controllers/businessDigest.controller.js'`.

- [ ] **Step 3: Create the controller**

Create `src/controllers/businessDigest.controller.js`:

```js
import { Location } from '../models/Location.js';
import { verifyUnsubscribeToken } from '../services/businessDigest.service.js';

export const BusinessDigestController = {
  // Public (pas de requireAuth) : cliqué depuis un client mail, sans session pro
  // active. Le token porte sa propre preuve d'autorisation (cf. businessDigest.service.js).
  // Toujours une redirection navigateur, jamais un JSON brut.
  unsubscribe: async (req, res) => {
    const siteUrl = process.env.BUSINESS_SITE_PUBLIC_URL || 'http://localhost:3000';
    try {
      const locationId = verifyUnsubscribeToken(req.query.token);
      if (!locationId) {
        return res.redirect(`${siteUrl}/dashboard/settings?digest=error`);
      }
      const result = await Location.updateOne(
        { _id: locationId },
        { 'notificationPreferences.weeklyDigestEmail': false }
      );
      if (result.matchedCount === 0) {
        return res.redirect(`${siteUrl}/dashboard/settings?digest=error`);
      }
      return res.redirect(`${siteUrl}/dashboard/settings?digest=unsubscribed`);
    } catch (e) {
      console.error('[businessDigest] Unsubscribe failed:', e?.message || e);
      return res.redirect(`${siteUrl}/dashboard/settings?digest=error`);
    }
  },
};
```

- [ ] **Step 4: Create the routes file**

Create `src/routes/businessDigest.routes.js`:

```js
import { Router } from 'express';
import { BusinessDigestController } from '../controllers/businessDigest.controller.js';

const router = Router();

// Public : aucun requireAuth, le token porte sa propre preuve d'autorisation.
router.get('/unsubscribe', BusinessDigestController.unsubscribe);

export default router;
```

- [ ] **Step 5: Mount the route in `server.js`**

In `src/server.js`, immediately after:

```js
import businessBoostRoutes from './routes/businessBoost.routes.js';
```

insert:

```js
import businessDigestRoutes from './routes/businessDigest.routes.js';
```

Then, immediately after:

```js
app.use('/api/business', businessBoostRoutes);
```

insert:

```js
app.use('/api/business/digest', businessDigestRoutes);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tests/businessDigest.controller.test.js`
Expected: PASS (4 tests).

- [ ] **Step 7: Verify the route wiring by inspection**

This wiring has no automated coverage (it needs a running server + DB). Re-read the two edits made to `src/server.js` and confirm: the import path matches the file created in Step 4, and `app.use('/api/business/digest', businessDigestRoutes)` appears once, after the other `/api/business*` mounts.

- [ ] **Step 8: Commit**

```bash
git add src/controllers/businessDigest.controller.js src/routes/businessDigest.routes.js src/server.js tests/businessDigest.controller.test.js
git commit -m "feat: add public unsubscribe endpoint for the business weekly digest"
```

---

## Task 5: Cron wiring — send every Monday

**Files:**
- Modify: `src/services/cron.service.js:8` (import) and `src/services/cron.service.js:30-31` (new schedule)

**Interfaces:**
- Consumes: `sendBusinessWeeklyDigest` from Task 2's `src/services/businessDigest.service.js` (called with no arguments — production defaults to the real `sendMail`/`getLocationStats`).

- [ ] **Step 1: Add the import**

In `src/services/cron.service.js`, immediately after:

```js
import { processPolicyEmailJobs } from './policyNotification.service.js';
```

insert:

```js
import { sendBusinessWeeklyDigest } from './businessDigest.service.js';
```

- [ ] **Step 2: Add the schedule**

In `src/services/cron.service.js`, immediately after the existing block:

```js
    // Weekly Digest: Tous les lundis à 09:00
    nodeCron.schedule('0 9 * * 1', () => {
      console.log('[cron] Starting Weekly Digest...');
      CronService.sendWeeklyDigest();
    });
```

insert:

```js

    // Digest hebdomadaire par email (pros Pro2/Pro3, stats de fréquentation) : tous
    // les lundis à 08h30, décalé du digest push grand public ci-dessus (09h00) pour
    // étaler la charge SMTP/push. À ne pas confondre avec sendWeeklyDigest (push,
    // utilisateurs grand public) — cf. docs/superpowers/specs/2026-08-21-digest-hebdomadaire-pro-design.md.
    nodeCron.schedule('30 8 * * 1', async () => {
      console.log('[cron] Starting Business Weekly Digest (email)...');
      try {
        const count = await sendBusinessWeeklyDigest();
        console.log(`[cron] Business weekly digest sent to ${count} pro locations.`);
      } catch (e) {
        console.error('[cron] Business weekly digest error:', e);
      }
    });
```

- [ ] **Step 3: Verify by inspection and full test run**

There's no dedicated test for cron registration (matches the existing convention — none of the other `nodeCron.schedule` calls in this file are tested directly, only the functions they call are). Re-read the diff to confirm the schedule expression is `'30 8 * * 1'` (08:30 every Monday) and that it calls `sendBusinessWeeklyDigest()` with no arguments.

Then run the full backend test suite to confirm nothing else broke:

Run: `node --test tests/`
Expected: PASS (all tests, including the new ones from Tasks 1-4).

- [ ] **Step 4: Commit**

```bash
git add src/services/cron.service.js
git commit -m "feat: schedule the business weekly digest email every Monday at 08:30"
```

---

## Task 6: Site pro — rename `/dashboard/account` to `/dashboard/settings`

**Files:**
- Create: `loocateme_website/loocateme_website/src/app/(dashboard)/dashboard/settings/page.tsx`
- Delete: `loocateme_website/loocateme_website/src/app/(dashboard)/dashboard/account/page.tsx` (and the now-empty `account/` directory)
- Modify: `loocateme_website/loocateme_website/src/components/dashboard/DashboardNav.tsx:22,24`
- Modify: `loocateme_website/loocateme_website/src/app/(dashboard)/layout.tsx:23`

**Interfaces:**
- Produces: page reachable at `/dashboard/settings` (title "Paramètres"), containing the account-deletion block moved unchanged from the old `/dashboard/account`. `/dashboard/account` no longer exists. This is the page Task 7 and Task 8 will extend.

All commands in this task run from `/home/ubuntu/loocateme_website/loocateme_website`.

- [ ] **Step 1: Create the new settings page**

Create `src/app/(dashboard)/dashboard/settings/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-client";
import { apiFetch, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/ui/BackButton";

export default function SettingsPage() {
  const { user, location, logout } = useAuth();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasActiveTier = !!location && location.businessTier !== "none";

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/api/business/billing/account", {
        method: "DELETE",
        body: { password },
      });
      logout();
      router.replace("/login");
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Suppression impossible, réessayez.");
      setSubmitting(false);
    }
  }

  return (
    <div>
      <BackButton href={hasActiveTier ? "/dashboard" : "/paywall"} label="Retour" />
      <h1 className="h1 mb-8 mt-6">Paramètres</h1>

      <div className="surface-card flex flex-col gap-1 p-6 mb-8">
        <p className="caption text-[var(--text-faint)]">Email du compte pro</p>
        <p className="body-text font-semibold">{user?.email}</p>
      </div>

      <div className="surface-card p-6" style={{ borderColor: "var(--accent)" }}>
        <p className="body-text font-semibold mb-1">Supprimer mon compte pro</p>
        <p className="caption text-[var(--text-muted)] mb-4">
          Cette action supprime définitivement ce compte pro et la fiche établissement associée (photos, stories,
          PDF, statistiques). Elle n&apos;affecte pas votre éventuel compte personnel LoocateMe (application
          mobile), qui est totalement indépendant. Si un abonnement est actif, il est résilié immédiatement et la
          part non consommée de la période déjà payée vous est remboursée au prorata.
        </p>

        {!confirming ? (
          <Button variant="outline" onClick={() => setConfirming(true)}>
            Supprimer mon compte pro
          </Button>
        ) : (
          <form onSubmit={handleDelete} className="flex max-w-sm flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="caption text-[var(--text-muted)]">Confirmez avec votre mot de passe</span>
              <input
                required
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-[48px] rounded-[15px] border border-[var(--border)] bg-[var(--surface)] px-4 outline-none focus:border-[var(--accent)]"
              />
            </label>
            {error && <p className="caption text-[var(--accent)]">{error}</p>}
            <div className="flex gap-3">
              <Button type="submit" disabled={submitting}>
                {submitting ? "Suppression…" : "Confirmer la suppression"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setConfirming(false);
                  setPassword("");
                  setError(null);
                }}
              >
                Annuler
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Delete the old account page and its directory**

```bash
rm -rf "src/app/(dashboard)/dashboard/account"
```

- [ ] **Step 3: Update the nav links**

In `src/components/dashboard/DashboardNav.tsx`, replace:

```tsx
  const navItems = hasActiveTier
    ? [
        { href: "/dashboard", label: "Fiche" },
        { href: "/dashboard/stats", label: "Statistiques" },
        { href: "/dashboard/billing", label: "Abonnement" },
        { href: "/dashboard/account", label: "Compte" },
      ]
    : [{ href: "/dashboard/account", label: "Compte" }];
```

with:

```tsx
  const navItems = hasActiveTier
    ? [
        { href: "/dashboard", label: "Fiche" },
        { href: "/dashboard/stats", label: "Statistiques" },
        { href: "/dashboard/billing", label: "Abonnement" },
        { href: "/dashboard/settings", label: "Paramètres" },
      ]
    : [{ href: "/dashboard/settings", label: "Paramètres" }];
```

- [ ] **Step 4: Update the paywall-bypass guard**

In `src/app/(dashboard)/layout.tsx`, replace:

```tsx
    // Le compte (et sa suppression) doit rester joignable même sans palier actif.
    if (!hasActiveTier && pathname !== "/paywall" && pathname !== "/dashboard/account") {
```

with:

```tsx
    // Les paramètres (et la suppression de compte) doivent rester joignables même
    // sans palier actif.
    if (!hasActiveTier && pathname !== "/paywall" && pathname !== "/dashboard/settings") {
```

- [ ] **Step 5: Manual verification**

Prerequisite: backend running locally on port 4000 (`npm run dev` in `loocateme_backend`, separate terminal), then in `loocateme_website/loocateme_website`:

```bash
npm run dev
```

In a browser, logged in as a pro account:
1. Visit `/dashboard/settings` — page loads, title reads "Paramètres", shows the account email and the "Supprimer mon compte pro" block.
2. The nav bar (desktop and mobile hamburger menu) shows "Paramètres" instead of "Compte", and it's highlighted as active on this page.
3. Visit `/dashboard/account` directly — Next.js renders its default not-found page (route no longer exists).
4. Click through to the delete-account confirmation form (do **not** submit it) — the password field and Confirmer/Annuler buttons render correctly, "Annuler" resets the form.

- [ ] **Step 6: Commit**

```bash
git add -A "src/app/(dashboard)/dashboard/settings" "src/app/(dashboard)/dashboard/account" src/components/dashboard/DashboardNav.tsx "src/app/(dashboard)/layout.tsx"
git commit -m "refactor: rename dashboard account page to settings"
```

---

## Task 7: Email digest toggle on the Paramètres page

**Files:**
- Modify: `loocateme_website/loocateme_website/src/lib/auth-client.tsx:37` (type)
- Modify: `loocateme_website/loocateme_website/src/app/(dashboard)/dashboard/settings/page.tsx` (from Task 6)

**Interfaces:**
- Consumes: `PUT /api/business/locations/:locationId/notification-preferences` from Task 3 (`body: { weeklyDigestEmail: boolean }`).
- Produces: a toggle card at the top of `/dashboard/settings` reflecting and updating `location.notificationPreferences.weeklyDigestEmail`.

- [ ] **Step 1: Add the field to the `BusinessLocation` type**

In `src/lib/auth-client.tsx`, replace:

```tsx
  sponsorship?: { active: boolean; until?: string };
  subscription?: {
```

with:

```tsx
  sponsorship?: { active: boolean; until?: string };
  notificationPreferences?: { weeklyDigestEmail?: boolean };
  subscription?: {
```

- [ ] **Step 2: Add the toggle card to the settings page**

In `src/app/(dashboard)/dashboard/settings/page.tsx`, replace:

```tsx
export default function SettingsPage() {
  const { user, location, logout } = useAuth();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasActiveTier = !!location && location.businessTier !== "none";
```

with:

```tsx
export default function SettingsPage() {
  const { user, location, logout, refresh } = useAuth();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [digestSaving, setDigestSaving] = useState(false);
  const [digestError, setDigestError] = useState<string | null>(null);

  const hasActiveTier = !!location && location.businessTier !== "none";
  const digestEnabled = location?.notificationPreferences?.weeklyDigestEmail !== false;

  async function toggleDigest(next: boolean) {
    if (!location) return;
    setDigestSaving(true);
    setDigestError(null);
    try {
      await apiFetch(`/api/business/locations/${location._id}/notification-preferences`, {
        method: "PUT",
        body: { weeklyDigestEmail: next },
      });
      await refresh();
    } catch {
      setDigestError("Impossible de mettre à jour cette préférence, réessayez.");
    } finally {
      setDigestSaving(false);
    }
  }
```

Then replace:

```tsx
      <div className="surface-card flex flex-col gap-1 p-6 mb-8">
        <p className="caption text-[var(--text-faint)]">Email du compte pro</p>
        <p className="body-text font-semibold">{user?.email}</p>
      </div>
```

with:

```tsx
      <div className="surface-card flex flex-col gap-1 p-6 mb-8">
        <p className="caption text-[var(--text-faint)]">Email du compte pro</p>
        <p className="body-text font-semibold">{user?.email}</p>
      </div>

      {location && (
        <div className="surface-card flex items-center justify-between gap-4 p-6 mb-8">
          <div>
            <p className="body-text font-semibold mb-1">Résumé hebdomadaire par email</p>
            <p className="caption text-[var(--text-muted)]">
              Chaque lundi, un récapitulatif de vos statistiques de fréquentation (vues, meilleur jour) directement
              dans votre boîte mail.
            </p>
            {digestError && <p className="caption text-[var(--accent)] mt-2">{digestError}</p>}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={digestEnabled}
            disabled={digestSaving}
            onClick={() => toggleDigest(!digestEnabled)}
            className={`relative h-7 w-12 shrink-0 rounded-[999px] transition-colors disabled:opacity-60 ${
              digestEnabled ? "bg-[var(--accent)]" : "bg-[var(--surface-strong)]"
            }`}
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${
                digestEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      )}
```

- [ ] **Step 3: Manual verification**

With both dev servers running (backend on :4000, frontend on :3000, per Task 6 Step 5):

1. Visit `/dashboard/settings` as a pro account — the "Résumé hebdomadaire par email" card renders above the email card, toggle shows "on" (accent color, thumb to the right) by default.
2. Click the toggle — it disables briefly (`disabled` while saving), then reflects the new "off" state (grey, thumb to the left) after the request completes.
3. Reload the page — the toggle stays "off" (persisted server-side).
4. Click it again to turn it back "on", confirm it persists across a reload too.
5. In the Network tab, confirm each click sends `PUT /api/business/locations/<id>/notification-preferences` with `{"weeklyDigestEmail": true|false}` and a 200 response.

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth-client.tsx "src/app/(dashboard)/dashboard/settings/page.tsx"
git commit -m "feat: add weekly digest email toggle to the Paramètres page"
```

---

## Task 8: Unsubscribe confirmation banner

**Files:**
- Modify: `loocateme_website/loocateme_website/src/app/(dashboard)/dashboard/settings/page.tsx` (from Tasks 6-7)

**Interfaces:**
- Consumes: the `?digest=unsubscribed|error` redirect from Task 4's `GET /api/business/digest/unsubscribe`.
- Produces: a banner shown at the top of `/dashboard/settings` when landing from that redirect. Requires wrapping the page in `<Suspense>` because it now reads `useSearchParams()` (same constraint Next.js already forced on `src/app/activate/page.tsx` in this codebase — mirror that pattern exactly).

- [ ] **Step 1: Split the page into a `Suspense`-wrapped inner component and add the banner**

Replace the full contents of `src/app/(dashboard)/dashboard/settings/page.tsx` with:

```tsx
"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-client";
import { apiFetch, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/ui/BackButton";

function DigestBanner({ status }: { status: string | null }) {
  if (status === "unsubscribed") {
    return (
      <div className="surface-card mb-6 p-4" style={{ borderColor: "var(--accent)" }}>
        <p className="caption text-[var(--text-muted)]">Vous ne recevrez plus le résumé hebdomadaire par email.</p>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="surface-card mb-6 p-4" style={{ borderColor: "var(--accent)" }}>
        <p className="caption text-[var(--accent)]">Le lien de désabonnement est invalide ou a expiré.</p>
      </div>
    );
  }
  return null;
}

function SettingsContent() {
  const { user, location, logout, refresh } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [digestSaving, setDigestSaving] = useState(false);
  const [digestError, setDigestError] = useState<string | null>(null);

  const hasActiveTier = !!location && location.businessTier !== "none";
  const digestEnabled = location?.notificationPreferences?.weeklyDigestEmail !== false;

  async function toggleDigest(next: boolean) {
    if (!location) return;
    setDigestSaving(true);
    setDigestError(null);
    try {
      await apiFetch(`/api/business/locations/${location._id}/notification-preferences`, {
        method: "PUT",
        body: { weeklyDigestEmail: next },
      });
      await refresh();
    } catch {
      setDigestError("Impossible de mettre à jour cette préférence, réessayez.");
    } finally {
      setDigestSaving(false);
    }
  }

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/api/business/billing/account", {
        method: "DELETE",
        body: { password },
      });
      logout();
      router.replace("/login");
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Suppression impossible, réessayez.");
      setSubmitting(false);
    }
  }

  return (
    <div>
      <BackButton href={hasActiveTier ? "/dashboard" : "/paywall"} label="Retour" />
      <h1 className="h1 mb-8 mt-6">Paramètres</h1>

      <DigestBanner status={searchParams.get("digest")} />

      <div className="surface-card flex flex-col gap-1 p-6 mb-8">
        <p className="caption text-[var(--text-faint)]">Email du compte pro</p>
        <p className="body-text font-semibold">{user?.email}</p>
      </div>

      {location && (
        <div className="surface-card flex items-center justify-between gap-4 p-6 mb-8">
          <div>
            <p className="body-text font-semibold mb-1">Résumé hebdomadaire par email</p>
            <p className="caption text-[var(--text-muted)]">
              Chaque lundi, un récapitulatif de vos statistiques de fréquentation (vues, meilleur jour) directement
              dans votre boîte mail.
            </p>
            {digestError && <p className="caption text-[var(--accent)] mt-2">{digestError}</p>}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={digestEnabled}
            disabled={digestSaving}
            onClick={() => toggleDigest(!digestEnabled)}
            className={`relative h-7 w-12 shrink-0 rounded-[999px] transition-colors disabled:opacity-60 ${
              digestEnabled ? "bg-[var(--accent)]" : "bg-[var(--surface-strong)]"
            }`}
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${
                digestEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      )}

      <div className="surface-card p-6" style={{ borderColor: "var(--accent)" }}>
        <p className="body-text font-semibold mb-1">Supprimer mon compte pro</p>
        <p className="caption text-[var(--text-muted)] mb-4">
          Cette action supprime définitivement ce compte pro et la fiche établissement associée (photos, stories,
          PDF, statistiques). Elle n&apos;affecte pas votre éventuel compte personnel LoocateMe (application
          mobile), qui est totalement indépendant. Si un abonnement est actif, il est résilié immédiatement et la
          part non consommée de la période déjà payée vous est remboursée au prorata.
        </p>

        {!confirming ? (
          <Button variant="outline" onClick={() => setConfirming(true)}>
            Supprimer mon compte pro
          </Button>
        ) : (
          <form onSubmit={handleDelete} className="flex max-w-sm flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="caption text-[var(--text-muted)]">Confirmez avec votre mot de passe</span>
              <input
                required
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-[48px] rounded-[15px] border border-[var(--border)] bg-[var(--surface)] px-4 outline-none focus:border-[var(--accent)]"
              />
            </label>
            {error && <p className="caption text-[var(--accent)]">{error}</p>}
            <div className="flex gap-3">
              <Button type="submit" disabled={submitting}>
                {submitting ? "Suppression…" : "Confirmer la suppression"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setConfirming(false);
                  setPassword("");
                  setError(null);
                }}
              >
                Annuler
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsContent />
    </Suspense>
  );
}
```

- [ ] **Step 2: Manual verification**

With both dev servers running:

1. Visit `/dashboard/settings?digest=unsubscribed` directly — a banner reading "Vous ne recevrez plus le résumé hebdomadaire par email." appears above the account-email card.
2. Visit `/dashboard/settings?digest=error` — a banner reading "Le lien de désabonnement est invalide ou a expiré." appears instead, styled in the accent/error color.
3. Visit `/dashboard/settings` with no query param — no banner renders.
4. Re-run the toggle check from Task 7 Step 3 to confirm the refactor didn't break it.
5. `npm run build` in `loocateme_website/loocateme_website` completes without errors (confirms the `Suspense` boundary satisfies Next's `useSearchParams` requirement).

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/dashboard/settings/page.tsx"
git commit -m "feat: show a confirmation banner after unsubscribing from the weekly digest"
```

---

## Post-plan validation

After Task 8, run the full backend suite once more from `loocateme_backend`:

```bash
node --test tests/
```

Expected: PASS (all pre-existing tests plus all tests added in Tasks 1-4).
