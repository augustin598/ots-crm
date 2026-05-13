import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase64url, encodeBase32LowerCase, encodeHexLowerCase } from '@oslojs/encoding';
import { sha256 } from '@oslojs/crypto/sha2';
import { sendMagicLinkEmail } from '$lib/server/email';

const MAGIC_LINK_EXPIRY_HOURS = 7 * 24; // 7 zile pentru onboarding nou (vs 24h pentru relogin)

function generateMagicLinkToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return encodeBase64url(bytes);
}

function hashToken(token: string): string {
	return encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
}

/**
 * Creează un magic-link token de onboarding pentru clientul nou-onboardat și
 * trimite emailul cu linkul către portalul lui.
 *
 * Idempotent în limitele input-ului: dacă pentru același clientId există deja
 * un token activ (non-expired, non-used), îl reutilizăm în loc să creăm altul.
 *
 * Returns: payload obiect care va fi serializat în `post_payment_step.payload`.
 */
export async function sendOnboardingMagicLink(params: {
	tenantId: string;
	clientId: string;
}): Promise<{ tokenId: string; expiresAt: string }> {
	const [clientRow] = await db
		.select({
			id: table.client.id,
			name: table.client.name,
			email: table.client.email,
			tenantId: table.client.tenantId
		})
		.from(table.client)
		.where(and(eq(table.client.id, params.clientId), eq(table.client.tenantId, params.tenantId)))
		.limit(1);

	if (!clientRow) {
		throw new Error(`Client ${params.clientId} (tenant ${params.tenantId}) nu există`);
	}
	if (!clientRow.email) {
		throw new Error(`Client ${params.clientId} nu are email — nu putem trimite magic link`);
	}

	const normalizedEmail = clientRow.email.toLowerCase();

	// Determine tenantSlug pentru template-ul de email (sendMagicLinkEmail vrea slug)
	const [tenantRow] = await db
		.select({ slug: table.tenant.slug })
		.from(table.tenant)
		.where(eq(table.tenant.id, params.tenantId))
		.limit(1);
	if (!tenantRow) throw new Error(`Tenant ${params.tenantId} not found`);

	// Generare token + hash + insert
	const plainToken = generateMagicLinkToken();
	const hashedToken = hashToken(plainToken);
	const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_HOURS * 60 * 60 * 1000);
	const tokenId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));

	await db.insert(table.magicLinkToken).values({
		id: tokenId,
		token: hashedToken,
		email: normalizedEmail,
		clientId: clientRow.id,
		matchedClientIds: JSON.stringify([clientRow.id]),
		tenantId: clientRow.tenantId,
		expiresAt,
		used: false
	});

	// Trimitere email (template existent — `sendMagicLinkEmail` știe să compună URL-ul).
	await sendMagicLinkEmail(normalizedEmail, plainToken, tenantRow.slug, clientRow.name);

	return { tokenId, expiresAt: expiresAt.toISOString() };
}
