<script lang="ts">
	import { getTaskWhatsappLink, setTaskWhatsappGroup } from '$lib/remotes/task-whatsapp.remote';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import ContactAvatar from '$lib/components/ui/contact-avatar.svelte';
	import { numarSi } from '$lib/utils/ro-numerale';
	import { toast } from 'svelte-sonner';
	import { Link2Off, Loader2 } from '@lucide/svelte';

	interface Props {
		taskId: string;
		tenantSlug: string;
	}

	let { taskId, tenantSlug }: Props = $props();

	const linkQuery = $derived(getTaskWhatsappLink(taskId));

	let saving = $state(false);

	// Derived scriibil: pornește de la propunere (clientul task-ului are exact un
	// grup bifat) și ține alegerea omului până când datele se reîncarcă.
	let selectedId = $derived(linkQuery.current?.suggestion?.id ?? '');

	const selectedLabel = $derived.by(() => {
		const data = linkQuery.current;
		if (!data) return '';
		return data.options.find((o) => o.id === selectedId)?.subject ?? '';
	});

	function avatarUrl(jid: string): string {
		return `/${tenantSlug}/api/whatsapp/avatar/${encodeURIComponent(jid)}`;
	}

	async function save(groupId: string | null) {
		if (saving) return;
		saving = true;
		try {
			await setTaskWhatsappGroup({ taskId, groupId }).updates(linkQuery);
			if (groupId) {
				toast.success('Task legat de grup. Schimbările de status și mențiunile vor ajunge acolo.');
			} else {
				toast.success('Task dezlegat de grupul WhatsApp.');
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Nu am putut salva legătura.');
		} finally {
			saving = false;
		}
	}

	function unlink() {
		if (!confirm('Dezlegi task-ul de grupul WhatsApp? Grupul nu va mai primi schimbările de status.')) return;
		void save(null);
	}
</script>

<div class="space-y-3 text-sm">
	{#if linkQuery.error}
		<p class="text-xs text-destructive">Nu am putut încărca legătura cu WhatsApp.</p>
	{:else if !linkQuery.current}
		<div class="flex items-center gap-2 text-xs text-muted-foreground" aria-busy="true">
			<Loader2 class="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
			Se încarcă…
		</div>
	{:else}
		{@const data = linkQuery.current}
		{#if data.linked}
			<div class="flex items-center gap-3">
				<ContactAvatar
					src={data.linked.hasAvatar ? avatarUrl(data.linked.groupJid) : null}
					name={data.linked.subject}
					phoneE164={data.linked.groupJid}
					size="md"
				/>
				<div class="min-w-0 flex-1">
					<p class="truncate font-medium">{data.linked.subject}</p>
					<p class="text-xs text-muted-foreground">
						{numarSi(data.linked.participantCount, 'membru', 'membri')}
						{#if !data.linked.watched}
							· <span class="text-amber-700 dark:text-amber-400">grup debifat în inbox, mesajele nu pleacă</span>
						{/if}
					</p>
				</div>
			</div>
			<p class="text-xs text-muted-foreground">
				Grupul primește fiecare schimbare de status și mențiunile din comentarii.
			</p>
			{#if data.canEdit}
				<Button variant="outline" size="sm" class="w-full" disabled={saving} onclick={unlink}>
					{#if saving}
						<Loader2 class="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
					{:else}
						<Link2Off class="h-3.5 w-3.5" aria-hidden="true" />
					{/if}
					Dezleagă
				</Button>
			{/if}
		{:else if !data.canEdit}
			<p class="text-xs text-muted-foreground">Task-ul nu e legat de niciun grup WhatsApp.</p>
		{:else if data.options.length === 0}
			<p class="text-xs text-muted-foreground">
				Niciun grup bifat în inbox. Bifează unul din
				<a href={`/${tenantSlug}/whatsapp`} class="underline underline-offset-2">WhatsApp → Grupuri</a>.
			</p>
		{:else}
			<label for="task-wa-group" class="sr-only">Grup WhatsApp</label>
			<Select type="single" bind:value={selectedId}>
				<SelectTrigger id="task-wa-group" class="w-full">
					<span class="truncate">{selectedLabel || 'Alege un grup'}</span>
				</SelectTrigger>
				<SelectContent>
					{#each data.options as option (option.id)}
						<SelectItem value={option.id}>
							{option.subject}
							<span class="ml-1 text-xs text-muted-foreground">
								· {numarSi(option.participantCount, 'membru', 'membri')}
							</span>
						</SelectItem>
					{/each}
				</SelectContent>
			</Select>
			{#if data.suggestion && selectedId === data.suggestion.id}
				<p class="text-xs text-muted-foreground">Propus după clientul task-ului.</p>
			{/if}
			<Button
				size="sm"
				class="w-full"
				disabled={!selectedId || saving}
				onclick={() => save(selectedId)}
			>
				{#if saving}
					<Loader2 class="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
				{/if}
				Leagă
			</Button>
		{/if}
	{/if}
</div>
