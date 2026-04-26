function describeError(e: Error): string {
	const code = (e as { code?: string }).code;
	const address = (e as { address?: string }).address;
	const port = (e as { port?: number }).port;
	const target = address ? `${address}${port ? `:${port}` : ''}` : '';
	return [code, target, e.message].filter(Boolean).join(' ');
}

/**
 * Serialize any thrown value to `{ message, stack }` for logging.
 *
 * Walks both:
 *  - `AggregateError.errors[]` (Node Happy Eyeballs hides ECONNREFUSED here)
 *  - `error.cause` (Drizzle wraps libSQL/SQLite errors here, so SQLITE_BUSY
 *    and FK-violation hints would otherwise be lost behind a generic "Failed query")
 *
 * Depth-capped at 4 to defend against self-referencing cause chains.
 */
export function serializeError(err: unknown): { message: string; stack?: string } {
	if (err === null || err === undefined) {
		return { message: String(err) };
	}
	const parts: string[] = [];
	let current: unknown = err;
	let stack: string | undefined;
	const seen = new Set<unknown>();
	for (let depth = 0; current && depth < 4; depth++) {
		if (seen.has(current)) break;
		seen.add(current);
		if (current instanceof Error) {
			if (!stack) stack = current.stack;
			const aggregate = (current as { errors?: unknown[] }).errors;
			if (Array.isArray(aggregate) && aggregate.length > 0) {
				const inner = aggregate
					.map((e) => (e instanceof Error ? describeError(e) : String(e)))
					.join(' | ');
				parts.push(current.message ? `${current.message} (${inner})` : inner);
			} else {
				parts.push(describeError(current));
			}
			current = (current as { cause?: unknown }).cause;
		} else {
			parts.push(String(current));
			break;
		}
	}
	return { message: parts.filter(Boolean).join(' ← '), stack };
}
