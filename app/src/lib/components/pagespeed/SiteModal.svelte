<script lang="ts">
	// Modal adăugare / editare site monitorizat — port 1:1 din design (PSISiteModal).
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import XIcon from '@lucide/svelte/icons/x';
	import CheckIcon from '@lucide/svelte/icons/check';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import PsiSwitch from './PsiSwitch.svelte';
	import PsiStratIcon from './PsiStratIcon.svelte';
	import { psiDialog } from './lib';
	import type { PsiStrategy } from '$lib/logic/pagespeed';
	import { PSI_CMS_OPTIONS, type PsiSitePayload, type PsiSiteRow } from './types';

	let {
		site,
		clients,
		saving = false,
		onclose,
		onsave,
		ondelete
	}: {
		site: PsiSiteRow | null;
		clients: { id: string; name: string }[];
		saving?: boolean;
		onclose: () => void;
		onsave: (payload: PsiSitePayload) => void;
		ondelete: (id: string) => void;
	} = $props();

	const editing = $derived(!!site);

	// Formularul pornește de la un instantaneu al site-ului: modalul e remontat la
	// fiecare deschidere ({#if editing}), deci valorile inițiale sunt intenționat statice.
	// svelte-ignore state_referenced_locally
	let name = $state(site?.name ?? '');
	// svelte-ignore state_referenced_locally
	let clientId = $state<string>(site?.clientId ?? '');
	// svelte-ignore state_referenced_locally
	let cms = $state(site?.cms ?? 'WordPress');
	// svelte-ignore state_referenced_locally
	let alertThreshold = $state(site?.alertThreshold ?? 5);
	// svelte-ignore state_referenced_locally
	let active = $state(site?.active ?? true);
	// svelte-ignore state_referenced_locally
	let strategies = $state<PsiStrategy[]>(site ? [...site.strategies] : ['mobile', 'desktop']);
	// svelte-ignore state_referenced_locally
	let pages = $state(
		site ? site.pages.map((p) => ({ ...p })) : [{ url: '', label: 'Homepage' }]
	);
	let err = $state('');

	function normalize(raw: string): string {
		let value = (raw || '').trim();
		if (!value) return '';
		if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
		return value;
	}

	function toggleStrategy(s: PsiStrategy) {
		strategies = strategies.includes(s)
			? strategies.filter((x) => x !== s)
			: [...strategies, s];
	}

	function save() {
		const first = normalize(pages[0]?.url);
		if (!first) {
			err = 'Adaugă cel puțin URL-ul paginii principale.';
			return;
		}
		try {
			const host = new URL(first).hostname.replace(/^www\./, '');
			if (!host.includes('.')) throw new Error('invalid');
		} catch {
			err = 'URL invalid. Exemplu: https://exemplu.ro/';
			return;
		}
		if (!strategies.length) {
			err = 'Selectează cel puțin o strategie (mobil sau desktop).';
			return;
		}
		err = '';
		onsave({
			id: site?.id,
			name: name.trim(),
			clientId: clientId || null,
			cms,
			alertThreshold: Math.min(50, Math.max(1, Number(alertThreshold) || 5)),
			active,
			strategies,
			pages: pages
				.filter((p) => normalize(p.url))
				.map((p) => ({ url: normalize(p.url), label: p.label || 'Pagină' }))
		});
	}
</script>

