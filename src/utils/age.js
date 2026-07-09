export function isAtLeast18(birthdate) {
  const date = birthdate instanceof Date ? birthdate : new Date(birthdate);
  if (isNaN(date.getTime())) return false;
  const now = new Date();
  let age = now.getFullYear() - date.getFullYear();
  const monthDiff = now.getMonth() - date.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < date.getDate())) {
    age--;
  }
  return age >= 18;
}
