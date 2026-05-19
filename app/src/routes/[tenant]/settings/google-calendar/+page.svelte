<script lang="ts">
	import { page } from '$app/state';
	import { CheckCircle2, XCircle, Calendar } from '@lucide/svelte';

	let { data }: { data: { status: { connected: boolean; email: string | null } } } = $props();

	const tenantSlug = $derived(page.params.tenant ?? '');
	const statusParam = $derived(page.url.searchParams.get('status'));
	const emailParam = $derived(page.url.searchParams.get('email'));
	const reasonParam = $derived(page.url.searchParams.get('reason'));
</script>

<svelte:head>
	<title>Google Calendar · Setări</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6 p-6">
	<header class="space-y-1">
		<h1 class="text-2xl font-bold text-slate-900">Google Calendar</h1>
		<p class="text-sm text-slate-600">
			Conectează un cont Google pentru a genera automat linkuri Google Meet la crearea task-urilor de tip
			meeting.
			<br />
			<strong>Recomandare:</strong> folosește același cont Google ca Gmail-ul pentru consistență.
		</p>
	</header>

	{#if statusParam === 'connected' && emailParam}
		<div class="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
			✓ Conectat cu succes ca <strong>{emailParam}</strong>.
		</div>
	{:else if statusParam === 'disconnected'}
		<div class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
			Conexiunea a fost dezactivată.
		</div>
	{:else if statusParam === 'error'}
		<div class="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">
			Eroare la conectare: <code>{reasonParam ?? 'unknown'}</code>. Încearcă din nou.
		</div>
	{/if}

	<div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
		<div class="flex items-start gap-4">
			<div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
				<Calendar class="h-6 w-6" />
			</div>
			<div class="flex-1 space-y-3">
				{#if data.status.connected}
					<div class="flex items-center gap-2">
						<CheckCircle2 class="h-5 w-5 text-emerald-600" />
						<h2 class="text-lg font-bold text-slate-900">Conectat</h2>
					</div>
					<p class="text-sm text-slate-600">
						Cont activ: <strong class="text-slate-900">{data.status.email}</strong>
					</p>
					<form method="POST" action="?/disconnect" class="pt-2">
						<button
							type="submit"
							class="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:border-red-300 hover:bg-red-50"
						>
							Deconectează
						</button>
					</form>
				{:else}
					<div class="flex items-center gap-2">
						<XCircle class="h-5 w-5 text-slate-400" />
						<h2 class="text-lg font-bold text-slate-900">Neconectat</h2>
					</div>
					<p class="text-sm text-slate-600">
						Conectează contul Google pentru a activa generarea automată de linkuri Meet.
					</p>
					<a
						href="/api/integrations/google-calendar/auth?tenant={tenantSlug}"
						class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
					>
						<Calendar class="h-4 w-4" />
						Conectează Google Calendar
					</a>
				{/if}
			</div>
		</div>
	</div>

	<div class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
		<strong>Cum funcționează:</strong> când creezi un task de tip <em>Meeting</em>, sistemul creează automat
		un eveniment în Google Calendar și generează un link Google Meet. Participanții primesc invitația prin
		email automat. La modificarea task-ului (ora, durată, participanți), evenimentul se actualizează. La
		ștergerea task-ului, evenimentul se șterge.
	</div>
</div>
