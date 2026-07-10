import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, '..', '..', process.env.UPLOAD_DIR || 'uploads');

// Résout l'URL publique d'un média (profile, cover, logo, story...) vers son
// chemin absolu sur disque, quel que soit le sous-dossier sous /uploads/.
export function localPathFromUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url, 'http://placeholder');
    const pathname = u.pathname || '';
    const idx = pathname.indexOf('/uploads/');
    if (idx === -1) return null;
    const filename = pathname.substring(idx + '/uploads/'.length);
    if (!filename) return null;
    const p = path.join(uploadsDir, filename);
    // prevent path traversal
    if (!p.startsWith(uploadsDir)) return null;
    return p;
  } catch {
    return null;
  }
}
