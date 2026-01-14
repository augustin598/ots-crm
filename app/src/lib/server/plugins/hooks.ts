import type { HookEvent, HookHandler, HooksManager } from './types';

/**
 * Handler registration info for tracking by plugin
 */
type HandlerRegistration = {
	handler: HookHandler;
	pluginId: string;
};

/**
 * Hooks manager implementation
 */
class HooksManagerImpl implements HooksManager {
	private handlers: Map<string, Set<HookHandler>> = new Map();
	private handlerRegistrations: Map<HookHandler, HandlerRegistration> = new Map();

	/**
	 * Register a hook handler for a specific event type
	 */
	on<T extends HookEvent>(eventType: T['type'], handler: HookHandler<T>, pluginId?: string): void {
		if (!this.handlers.has(eventType)) {
			this.handlers.set(eventType, new Set());
		}
		this.handlers.get(eventType)!.add(handler as HookHandler);

		// Track handler registration by plugin ID if provided
		if (pluginId) {
			this.handlerRegistrations.set(handler as HookHandler, {
				handler: handler as HookHandler,
				pluginId
			});
		}
	}

	/**
	 * Clear all handlers for a specific plugin
	 */
	clearPluginHandlers(pluginId: string): void {
		const handlersToRemove: HookHandler[] = [];

		// Find all handlers registered by this plugin
		for (const [handler, registration] of this.handlerRegistrations.entries()) {
			if (registration.pluginId === pluginId) {
				handlersToRemove.push(handler);
			}
		}

		// Remove handlers from all event types
		for (const handler of handlersToRemove) {
			for (const handlers of this.handlers.values()) {
				handlers.delete(handler);
			}
			this.handlerRegistrations.delete(handler);
		}
	}

	/**
	 * Emit an event and call all registered handlers
	 * If any handler fails, the error is thrown and propagated
	 */
	async emit<T extends HookEvent>(event: T): Promise<void> {
		const eventType = event.type;
		const handlers = this.handlers.get(eventType);

		if (!handlers || handlers.size === 0) {
			return;
		}

		// Execute all handlers in parallel
		// If any handler fails, the error is thrown and propagated
		const promises = Array.from(handlers).map((handler) => handler(event));

		await Promise.all(promises);
	}

	/**
	 * Remove a hook handler
	 */
	off<T extends HookEvent>(eventType: T['type'], handler: HookHandler<T>): void {
		const handlers = this.handlers.get(eventType);
		if (handlers) {
			handlers.delete(handler as HookHandler);
		}
		this.handlerRegistrations.delete(handler as HookHandler);
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
		this.handlerRegistrations.clear();
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
