<!-- src/lib/components/task-detail/task-email-section.svelte -->
<script lang="ts">
	// Secțiune „Emailuri asociate" sub titlul task-ului (doar admin app).
	// Staff: vede metadatele salvate. Owner/admin: + căutare Gmail, asociere,
	// corp complet, atașamente. Portalul clientului NU montează componenta —
	// acolo există doar pill-ul informativ din client-task-pills.
	import { page } from '$app/state';
	import MailIcon from '@lucide/svelte/icons/mail';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import SearchIcon from '@lucide/svelte/icons/search';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import PaperclipIcon from '@lucide/svelte/icons/paperclip';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import {
		getTaskEmails,
		searchTaskEmails,
		linkTaskEmail,
		unlinkTaskEmail,
		getTaskEmailBody
	} from '$lib/remotes/task-emails.remote';
	import { getClient } from '$lib/remotes/clients.remote';

	type TaskEmailRow = {
		id: string;
		subject: string | null;
		fromEmail: string | null;
		snippet: string | null;
		emailDate: Date | null;
		gmailMessageId: string;
	};
	type SearchResult = {
		gmailMessageId: string;
		gmailThreadId: string;
		subject: string;
		from: string;
		date: Date;
		snippet: string;
	};
	type BodyData = {
		subject: string;
		from: string;
		date: Date;
		body: string;
		gmailMessageId: string;
		attachments: Array<{ id: string; filename: string; mimeType: string; size: number }>;
	};

	let { taskId, clientId = null }: { taskId: string; clientId?: string | null } = $props();

	// Rolul vine din layout data ([tenant]/+layout.server.ts → tenantUser).
	const isAdmin = $derived(
		page.data.tenantUser?.role === 'owner' || page.data.tenantUser?.role === 'admin'
	);

	const emailsQuery = $derived(getTaskEmails(taskId));
	// Componenta se montează DOAR în admin app (staff), unde serverul întoarce
	// mereu rândurile complete — shape-ul redus e doar pentru portalul clientului.
	const emails = $derived((emailsQuery.current ?? []) as TaskEmailRow[]);

	const clientQuery = $derived(clientId ? getClient(clientId) : null);
	const clientEmail = $derived(clientQuery?.current?.email ?? null);

	// ─── Dialog asociere ───
	let associateOpen = $state(false);
	let searchText = $state('');
	let searching = $state(false);
	let linking = $state<string | null>(null);
	// Mesajele deja asociate în sesiunea curentă de căutare — dialogul rămâne
	// deschis ca să poți lega mai multe emailuri la rând, nu doar unul.
	let linkedIds = $state<Set<string>>(new Set());
	let results = $state.raw<SearchResult[]>([]);
	let searchDone = $state(false);
	let searchError = $state<string | null>(null);

	// ID-urile deja asociate task-ului (din DB) — marcate „Asociat" în rezultate.
	const alreadyLinked = $derived(new Set(emails.map((e) => e.gmailMessageId)));

	function openAssociate() {
		// Smart default: corespondența clientului task-ului.
		searchText = clientEmail ? `from:${clientEmail} OR to:${clientEmail}` : '';
		results = [];
		linkedIds = new Set();
		searchDone = false;
		searchError = null;
		associateOpen = true;
	}

	async function runSearch() {
		if (searchText.trim().length < 2 || searching) return;
		searching = true;
		searchError = null;
		try {
			results = await searchTaskEmails({ search: searchText.trim() });
			searchDone = true;
		} catch (e) {
			searchError = e instanceof Error ? e.message : 'Căutarea a eșuat.';
		} finally {
			searching = false;
		}
	}

	async function link(messageId: string) {
		if (linking) return;
		linking = messageId;
		searchError = null;
		try {
			await linkTaskEmail({ taskId, gmailMessageId: messageId }).updates(getTaskEmails(taskId));
			// Dialogul rămâne deschis — marcăm rezultatul și poți lega următorul.
			linkedIds = new Set([...linkedIds, messageId]);
		} catch (e) {
			searchError =
				e instanceof Error && /unique/i.test(e.message)
					? 'Emailul e deja asociat cu acest task.'
					: e instanceof Error
						? e.message
						: 'Asocierea a eșuat.';
		} finally {
			linking = null;
		}
	}

	async function unlink(taskEmailId: string) {
		if (!confirm('Dezasociezi acest email de task?')) return;
		await unlinkTaskEmail({ taskEmailId }).updates(getTaskEmails(taskId));
	}

	// ─── Dialog corp email ───
	let bodyOpen = $state(false);
	let bodyLoading = $state(false);
	let bodyError = $state<string | null>(null);
	let bodyData = $state.raw<BodyData | null>(null);
	let bodyEmailId = $state<string | null>(null);

	async function openBody(taskEmailId: string) {
		bodyOpen = true;
		bodyLoading = true;
		bodyError = null;
		bodyData = null;
		bodyEmailId = taskEmailId;
		try {
			bodyData = await getTaskEmailBody({ taskEmailId });
		} catch (e) {
			bodyError = e instanceof Error ? e.message : 'Nu am putut încărca emailul.';
		} finally {
			bodyLoading = false;
		}
	}

	function fmtDate(d: Date | string | null | undefined) {
		if (!d) return '';
		return new Date(d).toLocaleDateString('ro-RO', {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});
	}
	function fmtDateTime(d: Date | string | null | undefined) {
		if (!d) return '';
		return new Date(d).toLocaleString('ro-RO', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
	function fmtSize(bytes: number) {
		if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
		return `${bytes} B`;
	}
	function gmailUrl(messageId: string) {
		return `https://mail.google.com/mail/u/0/#all/${messageId}`;
	}
</script>

{#if isAdmin || emails.length > 0}
	<div
		class="rounded-xl border border-[#e5e9f0] bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900"
	>
		<div class="flex items-center justify-between gap-2">
			<div class="flex items-center gap-2 text-sm font-semibold">
				<MailIcon class="h-4 w-4 text-muted-foreground" />
				Emailuri asociate
				{#if emails.length > 0}
					<span class="text-xs font-medium text-muted-foreground">({emails.length})</span>
				{/if}
			</div>
			{#if isAdmin}
				<Button variant="outline" size="sm" class="h-7 gap-1 text-xs" onclick={openAssociate}>
					<PlusIcon class="h-3.5 w-3.5" />
					Asociază email
				</Button>
			{/if}
		</div>

		{#if emails.length > 0}
			<ul class="mt-3 space-y-2">
				{#each emails as e (e.id)}
					<li
						class="group rounded-lg border border-[#eef1f6] bg-[#fafbfd] px-3 py-2 dark:border-zinc-700/60 dark:bg-zinc-800/40"
					>
						<div class="flex items-start justify-between gap-2">
							<div class="min-w-0">
								{#if isAdmin}
									<button
										type="button"
										class="block max-w-full truncate text-left text-sm font-semibold hover:underline"
										title={e.subject ?? ''}
										onclick={() => openBody(e.id)}
									>
										{e.subject || '(fără subiect)'}
									</button>
								{:else}
									<p class="truncate text-sm font-semibold">{e.subject || '(fără subiect)'}</p>
								{/if}
								<p class="mt-0.5 truncate text-xs text-muted-foreground">
									{e.fromEmail ? `${e.fromEmail} · ` : ''}{fmtDate(e.emailDate)}
								</p>
								{#if e.snippet}
									<p class="mt-1 line-clamp-2 text-xs text-muted-foreground">{e.snippet}</p>
								{/if}
							</div>
							{#if isAdmin}
								<div
									class="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
								>
									<a
										href={gmailUrl(e.gmailMessageId)}
										target="_blank"
										rel="noopener noreferrer"
										class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
										title="Deschide în Gmail"
										aria-label="Deschide în Gmail"
									>
										<ExternalLinkIcon class="h-3.5 w-3.5" />
									</a>
									<button
										type="button"
										class="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
										title="Dezasociază emailul"
										aria-label="Dezasociază emailul"
										onclick={() => unlink(e.id)}
									>
										<XIcon class="h-3.5 w-3.5" />
									</button>
								</div>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{:else if isAdmin}
			<p class="mt-2 text-xs text-muted-foreground">
				Niciun email asociat încă. Caută în inbox și leagă conversația de acest task.
			</p>
		{/if}
	</div>
{/if}

<!-- ─── Dialog: asociere email ─── -->
<Dialog bind:open={associateOpen}>
	<DialogContent class="max-h-[85vh] overflow-y-auto sm:max-w-[640px]">
		<DialogHeader>
			<DialogTitle>Asociază un email cu task-ul</DialogTitle>
			<DialogDescription>
				Caută în inbox cu sintaxa Gmail (ex. <code>from:client@firma.ro</code>,
				<code>subject:oferta</code>).
			</DialogDescription>
		</DialogHeader>

		<form
			class="flex items-center gap-2"
			onsubmit={(ev) => {
				ev.preventDefault();
				runSearch();
			}}
		>
			<Input
				bind:value={searchText}
				placeholder="from:client@firma.ro OR subject:..."
				class="flex-1"
				aria-label="Căutare în Gmail"
			/>
			<Button type="submit" disabled={searching || searchText.trim().length < 2} class="gap-1.5">
				{#if searching}
					<LoaderIcon class="h-4 w-4 animate-spin" />
				{:else}
					<SearchIcon class="h-4 w-4" />
				{/if}
				Caută
			</Button>
		</form>

		{#if searchError}
			<p class="text-sm text-red-600">{searchError}</p>
		{/if}

		{#if results.length > 0}
			<ul class="space-y-2">
				{#each results as r (r.gmailMessageId)}
					{@const isLinked = linkedIds.has(r.gmailMessageId) || alreadyLinked.has(r.gmailMessageId)}
					<li>
						<button
							type="button"
							class="w-full rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-70 dark:bg-zinc-900 {isLinked
								? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900'
								: 'border-[#eef1f6] bg-white hover:border-[#1877F2] hover:bg-[#f7faff] dark:border-zinc-700 dark:hover:bg-zinc-800'}"
							disabled={linking !== null || isLinked}
							onclick={() => link(r.gmailMessageId)}
						>
							<div class="flex items-center justify-between gap-2">
								<span class="truncate text-sm font-semibold">{r.subject || '(fără subiect)'}</span>
								{#if linking === r.gmailMessageId}
									<LoaderIcon class="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
								{:else if isLinked}
									<span
										class="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
									>
										✓ Asociat
									</span>
								{/if}
							</div>
							<p class="mt-0.5 truncate text-xs text-muted-foreground">
								{r.from} · {fmtDateTime(r.date)}
							</p>
							{#if r.snippet}
								<p class="mt-1 line-clamp-2 text-xs text-muted-foreground">{r.snippet}</p>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
			<p class="text-xs text-muted-foreground">
				Poți asocia mai multe emailuri la rând — dialogul rămâne deschis.
			</p>
			<div class="flex justify-end">
				<Button variant="outline" size="sm" onclick={() => (associateOpen = false)}>Gata</Button>
			</div>
		{:else if searchDone && !searching}
			<p class="text-sm text-muted-foreground">Niciun rezultat pentru căutarea asta.</p>
		{/if}
	</DialogContent>
</Dialog>

<!-- ─── Dialog: corp email ─── -->
<Dialog bind:open={bodyOpen}>
	<DialogContent class="max-h-[85vh] overflow-y-auto sm:max-w-[680px]">
		<DialogHeader>
			<DialogTitle class="pr-6">{bodyData?.subject || 'Email'}</DialogTitle>
			{#if bodyData}
				<DialogDescription>
					{bodyData.from} · {fmtDateTime(bodyData.date)}
				</DialogDescription>
			{/if}
		</DialogHeader>

		{#if bodyLoading}
			<div class="flex items-center gap-2 py-6 text-sm text-muted-foreground">
				<LoaderIcon class="h-4 w-4 animate-spin" />
				Se încarcă emailul din Gmail...
			</div>
		{:else if bodyError}
			<p class="py-4 text-sm text-red-600">{bodyError}</p>
		{:else if bodyData}
			<pre
				class="max-h-[45vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-[#fafbfd] p-3 font-sans text-sm dark:bg-zinc-800/60">{bodyData.body}</pre>

			{#if bodyData.attachments.length > 0}
				<div>
					<p class="mb-1.5 text-xs font-semibold text-muted-foreground">Atașamente</p>
					<ul class="space-y-1">
						<!-- Link pe INDEX, nu pe att.id: ID-urile de atașamente Gmail sunt
						     efemere (se schimbă la fiecare messages.get) — endpointul își ia
						     singur id-ul proaspăt din poziția din mesaj. -->
						{#each bodyData.attachments as att, i (att.id)}
							<li>
								<a
									href={`/${page.params.tenant}/api/task-emails/${bodyEmailId}/attachments/${i}`}
									class="inline-flex items-center gap-1.5 text-sm text-[#1877F2] hover:underline"
									download
								>
									<PaperclipIcon class="h-3.5 w-3.5" />
									{att.filename}
									<span class="text-xs text-muted-foreground">({fmtSize(att.size)})</span>
								</a>
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			<div class="flex justify-end">
				<a
					href={gmailUrl(bodyData.gmailMessageId)}
					target="_blank"
					rel="noopener noreferrer"
					class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
				>
					<ExternalLinkIcon class="h-3.5 w-3.5" />
					Deschide în Gmail
				</a>
			</div>
		{/if}
	</DialogContent>
</Dialog>
