<script lang="ts">
	import { X } from '@lucide/svelte';

	interface Props {
		src: string;
		alt?: string;
		open: boolean;
		onClose: () => void;
	}

	let { src, alt = '', open, onClose }: Props = $props();

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<button
			class="absolute top-4 right-4 z-10 rounded-full bg-black/50 p-2 text-white hover:bg-black/70 transition-colors"
			onclick={onClose}
			aria-label="Close"
		>
			<X class="h-6 w-6" />
		</button>
		<img
			{src}
			{alt}
			class="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
		/>
	</div>
{/if}
