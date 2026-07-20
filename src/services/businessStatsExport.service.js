const WEEKDAY_LABELS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

function escapeCsvField(value) {
  const str = String(value ?? '');
  if (/[",\n;]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function row(fields) {
  return fields.map(escapeCsvField).join(';');
}

// Génère un export CSV simple (sans dépendance) à partir de la réponse de
// getLocationStats(). Séparateur ';' pour une ouverture correcte dans Excel FR.
export function statsToCsv(stats, locationName) {
  const lines = [];
  lines.push(row(['Lieu', locationName]));
  lines.push(row(['Généré le', new Date().toISOString()]));
  lines.push('');

  lines.push(row(['Fenêtre', 'Vues (période)', 'Vues (période précédente)', 'Évolution (%)']));
  for (const [key, w] of Object.entries(stats.views || {})) {
    lines.push(row([key, w.current, w.previous, w.deltaPct ?? '']));
  }
  lines.push('');

  lines.push(row(['Jour', 'Visites (30j)']));
  (stats.visitsByWeekday || []).forEach((count, idx) => {
    lines.push(row([WEEKDAY_LABELS[idx] ?? idx, count]));
  });
  lines.push('');

  lines.push(row(['Heure', 'Visites (30j)']));
  (stats.hourlyDistribution || []).forEach((count, hour) => {
    lines.push(row([`${hour}h`, count]));
  });
  lines.push('');

  lines.push(row(['Âge moyen des visiteurs', stats.avgAgeVisitors ?? 'N/A (échantillon insuffisant)']));
  if (stats.genderSplit) {
    lines.push(row(['Répartition genre', 'Part']));
    lines.push(row(['Hommes', stats.genderSplit.male]));
    lines.push(row(['Femmes', stats.genderSplit.female]));
    lines.push(row(['Autre', stats.genderSplit.other]));
  }
  if (stats.ageGroups) {
    lines.push('');
    lines.push(row(['Tranche d\'âge', 'Visiteurs']));
    for (const [bucket, count] of Object.entries(stats.ageGroups)) {
      lines.push(row([bucket, count]));
    }
  }
  lines.push('');

  lines.push(row(['Taux de conversion vue -> visite (30j)', stats.funnelConversionRate != null ? `${stats.funnelConversionRate}%` : 'N/A']));

  return lines.join('\n');
}
