<script lang="ts">
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Download } from '@lucide/svelte';

	interface Props {
		html: string;
		pdfUrl?: string;
		onDownloadPDF?: () => void;
	}

	let { html, pdfUrl, onDownloadPDF }: Props = $props();
</script>

<Card class="h-full flex flex-col">
	<CardContent class="flex-1 overflow-auto p-6">
		{#if pdfUrl}
			<div class="mb-4 flex justify-end">
				<Button onclick={onDownloadPDF}>
					<Download class="mr-2 h-4 w-4" />
					Download PDF
				</Button>
			</div>
		{/if}

		<div class="document-viewer prose max-w-none">
			{@html html}
		</div>
	</CardContent>
</Card>

<style>
	.document-viewer {
		background: white;
		padding: 2rem;
		min-height: 100%;
	}

	.document-viewer :global(h1),
	.document-viewer :global(h2),
	.document-viewer :global(h3) {
		margin-top: 1.5em;
		margin-bottom: 0.5em;
	}

	.document-viewer :global(p) {
		margin-bottom: 1em;
	}

	.document-viewer :global(ul),
	.document-viewer :global(ol) {
		margin-bottom: 1em;
		padding-left: 2em;
	}
</style>
