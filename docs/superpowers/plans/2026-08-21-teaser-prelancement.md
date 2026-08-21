# Teaser de pré-lancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer les CTA App Store/Google Play du site public LoocateMe par une inscription à liste d'attente (avec compte à rebours et compteur d'inscrits honnête), et ajouter les liens Instagram/TikTok — en préparation du lancement du 5 septembre 2026.

**Architecture:** Ce chantier touche **deux dépôts séparés** :
- `loocateme_backend` (Express + Mongoose + Nodemailer) : nouveau modèle `WaitlistSignup`, un contrôleur, deux routes publiques (`POST /api/waitlist`, `GET /api/waitlist/count`), suivant exactement le pattern existant de `support.routes.js`/`support.controller.js`.
- `loocateme_public_website` (Next.js 16 App Router + Tailwind 4) : nouveaux composants (`WaitlistForm`, `Countdown`, `WaitlistCount`, `SocialLinks`) et refonte de `Hero.tsx`/`FinalCta.tsx` autour de ces composants ; ajout des liens sociaux au `Header`/`Footer` ; correction d'une phrase de `HowItWorks.tsx` qui prétend l'app déjà disponible.

Les tâches 1 à 3 s'exécutent dans un checkout/worktree de `loocateme_backend`. Les tâches 4 à 13 s'exécutent dans un checkout/worktree de `loocateme_public_website` (dépôt séparé — isoler indépendamment si le workflow d'exécution l'exige).

**Tech Stack:** Express 4, Mongoose 8, express-validator, express-rate-limit, Nodemailer (backend) · Next.js 16, React 19, Tailwind 4, TypeScript, `node:test`/`node:assert` pour les tests backend (pas de suite de tests automatisés côté frontend — vérification manuelle via `npm run dev`).

**Spec:** `docs/superpowers/specs/2026-08-21-teaser-prelancement-design.md` (dans `loocateme_backend`)

## Global Constraints

