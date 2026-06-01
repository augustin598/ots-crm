import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { createDAClient } from '$lib/server/plugins/directadmin/factory';
import { runWithAudit, withAccountLock } from '$lib/server/plugins/directadmin/audit';
import { DirectAdminApiError } from '$lib/server/plugins/directadmin/client';
import { encrypt } from '$lib/server/plugins/smartbill/crypto';
import { logInfo, logWarning } from '$lib/server/logger';
import { withTursoBusyRetry } from '$lib/server/plugins/keez/db-retry';
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
 * Resolvare domeniu (în ordinea priorității):
 *   1. `params.domain` — pasat explicit de caller (override total).
 *   2. `hostingInquiry.requestedDomain` — domeniul introdus de client în
 *      formular (când `inquiryId` e dat).
 *   3. Primul `hostingInquiryItem.domainName` non-null din inquiry (când
 *      `inquiryId` e dat) — pentru comenzi multi-item cu domeniu separat.
 *   4. Placeholder `{username}.hosting-temp.ots` — fallback de ultimă instanță,
 *      doar dacă niciuna dintre sursele de mai sus nu are date. Staff editează
 *      ulterior domeniul real în CRM.
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
	 *
	 * When provided, ALSO populates the domain from `inquiry.requestedDomain`
	 * (or `hosting_inquiry_item.domainName` fallback) — replacing the previous
	 * `{username}.hosting-temp.ots` placeholder behaviour. See docstring.
	 */
	inquiryId?: string;
	/**
	 * Optional explicit domain override. Bypasses the inquiry lookup entirely.
	 * Use only when caller has already verified the domain (e.g. admin manual
	 * provisioning form). When unset, falls back to inquiry → item → placeholder.
	 */
	domain?: string;
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
	//
	// We ALSO read `requestedDomain` in the same query to avoid a second
	// round-trip later when we need to pick the domain. `requestedDomain` is
	// the value the customer typed on /pachete-hosting.
	let inquiryRequestedDomain: string | null = null;
	if (params.inquiryId) {
		const [inquiry] = await db
			.select({
				hostingAccountId: table.hostingInquiry.hostingAccountId,
				requestedDomain: table.hostingInquiry.requestedDomain
			})
			.from(table.hostingInquiry)
			.where(
				and(
					eq(table.hostingInquiry.id, params.inquiryId),
					eq(table.hostingInquiry.tenantId, params.tenantId)
				)
			)
			.limit(1);
		inquiryRequestedDomain = inquiry?.requestedDomain ?? null;
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

	// Generează credențiale + seed (păstrat pentru retry)
	const seed = clientRow.businessName || clientRow.name || clientRow.email.split('@')[0];
	let daUsername = generateDaUsername(seed);
	let daPassword = generateDaPassword();

	// Resolvare domeniu real, în ordinea priorității (vezi docstring):
	//   1) params.domain (override explicit)
	//   2) inquiry.requestedDomain (citit deja mai sus dacă inquiryId e dat)
	//   3) primul hostingInquiryItem cu domain_name non-null
	//   4) placeholder `{username}.hosting-temp.ots` ca ultim resort
	let resolvedDomain: string | null = null;
	let domainSource: 'param' | 'inquiry.requestedDomain' | 'inquiry_item.domainName' | 'placeholder' =
		'placeholder';

	if (params.domain && params.domain.trim()) {
		resolvedDomain = params.domain.trim().toLowerCase();
		domainSource = 'param';
	} else if (inquiryRequestedDomain && inquiryRequestedDomain.trim()) {
		resolvedDomain = inquiryRequestedDomain.trim().toLowerCase();
		domainSource = 'inquiry.requestedDomain';
	} else if (params.inquiryId) {
		// Fallback secund: itemii de pe inquiry (cazuri cu items multiple).
		const items = await db
			.select({ domainName: table.hostingInquiryItem.domainName })
			.from(table.hostingInquiryItem)
			.where(
				and(
					eq(table.hostingInquiryItem.inquiryId, params.inquiryId),
					eq(table.hostingInquiryItem.tenantId, params.tenantId)
				)
			);
		const itemDomain = items
			.map((i) => i.domainName?.trim())
			.find((d): d is string => !!d && d.length > 0);
		if (itemDomain) {
			resolvedDomain = itemDomain.toLowerCase();
			domainSource = 'inquiry_item.domainName';
		}
	}

	// M12 (audit 2026-05-31): never provision a DA account with an invalid
	// placeholder domain. The old fallback `${daUsername}.hosting-temp.ots` has a
	// non-real `.ots` TLD → DA created a broken account the customer was then sent
	// credentials for. When NO real domain was resolved from any source, fail
	// cleanly: the dispatcher records da_provision as failed → the customer gets
	// the "cont în curs de activare" email (H4) and staff completes the order by
	// setting the real domain via the admin form, then re-provisions.
	if (!resolvedDomain) {
		logWarning('directadmin', 'provisioning blocked — no real domain resolved (M12)', {
			tenantId: params.tenantId,
			metadata: {
				inquiryId: params.inquiryId,
				clientId: params.clientId,
				productId: params.productId
			}
		});
		throw new Error(
			'domain_missing: niciun domeniu real pentru provisioning — staff trebuie să seteze domeniul și să reia'
		);
	}

	const daClient = createDAClient(params.tenantId, server);
	const MAX_RETRIES = 3;

	logInfo('directadmin', `Provisioning DA — domain source: ${domainSource}, domain: ${resolvedDomain}`, {
		tenantId: params.tenantId,
		metadata: {
			inquiryId: params.inquiryId,
			clientId: params.clientId,
			productId: params.productId,
			domainSource
		}
	});

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		// M6 (audit 2026-05-31): fresh account id PER attempt. It was generated
		// ONCE outside the loop, so on the 2nd username-collision retry the
		// pre-insert below collided on the PRIMARY KEY (the attempt-1 row already
		// exists, now marked `failed`) → the retry threw a PK violation instead of
		// actually retrying. Each attempt now inserts its own row; failed attempts
		// remain as forensic records (consistent with "mark failed, never delete").
		const accountId = generateId();
		// Domeniul rămâne fix peste retries (doar username-ul se schimbă pe collision).
		const domain = resolvedDomain;

		const credentialsEncrypted = encrypt(
			params.tenantId,
			JSON.stringify({ username: daUsername, password: daPassword })
		);

		const result = await withAccountLock(`${params.tenantId}:${daUsername}`, async () => {
			// Pre-insert in `pending` so the audit row's FK to hosting_account is
			// satisfied regardless of DA outcome. See create-account.ts for the
			// originating FK-violation bug fixed in this branch.
			await db.insert(table.hostingAccount).values({
				id: accountId,
				tenantId: params.tenantId,
				clientId: params.clientId,
				daServerId: server.id,
				daPackageId: product.daPackageId,
				hostingProductId: product.id,
				daUsername,
				domain,
				status: 'pending',
				daCredentialsEncrypted: credentialsEncrypted,
				recurringAmount: product.price ?? 0,
				currency: product.currency ?? 'RON',
				billingCycle: product.billingCycle ?? 'monthly',
				stripeSubscriptionId: params.stripeSubscriptionId
			});

			try {
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
							notify: false // magic link CRM, nu email DA
						})
				);

				// DA accepted — promote to active with Turso-busy retry to avoid
				// zombies (DA live, CRM stuck on `pending`).
				await withTursoBusyRetry(
					() =>
						db
							.update(table.hostingAccount)
							.set({ status: 'active', updatedAt: new Date() })
							.where(eq(table.hostingAccount.id, accountId)),
					{ tenantId: params.tenantId, label: 'provisionDA/promote-active' }
				).catch((err) => {
					logWarning(
						'directadmin',
						`zombie risk: DA account ${daUsername} created but CRM promote failed`,
						{
							tenantId: params.tenantId,
							metadata: {
								hostingAccountId: accountId,
								sessionId: params.sessionId,
								error: err instanceof Error ? err.message : String(err)
							}
						}
					);
				});
				return { ok: true as const };
			} catch (err) {
				// Forensic preserve: mark `failed`, never DELETE. Audit log keeps
				// pointing at this row so staff can see the full attempt history
				// per inquiry. Use the typed DA error kind to make filtering easy.
				await db
					.update(table.hostingAccount)
					.set({
						status: 'failed',
						suspendReason:
							err instanceof DirectAdminApiError
								? `da_${err.kind}`
								: 'da_create_failed',
						updatedAt: new Date()
					})
					.where(eq(table.hostingAccount.id, accountId))
					.catch(() => {});
				return { ok: false as const, error: err };
			}
		});

		if (result.ok) {
			logInfo('directadmin', `Auto-provisioned DA account ${daUsername} for client ${params.clientId}`, {
				tenantId: params.tenantId,
				metadata: { hostingAccountId: accountId, sessionId: params.sessionId, daServerId: server.id }
			});
			return { hostingAccountId: accountId, daUsername, domain, created: true };
		}

		const err = result.error;
		if (
			err instanceof DirectAdminApiError &&
			err.kind === 'username_exists' &&
			attempt < MAX_RETRIES
		) {
			logWarning(
				'directadmin',
				`DA username collision auto-provision — retry ${attempt + 1}/${MAX_RETRIES}`,
				{
					tenantId: params.tenantId,
					metadata: {
						hostingAccountId: accountId,
						oldUsername: daUsername,
						sessionId: params.sessionId
					}
				}
			);
			daUsername = generateDaUsername(seed);
			daPassword = generateDaPassword();
			continue;
		}
		throw err;
	}

	// Unreachable safety net — loop returns or throws.
	throw new Error('provisionDirectAdminAccount: exhausted retries');
}
