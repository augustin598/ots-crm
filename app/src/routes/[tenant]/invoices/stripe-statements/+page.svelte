<script lang="ts">
	import {
		getStripeStatements,
		generateStripeStatementsForMonth,
		generateStripeStatementsForYear,
		emailStripeStatements
	} from '$lib/remotes/stripe-statements.remote';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import FileArchiveIcon from '@lucide/svelte/icons/file-archive';
	import MailIcon from '@lucide/svelte/icons/mail';
	import PlayIcon from '@lucide/svelte/icons/play';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import CheckIcon from '@lucide/svelte/icons/check';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { toast } from 'svelte-sonner';
	import { remoteErrorMessage } from '$lib/utils/remote-error';
	import PollWatcher from './poll-watcher.svelte';

	const MONTH_NAMES = [
		'Ianuarie',
		'Februarie',
		'Martie',
		'Aprilie',
		'Mai',
		'Iunie',
		'Iulie',
		'August',
		'Septembrie',
		'Octombrie',
		'Noiembrie',
		'Decembrie'
	];
	const FIRST_YEAR = 2026;
	const ACCOUNTANT_EMAIL_KEY = 'ots:stripe-statements:accountant-email';

	const tenantSlug = $derived(page.params.tenant as string);
	const currentYear = new Date().getFullYear();
	const years = Array.from({ length: Math.max(1, currentYear - FIRST_YEAR + 1) }, (_, i) => FIRST_YEAR + i);

	let year = $state(currentYear >= FIRST_YEAR ? currentYear : FIRST_YEAR);

	// Instanța live a query-ului — pe ea se face refresh/updates, nu pe una reconstruită.
	const overviewQuery = $derived(getStripeStatements({ year }));
	const overview = $derived(await overviewQuery);

	let busyMonth = $state<number | null>(null);
	let busyYear = $state(false);

	// Email
	let emailOpen = $state(false);
	let emailMonth = $state<number | null>(null);
	let emailTo = $state('');
	let emailNote = $state('');
	let emailSending = $state(false);

	/**
	 * Numele fișierului merge și în cale, nu doar în `Content-Disposition`:
	 * extensiile de browser care intermediază descărcările ignoră antetul și
	 * salvează un UUID fără extensie. Cu numele în URL + atributul `download`,
	 * fișierul ajunge corect denumit indiferent de ce e instalat în browser.
	 */
	function downloadUrl(fileName: string, params: Record<string, string | number>): string {
		const qs = new URLSearchParams(
			Object.entries(params).map(([k, val]) => [k, String(val)])
		).toString();
		return `/${tenantSlug}/api/stripe-statements/${encodeURIComponent(fileName)}?${qs}`;
	}

	const yearZipName = $derived(`extrase-stripe-${year}.zip`);
	const monthZipName = (month: number) =>
		`extrase-stripe-${year}-${String(month).padStart(2, '0')}.zip`;

	function formatDate(unixSeconds: number | null): string {
		if (!unixSeconds) return '—';
		return new Date(unixSeconds * 1000).toLocaleDateString('ro-RO', {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});
	}

	function formatSize(bytes: number | null): string {
		if (!bytes) return '';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	async function generateMonth(month: number) {
		busyMonth = month;
		try {
			const res = await generateStripeStatementsForMonth({ year, month }).updates(overviewQuery);
			if (res.created > 0) {
				toast.success(`${res.created} raport(oarte) în lucru la Stripe pentru ${MONTH_NAMES[month - 1]}.`);
			} else if (res.unavailable.length > 0) {
				toast.warning(`Stripe nu are încă date pentru: ${res.unavailable.join(', ')}`);
			} else {
				toast.info('Rapoartele lunii există deja.');
			}
		} catch (e) {
			toast.error(remoteErrorMessage(e, 'Generarea extraselor a eșuat.'));
		} finally {
			busyMonth = null;
		}
	}

	async function generateYear() {
		busyYear = true;
		try {
			const res = await generateStripeStatementsForYear({ year }).updates(overviewQuery);
			if (res.created > 0) {
				toast.success(`${res.created} rapoarte pornite la Stripe pentru ${year}.`);
			} else if (!res.throttled) {
				toast.info('Toate rapoartele anului sunt deja generate sau în curs.');
			}
			if (res.throttled) {
				toast.warning(
					'Stripe a limitat rulările simultane. Ce s-a pornit rămâne valid — apasă din nou după ce se termină.'
				);
			}
			if (res.unavailable.length > 0) {
				toast.warning(`Fără date la Stripe pentru: ${res.unavailable.join(', ')}`);
			}
		} catch (e) {
			toast.error(remoteErrorMessage(e, 'Generarea extraselor a eșuat.'));
		} finally {
			busyYear = false;
		}
	}

	function openEmail(month: number | null) {
		emailMonth = month;
		emailNote = '';
		if (!emailTo) emailTo = localStorage.getItem(ACCOUNTANT_EMAIL_KEY) ?? '';
		emailOpen = true;
	}

	async function sendEmail() {
		emailSending = true;
		try {
			const res = await emailStripeStatements({
				year,
				month: emailMonth,
				to: emailTo.trim(),
				message: emailNote
			});
			localStorage.setItem(ACCOUNTANT_EMAIL_KEY, emailTo.trim());
			toast.success(`${res.files} fișiere trimise către ${res.to}.`);
			emailOpen = false;
		} catch (e) {
			toast.error(remoteErrorMessage(e, 'Trimiterea pe email a eșuat.'));
		} finally {
			emailSending = false;
		}
	}
</script>

<div class="space-y-6">
	<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
		<div>
			<h1 class="flex items-center gap-3 text-3xl font-bold">
				<svg class="h-7 w-7 text-[#635bff]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<path
						d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z"
					/>
				</svg>
				Extrase Stripe
			</h1>
			<p class="text-muted-foreground">
				Cele trei fișiere CSV cerute de Keez pentru importul extrasului Stripe, pe fus orar
				Europe/Bucharest.
			</p>
		</div>

		<div class="flex flex-wrap items-center gap-2">
			{#if years.length > 1}
				<div class="flex rounded-md border">
					{#each years as y (y)}
						<button
							type="button"
							class="px-3 py-1.5 text-sm font-medium {y === year
								? 'bg-primary text-primary-foreground'
								: 'hover:bg-muted'}"
							onclick={() => (year = y)}
						>
							{y}
						</button>
					{/each}
				</div>
			{/if}
			<Button variant="outline" size="sm" onclick={() => overviewQuery.refresh()}>
				<RefreshCwIcon class="mr-2 h-4 w-4" />Reîncarcă
			</Button>
			<Button size="sm" onclick={generateYear} disabled={busyYear}>
				{#if busyYear}
					<LoaderIcon class="mr-2 h-4 w-4 animate-spin" />Se pornesc…
				{:else}
					<PlayIcon class="mr-2 h-4 w-4" />Generează tot anul {year}
				{/if}
			</Button>
			<Button
				variant="outline"
				size="sm"
				href={downloadUrl(yearZipName, { year })}
				download={yearZipName}
				data-sveltekit-reload
			>
				<FileArchiveIcon class="mr-2 h-4 w-4" />ZIP {year}
			</Button>
			<Button variant="outline" size="sm" onclick={() => openEmail(null)}>
				<MailIcon class="mr-2 h-4 w-4" />Trimite anul
			</Button>
		</div>
	</div>

	<svelte:boundary>
		{#snippet pending()}
			<div class="space-y-3">
				{#each Array(4) as _, i (i)}
					<div class="h-16 animate-pulse rounded-lg border bg-muted/40"></div>
				{/each}
			</div>
		{/snippet}
		{#snippet failed(error, reset)}
			<div
				class="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300"
			>
				<div class="flex items-start gap-2">
					<TriangleAlertIcon class="mt-0.5 h-4 w-4 shrink-0" />
					<div class="space-y-2">
						<p>{remoteErrorMessage(error, 'Nu am putut citi rapoartele din Stripe.')}</p>
						<Button variant="outline" size="sm" onclick={reset}>Încearcă din nou</Button>
					</div>
				</div>
			</div>
		{/snippet}

		<PollWatcher active={overview.anyPending} ontick={() => overviewQuery.refresh()} />

		<!-- Context cont + reguli export -->
		<div class="grid gap-3 md:grid-cols-3">
			<div class="rounded-lg border p-4">
				<p class="text-xs text-muted-foreground">Cheia folosită pentru rapoarte</p>
				<p class="mt-1 flex flex-wrap items-center gap-2 font-medium">
					{overview.account?.accountName ?? 'Cont Stripe'}
					{#if overview.reportingKey.mode === 'live'}
						<Badge variant="secondary">LIVE</Badge>
					{:else}
						<Badge variant="destructive">TEST</Badge>
					{/if}
					{#if overview.reportingKey.restricted}
						<Badge variant="outline">restricționată</Badge>
					{/if}
				</p>
				{#if overview.reportingKey.mode !== 'live'}
					<p class="mt-2 text-xs text-rose-600 dark:text-rose-400">
						Stripe rulează rapoartele financiare doar pe chei live. Setează
						<code>STRIPE_REPORTING_KEY</code> cu o cheie restricționată
						<code>rk_live_…</code> (drepturi: Report runs write, Report types read, Files read).
						Cheia de plăți rămâne neatinsă.
					</p>
				{:else if !overview.reportingKey.dedicated}
					<p class="mt-2 text-xs text-amber-600 dark:text-amber-400">
						Se folosește cheia integrării de plăți. Pentru drepturi minime, setează o cheie
						dedicată în <code>STRIPE_REPORTING_KEY</code>.
					</p>
				{/if}
			</div>
			<div class="rounded-lg border p-4">
				<p class="text-xs text-muted-foreground">Fus orar export</p>
				<p class="mt-1 font-medium">{overview.timezone}</p>
				<p class="mt-2 text-xs text-muted-foreground">
					Date disponibile la Stripe până la {formatDate(overview.dataAvailableEnd)}
				</p>
			</div>
			<div class="rounded-lg border p-4">
				<p class="text-xs text-muted-foreground">Facturile Stripe (comisioane)</p>
				<p class="mt-1 text-sm">Nu fac parte din extras și nu au API — se iau manual.</p>
				<a
					class="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
					href="https://dashboard.stripe.com/settings/documents"
					target="_blank"
					rel="noopener noreferrer"
				>
					dashboard.stripe.com/settings/documents
					<ExternalLinkIcon class="h-3 w-3" />
				</a>
			</div>
		</div>

		{#if overview.months.length === 0}
			<div class="rounded-lg border p-8 text-center text-sm text-muted-foreground">
				Anul {year} nu a început încă.
			</div>
		{:else}
			<div class="overflow-x-auto rounded-lg border">
				<table class="w-full text-sm">
					<thead class="bg-muted/50 text-left">
						<tr>
							<th class="px-4 py-3 font-medium">Luna</th>
							{#each overview.months[0].reports as report (report.kind)}
								<th class="px-4 py-3 font-medium">{report.label}</th>
							{/each}
							<th class="px-4 py-3 text-right font-medium">Acțiuni</th>
						</tr>
					</thead>
					<tbody>
						{#each overview.months as month (month.key)}
							{@const ready = month.reports.filter((r) => r.status === 'succeeded').length}
							<tr class="border-t">
								<td class="px-4 py-3">
									<div class="font-medium">{MONTH_NAMES[month.month - 1]}</div>
									<div class="text-xs text-muted-foreground">
										{month.key}{month.complete ? '' : ' · lună în curs'}
									</div>
								</td>

								{#each month.reports as report (report.kind)}
									<td class="px-4 py-3">
										{#if report.status === 'succeeded'}
											<a
												class="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300"
												href={downloadUrl(report.fileName, { runId: report.runId ?? '' })}
												download={report.fileName}
												data-sveltekit-reload
											>
												<DownloadIcon class="h-3 w-3" />
												CSV
												{#if report.fileSize}
													<span class="text-emerald-600/70 dark:text-emerald-400/70"
														>{formatSize(report.fileSize)}</span
													>
												{/if}
											</a>
											{#if report.intervalEnd && report.intervalEnd < month.interval.end}
												<div class="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
													până la {formatDate(report.intervalEnd)}
												</div>
											{/if}
										{:else if report.status === 'pending'}
											<span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
												<LoaderIcon class="h-3 w-3 animate-spin" />se generează
											</span>
										{:else if report.status === 'failed'}
											<span
												class="inline-flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400"
												title={report.error ?? ''}
											>
												<TriangleAlertIcon class="h-3 w-3" />eșuat
											</span>
										{:else if report.status === 'unavailable'}
											<span class="text-xs text-muted-foreground">fără date</span>
										{:else}
											<span class="text-xs text-muted-foreground">—</span>
										{/if}
									</td>
								{/each}

								<td class="px-4 py-3">
									<div class="flex flex-wrap items-center justify-end gap-2">
										{#if ready === month.reports.length}
											<span
												class="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"
											>
												<CheckIcon class="h-3 w-3" />complet
											</span>
										{/if}
										<Button
											variant="outline"
											size="sm"
											onclick={() => generateMonth(month.month)}
											disabled={busyMonth === month.month}
										>
											{#if busyMonth === month.month}
												<LoaderIcon class="mr-1.5 h-3 w-3 animate-spin" />
											{:else}
												<PlayIcon class="mr-1.5 h-3 w-3" />
											{/if}
											{ready > 0 ? 'Regenerează' : 'Generează'}
										</Button>
										{#if ready > 0}
											<Button
												variant="outline"
												size="sm"
												href={downloadUrl(monthZipName(month.month), {
													year,
													month: month.month
												})}
												download={monthZipName(month.month)}
												data-sveltekit-reload
											>
												<FileArchiveIcon class="mr-1.5 h-3 w-3" />ZIP
											</Button>
											<Button variant="ghost" size="sm" onclick={() => openEmail(month.month)}>
												<MailIcon class="h-3 w-3" />
											</Button>
										{/if}
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<div class="rounded-lg border bg-muted/30 p-4 text-xs text-muted-foreground">
				<p class="mb-1 font-medium text-foreground">Ce conțin fișierele</p>
				<ul class="list-inside list-disc space-y-0.5">
					<li><strong>Balance Summary</strong> — solduri inițial/final și mișcările perioadei (toate coloanele).</li>
					<li>
						<strong>Balance change from activity</strong> — tranzacțiile cu clienții, Itemized, toate
						categoriile, cele 11 coloane (Default + Customer email + Customer name).
					</li>
					<li><strong>Payouts</strong> — sumele trase în cont, Itemized, coloanele default + Payout type.</li>
				</ul>
			</div>
		{/if}
	</svelte:boundary>
</div>

<Dialog bind:open={emailOpen}>
	<DialogContent class="sm:max-w-lg">
		<DialogHeader>
			<DialogTitle class="flex items-center gap-2">
				<MailIcon class="h-5 w-5" />Trimite extrasele
			</DialogTitle>
			<DialogDescription>
				{emailMonth
					? `${MONTH_NAMES[emailMonth - 1]} ${year} — cele trei fișiere CSV, atașate individual.`
					: `Tot anul ${year} — arhivă ZIP cu câte un folder pe lună.`}
				Se trimit doar rapoartele deja generate.
			</DialogDescription>
		</DialogHeader>

		<div class="space-y-3 py-2">
			<div class="space-y-1.5">
				<label class="text-sm font-medium" for="stripe-statements-email">Email destinatar</label>
				<Input
					id="stripe-statements-email"
					type="email"
					bind:value={emailTo}
					placeholder="contabilitate@exemplu.ro"
				/>
			</div>
			<div class="space-y-1.5">
				<label class="text-sm font-medium" for="stripe-statements-note">Mesaj (opțional)</label>
				<Textarea id="stripe-statements-note" bind:value={emailNote} rows={3} />
			</div>
		</div>

		<DialogFooter>
			<Button variant="outline" onclick={() => (emailOpen = false)}>Anulare</Button>
			<Button onclick={sendEmail} disabled={emailSending || !emailTo.trim()}>
				{#if emailSending}
					<LoaderIcon class="mr-2 h-4 w-4 animate-spin" />Se trimite…
				{:else}
					<MailIcon class="mr-2 h-4 w-4" />Trimite
				{/if}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
