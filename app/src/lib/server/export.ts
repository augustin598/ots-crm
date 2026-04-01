import XLSX from 'xlsx';

// ---- Types ----

export interface ExportColumn<T = Record<string, unknown>> {
	/** Key to access in the row object */
	key: string;
	/** Column header label */
	header: string;
	/** Optional formatter — receives raw value and full row */
	format?: (value: unknown, row: T) => string | number;
	/** Column width in characters (Excel only) */
	width?: number;
}

export interface ExportSheet<T = Record<string, unknown>> {
	/** Sheet/tab name in the Excel workbook */
	name: string;
	columns: ExportColumn<T>[];
	data: T[];
}

// ---- CSV ----

/**
 * Generate a CSV string from data rows.
 * Prepends UTF-8 BOM so Excel on Windows opens diacritics correctly.
 */
export function generateCSV<T extends Record<string, unknown>>(
	data: T[],
	columns: ExportColumn<T>[]
): string {
	const headers = columns.map((c) => `"${escapeCsv(c.header)}"`).join(',');

	const rows = data.map((row) =>
		columns
			.map((col) => {
				const raw = row[col.key as keyof T];
				const formatted = col.format ? col.format(raw, row) : (raw ?? '');
				return `"${escapeCsv(String(formatted))}"`;
			})
			.join(',')
	);

	// UTF-8 BOM (\ufeff) ensures correct encoding in Excel on Windows
	return '\ufeff' + [headers, ...rows].join('\r\n');
}

function escapeCsv(value: string): string {
	return value.replace(/"/g, '""');
}

// ---- Excel (XLSX) ----

/**
 * Generate an Excel (.xlsx) buffer with one or more sheets.
 * Uses SheetJS Community Edition (xlsx@0.18.5).
 *
 * NOTE: Cell styling (bold headers) requires SheetJS Pro.
 * Basic data export works perfectly with the community edition.
 */
export function generateExcel(sheets: ExportSheet<any>[]): ArrayBuffer {
	const workbook = XLSX.utils.book_new();

	for (const sheet of sheets) {
		const headers = sheet.columns.map((c) => c.header);

		const rows = sheet.data.map((row) =>
			sheet.columns.map((col) => {
				const raw = row[col.key as string];
				return col.format ? col.format(raw, row) : (raw ?? '');
			})
		);

		const wsData = [headers, ...rows];
		const ws = XLSX.utils.aoa_to_sheet(wsData);

		// Set column widths
		ws['!cols'] = sheet.columns.map((c) => ({ wch: c.width ?? 20 }));

		XLSX.utils.book_append_sheet(workbook, ws, sheet.name);
	}

	const arrayBuffer: ArrayBuffer = XLSX.write(workbook, {
		type: 'array',
		bookType: 'xlsx'
	});
	return arrayBuffer;
}
