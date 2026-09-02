<script lang="ts">
	// Adăugare în masă a cuvintelor cheie (unul pe linie).
	import ListIcon from '@lucide/svelte/icons/list';
	import XIcon from '@lucide/svelte/icons/x';
	import { psiDialog } from '../pagespeed/lib';

	let {
		onclose,
		onadd,
		limit = 500
	}: {
		onclose: () => void;
		onadd: (keywords: string[], tag: string | null, location: string) => void;
		limit?: number;
	} = $props();

	let text = $state('');
	let tag = $state('');
	let location = $state('');

	const parsed = $derived([
		...new Set(text.split('\n').map((s) => s.trim()).filter(Boolean))
	]);

	function submit() {
		if (parsed.length === 0) return;
		onadd(parsed, tag.trim() || null, location.trim());
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
		aria-label="Adaugă cuvinte cheie"
	>
		<div class="psi-modal-head">
			<span class="psi-modal-ic"><ListIcon size={17} /></span>
			<div>
				<div class="psi-modal-title">Adaugă cuvinte cheie</div>
				<div class="psi-modal-sub">un cuvânt cheie pe linie</div>
			</div>
			<button class="psi-drawer-close" onclick={onclose} aria-label="Închide"><XIcon size={15} /></button>
		</div>
		<div class="psi-modal-body">
			<div class="cl-field">
				<label for="rk-kw-text">Cuvinte cheie</label>
				<textarea id="rk-kw-text" class="cl-input" rows="8" placeholder={'agentie seo bucuresti\noptimizare seo\nservicii marketing'} bind:value={text}></textarea>
				<p class="cl-muted" class:cl-form-error={parsed.length > limit}>{parsed.length} cuvinte cheie {parsed.length > limit ? `· depășește limita de ${limit}` : ''}</p>
			</div>
			<div class="cl-form-row two">
				<div class="cl-field">
					<label for="rk-kw-tag">Etichetă (opțional)</label>
					<input id="rk-kw-tag" class="cl-input" placeholder="ex: branded" bind:value={tag} />
				</div>
				<div class="cl-field">
					<label for="rk-kw-loc">Locație (opțional)</label>
					<input id="rk-kw-loc" class="cl-input" placeholder="ex: Cluj-Napoca" bind:value={location} />
				</div>
			</div>
		</div>
		<div class="psi-modal-foot">
			<div style="flex:1"></div>
			<button class="cl-btn-secondary" onclick={onclose}>Anulează</button>
			<button class="cl-btn-primary" disabled={parsed.length === 0 || parsed.length > limit} onclick={submit}>Adaugă {parsed.length || ''}</button>
		</div>
	</div>
</div>
