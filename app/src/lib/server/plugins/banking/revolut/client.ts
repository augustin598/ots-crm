/**
 * Revolut Business API Client
 *
 * Uses certificate-based JWT client assertion (RS256) for authentication.
 * Documentation: https://developer.revolut.com/docs/guides/manage-accounts/get-started/make-your-first-api-request
 */

import { BaseBankClient } from '../shared/base-client';
import type { OAuthTokens, BankAccountInfo, BankTransaction } from '../shared/types';
import { env } from '$env/dynamic/private';
import jwt from 'jsonwebtoken';

export class RevolutClient extends BaseBankClient {
	private privateKey: string;
	private redirectUri: string;
	protected dev: boolean = false;

	constructor(config?: {
		clientId: string;
		privateKey: string;
		redirectUri: string;
		baseUrl?: string;
	}) {
		let clientId: string;
		let privateKey: string;
		let redirectUri: string;
		let baseUrl: string;
		let dev: boolean = false;

		if (config) {
			// Use provided config (from database)
			clientId = config.clientId;
			privateKey = config.privateKey;
			redirectUri = config.redirectUri;
			baseUrl =
				config.baseUrl ||
				env.REVOLUT_API_URL ||
				(dev ? 'https://sandbox-b2b.revolut.com/api/1.0' : 'https://b2b.revolut.com/api/1.0');
		} else {
			// Fallback to environment variables (for backward compatibility)
			clientId = env.REVOLUT_CLIENT_ID || '';
			privateKey = env.REVOLUT_PRIVATE_KEY || '';
			redirectUri = env.REVOLUT_REDIRECT_URI || '';
			baseUrl =
				env.REVOLUT_API_URL ||
				(dev ? 'https://sandbox-b2b.revolut.com/api/1.0' : 'https://b2b.revolut.com/api/1.0');
		}

		if (!clientId || !privateKey) {
			throw new Error('REVOLUT_CLIENT_ID and REVOLUT_PRIVATE_KEY must be set');
		}

		if (!redirectUri) {
			throw new Error(
				'REVOLUT_REDIRECT_URI must be set and must match the redirect URI configured in Revolut Business app'
			);
		}

		// Official Revolut Business API endpoints
		// Use sandbox authorization URL in development mode
		const authorizeUrl = dev
			? 'https://sandbox-business.revolut.com/app-confirm'
			: 'https://business.revolut.com/app-confirm';
		const tokenUrl = `${baseUrl}/auth/token`;

		// Pass empty string as clientSecret since we override OAuth methods
		super(clientId, '', baseUrl, authorizeUrl, tokenUrl);

		this.privateKey = privateKey;
		this.redirectUri = redirectUri;
		this.dev = dev;
		console.log('RevolutClient initialized', { clientId, privateKey, redirectUri, baseUrl, dev });
	}

	/**
	 * Generate JWT client assertion for Revolut API
	 * The JWT must be signed with RS256 using the private key
	 */
	private generateClientAssertionJWT(): string {
		const now = Math.floor(Date.now() / 1000);
		const exp = now + 3600; // 1 hour expiration

		const payload = {
			iss: this.redirectUri, // Must match redirect URI configured in Revolut
			sub: this.clientId,
			aud: 'https://revolut.com',
			exp: exp
		};

		return jwt.sign(payload, this.privateKey, {
			algorithm: 'RS256',
			header: {
				alg: 'RS256',
				typ: 'JWT'
			}
		});
	}

	/**
	 * Get OAuth scopes required by Revolut
	 */
	protected getScopes(): string {
		return 'READ,WRITE'; // Revolut uses READ,WRITE scopes
	}

	/**
	 * Generate OAuth2 authorization URL (Revolut format)
	 * Uses the stored redirectUri from config (must match what's configured in Revolut)
	 */
	getAuthorizationUrl(state: string, redirectUri: string): string {
		// For Revolut, always use the stored redirectUri from config
		// It must match what's configured in Revolut Business app and in the JWT iss field
		const params = new URLSearchParams({
			client_id: this.clientId,
			redirect_uri: this.redirectUri, // Use stored redirectUri, not the parameter
			response_type: 'code',
			scope: this.getScopes()
		});

		// Note: state is not included in Revolut's authorization URL
		// You should handle state validation separately if needed
		return `${this.authorizeUrl}?${params.toString()}`;
	}

	/**
	 * Exchange authorization code for access token using JWT client assertion
	 */
	async exchangeCodeForTokens(code: string, redirectUri: string): Promise<OAuthTokens> {
		try {
			const clientAssertion = this.generateClientAssertionJWT();

			const body = new URLSearchParams({
				grant_type: 'authorization_code',
				code: code,
				client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
				client_assertion: clientAssertion
				// Note: redirect_uri is not needed in token exchange for Revolut when using JWT client assertion
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
					errorMessage = errorData.error_description || errorData.error || errorMessage;
				} catch {
					const errorText = await response.text();
					if (errorText) errorMessage = `${errorMessage} ${errorText}`;
				}

				if (response.status === 401) {
					throw new Error(
						`Authentication failed: ${errorMessage}. Check that your private key and client ID are correct.`
					);
				}

				throw new Error(errorMessage);
			}

			const data = await response.json();

			if (!data.access_token) {
				throw new Error('Invalid token response: missing access_token');
			}

			return this.parseTokenResponse(data);
		} catch (error) {
			if (error instanceof Error && error.message.includes('JWT')) {
				throw new Error(
					`JWT generation failed: ${error.message}. Check that REVOLUT_PRIVATE_KEY is a valid RSA private key in PEM format.`
				);
			}
			throw error;
		}
	}

