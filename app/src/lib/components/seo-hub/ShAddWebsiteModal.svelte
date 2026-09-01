<script lang="ts">
	// Modal „Adaugă website" — refolosește createClientWebsite (modulul Clienți)
	// și vocabularul de modale din PageSpeed (psi-modal + psiDialog).
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import XIcon from '@lucide/svelte/icons/x';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { psiDialog } from '../pagespeed/lib';

	let {
		clients,
		saving = false,
		onclose,
		onsave
	}: {
		clients: { id: string; name: string }[];
		saving?: boolean;
		onclose: () => void;
		onsave: (data: { clientId: string; url: string; name: string }) => void;
	} = $props();

	let clientId = $state('');
	let url = $state('');
	let name = $state('');

	// validare reală cu URL() (second opinion Gemini) — serverul re-validează cu v.url()
	const urlValid = $derived.by(() => {
		try {
			const u = new URL(url.trim());
			return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.');
		} catch {
			return false;
		}
	});
	const valid = $derived(!!clientId && urlValid);

	function submit() {
		if (!valid || saving) return;
		onsave({ clientId, url: url.trim(), name: name.trim() });
	}
</script>

<div class="psi-modal-back" onclick={onclose} role="presentation">
	<div
		class="psi-modal"
		style="width: 520px"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => {
			e.stopPropagation();
			if (e.key === 'Escape') onclose();
		}}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		{@attach psiDialog}
		aria-label="Adaugă website"
	>
		<div class="psi-modal-head">
			<span class="psi-modal-ic"><GlobeIcon size={17} /></span>
			<div>
				<div class="psi-modal-title">Adaugă website</div>
				<div class="psi-modal-sub">website nou pe un client — apare apoi în toate modulele SEO</div>
			</div>
			<button class="psi-drawer-close" onclick={onclose} aria-label="Închide"><XIcon size={15} /></button>
		</div>
		<div class="psi-modal-body">
			<div class="cl-form-row">
				<div class="cl-field">
					<label for="sh-add-client">Client <span class="cl-req">*</span></label>
					<select id="sh-add-client" class="cl-select" style="width: 100%" bind:value={clientId}>
						<option value="" disabled>Alege clientul…</option>
						{#each clients as c (c.id)}
							<option value={c.id}>{c.name}</option>
						{/each}
					</select>
				</div>
				<div class="cl-field">
					<label for="sh-add-url">URL <span class="cl-req">*</span></label>
					<input
						id="sh-add-url"
						class="cl-input"
						type="url"
						spellcheck={false}
						autocomplete="off"
						placeholder="https://exemplu.ro"
						bind:value={url}
						onkeydown={(e) => e.key === 'Enter' && submit()}
					/>
					{#if url && !urlValid}
						<p class="cl-hint" style="color: var(--cl-danger)">URL invalid — include https://</p>
					{/if}
				</div>
				<div class="cl-field">
					<label for="sh-add-name">Nume (opțional)</label>
					<input
						id="sh-add-name"
						class="cl-input"
						placeholder="ex: Site principal"
						bind:value={name}
						onkeydown={(e) => e.key === 'Enter' && submit()}
					/>
				</div>
			</div>
		</div>
		<div class="psi-modal-foot">
			<button class="cl-btn-secondary" onclick={onclose}>Renunță</button>
			<button class="cl-btn-primary" disabled={!valid || saving} onclick={submit}>
				<PlusIcon size={13} />
				{saving ? 'Se salvează…' : 'Adaugă website'}
			</button>
		</div>
	</div>
</div>
