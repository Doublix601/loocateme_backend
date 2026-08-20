// Logs de debug pour les chemins chauds (heartbeat, getNearbyUsers) : en
// production ces routes sont appelées en continu par chaque utilisateur actif
// (heartbeat toutes les 30-90s, liste toutes les 10-15s), donc un
// console.log inconditionnel par appel ajoute une écriture stdout synchrone
// par requête sur chaque worker PM2 — coût cumulé non négligeable sous
// charge, en plus de bruiter les logs. Désactivé par défaut ; activable via
// LOG_LEVEL=debug pour investiguer en dev/staging.
const DEBUG_ENABLED = process.env.LOG_LEVEL === 'debug';

export function debugLog(...args) {
  if (DEBUG_ENABLED) console.log(...args);
}
