/**
 * Base client for bank API integrations
 * Provides common OAuth2 functionality
 */

import type { BankClient, OAuthTokens, BankAccountInfo, BankTransaction } from './types';

export abstract class BaseBankClient implements BankClient {
	protected clientId: string;
	protected clientSecret: string;
	protected baseUrl: string;
	protected tokenUrl: string;
	protected authorizeUrl: string;

	constructor(clientId: string, clientSecret: string, baseUrl: string, authorizeUrl: string, tokenUrl: string) {
		this.clientId = clientId;
		this.clientSecret = clientSecret;
		this.baseUrl = baseUrl;
		this.authorizeUrl = authorizeUrl;
		this.tokenUrl = tokenUrl;
	}

	/**
	 * Generate OAuth2 authorization URL
	 */
	getAuthorizationUrl(state: string, redirectUri: string): string {
		const params = new URLSearchParams({
			client_id: this.clientId,
			redirect_uri: redirectUri,
			response_type: 'code',
			scope: this.getScopes(),
			state: state
		});

		return `${this.authorizeUrl}?${params.toString()}`;
	}

	/**
	 * Exchange authorization code for access token
	 */
	async exchangeCodeForTokens(code: string, redirectUri: string): Promise<OAuthTokens> {
		const response = await fetch(this.tokenUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code: code,
				redirect_uri: redirectUri
			}).toString()
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Failed to exchange code for tokens: ${response.status} ${error}`);
		}

		const data = await response.json();
		return this.parseTokenResponse(data);
	}

	/**
	 * Refresh access token using refresh token
	 */
	async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
		const response = await fetch(this.tokenUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`
			},
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: refreshToken
			}).toString()
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Failed to refresh tokens: ${response.status} ${error}`);
		}

		const data = await response.json();
		return this.parseTokenResponse(data);
	}

	/**
	 * Make authenticated API request
	 */
	protected async apiRequest<T>(accessToken: string, endpoint: string, options?: RequestInit): Promise<T> {
		const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;
		const response = await fetch(url, {
			...options,
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
				...options?.headers
			}
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`API request failed: ${response.status} ${error}`);
		}

		return response.json();
	}

	/**
	 * Get OAuth scopes required by this bank
	 */
	protected abstract getScopes(): string;

	/**
	 * Parse token response from bank API
	 */
	protected abstract parseTokenResponse(data: any): OAuthTokens;

	/**
	 * Get accounts - to be implemented by each bank
	 */
	abstract getAccounts(accessToken: string): Promise<BankAccountInfo[]>;

	/**
	 * Get transactions - to be implemented by each bank
	 */
	abstract getTransactions(
		accessToken: string,
		accountId: string,
		fromDate?: Date,
		toDate?: Date
	): Promise<BankTransaction[]>;

	/**
	 * Revoke token (optional - to be implemented by banks that support it)
	 */
	async revokeToken(token: string): Promise<void> {
		throw new Error('Token revocation not implemented for this bank');
	}
}
