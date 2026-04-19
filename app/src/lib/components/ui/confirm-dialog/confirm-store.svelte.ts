type Variant = 'destructive' | 'default';

type ConfirmOptions = {
	title?: string;
	description: string;
	confirmLabel?: string;
	cancelLabel?: string;
	variant?: Variant;
};

type State = {
	open: boolean;
	title: string;
	description: string;
	confirmLabel: string;
	cancelLabel: string;
	variant: Variant;
	resolve: ((value: boolean) => void) | null;
};

export const confirmState = $state<State>({
	open: false,
	title: 'Confirmare',
	description: '',
	confirmLabel: 'Confirma',
	cancelLabel: 'Anuleaza',
	variant: 'destructive',
	resolve: null
});

export function confirmDialog(descriptionOrOptions: string | ConfirmOptions): Promise<boolean> {
	const opts: ConfirmOptions =
		typeof descriptionOrOptions === 'string'
			? { description: descriptionOrOptions }
			: descriptionOrOptions;

	return new Promise<boolean>((resolve) => {
		if (confirmState.resolve) confirmState.resolve(false);
		confirmState.title = opts.title ?? 'Confirmare';
		confirmState.description = opts.description;
		confirmState.confirmLabel = opts.confirmLabel ?? 'Confirma';
		confirmState.cancelLabel = opts.cancelLabel ?? 'Anuleaza';
		confirmState.variant = opts.variant ?? 'destructive';
		confirmState.resolve = resolve;
		confirmState.open = true;
	});
}

export function resolveConfirm(result: boolean) {
	const r = confirmState.resolve;
	confirmState.resolve = null;
	confirmState.open = false;
	r?.(result);
}
