/**
 * Utility to restrict HTML5 date inputs to a 4-digit year limit,
 * preventing accidental input of 5+ digit years (e.g. 202606-20-20).
 * Since HTML5 date input values are always formatted as YYYY-MM-DD,
 * we split on '-' and slice the year part if it exceeds 4 characters.
 */
export function limitYearTo4Digits(dateVal: string): string {
  if (!dateVal) return "";
  const parts = dateVal.split("-");
  if (parts[0] && parts[0].length > 4) {
    parts[0] = parts[0].slice(0, 4);
    return parts.join("-");
  }
  return dateVal;
}
