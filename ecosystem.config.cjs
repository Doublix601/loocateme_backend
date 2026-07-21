// Config PM2 pour exploiter les vCPU disponibles (le process Node est
// mono-thread par défaut : sans clustering, 3 des 4 coeurs restent inutilisés).
module.exports = {
  apps: [
    {
      name: 'loocateme-api',
      script: 'src/server.js',
      instances: process.env.PM2_INSTANCES || 'max',
      exec_mode: 'cluster',
      // pm2-runtime reste au premier plan (nécessaire dans un conteneur Docker,
      // contrairement à `pm2 start` qui daemonize).
    },
  ],
};
