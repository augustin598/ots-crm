<script lang="ts">
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import XIcon from '@lucide/svelte/icons/x';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { untrack } from 'svelte';
	import type { ChannelMeta, IvRow, StatusSlug } from './lib';

	interface SavePayload {
		nume: string;
		dataInterviu: string;
		dataInceput?: string;
		dataSfarsit?: string;
		studio: string;
		sursa?: string;
		channelId: string;
		status: StatusSlug;
		observatii?: string;
	}

	let {
		record = null,
		channels,
		onClose,
		onSave,
		onDelete,
		onAddChannel
	}: {
		record?: IvRow | null;
		channels: ChannelMeta[];
		onClose: () => void;
		onSave: (p: SavePayload) => Promise<void>;
		onDelete: (id: string) => Promise<void>;
		onAddChannel: (name: string) => Promise<ChannelMeta | null>;
	} = $props();

	const editing = $derived(!!record);

	// Snapshot inițial din props (modalul e keyed → remontat per record).
	let f = $state(
		untrack(() => ({
			nume: record?.nume ?? '',
			data: record?.dataInterviu ?? '',
			channelId:
				record?.channelId ??
				channels.find((c) => c.name !== 'Nespecificat')?.id ??
				channels[0]?.id ??
				'',
			studio: record?.studio ?? 'Heylux Studio',
			status: (record?.status ?? 'in_evaluare') as StatusSlug,
			start: record?.dataInceput ?? '',
			end: record?.dataSfarsit ?? '',
			obs: record?.observatii ?? '',
			sursa: record?.sursa ?? ''
		}))
	);

	let addingCh = $state(false);
	let newCh = $state('');
	let saving = $state(false);

	const studioOptions = $derived.by(() => {
		const base = ['Heylux Studio', 'Lucky Studio'];
		if (f.studio && !base.includes(f.studio)) base.push(f.studio);
		return base;
	});

	const startBeforeData = $derived(!!(f.start && f.data && f.start < f.data));
	const canSave = $derived(!!f.nume.trim() && !!f.data && !startBeforeData && !saving);

	async function save() {
		if (!canSave) return;
		saving = true;
		try {
			await onSave({
				nume: f.nume.trim(),
				dataInterviu: f.data,
				dataInceput: f.start || undefined,
				dataSfarsit: f.end || undefined,
				studio: f.studio,
				sursa: f.sursa.trim() || undefined,
				channelId: f.channelId,
				status: f.status,
				observatii: f.obs.trim() || undefined
			});
		} finally {
			saving = false;
		}
	}

	async function addChannel() {
		const name = newCh.trim();
		if (!name) return;
		const existing = channels.find((c) => c.name.toLowerCase() === name.toLowerCase());
		if (existing) {
			f.channelId = existing.id;
			newCh = '';
			addingCh = false;
			return;
		}
		const created = await onAddChannel(name);
		if (created) f.channelId = created.id;
		newCh = '';
		addingCh = false;
	}

	async function requestDelete() {
		if (!record) return;
		if (confirm(`Ștergi interviul pentru ${f.nume}?`)) {
			saving = true;
			try {
				await onDelete(record.id);
			} finally {
				saving = false;
			}
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={onKey} />

<div
	class="iv-modal-backdrop"
	role="presentation"
	onclick={(e) => {
		if (e.target === e.currentTarget) onClose();
	}}
>
	<div class="iv-modal" role="dialog" aria-modal="true">
		<div class="iv-modal-head">
			<div class="iv-modal-head-ic">
				{#if editing}<PencilIcon size={18} />{:else}<UserPlusIcon size={18} />{/if}
			</div>
			<div>
				<h3>{editing ? 'Editează interviu' : 'Interviu nou'}</h3>
				<p>
					{editing
						? f.nume || 'Modifică datele candidatei'
						: 'Adaugă o candidată în evidența interviurilor'}
				</p>
			</div>
			<button class="cl-icon-btn iv-modal-close" onclick={onClose} aria-label="Închide">
				<XIcon size={16} />
			</button>
		</div>

		<div class="iv-modal-body">
			<div class="cl-field">
				<label for="iv-nume">Nume și prenume <span class="cl-req">*</span></label>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					id="iv-nume"
					class="cl-input"
					placeholder="ex: Popescu Maria"
					bind:value={f.nume}
					autofocus
				/>
			</div>

			<div class="cl-form-row two">
				<div class="cl-field">
					<label for="iv-data">Data interviului <span class="cl-req">*</span></label>
					<input id="iv-data" type="date" class="cl-input" bind:value={f.data} />
				</div>
				<div class="cl-field">
					<label for="iv-studio">Studio</label>
					<select id="iv-studio" class="cl-select" style="width:100%" bind:value={f.studio}>
						{#each studioOptions as s (s)}<option value={s}>{s}</option>{/each}
					</select>
				</div>
			</div>

			<div class="cl-field">
				<span class="cl-field-lbl" style="font-size:12px;font-weight:600">Canal</span>
				<div class="iv-ch-grid">
					{#each channels as c (c.id)}
						{@const active = f.channelId === c.id}
						<button
							type="button"
							class="iv-ch-opt {active ? 'active' : ''}"
							style={active ? `color:${c.color}; background:${c.color}14` : ''}
							onclick={() => (f.channelId = c.id)}
						>
							<span class="iv-ch-dot" style="background:{c.color}"></span>
							{c.name}
						</button>
					{/each}
					{#if !addingCh}
						<button type="button" class="iv-ch-opt iv-ch-add" onclick={() => (addingCh = true)}>
							<PlusIcon size={13} /> Canal nou
						</button>
					{/if}
				</div>
				{#if addingCh}
					<div class="iv-newch-row">
						<input
							class="cl-input"
							placeholder="Nume canal nou (ex: Pinterest, LinkedIn…)"
							bind:value={newCh}
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									addChannel();
								}
							}}
						/>
						<button
							type="button"
							class="cl-btn-primary cl-btn-sm"
							onclick={addChannel}
							disabled={!newCh.trim()}>Adaugă</button
						>
						<button
							type="button"
							class="cl-btn-secondary cl-btn-sm"
							onclick={() => {
								addingCh = false;
								newCh = '';
							}}>Anulează</button
						>
					</div>
				{/if}
			</div>

			<div class="cl-field">
				<label for="iv-sursa">Sursă exactă <span class="iv-opt">(opțional)</span></label>
				<input
					id="iv-sursa"
					class="cl-input"
					placeholder="ex: recomandare Dana Grigoraș · TikTok clip vacanță · căutare Google „videochat Iași”"
					bind:value={f.sursa}
				/>
			</div>

			<div class="cl-form-row two">
				<div class="cl-field">
					<span class="cl-field-lbl" style="font-size:12px;font-weight:600">Status</span>
					<div class="iv-seg">
						<button
							type="button"
							class="ok {f.status === 'admisa' ? 'active' : ''}"
							onclick={() => (f.status = 'admisa')}><CheckIcon size={13} /> Admisă</button
						>
						<button
							type="button"
							class="wait {f.status === 'in_evaluare' ? 'active' : ''}"
							onclick={() => (f.status = 'in_evaluare')}><ClockIcon size={13} /> Eval.</button
						>
						<button
							type="button"
							class="no {f.status === 'respinsa' ? 'active' : ''}"
							onclick={() => (f.status = 'respinsa')}><XIcon size={13} /> Respinsă</button
						>
					</div>
				</div>
				<div class="cl-field">
					<label for="iv-start">Început colaborare</label>
					<input
						id="iv-start"
						type="date"
						class="cl-input"
						bind:value={f.start}
						style={startBeforeData ? 'border-color:var(--cl-danger)' : ''}
					/>
					{#if startBeforeData}
						<p class="cl-hint" style="color:var(--cl-danger)">
							Începutul colaborării nu poate fi înainte de data interviului.
						</p>
					{/if}
				</div>
			</div>

			<div class="cl-field">
				<label for="iv-end">Sfârșit colaborare <span class="iv-opt">(opțional)</span></label>
				<input id="iv-end" type="date" class="cl-input" bind:value={f.end} />
			</div>

			<div class="cl-field">
				<label for="iv-obs">Observații</label>
				<textarea id="iv-obs" class="cl-input cl-textarea" rows={2} placeholder="Note interne…" bind:value={f.obs}
				></textarea>
			</div>
		</div>

		<div class="iv-modal-foot">
			{#if editing}
				<button
					class="cl-btn-secondary"
					style="margin-right:auto; color:var(--cl-danger)"
					onclick={requestDelete}><TrashIcon size={13} /> Șterge</button
				>
			{/if}
			<button class="cl-btn-secondary" onclick={onClose}>Anulează</button>
			<button class="cl-btn-primary" disabled={!canSave} onclick={save}>
				<CheckIcon size={13} />
				{editing ? 'Salvează modificările' : 'Salvează interviu'}
			</button>
		</div>
	</div>
</div>
