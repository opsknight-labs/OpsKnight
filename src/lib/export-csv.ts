/**
 * Centralized CSV Export Utility
 * Safely converts tabular data to CSV with RFC 4180 compliance,
 * UTF-8 BOM encoding for Excel compatibility, and automatic browser download.
 */

export type CsvColumn<T> = {
  header: string;
  accessor: keyof T | ((row: T) => string | number | boolean | null | undefined);
};

export function exportToCsv<T>(filename: string, columns: CsvColumn<T>[], data: T[]): void {
  if (typeof window === 'undefined') return;

  const escapeCsvValue = (val: unknown): string => {
    if (val === null || val === undefined) return '""';
    const str = String(val);
    // Double-quote wrap and escape existing double quotes
    return `"${str.replace(/"/g, '""')}"`;
  };

  const headerRow = columns.map(c => escapeCsvValue(c.header)).join(',');
  const dataRows = data.map(row => {
    return columns
      .map(col => {
        const rawValue = typeof col.accessor === 'function' ? col.accessor(row) : row[col.accessor];
        return escapeCsvValue(rawValue);
      })
      .join(',');
  });

  const csvContent = '\uFEFF' + [headerRow, ...dataRows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const cleanFilename = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', cleanFilename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
