import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { GoogleAdsApi } from 'google-ads-api';
import { getAuthenticatedClient } from '$lib/server/google-ads/auth';
import { fetchBillingSetupStatus, formatCustomerId } from '$lib/server/google-ads/client';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw error(403, 'Forbidden');
	}

	const customerId = formatCustomerId(event.params.customerId!);
	const tenantId = event.locals.tenant.id;

	const [account] = await db
		.select()
		.from(table.googleAdsAccount)
		.where(
			and(
				eq(table.googleAdsAccount.tenantId, tenantId),
				eq(table.googleAdsAccount.googleAdsCustomerId, customerId),
			),
		)
		.limit(1);
	if (!account) throw error(404, 'customer not found for tenant');

	const auth = await getAuthenticatedClient(tenantId);
	if (!auth) throw error(500, 'no auth');

	const { integration } = auth;
	const cleanMcc = formatCustomerId(integration.mccAccountId);

	const client = new GoogleAdsApi({
		client_id: env.GOOGLE_CLIENT_ID!,
		client_secret: env.GOOGLE_CLIENT_SECRET!,
		developer_token: integration.developerToken,
	});

	const customer = client.Customer({
		customer_id: customerId,
		login_customer_id: cleanMcc,
		refresh_token: integration.refreshToken,
	});

	const customerRows = await customer.query(`
		SELECT customer.id, customer.status, customer.suspension_reasons
		FROM customer
		LIMIT 1
	`);

	const billingSetup = await fetchBillingSetupStatus(
		integration.mccAccountId,
		customerId,
		integration.developerToken,
		integration.refreshToken,
	);

	return json({
		storedPaymentStatus: account.paymentStatus,
		storedPaymentStatusRaw: account.paymentStatusRaw,
		customerRaw: customerRows,
		billingSetupStatus: billingSetup,
	});
};
