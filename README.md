LoocateMe Backend (Node.js + MongoDB + Redis)

Résumé
- Backend pour l’application mobile loocateme-app.
- Express + Mongoose (MongoDB) pour les profils et données persistantes.
- Index géospatial 2dsphere pour requêtes "autour de moi".
- Redis GEO pour cache temps réel des positions et recherche ultra rapide.
- Authentification sécurisée (bcrypt, JWT access + refresh cookie httpOnly).
- Architecture et déploiement scalables (Docker, recommandations Kubernetes).
 - Envoi d’emails (SMTP OVH) pour vérification d’email et réinitialisation de mot de passe par lien sécurisé.

1) Veille technologique et choix d’architecture

Base de données principale
- MongoDB (répliqué et shardé) est un excellent choix pour:
  - Profils utilisateurs flexibles (schéma évolutif)
  - Index géospatial 2dsphere natif pour $near, $geoWithin
  - Scalabilité horizontale via le sharding (clé: userId, région ou hash)
- Alternative SQL: PostgreSQL + PostGIS pour des fonctionnalités géo avancées; très robuste, mais plus verbeux côté requêtes. 
- Alternative in-memory: Redis comme base chaude des positions (Redis GEO). Idéal pour fortes cadences d’écriture/lecture temps réel, avec persistance secondaire dans MongoDB.

Géolocalisation et gestion de la position
- Écriture de position: écrire dans MongoDB et Redis GEO (clé geo:users) pour servir le temps réel.
- Lecture "autour de moi":
  - Lecture d’abord via Redis GEO (GEORADIUS via GEOSEARCH) pour rapidité
  - Fallback vers MongoDB avec $near si Redis indisponible
- Index: 2dsphere sur users.location.

Scalabilité (1M d’utilisateurs simultanés)
- API stateless + JWT, horizontal scaling derrière un load balancer.
- DB: MongoDB sharded cluster (3+ shards), WiredTiger, bons index; TTL/archivage des positions anciennes si nécessaire.
- Cache: Redis cluster (cluster mode), co-localisation régionale.
- Messaging (optionnel): Kafka/PubSub pour diffusion d’événements (tracking, analytics), séparation des charges.
- Stockage d’images: S3/GCS + CDN; ici, un stockage local est fourni pour le dev.
- Observabilité: Prometheus/Grafana, ELK/Opensearch, tracing (OpenTelemetry).

Conteneurisation et orchestration
- Docker: fourni (Dockerfile + docker-compose).
- Kubernetes (recommandé en prod):
  - HPA (autoscaling), PDB, readiness/liveness probes (/health)
  - MongoDB/Redis managés (Atlas, MemoryDB/Elasticache, etc.)
  - Ingress + TLS, secrets via Secret Manager.

Cache positions (Redis)
- Redis GEO pour un TOP-N voisinage rapide. TTL court (ex. 5–30s) conseillé si vous stockez des positions éphémères.

2) Démarrage rapide

Prérequis
- Node.js >= 18
- Docker (facultatif mais recommandé pour l’environnement complet)

Configuration
- Copiez .env.example en .env et adaptez les variables si besoin.

Démarrer avec Docker
- cd loocateme_backend
- docker-compose up --build
- Backend: http://localhost:4000

Démarrer en local (sans Docker)
- cd loocateme_backend
- npm install
- npm run db:init
- npm run dev

3) Structure du projet

src/
- config/: mongo.js, redis.js
- controllers/: logique HTTP
- middlewares/: auth, validators, error handler
- models/: User (avec index 2dsphere), RefreshToken
- routes/: auth, users, profile, social, settings
- services/: auth, user (géolocalisation), profile, social, storage (multer)
- server.js: point d’entrée
scripts/
- db-init.js: crée les indexes (dont 2dsphere)

4) Sécurité et Authentification
- Mots de passe hashés (bcrypt).
- JWT Access (header Authorization: Bearer ...) + JWT Refresh en cookie httpOnly.
- Refresh rotation basique via modèle RefreshToken.
- CORS configurable.

5) Modèle de données (User)
- email (unique), password
- name, bio, profileImageUrl, isVisible
- location: GeoJSON Point [lon, lat] + updatedAt
- socialNetworks: [{ type: instagram|facebook|x|snapchat|tiktok|linkedin, handle }]

6) API REST (exemples)
Base URL: http://localhost:4000/api

