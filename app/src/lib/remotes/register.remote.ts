import { command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { hash } from '@node-rs/argon2';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import * as auth from '$lib/server/auth';
import * as tenantUtils from '$lib/server/tenant';
import { eq } from 'drizzle-orm';

function generateUserId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateTenantId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

function generateTenantUserId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

const registerSchema = v.object({
	username: v.pipe(
		v.string(),
		v.minLength(3, 'Username must be at least 3 characters'),
		v.maxLength(31, 'Username must be at most 31 characters'),
		v.regex(/^[a-z0-9_-]+$/, 'Username can only contain lowercase letters, numbers, underscores, and hyphens')
	),
	password: v.pipe(v.string(), v.minLength(6, 'Password must be at least 6 characters')),
	passwordConfirm: v.pipe(v.string(), v.minLength(6, 'Password confirmation must be at least 6 characters')),
	tenantName: v.pipe(v.string(), v.minLength(1, 'Organization name is required')),
	tenantSlug: v.pipe(v.string(), v.minLength(1, 'Organization slug is required')),
	companyType: v.optional(v.string()),
	cui: v.optional(v.string()),
	registrationNumber: v.optional(v.string()),
	tradeRegister: v.optional(v.string()),
	vatNumber: v.optional(v.string()),
	legalRepresentative: v.optional(v.string()),
	iban: v.optional(v.string()),
	bankName: v.optional(v.string()),
	address: v.optional(v.string()),
	city: v.optional(v.string()),
	county: v.optional(v.string()),
	postalCode: v.optional(v.string()),
	country: v.optional(v.string())
});

export const registerWithTenant = command(registerSchema, async (data) => {
	const event = getRequestEvent();
	if (!event) {
		throw new Error('Request event not available');
	}

	const { username, password, passwordConfirm, tenantName, tenantSlug, ...tenantData } = data;

	// Validate password match
	if (password !== passwordConfirm) {
		throw new Error('Passwords do not match');
	}

	// Check username uniqueness
	const [existingUser] = await db.select().from(table.user).where(eq(table.user.username, username)).limit(1);
	if (existingUser) {
		throw new Error('Username already taken');
	}

	// Check tenant slug uniqueness
	const slugAvailable = await tenantUtils.validateTenantSlug(tenantSlug);
	if (!slugAvailable) {
		throw new Error('Organization slug is already taken');
	}

	// Hash password
	const passwordHash = await hash(password, {
		memoryCost: 19456,
		timeCost: 2,
		outputLen: 32,
		parallelism: 1
	});

	// Generate IDs
	const userId = generateUserId();
	const tenantId = generateTenantId();
	const tenantUserId = generateTenantUserId();

	// Create user, tenant, and tenantUser in a transaction
	await db.transaction(async (tx) => {
		// Create user
		await tx.insert(table.user).values({
			id: userId,
			username,
			passwordHash
		});

		// Create tenant
		await tx.insert(table.tenant).values({
			id: tenantId,
			name: tenantName,
			slug: tenantSlug,
			companyType: tenantData.companyType || null,
			cui: tenantData.cui || null,
			registrationNumber: tenantData.registrationNumber || null,
			tradeRegister: tenantData.tradeRegister || null,
			vatNumber: tenantData.vatNumber || null,
			legalRepresentative: tenantData.legalRepresentative || null,
			iban: tenantData.iban || null,
			bankName: tenantData.bankName || null,
			address: tenantData.address || null,
			city: tenantData.city || null,
			county: tenantData.county || null,
			postalCode: tenantData.postalCode || null,
			country: tenantData.country || 'România'
		});

		// Create tenantUser relationship (user as owner)
		await tx.insert(table.tenantUser).values({
			id: tenantUserId,
			tenantId,
			userId,
			role: 'owner'
		});
	});

	// Create session
	const sessionToken = auth.generateSessionToken();
	const session = await auth.createSession(sessionToken, userId);
	auth.setSessionTokenCookie(event, sessionToken, session.expiresAt);

	return {
		success: true,
		userId,
		tenantId,
		tenantSlug
	};
});
