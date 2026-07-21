import { sendMail } from '../services/email.service.js';

const SUPPORT_INBOX = process.env.SUPPORT_INBOX || 'support@loocate.me';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export const SupportController = {
  async contact(req, res, next) {
    try {
      const { name, email, subject, message } = req.body;

      await sendMail({
        to: SUPPORT_INBOX,
        subject: `[Support loocate.me] ${subject}`,
        text: `De: ${name} <${email}>\n\n${message}`,
        html: `<p><strong>De :</strong> ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;</p><p>${escapeHtml(message).replace(/\n/g, '<br/>')}</p>`,
      });

      res.status(201).json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
};