Auth
- POST /auth/signup { email, password, username, firstName?, lastName?, customName? } -> { user, accessToken }
- POST /auth/login { email, password } -> { user, accessToken }
- POST /auth/refresh -> { accessToken } (utilise cookie refreshToken)
- POST /auth/logout (auth)
- POST /auth/forgot-password { email } -> { success } (envoie un email avec un lien de réinitialisation)
- GET  /auth/verify-email?token=... -> redirige vers APP_PUBLIC_URL avec emailVerified=1 si succès
- POST /auth/verify-email { token } -> { success, user }
- GET  /auth/reset-password?token=... -> affiche une page HTML pour définir le nouveau mot de passe (password + confirm)
- POST /auth/reset-password { token, password, confirm } (formulaire HTML) -> met à jour le mot de passe

Notes:
- L'email est conservé strictement tel que saisi (pas de suppression des points ni des sous-adresses pour Gmail/Outlook/Yahoo/iCloud).
- Unicité par email: lors du signup, si un compte existe déjà avec le même email, l'API renvoie 409 (EMAIL_TAKEN) et ne supprime aucun compte existant.

Utilisateurs & géolocalisation
- POST /users/location (auth)
  body: { lat: number, lon: number }
- GET /users/nearby?lat=..&lon=..&radius=300 (auth) -> { users: [...] }
  radius en mètres (1..1000, défaut 300)
- GET /users/by-email?email=alice@example.com (auth) -> { users: [...] } (password exclu)
  - Supporte plusieurs emails via virgules ou paramètres répétés:
    - /users/by-email?email=alice@example.com,bob@example.com
    - /users/by-email?email=alice@example.com&email=bob@example.com

Profil
- PUT /profile (auth) body: { name?, bio? }
- POST /profile/photo (auth) form-data: photo=<fichier image> -> { user }
  - Types acceptés: JPEG, PNG, WEBP, GIF (<= 5 Mo)
  - La réponse contient user.profileImageUrl (URL absolue). Si aucun fichier n’est envoyé ou type non supporté -> 400.

Réseaux sociaux
- PUT /social (auth) body: { type, handle }
- DELETE /social/:type (auth)

Paramètres
- PUT /settings/visibility (auth) body: { isVisible: boolean }

7) Validation et gestion des erreurs
- express-validator sur toutes les entrées.
- Middleware d’erreur centralisé.

8) Recommandations d’architecture (prod)
- MongoDB Atlas shardé, clés d’index adaptées aux requêtes critiques.
- Redis Cluster pour GEO et cache (clé geo:users), TTL court.
- CDN pour images; stockage objet (S3/GCS) + signatures présignées.
- Rate limiting (ex: NGINX/Cloudflare + Redis ou token bucket) pour endpoints sensibles.
- Observabilité: metrics, logs structurés, tracing.
- Blue/Green ou canary deploys sur Kubernetes.

9) Scripts et maintenance
- npm run db:init: crée les indexes sur MongoDB.
- Migration: utiliser des outils comme migrate-mongo ou Atlas Triggers si nécessaire.

Persistance des données (Docker)
- MongoDB et Redis utilisent désormais des volumes nommés (gérés par Docker) pour éviter toute suppression accidentelle liée au dossier du projet ou à des scripts Git.
- Détails:
  - Volume nommé: mongo_data -> monté sur /data/db (MongoDB)
  - Volume nommé: redis_data -> monté sur /data (Redis, AOF activé)
  - Dossier hôte: ./data/uploads -> monté sur /app/uploads (fichiers uploadés)
- Astuces:
  - Les volumes nommés ne sont pas affectés par les opérations Git (ex: reset --hard). Ils ne sont supprimés que via `docker volume rm` ou `docker compose down -v`.
  - Sauvegarde/restauration Mongo/Redis: `docker run --rm -v mongo_data:/data -v "$PWD":/backup alpine tar czf /backup/mongo_backup.tgz -C / data` (adapter pour Redis avec redis_data).
  - Sauvegarde/restauration uploads: compressez le dossier `./data/uploads` (ex: `tar czf uploads_backup.tgz -C data uploads`).

Notes
 - Photo de profil: si aucune image fournie, le front peut afficher une image par défaut. Vous pouvez aussi définir BASE_URL/uploads/default.png si vous déposez une image par défaut dans uploads/.

