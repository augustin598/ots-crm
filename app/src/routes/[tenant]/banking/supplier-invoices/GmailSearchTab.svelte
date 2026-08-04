<script lang="ts">
	import { getGmailConnectionStatus } from '$lib/remotes/supplier-invoices.remote';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Search, FileSpreadsheet, AlertCircle } from '@lucide/svelte';
	import { page } from '$app/state';
	import MissingDocsMode from './MissingDocsMode.svelte';
	import FreeSearchMode from './FreeSearchMode.svelte';
	import SenderExclusionsPanel from './SenderExclusionsPanel.svelte';

	// Componenta trăiește sub ruta `[tenant]`, deci parametrul există întotdeauna.
	const tenantSlug = $derived(page.params.tenant!);

	const statusQuery = getGmailConnectionStatus();
	const gmailStatus = $derived(statusQuery.current);

	// ---- Mod: 'upload' (Documente Lipsă din Keez) | 'search' (căutare liberă) ----
	let mode = $state<'upload' | 'search'>('upload');

	/**
	 * Amândouă modurile rămân MONTATE, ascunse cu `hidden`, nu distruse la comutare:
	 * potrivirea unui XLSX durează minute, iar un `{#if}` ar arunca rezultatul de
	 * fiecare dată când utilizatorul trece în căutarea liberă pentru o plată și înapoi.
	 */
	let uploadBusy = $state(false);
	let searchBusy = $state(false);
	const busy = $derived(uploadBusy || searchBusy);

	let freeSearch = $state<ReturnType<typeof FreeSearchMode> | undefined>(undefined);

	/** „Caută manual” dintr-o plată nepotrivită: trece în modul B și caută pe fereastra ei. */
	async function handleSearchAround(range: { from: string; to: string } | null) {
		mode = 'search';
		await freeSearch?.searchRange(range);
	}
</script>

<!--
	Starea de încărcare e tratată EXPLICIT: cu `{#if gmailStatus && !gmailStatus.connected}`,
	un tenant fără Gmail vedea o clipă zona de încărcare a XLSX-ului (starea e `undefined`
	până răspunde query-ul) și abia apoi cardul „Gmail nu este conectat”.
-->
{#if gmailStatus === undefined}
	<Card>
		<CardContent class="py-8 text-center text-muted-foreground">
			Se verifică conexiunea Gmail…
		</CardContent>
	</Card>
{:else if !gmailStatus.connected}
	<Card>
		<CardContent class="py-8 text-center">
			<AlertCircle class="mx-auto mb-2 h-8 w-8 text-amber-500" />
			<p class="font-medium">Gmail nu este conectat</p>
			<p class="text-sm text-muted-foreground">
				Conectează contul din Setări → Gmail înainte de a căuta facturi.
			</p>
			<Button class="mt-4" href="/{tenantSlug}/settings/gmail">Conectează Gmail</Button>
		</CardContent>
	</Card>
{:else}
	<div class="mb-4 flex flex-wrap gap-2">
		<Button
			variant={mode === 'upload' ? 'default' : 'outline'}
			size="sm"
			disabled={busy}
			onclick={() => (mode = 'upload')}
		>
			<FileSpreadsheet class="mr-2 h-4 w-4" />
			Documente lipsă (Keez)
		</Button>
		<Button
			variant={mode === 'search' ? 'default' : 'outline'}
			size="sm"
			disabled={busy}
			onclick={() => (mode = 'search')}
		>
			<Search class="mr-2 h-4 w-4" />
			Căutare liberă
		</Button>
	</div>

	<!--
		Excluderile guvernează AMÂNDOUĂ modurile, deci panoul stă în afara lor: înainte era
		doar în „Căutare liberă”, iar din fluxul lunar trebuia schimbat modul ca să poată fi
		exclus un expeditor nedorit.
	-->
	<Card class="mb-4">
		<CardContent class="py-4">
			<SenderExclusionsPanel {tenantSlug} />
		</CardContent>
	</Card>

	<div hidden={mode !== 'upload'}>
		<MissingDocsMode
			{tenantSlug}
			bind:busy={uploadBusy}
			onSearchAround={handleSearchAround}
		/>
	</div>

	<div hidden={mode !== 'search'}>
		<FreeSearchMode bind:this={freeSearch} {tenantSlug} bind:busy={searchBusy} />
	</div>
{/if}