	/**
	 * Refresh access token using JWT client assertion
	 */
	async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
		try {
			const clientAssertion = this.generateClientAssertionJWT();

			const body = new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: refreshToken,
				client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
				client_assertion: clientAssertion
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
				let expiredToken = false;

				try {
					const errorData = await response.json();
					errorMessage = errorData.error_description || errorData.error || errorMessage;

					// Check for expired token error
					if (errorData.error === 'invalid_grant' || errorMessage.includes('expired')) {
						expiredToken = true;
					}
				} catch {
					// If JSON parsing fails, use status code in error message
				}

				if (expiredToken) {
					throw new Error('Refresh token has expired. Please reconnect your Revolut account.');
				}

				if (response.status === 401) {
					throw new Error(
						`Authentication failed: ${errorMessage}. Check that your private key and client ID are correct.`
					);
				}

				throw new Error(errorMessage);
			}

			const data = await response.json();

			if (!data.access_token) {
				throw new Error('Invalid token response: missing access_token');
			}

			return this.parseTokenResponse(data);
		} catch (error) {
			if (error instanceof Error && error.message.includes('JWT')) {
				throw new Error(
					`JWT generation failed: ${error.message}. Check that REVOLUT_PRIVATE_KEY is a valid RSA private key in PEM format.`
				);
			}
			throw error;
		}
	}

	/**
	 * Parse token response from Revolut API
	 */
	protected parseTokenResponse(data: any): OAuthTokens {
		return {
			accessToken: data.access_token,
			refreshToken: data.refresh_token,
			expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000)
		};
	}

	/**
	 * Get accounts from Revolut API
	 */
	async getAccounts(accessToken: string): Promise<BankAccountInfo[]> {
		try {
			const response = await this.apiRequest<any>(accessToken, '/accounts');

			// Revolut returns array directly: [{ id, name, balance, currency, state, ... }]
			if (!Array.isArray(response)) {
				throw new Error('Invalid response format: expected array of accounts');
			}

			return (response || []).map((acc: any) => ({
				id: acc.id,
				accountId: acc.id,
				iban: acc.iban || acc.account_number || '', // Revolut may not always provide IBAN
				accountName: acc.name || '',
				currency: acc.currency || 'EUR'
			}));
		} catch (error) {
			if (error instanceof Error && error.message.includes('401')) {
				throw new Error(
					'Authentication failed: Access token is invalid or expired. Please reconnect your Revolut account.'
				);
			}
			throw error;
		}
	}

	/**
	 * Get transactions from Revolut API
	 */
	async getTransactions(
		accessToken: string,
		accountId: string,
		fromDate?: Date,
		toDate?: Date
	): Promise<BankTransaction[]> {
		try {
			const params = new URLSearchParams();

			// Revolut API typically uses account_id as a query parameter
			if (accountId) {
				params.append('account_id', accountId);
			}

			if (fromDate) {
				params.append('from', fromDate.toISOString());
			}
			if (toDate) {
				params.append('to', toDate.toISOString());
			}

			const endpoint = `/transactions${params.toString() ? `?${params.toString()}` : ''}`;
			const response = await this.apiRequest<any>(accessToken, endpoint);

			// Transform Revolut API response to our format
			// Revolut returns array of transactions: [{ id, created_at, updated_at, completed_at, state, amount, currency, ... }]
			if (!Array.isArray(response)) {
				throw new Error('Invalid response format: expected array of transactions');
			}

			return (response || []).map((txn: any) => ({
				transactionId: txn.id,
				amount: Math.round((txn.amount?.value || txn.amount || 0) * 100), // Convert to cents (amounts may be negative)
				currency: txn.amount?.currency || txn.currency || 'EUR',
				date: new Date(txn.completed_at || txn.created_at || txn.date),
				description: txn.description || txn.merchant?.name || txn.reference || '',
				reference: txn.reference || txn.leg_id,
				counterpartIban: txn.counterparty?.account?.iban,
				counterpartName:
					txn.counterparty?.account?.name || txn.counterparty?.name || txn.merchant?.name,
				category: txn.merchant?.category || txn.tag
			}));
		} catch (error) {
			if (error instanceof Error && error.message.includes('401')) {
				throw new Error(
					'Authentication failed: Access token is invalid or expired. Please reconnect your Revolut account.'
				);
			}
			throw error;
		}
	}
}
