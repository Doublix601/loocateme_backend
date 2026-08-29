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
  // On échappe chaque caractère NON mappé individuellement. Échapper la chaîne
  // entière d'abord puis itérer dessus est buggé : ça sépare une séquence
  // d'échappement « \) » et peut ensuite transformer le caractère qui suit un
  // backslash (ex. « \a » -> « \[aàá…] », classe de caractères cassée), d'où des
  // « unmatched parentheses » côté moteur regex de MongoDB.
  const escapeRe = /[.*+?^${}()|[\]\\]/g;
  let pattern = '';
  for (const ch of String(input || '')) {
    const lower = ch.toLowerCase();
    if (map[lower]) pattern += map[lower];
    else pattern += ch.replace(escapeRe, '\\$&');
  }
  return new RegExp(pattern, 'i');
}
