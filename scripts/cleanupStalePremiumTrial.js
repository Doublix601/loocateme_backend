// Nettoyage unique lié au fix de l'essai maison Premium.
//
// Contexte : `premiumTrialEnd` n'était jamais remis à null en perdant Premium,
// et aucun cron n'expirait l'essai 7 jours. Résultats en base :
//   (A) comptes isPremium:false mais premiumTrialEnd futur → l'ancien fallback
//       `premiumTrialEnd > now` les traitait encore comme Premium (rayon 30 km).
//   (B) comptes isPremium:true dont l'essai est fini depuis longtemps →
//       "coincés" Premium à vie.
// Le helper hasActivePremium ne lit plus premiumTrialEnd (fix), donc (A) est
// déjà neutralisé côté entitlement ; ce script remet quand même les champs
// propres. (B) est corrigé ici pour les essais explicites (premiumSource:'trial')
// et le nouveau cron s'en chargera ensuite tout seul.
//
//   docker exec -w /app loocateme-api node scripts/cleanupStalePremiumTrial.js
//
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { User } from '../src/models/User.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MONGODB_URI =
  process.env.MONGODB_URI_LOCAL || process.env.MONGODB_URI || 'mongodb://mongo:27017/loocateme';

async function run() {
  console.log('--- Cleanup stale premium trial ---');
  await mongoose.connect(MONGODB_URI);
  const now = new Date();

  // (B) Essais explicites déjà expirés mais encore Premium.
  const stuck = await User.updateMany(
    { isPremium: true, premiumSource: 'trial', premiumTrialEnd: { $lte: now } },
    { $set: { isPremium: false, premiumTrialEnd: null, planChangedAt: now } },
  );
  console.log(`(B) essais expirés repassés Free : ${stuck.modifiedCount}`);

  // (A) Comptes Free avec une date d'essai résiduelle (passée OU future : dans
  // les deux cas c'était la source de la fuite via l'ancien fallback) → nettoyage.
  const residual = await User.updateMany(
    { isPremium: false, premiumTrialEnd: { $ne: null } },
    { $set: { premiumTrialEnd: null, premiumExpiresAt: null } },
  );
  console.log(`(A) premiumTrialEnd résiduels nettoyés : ${residual.modifiedCount}`);

  // Signalement (pas de modif) : comptes isPremium:true, premiumSource absent,
  // essai fini — potentiellement coincés mais peut-être des abonnés payants
  // legacy (premiumSource null). À revoir à la main.
  const suspicious = await User.find({
    isPremium: true,
    premiumSource: { $in: [null, undefined] },
    premiumTrialEnd: { $lt: now },
    $or: [{ premiumExpiresAt: null }, { premiumExpiresAt: { $lt: now } }],
  })
    .select('email premiumTrialStart premiumTrialEnd premiumExpiresAt')
    .limit(50)
    .lean();
  if (suspicious.length) {
    console.log(`\n⚠️  ${suspicious.length} compte(s) isPremium:true sans premiumSource, essai fini — à vérifier manuellement :`);
    suspicious.forEach((u) => console.log('  ', u.email, '| trialEnd', u.premiumTrialEnd, '| expiresAt', u.premiumExpiresAt));
  } else {
    console.log('\nAucun compte suspect (isPremium:true sans source, essai fini).');
  }

  await mongoose.disconnect();
  console.log('--- Terminé ---');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
