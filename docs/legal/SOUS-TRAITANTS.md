# Sous-traitants (RGPD art. 28) — LoocateMe

> **Statut : à compléter (colonnes « DPA signé » et « Réf. contrat »).**
> Chaque société qui traite des données personnelles **pour le compte** de LoocateMe
> est un sous-traitant. L'art. 28 impose un **contrat écrit** avec des clauses
> obligatoires (instructions documentées, confidentialité, sécurité, sous-sous-traitants,
> assistance aux droits, suppression/restitution en fin de contrat, audits,
> notification de violation). En pratique : accepter / signer le **DPA standard** de
> chaque prestataire (souvent disponible dans sa console ou sa page « legal »).
>
> Pour les transferts hors UE : vérifier l'adhésion au **Data Privacy Framework UE–US**
> ou l'existence de **clauses contractuelles types (CCT)** dans le DPA.

| Prestataire | Rôle / traitement | Données transmises | Localisation | Transfert hors UE | DPA | Réf. contrat / lien |
|---|---|---|---|---|---|---|
| **OVH** | Hébergement de l'infrastructure (serveur, base MongoDB, Redis, fichiers `uploads/`) | Toutes les données applicatives | France | Non | ☐ | DPA OVHcloud (`ovhcloud.com/fr/personal-data-protection/`) |
| **OVH (SMTP `pro3.mail.ovh.net`)** | Envoi des emails transactionnels (vérification de compte, réinitialisation de mot de passe, informations légales) | Email, prénom, liens à usage unique | France | Non | ☐ | idem OVH |
| **Google — Firebase Cloud Messaging** | Acheminement des notifications push (Android + partiellement iOS) | Jeton d'appareil FCM, contenu de la notification | US / mondial | **Oui (US)** | ☐ | Google Cloud DPA + FCM ; vérifier statut **DPF** |
| **Expo (Expo Application Services)** | Service de notifications Expo ; build/OTA de l'app | Jeton de notification Expo ; (build : code, pas de données utilisateur) | US | **Oui (US)** | ☐ | Expo DPA (`expo.dev/terms`) |
| **RevenueCat** | Gestion des abonnements Premium et des achats in-app côté mobile | Identifiant de compte, identifiant d'achat, statut d'abonnement | US | **Oui (US)** | ☐ | RevenueCat DPA (`revenuecat.com/dpa`) — vérifier **DPF/CCT** |
| **Stripe** | Paiements sur le **site web** (pas l'app mobile) | Identifiant de compte, statut de paiement (**pas** de coordonnées bancaires côté LoocateMe) | US / IE | **Oui (US)** | ☐ | Stripe DPA (`stripe.com/legal/dpa`) — Stripe adhère au **DPF** |
| **Apple App Store / Google Play** | Traitement des achats in-app (rôle de responsable conjoint / distinct selon les cas) | Achat, statut d'abonnement | US | Oui | n/a (relation via les conditions développeur) | App Store / Play — conditions développeur |
| **MapTiler** | Fourniture des fonds de carte (tuiles) pour la vue carte | Requêtes de tuiles (adresse IP, zone consultée) — **pas de données de compte** | CH / UE | Selon config | ☐ | MapTiler DPA (`maptiler.com/privacy-policy/`) — clé `EXPO_PUBLIC_MAPTILER_KEY` |
| **OpenStreetMap Foundation** | Source des données de lieux (import via Overpass) | Aucune donnée personnelle transmise (requêtes de lieux par zone) | UK / UE | — | n/a | Données sous licence ODbL |

## Sous-traitants retirés / non utilisés
- **Didit** (vérification d'âge) : **intégration retirée** (décision produit). Les clés
  `DIDIT_*` peuvent rester inertes dans `.env` ou être supprimées ; aucun code ne les lit.
  Si la vérification d'âge est réintroduite, ajouter Didit (ou équivalent) ici + DPA.

## À faire
1. Pour chaque ligne : récupérer et **accepter/signer le DPA**, cocher la case, noter la référence.
2. Vérifier, pour chaque transfert US, le mécanisme (DPF actif ? sinon CCT dans le DPA).
3. Refléter cette liste dans la **politique de confidentialité** (§4 « Partage des données »)
   et la tenir synchronisée.
4. Conserver les DPA signés dans un dossier dédié (preuve en cas de contrôle CNIL).
