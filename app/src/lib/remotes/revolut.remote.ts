import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { encryptToken, decryptToken } from '$lib/server/plugins/banking/shared/crypto';
import forge from 'node-forge';

function generateIntegrationId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

/**
 * Generate RSA key pair and X.509 certificate for Revolut API
 */
function generateCertificate(): { privateKey: string; publicCertificate: string } {
	// Generate RSA key pair
	const keys = forge.pki.rsa.generateKeyPair(2048);

	// Create a self-signed certificate
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(19));
	cert.validity.notBefore = new Date();
	cert.validity.notAfter = new Date();
	cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 5); // 5 years validity

	// Set certificate attributes
	const attrs = [
		{ name: 'countryName', value: 'RO' },
		{ name: 'organizationName', value: 'Revolut Integration' },
		{ name: 'commonName', value: 'Revolut API Certificate' }
	];
	cert.setSubject(attrs);
	cert.setIssuer(attrs);

	// Set certificate extensions
	cert.setExtensions([
		{
			name: 'basicConstraints',
			cA: false
		},
		{
			name: 'keyUsage',
			keyCertSign: false,
			digitalSignature: true,
			nonRepudiation: true,
			keyEncipherment: false,
			dataEncipherment: false
		}
	]);

	// Sign certificate with private key
	cert.sign(keys.privateKey);

	// Convert to PEM format
	const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
	const publicCertPem = forge.pki.certificateToPem(cert);

	return {
		privateKey: privateKeyPem,
		publicCertificate: publicCertPem
	};
}

export const getRevolutConfig = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Only owners and admins can view Revolut config
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw new Error('Insufficient permissions');
	}

	const [config] = await db
		.select()
		.from(table.revolutIntegration)
		.where(eq(table.revolutIntegration.tenantId, event.locals.tenant.id))
		.limit(1);

	// Generate the expected redirect URI based on current URL
	const expectedRedirectUri = `${event.url.origin}/${event.locals.tenant.slug}/settings/banking/callback`;

	if (!config) {
		return {
			isConfigured: false,
			clientId: null,
			publicCertificate: null,
			redirectUri: null,
			expectedRedirectUri: expectedRedirectUri
		};
	}

	return {
		isConfigured: true,
		clientId: config.clientId,
		publicCertificate: config.publicCertificate,
		redirectUri: config.redirectUri,
		expectedRedirectUri: expectedRedirectUri
	};
});

export const generateRevolutCertificate = command(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Only owners and admins can generate certificates
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw new Error('Insufficient permissions');
	}

	// Generate certificate
	const { privateKey, publicCertificate } = generateCertificate();

	// Encrypt private key
	const encryptedPrivateKey = encryptToken(event.locals.tenant.id, privateKey);

	// Check if configuration already exists
	const [existing] = await db
		.select()
		.from(table.revolutIntegration)
		.where(eq(table.revolutIntegration.tenantId, event.locals.tenant.id))
		.limit(1);

	if (existing) {
		// Update existing configuration
		await db
			.update(table.revolutIntegration)
			.set({
				privateKey: encryptedPrivateKey,
				publicCertificate: publicCertificate,
				updatedAt: new Date()
			})
			.where(eq(table.revolutIntegration.tenantId, event.locals.tenant.id));
	} else {
		// Create new configuration
		const integrationId = generateIntegrationId();
		await db.insert(table.revolutIntegration).values({
			id: integrationId,
			tenantId: event.locals.tenant.id,
			privateKey: encryptedPrivateKey,
			publicCertificate: publicCertificate,
			isActive: true
		});
	}

	return {
		success: true,
		publicCertificate: publicCertificate
	};
});

export const updateRevolutConfig = command(
	v.object({
		clientId: v.optional(v.string()),
		redirectUri: v.optional(v.string())
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Only owners and admins can update config
		if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
			throw new Error('Insufficient permissions');
		}

		// Check if configuration exists
		const [existing] = await db
			.select()
			.from(table.revolutIntegration)
			.where(eq(table.revolutIntegration.tenantId, event.locals.tenant.id))
			.limit(1);

		if (!existing) {
			throw new Error('Certificate not generated. Please generate a certificate first.');
		}

		// Update configuration
		const updateData: Partial<typeof table.revolutIntegration.$inferInsert> = {
			updatedAt: new Date()
		};

		if (data.clientId !== undefined) {
			updateData.clientId = data.clientId || null;
		}
		if (data.redirectUri !== undefined) {
			updateData.redirectUri = data.redirectUri || null;
		}

		await db
			.update(table.revolutIntegration)
			.set(updateData)
			.where(eq(table.revolutIntegration.tenantId, event.locals.tenant.id));

		return { success: true };
	}
);

export const deleteRevolutConfig = command(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Only owners and admins can delete config
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw new Error('Insufficient permissions');
	}

	await db
		.delete(table.revolutIntegration)
		.where(eq(table.revolutIntegration.tenantId, event.locals.tenant.id));

	return { success: true };
});
