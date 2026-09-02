<script lang="ts">
	// Rulare zilnică și alerte — port 1:1 din `RTScheduleModal` (rank-modals.jsx),
	// cu câmpurile reale ale modulului (oră verificare, raport săptămânal, sursă SERP).
	import ClockIcon from '@lucide/svelte/icons/clock';
	import XIcon from '@lucide/svelte/icons/x';
	import CheckIcon from '@lucide/svelte/icons/check';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import PsiSwitch from '../pagespeed/PsiSwitch.svelte';
	import { psiDialog } from '../pagespeed/lib';
	import { RANK_HOURS } from '$lib/logic/rank-tracker';
	import type { saveRankSettings } from '$lib/remotes/rank-tracker.remote';

	type Settings = {
		checkHour: string;
		reportDay: number;
		reportHour: string;
		recipients: string[];
		sendToClient: boolean;
		attachPdf: boolean;
		archiveToClient: boolean;
		alertsEnabled: boolean;
		providerMode: 'scraper' | 'dataforseo' | 'auto';
		isEnabled: boolean;
		hasIntegration?: boolean;
	};

	let {
		settings,
		onclose,
		onsave
	}: {
		settings: Settings | null;
		onclose: () => void;
		onsave: (
			payload: Parameters<typeof saveRankSettings>[0],
			creds: { login: string; password: string } | null
		) => void;
	} = $props();

	const DAYS = [
		{ v: 1, l: 'Luni' }, { v: 2, l: 'Marți' }, { v: 3, l: 'Miercuri' }, { v: 4, l: 'Joi' },
		{ v: 5, l: 'Vineri' }, { v: 6, l: 'Sâmbătă' }, { v: 7, l: 'Duminică' }
	];

	let checkHour = $state('06:00');
	let reportDay = $state(1);
	let reportHour = $state('07:00');
	let recipients = $state<string[]>([]);
	let sendToClient = $state(false);
	let attachPdf = $state(true);
	let archiveToClient = $state(true);
	let alertsEnabled = $state(true);
	let providerMode = $state<'scraper' | 'dataforseo' | 'auto'>('scraper');
	let isEnabled = $state(true);
	let recip = $state('');
	let dfsLogin = $state('');
	let dfsPassword = $state('');
	let error = $state<string | null>(null);

	// Prefill din setările încărcate (o singură dată).
	let prefilled = $state(false);
	$effect(() => {
		if (settings && !prefilled) {
			prefilled = true;
			checkHour = settings.checkHour;
			reportDay = settings.reportDay;
			reportHour = settings.reportHour;
			recipients = [...settings.recipients];
			sendToClient = settings.sendToClient;
			attachPdf = settings.attachPdf;
			archiveToClient = settings.archiveToClient;
			alertsEnabled = settings.alertsEnabled;
			providerMode = settings.providerMode;
			isEnabled = settings.isEnabled;
		}
	});

	const needsCreds = $derived(providerMode !== 'scraper');
	const validRecip = $derived(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recip.trim()));
	const dayLabel = $derived(DAYS.find((d) => d.v === Number(reportDay))?.l ?? 'Luni');

	function addRecipient() {
		if (!validRecip) return;
		const value = recip.trim();
		if (!recipients.includes(value)) recipients = [...recipients, value];
		recip = '';
	}

	const TOGGLES = [
		['alertsEnabled', 'Alertă la scădere bruscă', 'email imediat când un cuvânt pierde poziții peste pragul proiectului'],
		['attachPdf', 'Atașează PDF-ul raportului', 'un fișier per raport, arhivat în fișa clientului'],
		['archiveToClient', 'Arhivează în fișa clientului', 'raportul rămâne în documentele clientului'],
		['sendToClient', 'Trimite și clientului', 'folosește emailul de contact din fișa clientului'],
		['isEnabled', 'Modul activ', 'oprește complet verificările și rapoartele când e stins']
	] as const;

	function toggleValue(key: (typeof TOGGLES)[number][0]): boolean {
		return key === 'alertsEnabled'
			? alertsEnabled
			: key === 'attachPdf'
				? attachPdf
				: key === 'archiveToClient'
					? archiveToClient
					: key === 'sendToClient'
						? sendToClient
						: isEnabled;
	}

	function setToggle(key: (typeof TOGGLES)[number][0], value: boolean) {
		if (key === 'alertsEnabled') alertsEnabled = value;
		else if (key === 'attachPdf') attachPdf = value;
		else if (key === 'archiveToClient') archiveToClient = value;
		else if (key === 'sendToClient') sendToClient = value;
		else isEnabled = value;
	}

	function submit() {
		error = null;
		if (needsCreds && !settings?.hasIntegration && !(dfsLogin && dfsPassword)) {
			error = 'Pentru DataForSEO ai nevoie de login și parolă.';
			return;
		}
		const creds = dfsLogin && dfsPassword ? { login: dfsLogin.trim(), password: dfsPassword } : null;
		onsave(
			{
				checkHour,
				reportDay: Number(reportDay),
				reportHour,
				recipients,
				sendToClient,
				attachPdf,
				archiveToClient,
				alertsEnabled,
				providerMode,
				isEnabled
			},
			creds
		);
	}
</script>

