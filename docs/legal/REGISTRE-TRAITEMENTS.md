# Registre des activités de traitement (RGPD art. 30) — LoocateMe

> **Statut : brouillon à compléter et tenir à jour.**
> Le registre est **obligatoire** dès lors que le traitement n'est pas occasionnel
> (c'est le cas ici), même pour une structure de moins de 250 personnes.
> Modèle CNIL : [cnil.fr/fr/RGPD-le-registre-des-activites-de-traitement](https://www.cnil.fr/fr/RGPD-le-registre-des-activites-de-traitement).

## Identité

- **Responsable de traitement** : Arnaud THERET, entrepreneur individuel (micro-entreprise),
  53 rue de Paris, 60200 Compiègne, France.
- **Contact** : contact@loocate.me
- **DPO** : *(à désigner ou à documenter comme non requis — cf. DPO-DSA-STRUCTURE.md)*
- **Représentant UE** : sans objet (établi en France).

---

## T1 — Gestion des comptes utilisateurs

| Champ | Valeur |
|---|---|
| Finalité | Créer et sécuriser le compte, authentifier, communiquer (vérification email, réinitialisation mot de passe), attester la majorité |
| Base légale | Exécution du contrat ; obligation légale (vérification 18+) |
| Personnes concernées | Utilisateurs de l'application |
| Catégories de données | Email, mot de passe haché (bcrypt), nom d'utilisateur, prénom, nom, nom personnalisé, bio, date de naissance, genre, `ageAttestedAt` |
| Destinataires | Prestataire d'envoi d'emails ; hébergeur |
| Transferts hors UE | Email : *(selon prestataire — à préciser)* |
| Durée de conservation | Tant que le compte est actif, jusqu'à suppression par l'utilisateur ; suppression → effacement / anonymisation |
| Mesures de sécurité | HTTPS, bcrypt, JWT + refresh tokens courts, accès interne restreint |

## T2 — Géolocalisation et présence

| Champ | Valeur |
|---|---|
| Finalité | Montrer à l'utilisateur les lieux animés et les personnes présentes autour de lui ; afficher la fréquentation des lieux |
| Base légale | Consentement (accès GPS) + exécution du contrat |
| Personnes concernées | Utilisateurs ayant activé la localisation |
| Catégories de données | Coordonnées GPS (transmises périodiquement), lieu de présence courant, horodatage de dernière activité, ville |
| Destinataires | Autres utilisateurs présents dans le même lieu (présence) ; hébergeur |
| Transferts hors UE | Non (OVH France) |
| Durée de conservation | GPS précis : arrêté dès confirmation de présence ; présence : expire après quelques minutes d'inactivité ; visites de lieux : anonymisées après 30 j |
| Mesures | Partage du lieu précis **désactivé par défaut** ; mode invisible ; pas de stockage de trajectoire ; identifiant BLE aléatoire |

## T3 — Proximité Bluetooth (optionnelle)

| Champ | Valeur |
|---|---|
| Finalité | (a) fonctionnement des fonctions de présence hors réseau ; (b) départage GPS entre lieux très proches |
| Base légale | Consentement **explicite et distinct** (réglage dédié, désactivé par défaut) |
| Personnes concernées | Utilisateurs ayant explicitement activé la proximité Bluetooth |
| Catégories de données | Identifiant technique aléatoire et temporaire (rotation 10 min) — jamais l'identifiant de compte, le nom ou l'email |
| Destinataires | Hébergeur |
| Transferts hors UE | Non |
| Durée de conservation | Détections serveur : **30 minutes** puis effacement automatique définitif |
| Mesures | Identifiant non ré-identifiable ; jamais utilisé pour un historique de déplacements ; non visible des autres utilisateurs |

## T4 — Fonctionnalités sociales et messagerie

| Champ | Valeur |
|---|---|
| Finalité | Faire fonctionner les demandes d'abonnement, blocages, conversations, croisements |
| Base légale | Exécution du contrat |
| Personnes concernées | Utilisateurs |
| Catégories de données | Follows, blocages, messages (texte, photos, vidéos), croisements (`CrossedPath`) |
| Destinataires | Destinataires des messages ; hébergeur |
| Transferts hors UE | Non (médias hébergés OVH) |
| Durée de conservation | Compte actif ; **à préciser pour les croisements** (fenêtre de rétention `CrossedPath`) |
| Mesures | HTTPS ; accès interne restreint ; **à faire : modération d'image à l'upload, chiffrement au repos des médias privés** |

## T5 — Modération et signalements

| Champ | Valeur |
|---|---|
| Finalité | Sécurité de la communauté, respect des CGU, traitement des contenus illicites (DSA) |
| Base légale | Intérêt légitime ; obligation légale (DSA) |
| Personnes concernées | Auteurs et cibles de signalements |
| Catégories de données | Catégorie/motif/description du signalement, historique d'avertissements et de suspensions (`moderation.*`) |
| Destinataires | Modérateurs et administrateurs (rôle vérifié serveur) ; le cas échéant, autorités |
| Transferts hors UE | Non |
| Durée de conservation | *(à définir — ex. 1 an après clôture, ou durée du compte)* |
| Mesures | Accès réservé aux rôles `moderator`/`admin` (contrôle serveur) ; **à faire : journal d'audit des actions de modération** |

## T6 — Statistiques d'usage internes

| Champ | Valeur |
|---|---|
| Finalité | Statistiques de visibilité du profil (Premium), calcul de la popularité et des étoiles des lieux, amélioration du service |
| Base légale | Consentement (préférence analytics) pour les stats individuelles ; intérêt légitime pour les agrégats |
| Personnes concernées | Utilisateurs |
| Catégories de données | Vues de profil, clics sur réseaux sociaux, recherches, visites de lieux |
| Destinataires | Hébergeur |
| Transferts hors UE | Non |
| Durée de conservation | Vues de profil ~30 j ; visites de lieux anonymisées à 30 j |
| Mesures | Préférence désactivable ; « Do Not Sell » (CCPA) exposé |

## T7 — Notifications push

| Champ | Valeur |
|---|---|
| Finalité | Informer de l'activité liée au compte (message, vue de profil, résumé, alertes modération) |
| Base légale | Consentement |
| Personnes concernées | Utilisateurs ayant autorisé les notifications |
| Catégories de données | Jeton d'appareil (FCM / Expo) |
| Destinataires | **Firebase Cloud Messaging (Google)**, **Expo** |
| Transferts hors UE | **Oui (États-Unis)** — encadrement DPF / clauses types à documenter |
| Durée de conservation | Tant que le jeton est valide / le compte actif |
| Mesures | Préférences de notification par type ; désactivation possible |

## T8 — Abonnement Premium et achats

| Champ | Valeur |
|---|---|
| Finalité | Gérer l'abonnement Premium et les achats (boosts, superlikes) |
| Base légale | Exécution du contrat |
| Personnes concernées | Utilisateurs souscrivant un abonnement / effectuant un achat |
| Catégories de données | Statut de l'achat (actif/expiré/annulé) associé à l'identifiant de compte — **jamais** de coordonnées bancaires |
| Destinataires | **RevenueCat** (mobile), **Stripe** (site web), App Store / Google Play |
| Transferts hors UE | **Oui (États-Unis)** — DPF / clauses types |
| Durée de conservation | Durée de la relation contractuelle + obligations comptables (**à préciser**) |
| Mesures | Paiement traité par la plateforme / le prestataire ; réception du seul statut |

## T9 — Parrainage

| Champ | Valeur |
|---|---|
| Finalité | Attribuer les récompenses de parrainage |
| Base légale | Exécution du contrat / intérêt légitime |
| Personnes concernées | Parrains et filleuls |
| Catégories de données | Code de parrainage, lien parrain↔filleul, historique |
| Destinataires | Hébergeur |
| Transferts hors UE | Non |
| Durée de conservation | Durée du compte |

---

## À compléter
- [ ] Fenêtre de rétention des croisements (`CrossedPath`)
- [ ] Politique de rotation / rétention des **logs serveur**
- [ ] Durée de conservation des **signalements** après clôture
- [ ] Durée de conservation des **données de facturation** (obligations comptables : ~10 ans en France)
- [ ] Politique de **sauvegarde** (fréquence, rétention, chiffrement, test de restauration)
- [ ] Décision **DPO** (cf. DPO-DSA-STRUCTURE.md)
