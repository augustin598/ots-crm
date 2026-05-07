// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			user: import('$lib/server/auth').SessionValidationResult['user'];
			session: import('$lib/server/auth').SessionValidationResult['session'];
			tenant?: import('$lib/server/db/schema').Tenant | null;
			tenantUser?: import('$lib/server/db/schema').TenantUser | null;
			clientUser?: import('$lib/server/db/schema').ClientUser | null;
			client?: import('$lib/server/db/schema').Client | null;
			isClientUser?: boolean;
			isClientUserPrimary?: boolean;
			/**
			 * Authorization actor — populated lazily by `getActor()` from
			 * `$lib/server/access`. Use assertCan/can helpers, not direct access.
			 */
			actor?: import('$lib/server/access').Actor;
		}
		interface PageData {
			translations?: Record<import('$lib/i18n/index.svelte').Language, Record<string, any>>;
			user?: import('$lib/server/auth').SessionValidationResult['user'];
		}
	} // interface Error {}
	// interface Locals {}
} // interface PageState {}

// interface Platform {}
export {};
