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
import { logInfo } from '$lib/server/logger';

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
		logInfo('banking', 'Revolut: Client initialized', { metadata: { clientId, baseUrl, dev } });
	}

	/**
	 * Extract domain from redirect URI for JWT iss field
	 * According to Revolut docs, iss should be the domain (e.g., "example.com"),
	 * not the full URI (e.g., "https://example.com/callback")
	 */
	private getDomainFromUri(uri: string): string {
		try {
			const url = new URL(uri);
			return url.hostname + (url.port ? `:${url.port}` : '');
		} catch {
			// Fallback: simple regex extraction
			return uri.replace(/^https?:\/\//, '').split('/')[0];
		}
	}

	/**
	 * Generate JWT client assertion for Revolut API
	 * The JWT must be signed with RS256 using the private key
	 */
	private generateClientAssertionJWT(): string {
		const now = Math.floor(Date.now() / 1000);
		const exp = now + 3600; // 1 hour expiration

		const payload = {
			iss: this.getDomainFromUri(this.redirectUri), // Domain from redirect URI (e.g., "example.com")
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

			const accounts = response || [];

			// Fetch bank details for each account in parallel
			const bankDetailsPromises = accounts.map(async (acc: any) => {
				try {
					const bankDetailsResponse = await this.apiRequest<any>(
						accessToken,
						`/accounts/${acc.id}/bank-details`
					);
					// Bank details returns an array, get the first item if available
					if (Array.isArray(bankDetailsResponse) && bankDetailsResponse.length > 0) {
						return { accountId: acc.id, bankDetails: bankDetailsResponse[0] };
					}
					return { accountId: acc.id, bankDetails: null };
				} catch (error) {
					// If bank details can't be fetched, continue without them
					return { accountId: acc.id, bankDetails: null };
				}
			});

			const bankDetailsResults = await Promise.allSettled(bankDetailsPromises);

			// Create a map of account ID to bank details
			const bankDetailsMap = new Map<string, any>();
			bankDetailsResults.forEach((result) => {
				if (result.status === 'fulfilled' && result.value.bankDetails) {
					bankDetailsMap.set(result.value.accountId, result.value.bankDetails);
				}
			});

			// Map accounts with bank details
			return accounts.map((acc: any) => {
				const bankDetails = bankDetailsMap.get(acc.id);
				// Use IBAN from bank details if available, otherwise fall back to account data
				const iban = bankDetails?.iban || acc.iban || acc.account_number || '';

				return {
					id: acc.id,
					accountId: acc.id,
					iban: iban,
					accountName: acc.name || '',
					currency: acc.currency || 'EUR'
				};
			});
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
			// Revolut returns array of transactions with legs array: [{ id, type, state, created_at, completed_at, legs: [{ amount, currency, description, ... }], merchant?, ... }]
			if (!Array.isArray(response)) {
				throw new Error('Invalid response format: expected array of transactions');
			}

			return (response || [])
				.filter((txn: any) => {
					// Only process transactions with at least one leg
					return txn.legs && Array.isArray(txn.legs) && txn.legs.length > 0;
				})
				.flatMap((txn: any) => {
					// Map each leg to a separate transaction (most transactions have 1 leg, but some may have multiple)
					return txn.legs.map((leg: any) => {
						// Use bill_amount and bill_currency if available, otherwise use amount and currency
						const amount = leg.bill_amount ?? leg.amount ?? 0;
						const currency = leg.bill_currency ?? leg.currency ?? 'EUR';

						// Build description from various sources
						let description = leg.description || '';
						if (!description && txn.merchant?.name) {
							description = txn.merchant.name;
						}
						if (!description && txn.reference) {
							description = txn.reference;
						}
						if (!description && leg.counterparty?.name) {
							description = leg.counterparty.name;
						}

						// Get counterpart information
						let counterpartIban: string | undefined;
						let counterpartName: string | undefined;

						if (leg.counterparty) {
							// Counterparty info from leg
							if (leg.counterparty.account_type === 'revolut') {
								// Revolut account - no IBAN available
								counterpartName = leg.counterparty.name;
							} else if (leg.counterparty.account_type === 'external') {
								// External account
								counterpartIban = leg.counterparty.iban;
								counterpartName = leg.counterparty.name;
							}
						}

						// Merchant name takes precedence for counterpart name
						if (txn.merchant?.name) {
							counterpartName = txn.merchant.name;
						}

						// Use completed_at if available, otherwise created_at
						const date = txn.completed_at || txn.created_at || txn.updated_at;

						// Build reference from transaction reference or request_id
						const reference = txn.reference || txn.request_id || leg.leg_id;

						// Category from merchant
						const category = txn.merchant?.category_code;

						return {
							transactionId: `${txn.id}-${leg.leg_id}`, // Include leg_id to make unique if multiple legs
							amount: Math.round(amount * 100), // Convert to cents (amounts may be negative)
							currency: currency,
							date: new Date(date),
							description: description || '',
							reference: reference,
							counterpartIban: counterpartIban,
							counterpartName: counterpartName,
							category: category
						};
					});
				});
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
