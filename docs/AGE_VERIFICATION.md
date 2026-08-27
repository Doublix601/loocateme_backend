# Vérification d'âge renforcée (Didit)

État : **scaffold en place, inerte.** Rien ne s'exécute et aucune route n'exige
la vérification tant que `DIDIT_AGE_VERIFICATION_ENABLED` ≠ `true`.

Ce qui existe déjà à l'inscription (toujours actif) :
- Date de naissance obligatoire, contrôle `isAtLeast18` **client + serveur** (rejet `UNDERAGE`).
- Case « Je certifie avoir 18 ans ou plus » obligatoire → horodatée dans `User.ageAttestedAt`.

## Composants du scaffold

| Fichier | Rôle |
|---|---|
| `src/services/ageVerification.service.js` | Création de session Didit, vérif. signature webhook, application de la décision, `isUserAgeCleared()` |
| `src/controllers/ageVerification.controller.js` | Handlers `status` / `session` / `webhook` |
| `src/routes/ageVerification.routes.js` | `GET /api/age-verification/status`, `POST /api/age-verification/session` (auth) |
| `src/server.js` | `POST /api/age-verification/webhook` monté **avant** `express.json()` (corps brut) |
| `src/middlewares/auth.js` | `req.user.ageVerification` chargé ; `export requireAgeVerified` (non appliqué) |
| `src/models/User.js` | sous-document `ageVerification { provider, status, sessionId, verifiedAt, updatedAt }` |
| `docker-compose.yml` | `DIDIT_*` forwardés au conteneur |

## Passer en production

1. **Console Didit**
   - Webhook URL : `https://api.loocate.me/api/age-verification/webhook`
   - Dans le workflow (`DIDIT_WORKFLOW_ID`), régler le *callback* / redirect sur le deep link app :
     `loocateme://age-verification/complete` (ou la valeur de `DIDIT_CALLBACK_URL`).
   - Activer le check **Age Estimation** (biométrique, non intrusif) ou ID + âge selon le niveau voulu.

2. **`.env` du serveur** — les clés sont déjà présentes. Vérifier :
   ```
   DIDIT_API_KEY=...
   DIDIT_WORKFLOW_ID=...
   DIDIT_WEBHOOK_SECRET=...
   DIDIT_CALLBACK_URL=loocateme://age-verification/complete
   DIDIT_AGE_VERIFICATION_ENABLED=false   # <- rester false pour l'instant
   ```

3. **Test sandbox** (flag encore `false`, on force juste la route) :
   ```bash
   # créer une session pour un user de test
   curl -s -X POST https://api.loocate.me/api/age-verification/session \
     -H "Authorization: Bearer <access_token>" | jq
   # -> { "url": "...", "sessionId": "..." }  ; ouvrir l'URL, compléter,
   #    vérifier la réception du webhook et User.ageVerification.status = "approved"
   ```
   (le endpoint `/session` renvoie 409 `AGE_VERIFICATION_DISABLED` tant que le flag
   est off — le lever temporairement pour ce test, ou tester en staging.)

4. **App** — écran de vérification (≈ 1 écran, non fait) :
   - Après login, `GET /api/age-verification/status`. Si `cleared:false` → écran bloquant.
   - Bouton « Vérifier mon âge » → `POST /api/age-verification/session` → ouvrir `url`
     (`expo-web-browser` `openAuthSessionAsync`, redirect scheme `loocateme://`).
   - Au retour, poller `GET /api/age-verification/status` jusqu'à `approved` / `declined`.
   - Gérer le 403 `AGE_VERIFICATION_REQUIRED` global (intercepteur dans `ApiRequest.js`).

5. **Appliquer le gating** — ajouter `requireAgeVerified` après `requireAuth` sur les
   routes de contenu, p. ex. `src/routes/location.routes.js`, `/users/nearby`,
   messagerie :
   ```js
   import { requireAuth, requireAgeVerified } from '../middlewares/auth.js';
   router.get('/', requireAuth, requireAgeVerified, locationsListLimiter, LocationController.getLocations);
   ```

6. **Basculer** `DIDIT_AGE_VERIFICATION_ENABLED=true` puis redéployer.

7. **Politique de confidentialité** — remplacer le § 9 de `POLICY_PRIVACY.md` par la
   version « vérification active » puis publier en **minor** :
   ```
   API_BASE_URL=https://api.loocate.me ADMIN_TOKEN=<bearer_admin> CHANGE_TYPE=minor \
   CHANGELOG="Vérification d'âge renforcée (Didit) désormais active à l'inscription." \
   node scripts/publishPrivacyPolicy.js
   ```
   Texte § 9 « active » suggéré :
   > L'application est strictement réservée aux personnes majeures (18 ans et plus).
   > À l'inscription, votre âge est vérifié par notre prestataire spécialisé Didit
   > (estimation biométrique et/ou pièce d'identité, selon votre pays) avant de
   > pouvoir accéder au Service, en complément de votre date de naissance déclarée
   > et de votre attestation de majorité. Didit agit comme sous-traitant au sens de
   > l'article 28 du RGPD ; les données transmises sont limitées à ce qui est
   > strictement nécessaire à la vérification d'âge. Si vous pensez qu'un mineur a
   > néanmoins pu créer un compte, contactez-nous à contact@loocate.me.

## Références
- API : https://docs.didit.me/api-reference/overview — `POST /v3/session/`, header `x-api-key`
- Webhooks : https://docs.didit.me/reference/webhooks — en-tête `X-Signature-Simple`
  (HMAC-SHA256 hex de `session_id|status|created_at`) ou `X-Signature` (corps brut)
