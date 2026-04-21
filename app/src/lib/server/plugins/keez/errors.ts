/**
 * Shared Keez error types. Lives in its own module so it can be imported
 * from test scripts and non-DB code paths without pulling the full
 * factory / DB graph.
 */

/**
 * 4xx (except 401 which the client already handled) from Keez — never retried.
 * Carries the status code so callers can decide between "log and skip" (404/409)
 * vs "show to user" (403).
 */
export class KeezClientError extends Error {
	readonly status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = 'KeezClientError';
		this.status = status;
	}
}

/**
 * Thrown when stored Keez credentials cannot be decrypted.
 * Callers should catch this to show a user-friendly re-auth prompt instead of a 500.
 */
export class KeezCredentialsCorruptError extends Error {
	public readonly requiresReauth = true;

	constructor(tenantId: string, cause?: unknown) {
		super(
			`Keez credentials for tenant ${tenantId} are corrupted or were encrypted with a different key. ` +
			`Please re-save your Keez integration in Settings.`
		);
		this.name = 'KeezCredentialsCorruptError';
		this.cause = cause;
	}
}
