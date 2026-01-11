import type { HookEvent, HookHandler, HooksManager } from './types';

/**
 * Hooks manager implementation
 */
class HooksManagerImpl implements HooksManager {
	private handlers: Map<string, Set<HookHandler>> = new Map();

	/**
	 * Register a hook handler for a specific event type
	 */
	on<T extends HookEvent>(eventType: T['type'], handler: HookHandler<T>): void {
		if (!this.handlers.has(eventType)) {
			this.handlers.set(eventType, new Set());
		}
		this.handlers.get(eventType)!.add(handler as HookHandler);
	}

	/**
	 * Emit an event and call all registered handlers
	 */
	async emit<T extends HookEvent>(event: T): Promise<void> {
		const eventType = event.type;
		const handlers = this.handlers.get(eventType);

		if (!handlers || handlers.size === 0) {
			return;
		}

		// Execute all handlers in parallel, but don't fail if one fails
		const promises = Array.from(handlers).map(async (handler) => {
			try {
				await handler(event);
			} catch (error) {
				console.error(`[Hooks] Error in handler for ${eventType}:`, error);
				// Don't throw - continue with other handlers
			}
		});

		await Promise.allSettled(promises);
	}

	/**
	 * Remove a hook handler
	 */
	off<T extends HookEvent>(eventType: T['type'], handler: HookHandler<T>): void {
		const handlers = this.handlers.get(eventType);
		if (handlers) {
			handlers.delete(handler as HookHandler);
		}
	}

	/**
	 * Clear all handlers for an event type
	 */
	clear(eventType: string): void {
		this.handlers.delete(eventType);
	}

	/**
	 * Clear all handlers
	 */
	clearAll(): void {
		this.handlers.clear();
	}
}

// Singleton instance
let hooksManagerInstance: HooksManager | null = null;

/**
 * Get the global hooks manager instance
 */
export function getHooksManager(): HooksManager {
	if (!hooksManagerInstance) {
		hooksManagerInstance = new HooksManagerImpl();
	}
	return hooksManagerInstance;
}

/**
 * Reset the hooks manager (useful for testing)
 */
export function resetHooksManager(): void {
	hooksManagerInstance = null;
}
