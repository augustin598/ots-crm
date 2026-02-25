<script lang="ts">
	import { getLogoFromWebsite } from '$lib/remotes/clients.remote';
	import { getFaviconUrl, getClearbitLogoUrl } from '$lib/utils';

	interface Props {
		website: string | null | undefined;
		name: string;
		size?: 'sm' | 'lg';
	}

	let { website, name, size = 'sm' }: Props = $props();

	const hasWebsite = $derived(!!website);

	const faviconUrl = $derived(hasWebsite ? getFaviconUrl(website!, size === 'lg' ? 128 : 128) : '');
	const clearbitUrl = $derived(hasWebsite ? getClearbitLogoUrl(website!) : '');

	let logoFromSource = $state<string | null | undefined>(undefined);
	let faviconFailed = $state(false);
	let clearbitFailed = $state(false);
	let sourceLogoFailed = $state(false);

	function getInitials(n: string): string {
		return n
			.split(' ')
			.map((x) => x[0])
			.join('')
			.toUpperCase()
			.slice(0, 2);
	}

	async function onFaviconError() {
		if (!website || faviconFailed) return;
		faviconFailed = true;
		try {
			const url = await getLogoFromWebsite(website);
			logoFromSource = url;
		} catch {
			logoFromSource = null;
		}
	}

	function onClearbitError() {
		clearbitFailed = true;
	}

	function onSourceLogoError() {
		sourceLogoFailed = true;
	}

	// Favicon failed → try source logo (fetched from HTML) → else Clearbit → else initials
	const showSourceLogo = $derived(
		faviconFailed && typeof logoFromSource === 'string' && !sourceLogoFailed
	);
	const showClearbit = $derived(
		faviconFailed &&
			(logoFromSource === undefined || logoFromSource === null || sourceLogoFailed) &&
			!clearbitFailed
	);
	const showInitials = $derived(!hasWebsite || (faviconFailed && !showSourceLogo && !showClearbit));

	const sizeClasses = $derived(
		size === 'lg'
			? 'h-20 w-20 rounded-full text-2xl font-bold p-2'
			: 'h-12 w-12 rounded-xl text-base font-semibold p-1.5'
	);
</script>

<div
	class="relative flex shrink-0 items-center justify-center overflow-hidden {hasWebsite
		? 'bg-white border border-border'
		: 'bg-primary text-primary-foreground'} {sizeClasses}"
	aria-hidden="true"
>
	{#if hasWebsite}
		<!-- 1. Favicon -->
		{#if !faviconFailed}
			<img
				src={faviconUrl}
				alt=""
				class="h-full w-full object-contain"
				loading="lazy"
				onerror={onFaviconError}
			/>
		{/if}
		<!-- 2. Logo from website source (site-logo-img, custom-logo, etc.) -->
		{#if showSourceLogo}
			<img
				src={logoFromSource}
				alt=""
				class="h-full w-full object-contain"
				loading="lazy"
				onerror={onSourceLogoError}
			/>
		{/if}
		<!-- 3. Clearbit fallback (while fetching or when source returned null) -->
		{#if showClearbit}
			<img
				src={clearbitUrl}
				alt=""
				class="h-full w-full object-contain"
				loading="lazy"
				onerror={onClearbitError}
			/>
		{/if}
		<!-- 4. Initials -->
		{#if showInitials}
			<span
				class="absolute inset-0 flex items-center justify-center {size === 'lg' ? 'rounded-full' : 'rounded-xl'} bg-primary text-primary-foreground {size === 'lg'
					? 'text-2xl font-bold'
					: 'text-base font-semibold'}"
			>
				{getInitials(name)}
			</span>
		{/if}
	{:else}
		{getInitials(name)}
	{/if}
</div>
