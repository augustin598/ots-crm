<script lang="ts">
	import { Upload, FileSpreadsheet } from '@lucide/svelte';
	import { isXlsxFile } from '$lib/utils/gmail-search';

	interface Props {
		/** Numele fișierului deja procesat, afișat sub zonă. */
		fileName?: string | null;
		disabled?: boolean;
		busy?: boolean;
		onFile: (file: File) => void;
	}

	let { fileName = null, disabled = false, busy = false, onFile }: Props = $props();

	let fileInput = $state<HTMLInputElement | null>(null);
	let dragging = $state(false);
	let error = $state('');

	/**
	 * `dragenter`/`dragleave` se declanșează și la trecerea peste copiii zonei, deci
	 * un simplu boolean ar clipi. Numărăm intrările și ieșirile.
	 */
	let dragDepth = $state(0);

	function accept(file: File | undefined | null) {
		if (!file) return;
		if (!isXlsxFile(file)) {
			error = `„${file.name}” nu este un fișier XLSX. Încarcă exportul „Documente Lipsa” din Keez, salvat ca .xlsx.`;
			return;
		}
		error = '';
		onFile(file);
	}

	function openPicker(event: MouseEvent) {
		if (disabled) return;
		// Clicul propriu al inputului ascuns ar reintra aici și ar deschide selectorul la nesfârșit
		if (event.target === fileInput) return;
		fileInput?.click();
	}

	function onKeydown(event: KeyboardEvent) {
		if (disabled) return;
		if (event.key !== 'Enter' && event.key !== ' ') return;
		// Fără asta, Space derulează pagina în loc să deschidă selectorul
		event.preventDefault();
		fileInput?.click();
	}

	function onDragEnter(event: DragEvent) {
		if (disabled) return;
		// Implicit, browserul deschide fișierul tras într-o filă nouă și pierde pagina
		event.preventDefault();
		dragDepth += 1;
		dragging = true;
	}

	function onDragOver(event: DragEvent) {
		if (disabled) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		dragging = true;
	}

	function onDragLeave(event: DragEvent) {
		event.preventDefault();
		dragDepth = Math.max(0, dragDepth - 1);
		if (dragDepth === 0) dragging = false;
	}

	function onDrop(event: DragEvent) {
		event.preventDefault();
		dragDepth = 0;
		dragging = false;
		if (disabled) return;
		accept(event.dataTransfer?.files?.[0]);
	}

	function onChange(event: Event & { currentTarget: HTMLInputElement }) {
		const input = event.currentTarget;
		accept(input.files?.[0]);
		// Golim inputul ca reîncărcarea ACELUIAȘI fișier să declanșeze din nou `change`
		input.value = '';
	}
</script>

<div
	role="button"
	tabindex={disabled ? -1 : 0}
	aria-disabled={disabled}
	aria-label="Încarcă exportul XLSX „Documente Lipsa” din Keez — trage fișierul aici sau apasă pentru a-l alege"
	class="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none {dragging
		? 'border-primary bg-primary/10'
		: 'border-muted-foreground/30 bg-muted/20 hover:border-muted-foreground/60'} {disabled
		? 'cursor-not-allowed opacity-60'
		: 'cursor-pointer'}"
	onclick={openPicker}
	onkeydown={onKeydown}
	ondragenter={onDragEnter}
	ondragover={onDragOver}
	ondragleave={onDragLeave}
	ondrop={onDrop}
>
	<Upload class="h-6 w-6 {dragging ? 'text-primary' : 'text-muted-foreground'}" />
	<p class="text-sm font-medium">
		{#if busy}
			Se procesează fișierul…
		{:else if dragging}
			Dă drumul fișierului aici
		{:else}
			Trage fișierul XLSX aici sau apasă pentru a-l alege
		{/if}
	</p>
	<p class="text-xs text-muted-foreground">Acceptăm doar exportul „Documente Lipsa” în format .xlsx</p>
</div>

<input
	bind:this={fileInput}
	type="file"
	accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	class="hidden"
	{disabled}
	onchange={onChange}
/>

{#if error}
	<p class="mt-2 text-sm text-destructive">{error}</p>
{:else if fileName}
	<p class="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
		<FileSpreadsheet class="h-4 w-4 shrink-0" />
		<span class="truncate">Fișier încărcat: <span class="font-medium">{fileName}</span></span>
	</p>
{/if}
