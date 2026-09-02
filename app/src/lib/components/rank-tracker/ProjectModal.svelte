<script lang="ts">
	// Modal de adăugare/editare proiect Rank Tracker.
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import XIcon from '@lucide/svelte/icons/x';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { psiDialog } from '../pagespeed/lib';
	import { getRankProjectDetail, type saveRankProject } from '$lib/remotes/rank-tracker.remote';
	import type { RankProjectListRow } from '$lib/server/rank-tracker/projects-data';

	let {
		project,
		clients,
		onclose,
		onsave,
		ondelete
	}: {
		project: RankProjectListRow | null;
		clients: { id: string; name: string }[];
		onclose: () => void;
		onsave: (payload: Parameters<typeof saveRankProject>[0]) => void;
		ondelete: (id: string) => void;
	} = $props();

	const LOCALES = [
		{ value: 'google.ro|ro', label: 'Google România (ro)' },
		{ value: 'google.com|en', label: 'Google.com (en)' },
		{ value: 'google.de|de', label: 'Google Germania (de)' },
		{ value: 'google.fr|fr', label: 'Google Franța (fr)' },
		{ value: 'google.it|it', label: 'Google Italia (it)' },
		{ value: 'google.es|es', label: 'Google Spania (es)' }
	];

	let name = $state('');
	let clientId = $state('');
	let domain = $state('');
	let locale = $state('google.ro|ro');
	let locationsText = $state('');
	let competitorsText = $state('');
	let devices = $state<('desktop' | 'mobile')[]>(['desktop', 'mobile']);
	let alertThreshold = $state(5);
	let active = $state(true);
	let error = $state<string | null>(null);

	// La editare, încarcă configul complet din detaliu (o singură dată).
	const detailQuery = $derived(project ? getRankProjectDetail(project.id) : undefined);
	let prefilled = $state(false);
	$effect(() => {
		const d = detailQuery?.current;
		if (d && !prefilled) {
			prefilled = true;
			name = d.name;
			domain = d.domain;
			locale = d.locale;
			locationsText = d.locations.join(', ');
			competitorsText = d.competitors.join(', ');
			devices = d.devices;
			alertThreshold = d.alertThreshold;
			active = d.active;
		}
	});

	function toggleDevice(device: 'desktop' | 'mobile') {
		devices = devices.includes(device) ? devices.filter((x) => x !== device) : [...devices, device];
	}

	function parseList(text: string): string[] {
		return [...new Set(text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))];
	}

	function submit() {
		error = null;
		if (!name.trim()) return (error = 'Numele proiectului este obligatoriu.');
		if (domain.trim().length < 3) return (error = 'Domeniul este obligatoriu.');
		if (devices.length === 0) return (error = 'Alege cel puțin un dispozitiv.');
		const locations = parseList(locationsText);
		if (locations.length > 5) return (error = 'Maxim 5 locații.');
		const competitors = parseList(competitorsText);
		if (competitors.length > 10) return (error = 'Maxim 10 competitori.');
		onsave({
			id: project?.id,
			name: name.trim(),
			clientId: clientId || null,
			domain: domain.trim(),
			locale,
			locations: locations.length ? locations : ['România'],
			competitors,
			devices,
			alertThreshold: Math.min(50, Math.max(1, Number(alertThreshold) || 5)),
			active
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
		aria-label={project ? 'Editează proiectul' : 'Proiect nou'}
	>
		<div class="psi-modal-head">
			<span class="psi-modal-ic"><GlobeIcon size={17} /></span>
			<div>
				<div class="psi-modal-title">{project ? 'Editează proiectul' : 'Proiect nou'}</div>
				<div class="psi-modal-sub">{project ? project.domain : 'urmărește pozițiile organice ale unui domeniu'}</div>
			</div>
			<button class="psi-drawer-close" onclick={onclose} aria-label="Închide"><XIcon size={15} /></button>
		</div>
		<div class="psi-modal-body">
			<div class="cl-form-row two">
				<div class="cl-field">
					<label for="rk-name">Nume proiect</label>
					<input id="rk-name" class="cl-input" placeholder="ex: Heylux Studio" bind:value={name} />
				</div>
				<div class="cl-field">
					<label for="rk-client">Client</label>
					<select id="rk-client" class="cl-select" style="width:100%" bind:value={clientId}>
						<option value="">— fără client —</option>
						{#each clients as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
					</select>
				</div>
			</div>
			<div class="cl-form-row two">
				<div class="cl-field">
					<label for="rk-domain">Domeniu</label>
					<input id="rk-domain" class="cl-input" placeholder="example.ro" bind:value={domain} />
				</div>
				<div class="cl-field">
					<label for="rk-locale">Motor / limbă</label>
					<select id="rk-locale" class="cl-select" style="width:100%" bind:value={locale}>
						{#each LOCALES as l (l.value)}<option value={l.value}>{l.label}</option>{/each}
					</select>
				</div>
			</div>
			<div class="cl-field">
				<label for="rk-loc">Locații (separate prin virgulă, max 5)</label>
				<input id="rk-loc" class="cl-input" placeholder="București, Cluj-Napoca" bind:value={locationsText} />
			</div>
			<div class="cl-field">
				<label for="rk-comp">Competitori (domenii, separate prin virgulă, max 10)</label>
				<input id="rk-comp" class="cl-input" placeholder="notino.ro, sephora.ro" bind:value={competitorsText} />
			</div>
			<div class="cl-form-row two">
				<div class="cl-field">
					<span class="cl-field-head">Dispozitive</span>
					<label class="cl-check"><input type="checkbox" checked={devices.includes('desktop')} onchange={() => toggleDevice('desktop')} /> Desktop</label>
					<label class="cl-check"><input type="checkbox" checked={devices.includes('mobile')} onchange={() => toggleDevice('mobile')} /> Mobil</label>
				</div>
				<div class="cl-field">
					<label for="rk-thr">Prag alertă (poziții)</label>
					<input id="rk-thr" class="cl-input" type="number" min="1" max="50" bind:value={alertThreshold} />
					<label class="cl-check" style="margin-top:8px"><input type="checkbox" bind:checked={active} /> Proiect activ</label>
				</div>
			</div>
			{#if error}<p class="cl-form-error">{error}</p>{/if}
		</div>
		<div class="psi-modal-foot">
			{#if project}
				<button class="cl-btn-secondary cl-btn-danger" onclick={() => ondelete(project.id)}><Trash2Icon size={14} /> Șterge</button>
			{/if}
			<div style="flex:1"></div>
			<button class="cl-btn-secondary" onclick={onclose}>Anulează</button>
			<button class="cl-btn-primary" onclick={submit}>Salvează</button>
		</div>
	</div>
</div>
