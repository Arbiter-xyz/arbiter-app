// Serializers + download helper for exporting a payer's question history.

export const CSV_COLUMNS = ['questionId', 'question', 'tier', 'amount', 'status', 'outcome', 'confidence'];

/** Escape one CSV field: neutralize formula injection, then quote if needed. */
export function csvEscape(value) {
  let s = value === null || value === undefined ? '' : String(value);
  // Spreadsheet apps treat leading = + - @ (and tab/CR) as formulas.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function questionsToCsv(questions) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const q of questions) {
    lines.push(CSV_COLUMNS.map((c) => csvEscape(q[c])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

export function questionsToJson(questions) {
  return JSON.stringify(questions, null, 2);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function download(filename, mime, content) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Export exactly the loaded questions, filename stamped with export time. */
export function exportQuestions(questions, format) {
  const name = `arbiter-questions-${timestamp()}`;
  if (format === 'json') download(`${name}.json`, 'application/json', questionsToJson(questions));
  else download(`${name}.csv`, 'text/csv;charset=utf-8', questionsToCsv(questions));
}