- Date de lancement : **samedi 5 septembre 2026**, minuit heure de Paris (`2026-09-05T00:00:00+02:00`).
- Seuil d'affichage du compteur d'inscrits réel : **50**. En dessous, message qualitatif uniquement — jamais de chiffre inventé.
- Réseaux sociaux : Instagram `https://instagram.com/loocateme`, TikTok `https://tiktok.com/@loocateme`.
- Aucun vrai lien App Store/Google Play tant que l'app n'est pas publiée (hors scope de ce chantier).
- Les nouvelles routes backend sont publiques (pas d'auth), suivent le pattern `support.routes.js` (validate → rate limit → controller).
- Le frontend appelle le backend via `apiFetch` (`src/lib/api.ts`), jamais de fetch direct côté client.

---

## Task 1: Modèle `WaitlistSignup` (backend)

**Repo:** `loocateme_backend`

**Files:**
- Create: `src/models/WaitlistSignup.js`
- Test: `tests/waitlist.model.test.js`

**Interfaces:**
- Produces: `WaitlistSignup` (modèle Mongoose), champs `email` (String, requis, unique, lowercase, trim), `createdAt`/`updatedAt` (via `timestamps: true`). Consommé par Task 2 (`waitlist.controller.js`).

- [ ] **Step 1: Écrire le test qui échoue**

Créer `tests/waitlist.model.test.js` :

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { WaitlistSignup } from '../src/models/WaitlistSignup.js';

test('WaitlistSignup requires an email', () => {
  const doc = new WaitlistSignup({});
  const err = doc.validateSync();
  assert.ok(err);
  assert.ok(err.errors.email);
});

test('WaitlistSignup accepts and lowercases a valid email', () => {
  const doc = new WaitlistSignup({ email: 'Test@Example.com' });
  const err = doc.validateSync();
  assert.equal(err, undefined);
  assert.equal(doc.email, 'test@example.com');
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `node --test tests/waitlist.model.test.js`
Expected: FAIL — `Cannot find module '../src/models/WaitlistSignup.js'`

- [ ] **Step 3: Créer le modèle**

Créer `src/models/WaitlistSignup.js` :

```js
import mongoose from 'mongoose';

const WaitlistSignupSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
  },
  { timestamps: true }
);

export const WaitlistSignup = mongoose.model('WaitlistSignup', WaitlistSignupSchema);
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `node --test tests/waitlist.model.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/models/WaitlistSignup.js tests/waitlist.model.test.js
git commit -m "feat(waitlist): ajoute le modèle WaitlistSignup"
```

---

## Task 2: Contrôleur `WaitlistController` (backend)

**Repo:** `loocateme_backend`

**Files:**
- Create: `src/controllers/waitlist.controller.js`
- Test: `tests/waitlist.controller.test.js`

**Interfaces:**
- Consumes: `WaitlistSignup` (Task 1) ; `sendMail`, `mailer` depuis `src/services/email.service.js` (existant, non modifié).
- Produces: `WaitlistController.subscribe(req, res, next)` → `201 { ok: true, alreadySubscribed: false, count }` (nouvelle inscription) ou `200 { ok: true, alreadySubscribed: true }` (email déjà inscrit) ; `WaitlistController.getCount(req, res, next)` → `200 { count }`. Consommé par Task 3 (`waitlist.routes.js`).

- [ ] **Step 1: Écrire le test qui échoue**

Créer `tests/waitlist.controller.test.js` :

```js
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SMTP_PASS = process.env.SMTP_PASS || 'test-pass';

import { WaitlistSignup } from '../src/models/WaitlistSignup.js';
import { mailer } from '../src/services/email.service.js';
import { WaitlistController } from '../src/controllers/waitlist.controller.js';

function makeReqRes(body) {
  const req = { body };
  const res = {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  return { req, res };
}

// subscribe() envoie l'email de bienvenue en fire-and-forget (ne bloque pas
// la réponse HTTP dessus) — laisser la microtask queue se vider avant
// d'observer les effets de bord, même pattern que auth.middleware.test.js.
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function stubWaitlistModel({ existing = null, count = 1 } = {}) {
  const originalFindOne = WaitlistSignup.findOne;
  const originalCreate = WaitlistSignup.create;
  const originalCount = WaitlistSignup.countDocuments;
  const calls = { findOne: [], create: [], countDocuments: 0 };
  WaitlistSignup.findOne = (filter) => { calls.findOne.push(filter); return Promise.resolve(existing); };
  WaitlistSignup.create = (doc) => { calls.create.push(doc); return Promise.resolve({ ...doc, _id: 'fake-id' }); };
  WaitlistSignup.countDocuments = () => { calls.countDocuments += 1; return Promise.resolve(count); };
  return {
    calls,
    restore: () => {
      WaitlistSignup.findOne = originalFindOne;
      WaitlistSignup.create = originalCreate;
      WaitlistSignup.countDocuments = originalCount;
    },
  };
}

function stubMailer() {
  const original = mailer.sendMail;
  const calls = [];
  mailer.sendMail = (msg) => { calls.push(msg); return Promise.resolve({ accepted: [msg.to] }); };
  return { calls, restore: () => { mailer.sendMail = original; } };
}

test('subscribe creates a new signup, sends a welcome email, and returns the count', async () => {
  const model = stubWaitlistModel({ existing: null, count: 3 });
  const mail = stubMailer();
  try {
    const { req, res } = makeReqRes({ email: 'new@example.com' });
    await WaitlistController.subscribe(req, res, (err) => { throw err; });
    await flush();

    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.body, { ok: true, alreadySubscribed: false, count: 3 });
    assert.equal(model.calls.create.length, 1);
    assert.equal(model.calls.create[0].email, 'new@example.com');
    assert.equal(mail.calls.length, 1);
    assert.equal(mail.calls[0].to, 'new@example.com');
  } finally {
    model.restore();
    mail.restore();
  }
});

test('subscribe returns alreadySubscribed without creating a duplicate or sending an email', async () => {
  const model = stubWaitlistModel({ existing: { email: 'existing@example.com' } });
  const mail = stubMailer();
  try {
    const { req, res } = makeReqRes({ email: 'existing@example.com' });
    await WaitlistController.subscribe(req, res, (err) => { throw err; });
    await flush();

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, alreadySubscribed: true });
    assert.equal(model.calls.create.length, 0);
    assert.equal(mail.calls.length, 0);
  } finally {
    model.restore();
    mail.restore();
  }
});

test('getCount returns the total number of signups', async () => {
  const model = stubWaitlistModel({ count: 42 });
  try {
    const { req, res } = makeReqRes({});
    await WaitlistController.getCount(req, res, (err) => { throw err; });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { count: 42 });
  } finally {
    model.restore();
  }
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `node --test tests/waitlist.controller.test.js`
Expected: FAIL — `Cannot find module '../src/controllers/waitlist.controller.js'`

- [ ] **Step 3: Créer le contrôleur**

Créer `src/controllers/waitlist.controller.js` :

```js
import { WaitlistSignup } from '../models/WaitlistSignup.js';
import { sendMail } from '../services/email.service.js';

const LAUNCH_DATE_LABEL = '5 septembre 2026';

export const WaitlistController = {
  async subscribe(req, res, next) {
    try {
      const { email } = req.body;
      const existing = await WaitlistSignup.findOne({ email });
      if (existing) {
        return res.status(200).json({ ok: true, alreadySubscribed: true });
      }

      await WaitlistSignup.create({ email });
      const count = await WaitlistSignup.countDocuments();

      // Fire-and-forget : un échec SMTP ne doit pas faire échouer l'inscription,
      // déjà actée en base à ce stade.
      sendMail({
        to: email,
        subject: "Bienvenue sur la liste d'attente LoocateMe",
        text: `Merci de ton inscription ! LoocateMe arrive le ${LAUNCH_DATE_LABEL}, on te préviendra dès que c'est disponible.`,
        html: `<p>Merci de ton inscription !</p><p>LoocateMe arrive le <strong>${LAUNCH_DATE_LABEL}</strong>, on te préviendra dès que c'est disponible.</p>`,
      }).catch((err) => {
        console.error('[waitlist] Échec envoi email de bienvenue:', err?.message || err);
      });

      res.status(201).json({ ok: true, alreadySubscribed: false, count });
    } catch (err) {
      next(err);
    }
  },

  async getCount(req, res, next) {
    try {
      const count = await WaitlistSignup.countDocuments();
      res.status(200).json({ count });
    } catch (err) {
      next(err);
    }
  },
};
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `node --test tests/waitlist.controller.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/controllers/waitlist.controller.js tests/waitlist.controller.test.js
git commit -m "feat(waitlist): ajoute le contrôleur d'inscription et de comptage"
```

