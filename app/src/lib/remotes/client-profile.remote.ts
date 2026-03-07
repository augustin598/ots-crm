import { command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

const updateProfileSchema = v.object({
	firstName: v.pipe(v.string(), v.minLength(1, 'Prenumele este obligatoriu'), v.maxLength(255)),
	lastName: v.pipe(v.string(), v.minLength(1, 'Numele este obligatoriu'), v.maxLength(255))
});

export const updateClientUserProfile = command(updateProfileSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.isClientUser || !event?.locals.clientUser) {
		throw new Error('Unauthorized');
	}

	await db
		.update(table.user)
		.set({ firstName: data.firstName, lastName: data.lastName })
		.where(eq(table.user.id, event.locals.user.id));

	return { success: true };
});
