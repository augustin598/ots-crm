/**
 * Recomputes is_active for all meta_ads_accounts rows based on their current
 * account_status value, using the correct Meta API v25 active-status set.
 *
 * Run: bun scripts/recompute-meta-account-active.ts
 */
import { createClient } from '@libsql/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const ACTIVE_STATUSES = new Set([1, 9]); // 1=ACTIVE, 9=IN_GRACE_PERIOD

const client = createClient({
	url: process.env.SQLITE_URI!,
	authToken: process.env.SQLITE_AUTH_TOKEN,
});

const rows = await client.execute('SELECT id, meta_ad_account_id, account_status, is_active FROM meta_ads_account');

let updated = 0;
for (const row of rows.rows) {
	const accountStatus = Number(row.account_status ?? 0);
	const shouldBeActive = ACTIVE_STATUSES.has(accountStatus) ? 1 : 0;
	const currentActive = Number(row.is_active ?? 0);

	if (shouldBeActive !== currentActive) {
		await client.execute({
			sql: 'UPDATE meta_ads_account SET is_active = ? WHERE id = ?',
			args: [shouldBeActive, row.id as string],
		});
		console.log(
			`  Updated ${row.meta_ad_account_id}: is_active ${currentActive} → ${shouldBeActive} (account_status=${accountStatus})`,
		);
		updated++;
	}
}

console.log(`\nDone. ${rows.rows.length} rows scanned, ${updated} updated.`);
client.close();
