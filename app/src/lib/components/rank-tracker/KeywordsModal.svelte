<script lang="ts">
	// Adăugare cuvinte cheie — port 1:1 din `RTAddKwModal` (rank-modals.jsx).
	// Un cuvânt pe linie; dispozitivele sunt cele urmărite de proiect.
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import CheckIcon from '@lucide/svelte/icons/check';
	import PsiStratIcon from '../pagespeed/PsiStratIcon.svelte';
	import { psiDialog } from '../pagespeed/lib';
	import { rtLocaleLabel } from './lib';

	let {
		domain,
		locale,
		locations,
		devices,
		tags,
		checkHour,
		limit = 500,
		onclose,
		onadd
	}: {
		domain: string;
		locale: string;
		locations: string[];
		devices: ('desktop' | 'mobile')[];
		tags: string[];
		checkHour: string;
		limit?: number;
		onclose: () => void;
		onadd: (keywords: string[], tag: string | null, location: string) => void;
	} = $props();

	let text = $state('');
	let tag = $state('');
	// null = nu s-a ales nimic încă → prima locație a proiectului
	let locationSel = $state<string | null>(null);
	const location = $derived(locationSel ?? locations[0] ?? '');

	const lines = $derived(text.split('\n').map((l) => l.trim()).filter(Boolean));
	const uniq = $derived([...new Set(lines.map((l) => l.toLowerCase()))]);
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
		aria-label="Adaugă cuvinte cheie"
	>
		<div class="psi-modal-head">
			<span class="psi-modal-ic"><PlusIcon size={17} /></span>
			<div>
				<div class="psi-modal-title">Adaugă cuvinte cheie</div>
				<div class="psi-modal-sub">un cuvânt cheie pe linie · se verifică zilnic începând cu următoarea rulare</div>
			</div>
			<button class="psi-drawer-close" onclick={onclose} aria-label="Închide"><XIcon size={15} /></button>
		</div>
		<div class="psi-modal-body">
			<div class="rt-add-grid">
				<div class="cl-field">
					<label for="rt-kw-proj">Proiect</label>
					<input id="rt-kw-proj" class="cl-input" value={domain} readonly />
				</div>
				<div class="cl-field">
					<label for="rt-kw-tag">Grup / tag</label>
					<input id="rt-kw-tag" class="cl-input" list="rt-kw-tags" placeholder="ex: Produse" bind:value={tag} />
					<datalist id="rt-kw-tags">
						{#each tags as t (t)}<option value={t}></option>{/each}
					</datalist>
				</div>
				<div class="cl-field">
					<label for="rt-kw-loc">Locație</label>
					{#if locations.length}
						<select id="rt-kw-loc" class="cl-select" style="width: 100%" value={location} onchange={(e) => (locationSel = e.currentTarget.value)}>
							{#each locations as l (l)}<option value={l}>{l}</option>{/each}
						</select>
					{:else}
						<input id="rt-kw-loc" class="cl-input" placeholder="România" value={location} oninput={(e) => (locationSel = e.currentTarget.value)} />
					{/if}
				</div>
			</div>
			<div class="cl-field" style="margin-top: 14px">
				<div class="cl-field-head">
					<label for="rt-kw-text">Cuvinte cheie</label>
					<span class="cl-hint">{rtLocaleLabel(locale)} · maxim {limit} pe proiect</span>
				</div>
				<textarea
					id="rt-kw-text"
					class="rt-ta"
					placeholder={'serum vitamina c\ncreme pentru ten uscat\nmagazin cosmetice bucuresti'}
					bind:value={text}
				></textarea>
				<div class="rt-count">
					<span><b>{lines.length}</b> linii</span>
					<span><b>{uniq.length}</b> unice</span>
					<span>
						<b>{devices.length}</b>
						{devices.length === 1 ? 'dispozitiv' : 'dispozitive'} → <b>{uniq.length * devices.length}</b> verificări/zi
					</span>
				</div>
			</div>
			<div class="cl-field" style="margin-top: 14px">
				<span class="cl-field-head">Dispozitive urmărite</span>
				<div class="psi-seg multi" style="margin-top: 4px">
					{#each devices as d (d)}
						<button class="active" type="button" disabled title="se schimbă din setările proiectului">
							<span class="psi-seg-box"><CheckIcon size={10} /></span>
							<PsiStratIcon strategy={d} />
							{d === 'mobile' ? 'Mobil' : 'Desktop'}
						</button>
					{/each}
				</div>
			</div>
		</div>
		<div class="psi-modal-foot">
			<span class="cl-hint" style="margin-right: auto">prima poziție apare după următoarea rulare, {checkHour}</span>
			<button class="cl-btn-secondary" onclick={onclose}>Anulează</button>
			<button
				class="cl-btn-primary"
				disabled={uniq.length === 0 || uniq.length > limit}
				onclick={() => onadd(uniq, tag.trim() || null, location.trim())}
			>
				<CheckIcon size={13} /> Adaugă {uniq.length || ''} cuvinte
			</button>
		</div>
	</div>
</div>
