// Config PM2 pour exploiter les vCPU disponibles (le process Node est
// mono-thread par défaut : sans clustering, 3 des 4 coeurs restent inutilisés).
const PM2_INSTANCES = process.env.PM2_INSTANCES || 'max';

module.exports = {
  apps: [
    {
      name: 'loocateme-api',
      script: 'src/server.js',
      instances: PM2_INSTANCES,
      exec_mode: 'cluster',
      // pm2-runtime reste au premier plan (nécessaire dans un conteneur Docker,
      // contrairement à `pm2 start` qui daemonize).
      // Transmis explicitement à chaque worker (PM2 ne le fait pas tout seul)
      // pour que src/config/mongo.js dérive maxPoolSize du même nombre de
      // workers que celui réellement configuré ici — évite que les deux
      // valeurs dérivent l'une de l'autre si l'une des deux est changée sans
      // l'autre.
      env: { PM2_INSTANCES },
    },
  ],
};
