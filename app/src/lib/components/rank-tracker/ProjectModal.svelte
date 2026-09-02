<script lang="ts">
	// Proiect nou / editare — port 1:1 din `RTProjectModal` (rank-modals.jsx):
	// domeniu, nume, client, motor·limbă, prag alertă, status, locații și competitori
	// ca chips. În plus față de design: dispozitivele urmărite (le cere backendul).
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import XIcon from '@lucide/svelte/icons/x';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import CheckIcon from '@lucide/svelte/icons/check';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import PsiSwitch from '../pagespeed/PsiSwitch.svelte';
	import PsiStratIcon from '../pagespeed/PsiStratIcon.svelte';
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
		{ value: 'google.ro|ro', label: 'google.ro · ro' },
		{ value: 'google.com|en', label: 'google.com · en' },
		{ value: 'google.de|de', label: 'google.de · de' },
		{ value: 'google.fr|fr', label: 'google.fr · fr' },
		{ value: 'google.it|it', label: 'google.it · it' },
		{ value: 'google.es|es', label: 'google.es · es' },
		{ value: 'google.hu|hu', label: 'google.hu · hu' }
	];

	let name = $state('');
	let clientId = $state('');
	let domain = $state('');
	let locale = $state('google.ro|ro');
	let locations = $state<string[]>(['România']);
	let competitors = $state<string[]>([]);
	let devices = $state<('desktop' | 'mobile')[]>(['desktop', 'mobile']);
	let alertThreshold = $state(5);
	let active = $state(true);
	let locIn = $state('');
	let compIn = $state('');
	let error = $state<string | null>(null);

	// La editare, configul complet vine din detaliu (o singură dată).
	const detailQuery = $derived(project ? getRankProjectDetail(project.id) : undefined);
	let prefilled = $state(false);
	$effect(() => {
		const d = detailQuery?.current;
		if (d && !prefilled) {
			prefilled = true;
			name = d.name;
			domain = d.domain;
			clientId = d.clientId ?? '';
			locale = d.locale;
			locations = [...d.locations];
			competitors = [...d.competitors];
			devices = [...d.devices];
			alertThreshold = d.alertThreshold;
			active = d.active;
		}
	});

	const validDomain = $derived(/.+\..+/.test(domain));
	const valid = $derived(validDomain && !!name.trim() && devices.length > 0);
	const validComp = $derived(/.+\..+/.test(compIn.trim()));

	function toggleDevice(d: 'desktop' | 'mobile') {
		const next = devices.includes(d) ? devices.filter((x) => x !== d) : [...devices, d];
		if (next.length) devices = next;
	}
	function addLocation() {
		const v = locIn.trim();
		if (!v || locations.includes(v) || locations.length >= 5) return;
		locations = [...locations, v];
		locIn = '';
	}
	function addCompetitor() {
		const v = compIn.trim();
		if (!validComp || competitors.includes(v) || competitors.length >= 5) return;
		competitors = [...competitors, v];
		compIn = '';
	}

	function submit() {
		error = null;
		if (!valid) {
			error = 'Completează domeniul, numele și cel puțin un dispozitiv.';
			return;
		}
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
		style="width: 660px"
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
				<div class="psi-modal-sub">domeniul, motorul de căutare și locațiile urmărite</div>
			</div>
			<button class="psi-drawer-close" onclick={onclose} aria-label="Închide"><XIcon size={15} /></button>
		</div>
		<div class="psi-modal-body">
			<div class="rt-add-grid">
				<div class="cl-field">
					<label for="rt-p-domain">Domeniu</label>
					<input id="rt-p-domain" class="cl-input" placeholder="exemplu.ro" bind:value={domain} />
				</div>
				<div class="cl-field">
					<label for="rt-p-name">Nume proiect</label>
					<input id="rt-p-name" class="cl-input" placeholder="Exemplu Shop" bind:value={name} />
				</div>
				<div class="cl-field">
					<label for="rt-p-client">Client</label>
					<select id="rt-p-client" class="cl-select" style="width: 100%" bind:value={clientId}>
						<option value="">— fără client —</option>
						{#each clients as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
					</select>
				</div>
				<div class="cl-field">
					<label for="rt-p-locale">Motor · limbă</label>
					<select id="rt-p-locale" class="cl-select" style="width: 100%" bind:value={locale}>
						{#each LOCALES as l (l.value)}<option value={l.value}>{l.label}</option>{/each}
					</select>
				</div>
				<div class="cl-field">
					<label for="rt-p-thr">Prag alertă (poziții)</label>
					<input id="rt-p-thr" class="cl-input" type="number" min="1" max="50" bind:value={alertThreshold} />
				</div>
				<div class="cl-field">
					<span class="cl-field-head">Status</span>
					<div style="display: flex; align-items: center; gap: 10px; margin-top: 8px">
						<PsiSwitch on={active} label="Proiect activ" onchange={(v) => (active = v)} />
						<span style="font-size: 12.5px; font-weight: 600; color: var(--cl-text-2)">
							{active ? 'verificare zilnică activă' : 'în pauză'}
						</span>
					</div>
				</div>
			</div>

			<div class="cl-field" style="margin-top: 14px">
				<span class="cl-field-head">Dispozitive urmărite</span>
				<div class="psi-seg multi" style="margin-top: 4px">
					{#each ['desktop', 'mobile'] as const as d (d)}
						<button class={devices.includes(d) ? 'active' : ''} aria-pressed={devices.includes(d)} onclick={() => toggleDevice(d)}>
							<span class="psi-seg-box"><CheckIcon size={10} /></span>
							<PsiStratIcon strategy={d} />
							{d === 'mobile' ? 'Mobil' : 'Desktop'}
						</button>
					{/each}
				</div>
			</div>

			<div class="cl-field" style="margin-top: 14px">
				<div class="cl-field-head">
					<label for="rt-p-loc">Locații</label>
					<span class="cl-hint">poziții separate pe fiecare locație · maxim 5</span>
				</div>
				<div class="psi-chips">
					{#each locations as l (l)}
						<span class="psi-chip">
							<MapPinIcon size={11} />
							{l}
							<button onclick={() => (locations = locations.filter((x) => x !== l))} aria-label="Scoate {l}">
								<XIcon size={11} />
							</button>
						</span>
					{/each}
				</div>
				<div class="psi-chip-add">
					<input
						id="rt-p-loc"
						class="cl-input"
						placeholder="oraș sau țară"
						bind:value={locIn}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								addLocation();
							}
						}}
					/>
					<button class="cl-btn-secondary" disabled={!locIn.trim() || locations.length >= 5} onclick={addLocation}>
						<PlusIcon size={12} /> Adaugă
					</button>
				</div>
			</div>

			<div class="cl-field" style="margin-top: 14px">
				<div class="cl-field-head">
					<label for="rt-p-comp">Competitori urmăriți</label>
					<span class="cl-hint">maxim 5 domenii</span>
				</div>
				<div class="psi-chips">
					{#each competitors as c (c)}
						<span class="psi-chip">
							{c}
							<button onclick={() => (competitors = competitors.filter((x) => x !== c))} aria-label="Scoate {c}">
								<XIcon size={11} />
							</button>
						</span>
					{/each}
					{#if competitors.length === 0}
						<span class="cl-hint">niciun competitor — comparația nu apare în raport</span>
					{/if}
				</div>
				<div class="psi-chip-add">
					<input
						id="rt-p-comp"
						class="cl-input"
						placeholder="competitor.ro"
						bind:value={compIn}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								addCompetitor();
							}
						}}
					/>
					<button class="cl-btn-secondary" disabled={!validComp || competitors.length >= 5} onclick={addCompetitor}>
						<PlusIcon size={12} /> Adaugă
					</button>
				</div>
			</div>

			{#if error}<p class="cl-form-error">{error}</p>{/if}
		</div>
		<div class="psi-modal-foot">
			{#if project}
				<button class="cl-btn-secondary cl-btn-danger" style="margin-right: auto" onclick={() => ondelete(project.id)}>
					<Trash2Icon size={13} /> Șterge proiectul
				</button>
			{/if}
			<button class="cl-btn-secondary" onclick={onclose}>Anulează</button>
			<button class="cl-btn-primary" disabled={!valid} onclick={submit}><CheckIcon size={13} /> Salvează</button>
		</div>
	</div>
</div>
