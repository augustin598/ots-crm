<script lang="ts">
	import { getFaviconUrl } from '$lib/utils';

	interface Props {
		website: string | null | undefined;
		name: string;
	}

	let { website, name }: Props = $props();

	const hasWebsite = $derived(!!website);
	const faviconUrl = $derived(hasWebsite ? getFaviconUrl(website!, 32) : '');

	let faviconFailed = $state(false);

	function getInitials(n: string): string {
		return n
			.split(' ')
			.map((x) => x[0])
			.filter(Boolean)
			.join('')
			.toUpperCase()
			.slice(0, 2);
	}
</script>

<div
	class="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded {hasWebsite && !faviconFailed
		? 'bg-white border border-border'
		: 'bg-primary text-primary-foreground'}"
	aria-hidden="true"
>
	{#if hasWebsite && !faviconFailed}
		<img
			src={faviconUrl}
			alt=""
			class="h-full w-full object-contain"
			loading="lazy"
			onerror={() => (faviconFailed = true)}
		/>
	{:else}
		<span class="text-[9px] font-semibold leading-none">{getInitials(name)}</span>
	{/if}
</div>
