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
	email: v.pipe(v.string(), v.email('Invalid email address')),
	firstName: v.pipe(v.string(), v.minLength(1, 'First name is required')),
	lastName: v.pipe(v.string(), v.minLength(1, 'Last name is required')),
	password: v.pipe(v.string(), v.minLength(6, 'Password must be at least 6 characters')),
	passwordConfirm: v.pipe(
		v.string(),
		v.minLength(6, 'Password confirmation must be at least 6 characters')
	),
	tenantName: v.optional(v.pipe(v.string(), v.minLength(1, 'Organization name is required'))),
	tenantSlug: v.optional(v.pipe(v.string(), v.minLength(1, 'Organization slug is required'))),
	invitationToken: v.optional(v.pipe(v.string(), v.minLength(1))),
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

	const {
		email,
		firstName,
		lastName,
		password,
		passwordConfirm,
		tenantName,
		tenantSlug,
		invitationToken,
		...tenantData
	} = data;

	// Validate password match
	if (password !== passwordConfirm) {
		throw new Error('Parolele nu coincid.');
	}

	if (password.length < 8) {
		throw new Error('Parola trebuie să aibă cel puțin 8 caractere.');
	}

	// Normalize email
	const normalizedEmail = email.trim().toLowerCase();

	// Check email uniqueness
	const [existingUser] = await db
		.select({ id: table.user.id })
		.from(table.user)
		.where(eq(table.user.email, normalizedEmail))
		.limit(1);
	if (existingUser) {
		throw new Error('Acest email are deja un cont. Loghează-te în loc să creezi unul nou.');
	}

	// If invitation token provided, validate it and get invitation details
	let invitation = null;
	let tenantId = null;
	let tenantSlugToUse = null;
	let role = 'member';

	if (invitationToken) {
		const [invitationRecord] = await db
			.select()
			.from(table.invitation)
			.where(eq(table.invitation.token, invitationToken))
			.limit(1);

		if (!invitationRecord) {
			throw new Error('Token de invitație invalid.');
		}

		if (invitationRecord.status === 'cancelled') {
			throw new Error('Această invitație a fost anulată.');
		}
		if (invitationRecord.status === 'accepted') {
			throw new Error('Invitația a fost deja acceptată.');
		}
		if (invitationRecord.status === 'expired') {
			throw new Error('Invitația a expirat.');
		}
		if (invitationRecord.status !== 'pending') {
			throw new Error(`Invitație inactivă (${invitationRecord.status}).`);
		}

		if (invitationRecord.expiresAt < new Date()) {
			await db
				.update(table.invitation)
				.set({ status: 'expired' })
				.where(eq(table.invitation.id, invitationRecord.id));
			throw new Error('Invitația a expirat.');
		}

		// Validate email matches invitation (case-insensitive)
		if (normalizedEmail !== invitationRecord.email.trim().toLowerCase()) {
			throw new Error('Email-ul nu corespunde invitației.');
		}

		invitation = invitationRecord;
		tenantId = invitationRecord.tenantId;
		role = invitationRecord.role;

		// Get tenant slug
		const [tenant] = await db
			.select({ slug: table.tenant.slug })
			.from(table.tenant)
			.where(eq(table.tenant.id, tenantId))
			.limit(1);

		if (!tenant) {
			throw new Error('Organizația nu mai există.');
		}

		tenantSlugToUse = tenant.slug;
	} else {
		// Regular registration - create new tenant
		if (!tenantName || !tenantSlug) {
			throw new Error('Organization name and slug are required');
		}

		// Check tenant slug uniqueness
		const slugAvailable = await tenantUtils.validateTenantSlug(tenantSlug);
		if (!slugAvailable) {
			throw new Error('Organization slug is already taken');
		}

		// Check CUI uniqueness if provided
		if (tenantData.cui) {
			const [existingTenantWithCui] = await db
				.select()
				.from(table.tenant)
				.where(eq(table.tenant.cui, tenantData.cui))
				.limit(1);
			if (existingTenantWithCui) {
				throw new Error('An organization with this CUI is already registered');
			}
		}
	}

	// Hash password
	const passwordHash = await hash(password, {
		memoryCost: 19456,
		timeCost: 2,
		outputLen: 32,
		parallelism: 1
	});

	// Generate user ID
	const userId = generateUserId();

	// Create user, tenant (if needed), and tenantUser in a transaction
	try {
		await db.transaction(async (tx) => {
			// Create user
			await tx.insert(table.user).values({
				id: userId,
				email: invitation ? invitation.email : email,
				firstName,
				lastName,
				passwordHash
			});

			if (invitation) {
				// User is joining existing tenant via invitation
				const tenantUserId = generateTenantUserId();
				await tx.insert(table.tenantUser).values({
					id: tenantUserId,
					tenantId: invitation.tenantId,
					userId,
					role
				});

				// Mark invitation as accepted
				await tx
					.update(table.invitation)
					.set({ status: 'accepted', acceptedAt: new Date() })
					.where(eq(table.invitation.id, invitation.id));
			} else {
				// Regular registration - create new tenant
				const newTenantId = generateTenantId();
				const tenantUserId = generateTenantUserId();

				await tx.insert(table.tenant).values({
					id: newTenantId,
					name: tenantName!,
					slug: tenantSlug!,
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

				await tx.insert(table.tenantUser).values({
					id: tenantUserId,
					tenantId: newTenantId,
					userId,
					role: 'owner'
				});

				tenantId = newTenantId;
				tenantSlugToUse = tenantSlug!;
			}
		});
	} catch (error: any) {
		// Handle unique constraint violations
		const errorMessage = error?.message || error?.toString() || String(error);
		const errorCode = error?.code;
		const errorStack = error?.stack || '';

		// Check for various SQLite/libsql unique constraint error patterns
		const isUniqueError =
			errorCode === 'SQLITE_CONSTRAINT_UNIQUE' ||
			errorCode === 'SQLITE_CONSTRAINT' ||
			errorMessage.includes('UNIQUE constraint failed') ||
			errorMessage.includes('unique constraint') ||
			errorMessage.includes('UNIQUE constraint') ||
			errorMessage.includes('Failed query') ||
			errorStack.includes('UNIQUE');

		if (isUniqueError) {
			// Check which field caused the violation
			if (
				errorMessage.includes('slug') ||
				errorMessage.includes('tenant_slug_unique') ||
				errorStack.includes('slug')
			) {
				throw new Error('Organization slug is already taken. Please choose a different one.');
			}
			if (
				errorMessage.includes('cui') ||
				errorMessage.includes('tenant_cui_unique') ||
				errorStack.includes('cui')
			) {
				throw new Error('An organization with this CUI is already registered.');
			}
			if (
				errorMessage.includes('email') ||
				errorMessage.includes('user_email_unique') ||
				errorStack.includes('email')
			) {
				throw new Error('Email is already registered.');
			}
			// Generic unique constraint error - likely tenant-related since we check email before transaction
			if (errorMessage.includes('tenant') || errorMessage.includes('Failed query')) {
				// If it's a tenant insert error and we're creating a new tenant, it's likely slug or CUI
				if (!invitation) {
					throw new Error(
						'An organization with this slug or CUI already exists. Please verify that both the organization slug and CUI are unique and try again.'
					);
				}
			}
			throw new Error('A record with this information already exists. Please check your input.');
		}

		// Re-throw original error if not a unique constraint
		// Log full error for debugging
		console.error('Registration error details:', {
			message: errorMessage,
			code: errorCode,
			error: error,
			tenantSlug,
			cui: tenantData.cui
		});
		throw error;
	}

	// Create session
	const sessionToken = auth.generateSessionToken();
	const session = await auth.createSession(sessionToken, userId);
	auth.setSessionTokenCookie(event, sessionToken, session.expiresAt);

	return {
		success: true,
		userId,
		tenantId,
		tenantSlug: tenantSlugToUse
	};
});
