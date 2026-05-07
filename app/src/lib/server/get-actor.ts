/**
 * Lazy actor accessor — builds the Actor on first call within a request and
 * caches it on event.locals so subsequent calls in the same request are free.
 *
 * Use this instead of constructing actors yourself:
 *   const actor = await getActor(event);
 *   assertCan(actor, 'admin.team.invite');
 */

import type { RequestEvent } from '@sveltejs/kit';
import { buildActor, type Actor } from './access';

const CACHE = new WeakMap<object, Actor>();

export async function getActor(event: RequestEvent): Promise<Actor> {
	if (event.locals.actor) return event.locals.actor;
	// Cache by event.locals identity (request-scoped)
	const cached = CACHE.get(event.locals as object);
	if (cached) return cached;

	const actor = await buildActor(event);
	event.locals.actor = actor;
	CACHE.set(event.locals as object, actor);
	return actor;
}

/**
 * Convenience: build actor and assert capability in one call. Throws 401/403
 * if not allowed.
 */
export async function assertCanFromEvent(
	event: RequestEvent,
	cap: import('$lib/access/catalog').Capability
): Promise<Actor> {
	const { assertCan } = await import('./access');
	const actor = await getActor(event);
	assertCan(actor, cap);
	return actor;
}
