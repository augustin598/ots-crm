<!-- src/lib/components/image-lightbox.svelte -->
<script lang="ts" module>
	export type LightboxImage = { url: string; name?: string };
</script>

<script lang="ts">
	import { focusTrap } from '$lib/actions/focus-trap';
	import { X, ChevronLeft, ChevronRight, Download } from '@lucide/svelte';

	interface Props {
		images: LightboxImage[];
		index?: number;
		open: boolean;
		onClose: () => void;
		onIndexChange?: (newIndex: number) => void;
	}

	let { images, index = 0, open, onClose, onIndexChange }: Props = $props();

	// Indexul e controlat de părinte când primim onIndexChange, altfel îl ținem local
	// (cazul galeriilor cu o singură imagine, unde navigarea oricum e no-op).
	let localIndex = $state(0);
	const activeIndex = $derived(onIndexChange ? index : localIndex);
	const current = $derived(images[activeIndex]);

	function nav(delta: number) {
		if (images.length < 2) return;
		const next = (activeIndex + delta + images.length) % images.length;
		if (onIndexChange) onIndexChange(next);
		else localIndex = next;
	}

	// Ascultăm pe window în faza de captură: lightbox-ul se deschide adesea în
	// interiorul unui Sheet/Dialog care are propriul handler de Escape — dacă îl
	// lăsăm să propage, Escape ar închide și drawerul task-ului, nu doar poza.
	// Săgețile sunt scurtături nestandard, deci tot aici, ca să meargă indiferent
	// ce element din overlay are focusul.
	$effect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				onClose();
			} else if (e.key === 'ArrowLeft') {
				e.preventDefault();
				nav(-1);
			} else if (e.key === 'ArrowRight') {
				e.preventDefault();
				nav(1);
			}
		};
		window.addEventListener('keydown', onKey, true);
		return () => window.removeEventListener('keydown', onKey, true);
	});
</script>

{#if open && current}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="fixed inset-0 z-[300] flex items-center justify-center bg-black/85 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
		aria-label="Vizualizare imagine"
		tabindex="-1"
		onclick={onClose}
		use:focusTrap={{ active: open }}
	>
		<div class="absolute top-4 right-4 z-10 flex items-center gap-2">
			<a
				href={current.url}
				download={current.name || ''}
				target="_blank"
				rel="noopener noreferrer"
				class="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
				aria-label="Descarcă imaginea"
				onclick={(e) => e.stopPropagation()}
			>
				<Download class="h-5 w-5" />
			</a>
			<button
				type="button"
				class="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
				aria-label="Închide"
				onclick={(e) => {
					e.stopPropagation();
					onClose();
				}}
			>
				<X class="h-5 w-5" />
			</button>
		</div>

		{#if images.length > 1}
			<button
				type="button"
				class="absolute top-1/2 left-5 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
				aria-label="Imaginea anterioară"
				onclick={(e) => {
					e.stopPropagation();
					nav(-1);
				}}
			>
				<ChevronLeft class="h-6 w-6" />
			</button>
			<button
				type="button"
				class="absolute top-1/2 right-5 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
				aria-label="Imaginea următoare"
				onclick={(e) => {
					e.stopPropagation();
					nav(1);
				}}
			>
				<ChevronRight class="h-6 w-6" />
			</button>
		{/if}

		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="max-h-[88vh] max-w-[92vw]" onclick={(e) => e.stopPropagation()}>
			<img
				src={current.url}
				alt={current.name || `Imaginea ${activeIndex + 1}`}
				class="block max-h-[88vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
			/>
		</div>

		{#if images.length > 1 || current.name}
			<div
				class="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3.5 py-1.5 text-xs text-white"
			>
				{#if images.length > 1}{activeIndex + 1} / {images.length}{/if}{#if images.length > 1 && current.name}&nbsp;·&nbsp;{/if}{current.name ??
					''}
			</div>
		{/if}
	</div>
{/if}
