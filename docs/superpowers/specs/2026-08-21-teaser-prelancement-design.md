# Teaser de pré-lancement — liste d'attente & refonte visuelle du site public

**Date** : 2026-08-21
**Repos concernés** : `loocateme_public_website` (principal), `loocateme_backend` (nouvel endpoint)
**Statut** : validé en brainstorming, en attente de plan d'implémentation

## Contexte

L'application mobile LoocateMe n'est pas encore publiée sur l'App Store ni sur
Google Play (lancement visé **samedi 5 septembre 2026**). Le site public
(`loocateme_public_website`, Next.js 16 + Tailwind 4) affiche aujourd'hui des
boutons "App Store" / "Google Play" pointant vers des URLs génériques
(`apps.apple.com`, `play.google.com`) dans `Hero.tsx` et `FinalCta.tsx` — ces
boutons ne mènent à rien de réel.

Des modifications non commitées existaient sur `Hero.tsx`, `FeatureGrid.tsx`,
`layout.tsx` et `globals.css` (début de refonte visuelle vers une mise en page
plus éditoriale). Décision : **on ne les reprend pas**, on repart d'une base
propre avec ce spec.

Le site n'a pas de section dédiée aux professionnels/lieux (le backend a des
fonctionnalités Pro Boost/sponsoring, mais le site public reste centré
utilisateurs finaux ; un lien externe "Espace pro" vers `pro.loocate.me`
existe déjà dans le Header/Footer et n'est pas modifié par ce chantier).

## Objectif

Transformer le site en teaser de pré-lancement :

1. Remplacer les CTA App Store/Google Play (Hero + FinalCta) par une
   inscription à une liste d'attente email.
2. Afficher un compte à rebours vers le 5 septembre 2026.
3. Afficher un compteur d'inscrits **honnête** : message qualitatif
   ("Rejoins les premiers inscrits") tant que le nombre d'inscrits est
   inférieur à **50**, puis le chiffre réel au-delà. Aucun chiffre inventé
   n'est affiché à aucun moment (voir section Anti-patterns).
4. Envoyer un email de bienvenue automatique à l'inscription.
5. Ajouter des liens vers Instagram et TikTok (`@loocateme`) dans le Header
   et le Footer.
6. Retravailler visuellement le Hero et le FinalCta autour de ces nouveaux
   éléments ; polish léger (espacement/hiérarchie) sur FeatureGrid,
   VibeShowcase, HowItWorks, FaqSection sans refonte structurelle.

## Hors scope

