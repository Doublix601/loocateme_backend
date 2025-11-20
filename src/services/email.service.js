import nodemailer from 'nodemailer';

const smtpHost = process.env.SMTP_HOST || 'ssl0.ovh.net';
const smtpPort = Number(process.env.SMTP_PORT || 465);
const smtpSecure = String(process.env.SMTP_SECURE || 'true') === 'true';
const smtpUser = process.env.SMTP_USER || 'no-reply@loocate.me';
const smtpPass = process.env.SMTP_PASS || 'Anouk601!';
const from = process.env.MAIL_FROM || `LoocateMe <${smtpUser}>`;

export const mailer = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpSecure,
  auth: { user: smtpUser, pass: smtpPass },
});

export async function sendMail({ to, subject, text, html }) {
  return mailer.sendMail({ from, to, subject, text, html });
}
