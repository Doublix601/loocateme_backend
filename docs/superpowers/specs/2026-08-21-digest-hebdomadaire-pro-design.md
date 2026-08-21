# Digest hebdomadaire par email — comptes Pro (Pro2/Pro3)

Date : 2026-08-21
Statut : validé pour passage en plan d'implémentation
Dépôts concernés : `loocateme_backend` (logique + envoi), `loocateme_website` (site pro — page Paramètres)

## 1. Contexte et objectif

Le dashboard pro (`loocateme_website`) expose déjà des statistiques de fréquentation (vues, jours forts, démographie) aux paliers Pro2/Pro3, mais uniquement en *pull* : le pro doit se connecter et ouvrir `/dashboard/stats` pour les voir. Objectif : renvoyer ces mêmes pros vers leur dashboard chaque semaine via un email récapitulatif automatique, pour renforcer la valeur perçue de l'abonnement en continu (rétention) et créer une habitude de consultation régulière (engagement).

**À ne pas confondre** avec `CronService.sendWeeklyDigest` (existant, `loocateme_backend/src/services/cron.service.js`), qui envoie une **notification push** aux **utilisateurs grand public** de l'app mobile ("Ton profil a été vu X fois cette semaine"). C'est un système entièrement différent (canal, cible, contenu). Le nouveau code utilise donc des noms distincts (`sendBusinessWeeklyDigest`, `businessDigest.*`) pour éviter toute confusion dans le code et les logs.

## 2. Portée

**Inclus :**
- Email hebdomadaire (lundi) aux lieux Pro2/Pro3 actifs, contenant : vues des 7 derniers jours + tendance vs semaine précédente, meilleur jour de la semaine, lien vers le dashboard.
- Préférence par lieu pour désactiver ce digest (défaut : activé).
- Lien de désabonnement en un clic depuis l'email (sans connexion requise).
- Nouvelle page `/dashboard/settings` sur le site pro, qui remplace `/dashboard/account` et regroupe suppression de compte (déplacée telle quelle) + préférence de notification par email.

