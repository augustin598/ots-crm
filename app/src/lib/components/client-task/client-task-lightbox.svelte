<!-- src/lib/components/client-task/client-task-lightbox.svelte -->
<script lang="ts">
	import { focusTrap } from '$lib/actions/focus-trap';
	import XIcon from '@lucide/svelte/icons/x';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';

	export type LightboxImage = { url: string; name?: string };

	type Props = {
		images: LightboxImage[];
		index: number;
		open: boolean;
		onClose: () => void;
		onIndexChange: (newIndex: number) => void;
	};

	let { images, index, open, onClose, onIndexChange }: Props = $props();

	function nav(delta: number) {
		const next = (index + delta + images.length) % images.length;
		onIndexChange(next);
	}

	// Arrow key navigation is a non-standard keyboard shortcut — handled on
	// the window so it works regardless of which element inside has focus.
	// Escape is delegated to focusTrap.onEscape.
	$effect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'ArrowLeft' && images.length > 1) {
				e.preventDefault();
				nav(-1);
			} else if (e.key === 'ArrowRight' && images.length > 1) {
				e.preventDefault();
				nav(1);
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	const current = $derived(images[index]);
</script>

{#if open && current}
	<div
		class="ct-lb-overlay fixed inset-0 z-[300] flex items-center justify-center bg-black/85"
		role="dialog"
		aria-modal="true"
		aria-label="Image viewer"
		tabindex={-1}
		onclick={onClose}
		onkeydown={() => {}}
		use:focusTrap={{ active: open, onEscape: onClose }}
	>
		<button
			type="button"
			class="ct-lb-close absolute right-5 top-5 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
			onclick={(e) => {
				e.stopPropagation();
				onClose();
			}}
			aria-label="Închide"
		>
			<XIcon class="h-5 w-5" />
		</button>

		{#if images.length > 1}
			<button
				type="button"
				class="ct-lb-nav prev absolute left-5 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
				onclick={(e) => {
					e.stopPropagation();
					nav(-1);
				}}
				aria-label="Anterior"
			>
				<ChevronLeftIcon class="h-6 w-6" />
			</button>
			<button
				type="button"
				class="ct-lb-nav next absolute right-5 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
				onclick={(e) => {
					e.stopPropagation();
					nav(1);
				}}
				aria-label="Următor"
			>
				<ChevronRightIcon class="h-6 w-6" />
			</button>
		{/if}

		<div
			class="ct-lb-img max-h-[85vh] max-w-[90vw] rounded-lg"
			onclick={(e) => e.stopPropagation()}
			role="presentation"
		>
			<img
				src={current.url}
				alt={current.name ?? `Image ${index + 1}`}
				class="block max-h-[85vh] max-w-[90vw] rounded-lg object-contain"
			/>
		</div>

		<div
			class="ct-lb-caption absolute bottom-8 left-1/2 -translate-x-1/2 rounded-full bg-black/40 px-3.5 py-1.5 text-xs text-white"
		>
			{index + 1} / {images.length}{current.name ? ` · ${current.name}` : ''}
		</div>
	</div>
{/if}
