/**
 * Banking integration types
 */

export type BankName = 'revolut' | 'transilvania' | 'bcr';

export interface BankAccountInfo {
	id: string;
	accountId: string;
	iban: string;
	accountName?: string;
	currency: string;
}

export interface BankTransaction {
	transactionId: string;
	amount: number; // in cents, negative for outgoing
	currency: string;
	date: Date;
	description?: string;
	reference?: string;
	counterpartIban?: string;
	counterpartName?: string;
	category?: string;
}

export interface OAuthTokens {
	accessToken: string;
	refreshToken: string;
	expiresAt: Date;
}

export interface BankClient {
	getAuthorizationUrl(state: string, redirectUri: string): string;
	exchangeCodeForTokens(code: string, redirectUri: string): Promise<OAuthTokens>;
	refreshTokens(refreshToken: string): Promise<OAuthTokens>;
	getAccounts(accessToken: string): Promise<BankAccountInfo[]>;
	getTransactions(
		accessToken: string,
		accountId: string,
		fromDate?: Date,
		toDate?: Date
	): Promise<BankTransaction[]>;
	revokeToken?(token: string): Promise<void>;
}
