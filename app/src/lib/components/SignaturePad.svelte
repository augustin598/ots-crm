<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	let {
		onchange
	}: {
		onchange: (dataUrl: string) => void;
	} = $props();

	let canvas: HTMLCanvasElement;
	let pad: any = null;
	let isEmpty = $state(true);

	onMount(async () => {
		const { default: SignaturePad } = await import('signature_pad');

		const ratio = Math.max(window.devicePixelRatio || 1, 1);
		canvas.width = canvas.offsetWidth * ratio;
		canvas.height = canvas.offsetHeight * ratio;
		canvas.getContext('2d')?.scale(ratio, ratio);

		pad = new SignaturePad(canvas, {
			backgroundColor: 'rgb(255, 255, 255)',
			penColor: 'rgb(10, 10, 10)',
			minWidth: 1,
			maxWidth: 3
		});

		pad.addEventListener('endStroke', () => {
			isEmpty = pad.isEmpty();
			onchange(pad.toDataURL('image/png'));
		});

		window.addEventListener('resize', handleResize);
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			window.removeEventListener('resize', handleResize);
		}
	});

	function handleResize() {
		if (!pad) return;
		const data = pad.toData();
		const ratio = Math.max(window.devicePixelRatio || 1, 1);
		canvas.width = canvas.offsetWidth * ratio;
		canvas.height = canvas.offsetHeight * ratio;
		canvas.getContext('2d')?.scale(ratio, ratio);
		pad.clear();
		if (data?.length) {
			pad.fromData(data);
		}
		isEmpty = pad.isEmpty();
	}

	export function clear() {
		pad?.clear();
		isEmpty = true;
		onchange('');
	}
</script>

<div class="relative select-none">
	<canvas
		bind:this={canvas}
		class="w-full rounded-md border border-gray-300 bg-white cursor-crosshair touch-none"
		style="height: 160px; display: block;"
	></canvas>

	{#if !isEmpty}
		<button
			type="button"
			onclick={clear}
			class="absolute top-2 right-2 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-500 hover:border-red-300 hover:text-red-500"
		>
			Șterge
		</button>
	{/if}

	{#if isEmpty}
		<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
			<p class="text-sm text-gray-400">Semnați aici cu mouse-ul sau degetul</p>
		</div>
	{/if}
</div>
