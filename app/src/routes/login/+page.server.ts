import { verify } from '@node-rs/argon2';
import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import * as auth from '$lib/server/auth';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { checkAuthRateLimit } from '$lib/server/rate-limiter';
import type { Actions, PageServerLoad } from './$types';

const ARGON2_OPTS = {
	memoryCost: 19456,
	timeCost: 2,
	outputLen: 32,
	parallelism: 1
} as const;

// Constant valid Argon2 hash for a value no one knows. Verified against this on
// unknown-email logins so the response time matches a real verify (anti user
// enumeration via timing — see F4). Never matches any real password.
const DUMMY_PASSWORD_HASH =
	'$argon2id$v=19$m=19456,t=2,p=1$T58y5z0wtbga9hRhorKsLQ$XOlhfsj/xPXFFHYggvSYg8KMHaAKiWKdCLITm3RJzjw';

export const load: PageServerLoad = async (event) => {
	if (event.locals.user) {
		return redirect(302, safeRedirect(event.url.searchParams.get('redirect')));
	}
	return {};
};

export const actions: Actions = {
	login: async (event) => {
		const formData = await event.request.formData();
		const email = formData.get('email');
		const password = formData.get('password');

		if (!validateEmail(email)) {
			return fail(400, {
				message: 'Invalid email address'
			});
		}
		if (!validatePassword(password)) {
			return fail(400, { message: 'Invalid password (min 6, max 255 characters)' });
		}

		// Rate limit BEFORE the expensive Argon2 verify (F2: brute-force / lockout).
		const rateLimitError = checkAuthRateLimit(email, event.getClientAddress());
		if (rateLimitError) {
			return fail(429, { message: rateLimitError });
		}

		const results = await db.select().from(table.user).where(eq(table.user.email, email));
		const existingUser = results.at(0);

		// Always run Argon2 — against the real hash if the user exists, otherwise
		// against a dummy hash — so timing is constant regardless of email validity
		// (F4: user enumeration via timing oracle).
		const validPassword = await verify(
			existingUser?.passwordHash ?? DUMMY_PASSWORD_HASH,
			password,
			ARGON2_OPTS
		);

		if (!existingUser || !validPassword) {
			return fail(400, { message: 'Incorrect email or password' });
		}

		const sessionToken = auth.generateSessionToken();
		const session = await auth.createSession(sessionToken, existingUser.id);
		auth.setSessionTokenCookie(event, sessionToken, session.expiresAt);

		return redirect(302, safeRedirect(event.url.searchParams.get('redirect')));
	}
};

// RFC-5322-ish: local@domain.tld. Rejects admin@, @x, a@b, x@@y, blanks (F3).
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(email: unknown): email is string {
	return typeof email === 'string' && email.length <= 255 && EMAIL_REGEX.test(email);
}

function validatePassword(password: unknown): password is string {
	return typeof password === 'string' && password.length >= 6 && password.length <= 255;
}

/**
 * Only allow redirects to same-origin paths to prevent open redirect (F1).
 * Rejects absolute URLs, protocol-relative (`//host`), backslash tricks
 * (`/\host`), and `scheme:` payloads. Falls back to `/`.
 */
function safeRedirect(raw: string | null): string {
	if (!raw) return '/';
	let target: string;
	try {
		target = decodeURIComponent(raw);
	} catch {
		return '/';
	}
	// Must be a path starting with a single slash, not //, not /\, no scheme.
	if (!target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) {
		return '/';
	}
	return target;
}
