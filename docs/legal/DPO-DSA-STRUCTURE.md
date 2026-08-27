# DPO, DSA et structure juridique — notes pour arbitrage — LoocateMe

> **Statut : notes d'orientation, pas un avis juridique.**
> Ces trois points demandent une décision — deux avec un juriste RGPD/tech,
> le troisième avec un comptable. Une consultation d'1 à 2 h suffit probablement.

---

## 1. Délégué à la protection des données (DPO) — art. 37 RGPD

### La règle
Un DPO est **obligatoire** si :
- (a) le traitement est réalisé par une autorité publique → non ;
- (b) **les activités de base** consistent en un **suivi régulier et systématique
  à grande échelle** des personnes → **discutable, penche vers oui** ;
- (c) les activités de base portent sur des données sensibles à grande échelle → non
  a priori (pas de données de santé/opinion ; l'orientation n'est pas collectée
  explicitement).

### L'analyse pour LoocateMe
L'activité de base *est* le suivi de localisation en temps réel de tous les
utilisateurs. « Régulier et systématique » : oui (transmission périodique de la
position). « Grande échelle » : dépend du **nombre d'utilisateurs**, de la
**couverture géographique** (l'app est distribuée dans ~29 pays / langues) et de la
**durée**. Aujourd'hui, en phase de lancement, l'argument « pas encore à grande
échelle » est tenable ; il s'affaiblit à mesure que la base grandit.

### Recommandation
- Faire **qualifier l'obligation par un juriste** (question précise : « nos activités
  de base relèvent-elles de l'art. 37(1)(b) compte tenu du volume actuel et prévu ? »).
- **Si requis** (ou en cas de doute, par prudence) : désigner un **DPO externe /
  mutualisé** — pratique courante et peu coûteuse pour une micro-entreprise (quelques
  centaines d'euros/an). Le DPO doit être **indépendant**, sans conflit d'intérêt :
  **Arnaud Theret ne peut pas être son propre DPO** puisqu'il décide des finalités.
- **Formalités si désignation** : déclaration à la CNIL (formulaire en ligne),
  publication du contact dans la politique de confidentialité, association du DPO à
  l'AIPD.

---

## 2. Digital Services Act (DSA)

LoocateMe est un **service d'hébergement** + une **plateforme en ligne** (contenu
généré par les utilisateurs, mise en relation).

### Ce dont une micro/petite entreprise est EXEMPTÉE (art. 19)
< 50 salariés **et** < 10 M€ de CA → dispensé des obligations lourdes « plateforme » :
- système interne de traitement des réclamations (art. 20) ;
- règlement extrajudiciaire des litiges (art. 21) ;
- priorité aux signaleurs de confiance (art. 22) ;
- rapports de transparence (art. 15, 24) ;
- base de données des décisions de modération (art. 24(5)) ;
- transparence des systèmes de recommandation, registre publicitaire.

### Ce qui RESTE applicable (service d'hébergement, toute taille)
| Obligation | État LoocateMe | À faire |
|---|---|---|
| CGU claires, mentionnant les restrictions de contenu et les pratiques de modération (art. 14) | CGU existantes | **Vérifier** qu'elles listent explicitement les contenus/comportements interdits (harcèlement, contenu sexuel non consenti, mineurs, etc.) et la procédure de retrait |
| Mécanisme de notification et action (art. 16) | Signalement in-app présent ✓ | Documenter le délai de traitement |
| Exposé des motifs à l'utilisateur dont le contenu est retiré/restreint (art. 17) | *(à vérifier — l'utilisateur banni/averti reçoit-il un motif ?)* | Ajouter si absent |
| **Point de contact pour les autorités** (art. 11) et **pour les utilisateurs** (art. 12) | contact@loocate.me pour les utilisateurs | **Publier** une adresse de contact « autorités » (peut être la même) et la référencer publiquement |
| Signalement aux autorités en cas de soupçon d'infraction grave menaçant la vie/sécurité (art. 18) | — | Définir une procédure interne |

### Le point sensible : protection des mineurs (art. 28)
La Commission (lignes directrices du 14/07/2025, position d'octobre 2025) pousse
l'art. 28 **vers les petites plateformes aussi**. L'art. 28 impose un « haut niveau de
protection de la vie privée, de sûreté et de sécurité des mineurs », et les lignes
directrices citent nommément :
- comptes **privés par défaut** pour prévenir le contact non sollicité ;
- **blocage/mute** faciles ;
- **désactivation par défaut** pour les mineurs des mécaniques d'engagement :
  **séries (« streaks »)**, contenu éphémère, accusés de lecture, notifications push.

**LoocateMe a une série quotidienne (« Ta série »).**

**Porte de sortie** : si l'app dispose d'une **vérification d'âge effective** et n'a
réellement aucun mineur, elle n'est pas « accessible aux mineurs » au sens de l'art. 28.
Or la vérification actuelle est **purement déclarative** (Didit retiré). → **Deux options** :
1. Réintroduire une vérification d'âge robuste (age estimation ou vérification) — ce qui
   neutralise aussi ce volet DSA ;
2. Assumer que l'app est « accessible aux mineurs » et appliquer les mesures art. 28
   (compte privé par défaut, streaks off par défaut, etc.) — plus lourd produit.

### Recommandation
Faire cadrer par un juriste : (a) le périmètre exact des obligations DSA applicables à
la taille actuelle, (b) l'exposition art. 28 compte tenu du choix de vérification d'âge.

---

## 3. Structure juridique : entreprise individuelle vs société

### Situation actuelle
Exploitation en **entreprise individuelle** (micro-entreprise). C'est **légal**.
Depuis la loi du 14/02/2022, le **patrimoine personnel de l'entrepreneur individuel
est séparé de plein droit** du patrimoine professionnel, ce qui limite déjà le risque
sur les biens personnels.

### Points d'attention pour ce type de service
- **Responsabilité** : une app grand public traitant de la géolocalisation temps réel,
  exposée RGPD (sanctions jusqu'à 20 M€ / 4 % CA) et DSA, avec un risque produit de
  sécurité des personnes (traque), concentre le risque sur une seule personne physique.
- **Assurance** : souscrire une **RC professionnelle** couvrant la responsabilité du
  fait des services numériques / la violation de données (cyber). Vérifier les
  exclusions (contenu illicite, atteinte à la vie privée).
- **Crédibilité / financement / cession** : une **SASU** (ou SARL) isole mieux la
  responsabilité, facilite l'entrée d'investisseurs, la cession du fonds, et
  professionnalise les relations avec Apple/Google/prestataires.
- **Comptabilité** : au-delà des seuils micro (CA), passage au réel obligatoire de
  toute façon.

### Recommandation
Arbitrer avec un **expert-comptable** le passage en SASU/SARL, idéalement **avant**
une croissance significative de l'audience ou une levée de fonds. À court terme :
souscrire une RC pro + cyber.

---

## Récapitulatif des décisions à prendre
| Sujet | Décideur | Échéance suggérée |
|---|---|---|
| DPO requis ? désignation d'un DPO externe | Juriste RGPD | Avant montée en charge |
| Périmètre DSA + exposition art. 28 (mineurs) | Juriste tech | Avant mise en avant stores |
| Vérification d'âge : réintroduire ou assumer | Responsable de traitement | Avant lancement large |
| Passage en société + RC pro/cyber | Expert-comptable | Avant croissance / levée |
