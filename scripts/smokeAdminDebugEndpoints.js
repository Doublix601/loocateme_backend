// Smoke test des endpoints /api/admin ajoutés pour le DebugScreen.
// Crée des documents jetables (admin + user cible + lieu), exerce chaque
// endpoint via HTTP réel contre le serveur local, vérifie les effets en base,
// puis nettoie tout. Ne touche à aucun compte réel.
//
//   docker exec -w /app loocateme-api node scripts/smokeAdminDebugEndpoints.js
//
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import { User } from '../src/models/User.js';
import { Location } from '../src/models/Location.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGO_URI =
  process.env.MONGODB_URI_LOCAL || process.env.MONGODB_URI || 'mongodb://mongo:27017/loocateme';
const BASE = `http://127.0.0.1:${process.env.PORT || 4000}/api`;

let failures = 0;
const check = (label, cond, extra) => {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
};

async function api(method, pathname, token, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch (_) {}
  return { status: res.status, json };
}

async function run() {
  await mongoose.connect(MONGO_URI);
  const stamp = Date.now();

  const admin = await User.create({
    email: `smoke-admin-${stamp}@example.invalid`,
    username: `smokeadmin${stamp}`,
    role: 'admin',
    password: 'x',
    birthdate: new Date('1990-01-01'),
  });
  const target = await User.create({
    email: `smoke-user-${stamp}@example.invalid`,
    username: `smokeuser${stamp}`,
    password: 'x',
    birthdate: new Date('1990-01-01'),
    // compte en mode invisible : doit rester trouvable via la recherche admin
    status: 'red',
    invisibleMode: true,
  });
  const location = await Location.create({
    name: `Smoke Venue ${stamp}`,
    type: 'TEST 🤖',
    ownerId: target._id,
    location: { type: 'Point', coordinates: [2.35, 48.85] },
  });

  const token = jwt.sign({}, process.env.JWT_ACCESS_SECRET, {
    subject: admin._id.toString(),
    expiresIn: '10m',
  });

  try {
    // 0. recherche modération : le compte invisible doit remonter
    let r = await api('GET', `/admin/users/search?q=smokeuser${stamp}`, token);
    check(
      'search admin trouve le compte invisible',
      r.status === 200 && r.json?.users?.some((u) => String(u._id) === String(target._id)),
      `status ${r.status}, ${r.json?.users?.length} résultats`,
    );
    r = await api('GET', `/admin/users/search?q=${target._id}`, token);
    check('search admin par ObjectId', r.status === 200 && String(r.json?.users?.[0]?._id) === String(target._id));
    r = await api('GET', `/admin/users/search?q=a`, token);
    check('search admin < 2 caractères -> 400', r.status === 400);

    // 1. premium
    r = await api('PATCH', `/admin/users/${target._id}/premium`, token, {
      isPremium: true,
      premiumSource: 'promo',
      premiumExpiresAt: new Date(Date.now() + 3600e3).toISOString(),
    });
    check('PATCH premium -> 200', r.status === 200, `status ${r.status}`);
    let fresh = await User.findById(target._id).lean();
    check('premium appliqué en base', fresh.isPremium === true && fresh.premiumSource === 'promo');

    r = await api('PATCH', `/admin/users/${target._id}/premium`, token, { premiumSource: 'bogus' });
    check('premiumSource invalide -> 400', r.status === 400, `status ${r.status}`);

    // 2. consumables
    r = await api('POST', `/admin/users/${target._id}/consumables`, token, { mode: 'set', boost: 5, superlike: 2 });
    check('POST consumables set -> 200', r.status === 200 && r.json?.boostBalance === 5 && r.json?.superlikeBalance === 2);
    r = await api('POST', `/admin/users/${target._id}/consumables`, token, { mode: 'add', boost: -10 });
    check('consumables add plancher 0', r.json?.boostBalance === 0, `boost ${r.json?.boostBalance}`);

    // 3. account-flags
    r = await api('PATCH', `/admin/users/${target._id}/account-flags`, token, { invisibleMode: true, checkInMode: 'manual' });
    check('PATCH account-flags -> 200', r.status === 200);
    fresh = await User.findById(target._id).lean();
    check('flags appliqués en base', fresh.invisibleMode === true && fresh.checkInMode === 'manual');
    r = await api('PATCH', `/admin/users/${target._id}/account-flags`, token, { checkInMode: 'nope' });
    check('checkInMode invalide -> 400', r.status === 400);

    // 4. business get
    r = await api('GET', `/admin/users/${target._id}/business`, token);
    check('GET business -> 200 avec lieu', r.status === 200 && String(r.json?.location?._id) === String(location._id));

    // 5. business tier (pas d abo Stripe -> pas de garde-fou)
    r = await api('PATCH', `/admin/business/${location._id}/tier`, token, { businessTier: 'pro3', grantProOffers: true });
    check('PATCH tier pro3 -> 200', r.status === 200 && r.json?.location?.businessTier === 'pro3');
    let loc = await Location.findById(location._id).lean();
    check('businessTier + proOffers en base', loc.businessTier === 'pro3' && loc.proOffers?.proBoostBalance === 3);
    check('subscription.status = active + currentPeriodEnd futur', loc.subscription?.status === 'active' && new Date(loc.subscription.currentPeriodEnd) > new Date());

    r = await api('PATCH', `/admin/business/${location._id}/tier`, token, { businessTier: 'zzz' });
    check('tier invalide -> 400', r.status === 400);

    // garde-fou Stripe
    await Location.findByIdAndUpdate(location._id, {
      'subscription.stripeSubscriptionId': 'sub_smoke',
      'subscription.status': 'active',
    });
    r = await api('PATCH', `/admin/business/${location._id}/tier`, token, { businessTier: 'pro1' });
    check('tier avec abo Stripe actif -> 409', r.status === 409 && r.json?.code === 'STRIPE_SUBSCRIPTION_ACTIVE');
    r = await api('PATCH', `/admin/business/${location._id}/tier`, token, { businessTier: 'pro1', force: true });
    check('tier force:true -> 200', r.status === 200 && r.json?.location?.businessTier === 'pro1');

    // 6. business boosts clamp
    r = await api('POST', `/admin/business/${location._id}/boosts`, token, { mode: 'set', ultra: 99, pro: 99, event: 99 });
    check(
      'boosts clampés aux caps (1/3/1)',
      r.json?.proOffers?.ultraBoostBalance === 1 && r.json?.proOffers?.proBoostBalance === 3 && r.json?.proOffers?.eventBoostBalance === 1,
      JSON.stringify(r.json?.proOffers),
    );

    // 7. gating admin : token d un non-admin
    const userToken = jwt.sign({}, process.env.JWT_ACCESS_SECRET, { subject: target._id.toString(), expiresIn: '10m' });
    r = await api('GET', `/admin/users/${target._id}/business`, userToken);
    check('non-admin -> 403', r.status === 403, `status ${r.status}`);
  } finally {
    await User.deleteMany({ _id: { $in: [admin._id, target._id] } });
    await Location.deleteOne({ _id: location._id });
    await mongoose.disconnect();
  }

  console.log(failures === 0 ? '\nSMOKE OK' : `\nSMOKE FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
