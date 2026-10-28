// A small RFC 4180 CSV reader, enough for GTFS: quoted fields, doubled quotes,
// embedded commas and newlines, and a stripped UTF-8 BOM. GTFS is always
// comma-separated with a header row.

export function parseCsv(text: string): Record<string, string>[] {
	if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
	const rows: string[][] = [];
	let field = "";
	let row: string[] = [];
	let inQuotes = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (inQuotes) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				field += c;
			}
			continue;
		}
		if (c === '"') {
			inQuotes = true;
		} else if (c === ",") {
			row.push(field);
			field = "";
		} else if (c === "\n") {
			row.push(field);
			rows.push(row);
			field = "";
			row = [];
		} else if (c === "\r") {
			// swallow; the \n that follows ends the row
		} else {
			field += c;
		}
	}
	if (field.length > 0 || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	if (rows.length === 0) return [];
	const header = rows[0];
	const out: Record<string, string>[] = [];
	for (let r = 1; r < rows.length; r++) {
		const cells = rows[r];
		if (cells.length === 1 && cells[0] === "") continue; // blank line
		const rec: Record<string, string> = {};
		for (let c = 0; c < header.length; c++) rec[header[c]] = cells[c] ?? "";
		out.push(rec);
	}
	return out;
}
