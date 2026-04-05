import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function generateId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

const DEFAULTS = {
	notifyTaskStatusChange: true,
	notifyNewComment: true,
	notifyApproachingDeadline: true,
	notifyTaskAssigned: true,
	notifyTaskApprovedRejected: true,
	defaultTaskView: 'card' as const,
	defaultTaskSort: 'date' as const,
	itemsPerPage: 25,
	defaultPriority: 'medium' as const,
	onboardingTourCompleted: false,
	onboardingTourEnabled: true,
	onboardingChecklist: null as string | null
};

export const getClientUserPreferences = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.isClientUser || !event?.locals.clientUser) {
		throw new Error('Unauthorized');
	}

	const [prefs] = await db
		.select()
		.from(table.clientUserPreferences)
		.where(eq(table.clientUserPreferences.clientUserId, event.locals.clientUser.id))
		.limit(1);

	if (!prefs) {
		return { ...DEFAULTS };
	}

	return {
		notifyTaskStatusChange: prefs.notifyTaskStatusChange ?? DEFAULTS.notifyTaskStatusChange,
		notifyNewComment: prefs.notifyNewComment ?? DEFAULTS.notifyNewComment,
		notifyApproachingDeadline: prefs.notifyApproachingDeadline ?? DEFAULTS.notifyApproachingDeadline,
		notifyTaskAssigned: prefs.notifyTaskAssigned ?? DEFAULTS.notifyTaskAssigned,
		notifyTaskApprovedRejected: prefs.notifyTaskApprovedRejected ?? DEFAULTS.notifyTaskApprovedRejected,
		defaultTaskView: prefs.defaultTaskView ?? DEFAULTS.defaultTaskView,
		defaultTaskSort: prefs.defaultTaskSort ?? DEFAULTS.defaultTaskSort,
		itemsPerPage: prefs.itemsPerPage ?? DEFAULTS.itemsPerPage,
		defaultPriority: prefs.defaultPriority ?? DEFAULTS.defaultPriority,
		onboardingTourCompleted: prefs.onboardingTourCompleted ?? DEFAULTS.onboardingTourCompleted,
		onboardingTourEnabled: prefs.onboardingTourEnabled ?? DEFAULTS.onboardingTourEnabled,
		onboardingChecklist: prefs.onboardingChecklist ?? DEFAULTS.onboardingChecklist
	};
});

const updateSchema = v.object({
	notifyTaskStatusChange: v.optional(v.boolean()),
	notifyNewComment: v.optional(v.boolean()),
	notifyApproachingDeadline: v.optional(v.boolean()),
	notifyTaskAssigned: v.optional(v.boolean()),
	notifyTaskApprovedRejected: v.optional(v.boolean()),
	defaultTaskView: v.optional(v.picklist(['list', 'card'])),
	defaultTaskSort: v.optional(v.picklist(['date', 'priority', 'status'])),
	itemsPerPage: v.optional(v.picklist([10, 25, 50])),
	defaultPriority: v.optional(v.picklist(['low', 'medium', 'high', 'urgent'])),
	onboardingTourCompleted: v.optional(v.boolean()),
	onboardingTourEnabled: v.optional(v.boolean()),
	onboardingChecklist: v.optional(v.nullable(v.string()))
});

export const updateClientUserPreferences = command(updateSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.isClientUser || !event?.locals.clientUser || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const clientUserId = event.locals.clientUser.id;

	const [existing] = await db
		.select()
		.from(table.clientUserPreferences)
		.where(eq(table.clientUserPreferences.clientUserId, clientUserId))
		.limit(1);

	if (existing) {
		await db
			.update(table.clientUserPreferences)
			.set({ ...data, updatedAt: new Date() })
			.where(eq(table.clientUserPreferences.clientUserId, clientUserId));
	} else {
		await db.insert(table.clientUserPreferences).values({
			id: generateId(),
			clientUserId,
			tenantId: event.locals.tenant.id,
			...data
		});
	}

	return { success: true };
});

// --- Admin-side commands for onboarding control ---

const toggleOnboardingSchema = v.object({
	clientUserId: v.pipe(v.string(), v.minLength(1)),
	enabled: v.boolean()
});

export const toggleClientOnboardingTour = command(toggleOnboardingSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const [existing] = await db
		.select()
		.from(table.clientUserPreferences)
		.where(eq(table.clientUserPreferences.clientUserId, data.clientUserId))
		.limit(1);

	if (existing) {
		await db
			.update(table.clientUserPreferences)
			.set({ onboardingTourEnabled: data.enabled, updatedAt: new Date() })
			.where(eq(table.clientUserPreferences.clientUserId, data.clientUserId));
	} else {
		await db.insert(table.clientUserPreferences).values({
			id: generateId(),
			clientUserId: data.clientUserId,
			tenantId: event.locals.tenant.id,
			onboardingTourEnabled: data.enabled
		});
	}

	return { success: true };
});

const resetOnboardingSchema = v.object({
	clientUserId: v.pipe(v.string(), v.minLength(1))
});

export const resetClientOnboardingTour = command(resetOnboardingSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const [existing] = await db
		.select()
		.from(table.clientUserPreferences)
		.where(eq(table.clientUserPreferences.clientUserId, data.clientUserId))
		.limit(1);

	if (existing) {
		await db
			.update(table.clientUserPreferences)
			.set({
				onboardingTourCompleted: false,
				onboardingTourEnabled: true,
				onboardingChecklist: null,
				updatedAt: new Date()
			})
			.where(eq(table.clientUserPreferences.clientUserId, data.clientUserId));
	} else {
		await db.insert(table.clientUserPreferences).values({
			id: generateId(),
			clientUserId: data.clientUserId,
			tenantId: event.locals.tenant.id,
			onboardingTourCompleted: false,
			onboardingTourEnabled: true
		});
	}

	return { success: true };
});

export const getClientUsersOnboardingStatus = query(v.pipe(v.string(), v.minLength(1)), async (clientId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const rows = await db
		.select({
			clientUserId: table.clientUser.id,
			userId: table.user.id,
			email: table.user.email,
			firstName: table.user.firstName,
			lastName: table.user.lastName,
			isPrimary: table.clientUser.isPrimary,
			onboardingTourCompleted: table.clientUserPreferences.onboardingTourCompleted,
			onboardingTourEnabled: table.clientUserPreferences.onboardingTourEnabled,
			onboardingChecklist: table.clientUserPreferences.onboardingChecklist
		})
		.from(table.clientUser)
		.innerJoin(table.user, eq(table.clientUser.userId, table.user.id))
		.leftJoin(table.clientUserPreferences, eq(table.clientUserPreferences.clientUserId, table.clientUser.id))
		.where(
			and(
				eq(table.clientUser.clientId, clientId),
				eq(table.clientUser.tenantId, event.locals.tenant.id)
			)
		);

	return rows.map((r) => ({
		clientUserId: r.clientUserId,
		email: r.email,
		firstName: r.firstName,
		lastName: r.lastName,
		isPrimary: r.isPrimary,
		onboardingTourCompleted: r.onboardingTourCompleted ?? false,
		onboardingTourEnabled: r.onboardingTourEnabled ?? true,
		onboardingChecklist: r.onboardingChecklist
	}));
});