---

## Task 3: Routes, validation, rate limiting et montage (backend)

**Repo:** `loocateme_backend`

**Files:**
- Create: `src/routes/waitlist.routes.js`
- Modify: `src/middlewares/validators.js` (ajoute `validators.waitlistSignup`)
- Modify: `src/middlewares/rateLimit.js` (ajoute `waitlistSignupLimiter`, `waitlistCountLimiter`)
- Modify: `src/server.js` (import + montage de `waitlistRoutes`)

**Interfaces:**
- Consumes: `WaitlistController` (Task 2), `validate` (déjà exporté par `validators.js`).
- Produces: `POST /api/waitlist` et `GET /api/waitlist/count` montés et accessibles en HTTP. Consommé par le frontend (Task 6, `WaitlistForm.tsx` ; Task 8, `WaitlistCount.tsx`).

- [ ] **Step 1: Ajouter le validateur**

Dans `src/middlewares/validators.js`, ajouter une entrée `waitlistSignup` dans l'objet `validators` (juste avant la fermeture `};` de l'objet, à côté de `supportContact`) :

```js
  waitlistSignup: [
    body('email').isEmail().normalizeEmail({
      gmail_remove_dots: false,
      gmail_remove_subaddress: false,
      outlookdotcom_remove_subaddress: false,
      yahoo_remove_subaddress: false,
      icloud_remove_subaddress: false,
    }),
  ],
```

- [ ] **Step 2: Ajouter les rate limiters**

À la fin de `src/middlewares/rateLimit.js`, ajouter :

```js

// Inscription à la liste d'attente pré-lancement : geste léger (un seul
// champ), fenêtre plus généreuse que le formulaire de contact.
export const waitlistSignupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { code: 'RATE_LIMITED', message: 'Trop de tentatives, réessayez plus tard.' },
});

// Lecture publique du compteur d'inscrits (affiché sur le site) : rate limit
// large, juste anti-abus, pas anti-usage normal.
export const waitlistCountLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { code: 'RATE_LIMITED', message: 'Trop de requêtes, réessayez plus tard.' },
});
```

- [ ] **Step 3: Créer le fichier de routes**

Créer `src/routes/waitlist.routes.js` :

```js
import { Router } from 'express';
import { validate, validators } from '../middlewares/validators.js';
import { waitlistSignupLimiter, waitlistCountLimiter } from '../middlewares/rateLimit.js';
import { WaitlistController } from '../controllers/waitlist.controller.js';

const router = Router();

// Public : liste d'attente pré-lancement du site loocate.me (aucun compte requis)
router.post('/', waitlistSignupLimiter, validate(validators.waitlistSignup), WaitlistController.subscribe);
router.get('/count', waitlistCountLimiter, WaitlistController.getCount);

export default router;
```

- [ ] **Step 4: Monter les routes dans `server.js`**

Dans `src/server.js`, ajouter l'import à côté de celui de `supportRoutes` :

```js
import supportRoutes from './routes/support.routes.js';
import waitlistRoutes from './routes/waitlist.routes.js';
```

