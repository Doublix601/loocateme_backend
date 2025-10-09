LoocateMe Backend (Node.js + MongoDB + Redis)

Résumé
- Backend pour l’application mobile loocateme-app.
- Express + Mongoose (MongoDB) pour les profils et données persistantes.
- Index géospatial 2dsphere pour requêtes "autour de moi".
- Redis GEO pour cache temps réel des positions et recherche ultra rapide.
- Authentification sécurisée (bcrypt, JWT access + refresh cookie httpOnly).
- Architecture et déploiement scalables (Docker, recommandations Kubernetes).

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
- POST /auth/signup { email, password, name? } -> { user, accessToken }
- POST /auth/login { email, password } -> { user, accessToken }
- POST /auth/refresh -> { accessToken } (utilise cookie refreshToken)
- POST /auth/logout (auth)
- POST /auth/forgot-password { email } -> { success }

Notes:
- L'email est conservé strictement tel que saisi (pas de suppression des points ni des sous-adresses pour Gmail/Outlook/Yahoo/iCloud).
- Unicité par email: lors du signup, si des comptes existent déjà avec le même email, ils sont supprimés avant la création du nouveau compte (et leurs refresh tokens invalidés).

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
- POST /profile/photo (auth) form-data: photo=<fichier> -> { user }

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
- Les données MongoDB et Redis sont montées sur le disque hôte pour survivre aux redémarrages, rebuilds et `docker system prune`.
- Dossiers utilisés sur l’hôte:
  - ./data/mongo -> /data/db (MongoDB)
  - ./data/redis -> /data (Redis, AOF activé)
  - ./uploads -> /app/uploads (fichiers uploadés)
- Astuces:
  - Évitez `docker-compose down -v` qui supprime les volumes. Avec les bind mounts, vos données restent dans le repo.
  - Sauvegardez ces dossiers si besoin (backup/restore).

Notes
- Photo de profil: si aucune image fournie, le front peut afficher une image par défaut. Vous pouvez aussi définir BASE_URL/uploads/default.png si vous déposez une image par défaut dans uploads/.
