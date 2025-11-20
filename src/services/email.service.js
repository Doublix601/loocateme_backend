import nodemailer from 'nodemailer';

const smtpHost = process.env.SMTP_HOST || 'ssl0.ovh.net';
const smtpPort = Number(process.env.SMTP_PORT || 465);
const smtpSecure = String(process.env.SMTP_SECURE || 'true') === 'true';
const smtpUser = process.env.SMTP_USER || 'no-reply@loocate.me';
const smtpPass = process.env.SMTP_PASS || 'Anouk601!';
const from = process.env.MAIL_FROM || `LoocateMe <${smtpUser}>`;
const smtpDebug = String(process.env.SMTP_DEBUG || 'false') === 'true';

function createTransport({ host, port, secure, requireTLS }) {
  const base = {
    host,
    port,
    secure,
    auth: { user: smtpUser, pass: smtpPass },
    logger: smtpDebug,
    debug: smtpDebug,
  };
  if (requireTLS !== undefined) base.requireTLS = requireTLS;
  return nodemailer.createTransport(base);
}

// Primary transport: honor provided env (default: 465 + secure)
export let mailer = createTransport({ host: smtpHost, port: smtpPort, secure: smtpSecure });

// Fallback transport: 587 STARTTLS (common with OVH)
let fallbackMailer = createTransport({ host: smtpHost, port: 587, secure: false, requireTLS: true });
// Alternative host used by OVH: smtp.mail.ovh.net (both 465 and 587)
let altHostMailer465 = createTransport({ host: 'smtp.mail.ovh.net', port: 465, secure: true });
let altHostMailer587 = createTransport({ host: 'smtp.mail.ovh.net', port: 587, secure: false, requireTLS: true });

export async function sendMail({ to, subject, text, html }) {
  try {
    return await mailer.sendMail({ from, to, subject, text, html });
  } catch (e) {
    // Try fallback once if primary fails
    try {
      console.warn('[email] Primary SMTP send failed, trying fallback (587 STARTTLS):', e?.message || e);
      return await fallbackMailer.sendMail({ from, to, subject, text, html });
    } catch (e2) {
      console.warn('[email] Fallback (587) failed, trying alt host smtp.mail.ovh.net:465:', e2?.message || e2);
      try {
        return await altHostMailer465.sendMail({ from, to, subject, text, html });
      } catch (e3) {
        console.warn('[email] Alt host 465 failed, trying alt host 587 STARTTLS:', e3?.message || e3);
        try {
          return await altHostMailer587.sendMail({ from, to, subject, text, html });
        } catch (e4) {
          console.error('[email] All SMTP transports failed:', e4?.message || e4);
          throw e4;
        }
      }
    }
  }
}

export async function verifyMailTransport() {
  try {
    await mailer.verify();
    console.log(`[email] SMTP ready on ${smtpHost}:${smtpPort} secure=${smtpSecure}`);
    return { ok: true, transport: 'primary' };
  } catch (e) {
    console.warn('[email] Primary SMTP verify failed:', e?.message || e);
    try {
      await fallbackMailer.verify();
      // Switch to fallback as primary for runtime if it verifies
      mailer = fallbackMailer;
      console.log(`[email] Using fallback SMTP on ${smtpHost}:587 secure=false (STARTTLS)`);
      return { ok: true, transport: 'fallback' };
    } catch (e2) {
      console.warn('[email] Fallback verify failed:', e2?.message || e2);
      try {
        await altHostMailer465.verify();
        mailer = altHostMailer465;
        console.log('[email] Using alternative host smtp.mail.ovh.net:465');
        return { ok: true, transport: 'altHost465' };
      } catch (e3) {
        console.warn('[email] Alt host 465 verify failed:', e3?.message || e3);
        try {
          await altHostMailer587.verify();
          mailer = altHostMailer587;
          console.log('[email] Using alternative host smtp.mail.ovh.net:587 (STARTTLS)');
          return { ok: true, transport: 'altHost587' };
        } catch (e4) {
          console.error('[email] All SMTP transports failed verification:', e4?.message || e4);
          return { ok: false, error: e4?.message || String(e4) };
        }
      }
    }
  }
}