Et le montage à côté de celui de `/api/support` :

```js
app.use('/api/support', supportRoutes);
app.use('/api/waitlist', waitlistRoutes);
```

- [ ] **Step 5: Vérifier manuellement le câblage**

Lancer le serveur en local (`npm run dev` ou équivalent existant), puis :

```bash
curl -s -X POST http://localhost:4000/api/waitlist -H 'Content-Type: application/json' -d '{"email":"qa@example.com"}'
curl -s -X POST http://localhost:4000/api/waitlist -H 'Content-Type: application/json' -d '{"email":"qa@example.com"}'
curl -s http://localhost:4000/api/waitlist/count
```

Expected : 1er appel → `{"ok":true,"alreadySubscribed":false,"count":1}` ; 2e appel (doublon) → `{"ok":true,"alreadySubscribed":true}` ; 3e appel → `{"count":1}`.

- [ ] **Step 6: Lancer toute la suite de tests backend**

Run: `npm test`
Expected: PASS (aucune régression sur les tests existants)

- [ ] **Step 7: Commit**

```bash
git add src/routes/waitlist.routes.js src/middlewares/validators.js src/middlewares/rateLimit.js src/server.js
git commit -m "feat(waitlist): expose POST /api/waitlist et GET /api/waitlist/count"
```

---

## Task 4: Constantes partagées (frontend)

**Repo:** `loocateme_public_website`

**Files:**
- Modify: `src/lib/site.ts`

**Interfaces:**
- Produces: `LAUNCH_DATE_ISO: string`, `WAITLIST_COUNT_THRESHOLD: number`, `INSTAGRAM_URL: string`, `TIKTOK_URL: string`. Consommé par `Countdown.tsx` (Task 7), `WaitlistCount.tsx` (Task 8), `SocialLinks.tsx` (Task 5).

- [ ] **Step 1: Ajouter les constantes**

À la fin de `src/lib/site.ts`, ajouter :

```ts
// Lancement visé : samedi 5 septembre 2026, minuit heure de Paris. Offset
// explicite (+02:00, heure d'été) pour un calcul de countdown identique
// côté serveur et côté client, indépendamment du fuseau d'exécution.
export const LAUNCH_DATE_ISO = "2026-09-05T00:00:00+02:00";

// En dessous de ce nombre d'inscrits, on affiche un message qualitatif
// plutôt que le chiffre réel (voir docs/superpowers/specs/2026-08-21-teaser-prelancement-design.md).
export const WAITLIST_COUNT_THRESHOLD = 50;

export const INSTAGRAM_URL = "https://instagram.com/loocateme";
export const TIKTOK_URL = "https://tiktok.com/@loocateme";
```

- [ ] **Step 2: Vérifier que le projet compile toujours**

Run: `npx tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 3: Commit**

```bash
git add src/lib/site.ts
git commit -m "feat(teaser): ajoute les constantes de lancement, seuil et réseaux sociaux"
```

---

## Task 5: Composant `SocialLinks` (frontend)

**Repo:** `loocateme_public_website`

**Files:**
- Create: `src/components/layout/SocialLinks.tsx`

**Interfaces:**
- Consumes: `INSTAGRAM_URL`, `TIKTOK_URL` (Task 4).
- Produces: `SocialLinks({ className?: string })` — composant exporté. Consommé par `Header.tsx` et `Footer.tsx` (Task 9) et `Hero.tsx` (Task 6).

- [ ] **Step 1: Créer le composant**

Créer `src/components/layout/SocialLinks.tsx` :

```tsx
import { INSTAGRAM_URL, TIKTOK_URL } from "@/lib/site";

function InstagramIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M16.5 2h-3v13.2a2.8 2.8 0 1 1-2-2.68V9.4a5.8 5.8 0 1 0 5 5.75V9.1a7.3 7.3 0 0 0 4.5 1.55v-3a4.3 4.3 0 0 1-4.5-4.15V2Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function SocialLinks({ className }: { className?: string }) {
  return (
    <div className={className ?? "flex items-center gap-3"}>
      <a
        href={INSTAGRAM_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="LoocateMe sur Instagram"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text)]"
      >
        <InstagramIcon />
      </a>
      <a
        href={TIKTOK_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="LoocateMe sur TikTok"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text)]"
      >
        <TikTokIcon />
      </a>
    </div>
  );
}
```

- [ ] **Step 2: Vérifier manuellement**

Run: `npm run dev`, importer temporairement `<SocialLinks />` n'est pas nécessaire — le composant sera exercé visuellement dans Task 9 (Header/Footer) et Task 6 (Hero). Vérifier seulement la compilation :

Run: `npx tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/SocialLinks.tsx
git commit -m "feat(teaser): ajoute le composant SocialLinks (Instagram/TikTok)"
```

---

## Task 6: Composant `WaitlistForm` (frontend)

**Repo:** `loocateme_public_website`

**Files:**
- Create: `src/components/landing/WaitlistForm.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `ApiError` (`src/lib/api.ts`, existant), `Button` (`src/components/ui/button.tsx`, existant). Endpoint `POST /api/waitlist` (Task 3) → `{ ok: boolean; alreadySubscribed?: boolean; count?: number }`.
- Produces: `WaitlistForm()` — composant exporté, client component. Consommé par `Hero.tsx` et `FinalCta.tsx` (Task 9).

