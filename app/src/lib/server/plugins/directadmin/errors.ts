export { DirectAdminApiError } from './client';

export class DAConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DAConfigurationError';
	}
}

export class DAServerNotFoundError extends Error {
	constructor(serverId: string) {
		super(`DirectAdmin server not found: ${serverId}`);
		this.name = 'DAServerNotFoundError';
	}
}

export class DAHostingAccountNotFoundError extends Error {
	constructor(accountId: string) {
		super(`Hosting account not found: ${accountId}`);
		this.name = 'DAHostingAccountNotFoundError';
	}
}

/**
 * Thrown when the DirectAdmin call succeeded but the subsequent DB write failed.
 * Signals state divergence between DA and CRM that requires manual reconciliation.
 * The outer audit log entry captures this with action='suspend'/'unsuspend' and
 * success=false; the error message indicates the actual DA action was applied.
 */
export class DBSyncFailedError extends Error {
	constructor(
		message: string,
		public daActionApplied: 'suspend' | 'unsuspend' | 'create' | 'delete' | 'package-change',
		public daUsername: string,
		public cause: unknown
	) {
		super(message);
		this.name = 'DBSyncFailedError';
	}
}
