import { WaitlistSignup } from '../models/WaitlistSignup.js';
import { sendMail } from '../services/email.service.js';

const LAUNCH_DATE_LABEL = '5 septembre 2026';

export const WaitlistController = {
  async subscribe(req, res, next) {
    try {
      const { email } = req.body;
      const existing = await WaitlistSignup.findOne({ email });
      if (existing) {
        return res.status(200).json({ ok: true, alreadySubscribed: true });
      }

      await WaitlistSignup.create({ email });
      const count = await WaitlistSignup.countDocuments();

      // Fire-and-forget : un échec SMTP ne doit pas faire échouer l'inscription,
      // déjà actée en base à ce stade.
      sendMail({
        to: email,
        subject: "Bienvenue sur la liste d'attente LoocateMe",
        text: `Merci de ton inscription ! LoocateMe arrive le ${LAUNCH_DATE_LABEL}, on te préviendra dès que c'est disponible.`,
        html: `<p>Merci de ton inscription !</p><p>LoocateMe arrive le <strong>${LAUNCH_DATE_LABEL}</strong>, on te préviendra dès que c'est disponible.</p>`,
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
