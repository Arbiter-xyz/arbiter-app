// Serializers + download helper for exporting a payer's question history.

import { toCsv } from './csv.js';

export const CSV_COLUMNS = ['questionId', 'question', 'tier', 'amount', 'status', 'outcome', 'confidence'];

export function questionsToCsv(questions) {
  const rows = questions.map((q) => CSV_COLUMNS.map((c) => q[c]));
  return toCsv(CSV_COLUMNS, rows) + '\r\n';
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