**Hors scope (à ne pas faire ici) :**
- Digest pour les paliers `none`/`pro1` (pas d'accès aux stats).
- Tout autre canal (SMS, push pro) ou fréquence (mensuel, quotidien).
- Refonte des templates d'email existants (`policyNotification.service.js` reste inchangé).
- Gestion des autres sous-projets brainstormés en parallèle (parrainage pro→pro, programmation à l'avance, amélioration des stats) — chacun aura sa propre spec.

## 3. Modèle de données

Sur `Location` (`src/models/Location.js`), ajout d'un sous-document, au même niveau que `businessTier`/`sponsorship` (préférence par lieu, pas par compte utilisateur, cohérent avec le reste du modèle métier) :

```js
notificationPreferences: {
  // Défaut true : service lié à l'abonnement payé, pas une newsletter marketing
  // (cf. §6 Conformité). Un pro qui ne veut rien recevoir se désabonne explicitement.
  weeklyDigestEmail: { type: Boolean, default: true },
},
```

## 4. Backend

### 4.1 Contenu de l'email

Nouveau fichier `src/services/businessDigest.service.js` :

- `buildDigestEmail({ location, stats })` — construit `{ subject, text, html }` sur le même modèle que `buildPolicyUpdateEmail` dans `policyNotification.service.js` (texte + HTML simples, pas de moteur de template).
  - Vues 7j : `stats.views['7d'].current`, tendance `stats.views['7d'].deltaPct` (peut être `null` si pas de données la semaine précédente → ne pas afficher de tendance dans ce cas).
  - Meilleur jour : max de `stats.visitsByWeekday` (index 0=lundi … 6=dimanche) ; si toutes les valeurs sont à 0, omettre cette ligne plutôt que d'afficher un jour arbitraire.
  - Lien vers `${BUSINESS_SITE_PUBLIC_URL}/dashboard/stats`.
  - Pied de mail légal (cf. §6) : identité de l'expéditeur + adresse postale + lien de désabonnement signé.
- `sendBusinessWeeklyDigest()` — boucle sur `Location.find({ businessTier: { $in: ['pro2', 'pro3'] }, 'notificationPreferences.weeklyDigestEmail': { $ne: false } })`, appelle `getLocationStats(location._id)` (déjà exporté par `businessStats.service.js`, calcul live — le volume de pros payants ne justifie pas un job de batch comme `PolicyEmailJob`), résout l'email du propriétaire via `User.findById(location.ownerId)`, envoie via `sendMail` (`email.service.js`), log succès/échec par lieu sans interrompre la boucle (même pattern que `processPolicyEmailJobs`).
- Ne rien envoyer si `views['7d'].current === 0` ? **Non** — envoyé quand même avec une formulation neutre ("Aucune vue cette semaine, pensez à booster votre visibilité"), pour rester prévisible et parce que c'est justement le signal qu'un pro à faible trafic a le plus besoin de voir.

### 4.2 Cron

Dans `src/services/cron.service.js`, ajouter un `nodeCron.schedule('30 8 * * 1', ...)` (lundi 08h30, décalé du digest push existant à 09h00 pour étaler la charge SMTP/push) qui appelle `sendBusinessWeeklyDigest()`. Suivre le pattern try/catch + log déjà utilisé pour les autres tâches de ce fichier.

### 4.3 Endpoint préférence

Dans `businessProfile.routes.js` / `businessProfile.controller.js` (même fichiers que les autres réglages de fiche) :

```
PUT /api/business/locations/:locationId/notification-preferences
  requireAuth, requireLocationOwner
  body: { weeklyDigestEmail: boolean }
```

Pas de `requireBusinessTier` : un pro peut préconfigurer sa préférence même à un palier qui n'y donne pas encore accès (cohérent avec le fait que le champ existe indépendamment du tier).

### 4.4 Désabonnement en un clic

Nouveau `src/services/businessDigest.service.js` (suite) + `src/controllers/businessDigest.controller.js` + `src/routes/businessDigest.routes.js`, montés publiquement (sans `requireAuth`) sur `/api/business/digest` dans `server.js`.

- `signUnsubscribeToken(locationId)` : `${locationId}.${hmacSHA256(locationId, DIGEST_UNSUBSCRIBE_SECRET).hex}` — nouvelle variable d'env `DIGEST_UNSUBSCRIBE_SECRET` (à ajouter dans `.env.example`), dédiée (ne pas réutiliser `JWT_ACCESS_SECRET`, qui a une autre finalité).
- `GET /api/business/digest/unsubscribe?token=...` :
  - Parse `locationId` + signature depuis le token, recalcule le HMAC, compare en temps constant (`crypto.timingSafeEqual`).
  - Si valide : `Location.updateOne({ _id }, { 'notificationPreferences.weeklyDigestEmail': false })`, puis `302` vers `${BUSINESS_SITE_PUBLIC_URL}/dashboard/settings?digest=unsubscribed`.
  - Si invalide/absent : `302` vers `${BUSINESS_SITE_PUBLIC_URL}/dashboard/settings?digest=error` (pas de 400 JSON brut — c'est un lien cliqué depuis un client mail, pas un appel API).

## 5. Site pro (`loocateme_website`)

- Renommer le dossier de route `src/app/(dashboard)/dashboard/account/` → `.../dashboard/settings/`, page rebaptisée "Paramètres".
- Mettre à jour toutes les références à `/dashboard/account` : `DashboardNav.tsx` (label "Compte" → "Paramètres", href), `(dashboard)/layout.tsx` ligne 23 (redirection paywall), tout `BackButton` qui y pointe.
- Sur la nouvelle page `settings/page.tsx` :
  - Nouvelle carte "Notifications par email" en haut : toggle lié à `location.notificationPreferences?.weeklyDigestEmail !== false`, appelle `PUT .../notification-preferences` via `apiFetch` (même pattern que les autres actions du dashboard), suivi d'un `refresh()`.
  - Lecture de `?digest=unsubscribed` / `?digest=error` via `useSearchParams` (pattern déjà utilisé dans `activate/page.tsx`) pour afficher un message de confirmation après clic sur le lien de désabonnement.
  - Bloc suppression de compte : déplacé tel quel depuis l'actuel `account/page.tsx`, aucune modification de logique.
- `src/lib/auth-client.tsx` : ajouter `notificationPreferences?: { weeklyDigestEmail?: boolean }` au type `BusinessLocation`.

## 6. Conformité légale (RGPD / CCPA / droit français / CAN-SPAM)

L'app cible l'UE (RGPD) et les États-Unis, dont la Californie (CCPA) — cf. `POLICY_PRIVACY.md` §"Transferts hors UE". Ce digest est un email de service lié à un abonnement payant en cours, pas une communication marketing :

- **Pas de consentement préalable requis** (intérêt légitime / exécution du contrat d'abonnement), mais **désabonnement en un clic obligatoire** (RGPD/ePrivacy + CAN-SPAM) → implémenté en §4.4, sans connexion requise.
- **Identité de l'expéditeur et adresse postale physique** dans le pied de mail (exigence CAN-SPAM) : réutiliser les mentions déjà définies dans `POLICY_PRIVACY.md` §1 (Arnaud THERET, micro-entreprise, 53 rue de Paris, 60200 Compiègne).
- **Le désabonnement doit être honoré immédiatement**, pas seulement "dans un délai raisonnable" : c'est un simple flag lu à chaque exécution hebdomadaire du cron, donc effectif dès le prochain envoi (et bloque tout envoi ultérieur tant que non réactivé).
- **Vérification du palier au moment de l'envoi**, pas à la création d'un job différé (il n'y en a pas ici) : la requête Mongo du §4.1 filtre `businessTier` à l'instant T, donc un pro qui a résilié entre deux lundis ne reçoit plus rien automatiquement.
- **Pas de données personnelles sensibles exposées** : le digest n'utilise que des compteurs agrégés (vues, jour de la semaine), jamais les données démographiques individuelles déjà soumises au seuil `MIN_SAMPLE_SIZE` dans `businessStats.service.js`.

## 7. Tests

**Backend :**
- `businessDigest.service.js` : construction du contenu (cas normal, tendance `null`, tous les jours à 0, vues à 0).
- `sendBusinessWeeklyDigest` : filtre correct par tier + `notificationPreferences.weeklyDigestEmail`, un échec d'envoi sur un lieu n'interrompt pas la boucle.
- Token de désabonnement : signature valide → flag mis à jour + redirection succès ; signature invalide/absente/`locationId` inexistant → redirection erreur, flag inchangé.
- Endpoint préférence : owner peut modifier, non-owner rejeté (403, même comportement que les autres routes protégées par `requireLocationOwner`).

**Frontend :**
- Toggle settings : état initial reflète `notificationPreferences.weeklyDigestEmail`, écriture appelle bien l'endpoint et se met à jour après `refresh()`.
- Affichage du message de confirmation selon `?digest=unsubscribed|error`.
- Navigation : tous les liens vers l'ancien `/dashboard/account` pointent désormais vers `/dashboard/settings`.

## 8. Risques / points d'attention

- Renommer la route `account` → `settings` casse tout lien externe/marque-page existant vers `/dashboard/account` — acceptable ici (site interne, pas de trafic SEO sur cette page), mais à signaler si des emails transactionnels existants pointaient vers cette URL (à vérifier en implémentation : grep `dashboard/account` côté backend, dans les templates d'email de bienvenue/activation).
- `getLocationStats` recalcule en live (agrégations Mongo) pour chaque lieu à chaque envoi hebdomadaire : acceptable au volume actuel de pros payants, à revisiter si ce volume grossit significativement (passer à une lecture depuis `Location.analytics` dénormalisé, en étendant `recomputeAllLocationAnalytics` pour y inclure `views`).
