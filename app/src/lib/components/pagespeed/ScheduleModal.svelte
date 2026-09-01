<script lang="ts">
	// Modal „Raport săptămânal" (Setări raport) — port 1:1 din design.
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import SendIcon from '@lucide/svelte/icons/send';
	import XIcon from '@lucide/svelte/icons/x';
	import CheckIcon from '@lucide/svelte/icons/check';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PsiSwitch from './PsiSwitch.svelte';
	import PsiStratIcon from './PsiStratIcon.svelte';
	import { PSI_DAYS, PSI_HOURS, nextRunDate, type PsiStrategy } from '$lib/logic/pagespeed';
	import { psiDialog, psiFmtDate } from './lib';
	import type { PsiSettings } from './types';

	let {
		settings,
		saving = false,
		onclose,
		onsave
	}: {
		settings: PsiSettings;
		saving?: boolean;
		onclose: () => void;
		onsave: (settings: PsiSettings) => void;
	} = $props();

	const DEFAULTS: PsiSettings = {
		dayOfWeek: 1,
		hour: '07:00',
		strategies: ['mobile', 'desktop'],
		recipients: [],
		alertThreshold: 5,
		onlyOnDrop: false,
		includeOpportunities: true,
		attachPdf: false,
		sendToClient: false,
		isEnabled: true
	};

	// Instantaneu inițial intenționat: modalul e remontat la fiecare deschidere.
	// svelte-ignore state_referenced_locally
	let sched = $state<PsiSettings>({ ...settings, strategies: [...settings.strategies], recipients: [...settings.recipients] });
	let dirty = $state(false);
	let recipient = $state('');

	const dayName = $derived(PSI_DAYS[sched.dayOfWeek - 1] ?? 'Luni');
	const next = $derived(nextRunDate(sched.dayOfWeek, sched.hour));
	const nextRunLabel = $derived(`${dayName} ${psiFmtDate(next)}, ${sched.hour}`);
	const stratLabel = $derived(
		sched.strategies.length === 2
			? 'mobil + desktop'
			: sched.strategies[0] === 'mobile'
				? 'doar mobil'
				: 'doar desktop'
	);
	const emailValid = $derived(/.+@.+\..+/.test(recipient));

	function set<K extends keyof PsiSettings>(key: K, value: PsiSettings[K]) {
		sched = { ...sched, [key]: value };
		dirty = true;
	}
	function toggleStrategy(s: PsiStrategy) {
		const next = sched.strategies.includes(s)
			? sched.strategies.filter((x) => x !== s)
			: [...sched.strategies, s];
		if (next.length) set('strategies', next);
	}
	function addRecipient() {
		if (!emailValid) return;
		const value = recipient.trim().toLowerCase();
		// dedup: cheia din {#each} e emailul — un duplicat ar crăpa lista
		if (!sched.recipients.includes(value)) {
			set('recipients', [...sched.recipients, value]);
		}
		recipient = '';
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
		aria-label="Raport săptămânal"
	>
		<div class="psi-modal-head">
			<span class="psi-modal-ic"><CalendarIcon size={17} /></span>
			<div>
				<div class="psi-modal-title">Raport săptămânal</div>
				<div class="psi-modal-sub">programarea scanării automate și livrarea raportului</div>
			</div>
			<button class="psi-drawer-close" onclick={onclose} aria-label="Închide"><XIcon size={15} /></button>
		</div>
		<div class="psi-modal-body">
			<div class="psi-next">
				<span class="psi-next-ic"><SendIcon size={18} /></span>
				<div>
					<div class="psi-next-l1">{nextRunLabel}</div>
					<div class="psi-next-l2">
						Europe/Bucharest · {sched.recipients.length} destinatari · {stratLabel}
					</div>
				</div>
				{#if sched.isEnabled}<span class="psi-tag ok" style="margin-left: auto">activ</span>{:else}<span class="psi-tag" style="margin-left: auto">oprit</span>{/if}
			</div>

			<div class="psi-sched-grid">
				<div class="cl-field">
					<label for="psi-sched-day">Ziua</label>
					<select
						id="psi-sched-day"
						class="cl-select"
						style="width: 100%"
						value={sched.dayOfWeek}
						onchange={(e) => set('dayOfWeek', Number(e.currentTarget.value))}
					>
						{#each PSI_DAYS as d, i (d)}
							<option value={i + 1}>{d}</option>
						{/each}
					</select>
				</div>
				<div class="cl-field">
					<label for="psi-sched-hour">Ora</label>
					<select
						id="psi-sched-hour"
						class="cl-select"
						style="width: 100%"
						value={sched.hour}
						onchange={(e) => set('hour', e.currentTarget.value)}
					>
						{#each PSI_HOURS as h (h)}
							<option value={h}>{h}</option>
						{/each}
					</select>
				</div>
				<div class="cl-field">
					<span style="font-size: 12px; font-weight: 600; color: var(--cl-text)">Strategii</span>
					<div class="psi-seg multi" style="margin-top: 2px">
						{#each ['mobile', 'desktop'] as const as s (s)}
							<button
								class={sched.strategies.includes(s) ? 'active' : ''}
								aria-pressed={sched.strategies.includes(s)}
								title={sched.strategies.includes(s) ? 'Inclus în raport' : 'Adaugă în raport'}
								onclick={() => toggleStrategy(s)}
							>
								<span class="psi-seg-box"><CheckIcon size={10} /></span>
								<PsiStratIcon strategy={s} />
								{s === 'mobile' ? 'Mobil' : 'Desktop'}
							</button>
						{/each}
					</div>
				</div>
				<div class="cl-field">
					<label for="psi-sched-threshold">Prag alertă</label>
					<input
						id="psi-sched-threshold"
						class="cl-input"
						type="number"
						min="1"
						max="50"
						value={sched.alertThreshold}
						onchange={(e) => set('alertThreshold', Math.min(50, Math.max(1, Number(e.currentTarget.value) || 1)))}
					/>
				</div>
			</div>

			<div class="cl-field" style="margin-top: 14px">
				<div class="cl-field-head">
					<label for="psi-sched-recipient">Destinatari</label>
					<span class="cl-hint">primesc raportul și alertele</span>
				</div>
				<div class="psi-chips">
					{#each sched.recipients as r (r)}
						<span class="psi-chip">
							{r}
							<button
								title="Elimină"
								aria-label="Elimină {r}"
								onclick={() => set('recipients', sched.recipients.filter((x) => x !== r))}
							>
								<XIcon size={11} />
							</button>
						</span>
					{/each}
					{#if sched.recipients.length === 0}
						<span class="cl-hint">niciun destinatar — raportul nu se trimite</span>
					{/if}
				</div>
				<div class="psi-chip-add">
					<input
						id="psi-sched-recipient"
						class="cl-input"
						type="email"
						autocomplete="email"
						placeholder="email@client.ro"
						bind:value={recipient}
						onkeydown={(e) => e.key === 'Enter' && addRecipient()}
					/>
					<button class="cl-btn-secondary" disabled={!emailValid} onclick={addRecipient}>
						<PlusIcon size={12} /> Adaugă
					</button>
				</div>
			</div>

			<div class="psi-toggles">
				<div class="psi-toggle-row">
					<div>
						<div class="psi-toggle-txt">Trimite doar când scad scorurile</div>
						<div class="psi-toggle-sub">raportul pleacă doar dacă un site pierde ≥ {sched.alertThreshold} puncte</div>
					</div>
					<PsiSwitch on={sched.onlyOnDrop} label="Trimite doar când scad scorurile" onchange={(v) => set('onlyOnDrop', v)} />
				</div>
				<div class="psi-toggle-row">
					<div>
						<div class="psi-toggle-txt">Include oportunitățile PageSpeed</div>
						<div class="psi-toggle-sub">primele 3 recomandări pentru site-urile sub 90</div>
					</div>
					<PsiSwitch on={sched.includeOpportunities} label="Include oportunitățile PageSpeed" onchange={(v) => set('includeOpportunities', v)} />
				</div>
				<div class="psi-toggle-row">
					<div>
						<div class="psi-toggle-txt">Atașează PDF-ul raportului</div>
						<div class="psi-toggle-sub">un fișier per săptămână, arhivat în email</div>
					</div>
					<PsiSwitch on={sched.attachPdf} label="Atașează PDF-ul raportului" onchange={(v) => set('attachPdf', v)} />
				</div>
				<div class="psi-toggle-row">
					<div>
						<div class="psi-toggle-txt">Trimite și clientului</div>
						<div class="psi-toggle-sub">folosește emailul de contact din fișa clientului</div>
					</div>
					<PsiSwitch on={sched.sendToClient} label="Trimite și clientului" onchange={(v) => set('sendToClient', v)} />
				</div>
			</div>
		</div>
		<div class="psi-modal-foot">
			<span class="cl-hint" style="margin-right: auto">{dirty ? 'Modificări nesalvate' : 'Programare salvată'}</span>
			<button
				class="cl-btn-secondary"
				onclick={() => {
					sched = { ...DEFAULTS, strategies: [...DEFAULTS.strategies], recipients: [] };
					dirty = true;
				}}
			>
				Resetează
			</button>
			<button class="cl-btn-primary" disabled={saving} onclick={() => onsave(sched)}>
				<CheckIcon size={13} /> Salvează programarea
			</button>
		</div>
	</div>
</div>