- [ ] **Step 1: Créer le composant**

Créer `src/components/landing/WaitlistForm.tsx` (calqué sur `src/components/contact/ContactForm.tsx`) :

```tsx
"use client";

import { useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";

type WaitlistResponse = { ok: boolean; alreadySubscribed?: boolean; count?: number };

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<"new" | "existing" | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const data = await apiFetch<WaitlistResponse>("/api/waitlist", {
        method: "POST",
        body: { email },
      });
      setResult(data.alreadySubscribed ? "existing" : "new");
      setEmail("");
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else setError("Une erreur est survenue, merci de réessayer.");
    } finally {
      setSubmitting(false);
    }
  }

  if (result === "new") {
    return (
      <p className="body-text text-center">
        🎉 Inscription confirmée ! On te prévient dès qu&apos;on ouvre, le 5 septembre.
      </p>
    );
  }

  if (result === "existing") {
    return <p className="body-text text-center">Tu es déjà inscrit·e, à très vite !</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3 sm:flex-row sm:items-start">
      <div className="flex-1">
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ton@email.com"
          aria-label="Adresse email"
          className="h-[55px] w-full rounded-[15px] border border-[var(--border)] bg-[var(--surface)] px-4 outline-none focus:border-[var(--accent)]"
        />
        {error && <p className="caption mt-2 text-[var(--accent)]">{error}</p>}
      </div>
      <Button type="submit" disabled={submitting}>
        {submitting ? "Inscription…" : "Rejoindre la liste d'attente"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 3: Commit**

```bash
git add src/components/landing/WaitlistForm.tsx
git commit -m "feat(teaser): ajoute le formulaire d'inscription à la liste d'attente"
```

---

## Task 7: Composant `Countdown` (frontend)

**Repo:** `loocateme_public_website`

**Files:**
- Create: `src/components/landing/Countdown.tsx`

**Interfaces:**
- Consumes: `LAUNCH_DATE_ISO` (Task 4).
- Produces: `Countdown()` — composant exporté, client component. Consommé par `Hero.tsx` et `FinalCta.tsx` (Tasks 9-10).

- [ ] **Step 1: Créer le composant**

Créer `src/components/landing/Countdown.tsx` :

```tsx
"use client";

import { useEffect, useState } from "react";
import { LAUNCH_DATE_ISO } from "@/lib/site";

type Remaining = { days: number; hours: number; minutes: number } | null;

function computeRemaining(): Remaining {
  const diff = new Date(LAUNCH_DATE_ISO).getTime() - Date.now();
  if (diff <= 0) return null;
  const minutesTotal = Math.floor(diff / (60 * 1000));
  return {
    days: Math.floor(minutesTotal / (60 * 24)),
    hours: Math.floor((minutesTotal / 60) % 24),
    minutes: minutesTotal % 60,
  };
}