<div class="psi-modal-back" onclick={onclose} role="presentation">
	<div
		class="psi-modal"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => {
			e.stopPropagation();
			if (e.key === 'Escape') onclose();
		}}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		{@attach psiDialog}
		aria-label={editing ? 'Editează site-ul monitorizat' : 'Adaugă site în monitorizare'}
	>
		<div class="psi-modal-head">
			<span class="psi-modal-ic"><GlobeIcon size={17} /></span>
			<div>
				<div class="psi-modal-title">
					{editing ? 'Editează site-ul monitorizat' : 'Adaugă site în monitorizare'}
				</div>
				<div class="psi-modal-sub">
					{editing ? site?.domain : 'site-ul intră automat în raportul săptămânal PageSpeed'}
				</div>
			</div>
			<button class="psi-drawer-close" onclick={onclose} aria-label="Închide"><XIcon size={15} /></button>
		</div>
		<div class="psi-modal-body">
			<div class="cl-form-row two">
				<div class="cl-field">
					<label for="psi-site-name">Nume site</label>
					<input id="psi-site-name" class="cl-input" placeholder="ex: Heylux Studio" bind:value={name} />
				</div>
				<div class="cl-field">
					<label for="psi-site-client">Client</label>
					<select id="psi-site-client" class="cl-select" style="width: 100%" bind:value={clientId}>
						<option value="">— fără client —</option>
						{#each clients as c (c.id)}
							<option value={c.id}>{c.name}</option>
						{/each}
					</select>
				</div>
			</div>
			<div class="cl-field" style="margin-top: 12px">
				<div class="cl-field-head">
					<label for="psi-page-url-0">Pagini testate <span class="cl-req">*</span></label>
					<span class="cl-hint">prima pagină este cea raportată în tabel</span>
				</div>
				{#each pages as p, i (i)}
					<div style="display: grid; grid-template-columns: 150px 1fr 32px; gap: 8px; margin-top: 8px">
						<input class="cl-input" placeholder="Etichetă" bind:value={p.label} aria-label="Etichetă pagină" />
						<input
							id="psi-page-url-{i}"
							class="cl-input"
							placeholder="https://exemplu.ro/"
							bind:value={p.url}
							aria-label="URL pagină"
						/>
						<button
							class="cl-icon-btn"
							title="Șterge pagina"
							disabled={pages.length === 1}
							onclick={() => (pages = pages.filter((_, j) => j !== i))}
						>
							<Trash2Icon size={13} />
						</button>
					</div>
				{/each}
				<button
					class="cl-btn-mini"
					style="margin-top: 9px"
					onclick={() => (pages = [...pages, { url: '', label: 'Pagină' }])}
				>
					<PlusIcon size={11} /> Adaugă pagină
				</button>
			</div>
			<div class="cl-form-row three" style="margin-top: 14px">
				<div class="cl-field">
					<label for="psi-site-cms">Platformă</label>
					<select id="psi-site-cms" class="cl-select" style="width: 100%" bind:value={cms}>
						{#each PSI_CMS_OPTIONS as option (option)}
							<option value={option}>{option}</option>
						{/each}
					</select>
				</div>
				<div class="cl-field">
					<span style="font-size: 12px; font-weight: 600; color: var(--cl-text)">Strategii testate</span>
					<div class="psi-seg multi" style="margin-top: 2px">
						{#each ['mobile', 'desktop'] as const as s (s)}
							<button
								class={strategies.includes(s) ? 'active' : ''}
								title={strategies.includes(s) ? 'Se testează' : 'Adaugă strategia'}
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
					<label for="psi-site-alert">Prag alertă (puncte)</label>
					<input id="psi-site-alert" class="cl-input" type="number" min="1" max="50" bind:value={alertThreshold} />
					<span class="cl-hint">alertă în raport dacă scorul scade cu cel puțin atât</span>
				</div>
			</div>
			<div class="psi-toggle-row" style="margin-top: 10px; border-top: 1px solid var(--cl-border)">
				<div>
					<div class="psi-toggle-txt">Monitorizare activă</div>
					<div class="psi-toggle-sub">site-urile inactive rămân în listă, dar nu se scanează</div>
				</div>
				<PsiSwitch on={active} label="Monitorizare activă" onchange={(v) => (active = v)} />
			</div>
			{#if err}
				<div class="psi-mail-alert" style="margin-top: 12px">{err}</div>
			{/if}
		</div>
		<div class="psi-modal-foot">
			{#if editing && site}
				<button
					class="cl-btn-secondary"
					style="margin-right: auto; color: var(--cl-danger)"
					onclick={() => ondelete(site.id)}
				>
					<Trash2Icon size={13} /> Scoate din monitorizare
				</button>
			{/if}
			<button class="cl-btn-secondary" onclick={onclose}>Anulează</button>
			<button class="cl-btn-primary" disabled={saving} onclick={save}>
				<CheckIcon size={13} />
				{editing ? 'Salvează' : 'Adaugă site'}
			</button>
		</div>
	</div>
</div>
