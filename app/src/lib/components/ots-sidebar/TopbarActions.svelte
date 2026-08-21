<script lang="ts">
	import type { Snippet } from 'svelte';
	import { setTopbarActions } from './topbar-actions.svelte';

	/**
	 * Trimite butoanele paginii în bara albă de breadcrumbs, în loc ca pagina să-și
	 * deseneze propriul rând de header (care dubla breadcrumb-ul).
	 *
	 * Nu randează nimic pe loc — conținutul apare în `OtsTopbar`.
	 *
	 *   <TopbarActions>
	 *     <button ...>Acțiune nouă</button>
	 *   </TopbarActions>
	 */
	let { children }: { children?: Snippet } = $props();

	$effect(() => {
		setTopbarActions(children ?? null);
		return () => setTopbarActions(null);
	});
</script>
