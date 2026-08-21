import type { Snippet } from 'svelte';

/**
 * Acțiunile din dreapta barei albe de breadcrumbs (`OtsTopbar`).
 *
 * Mai multe pagini își desenau propriul rând de header — breadcrumb + butoane —
 * peste bara globală, deci breadcrumb-ul apărea de două ori. Registrul ăsta lasă
 * pagina să-și trimită DOAR butoanele în bara existentă, ca aplicația să aibă un
 * singur breadcrumb, identic peste tot (admin și portal client).
 *
 * Un singur shell = un singur set de acțiuni la un moment dat; `<TopbarActions>`
 * le curăță la demontare, deci butoanele nu se scurg pe pagina următoare.
 */
const store = $state<{ snippet: Snippet | null }>({ snippet: null });

export function setTopbarActions(snippet: Snippet | null): void {
	store.snippet = snippet;
}

/** Citit din template-ul layout-ului — reactiv, ca bara să se actualizeze la navigare. */
export function getTopbarActions(): Snippet | undefined {
	return store.snippet ?? undefined;
}
