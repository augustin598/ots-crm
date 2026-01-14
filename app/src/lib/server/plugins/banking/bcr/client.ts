/**
 * BCR (Banca Comercială Română) Open Banking API Client
 *
 * Implements OAuth2 flow according to CSAS (Česká spořitelna) OAuth2 specification.
 * Uses CSAS OAuth2 endpoints for authorization and token management.
 */

import { BaseBankClient } from '../shared/base-client';
import type { OAuthTokens, BankAccountInfo, BankTransaction } from '../shared/types';
import { env } from '$env/dynamic/private';

export class BCRClient extends BaseBankClient {
	private environment: 'sandbox' | 'production';
	private revokeUrl: string;

	constructor() {
		const clientId = env.BCR_CLIENT_ID;
		const clientSecret = env.BCR_CLIENT_SECRET;

		if (!clientId || !clientSecret) {
			throw new Error('BCR_CLIENT_ID and BCR_CLIENT_SECRET must be set');
		}

		const baseUrl =
			env.BCR_ENVIRONMENT === 'sandbox'
				? 'https://webapi.developers.erstegroup.com/api/csas/sandbox/v1/sandbox-idp'
				: 'https://bezpecnost.csas.cz/api/psd2/fl/oidc/v1';

		const apiBaseUrl = env.BCR_API_URL || 'https://api.bcr.ro/open-banking/v1';
		const authorizeUrl = `${baseUrl}/auth`;
		const tokenUrl = `${baseUrl}/token`;

		super(clientId, clientSecret, apiBaseUrl, authorizeUrl, tokenUrl);

		// Determine environment (sandbox or production)
		this.environment = (env.BCR_ENVIRONMENT as 'sandbox' | 'production') || 'production';

		// Set base URLs based on environment (CSAS OAuth2 endpoints)

		this.revokeUrl = `${baseUrl}/revokeext`;

		// Base URL for API calls (not OAuth endpoints)
	}

	/**
	 * Generate OAuth2 authorization URL according to CSAS spec
	 */
	getAuthorizationUrl(state: string, redirectUri: string): string {
		const params = new URLSearchParams({
			redirect_uri: redirectUri,
			client_id: this.clientId,
			response_type: 'code',
			state: state,
			access_type: 'offline', // Request refresh token
			scope: this.getScopes()
		});

		return `${this.authorizeUrl}?${params.toString()}`;
	}

	/**
	 * Exchange authorization code for tokens (CSAS format)
	 * Uses form-urlencoded with client_id and client_secret in body
	 */
	async exchangeCodeForTokens(code: string, redirectUri: string): Promise<OAuthTokens> {
		const body = new URLSearchParams({
			code: code,
			client_id: this.clientId,
			client_secret: this.clientSecret,
			redirect_uri: redirectUri,
			grant_type: 'authorization_code'
		});

		const response = await fetch(this.tokenUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body: body.toString()
		});

		if (!response.ok) {
			let errorMessage = `Failed to exchange code for tokens: ${response.status}`;
			try {
				const errorData = await response.json();
				if (errorData.error) {
					errorMessage = `${errorData.error}: ${errorData.error_description || errorMessage}`;
				}
			} catch {
				const errorText = await response.text();
				errorMessage = `${errorMessage} ${errorText}`;
			}
			throw new Error(errorMessage);
		}

		const data = await response.json();
		return this.parseTokenResponse(data);
	}

	/**
	 * Refresh access token using refresh token (CSAS format)
	 */
	async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
		const body = new URLSearchParams({
			client_id: this.clientId,
			client_secret: this.clientSecret,
			grant_type: 'refresh_token',
			refresh_token: refreshToken
		});

		const response = await fetch(this.tokenUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body: body.toString()
		});

		if (!response.ok) {
			let errorMessage = `Failed to refresh tokens: ${response.status}`;
			try {
				const errorData = await response.json();
				if (errorData.error) {
					errorMessage = `${errorData.error}: ${errorData.error_description || errorMessage}`;
				}
			} catch {
				const errorText = await response.text();
				errorMessage = `${errorMessage} ${errorText}`;
			}
			throw new Error(errorMessage);
		}

		const data = await response.json();
		return this.parseTokenResponse(data);
	}

	/**
	 * Revoke token (CSAS format)
	 */
	async revokeToken(token: string): Promise<void> {
		const body = new URLSearchParams({
			token: token
		});

		const response = await fetch(this.revokeUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body: body.toString()
		});

		if (!response.ok) {
			let errorMessage = `Failed to revoke token: ${response.status}`;
			try {
				const errorData = await response.json();
				if (errorData.error) {
					errorMessage = `${errorData.error}: ${errorData.error_description || errorMessage}`;
				}
			} catch {
				const errorText = await response.text();
				errorMessage = `${errorMessage} ${errorText}`;
			}
			throw new Error(errorMessage);
		}
	}

	protected getScopes(): string {
		// CSAS scopes: aisp (Account Information), offline_access (for refresh tokens)
		return 'aisp offline_access';
	}

	protected parseTokenResponse(data: any): OAuthTokens {
		// CSAS response format: access_token, refresh_token, expires_in, scope, token_type
		if (!data.access_token) {
			throw new Error('Missing access_token in response');
		}

		const expiresIn = data.expires_in || 3600; // Default to 1 hour if not provided
		const expiresAt = new Date(Date.now() + expiresIn * 1000);

		return {
			accessToken: data.access_token,
			refreshToken: data.refresh_token || '', // May be empty if offline_access not granted
			expiresAt: expiresAt
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

		const response = await this.apiRequest<any>(
			accessToken,
			`/accounts/${accountId}/transactions?${params.toString()}`
		);

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
