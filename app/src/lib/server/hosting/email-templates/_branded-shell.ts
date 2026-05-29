import { renderBrandedEmail, fetchTenantBrand } from '$lib/server/email';

export interface HostingShellInput {
	tenantId: string;
	title: string;
	bodyHtml: string;
	previewTitle?: string;
}

/**
 * Renders a hosting email using the tenant's branding (theme color, name, logo).
 * The logo is referenced inline via cid:companylogo; callers attach
 * `brand.logoAttachment` so the image resolves in the body.
 *
 * Use this when the body doesn't need brand info up-front. If the body needs
 * `themeColor` (e.g. for a CTA button) call `fetchTenantBrand` yourself and
 * use `renderHostingShellWithBrand` to avoid a double DB read.
 */
export async function renderHostingShell(input: HostingShellInput): Promise<string> {
	const brand = await fetchTenantBrand(input.tenantId);
	return renderBrandedEmail({
		themeColor: brand.themeColor,
		headerLogoHtml: brand.headerLogoHtml,
		title: input.title,
		bodyHtml: input.bodyHtml,
		previewTitle: input.previewTitle ?? input.title,
	});
}

export interface HostingShellWithBrandInput {
	brand: Awaited<ReturnType<typeof fetchTenantBrand>>;
	title: string;
	bodyHtml: string;
	previewTitle?: string;
}

/**
 * Variant of {@link renderHostingShell} that takes a pre-fetched brand bundle.
 * Use when the template body needs brand fields (e.g. `themeColor` for a CTA
 * button) — fetch the brand once in the template, build the body, then pass
 * the brand here to avoid a duplicate DB read.
 */
export function renderHostingShellWithBrand(input: HostingShellWithBrandInput): string {
	return renderBrandedEmail({
		themeColor: input.brand.themeColor,
		headerLogoHtml: input.brand.headerLogoHtml,
		title: input.title,
		bodyHtml: input.bodyHtml,
		previewTitle: input.previewTitle ?? input.title,
	});
}
