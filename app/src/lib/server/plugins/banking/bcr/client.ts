/**
 * BCR (Banca Comercială Română) Open Banking API Client
 * 
 * Note: This is a placeholder implementation. Actual BCR API endpoints
 * and OAuth flow may differ. Consult BCR's Open Banking documentation
 * for actual implementation details.
 */

import { BaseBankClient } from '../shared/base-client';
import type { OAuthTokens, BankAccountInfo, BankTransaction } from '../shared/types';
import { env } from '$env/dynamic/private';

export class BCRClient extends BaseBankClient {
	constructor() {
		const clientId = env.BCR_CLIENT_ID;
		const clientSecret = env.BCR_CLIENT_SECRET;

		if (!clientId || !clientSecret) {
			throw new Error('BCR_CLIENT_ID and BCR_CLIENT_SECRET must be set');
		}

		// These URLs are placeholders - replace with actual BCR Open Banking URLs
		const baseUrl = env.BCR_API_URL || 'https://api.bcr.ro/open-banking/v1';
		const authorizeUrl = env.BCR_AUTHORIZE_URL || 'https://api.bcr.ro/authorize';
		const tokenUrl = env.BCR_TOKEN_URL || 'https://api.bcr.ro/token';

		super(clientId, clientSecret, baseUrl, authorizeUrl, tokenUrl);
	}

	protected getScopes(): string {
		return 'accounts transactions'; // Adjust based on BCR's actual scopes
	}

	protected parseTokenResponse(data: any): OAuthTokens {
		return {
			accessToken: data.access_token,
			refreshToken: data.refresh_token,
			expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000)
		};
	}

	async getAccounts(accessToken: string): Promise<BankAccountInfo[]> {
		const response = await this.apiRequest<any>(accessToken, '/accounts');

		// Transform BCR API response to our format
		// This is a placeholder - adjust based on actual BCR API response format
		return (response.data?.accounts || response.accounts || []).map((acc: any) => ({
			id: acc.accountId || acc.id,
			accountId: acc.accountId || acc.id,
			iban: acc.iban,
			accountName: acc.accountName || acc.name || acc.productName,
			currency: acc.currency || 'RON'
		}));
	}

	async getTransactions(
		accessToken: string,
		accountId: string,
		fromDate?: Date,
		toDate?: Date
	): Promise<BankTransaction[]> {
		const params = new URLSearchParams({
			accountId: accountId
		});

		if (fromDate) {
			params.append('dateFrom', fromDate.toISOString().split('T')[0]);
		}
		if (toDate) {
			params.append('dateTo', toDate.toISOString().split('T')[0]);
		}

		const response = await this.apiRequest<any>(accessToken, `/accounts/${accountId}/transactions?${params.toString()}`);

		// Transform BCR API response to our format
		// This is a placeholder - adjust based on actual BCR API response format
		return (response.data?.transactions || response.transactions || []).map((txn: any) => ({
			transactionId: txn.transactionId || txn.id,
			amount: Math.round((txn.amount?.value || txn.amount || 0) * 100), // Convert to cents
			currency: txn.amount?.currency || txn.currency || 'RON',
			date: new Date(txn.bookingDate || txn.valueDate || txn.date),
			description: txn.remittanceInformation || txn.description || txn.details,
			reference: txn.endToEndId || txn.reference,
			counterpartIban: txn.debtorAccount?.iban || txn.creditorAccount?.iban,
			counterpartName: txn.debtorAccount?.name || txn.creditorAccount?.name || txn.counterpartyName,
			category: txn.category
		}));
	}
}
