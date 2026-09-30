// Dependency-free CSV builder shared by the admin console's exports.
//
// Output is RFC 4180 (CRLF line endings, fields quoted when they contain a
// comma, quote or newline, embedded quotes doubled) with a UTF-8 BOM so
// Excel opens it with the right encoding. Several exported columns trace
// back to caller-controlled input (self-reported KYC/payout fields, non-
// address workerIds), so any cell a spreadsheet would treat as a formula
// (leading = + - @, tab or CR) is prefixed with a single quote.

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(columns, rows) {
  return [columns, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function downloadCsv(filename, columns, rows) {
  const blob = new Blob(['﻿', toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
