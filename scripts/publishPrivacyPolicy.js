// Publishes POLICY_PRIVACY.md as a new privacy policy version via the admin API.
// Usage:
//   API_BASE_URL=https://api.loocate.me ADMIN_TOKEN=<bearer> CHANGE_TYPE=major \
//   CHANGELOG="Résumé des changements..." node scripts/publishPrivacyPolicy.js
//
// CHANGE_TYPE must be 'major' (blocks the app until re-accepted, emails everyone)
// or 'minor' (emails everyone, non-blocking dismissible banner). This never
// touches the database directly — it goes through PUT /api/gdpr/policy so the
// usual version auto-increment, requiresConsent derivation, and mass-email
// batch job (drained by the existing cron) all apply exactly as they would
// from any other admin client.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE_URL = process.env.API_BASE_URL;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const CHANGE_TYPE = process.env.CHANGE_TYPE;
const CHANGELOG = process.env.CHANGELOG || '';
const VERSION = process.env.VERSION; // optional override, e.g. "2.0"

if (!API_BASE_URL) { console.error('Missing API_BASE_URL'); process.exit(1); }
if (!ADMIN_TOKEN) { console.error('Missing ADMIN_TOKEN (bearer access token of an admin user)'); process.exit(1); }
if (CHANGE_TYPE !== 'major' && CHANGE_TYPE !== 'minor') { console.error("CHANGE_TYPE must be 'major' or 'minor'"); process.exit(1); }
if (!CHANGELOG.trim()) { console.error('Missing CHANGELOG (summary of what changed, sent in the notification email)'); process.exit(1); }

const policyPath = path.join(__dirname, '..', 'POLICY_PRIVACY.md');
const content = fs.readFileSync(policyPath, 'utf8');

const body = { content, changelog: CHANGELOG, changeType: CHANGE_TYPE };
if (VERSION) body.version = VERSION;

const res = await fetch(`${API_BASE_URL.replace(/\/$/, '')}/api/gdpr/policy`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_TOKEN}` },
  body: JSON.stringify(body),
});

const json = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Failed (${res.status}):`, json);
  process.exit(1);
}
console.log('Published:', json);
