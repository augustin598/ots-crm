<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import { GOOGLE_ADS_SPECS, CAMPAIGN_TYPE_LABELS, type GoogleAdsCampaignType } from '$lib/shared/google-ads-specs';
	import { getMaterialTextContent } from '$lib/remotes/marketing-materials.remote';

	let {
		open = $bindable(false),
		material = null,
		presignedUrl = null
	}: {
		open?: boolean;
		material?: any | null;
		presignedUrl?: string | null;
	} = $props();

	// Parse Google Ads structured content
	function parseGoogleAdsContent(textContent: string | null): Record<string, string[]> | null {
		if (!textContent) return null;
		try {
			const parsed = JSON.parse(textContent);
			if (typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
		} catch { /* not JSON */ }
		return null;
	}

	// Parse social URL sets
	function parseSocialSets(textContent: string | null): { title: string; urls: string[] }[] {
		if (!textContent) return [];
		try {
			const parsed = JSON.parse(textContent);
			if (!Array.isArray(parsed)) return [];
			if (parsed.length > 0 && typeof parsed[0] === 'object' && 'title' in parsed[0]) {
				return parsed.filter((s: any) => s.title && Array.isArray(s.urls));
			}
			const urls = parsed.filter((u: any) => typeof u === 'string' && u.trim());
			if (urls.length > 0) return [{ title: '', urls }];
		} catch { /* not JSON */ }
		return [];
	}

	const isGoogleAds = $derived(material?.category === 'google-ads' && material?.type === 'text');
	const googleAdsData = $derived(isGoogleAds ? parseGoogleAdsContent(material?.textContent) : null);
	const campaignSpec = $derived(
		isGoogleAds && material?.campaignType
			? GOOGLE_ADS_SPECS[material.campaignType as GoogleAdsCampaignType]
			: null
	);
	const isUrlSocialSets = $derived(material?.type === 'url' && material?.textContent);
	const socialSets = $derived(isUrlSocialSets ? parseSocialSets(material?.textContent) : []);

	const isDocPdf = $derived(material?.type === 'document' && material?.mimeType === 'application/pdf');
	const isDocx = $derived(
		material?.type === 'document' && (
			material?.mimeType === 'application/msword' ||
			material?.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
		)
	);
	const isDocTxt = $derived(material?.type === 'document' && material?.mimeType === 'text/plain');

	// Iframe loading/error state
	let iframeLoading = $state(true);
	let iframeError = $state(false);
	let iframeTimeoutId = $state<ReturnType<typeof setTimeout> | null>(null);

	function handleIframeLoad() {
		iframeLoading = false;
		if (iframeTimeoutId) { clearTimeout(iframeTimeoutId); iframeTimeoutId = null; }
	}

	function handleIframeError() {
		iframeLoading = false;
		iframeError = true;
		if (iframeTimeoutId) { clearTimeout(iframeTimeoutId); iframeTimeoutId = null; }
	}

	// TXT content via server-side fetch
	let txtContent = $state<string | null>(null);
	let txtTruncated = $state(false);
	let txtLoading = $state(false);
	let txtError = $state(false);

	// Reset states when dialog opens/closes
	$effect(() => {
		if (open) {
			iframeLoading = true;
			iframeError = false;
			// Set timeout for iframes (20s)
			if (isDocPdf || isDocx) {
				iframeTimeoutId = setTimeout(() => {
					if (iframeLoading) {
						iframeLoading = false;
						iframeError = true;
					}
				}, 20000);
			}
			// Fetch TXT content via server
			if (isDocTxt && material?.id && !txtContent && !txtLoading) {
				txtLoading = true;
				txtError = false;
				getMaterialTextContent(material.id)
					.then((r) => {
						txtContent = r.content;
						txtTruncated = r.truncated;
					})
					.catch(() => { txtError = true; })
					.finally(() => { txtLoading = false; });
			}
		} else {
			// Cleanup on close
			txtContent = null;
			txtTruncated = false;
			txtLoading = false;
			txtError = false;
			iframeLoading = true;
			iframeError = false;
			if (iframeTimeoutId) { clearTimeout(iframeTimeoutId); iframeTimeoutId = null; }
		}
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="{material?.type === 'video' ? 'sm:max-w-4xl p-0 overflow-hidden' : material?.type === 'document' ? 'sm:max-w-5xl p-0 overflow-hidden' : 'sm:max-w-2xl max-h-[85vh] overflow-y-auto'}">
		{#if material?.type === 'video' && presignedUrl}
			<!-- Video preview -->
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				src={presignedUrl}
				controls
				autoplay
				class="w-full max-h-[80vh]"
			></video>
			<div class="px-4 py-3">
				<p class="text-sm font-medium">{material.title}</p>
				{#if material.description}
					<p class="text-xs text-muted-foreground mt-0.5">{material.description}</p>
				{/if}
			</div>

		{:else if isDocPdf && presignedUrl}
			<!-- PDF preview -->
			<div class="relative" style="height: 80vh;">
				{#if iframeLoading}
					<div class="absolute inset-0 flex items-center justify-center bg-muted/50 z-10">
						<LoaderIcon class="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				{/if}
				{#if iframeError}
					<div class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted z-10">
						<FileTextIcon class="h-12 w-12 text-muted-foreground" />
						<p class="text-sm text-muted-foreground">Nu se poate previzualiza documentul.</p>
						<Button variant="outline" size="sm" onclick={() => window.open(presignedUrl!, '_blank')}>
							<DownloadIcon class="h-4 w-4 mr-1.5" />
							Descarcă
						</Button>
					</div>
				{:else}
					<iframe
						src={presignedUrl}
						title={material.title}
						class="w-full h-full border-0"
						onload={handleIframeLoad}
						onerror={handleIframeError}
					></iframe>
				{/if}
			</div>
			<div class="px-4 py-3 flex items-center justify-between">
				<div>
					<p class="text-sm font-medium">{material.title}</p>
					{#if material.description}
						<p class="text-xs text-muted-foreground mt-0.5">{material.description}</p>
					{/if}
				</div>
				<Button variant="outline" size="sm" onclick={() => window.open(presignedUrl!, '_blank')}>
					<DownloadIcon class="h-4 w-4 mr-1.5" />
					Descarcă
				</Button>
			</div>

		{:else if isDocx && presignedUrl}
			<!-- DOCX preview via Google Docs Viewer -->
			<div class="relative" style="height: 80vh;">
				{#if iframeLoading}
					<div class="absolute inset-0 flex items-center justify-center bg-muted/50 z-10">
						<LoaderIcon class="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				{/if}
				{#if iframeError}
					<div class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted z-10">
						<FileTextIcon class="h-12 w-12 text-muted-foreground" />
						<p class="text-sm text-muted-foreground">Nu se poate previzualiza acest document.</p>
						<Button variant="outline" size="sm" onclick={() => window.open(presignedUrl!, '_blank')}>
							<DownloadIcon class="h-4 w-4 mr-1.5" />
							Descarcă fișierul
						</Button>
					</div>
				{:else}
					<iframe
						src="https://docs.google.com/gview?url={encodeURIComponent(presignedUrl)}&embedded=true"
						title={material.title}
						class="w-full h-full border-0"
						onload={handleIframeLoad}
						onerror={handleIframeError}
					></iframe>
				{/if}
			</div>
			<div class="px-4 py-3 flex items-center justify-between">
				<div>
					<p class="text-sm font-medium">{material.title}</p>
					{#if material.description}
						<p class="text-xs text-muted-foreground mt-0.5">{material.description}</p>
					{/if}
				</div>
				<Button variant="outline" size="sm" onclick={() => window.open(presignedUrl!, '_blank')}>
					<DownloadIcon class="h-4 w-4 mr-1.5" />
					Descarcă
				</Button>
			</div>

		{:else if isDocTxt}
			<!-- TXT preview via server-side fetch -->
			<Dialog.Header>
				<Dialog.Title class="flex items-center justify-between">
					<span>{material.title}</span>
					{#if presignedUrl}
						<Button variant="outline" size="sm" onclick={() => window.open(presignedUrl!, '_blank')}>
							<DownloadIcon class="h-4 w-4 mr-1.5" />
							Descarcă
						</Button>
					{/if}
				</Dialog.Title>
			</Dialog.Header>
			{#if txtLoading}
				<div class="flex items-center justify-center py-12">
					<LoaderIcon class="h-5 w-5 animate-spin text-muted-foreground mr-2" />
					<span class="text-sm text-muted-foreground">Se încarcă...</span>
				</div>
			{:else if txtError}
				<div class="flex flex-col items-center justify-center py-12 gap-3">
					<FileTextIcon class="h-10 w-10 text-muted-foreground" />
					<p class="text-sm text-muted-foreground">Eroare la încărcarea fișierului.</p>
					{#if presignedUrl}
						<Button variant="outline" size="sm" onclick={() => window.open(presignedUrl!, '_blank')}>
							<DownloadIcon class="h-4 w-4 mr-1.5" />
							Descarcă
						</Button>
					{/if}
				</div>
			{:else}
				<div class="whitespace-pre-wrap font-mono text-sm p-4 bg-muted rounded-lg max-h-[60vh] overflow-y-auto">
					{txtContent || 'Conținut gol'}
				</div>
				{#if txtTruncated}
					<p class="text-xs text-muted-foreground px-4 pb-2">Fișierul a fost trunchiat (prea mare). Descărcați pentru a vedea complet.</p>
				{/if}
			{/if}

		{:else if isGoogleAds && googleAdsData}
			<!-- Google Ads structured preview -->
			<Dialog.Header>
				<Dialog.Title>{material.title}</Dialog.Title>
				{#if material.campaignType}
					<div class="flex items-center gap-2 mt-1">
						<span class="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
							{CAMPAIGN_TYPE_LABELS[material.campaignType as GoogleAdsCampaignType] ?? material.campaignType}
						</span>
					</div>
				{/if}
			</Dialog.Header>
			<div class="space-y-4 pt-2">
				{#if campaignSpec}
					{#each campaignSpec.textFields as field}
						{@const values = (googleAdsData[field.key] || []).filter(Boolean)}
						{#if values.length > 0}
							<div>
								<p class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">{field.label}</p>
								<div class="space-y-1">
									{#each values as val, i}
										<div class="flex items-start gap-2 text-sm">
											<span class="text-xs text-muted-foreground tabular-nums shrink-0 mt-0.5">{i + 1}.</span>
											<span class="flex-1">{val}</span>
											<span class="text-[10px] text-muted-foreground tabular-nums shrink-0">{val.length}/{field.maxLength}</span>
										</div>
									{/each}
								</div>
							</div>
						{/if}
					{/each}
				{:else}
					<!-- Fallback: show all keys -->
					{#each Object.entries(googleAdsData) as [key, values]}
						{#if Array.isArray(values) && values.filter(Boolean).length > 0}
							<div>
								<p class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">{key}</p>
								<div class="space-y-1">
									{#each values.filter(Boolean) as val}
										<p class="text-sm">{val}</p>
									{/each}
								</div>
							</div>
						{/if}
					{/each}
				{/if}
			</div>

		{:else if isUrlSocialSets && socialSets.length > 0}
			<!-- URL social sets preview -->
			<Dialog.Header>
				<Dialog.Title>{material.title}</Dialog.Title>
			</Dialog.Header>
			<div class="space-y-3 pt-2">
				{#each socialSets as set}
					<div>
						{#if set.title}
							<p class="text-sm font-semibold mb-1">{set.title}</p>
						{/if}
						<div class="space-y-1 pl-2 border-l-2 border-muted">
							{#each set.urls as url}
								<a href={url} target="_blank" rel="noopener noreferrer"
									class="flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline">
									<ExternalLinkIcon class="h-3.5 w-3.5 shrink-0 opacity-60" />
									<span class="truncate">{url}</span>
								</a>
							{/each}
						</div>
					</div>
				{/each}
			</div>

		{:else if material?.type === 'text'}
			<!-- Plain text preview -->
			<Dialog.Header>
				<Dialog.Title>{material.title}</Dialog.Title>
			</Dialog.Header>
			<div class="whitespace-pre-wrap font-mono text-sm p-4 bg-muted rounded-lg max-h-[60vh] overflow-y-auto">
				{material.textContent || 'Conținut gol'}
			</div>

		{:else}
			<Dialog.Header>
				<Dialog.Title>{material?.title || 'Preview'}</Dialog.Title>
			</Dialog.Header>
			<p class="text-sm text-muted-foreground">Nu se poate previzualiza acest tip de material.</p>
		{/if}
	</Dialog.Content>
</Dialog.Root>
