<!-- src/lib/components/client-task/client-task-materials-card.svelte -->
<script lang="ts">
	import { getTaskMaterials } from '$lib/remotes/task-materials.remote';
	import { page } from '$app/state';
	import ImageIcon from '@lucide/svelte/icons/image';
	import VideoIcon from '@lucide/svelte/icons/video';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import PaperclipIcon from '@lucide/svelte/icons/paperclip';
	import { toast } from 'svelte-sonner';
	import type { LightboxImage } from './client-task-lightbox.svelte';

	type Props = {
		taskId: string;
		onOpenLightbox: (images: LightboxImage[], startIndex: number) => void;
	};

	let { taskId, onOpenLightbox }: Props = $props();

	type MaterialType = 'img' | 'vid' | 'doc' | 'zip';

	type Material = {
		id: string;
		taskId: string;
		materialId: string;
		materialType: string;
		materialTitle: string;
		materialDescription: string | null;
		materialExternalUrl: string | null;
		materialFileName: string | null;
		materialCategory: string;
		materialTextContent: string | null;
		createdAt: Date | string;
	};

	const materialsQuery = $derived(getTaskMaterials(taskId));
	const materials = $derived<Material[]>(materialsQuery.current ?? []);

	let tab = $state<'all' | 'img' | 'vid' | 'doc'>('all');
	let fileInput = $state<HTMLInputElement | null>(null);
	let uploading = $state(false);
	let dragOver = $state(false);

	function typeOf(m: Material): MaterialType {
		const t = (m.materialType ?? '').toLowerCase();
		const name = (m.materialFileName ?? m.materialTitle ?? '').toLowerCase();
		if (t === 'image' || /\.(jpe?g|png|gif|webp|svg)$/.test(name)) return 'img';
		if (t === 'video' || /\.(mp4|mov|webm|mkv)$/.test(name)) return 'vid';
		if (/\.(zip|rar|7z|tar|gz)$/.test(name)) return 'zip';
		return 'doc';
	}

	const counts = $derived({
		all: materials.length,
		img: materials.filter((m) => typeOf(m) === 'img').length,
		vid: materials.filter((m) => typeOf(m) === 'vid').length,
		doc: materials.filter((m) => typeOf(m) === 'doc' || typeOf(m) === 'zip').length
	});

	const filtered = $derived.by(() => {
		if (tab === 'all') return materials;
		if (tab === 'doc') return materials.filter((m) => typeOf(m) === 'doc' || typeOf(m) === 'zip');
		return materials.filter((m) => typeOf(m) === tab);
	});

	const imagesInTab = $derived<LightboxImage[]>(
		filtered
			.filter((m) => typeOf(m) === 'img' && m.materialExternalUrl)
			.map((m) => ({ url: m.materialExternalUrl!, name: m.materialTitle }))
	);

	function iconGradient(t: MaterialType): string {
		switch (t) {
			case 'img':
				return 'linear-gradient(135deg, #8b5cf6, #6d28d9)';
			case 'vid':
				return 'linear-gradient(135deg, #ec4899, #be185d)';
			case 'doc':
				return 'linear-gradient(135deg, #1877F2, #0d5cc7)';
			case 'zip':
				return 'linear-gradient(135deg, #f59e0b, #b45309)';
		}
	}

	function fmtDate(d: Date | string): string {
		const date = d instanceof Date ? d : new Date(d);
		return date.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' });
	}

	function displayName(m: Material): string {
		return m.materialFileName ?? m.materialTitle;
	}

	async function uploadFiles(files: FileList | File[]) {
		const list = Array.from(files);
		if (list.length === 0) return;
		uploading = true;
		const tenant = page.params.tenant ?? '';
		try {
			for (const f of list) {
				const fd = new FormData();
				fd.append('file', f);
				fd.append('taskId', taskId);
				const res = await fetch(`/${tenant}/task-materials/upload`, { method: 'POST', body: fd });
				if (!res.ok) {
					const err = await res.json().catch(() => ({ message: 'Upload eșuat' }));
					throw new Error(err.message || `HTTP ${res.status}`);
				}
			}
			await materialsQuery.refresh?.();
			toast.success(
				`${list.length} fișier${list.length === 1 ? '' : 'e'} încărcat${list.length === 1 ? '' : 'e'}`
			);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la upload');
		} finally {
			uploading = false;
		}
	}

	function handleClickItem(m: Material) {
		if (!m.materialExternalUrl) return;
		if (typeOf(m) === 'img') {
			const index = imagesInTab.findIndex((i) => i.url === m.materialExternalUrl);
			if (index >= 0) onOpenLightbox(imagesInTab, index);
		} else {
			window.open(m.materialExternalUrl, '_blank');
		}
	}
</script>

