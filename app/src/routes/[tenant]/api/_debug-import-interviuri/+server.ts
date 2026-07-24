import { json, error } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import XLSX from 'xlsx';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { serializeError } from '$lib/server/logger';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import {
	DEFAULT_CHANNELS,
	NESPECIFICAT,
	classifySource,
	normalizeStatus,
	normalizeStudio,
	toIsoDate,
	sheetToYearMonth,
	isNonCandidateRow,
	mapColumns
} from '$lib/server/interviuri/classify';
import type { RequestHandler } from './$types';

function generateId() {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/**
 * Import/seed interviuri din „Evidenta interviuri 2026.xlsx" — admin only.
 * Body opțional: fișier .xlsx (multipart, câmp „file"). Fără fișier, citește din rădăcina app.
 * Query: ?reset=1 șterge interviurile existente înainte de import.
 */
export const POST: RequestHandler = async ({ locals, request, url }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	const role = locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') throw error(403, 'Forbidden: admin access required');

	const tenantId = locals.tenant.id;

	try {
		// 1. Sursa fișierului: upload sau fișierul din rădăcina proiectului.
		let buffer: Buffer;
		const ct = request.headers.get('content-type') || '';
		if (ct.includes('multipart/form-data')) {
			const form = await request.formData();
			const file = form.get('file');
			if (!(file instanceof File)) throw error(400, 'Lipsă câmp „file"');
			buffer = Buffer.from(await file.arrayBuffer());
		} else {
			buffer = readFileSync(join(process.cwd(), 'Evidenta interviuri 2026.xlsx'));
		}

		// 2. Asigură canalele-sistem.
		const existingCh = await db
			.select({ id: table.interviewChannel.id })
			.from(table.interviewChannel)
			.where(eq(table.interviewChannel.tenantId, tenantId))
			.limit(1);
		if (existingCh.length === 0) {
			const now = new Date();
			await db.insert(table.interviewChannel).values(
				DEFAULT_CHANNELS.map((c) => ({
					id: generateId(),
					tenantId,
					name: c.name,
					color: c.color,
					icon: c.icon,
					isSystem: true,
					sortOrder: c.sortOrder,
					createdAt: now,
					updatedAt: now
				}))
			);
		}
		const channels = await db
			.select()
			.from(table.interviewChannel)
			.where(eq(table.interviewChannel.tenantId, tenantId));
		const chByName = new Map(channels.map((c) => [c.name, c.id]));
		const nespecId = chByName.get(NESPECIFICAT)!;

		if (url.searchParams.get('reset') === '1') {
			await db.delete(table.interview).where(eq(table.interview.tenantId, tenantId));
		}

		// 3. Parsează fiecare filă (o filă per lună).
		const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
		const now = new Date();
		const toInsert: (typeof table.interview.$inferInsert)[] = [];
		let skipped = 0;
		const perSheet: Record<string, number> = {};

		for (const sheetName of wb.SheetNames) {
			const ws = wb.Sheets[sheetName];
			const rows = XLSX.utils.sheet_to_json<(string | Date)[]>(ws, {
				header: 1,
				defval: '',
				raw: false
			});
			if (rows.length === 0) continue;
			const col = mapColumns(rows[0]); // coloane mapate după antet (structura variază pe ani)
			const period = sheetToYearMonth(sheetName);
			const cell = (row: (string | Date)[], i: number) => (i >= 0 ? row[i] : '');
			let count = 0;
			for (const row of rows) {
				const nume = String(cell(row, col.nume >= 0 ? col.nume : 0) ?? '').trim();
				if (!nume || /^nume.*prenume$/i.test(nume)) continue; // header/gol
				const dateRaw = cell(row, col.data >= 0 ? col.data : 1);
				if (isNonCandidateRow(nume, dateRaw as string)) continue; // sumar lunar / antet colorat
				// Dată exactă; dacă lipsește/e greșită, fallback la luna filei (ziua 01).
				let dataInterviu = toIsoDate(dateRaw as string);
				if (!dataInterviu && period) {
					dataInterviu = `${period.year}-${String(period.month).padStart(2, '0')}-01`;
				}
				if (!dataInterviu) {
					skipped++;
					continue;
				}
				const studio = normalizeStudio(cell(row, col.studio) as string);
				const sursa = String(cell(row, col.sursa) ?? '').trim();
				const status = normalizeStatus(cell(row, col.admisa) as string, cell(row, col.respinsa) as string);
				const observatii = String(cell(row, col.observatii) ?? '').trim();
				const channelId = chByName.get(classifySource(sursa)) ?? nespecId;

				toInsert.push({
					id: generateId(),
					tenantId,
					nume,
					dataInterviu,
					dataInceput: toIsoDate(cell(row, col.inceput) as string) || null,
					dataSfarsit: toIsoDate(cell(row, col.sfarsit) as string) || null,
					studio,
					sursa: sursa || null,
					channelId,
					status,
					observatii: observatii || null,
					createdAt: now,
					updatedAt: now
				});
				count++;
			}
			if (count) perSheet[sheetName] = count;
		}

		// 4. Insert în batch-uri.
		for (let i = 0; i < toInsert.length; i += 100) {
			await db.insert(table.interview).values(toInsert.slice(i, i + 100));
		}

		return json({
			ok: true,
			imported: toInsert.length,
			skipped,
			sheets: wb.SheetNames.length,
			perSheet
		});
	} catch (e) {
		const { message, stack } = serializeError(e);
		return json({ ok: false, error: message, stack }, { status: 500 });
	}
};
