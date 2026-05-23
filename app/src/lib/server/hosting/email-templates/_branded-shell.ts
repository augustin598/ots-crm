import { renderBrandedEmail, fetchTenantBrand } from '$lib/server/email';

export interface HostingShellInput {
	tenantId: string;
	title: string;
	bodyHtml: string;
	previewTitle?: string;
}

/**
 * Renders a hosting email using the tenant's branding (theme color, name).
 * Logo attachment is intentionally omitted for hosting templates in MVP —
 * we use plain text headers without CID attachments.
 */
export async function renderHostingShell(input: HostingShellInput): Promise<string> {
	const brand = await fetchTenantBrand(input.tenantId);
	return renderBrandedEmail({
		themeColor: brand.themeColor,
		headerLogoHtml: '', // no logo attachment in hosting emails (MVP)
		title: input.title,
		bodyHtml: input.bodyHtml,
		previewTitle: input.previewTitle ?? input.title,
	});
}
