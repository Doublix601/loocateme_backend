// Construit une regex insensible aux diacritiques (accents français) pour la
// recherche par nom/email. Utilisé par user.service.js (searchUsers) et
// report.controller.js (recherche d'utilisateurs pour signalement) — étaient
// deux copies indépendantes de la même fonction.
export function buildDiacriticRegex(input) {
  const map = {
    a: '[aàáâäåæAÀÁÂÄÅÆ]',
    c: '[cçCÇ]',
    e: '[eèéêëEÈÉÊË]',
    i: '[iìíîïIÌÍÎÏ]',
    o: '[oòóôöøœOÒÓÔÖØŒ]',
    u: '[uùúûüUÙÚÛÜ]',
    y: '[yÿYŸ]',
    n: '[nñNÑ]',
  };
  const escaped = String(input || '')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let pattern = '';
  for (const ch of escaped) {
    const lower = ch.toLowerCase();
    if (map[lower]) pattern += map[lower];
    else pattern += ch;
  }
  return new RegExp(pattern, 'i');
}
