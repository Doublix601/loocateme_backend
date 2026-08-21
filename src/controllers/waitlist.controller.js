import { WaitlistSignup } from '../models/WaitlistSignup.js';
import { sendMail } from '../services/email.service.js';

const LAUNCH_DATE_LABEL = '5 septembre 2026';
const SUPPORT_INBOX = process.env.SUPPORT_INBOX || 'support@loocate.me';

export const WaitlistController = {
  async subscribe(req, res, next) {
    try {
      const { email } = req.body;
      const existing = await WaitlistSignup.findOne({ email });
      if (existing) {
        return res.status(200).json({ ok: true, alreadySubscribed: true });
      }

      try {
        await WaitlistSignup.create({
          email,
          ip: req.ip,
          userAgent: req.get('user-agent'),
        });
      } catch (err) {
        // Course TOCTOU : deux inscriptions quasi simultanées pour le même
        // email peuvent toutes deux passer le findOne ci-dessus avant que
        // l'une des deux create() n'aboutisse. L'index unique de
        // WaitlistSignup.email fait alors échouer la seconde create() avec
        // une erreur de clé dupliquée (E11000) — à traiter comme une
        // inscription déjà existante, pas comme une erreur serveur.
        if (err?.code === 11000) {
          return res.status(200).json({ ok: true, alreadySubscribed: true });
        }
        throw err;
      }
      const count = await WaitlistSignup.countDocuments();

      // Fire-and-forget : un échec SMTP ne doit pas faire échouer l'inscription,
      // déjà actée en base à ce stade.
      sendMail({
        to: email,
        subject: "Bienvenue sur la liste d'attente LoocateMe",
        text: `Merci de ton inscription ! LoocateMe arrive le ${LAUNCH_DATE_LABEL}, on te préviendra dès que c'est disponible.\n\nCet email ne t'intéresse pas ou tu n'es pas à l'origine de cette inscription ? Écris-nous à ${SUPPORT_INBOX} et on te retire de la liste.`,
        html: `<p>Merci de ton inscription !</p><p>LoocateMe arrive le <strong>${LAUNCH_DATE_LABEL}</strong>, on te préviendra dès que c'est disponible.</p><p style="color:#666;font-size:13px;">Cet email ne t'intéresse pas ou tu n'es pas à l'origine de cette inscription ? Écris-nous à <a href="mailto:${SUPPORT_INBOX}">${SUPPORT_INBOX}</a> et on te retire de la liste.</p>`,
      }).catch((err) => {
        console.error('[waitlist] Échec envoi email de bienvenue:', err?.message || err);
      });

      res.status(201).json({ ok: true, alreadySubscribed: false, count });
    } catch (err) {
      next(err);
    }
  },

  async getCount(req, res, next) {
    try {
      const count = await WaitlistSignup.countDocuments();
      res.status(200).json({ count });
    } catch (err) {
      next(err);
    }
  },
};
