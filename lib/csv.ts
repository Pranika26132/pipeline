export type CsvRow = {
  cells: string[];
  // 1-based line in the file where this row starts, as a text editor counts.
  line: number;
};

// Minimal RFC 4180 parser: commas, double-quoted fields (which may span
// lines), "" escapes, and CRLF or LF line endings. Blank lines are dropped.
export function parseCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let rowStart = 1;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n" || (ch === "\r" && src[i + 1] !== "\n")) {
          line++;
        }
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") {
        i++;
      }
      cells.push(field);
      rows.push({ cells, line: rowStart });
      cells = [];
      field = "";
      line++;
      rowStart = line;
    } else {
      field += ch;
    }
  }
  if (inQuotes) {
    throw new Error("A quoted field is never closed. Check the file for a stray \" character.");
  }
  if (field !== "" || cells.length > 0) {
    cells.push(field);
    rows.push({ cells, line: rowStart });
  }

  return rows.filter((r) => r.cells.some((cell) => cell.trim() !== ""));
}
