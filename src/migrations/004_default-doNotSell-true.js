/**
 * Migration 004: LoocateMe ne vendant jamais les données utilisateurs, le réglage
 * CCPA "doNotSell" doit refléter cet état par défaut plutôt que laisser les comptes
 * existants sur `false` (valeur héritée de l'ancien défaut du schéma, jamais choisie
 * explicitement puisque le toggle n'était affiché comme "à activer" nulle part avant
 * ce correctif).
 *
 * Bascule tous les comptes ayant `privacyPreferences.doNotSell` à `false` ou absent
 * vers `true`.
 */

import { User } from '../models/User.js';

export async function migrate() {
  const result = await User.updateMany(
    { $or: [{ 'privacyPreferences.doNotSell': false }, { 'privacyPreferences.doNotSell': { $exists: false } }] },
    { $set: { 'privacyPreferences.doNotSell': true } },
  );
  console.log(`[004_default-doNotSell-true] ✅ Updated ${result.modifiedCount} user(s) to doNotSell: true.`);
}

export default migrate;
