export function validateLineItems(
	lineItems: Array<{ description: string; quantity: number; rate: number }>,
	isCreditNote: boolean
): void {
	for (const [idx, item] of lineItems.entries()) {
		if (item.quantity == null || isNaN(item.quantity)) {
			throw new Error(`Line item ${idx + 1} (${item.description}): quantity invalid`);
		}
		if (!isCreditNote && item.quantity <= 0) {
			throw new Error(
				`Line item ${idx + 1} (${item.description}): quantity must be positive (${item.quantity}). ` +
					`For credit notes, set isCreditNote=true on the invoice/template.`
			);
		}
		if (item.rate == null || isNaN(item.rate) || item.rate < 0) {
			throw new Error(`Line item ${idx + 1} (${item.description}): rate invalid`);
		}
	}
}