- Nouvelles pages de contenu (blog, presse, cas d'usage).
- SEO avancé (au-delà du sitemap/robots/OG déjà en place).
- Espace pro dédié sur ce site (reste un lien externe).
- Vrais liens App Store/Google Play (reviendront dans un chantier séparé
  après publication effective de l'app).

## Anti-pattern explicitement écarté : compteur gonflé

Il a été envisagé d'afficher un nombre d'inscrits exagéré pour stimuler la
conversion. **Décision : non.** Afficher un chiffre inventé constitue une
pratique commerciale trompeuse (droit de la consommation) et un risque de
réputation disproportionné par rapport au gain espéré. À la place : message
qualitatif sans chiffre tant que le nombre réel est faible (< 50), chiffre
réel ensuite.

## Backend (`loocateme_backend`)

Reprend le pattern existant `support.routes.js` /
`support.controller.js` (endpoint public, sans auth, rate-limité,
validé, `sendMail` via `src/services/email.service.js`).

### Modèle — `src/models/WaitlistSignup.js`

- `email` (String, requis, unique, index, stocké normalisé en minuscule)
- `createdAt` (Date, défaut `Date.now`)

### Routes — `src/routes/waitlist.routes.js`, montées sur `/api/waitlist`

- `POST /api/waitlist`
  - Body : `{ email }`.
  - Validation : email requis, format valide, normalisé (même config que
    `validators.supportContact` dans `src/middlewares/validators.js`).
  - Rate limit : nouveau limiteur dédié dans `src/middlewares/rateLimit.js`
    (ex. `waitlistSignupLimiter`, 10/heure/IP — plus permissif que
    `supportContactLimiter` car geste plus léger à un seul champ).
  - Comportement :
    - Email déjà présent → `200 { ok: true, alreadySubscribed: true }` (pas
      d'erreur ; pas de fuite d'info sensible, l'utilisateur soumet son
      propre email).
    - Sinon → crée le document, envoie l'email de bienvenue via `sendMail`,
      retourne `201 { ok: true, count }` (`count` = total après insertion).
- `GET /api/waitlist/count`
  - Public, sans auth.
  - Retourne `{ count }` = `WaitlistSignup.countDocuments()`.
  - Rate limit léger dédié (ex. 30/min/IP) pour éviter les abus ; pas de
    cache applicatif nécessaire vu le volume attendu avant le 5/09.

### Email de bienvenue

Envoyé via `sendMail()` (déjà branché sur Nodemailer). Contenu : confirmation
d'inscription, rappel de la date de lancement (5 septembre 2026), ton
cohérent avec le reste des communications LoocateMe.

### Montage

Ajouter `app.use('/api/waitlist', waitlistRoutes);` dans `src/server.js`, aux
côtés des routes publiques existantes (`supportRoutes`).

## Frontend (`loocateme_public_website`)

### Nouveaux composants — `src/components/landing/`

- **`WaitlistForm.tsx`** (client component)
  - Même pattern que `src/components/contact/ContactForm.tsx` : un champ
    email, bouton pill "Rejoindre la liste d'attente", états
    loading/success/error via `apiFetch("/api/waitlist", { method: "POST", body: { email } })`.
  - Message de succès différent si `alreadySubscribed: true` ("Tu es déjà
    inscrit !") vs première inscription.
- **`Countdown.tsx`** (client component)
  - Cible : 2026-09-05T00:00:00 (heure de Paris).
  - Affiche Jours / Heures / Minutes (pas de secondes, pour éviter l'effet
    gadget et les re-renders trop fréquents).
  - `setInterval` léger (tick à la minute).
  - Cas date dépassée : bascule sur un état "C'est lancé !" sans erreur,
    countdown masqué.
- **`WaitlistCount.tsx`** (Server Component)
  - Fetch `GET /api/waitlist/count` côté serveur, `revalidate` court
    (ex. 60s).
  - Si `count < 50` → message qualitatif ("Rejoins les premiers inscrits").
  - Sinon → chiffre réel ("X déjà inscrits").
  - En cas d'échec de fetch → traiter comme `count = 0` (fallback silencieux
    sur le message qualitatif, jamais d'erreur visible ni de crash du Hero).

### Sections modifiées

- **`Hero.tsx`** : badge "Bientôt disponible" (remplace l'eyebrow actuel) →
  titre inchangé (`Découvre qui sort près de toi, en temps réel`) → Countdown
  → WaitlistForm (élément le plus proéminent, remplace les boutons App
  Store/Google Play) → WaitlistCount (caption, sous le formulaire) → icônes
  Instagram/TikTok discrètes à proximité.
- **`FinalCta.tsx`** : même verticale (Countdown + WaitlistForm +
  WaitlistCount), version condensée, dans le bloc `gradient-signature-soft`
  existant.
- **`Header.tsx`** : ajoute icônes Instagram/TikTok (SVG inline — pas de
  logos de marque dans lucide-react) à côté du bouton "Pro" existant.
- **`Footer.tsx`** : mêmes icônes sociales.
- **`FeatureGrid.tsx`, `VibeShowcase.tsx`, `HowItWorks.tsx`,
  `FaqSection.tsx`** : polish (espacement, hiérarchie) sans changement
  structurel — gardent leur rôle de réassurance sous le teaser.

### Réseaux sociaux

- Instagram : `https://instagram.com/loocateme`
- TikTok : `https://tiktok.com/@loocateme`

(À confirmer/corriger si les handles réels diffèrent au moment de
l'implémentation.)

## Gestion d'erreurs

- Email invalide → message inline sous le champ ; validation côté client
  avant envoi, validator serveur en filet.
- 429 (rate limit) → "Trop de tentatives, réessaie dans un moment."
- Erreur réseau/serveur → message générique existant ("Une erreur est
  survenue, merci de réessayer"), même pattern que `ContactForm`.
- `GET /api/waitlist/count` en échec → fallback silencieux, jamais d'erreur
  visible dans le Hero.
- Countdown après l'échéance → bascule automatique vers l'état "lancé",
  aucune erreur JS.

## Tests

- **Backend** : tests d'intégration (pattern existant dans `tests/`) pour
  `POST /api/waitlist` (succès, doublon, email invalide, rate limit) et
  `GET /api/waitlist/count`.
- **Frontend** : pas de suite de tests automatisés existante sur ce repo ;
  vérification manuelle via `npm run dev` — inscription, doublon, erreur
  réseau simulée, countdown avant/après échéance (via mock de date),
  affichage du compteur sous/au-dessus du seuil de 50.
- **Lint/build** : `npm run lint` + `npm run build` sur les deux repos avant
  de considérer le chantier terminé (CI existante sur le site public).

## Suites possibles (hors scope de ce chantier)

- Contenu additionnel / nouvelles pages.
- SEO avancé.
- Vrais liens App Store/Google Play après publication effective.
