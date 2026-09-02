<script lang="ts">
	// Setările Rank Tracker: oră verificare zilnică, zi/oră raport, destinatari,
	// toggle-uri, mod provider + credențiale DataForSEO (opțional).
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import XIcon from '@lucide/svelte/icons/x';
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
		onsave: (payload: Parameters<typeof saveRankSettings>[0], creds: { login: string; password: string } | null) => void;
	} = $props();

	const DAYS = [
		{ v: 1, l: 'Luni' }, { v: 2, l: 'Marți' }, { v: 3, l: 'Miercuri' }, { v: 4, l: 'Joi' },
		{ v: 5, l: 'Vineri' }, { v: 6, l: 'Sâmbătă' }, { v: 7, l: 'Duminică' }
	];

	let checkHour = $state('06:00');
	let reportDay = $state(1);
	let reportHour = $state('07:00');
	let recipientsText = $state('');
	let sendToClient = $state(false);
	let attachPdf = $state(true);
	let archiveToClient = $state(true);
	let alertsEnabled = $state(true);
	let providerMode = $state<'scraper' | 'dataforseo' | 'auto'>('scraper');
	let isEnabled = $state(true);
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
			recipientsText = settings.recipients.join(', ');
			sendToClient = settings.sendToClient;
			attachPdf = settings.attachPdf;
			archiveToClient = settings.archiveToClient;
			alertsEnabled = settings.alertsEnabled;
			providerMode = settings.providerMode;
			isEnabled = settings.isEnabled;
		}
	});

	const needsCreds = $derived(providerMode !== 'scraper');

	function submit() {
		error = null;
		const recipients = [...new Set(recipientsText.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))];
		const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (recipients.some((r) => !emailRe.test(r))) return (error = 'Unul dintre emailuri e invalid.');
		if (needsCreds && !settings?.hasIntegration && !(dfsLogin && dfsPassword)) {
			return (error = 'Pentru DataForSEO ai nevoie de login și parolă.');
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
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onclose(); }}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		{@attach psiDialog}
		aria-label="Setări Rank Tracker"
	>
		<div class="psi-modal-head">
			<span class="psi-modal-ic"><SettingsIcon size={17} /></span>
			<div>
				<div class="psi-modal-title">Setări Rank Tracker</div>
				<div class="psi-modal-sub">program de verificare, raport săptămânal, sursa de date</div>
			</div>
			<button class="psi-drawer-close" onclick={onclose} aria-label="Închide"><XIcon size={15} /></button>
		</div>
		<div class="psi-modal-body">
			<div class="cl-form-row two">
				<div class="cl-field">
					<label for="rk-check-hour">Ora verificării zilnice</label>
					<select id="rk-check-hour" class="cl-select" style="width:100%" bind:value={checkHour}>
						{#each RANK_HOURS as h (h)}<option value={h}>{h}</option>{/each}
					</select>
				</div>
				<div class="cl-field">
					<span class="cl-field-head">Raport săptămânal</span>
					<div style="display:flex;gap:8px">
						<select class="cl-select" style="flex:1" bind:value={reportDay}>
							{#each DAYS as d (d.v)}<option value={d.v}>{d.l}</option>{/each}
						</select>
						<select class="cl-select" style="flex:1" bind:value={reportHour}>
							{#each RANK_HOURS as h (h)}<option value={h}>{h}</option>{/each}
						</select>
					</div>
				</div>
			</div>
			<div class="cl-field">
				<label for="rk-recipients">Destinatari raport (emailuri, separate prin virgulă)</label>
				<input id="rk-recipients" class="cl-input" placeholder="seo@firma.ro, client@x.ro" bind:value={recipientsText} />
			</div>
			<div class="cl-form-row two">
				<div class="cl-field">
					<label class="cl-check"><input type="checkbox" bind:checked={sendToClient} /> Trimite și clientului</label>
					<label class="cl-check"><input type="checkbox" bind:checked={attachPdf} /> Atașează PDF</label>
					<label class="cl-check"><input type="checkbox" bind:checked={archiveToClient} /> Arhivează în fișa clientului</label>
				</div>
				<div class="cl-field">
					<label class="cl-check"><input type="checkbox" bind:checked={alertsEnabled} /> Alerte la scăderi</label>
					<label class="cl-check"><input type="checkbox" bind:checked={isEnabled} /> Modul activat</label>
				</div>
			</div>
			<div class="cl-field">
				<label for="rk-provider">Sursă poziții</label>
				<select id="rk-provider" class="cl-select" style="width:100%" bind:value={providerMode}>
					<option value="scraper">In-house (gratuit, pe serverul propriu)</option>
					<option value="dataforseo">DataForSEO (API plătit)</option>
					<option value="auto">Auto (in-house + DataForSEO la nevoie)</option>
				</select>
			</div>
			{#if needsCreds}
				<div class="cl-form-row two">
					<div class="cl-field">
						<label for="rk-dfs-login">DataForSEO login {#if settings?.hasIntegration}<span class="rk-tag">configurat</span>{/if}</label>
						<input id="rk-dfs-login" class="cl-input" placeholder="email DataForSEO" bind:value={dfsLogin} autocomplete="off" />
					</div>
					<div class="cl-field">
						<label for="rk-dfs-pass">DataForSEO parolă</label>
						<input id="rk-dfs-pass" class="cl-input" type="password" placeholder="••••••" bind:value={dfsPassword} autocomplete="off" />
					</div>
				</div>
			{/if}
			{#if error}<p class="cl-form-error">{error}</p>{/if}
		</div>
		<div class="psi-modal-foot">
			<div style="flex:1"></div>
			<button class="cl-btn-secondary" onclick={onclose}>Anulează</button>
			<button class="cl-btn-primary" onclick={submit}>Salvează</button>
		</div>
	</div>
</div>
