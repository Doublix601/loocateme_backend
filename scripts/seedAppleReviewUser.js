// Compte de démo pour la revue Apple (App Review) — abonnement Premium EXPIRÉ.
//
// Objectif : permettre au relecteur Apple de voir tout le parcours d achat,
// y compris l état "l abonnement a expiré, retour en Free" (guideline 2.1).
//
// Idempotent : relancer le script remet le compte dans l état attendu.
//
//   docker exec -w /app loocateme-api node scripts/seedAppleReviewUser.js
//
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { User } from "../src/models/User.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

const MONGO_URI =
  process.env.MONGODB_URI_LOCAL || process.env.MONGODB_URI || "mongodb://mongo:27017/loocateme";

const EMAIL = "apple.review@loocate.me";
const PASSWORD = "AppleReview_2026!Loo";

async function run() {
  await mongoose.connect(MONGO_URI);
  const now = new Date();
  const daysAgo = (n) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  const premiumFields = {
    isPremium: false,
    premiumSource: null,
    premiumTrialStart: daysAgo(60),
    premiumTrialEnd: daysAgo(5),
    premiumExpiresAt: daysAgo(5),
    boostBalance: 0,
    superlikeBalance: 0,
  };

  let user = await User.findOne({ email: EMAIL }).select("+password");
  if (!user) {
    user = new User({
      email: EMAIL,
      password: PASSWORD,
      username: "apple.review",
      name: "apple.review",
      firstName: "Apple",
      lastName: "Review",
      customName: "Apple Review",
      birthdate: new Date(1994, 0, 1),
      gender: "other",
      ageAttestedAt: now,
      emailVerified: true,
      status: "green",
      consent: { accepted: true, version: "apple-review", consentAt: now },
      lastUsernameChangeAt: now,
      lastFirstNameChangeAt: now,
      lastLastNameChangeAt: now,
      ...premiumFields,
    });
    await user.save();
    console.log("Créé:", EMAIL);
  } else {
    user.password = PASSWORD; // re-hashé par le hook pre-save
    user.emailVerified = true;
    user.consent = { accepted: true, version: "apple-review", consentAt: now };
    if (!user.ageAttestedAt) user.ageAttestedAt = now;
    Object.assign(user, premiumFields);
    if (user.moderation) {
      user.moderation.bannedPermanent = false;
      user.moderation.bannedUntil = null;
    }
    await user.save();
    console.log("Mis à jour:", EMAIL);
  }

  console.log("\n--- Identifiants App Review ---");
  console.log("Email    :", EMAIL);
  console.log("Password :", PASSWORD);
  console.log("isPremium:", user.isPremium, "| premiumTrialEnd:", user.premiumTrialEnd);
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
