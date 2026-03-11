import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { sha256 } from '@oslojs/crypto/sha2';
import { encodeHexLowerCase } from '@oslojs/encoding';
import * as auth from '$lib/server/auth';

function hashToken(token: string): string {
	return encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
}

export const load: PageServerLoad = async (event) => {
	const token = event.params.token || '';

	if (!token) {
		throw redirect(302, '/login?error=' + encodeURIComponent('Link invalid.'));
	}

	// Pre-validate token before showing the form
	const hashedToken = hashToken(token);
	const [tokenRecord] = await db
		.select()
		.from(table.passwordResetToken)
		.where(eq(table.passwordResetToken.token, hashedToken))
		.limit(1);

	if (!tokenRecord || tokenRecord.used || new Date() > tokenRecord.expiresAt) {
		throw redirect(
			302,
			'/login?error=' +
				encodeURIComponent('Link-ul de resetare a expirat sau este invalid. Solicită unul nou.') +
				'&reset=1'
		);
	}

	// Invalidate any existing session to prevent redirect chain issues
	if (event.locals.session) {
		await auth.invalidateSession(event.locals.session.id);
		auth.deleteSessionTokenCookie(event);
	}

	return { token };
};
