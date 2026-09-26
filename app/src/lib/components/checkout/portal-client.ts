/**
 * Ce știe pagina publică (/pachete-hosting) despre clientul logat în portal.
 * Checkout-ul sare peste pasul de cont și precompletează facturarea din `billing`.
 * Tip partajat între +page.server.ts (îl produce) și modalul de checkout (îl consumă).
 */
export type PortalClientSummary = {
	id: string;
	name: string;
	email: string | null;
	billing: {
		businessName: string | null;
		legalType: string | null;
		cui: string | null;
		vatNumber: string | null;
		registrationNumber: string | null;
		phone: string | null;
		address: string | null;
		city: string | null;
		county: string | null;
		postalCode: string | null;
	};
};
