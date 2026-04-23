# Politique de confidentialité (RGPD)

Dernière mise à jour: v1.1 (Audit Privacy by Design)

Nous respectons votre vie privée. Cette application collecte uniquement les données nécessaires au fonctionnement du service :

- Compte : email, mot de passe (hashé), nom, bio
- Localisation : uniquement si vous avez activé la visibilité et partagé la permission. 
  - **Minimisation des données** : Les coordonnées GPS précises ne sont plus stockées dès que vous êtes confirmé dans un lieu. Seul le nom du lieu est conservé pour la durée de votre présence.
  - **Expiration automatique** : Votre présence est automatiquement effacée après 30 minutes d'inactivité (si l'app n'envoie plus de "heartbeat").
- Médias : photo de profil uploadée par vous.
- Réseaux sociaux : identifiants renseignés par vous (ex: Instagram)

Utilisation :
- Affichage de votre profil aux autres utilisateurs à proximité (si visibilité activée)
- Fonctionnement de la messagerie et des fonctionnalités sociales

Conservation des données (Rétention) :
- Vos visites historiques sont anonymisées après 30 jours (suppression du lien avec votre profil).
- Les données de compte sont conservées tant que votre compte est actif.

Vos droits :
- Consentement explicite à l'utilisation de vos données (obligatoire pour utiliser l'app)
- **Do Not Sell (CCPA)** : Vous pouvez demander à ce que vos données ne soient pas vendues/partagées via les paramètres.
- Accès et portabilité : vous pouvez exporter vos données depuis l'app
- Rectification : vous pouvez modifier vos informations de profil
- Suppression : vous pouvez supprimer votre compte et toutes les données associées

Sécurité:
- Mots de passe hashés (bcrypt), tokens sécurisés (JWT)
- Communications via HTTPS (à configurer en production)
- Limitation des logs aux seules métadonnées techniques (pas de données sensibles dans les logs)

Contact:
Pour toute question concernant la confidentialité, contactez le support de l'application.
