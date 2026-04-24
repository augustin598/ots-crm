<script lang="ts">
	interface Props {
		src?: string | null;
		name: string;
		phoneE164?: string | null;
		size?: 'sm' | 'md' | 'lg';
		class?: string;
	}

	let { src = null, name, phoneE164 = null, size = 'md', class: className = '' }: Props = $props();

	const SIZE_PX = { sm: 32, md: 40, lg: 48 } as const;
	const PALETTE = [
		'#2563eb', // blue-600
		'#059669', // emerald-600
		'#dc2626', // red-600
		'#d97706', // amber-600
		'#7c3aed', // violet-600
		'#db2777', // pink-600
		'#0891b2', // cyan-600
		'#65a30d' // lime-600
	];

	function hashString(s: string): number {
		let h = 0;
		for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
		return Math.abs(h);
	}

	function initials(n: string): string {
		const parts = n.trim().split(/\s+/).filter(Boolean);
		if (parts.length === 0) return '?';
		if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
		return (parts[0][0] + parts[1][0]).toUpperCase();
	}

	const px = $derived(SIZE_PX[size]);
	const seed = $derived(phoneE164 ?? name ?? '?');
	const bg = $derived(PALETTE[hashString(seed) % PALETTE.length]);
	const text = $derived(initials(name));

	let errored = $state(false);
</script>

{#if src && !errored}
	<img
		{src}
		alt={name}
		loading="lazy"
		width={px}
		height={px}
		class="rounded-full object-cover {className}"
		style="width: {px}px; height: {px}px;"
		onerror={() => (errored = true)}
	/>
{:else}
	<div
		aria-label={name}
		role="img"
		class="inline-flex items-center justify-center rounded-full font-medium text-white {className}"
		style="width: {px}px; height: {px}px; background-color: {bg}; font-size: {Math.round(px * 0.4)}px;"
	>
		{text}
	</div>
{/if}
