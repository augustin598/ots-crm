<script lang="ts">
	import * as Table from '$lib/components/ui/table';
	import ImageIcon from '@lucide/svelte/icons/image';
	import VideoIcon from '@lucide/svelte/icons/video';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import TypeIcon from '@lucide/svelte/icons/type';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import MaterialActionsMenu from './material-actions-menu.svelte';
	import { getMaterialDownloadUrl } from '$lib/remotes/marketing-materials.remote';
	import { toast } from 'svelte-sonner';

	let {
		materials,
		readonly = false,
		currentClientUserId = null,
		clientNameFn,
		onEdit,
		onDelete
	}: {
		materials: any[];
		readonly?: boolean;
		currentClientUserId?: string | null;
		clientNameFn?: (clientId: string) => string;
		onEdit?: (material: any) => void;
		onDelete?: (material: any) => void;
	} = $props();

	const typeIcons: Record<string, any> = {
		image: ImageIcon,
		video: VideoIcon,
		document: FileTextIcon,
		text: TypeIcon,
		url: ExternalLinkIcon
	};

	const typeColors: Record<string, { bg: string; text: string }> = {
		image: { bg: 'bg-blue-50 dark:bg-blue-950', text: 'text-blue-600 dark:text-blue-400' },
		video: { bg: 'bg-purple-50 dark:bg-purple-950', text: 'text-purple-600 dark:text-purple-400' },
		document: { bg: 'bg-amber-50 dark:bg-amber-950', text: 'text-amber-600 dark:text-amber-400' },
		text: { bg: 'bg-green-50 dark:bg-green-950', text: 'text-green-600 dark:text-green-400' },
		url: { bg: 'bg-rose-50 dark:bg-rose-950', text: 'text-rose-600 dark:text-rose-400' }
	};

	const statusDots: Record<string, string> = {
		active: 'bg-green-500',
		draft: 'bg-yellow-500',
		archived: 'bg-gray-400'
	};

	const statusLabels: Record<string, string> = {
		active: 'Activ',
		draft: 'Ciornă',
		archived: 'Arhivat'
	};

	function formatFileSize(bytes: number | null): string {
		if (!bytes) return '--';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function formatDate(date: Date): string {
		return new Date(date).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' });
	}

	function parseTags(tags: string | null): string[] {
		if (!tags) return [];
		try {
			const parsed = JSON.parse(tags);
			if (Array.isArray(parsed)) return parsed.map((t: string) => t.trim()).filter(Boolean);
		} catch {
			// fallback
		}
		return tags.split(',').map(t => t.trim()).filter(Boolean);
	}

	interface SocialSet { title: string; urls: string[] }

	function parseSocialSets(textContent: string | null): SocialSet[] {
		if (!textContent) return [];
		try {
			const parsed = JSON.parse(textContent);
			if (!Array.isArray(parsed)) return [];
			// New format: [{title, urls}]
			if (parsed.length > 0 && typeof parsed[0] === 'object' && 'title' in parsed[0]) {
				return parsed.filter((s: any) => s.title && Array.isArray(s.urls));
			}
			// Legacy flat URL array format
			const urls = parsed.filter((u: any) => typeof u === 'string' && u.trim());
			if (urls.length > 0) return [{ title: '', urls }];
		} catch { /* not JSON */ }
		return [];
	}

	function canModify(material: any): boolean {
		if (readonly) return false;
		if (!currentClientUserId) return true;
		return material.uploadedByClientUserId === currentClientUserId;
	}

	// Sorting
	type SortField = 'title' | 'status' | 'fileSize' | 'createdAt';
	let sortBy = $state<SortField>('createdAt');
	let sortDir = $state<'asc' | 'desc'>('desc');

	function toggleSort(field: SortField) {
		if (sortBy === field) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			sortBy = field;
			sortDir = field === 'title' ? 'asc' : 'desc';
		}
	}

	const sortedMaterials = $derived(() => {
		const arr = [...materials];
		arr.sort((a, b) => {
			let cmp = 0;
			switch (sortBy) {
				case 'title':
					cmp = a.title.localeCompare(b.title, 'ro');
					break;
				case 'status':
					cmp = a.status.localeCompare(b.status);
					break;
				case 'fileSize':
					cmp = (a.fileSize || 0) - (b.fileSize || 0);
					break;
				case 'createdAt':
					cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
					break;
			}
			return sortDir === 'asc' ? cmp : -cmp;
		});
		return arr;
	});

	async function handleDownload(material: any) {
		if (!material.filePath) return;
		try {
			const result = await getMaterialDownloadUrl(material.id);
			window.open(result.url, '_blank');
		} catch {
			toast.error('Eroare la descărcarea fișierului');
		}
	}
</script>