export function Countdown() {
  // On ne calcule le temps restant qu'après le montage côté client : un
  // calcul basé sur Date.now() au rendu serveur produirait un texte
  // différent de l'hydratation client (mismatch React) si une minute
  // s'écoule entre les deux.
  const [mounted, setMounted] = useState(false);
  const [remaining, setRemaining] = useState<Remaining>(null);

  useEffect(() => {
    setMounted(true);
    setRemaining(computeRemaining());
    const id = setInterval(() => setRemaining(computeRemaining()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  if (!mounted) {
    return <div className="h-[76px]" aria-hidden />;
  }

  if (!remaining) {
    return <p className="h3 gradient-text">C&apos;est lancé !</p>;
  }

  const blocks = [
    { label: "jours", value: remaining.days },
    { label: "heures", value: remaining.hours },
    { label: "min", value: remaining.minutes },
  ];

  return (
    <div className="flex items-center gap-3" role="timer" aria-label="Temps restant avant le lancement">
      {blocks.map((block) => (
        <div key={block.label} className="surface-card flex flex-col items-center gap-1 px-4 py-3">
          <span className="h2 gradient-text">{String(block.value).padStart(2, "0")}</span>
          <span className="caption text-[var(--text-faint)]">{block.label}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Vérifier manuellement le comportement avant/après échéance**

Run: `npm run dev`, ouvrir la page d'accueil (le composant sera visible une fois câblé dans Task 9). Pour vérifier le cas "après échéance" sans attendre le 5 septembre, modifier temporairement `LAUNCH_DATE_ISO` en local avec une date passée, recharger, vérifier l'affichage "C'est lancé !", puis remettre la vraie date (`git checkout -- src/lib/site.ts` si modifié localement pour le test).

- [ ] **Step 3: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 4: Commit**

```bash
git add src/components/landing/Countdown.tsx
git commit -m "feat(teaser): ajoute le compte à rebours vers le lancement"
```

---

## Task 8: Composant `WaitlistCount` (frontend)

**Repo:** `loocateme_public_website`

**Files:**
- Create: `src/components/landing/WaitlistCount.tsx`

**Interfaces:**
- Consumes: `API_URL` (`src/lib/api.ts`, existant), `WAITLIST_COUNT_THRESHOLD` (Task 4). Endpoint `GET /api/waitlist/count` (Task 3) → `{ count: number }`.
- Produces: `WaitlistCount()` — composant exporté, Server Component (async). Consommé par `Hero.tsx` et `FinalCta.tsx` (Tasks 9-10).

- [ ] **Step 1: Créer le composant**

Créer `src/components/landing/WaitlistCount.tsx` :

```tsx
import { API_URL } from "@/lib/api";
import { WAITLIST_COUNT_THRESHOLD } from "@/lib/site";

async function fetchCount(): Promise<number> {
  try {
    const res = await fetch(`${API_URL}/api/waitlist/count`, { next: { revalidate: 60 } });
    if (!res.ok) return 0;
    const data = await res.json();
    return typeof data.count === "number" ? data.count : 0;
  } catch {
    // Le Hero ne doit jamais planter si le backend est injoignable : on
    // retombe silencieusement sur le message qualitatif (count = 0).
    return 0;
  }
}

export async function WaitlistCount() {
  const count = await fetchCount();
  const label =
    count < WAITLIST_COUNT_THRESHOLD
      ? "Rejoins les premiers inscrits"
      : `${count.toLocaleString("fr-FR")} personnes déjà inscrites`;

  return <p className="caption text-[var(--text-faint)]">{label}</p>;
}
```

- [ ] **Step 2: Vérifier manuellement les deux états**

Avec le backend de Task 3 lancé en local et vide : recharger la page (une fois câblé, Task 9) → doit afficher "Rejoins les premiers inscrits". Insérer manuellement 50+ documents dans la collection `waitlistsignups` (ou boucler `curl -X POST .../api/waitlist` avec des emails différents) → doit afficher "X personnes déjà inscrites".

- [ ] **Step 3: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 4: Commit**

```bash
git add src/components/landing/WaitlistCount.tsx
git commit -m "feat(teaser): ajoute l'affichage honnête du compteur d'inscrits"
```

---

## Task 9: Refonte de `Hero.tsx` et `FinalCta.tsx` (frontend)

**Repo:** `loocateme_public_website`

**Files:**
- Modify: `src/components/landing/Hero.tsx`
- Modify: `src/components/landing/FinalCta.tsx`

**Interfaces:**
- Consumes: `Countdown` (Task 7), `WaitlistForm` (Task 6), `WaitlistCount` (Task 8), `SocialLinks` (Task 5).

- [ ] **Step 1: Réécrire `Hero.tsx`**

Remplacer le contenu de `src/components/landing/Hero.tsx` par :

```tsx
import { Countdown } from "./Countdown";
import { WaitlistForm } from "./WaitlistForm";
import { WaitlistCount } from "./WaitlistCount";
import { SocialLinks } from "@/components/layout/SocialLinks";

export function Hero() {
  return (
    <section className="relative overflow-hidden px-6 pb-20 pt-16 sm:pt-24">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 h-[420px] opacity-40 blur-3xl"
        style={{ background: "var(--gradient-signature)" }}
      />
      <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center gap-6 text-center">
        <span className="section-eyebrow surface-card px-4 py-1.5">Bientôt disponible</span>
        <h1 className="h1 max-w-3xl">
          Découvre <span className="gradient-text">qui sort</span> près de toi, en temps réel
        </h1>
        <p className="body-text max-w-2xl text-[18px]">
          Cafés, parcs, bars ou clubs : LoocateMe te montre les lieux qui vivent maintenant et qui les fréquente.
          Check-in automatique et profils sociaux, jour comme nuit.
        </p>
        <Countdown />
        <div className="mt-2 w-full max-w-md">
          <WaitlistForm />
        </div>
        <WaitlistCount />
        <SocialLinks />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Réécrire `FinalCta.tsx`**

Remplacer le contenu de `src/components/landing/FinalCta.tsx` par :

```tsx
import { Countdown } from "./Countdown";
import { WaitlistForm } from "./WaitlistForm";
import { WaitlistCount } from "./WaitlistCount";

export function FinalCta() {
  return (
    <section id="telecharger" className="px-6 py-20">
      <div
        className="mx-auto flex w-full max-w-4xl flex-col items-center gap-6 rounded-[var(--radius-xl)] p-10 text-center sm:p-16"
        style={{ background: "var(--gradient-signature-soft)", border: "1px solid var(--border)" }}
      >
        <h2 className="h2">Prêt à découvrir ce qui vit près de toi ?</h2>
        <p className="body-text max-w-xl">
          Rejoins la liste d&apos;attente pour être notifié·e dès l&apos;ouverture, le 5 septembre 2026.
        </p>
        <Countdown />
        <div className="mt-2 w-full max-w-md">
          <WaitlistForm />
        </div>
        <WaitlistCount />
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Vérifier manuellement dans le navigateur**

Run: `npm run dev`, ouvrir `http://localhost:3000`. Vérifier : badge "Bientôt disponible" visible, countdown affiché et qui tourne, formulaire d'inscription fonctionnel (succès, doublon, erreur si backend éteint), compteur d'inscrits cohérent avec le backend, icônes sociales cliquables vers Instagram/TikTok. Refaire la vérification en basculant le thème (bouton Sun/Moon du Header) pour valider les deux palettes.

- [ ] **Step 4: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 5: Commit**

```bash
git add src/components/landing/Hero.tsx src/components/landing/FinalCta.tsx
git commit -m "feat(teaser): remplace les CTA App Store/Google Play par la liste d'attente"
```

---

## Task 10: Liens sociaux dans `Header.tsx` et `Footer.tsx` (frontend)

**Repo:** `loocateme_public_website`

**Files:**
- Modify: `src/components/layout/Header.tsx`
- Modify: `src/components/layout/Footer.tsx`

**Interfaces:**
- Consumes: `SocialLinks` (Task 5).

- [ ] **Step 1: Modifier `Header.tsx`**

Dans `src/components/layout/Header.tsx`, ajouter l'import :

```tsx
import { SocialLinks } from "@/components/layout/SocialLinks";
```

Puis remplacer :

```tsx
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Button asChild variant="outline" size="pill">
            <a href={PRO_URL} target="_blank" rel="noopener noreferrer">
              Pro
            </a>
          </Button>
        </div>
```

par :

```tsx
        <div className="flex items-center gap-3">
          <SocialLinks className="hidden items-center gap-2 sm:flex" />
          <ThemeToggle />
          <Button asChild variant="outline" size="pill">
            <a href={PRO_URL} target="_blank" rel="noopener noreferrer">
              Pro
            </a>
          </Button>
        </div>
```

- [ ] **Step 2: Modifier `Footer.tsx`**

Dans `src/components/layout/Footer.tsx`, ajouter l'import :

```tsx
import { SocialLinks } from "@/components/layout/SocialLinks";
```

Puis remplacer :

```tsx
        <span className="caption text-[var(--text-faint)]">© {new Date().getFullYear()} LoocateMe</span>
```

par :

```tsx
        <div className="flex items-center gap-4">
          <SocialLinks />
          <span className="caption text-[var(--text-faint)]">© {new Date().getFullYear()} LoocateMe</span>
        </div>
```

- [ ] **Step 3: Vérifier manuellement dans le navigateur**

Run: `npm run dev`. Vérifier que les icônes Instagram/TikTok apparaissent dans le Header (à partir de la largeur `sm`) et dans le Footer, sur toutes les pages (Header/Footer sont dans `layout.tsx`, donc visibles partout y compris `/contact`, `/cgu`, etc.). Vérifier le responsive mobile (icônes masquées dans le Header en dessous de `sm`, toujours visibles dans le Footer).

- [ ] **Step 4: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/Header.tsx src/components/layout/Footer.tsx
git commit -m "feat(teaser): ajoute les liens Instagram/TikTok au Header et au Footer"
```

---

## Task 11: Correction de copy dans `HowItWorks.tsx` (frontend)

**Repo:** `loocateme_public_website`

**Files:**
- Modify: `src/components/landing/HowItWorks.tsx`

Le premier des trois pas ("Télécharge l'app" / "Disponible gratuitement sur l'App Store et Google Play") contredit directement l'objectif du teaser : l'app n'est pas encore disponible. C'est le seul endroit en dehors du Hero/FinalCta qui affirme le contraire — à corriger.

**Note de portée :** le spec mentionnait un « polish léger » sur `FeatureGrid.tsx`, `VibeShowcase.tsx` et `FaqSection.tsx`. En relisant ces trois fichiers pendant la planification, aucun problème concret n'y a été identifié (ni incohérence de copy, ni référence obsolète à l'app store) — contrairement à `HowItWorks.tsx`. Ce plan ne les modifie donc pas, pour éviter des retouches cosmétiques sans justification (YAGNI). S'il apparaît un besoin de polish précis sur ces sections pendant la QA (Task 12), le traiter comme un ajustement ponctuel à cette étape plutôt que d'inventer des changements a priori.

- [ ] **Step 1: Corriger le premier pas**

Dans `src/components/landing/HowItWorks.tsx`, remplacer :

```ts
  {
    number: "01",
    title: "Télécharge l'app",
    description: "Disponible gratuitement sur l'App Store et Google Play.",
  },
```

par :

```ts
  {
    number: "01",
    title: "Rejoins la liste d'attente",
    description: "Inscris ton email pour être notifié·e dès l'ouverture, le 5 septembre 2026.",
  },
```

- [ ] **Step 2: Vérifier manuellement**

Run: `npm run dev`, ouvrir la page d'accueil, vérifier la section "Comment ça marche" (`#comment-ca-marche`) : le premier pas doit refléter la liste d'attente, pas un téléchargement immédiat.

- [ ] **Step 3: Commit**

```bash
git add src/components/landing/HowItWorks.tsx
git commit -m "fix(teaser): corrige la copy \"Comment ça marche\" pour la phase pré-lancement"
```

---

## Task 12: Vérification finale (lint, build, QA manuelle bout-en-bout)

**Repo:** les deux — `loocateme_backend` puis `loocateme_public_website`

**Files:** aucun changement de code, tâche de vérification uniquement.

- [ ] **Step 1: Lint + tests backend**

Dans `loocateme_backend` :

Run: `npm run lint` (si un script lint existe — sinon passer à l'étape suivante) puis `npm test`
Expected: aucune erreur, tous les tests passent (y compris `waitlist.model.test.js` et `waitlist.controller.test.js` de Tasks 1-2).

- [ ] **Step 2: Lint + build frontend**

Dans `loocateme_public_website` :

Run: `npm run lint`
Expected: aucune erreur

Run: `npm run build`
Expected: build réussi (le build Next.js échouera si `WaitlistCount.tsx`, un Server Component async, a un problème de fetch au moment du build — vérifier que `API_URL` pointe vers un backend accessible ou que le fallback `count = 0` s'applique proprement en cas d'échec réseau pendant le build).

- [ ] **Step 3: QA manuelle bout-en-bout**

Avec le backend (`loocateme_backend`) et le frontend (`loocateme_public_website`) lancés en local simultanément :

1. Ouvrir la page d'accueil, vérifier badge + countdown + formulaire + compteur dans le Hero.
2. S'inscrire avec un nouvel email → message de succès, email de bienvenue reçu (vérifier les logs backend ou une boîte de test SMTP).
3. Réinscrire le même email → message "déjà inscrit·e".
4. Couper le backend, recharger la page → le Hero ne doit pas planter (compteur retombe sur le message qualitatif, formulaire affiche l'erreur générique en cas de soumission).
5. Redescendre jusqu'au `FinalCta` en bas de page → même comportement (countdown, formulaire, compteur cohérents avec le Hero).
6. Cliquer sur les icônes Instagram/TikTok du Header et du Footer → ouvrent les bons profils dans un nouvel onglet.
7. Basculer le thème Sun/Moon → tout reste lisible dans les deux palettes.
8. Réduire la fenêtre en largeur mobile → formulaire, countdown et icônes restent utilisables sans débordement horizontal.

- [ ] **Step 4: Commit final (si des ajustements ont été faits pendant la QA)**

```bash
git add -A
git commit -m "chore(teaser): ajustements post-QA du teaser de pré-lancement"
```

(Ne committer que s'il y a effectivement eu des changements pendant la QA — sinon cette étape est un no-op.)
