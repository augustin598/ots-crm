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
	toIsoDate
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
			let count = 0;
			for (const row of rows) {
				const nume = String(row[0] ?? '').trim();
				if (!nume || /nume\s*\/?\s*prenume/i.test(nume)) continue; // header/gol
				const dataInterviu = toIsoDate(row[1] as string);
				if (!dataInterviu) {
					skipped++;
					continue;
				}
				const studio = normalizeStudio(row[2] as string);
				const sursa = String(row[3] ?? '').trim();
				const status = normalizeStatus(row[4] as string, row[5] as string);
				const observatii = String(row[6] ?? '').trim();
				const channelName = classifySource(sursa);
				const channelId = chByName.get(channelName) ?? nespecId;

				toInsert.push({
					id: generateId(),
					tenantId,
					nume,
					dataInterviu,
					dataInceput: null,
					dataSfarsit: null,
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
