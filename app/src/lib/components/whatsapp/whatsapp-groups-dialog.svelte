<script lang="ts">
	import {
		listWhatsappGroups,
		setWhatsappGroupWatched,
		setWhatsappGroupClient
	} from '$lib/remotes/whatsapp.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Switch } from '$lib/components/ui/switch';
	import ContactAvatar from '$lib/components/ui/contact-avatar.svelte';
	import { AlertTriangle, Loader2, Search, Users } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { numarSi } from '$lib/utils/ro-numerale';
	import { focusTrap } from '$lib/actions/focus-trap';

	interface Props {
		tenantSlug: string;
		onclose: () => void;
		onchanged?: () => void;
	}

	let { tenantSlug, onclose, onchanged }: Props = $props();

	const groupsQuery = listWhatsappGroups();
	const groups = $derived(groupsQuery.current?.groups ?? []);
	const clients = $derived(groupsQuery.current?.clients ?? []);
	const canEdit = $derived(groupsQuery.current?.canEdit ?? false);
	const loadError = $derived(groupsQuery.current?.error ?? null);

	let search = $state('');
	// Mai multe grupuri pot fi în curs de salvare deodată; un singur slot ar face
	// ca al doilea clic să stingă indicatorul primului.
	let busy = $state<string[]>([]);
	const isBusy = (jid: string) => busy.includes(jid);

	const filtered = $derived(
		search.trim()
			? groups.filter((g) => g.subject.toLowerCase().includes(search.trim().toLowerCase()))
			: groups
	);

	const watchedCount = $derived(groups.filter((g) => g.watched).length);

	async function toggleWatched(jid: string, watched: boolean) {
		busy = [...busy, jid];
		try {
			await setWhatsappGroupWatched({ groupJid: jid, watched });
			onchanged?.();
			toast.success(watched ? 'Grupul intră în inbox' : 'Grupul a ieșit din inbox');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Eroare la salvare');
		} finally {
			// Și la eroare: fără reîmprospătare, comutatorul ar rămâne pe poziția
			// nouă și ar minți despre ce s-a salvat.
			await groupsQuery.refresh();
			busy = busy.filter((j) => j !== jid);
		}
	}

	async function changeClient(jid: string, clientId: string) {
		busy = [...busy, jid];
		try {
			await setWhatsappGroupClient({ groupJid: jid, clientId: clientId || null });
			onchanged?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Eroare la salvare');
		} finally {
			await groupsQuery.refresh();
			busy = busy.filter((j) => j !== jid);
		}
	}

</script>

<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
	role="dialog"
	aria-modal="true"
	aria-label="Grupuri WhatsApp"
	use:focusTrap={{ onEscape: onclose }}
>
	<Card class="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden">
		<CardHeader class="space-y-3 pb-3">
			<div class="flex items-start justify-between gap-4">
				<div>
					<CardTitle>Grupuri WhatsApp</CardTitle>
					<CardDescription>
						Bifează grupurile pe care vrei să le vezi în inbox. Restul rămân în telefon și nu se
						stochează nicăieri. Mesajele apar de la bifare încolo; cele mai vechi ajung aici doar
						dacă WhatsApp le retrimite la o reconectare.
					</CardDescription>
				</div>
				<Button variant="ghost" size="sm" onclick={onclose}>Închide</Button>
			</div>

			{#if groupsQuery.current && !canEdit}
				<p class="rounded-md bg-muted p-3 text-sm text-muted-foreground">
					Lista o poate schimba doar un administrator. Tu o vezi ca să știi ce intră în inbox.
				</p>
			{/if}

			{#if loadError}
				<div class="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
					<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
					<span>{loadError}</span>
				</div>
			{/if}

			<div class="flex items-center gap-3">
				<div class="relative flex-1">
					<Search class="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
					<Input bind:value={search} placeholder="Caută după nume..." class="pl-8" />
				</div>
				<span class="shrink-0 text-xs text-muted-foreground">
					{watchedCount} din {groups.length} în inbox
				</span>
			</div>
		</CardHeader>

		<CardContent class="flex-1 overflow-y-auto p-0">
			{#if !groupsQuery.current}
				<div class="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
					<Loader2 class="h-4 w-4 animate-spin" /> Se citesc grupurile...
				</div>
			{:else if filtered.length === 0}
				<div class="p-10 text-center text-sm text-muted-foreground">
					{search ? 'Niciun grup cu numele ăsta.' : 'Contul nu e în niciun grup.'}
				</div>
			{:else}
				<ul class="divide-y">
					{#each filtered as g (g.jid)}
						<li class="flex flex-col gap-3 px-5 py-3.5">
							<div class="flex items-center gap-3">
								<ContactAvatar
									src={`/${tenantSlug}/api/whatsapp/avatar/${encodeURIComponent(g.jid)}`}
									name={g.subject}
									phoneE164={g.jid}
									size="md"
								/>
								<div class="min-w-0 flex-1">
									<p class="truncate font-medium">{g.subject}</p>
									<p class="text-xs text-muted-foreground">
										{numarSi(g.size, 'membru', 'membri')}
										{#if g.live}
											· {g.membersWithPhone} cu număr vizibil
										{:else}
											· nu mai apare la WhatsApp
										{/if}
									</p>
								</div>
								<div class="flex shrink-0 items-center gap-2">
									{#if isBusy(g.jid)}
										<Loader2 class="h-4 w-4 animate-spin text-muted-foreground" />
									{/if}
									<Switch
										checked={g.watched}
										disabled={isBusy(g.jid) || !canEdit}
										aria-label={`Urmărește ${g.subject}`}
										onCheckedChange={(v) => toggleWatched(g.jid, v)}
									/>
								</div>
							</div>

							{#if g.watched}
								<div class="flex flex-wrap items-center gap-2 pl-13">
									<label class="text-xs text-muted-foreground" for={`client-${g.jid}`}>
										Client
									</label>
									<select
										id={`client-${g.jid}`}
										class="max-w-[260px] flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
										value={g.clientId ?? ''}
										disabled={isBusy(g.jid) || !canEdit}
										onchange={(e) => changeClient(g.jid, e.currentTarget.value)}
									>
										<option value="">Fără client</option>
										{#each clients as c (c.id)}
											<option value={c.id}>{c.name}</option>
										{/each}
									</select>
									{#if !g.clientId && g.suggestion}
										{@const hint = g.suggestion}
										<Button
											variant="outline"
											size="sm"
											class="h-7 gap-1 text-xs"
											title="Propunere după numerele membrilor"
											disabled={isBusy(g.jid) || !canEdit}
											onclick={() => changeClient(g.jid, hint.clientId)}
										>
											<Users class="h-3 w-3" />
											{hint.clientName}
											<span class="text-muted-foreground">
												({hint.matches}
												{hint.matches === 1 ? 'număr' : 'numere'})
											</span>
										</Button>
									{/if}
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</CardContent>
	</Card>
</div>
