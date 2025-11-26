// Simple image proxy to bypass iOS ATS/domain whitelists by serving images from the API domain
// WARNING: Only proxies http/https URLs. Limits size and restricts to images.

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const FETCH_TIMEOUT_MS = 8000;

export const ProxyController = {
  image: async (req, res) => {
    try {
      const raw = String(req.query.u || '').trim();
      if (!raw) return res.status(400).json({ code: 'URL_REQUIRED', message: 'Paramètre u requis' });

      let url;
      try {
        url = new URL(raw);
      } catch {
        return res.status(400).json({ code: 'URL_INVALID', message: 'URL invalide' });
      }

      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return res.status(400).json({ code: 'UNSUPPORTED_PROTOCOL', message: 'Seul http/https est supporté' });
      }

      // Optional HEAD to check content-type and length quickly
      try {
        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        const head = await fetch(url.toString(), { method: 'HEAD', signal: controller.signal });
        clearTimeout(to);
        const ct = head.headers.get('content-type') || '';
        const len = parseInt(head.headers.get('content-length') || '0', 10);
        if (ct && !ct.toLowerCase().startsWith('image/')) {
          return res.status(415).json({ code: 'UNSUPPORTED_MEDIA', message: 'Le contenu cible ne semble pas être une image' });
        }
        if (len && len > MAX_BYTES) {
          return res.status(413).json({ code: 'ENTITY_TOO_LARGE', message: 'Image trop volumineuse' });
        }
      } catch (_e) {
        // continue with GET even if HEAD fails; remote may not support HEAD
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const resp = await fetch(url.toString(), { signal: controller.signal });
      clearTimeout(timeout);

      if (!resp.ok || !resp.body) {
        return res.status(resp.status || 502).json({ code: 'FETCH_FAILED', message: `Échec de récupération (${resp.status})` });
      }

      const ct = resp.headers.get('content-type') || 'application/octet-stream';
      if (!ct.toLowerCase().startsWith('image/')) {
        return res.status(415).json({ code: 'UNSUPPORTED_MEDIA', message: 'Le contenu récupéré ne semble pas être une image' });
      }

      // Stream with size guard
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');

      let transferred = 0;
      const reader = resp.body.getReader();
      const pump = async () => {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          transferred += value.byteLength;
          if (transferred > MAX_BYTES) {
            try { reader.cancel(); } catch {}
            return res.destroy(new Error('Image too large'));
          }
          if (!res.write(Buffer.from(value))) {
            await new Promise((resolve) => res.once('drain', resolve));
          }
        }
        res.end();
      };
      pump().catch(() => {
        try { res.end(); } catch {}
      });
    } catch (e) {
      return res.status(500).json({ code: 'PROXY_ERROR', message: e?.message || 'Erreur proxy' });
    }
  },
};
