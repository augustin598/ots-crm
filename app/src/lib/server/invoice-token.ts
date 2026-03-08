import { db } from './db';
import * as table from './db/schema';
import { eq, and, gt } from 'drizzle-orm';
import { sha256 } from '@oslojs/crypto/sha2';
import { encodeBase64url, encodeHexLowerCase, encodeBase32LowerCase } from '@oslojs/encoding';

const TOKEN_EXPIRY_DAYS = 90;

function hashToken(token: string): string {
	return encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
}

/**
 * Creates or reuses an invoice view token for public access.
 * Returns the raw (unhashed) token for use in URLs.
 */
export async function createInvoiceViewToken(invoiceId: string, tenantId: string): Promise<string> {
	// Check for existing valid token
	const now = new Date();
	const [existing] = await db
		.select()
		.from(table.invoiceViewToken)
		.where(
			and(
				eq(table.invoiceViewToken.invoiceId, invoiceId),
				eq(table.invoiceViewToken.tenantId, tenantId),
				gt(table.invoiceViewToken.expiresAt, now)
			)
		)
		.limit(1);

	if (existing) {
		// We can't recover the raw token from the hash, so generate a new one
		// but only if we don't have a valid one. Since we store hashed tokens,
		// we always need to generate fresh when called.
	}

	// Generate new token
	const rawBytes = crypto.getRandomValues(new Uint8Array(32));
	const rawToken = encodeBase64url(rawBytes);
	const hashedToken = hashToken(rawToken);
	const tokenId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));

	const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

	await db.insert(table.invoiceViewToken).values({
		id: tokenId,
		token: hashedToken,
		invoiceId,
		tenantId,
		expiresAt
	});

	return rawToken;
}

/**
 * Validates an invoice view token and returns the associated invoice data.
 * Returns null if token is invalid or expired.
 */
export async function validateInvoiceViewToken(tenantSlug: string, rawToken: string) {
	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.slug, tenantSlug))
		.limit(1);

	if (!tenant) return null;

	const hashedToken = hashToken(rawToken);

	const [viewToken] = await db
		.select()
		.from(table.invoiceViewToken)
		.where(
			and(
				eq(table.invoiceViewToken.token, hashedToken),
				eq(table.invoiceViewToken.tenantId, tenant.id)
			)
		)
		.limit(1);

	if (!viewToken) return null;
	if (viewToken.expiresAt < new Date()) return { expired: true } as const;

	const [invoice] = await db
		.select()
		.from(table.invoice)
		.where(eq(table.invoice.id, viewToken.invoiceId))
		.limit(1);

	if (!invoice) return null;

	const lineItems = await db
		.select()
		.from(table.invoiceLineItem)
		.where(eq(table.invoiceLineItem.invoiceId, invoice.id));

	const [client] = await db
		.select()
		.from(table.client)
		.where(eq(table.client.id, invoice.clientId))
		.limit(1);

	const [invoiceSettings] = await db
		.select()
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenant.id))
		.limit(1);

	return { tenant, invoice, lineItems, client, invoiceSettings };
}