Configuration SMTP (emails transactionnels)
- Variables d’environnement supportées (ex: via docker-compose ou .env):
  - SMTP_HOST=ssl0.ovh.net
  - SMTP_PORT=465
  - SMTP_SECURE=true
  - SMTP_USER=no-reply@loocate.me
  - SMTP_PASS=<mot_de_passe>
  - SMTP_AUTH_METHOD=LOGIN | PLAIN (par défaut: LOGIN)
  - MAIL_FROM="LoocateMe <no-reply@loocate.me>"
  - BASE_URL (ex: http://localhost:4000) -> utilisé pour construire les liens dans les emails
  - APP_PUBLIC_URL (ex: http://localhost:19006) -> redirection après vérification email
  - EMAIL_VERIF_TOKEN_TTL=24h (durée de validité du lien de vérification)
  - PWD_RESET_TOKEN_TTL=1h (durée de validité du lien de réinitialisation)

Flux vérification email
1) Lors du signup, un token opaque est généré, hashé (SHA-256) et stocké avec une expiration.
2) Un email est envoyé à l’utilisateur avec un lien: {BASE_URL}/api/auth/verify-email?token=...
3) Au clic (GET), le token est validé; si succès, l’utilisateur est marqué emailVerified=true, le token est invalidé, puis redirection vers APP_PUBLIC_URL avec emailVerified=1.
4) Alternative API: POST /api/auth/verify-email { token } renvoie JSON.

Flux réinitialisation de mot de passe
1) POST /api/auth/forgot-password { email }: si un compte existe, un token de reset hashé/expirant est stocké et un email est envoyé avec le lien {BASE_URL}/api/auth/reset-password?token=...
2) GET /api/auth/reset-password affiche un formulaire HTML minimal (password + confirm).
3) POST /api/auth/reset-password applique le nouveau mot de passe, invalide le token et confirme l’opération.

Sécurité
- Les tokens envoyés par email sont opaques côté client et stockés hashés côté serveur (SHA-256) avec TTL strict.
- Les réponses à forgot-password ne divulguent pas l’existence d’un email.
- Les mots de passe sont hashés par bcrypt via un hook Mongoose pre-save.

Problèmes courants SMTP OVH et dépannage
- 535 5.7.1 Authentication failed:
  - Vérifiez que SMTP_USER est l’adresse complète (ex: no-reply@loocate.me) et que SMTP_PASS est correct (testez via le webmail OVH).
  - Essayez d’alterner la méthode d’authentification: SMTP_AUTH_METHOD=LOGIN (recommandé), ou PLAIN si nécessaire.
  - Testez plusieurs combinaisons d’hôte/port: ssl0.ovh.net:465 (SSL), ssl0.ovh.net:587 (STARTTLS), smtp.mail.ovh.net:465, smtp.mail.ovh.net:587.
  - Redémarrez le backend et utilisez /api/admin/smtp-status et /api/admin/test-email pour diagnostiquer.
- Délivrabilité faible (mails reçus en spam ou non reçus):
  - Vérifiez vos enregistrements DNS: SPF (include:mx.ovh.com), DKIM activé chez OVH, DMARC (même permissif p=none) conseillé.
  - Utilisez une adresse d’expéditeur MAIL_FROM alignée sur le domaine (ex: « LoocateMe <no-reply@loocate.me> »).

Sécurité (IMPORTANT)
- Les logs fournis montrent des connexions à MongoDB depuis des IP externes et l’exécution de dropDatabase, ainsi que des tentatives d’attaque sur Redis. Cela arrive lorsque Mongo/Redis sont exposés à Internet sans authentification.
- Le docker-compose a été durci pour corriger cela:
  - MongoDB: authentification activée, création d’un utilisateur applicatif (scripts/mongo-init.js), plus d’exposition de port vers l’hôte.
  - Redis: mot de passe requis et non exposé publiquement.
  - L’API est la seule à accéder à Mongo/Redis via le réseau interne Docker.
- Variables à définir (ex: dans un fichier .env exporté dans l’environnement shell avant docker compose up):
  - MONGO_ROOT_PASSWORD=mot_de_passe_admin_fort
  - MONGO_APP_PASSWORD=mot_de_passe_app_fort
  - REDIS_PASSWORD=mot_de_passe_redis_fort
- Connexions côté API (déjà configurées via variables d’environnement):
  - MONGODB_URI=mongodb://appuser:${MONGO_APP_PASSWORD}@mongo:27017/loocateme
  - REDIS_URL=redis://default:${REDIS_PASSWORD}@redis:6379
- Migration/rotation:
  1) Si vous utilisiez des données existantes sur un volume non authentifié, sauvegardez d’abord (si encore disponible).
  2) Définissez les variables ci-dessus, puis relancez: docker compose down && docker compose up -d --build.
  3) Vérifiez que Mongo/Redis ne sont pas exposés (aucun mapping de port 27017/6379). Utilisez un pare-feu/Security Group pour n’autoriser que le port 4000 (API).