<div class="ct-card rounded-[12px] border border-[#e5e9f0] bg-white p-[18px]">
	<div class="ct-section-head mb-3 flex items-center gap-2">
		<span class="grid h-7 w-7 place-items-center rounded-[7px] bg-[#f1f5f9] text-[#475569]">
			<PaperclipIcon class="h-3.5 w-3.5" />
		</span>
		<h3 class="text-[15px] font-bold text-[#0f172a]">
			Materiale ({counts.all})
		</h3>
	</div>

	<div class="ct-mat-tabs mb-3 flex gap-1 rounded-lg bg-[#f1f5f9] p-[3px]">
		{#each [['all', 'Toate'], ['img', 'Foto'], ['vid', 'Video'], ['doc', 'Docs']] as [id, label] (id)}
			{@const count = counts[id as keyof typeof counts]}
			<button
				type="button"
				class={[
					'ct-mat-tab flex-1 rounded-md px-2 py-1.5 text-[11.5px] font-semibold transition-all',
					tab === id
						? 'bg-white text-[#0f172a] shadow-[0_1px_2px_rgba(15,23,42,.06)]'
						: 'text-[#64748b] hover:text-[#0f172a]'
				].join(' ')}
				onclick={() => (tab = id as typeof tab)}
			>
				{label}
				<span class="ml-1 inline-block rounded-full bg-[#e5e9f0] px-1.5 py-[1px] text-[10px]"
					>{count}</span
				>
			</button>
		{/each}
	</div>

	{#if filtered.length === 0}
		<div
			class="rounded-lg border border-dashed border-[#e5e9f0] bg-[#f7f8fa] py-5 text-center text-[11.5px] text-[#94a3b8]"
		>
			Niciun material în această secțiune.
		</div>
	{:else}
		<ul class="ct-mat-list flex flex-col gap-1.5">
			{#each filtered as m (m.id)}
				{@const t = typeOf(m)}
				<li
					class="ct-mat group flex items-center gap-2.5 rounded-lg border border-[#e5e9f0] bg-white p-2 transition-colors hover:border-[#1877F2] hover:bg-[#f7faff]"
				>
					<button
						type="button"
						class="flex min-w-0 flex-1 items-center gap-2.5 text-left"
						onclick={() => handleClickItem(m)}
					>
						<div
							class="ct-mat-icon {t} grid h-8 w-8 shrink-0 place-items-center rounded-[7px] text-white"
							style:background={iconGradient(t)}
						>
							{#if t === 'img'}
								<ImageIcon class="h-4 w-4" />
							{:else if t === 'vid'}
								<VideoIcon class="h-4 w-4" />
							{:else if t === 'zip'}
								<ArchiveIcon class="h-4 w-4" />
							{:else}
								<FileTextIcon class="h-4 w-4" />
							{/if}
						</div>
						<div class="ct-mat-info min-w-0 flex-1">
							<div class="ct-mat-name truncate text-[12.5px] font-semibold text-[#0f172a]">
								{displayName(m)}
							</div>
							<div class="ct-mat-meta text-[11px] text-[#94a3b8]">
								{fmtDate(m.createdAt)}{m.materialCategory ? ` · ${m.materialCategory}` : ''}
							</div>
						</div>
					</button>
					<div
						class="ct-mat-actions flex gap-1 opacity-0 transition-opacity group-hover:opacity-100"
					>
						{#if m.materialExternalUrl}
							<a
								href={m.materialExternalUrl}
								download={m.materialFileName ?? m.materialTitle}
								target="_blank"
								rel="noopener noreferrer"
								class="grid h-7 w-7 place-items-center rounded-md text-[#475569] hover:bg-[#f1f5f9] hover:text-[#0f172a]"
								title="Download"
								aria-label={`Descarcă ${displayName(m)}`}
							>
								<DownloadIcon class="h-3.5 w-3.5" />
							</a>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	<input
		bind:this={fileInput}
		type="file"
		class="hidden"
		multiple
		accept="image/*,video/*,.pdf,.doc,.docx,.zip,.rar"
		onchange={(e) => {
			const files = (e.currentTarget as HTMLInputElement).files;
			if (files) uploadFiles(files);
			(e.currentTarget as HTMLInputElement).value = '';
		}}
	/>
	<button
		type="button"
		class={[
			'ct-mat-upload mt-3 flex w-full flex-col items-center gap-1 rounded-lg border-2 border-dashed px-3 py-3.5 text-[12px] transition-colors',
			dragOver
				? 'border-[#1877F2] bg-[#f0f7ff]'
				: 'border-[#d5dbe5] hover:border-[#1877F2]'
		].join(' ')}
		onclick={() => fileInput?.click()}
		ondragover={(e) => {
			e.preventDefault();
			dragOver = true;
		}}
		ondragleave={() => (dragOver = false)}
		ondrop={(e) => {
			e.preventDefault();
			dragOver = false;
			if (e.dataTransfer?.files) uploadFiles(e.dataTransfer.files);
		}}
		disabled={uploading}
	>
		<strong class="font-semibold text-[#1877F2]">
			{uploading ? 'Se încarcă...' : '+ Adaugă materiale'}
		</strong>
		<span class="text-[#94a3b8]">Trage fișiere aici sau click pentru upload</span>
	</button>
</div>
