import { Lucia } from 'lucia';
import { DrizzlePostgreSQLAdapter } from '@lucia-auth/adapter-drizzle';
import { db } from './db';
import { session, user } from './db/schema';

export const adapter = new DrizzlePostgreSQLAdapter(db, session, user);

export const lucia = new Lucia(adapter, {
	sessionCookie: {
		attributes: {
			secure: process.env.NODE_ENV === 'production',
			sameSite: 'lax'
		}
	},
	getUserAttributes: (attributes) => {
		return {
			username: attributes.username,
			email: attributes.email,
			emailVerified: attributes.emailVerified,
			role: attributes.role,
			marketingConsent: attributes.marketingConsent,
			preferredLanguage: attributes.preferredLanguage
		};
	}
});

declare module 'lucia' {
	interface Register {
		Lucia: typeof lucia;
		DatabaseUserAttributes: {
			username: string;
			email: string;
			emailVerified: boolean;
			role: 'admin' | 'client' | 'translator' | 'staff';
			marketingConsent: boolean;
			preferredLanguage: 'ro' | 'es' | 'en';
		};
	}
}
