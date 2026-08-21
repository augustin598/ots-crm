<!--
	Iconul „?" de lângă un rând din tabelul de comparație: la hover sau focus arată
	explicația funcționalității (ce primește clientul și de ce contează).

	Tooltip bits-ui cu portal — tabelul stă într-un container cu overflow-x, care ar
	tăia un tooltip poziționat absolut în interior. Pe touch, atingerea focalizează
	butonul și deschide același tooltip.
-->
<script lang="ts">
	import HelpCircleIcon from '@lucide/svelte/icons/help-circle';
	import * as Tooltip from '$lib/components/ui/tooltip';

	type Props = {
		/** Explicația afișată. */
		text: string;
		/** Eticheta rândului — pentru numele accesibil al butonului. */
		label: string;
	};

	let { text, label }: Props = $props();
</script>

<Tooltip.Provider delayDuration={120}>
	<Tooltip.Root>
		<Tooltip.Trigger
			class="fh-trigger"
			aria-label={`Ce înseamnă „${label}”?`}
			onclick={(e: MouseEvent) => e.preventDefault()}
		>
			<HelpCircleIcon class="h-3.5 w-3.5" aria-hidden="true" />
		</Tooltip.Trigger>
		<!-- Tooltip.Content pune singur conținutul în portal. -->
		<Tooltip.Content side="top" align="start" sideOffset={6} class="fh-content" arrowClasses="fh-arrow">
			{text}
		</Tooltip.Content>
	</Tooltip.Root>
</Tooltip.Provider>

<style>
	:global(.fh-trigger) {
		display: inline-grid;
		place-items: center;
		width: 22px;
		height: 22px;
		margin-left: 6px;
		border-radius: 999px;
		border: none;
		background: transparent;
		color: #94a3b8;
		cursor: help;
		vertical-align: middle;
		flex-shrink: 0;
	}
	:global(.fh-trigger:hover),
	:global(.fh-trigger[data-state='delayed-open']),
	:global(.fh-trigger[data-state='instant-open']) {
		color: #1877f2;
		background: rgba(24, 119, 242, 0.1);
	}
	:global(.fh-trigger:focus-visible) {
		outline: 2px solid #1877f2;
		outline-offset: 2px;
		color: #1877f2;
	}
	/* Conținutul e portat în <body>, deci stilul trebuie să fie global. */
	:global(.fh-arrow) {
		background: #0b1220;
	}
	:global(.fh-content) {
		max-width: 300px;
		padding: 10px 12px;
		border-radius: 10px;
		background: #0b1220;
		color: #fff;
		font-family: 'Inter', system-ui, sans-serif;
		font-size: 12.5px;
		font-weight: 500;
		line-height: 1.5;
		box-shadow: 0 12px 32px rgba(11, 18, 32, 0.28);
		z-index: 1100;
	}
</style>
