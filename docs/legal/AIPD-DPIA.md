# Analyse d'impact relative à la protection des données (AIPD / DPIA) — LoocateMe

> **Statut : brouillon à compléter et valider.**
> Ce document est un point de départ rédigé à partir du code et de la politique de
> confidentialité v1.1. Il n'a pas valeur d'avis juridique. À finaliser dans le
> **logiciel PIA de la CNIL** (gratuit, [cnil.fr/fr/outil-pia](https://www.cnil.fr/fr/outil-pia)),
> puis à faire relire par un juriste RGPD / le DPO le cas échéant.

## Pourquoi une AIPD est requise

Article 35(3) RGPD — une AIPD est **obligatoire** notamment en cas de :
- **(c) surveillance systématique à grande échelle d'une zone accessible au public.**
  LoocateMe transmet régulièrement la position GPS de ses utilisateurs pour détecter
  leur présence dans des lieux publics (bars, cafés, parcs…) et l'afficher aux autres
  utilisateurs présents. → **critère rempli.**
- Liste CNIL des traitements soumis à AIPD : « traitement de données de localisation
  à grande échelle », « profilage » (LoocateMe calcule un score de popularité par lieu,
  des statistiques de profil, un classement d'étoiles). → **critère(s) rempli(s).**

Sanction pour AIPD manquante alors qu'obligatoire : **jusqu'à 10 M€ ou 2 % du CA
mondial** (art. 83(4)).

## 1. Description systématique du traitement

### 1.1 Finalités
| # | Finalité | Base légale |
|---|---|---|
| F1 | Créer/sécuriser le compte, authentifier, communiquer | Exécution du contrat |
| F2 | Montrer les lieux animés et les personnes présentes à proximité (cœur du service) | Consentement (localisation GPS) + exécution du contrat |
| F3 | Messagerie et interactions sociales (follow, blocage, messages) | Exécution du contrat |
| F4 | Modération, prévention des abus, sécurité de la communauté | Intérêt légitime |
| F5 | Statistiques de profil (Premium) et classement des lieux | Consentement (analytics) / intérêt légitime (agrégats) |
| F6 | Notifications push | Consentement |
| F7 | Abonnement Premium et achats | Exécution du contrat |
| F8 | Proximité Bluetooth (optionnelle, désactivée par défaut) | Consentement explicite distinct |

### 1.2 Données traitées
- **Identité** : email, mot de passe (haché bcrypt), nom d'utilisateur, prénom, nom,
  nom personnalisé, bio, date de naissance, genre (optionnel).
- **Attestation d'âge** : `ageAttestedAt` (horodatage de la case « 18 ans ou plus »).
- **Photo de profil** ; identifiants de réseaux sociaux affichés (au choix de l'utilisateur).
- **Géolocalisation** : coordonnées GPS transmises périodiquement ; lieu de présence
  courant + horodatage de dernière activité ; ville.
- **Proximité Bluetooth** (si activée) : identifiant technique **aléatoire, temporaire**
  (rotation 10 min), jamais l'identifiant de compte.
- **Social** : follows, blocages, conversations et messages (texte, photos, vidéos),
  croisements (« crossed paths »).
- **Usage** : vues de profil, clics sur réseaux sociaux, recherches, visites de lieux.
- **Technique** : jeton de notification (FCM / Expo), logs serveur.
- **Paiement** : statut d'abonnement (actif/expiré/annulé) — **jamais** les coordonnées bancaires.
- **Modération** : catégorie/motif/description des signalements, historique d'avertissements
  et de suspensions.

### 1.3 Destinataires
Voir `docs/legal/SOUS-TRAITANTS.md`. En résumé : hébergeur (OVH, France), prestataire
d'emails, Firebase Cloud Messaging (Google) + Expo (notifications), RevenueCat + Stripe
(abonnements/paiements). Les autres utilisateurs de l'app sont destinataires des données
de profil publiques et de présence de l'utilisateur.

### 1.4 Durées de conservation
| Donnée | Durée |
|---|---|
| Compte et contenu | Tant que le compte est actif, jusqu'à suppression par l'utilisateur |
| Historique de vues de profil | ~30 jours |
| Historique de visites de lieux | Anonymisé après 30 jours (lien profil supprimé, agrégat conservé) |
| Présence temps réel | Quelques minutes d'inactivité |
| Détections Bluetooth (serveur) | 30 minutes |
| Coordonnées GPS précises | Arrêtées dès la confirmation de présence dans un lieu |
| Croisements (« crossed paths ») | *(à confirmer dans le code — `CrossedPath`)* |
| Logs serveur | *(à confirmer — politique de rotation)* |

### 1.5 Sous-traitants et flux hors UE
Firebase/Google et Stripe peuvent traiter des données depuis les États-Unis :
encadrement par décision d'adéquation (Data Privacy Framework UE–US) ou clauses
contractuelles types. Hébergement principal OVH en France. → **à documenter
prestataire par prestataire (SOUS-TRAITANTS.md) et à joindre les DPA.**

## 2. Évaluation de la nécessité et de la proportionnalité

| Principe | Mesures en place | Reste à faire |
|---|---|---|
| Finalité déterminée, explicite, légitime | Politique v1.1 détaille la finalité par catégorie | OK |
| Minimisation | GPS précis coupé après check-in ; partage du lieu précis **off par défaut** ; ville seule sinon ; BLE = identifiant aléatoire ; mode invisible | Vérifier qu'aucun log ne conserve de traînée GPS |
| Conservation limitée | Durées ci-dessus, anonymisation à 30 j | Documenter la conservation des croisements + logs ; script de purge (`scripts/cleanupPrivacyData.js`) à auditer |
| Base légale | Consentement (GPS, BLE, notifs, marketing) recueilli à l'inscription (écran RGPD) ; contrat ; intérêt légitime | Documenter la balance d'intérêt légitime pour F4/F5 |
| Information | Politique accessible in-app, versionnée, re-consentement sur changement majeur | OK |
| Droits | Export + suppression in-app ; opposition via toggles ; réclamation CNIL citée | Vérifier le délai de réponse aux demandes hors app |
| Sécurité | Voir §3 | — |

## 3. Risques pour les droits et libertés des personnes

Pour chaque menace : **impact** (négligeable / limité / important / maximal),
**vraisemblance**, **mesures**.

### R1 — Traque / harcèlement physique par un autre utilisateur
- **Scénario** : un utilisateur suit les check-ins d'une personne pour la retrouver
  physiquement, ou croise nom complet + photo + réseaux sociaux dans un lieu.
- **Impact** : *important à maximal* (sécurité physique, violences).
- **Vraisemblance** : *limitée à importante* (app de mise en relation géolocalisée).
- **Mesures existantes** : partage du lieu précis désactivé par défaut ; présence
  expirant après quelques minutes ; mode invisible ; mode « profil restreint »
  (réseaux masqués) et « incognito » ; blocage ; signalement ; le libellé du réglage
  nomme explicitement le « risque de traque ».
- **Mesures à renforcer** (à décider) : afficher le prénom seul par défaut aux
  inconnus, ne révéler nom complet + réseaux qu'après interaction mutuelle
  (**LEG-06** de la revue — non implémenté) ; limiter l'historique de présence visible ;
  détection de comportement de « suivi » (même utilisateur présent aux mêmes lieux/heures).

### R2 — Ré-identification à partir de quelques points de localisation
- **Scénario** : croisement domicile/travail à partir de l'historique de présence.
- **Impact** : *limité à important*.
- **Vraisemblance** : *limitée* (pas d'historique GPS conservé, seulement le lieu courant).
- **Mesures** : pas de stockage de trajectoire ; anonymisation des visites à 30 j ;
  BLE anonyme.

### R3 — Accès d'un mineur au service
- **Scénario** : un mineur déclare une fausse date de naissance et accède à une app
  de mise en relation adulte avec des lieux « bar / boîte de nuit ».
- **Impact** : *important* (protection des mineurs, exposition réglementaire DSA art. 28,
  App Store §1.3).
- **Vraisemblance** : *importante* — le contrôle actuel est **purement déclaratif**
  (date de naissance + case + `isAtLeast18` client & serveur). L'EDPB (Statement 1/2025)
  considère l'auto-déclaration comme non fiable.
- **Mesures existantes** : blocage si âge < 18 déclaré ; attestation explicite ;
  politique §9.
- **Décision produit** : la vérification d'âge par tiers (Didit) a été **retirée**.
  → **risque résiduel assumé.** À réévaluer avant mise en avant sur les stores et à
  mesure que la base grandit. Option : age estimation biométrique non intrusive.

### R4 — Fuite / accès illégitime aux messages et photos privées
- **Impact** : *important*.
- **Mesures** : HTTPS ; mots de passe hachés bcrypt ; JWT + refresh tokens à durée
  limitée ; accès interne restreint (modération/support).
- **À renforcer** : chiffrement au repos des médias privés ; modération d'image
  automatique à l'upload (**LEG-05** — non implémenté) ; politique de gestion des
  accès internes formalisée ; audit log des accès modération.

### R5 — Modification / suppression non désirée de données
- **Mesures** : sauvegardes *(à documenter — fréquence, rétention, test de restauration)* ;
  corrections de lieux passant par une file de modération (pas d'écrasement direct).

### R6 — Sous-traitant défaillant
- **Mesures** : DPA à signer avec chaque sous-traitant (**à faire**, cf. SOUS-TRAITANTS.md) ;
  registre art. 30 (**à faire**).

## 4. Validation

- Risque résiduel global : *(à évaluer après §3 — si un risque reste « important » ou
  « maximal » malgré les mesures, **consultation préalable de la CNIL** requise, art. 36).*
- Avis du DPO : *(si un DPO est désigné — cf. DPO-DSA-STRUCTURE.md).*
- Décision du responsable de traitement (Arnaud Theret) : ______________________
- Date : ______________  Prochaine revue : ______________ (à revoir à chaque évolution
  majeure du traitement).

## Actions prioritaires issues de cette AIPD
1. Finaliser dans l'outil PIA CNIL + faire relire par un juriste.
2. Établir le **registre des traitements** (art. 30) — cf. REGISTRE-TRAITEMENTS.md.
3. Recenser et **signer les DPA** de tous les sous-traitants — cf. SOUS-TRAITANTS.md.
4. Documenter : conservation des croisements et des logs, politique de sauvegarde,
   gestion des accès internes.
5. Trancher R3 (âge) et R1 (exposition d'identité) — décisions produit à assumer par écrit.
