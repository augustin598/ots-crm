/**
 * Notificarea echipei pentru cererile de pachete (din portalul clientului sau
 * de pe pagina publică `/servicii`).
 *
 * Extras din `packages.remote.ts` ca să fie folosit identic de ambele fluxuri —
 * altfel o cerere publică ar ajunge în CRM fără să afle nimeni de ea.
 */

import { and, eq, or } from 'drizzle-orm';
import { db } from './db';
import * as table from './db/schema';
import { sendPackageRequestEmail } from './email';
import { logError, logInfo } from './logger';

/**
 * Trimite emailul de „cerere pachet nouă" tuturor owner/admin din tenant.
 * Nu aruncă niciodată: eșecul unei notificări nu trebuie să pice cererea.
 */
export async function notifyAdminsOfPackageRequest(
	tenantId: string,
	requestId: string
): Promise<void> {
	try {
		const admins = await db
			.select({
				email: table.user.email,
				firstName: table.user.firstName,
				lastName: table.user.lastName
			})
			.from(table.tenantUser)
			.innerJoin(table.user, eq(table.tenantUser.userId, table.user.id))
			.where(
				and(
					eq(table.tenantUser.tenantId, tenantId),
					or(eq(table.tenantUser.role, 'owner'), eq(table.tenantUser.role, 'admin'))
				)
			);

		for (const admin of admins) {
			if (!admin.email) continue;
			const name = [admin.firstName, admin.lastName].filter(Boolean).join(' ');
			try {
				await sendPackageRequestEmail(requestId, admin.email, name || undefined);
			} catch (err) {
				logError('packages', 'sendPackageRequestEmail failed', {
					tenantId,
					metadata: {
						requestId,
						adminEmail: admin.email,
						error: err instanceof Error ? err.message : String(err)
					}
				});
			}
		}

		logInfo('packages', 'package request admins notified', {
			tenantId,
			metadata: { requestId, adminCount: admins.length }
		});
	} catch (err) {
		logError('packages', 'failed to enumerate admins for package request', {
			tenantId,
			metadata: { requestId, error: err instanceof Error ? err.message : String(err) }
		});
	}
}

/**
 * Variantă fire-and-forget: pornește notificarea fără să blocheze răspunsul,
 * cu plasă de siguranță pentru unhandled rejections (care ar putea aborta
 * răspunsul SvelteKit).
 */
export function notifyAdminsOfPackageRequestInBackground(
	tenantId: string,
	requestId: string
): void {
	notifyAdminsOfPackageRequest(tenantId, requestId).catch((err) => {
		logError('packages', 'package request notification crashed', {
			tenantId,
			metadata: { requestId, error: err instanceof Error ? err.message : String(err) }
		});
	});
}