<div class="psi-modal-back" onclick={onclose} role="presentation">
	<div
		class="psi-modal"
		style="width: 640px"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => {
			e.stopPropagation();
			if (e.key === 'Escape') onclose();
		}}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		{@attach psiDialog}
		aria-label="Rulare zilnică și alerte"
	>
		<div class="psi-modal-head">
			<span class="psi-modal-ic"><ClockIcon size={17} /></span>
			<div>
				<div class="psi-modal-title">Rulare zilnică și alerte</div>
				<div class="psi-modal-sub">verificarea pozițiilor, sursa de date și livrarea rapoartelor</div>
			</div>
			<button class="psi-drawer-close" onclick={onclose} aria-label="Închide"><XIcon size={15} /></button>
		</div>
		<div class="psi-modal-body">
			<div class="psi-next">
				<span class="psi-next-ic"><RefreshCwIcon size={18} /></span>
				<div>
					<div class="psi-next-l1">Zilnic, {checkHour} · Europe/Bucharest</div>
					<div class="psi-next-l2">
						raport {dayLabel.toLowerCase()} la {reportHour} · {recipients.length}
						{recipients.length === 1 ? 'destinatar' : 'destinatari'}
					</div>
				</div>
				<span class="psi-tag {isEnabled ? 'ok' : 'warn'}" style="margin-left: auto">{isEnabled ? 'activ' : 'oprit'}</span>
			</div>

			<div class="psi-sched-grid">
				<div class="cl-field">
					<label for="rt-check-hour">Ora rulării</label>
					<select id="rt-check-hour" class="cl-select" style="width: 100%" bind:value={checkHour}>
						{#each RANK_HOURS as h (h)}<option value={h}>{h}</option>{/each}
					</select>
				</div>
				<div class="cl-field">
					<label for="rt-report-day">Ziua raportului</label>
					<select id="rt-report-day" class="cl-select" style="width: 100%" bind:value={reportDay}>
						{#each DAYS as d (d.v)}<option value={d.v}>{d.l}</option>{/each}
					</select>
				</div>
				<div class="cl-field">
					<label for="rt-report-hour">Ora raportului</label>
					<select id="rt-report-hour" class="cl-select" style="width: 100%" bind:value={reportHour}>
						{#each RANK_HOURS as h (h)}<option value={h}>{h}</option>{/each}
					</select>
				</div>
				<div class="cl-field">
					<label for="rt-provider">Sursă poziții</label>
					<select id="rt-provider" class="cl-select" style="width: 100%" bind:value={providerMode}>
						<option value="scraper">In-house (gratuit)</option>
						<option value="dataforseo">DataForSEO (API)</option>
						<option value="auto">Auto (in-house + DataForSEO)</option>
					</select>
				</div>
			</div>

			{#if needsCreds}
				<div class="psi-sched-grid" style="grid-template-columns: repeat(2, minmax(0, 1fr))">
					<div class="cl-field">
						<label for="rt-dfs-login">
							DataForSEO login
							{#if settings?.hasIntegration}<span class="psi-tag ok">configurat</span>{/if}
						</label>
						<input id="rt-dfs-login" class="cl-input" placeholder="email DataForSEO" bind:value={dfsLogin} autocomplete="off" />
					</div>
					<div class="cl-field">
						<label for="rt-dfs-pass">DataForSEO parolă</label>
						<input id="rt-dfs-pass" class="cl-input" type="password" placeholder="••••••" bind:value={dfsPassword} autocomplete="off" />
					</div>
				</div>
			{/if}

			<div class="cl-field" style="margin-top: 14px">
				<div class="cl-field-head">
					<label for="rt-recip">Destinatari</label>
					<span class="cl-hint">primesc alertele și raportul săptămânal</span>
				</div>
				<div class="psi-chips">
					{#each recipients as r (r)}
						<span class="psi-chip">
							{r}
							<button onclick={() => (recipients = recipients.filter((x) => x !== r))} aria-label="Scoate {r}">
								<XIcon size={11} />
							</button>
						</span>
					{/each}
					{#if recipients.length === 0}
						<span class="cl-hint">niciun destinatar — raportul nu pleacă</span>
					{/if}
				</div>
				<div class="psi-chip-add">
					<input
						id="rt-recip"
						class="cl-input"
						placeholder="email@client.ro"
						bind:value={recip}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								addRecipient();
							}
						}}
					/>
					<button class="cl-btn-secondary" disabled={!validRecip} onclick={addRecipient}><PlusIcon size={12} /> Adaugă</button>
				</div>
			</div>

			<div class="psi-toggles">
				{#each TOGGLES as [key, title, sub] (key)}
					<div class="psi-toggle-row">
						<div>
							<div class="psi-toggle-txt">{title}</div>
							<div class="psi-toggle-sub">{sub}</div>
						</div>
						<PsiSwitch on={toggleValue(key)} label={title} onchange={(v) => setToggle(key, v)} />
					</div>
				{/each}
			</div>

			{#if error}<p class="cl-form-error">{error}</p>{/if}
		</div>
		<div class="psi-modal-foot">
			<button class="cl-btn-secondary" onclick={onclose}>Anulează</button>
			<button class="cl-btn-primary" onclick={submit}><CheckIcon size={13} /> Salvează</button>
		</div>
	</div>
</div>
