/**
 * Shared Keez error types. Lives in its own module so it can be imported
 * from test scripts and non-DB code paths without pulling the full
 * factory / DB graph.
 */

/**
 * HTTP-error wrapper from the Keez client. Retry behaviour is determined by
 * `status`, not by the type itself:
 *   - 4xx (except 401, which the client handles inline) → permanent. Callers
 *     must NOT retry; classifyKeezError() returns 'permanent'.
 *   - 5xx → transient. The client's inline retry loop keeps retrying while
 *     `status >= 500`; after exhaustion, classifyKeezError() returns
 *     'transient' and retry-policy schedules a delayed cross-run retry.
 * Callers that surface this to users must check `status < 500` first.
 *
 * 404 currently throws a plain `Error('Not found')` from the client and is
 * caught upstream — it does not reach KeezClientError.
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
