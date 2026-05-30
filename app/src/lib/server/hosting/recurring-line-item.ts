/**
 * Canonical builder for a recurring-invoice `lineItemsJson` entry.
 *
 * THE UNIT CONTRACT (consumed by invoice-utils.ts:generateInvoiceFromRecurringTemplate):
 *   - `rate`    : DECIMAL currency units (e.g. 1149 for 1149.00 RON), NOT cents.
 *                 The generator recovers cents via `Math.round(rate * 100)`.
 *   - `taxRate` : PERCENT (e.g. 21), NOT bps. The generator does `Math.round(taxRate * 100)`.
 *
 * Storing cents/bps here causes a 100× over-billing: the Stripe emit path did
 * exactly that (`rate: netCents`) — see HOSTING-BILLING-EMAIL-AUDIT finding C2.
 * Build EVERY recurring-template line item through this helper so the unit
 * contract can never drift between writers (Stripe emit, manual create, WHMCS
 * import, the recurring-template upserter).
 *
 * Mirrors the shape produced by recurring-template.ts:upsertRecurringInvoiceForHostingAccount.
 */
export interface RecurringLineItem {
	description: string;
	quantity: number;
	/** DECIMAL currency units (e.g. 1149), NOT cents. */
	rate: number;
	/** PERCENT (e.g. 21), NOT bps. */
	taxRate: number;
	currency: string;
	unitOfMeasure: string;
}

export function buildRecurringLineItem(args: {
	description: string;
	/** Net amount for ONE unit, in the smallest currency unit (bani for RON). */
	netCents: number;
	/** VAT rate as an integer percent (e.g. 21). */
	taxRatePercent: number;
	currency: string;
	quantity?: number;
}): RecurringLineItem {
	return {
		description: args.description,
		quantity: args.quantity ?? 1,
		rate: args.netCents / 100,
		taxRate: args.taxRatePercent,
		currency: args.currency,
		unitOfMeasure: 'Buc'
	};
}
