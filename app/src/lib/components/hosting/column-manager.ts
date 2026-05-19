export type ColumnDef = {
	key: string;
	label: string;
	field?: string;
	type?: string;
	required?: boolean;
	isNew?: boolean;
};

export type ColumnConfig = {
	order: string[];
	visible: Record<string, boolean>;
};

export function visibleColumnsInOrder<T extends ColumnDef>(
	columns: T[],
	config: ColumnConfig
): T[] {
	return config.order
		.map((key) => columns.find((c) => c.key === key))
		.filter((c): c is T => !!c && (c.required === true || config.visible[c.key] === true));
}

export function buildDefaultConfig(columns: ColumnDef[]): ColumnConfig {
	return {
		order: columns.map((c) => c.key),
		visible: Object.fromEntries(columns.map((c) => [c.key, true]))
	};
}

/**
 * Load + reconcile a ColumnConfig from localStorage. Drops unknown keys, adds
 * missing keys from the fallback, and falls back wholesale on parse error.
 * Safe in SSR — returns fallback when window is missing.
 */
export function loadPersistedColumnConfig(
	storageKey: string,
	fallback: ColumnConfig
): ColumnConfig {
	if (typeof window === 'undefined') return fallback;
	try {
		const raw = window.localStorage.getItem(storageKey);
		if (!raw) return fallback;
		const parsed = JSON.parse(raw) as Partial<ColumnConfig>;
		const order = Array.isArray(parsed.order) ? parsed.order : fallback.order;
		const visible =
			parsed.visible &&
			typeof parsed.visible === 'object' &&
			!Array.isArray(parsed.visible)
				? parsed.visible
				: fallback.visible;
		const cleanOrder = order.filter((k) => fallback.order.includes(k));
		for (const k of fallback.order) if (!cleanOrder.includes(k)) cleanOrder.push(k);
		const cleanVisible: Record<string, boolean> = {};
		for (const k of fallback.order)
			cleanVisible[k] = visible[k] ?? fallback.visible[k] ?? true;
		return { order: cleanOrder, visible: cleanVisible };
	} catch {
		return fallback;
	}
}

export function savePersistedColumnConfig(storageKey: string, cfg: ColumnConfig): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(storageKey, JSON.stringify(cfg));
	} catch {
		/* quota / private mode — fail silently */
	}
}
