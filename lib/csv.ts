/**
 * Escapes a value for CSV output and neutralizes spreadsheet formula
 * prefixes so exported data cannot execute as a formula in Excel, Google
 * Sheets, or LibreOffice.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";

  const raw =
    typeof value === "object" ? JSON.stringify(value) : String(value);

  // A leading =, +, -, @, tab, CR, or LF makes the spreadsheet treat the cell
  // as a formula. Prefix it with an apostrophe so it is rendered as text.
  const safe = /^[=+\-@\t\r\n]/.test(raw) ? `'${raw}` : raw;

  return `"${safe.replace(/"/g, '""')}"`;
}
