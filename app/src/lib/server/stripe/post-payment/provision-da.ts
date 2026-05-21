import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { createDAClient } from '$lib/server/plugins/directadmin/factory';
import { runWithAudit, withAccountLock } from '$lib/server/plugins/directadmin/audit';
import { encrypt } from '$lib/server/plugins/smartbill/crypto';
import { logInfo } from '$lib/server/logger';
import { generateDaUsername, generateDaPassword } from '$lib/utils/da-generators';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/**
 * Provisioning DirectAdmin pentru un client nou-onboardat prin Stripe.
 *
 * Idempotent: dacă există deja un hostingAccount linked la sessionId, returnăm
 * payload-ul existent (chemarea repetată e no-op).
 *
 * Domain placeholder: în lipsa unui câmp `domain` în formularul de comandă, folosim
 * `${username}.hosting-temp.ots` (rezolvabil doar intern). Staff va edita domain-ul
 * real în CRM după ce clientul îl comunică.
 */
export async function provisionDirectAdminAccount(params: {
	tenantId: string;
	clientId: string;
	productId: string;
	sessionId: string;
	stripeSubscriptionId: string | null;
	/**
	 * Optional inquiry id. When provided, the helper checks
	 * `hosting_inquiry.hostingAccountId` FIRST as the primary idempotency key.
	 * Closes the race where staff manually accepts OP + provisions (subscription
	 * is null in `hosting_account`), then a delayed Stripe webhook arrives with
	 * the real subscription id and the old (tenant+client+product+sub) lookup
	 * misses → would create a duplicate DA account.
	 */
	inquiryId?: string;
}): Promise<{
	hostingAccountId: string;
	daUsername: string;
	domain: string;
	created: boolean;
}> {
	// Primary idempotency: an inquiry that's already linked to a hosting_account
	// means provisioning happened (via either Stripe or manual). Return that
	// account regardless of subscription-id differences in the existing-key
	// lookup below.
	if (params.inquiryId) {
		const [inquiry] = await db
			.select({ hostingAccountId: table.hostingInquiry.hostingAccountId })
			.from(table.hostingInquiry)
			.where(
				and(
					eq(table.hostingInquiry.id, params.inquiryId),
					eq(table.hostingInquiry.tenantId, params.tenantId)
				)
			)
			.limit(1);
		if (inquiry?.hostingAccountId) {
			const [linked] = await db
				.select({
					id: table.hostingAccount.id,
					daUsername: table.hostingAccount.daUsername,
					domain: table.hostingAccount.domain
				})
				.from(table.hostingAccount)
				.where(
					and(
						eq(table.hostingAccount.id, inquiry.hostingAccountId),
						eq(table.hostingAccount.tenantId, params.tenantId)
					)
				)
				.limit(1);
			if (linked) {
				return {
					hostingAccountId: linked.id,
					daUsername: linked.daUsername,
					domain: linked.domain,
					created: false
				};
			}
			// Inquiry references a non-existent account — staff likely deleted it
			// out-of-band. Fall through and create fresh, then dispatcher's link
			// UPDATE will overwrite the stale id.
		}
	}

	// Secondary idempotency: an account already exists for (tenant, client,
	// product, subscription). Covers same-customer-reorders + early Stripe
	// retries.
	const [existing] = await db
		.select({
			id: table.hostingAccount.id,
			daUsername: table.hostingAccount.daUsername,
			domain: table.hostingAccount.domain
		})
		.from(table.hostingAccount)
		.where(
			and(
				eq(table.hostingAccount.tenantId, params.tenantId),
				eq(table.hostingAccount.clientId, params.clientId),
				eq(table.hostingAccount.hostingProductId, params.productId),
				eq(table.hostingAccount.stripeSubscriptionId, params.stripeSubscriptionId ?? '__no_sub__')
			)
		)
		.limit(1);
	if (existing) {
		return {
			hostingAccountId: existing.id,
			daUsername: existing.daUsername,
			domain: existing.domain,
			created: false
		};
	}

	// Fetch product + server + package + client email
	const [product] = await db
		.select()
		.from(table.hostingProduct)
		.where(
			and(eq(table.hostingProduct.id, params.productId), eq(table.hostingProduct.tenantId, params.tenantId))
		)
		.limit(1);
	if (!product) throw new Error(`hostingProduct ${params.productId} not found`);
	if (!product.daServerId)
		throw new Error(`hostingProduct ${params.productId} nu are daServerId — provisioning blocked`);
	if (!product.daPackageId)
		throw new Error(`hostingProduct ${params.productId} nu are daPackageId — provisioning blocked`);

	const [server] = await db
		.select()
		.from(table.daServer)
		.where(
			and(eq(table.daServer.id, product.daServerId), eq(table.daServer.tenantId, params.tenantId))
		)
		.limit(1);
	if (!server) throw new Error(`daServer ${product.daServerId} not found`);

	const [pkg] = await db
		.select({ daName: table.daPackage.daName })
		.from(table.daPackage)
		.where(eq(table.daPackage.id, product.daPackageId))
		.limit(1);
	const packageName = pkg?.daName ?? 'default';

	const [clientRow] = await db
		.select({
			id: table.client.id,
			email: table.client.email,
			name: table.client.name,
			businessName: table.client.businessName
		})
		.from(table.client)
		.where(and(eq(table.client.id, params.clientId), eq(table.client.tenantId, params.tenantId)))
		.limit(1);
	if (!clientRow) throw new Error(`Client ${params.clientId} not found`);
	if (!clientRow.email)
		throw new Error(`Client ${params.clientId} nu are email — provisioning DA refuzat`);

	// Generează credențiale
	const seed = clientRow.businessName || clientRow.name || clientRow.email.split('@')[0];
	const daUsername = generateDaUsername(seed);
	const daPassword = generateDaPassword();
	const domain = `${daUsername}.hosting-temp.ots`; // Placeholder — staff va edita real domain.

	// Apel DA cu lock + audit
	const daClient = createDAClient(params.tenantId, server);
	const accountId = generateId();

	await withAccountLock(`${params.tenantId}:${daUsername}`, async () => {
		await runWithAudit(
			{
				tenantId: params.tenantId,
				hostingAccountId: accountId,
				daServerId: server.id,
				action: 'create',
				trigger: 'hook:invoice.paid'
			},
			() =>
				daClient.createUserAccount({
					username: daUsername,
					password: daPassword,
					domain,
					email: clientRow.email!,
					package: packageName,
					notify: false // Nu trimitem email DA — folosim magic link CRM
				})
		);

		const credentialsEncrypted = encrypt(
			params.tenantId,
			JSON.stringify({ username: daUsername, password: daPassword })
		);

		await db.insert(table.hostingAccount).values({
			id: accountId,
			tenantId: params.tenantId,
			clientId: params.clientId,
			daServerId: server.id,
			daPackageId: product.daPackageId,
			hostingProductId: product.id,
			daUsername,
			domain,
			status: 'active',
			daCredentialsEncrypted: credentialsEncrypted,
			recurringAmount: product.price ?? 0,
			currency: product.currency ?? 'RON',
			billingCycle: product.billingCycle ?? 'monthly',
			stripeSubscriptionId: params.stripeSubscriptionId
		});
	});

	logInfo('directadmin', `Auto-provisioned DA account ${daUsername} for client ${params.clientId}`, {
		tenantId: params.tenantId,
		metadata: { hostingAccountId: accountId, sessionId: params.sessionId, daServerId: server.id }
	});

	return { hostingAccountId: accountId, daUsername, domain, created: true };
}