<div class="rounded-md border overflow-x-auto">
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head class="min-w-[300px]">
					<button class="flex items-center gap-1 hover:text-foreground transition-colors" onclick={() => toggleSort('title')}>
						Material
						{#if sortBy === 'title'}
							{#if sortDir === 'asc'}
								<ArrowUpIcon class="h-3.5 w-3.5" />
							{:else}
								<ArrowDownIcon class="h-3.5 w-3.5" />
							{/if}
						{:else}
							<ArrowUpDownIcon class="h-3.5 w-3.5 opacity-40" />
						{/if}
					</button>
				</Table.Head>
				<Table.Head class="w-[100px]">
					<button class="flex items-center gap-1 hover:text-foreground transition-colors" onclick={() => toggleSort('status')}>
						Status
						{#if sortBy === 'status'}
							{#if sortDir === 'asc'}
								<ArrowUpIcon class="h-3.5 w-3.5" />
							{:else}
								<ArrowDownIcon class="h-3.5 w-3.5" />
							{/if}
						{:else}
							<ArrowUpDownIcon class="h-3.5 w-3.5 opacity-40" />
						{/if}
					</button>
				</Table.Head>
				<Table.Head class="w-[100px]">
					<button class="flex items-center gap-1 hover:text-foreground transition-colors" onclick={() => toggleSort('fileSize')}>
						Dimensiune
						{#if sortBy === 'fileSize'}
							{#if sortDir === 'asc'}
								<ArrowUpIcon class="h-3.5 w-3.5" />
							{:else}
								<ArrowDownIcon class="h-3.5 w-3.5" />
							{/if}
						{:else}
							<ArrowUpDownIcon class="h-3.5 w-3.5 opacity-40" />
						{/if}
					</button>
				</Table.Head>
				<Table.Head class="w-[160px]">Taguri</Table.Head>
				<Table.Head class="w-[110px]">
					<button class="flex items-center gap-1 hover:text-foreground transition-colors" onclick={() => toggleSort('createdAt')}>
						Data
						{#if sortBy === 'createdAt'}
							{#if sortDir === 'asc'}
								<ArrowUpIcon class="h-3.5 w-3.5" />
							{:else}
								<ArrowDownIcon class="h-3.5 w-3.5" />
							{/if}
						{:else}
							<ArrowUpDownIcon class="h-3.5 w-3.5 opacity-40" />
						{/if}
					</button>
				</Table.Head>
				<Table.Head class="w-[50px]"></Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each sortedMaterials() as material (material.id)}
				{@const colors = typeColors[material.type] || { bg: 'bg-gray-50 dark:bg-gray-900', text: 'text-gray-500' }}
				{@const IconComponent = typeIcons[material.type] || FileTextIcon}
				{@const tags = parseTags(material.tags)}
				{@const socialSets = material.type === 'url' ? parseSocialSets(material.textContent) : []}
				<Table.Row class="hover:bg-accent/50">
					<!-- Material -->
					<Table.Cell>
						<div class="flex items-start gap-3">
							<div class="flex items-center justify-center h-9 w-9 rounded-lg shrink-0 {colors.bg} mt-0.5">
								<IconComponent class="h-4 w-4 {colors.text}" />
							</div>
							<div class="min-w-0 flex-1">
								<p class="text-sm font-medium truncate">{material.title}</p>
								{#if clientNameFn && material.clientId}
									<p class="text-xs text-muted-foreground truncate">{clientNameFn(material.clientId)}</p>
								{:else if material.description}
									<p class="text-xs text-muted-foreground truncate max-w-[280px]">{material.description}</p>
								{/if}
								{#if socialSets.length > 0}
									<div class="mt-1 space-y-1.5">
										{#each socialSets as set}
											<div>
												{#if set.title}
													<p class="text-[11px] font-semibold text-foreground/80 pl-1">{set.title}</p>
												{/if}
												<div class="space-y-0.5 pl-1 border-l-2 border-muted ml-0.5">
													{#each set.urls as url}
														<a href={url} target="_blank" rel="noopener noreferrer"
															class="flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline truncate max-w-[400px] pl-2">
															<ExternalLinkIcon class="h-3 w-3 shrink-0 opacity-60" />
															<span class="truncate">{url}</span>
														</a>
													{/each}
												</div>
											</div>
										{/each}
									</div>
								{:else if material.type === 'url' && material.externalUrl}
									<a href={material.externalUrl} target="_blank" rel="noopener noreferrer"
										class="flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline truncate mt-0.5">
										<ExternalLinkIcon class="h-3 w-3 shrink-0 opacity-60" />
										<span class="truncate">{material.externalUrl}</span>
									</a>
								{/if}
							</div>
						</div>
					</Table.Cell>

					<!-- Status -->
					<Table.Cell>
						<div class="flex items-center gap-1.5">
							<span class="h-2 w-2 rounded-full shrink-0 {statusDots[material.status] || 'bg-gray-400'}"></span>
							<span class="text-xs">{statusLabels[material.status] || material.status}</span>
						</div>
					</Table.Cell>

					<!-- Size -->
					<Table.Cell>
						<span class="text-xs text-muted-foreground">{formatFileSize(material.fileSize)}</span>
					</Table.Cell>

					<!-- Tags -->
					<Table.Cell>
						{#if tags.length > 0}
							<div class="flex flex-wrap gap-1">
								{#each tags.slice(0, 2) as tag}
									<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-secondary-foreground">{tag}</span>
								{/each}
								{#if tags.length > 2}
									<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-secondary-foreground">+{tags.length - 2}</span>
								{/if}
							</div>
						{:else}
							<span class="text-xs text-muted-foreground">--</span>
						{/if}
					</Table.Cell>

					<!-- Date -->
					<Table.Cell>
						<span class="text-xs text-muted-foreground">{formatDate(material.createdAt)}</span>
					</Table.Cell>

					<!-- Actions -->
					<Table.Cell>
						<MaterialActionsMenu
							{material}
							canModify={canModify(material)}
							{onEdit}
							{onDelete}
							onDownload={() => handleDownload(material)}
							onOpenUrl={() => window.open(material.externalUrl!, '_blank')}
						/>
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>
