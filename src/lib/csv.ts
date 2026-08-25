import { stringify } from 'csv-stringify/sync';

type CsvPrimitive = string | number | boolean | null | undefined;

export type CsvColumn<T> = {
  key: keyof T;
  header: string;
};

export function sanitizeCsvCell(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^[=+\-@\t\r|%]/.test(trimmed)) {
      return `'${value}`;
    }
  }
  return value;
}

export function buildCsv<T extends Record<string, CsvPrimitive>>(
  rows: T[],
  columns: CsvColumn<T>[]
): string {
  const sanitizedRows = rows.map(row => {
    const sanitized: Record<string, CsvPrimitive> = {};
    for (const [key, val] of Object.entries(row)) {
      sanitized[key] = sanitizeCsvCell(val) as CsvPrimitive;
    }
    return sanitized;
  });

  return (
    '\uFEFF' +
    stringify(sanitizedRows, {
      header: true,
      columns: columns.map(column => ({
        key: String(column.key),
        header: column.header,
      })),
    })
  );
}
