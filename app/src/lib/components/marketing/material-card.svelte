<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import ImageIcon from '@lucide/svelte/icons/image';
	import VideoIcon from '@lucide/svelte/icons/video';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import TypeIcon from '@lucide/svelte/icons/type';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import PlayIcon from '@lucide/svelte/icons/play';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import MaterialActionButtons from './material-action-buttons.svelte';
	import MaterialTaskPicker from './material-task-picker.svelte';
	import MaterialColorTags from './material-color-tags.svelte';
	import { getMaterialDownloadUrl, getMaterialPreviewUrl, getMaterialAttachedImageUrl } from '$lib/remotes/marketing-materials.remote';
	import { toast } from 'svelte-sonner';
	import { CAMPAIGN_TYPE_LABELS, type GoogleAdsCampaignType } from '$lib/shared/google-ads-specs';

	interface Material {
		id: string;
		type: string;
		title: string;
		description: string | null;
		filePath: string | null;
		fileSize: number | null;
		mimeType: string | null;
		fileName: string | null;
		textContent: string | null;
		dimensions: string | null;
		externalUrl: string | null;
		status: string;
		campaignType: string | null;
		tags: string | null;
		attachedImages: string | null;
		seoLinkKeyword?: string | null;
		seoLinkArticleUrl?: string | null;
		createdAt: Date;
		uploadedByUserId: string | null;
		uploadedByClientUserId: string | null;
	}

	let {
		material,
		thumbnailUrl = null,
		readonly = false,
		currentClientUserId = null,
		onEdit,
		onDelete,
		onPreview,
		activeTasks = [],
		onLinkTask,
		onUnlinkTask
	}: {
		material: Material;
		thumbnailUrl?: string | null;
		readonly?: boolean;
		currentClientUserId?: string | null;
		onEdit?: (material: Material) => void;
		onDelete?: (material: Material) => void;
		onPreview?: (material: Material) => void;
		activeTasks?: { id: string; title: string; status: string; clientId: string | null }[];
		onLinkTask?: (materialId: string, taskId: string) => void;
		onUnlinkTask?: (materialId: string, taskId: string) => void;
	} = $props();

	const typeIcons: Record<string, any> = {
		image: ImageIcon,
		video: VideoIcon,
		document: FileTextIcon,
		text: TypeIcon,
		url: ExternalLinkIcon
	};

	const typeColors: Record<string, { border: string; bg: string; text: string }> = {
		image: { border: 'border-l-blue-500', bg: 'bg-blue-50 dark:bg-blue-950', text: 'text-blue-600 dark:text-blue-400' },
		video: { border: 'border-l-purple-500', bg: 'bg-purple-50 dark:bg-purple-950', text: 'text-purple-600 dark:text-purple-400' },
		document: { border: 'border-l-amber-500', bg: 'bg-amber-50 dark:bg-amber-950', text: 'text-amber-600 dark:text-amber-400' },
		text: { border: 'border-l-green-500', bg: 'bg-green-50 dark:bg-green-950', text: 'text-green-600 dark:text-green-400' },
		url: { border: 'border-l-rose-500', bg: 'bg-rose-50 dark:bg-rose-950', text: 'text-rose-600 dark:text-rose-400' }
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
		if (!bytes) return '';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function formatDate(date: Date): string {
		return new Date(date).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' });
	}

	function parseSocialSets(textContent: string | null): { title: string; urls: string[] }[] {
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

	const attachedImageCount = $derived.by(() => {
		if (!material.attachedImages) return 0;
		try {
			const parsed = JSON.parse(material.attachedImages);
			return Array.isArray(parsed) ? parsed.length : 0;
		} catch {
			return 0;
		}
	});

	const canModify = $derived(
		!readonly && (
			!currentClientUserId ||
			material.uploadedByClientUserId === currentClientUserId
		)
	);

	const colors = $derived(typeColors[material.type] || { border: 'border-l-gray-300', bg: 'bg-gray-50 dark:bg-gray-900', text: 'text-gray-500' });
	const TypeIconComponent = $derived(typeIcons[material.type] || FileTextIcon);
	const socialSets = $derived(material.type === 'url' ? parseSocialSets(material.textContent) : []);
	const totalUrls = $derived(socialSets.reduce((sum, s) => sum + s.urls.length, 0));

	function getTextPreview(content: string | null, category?: string): string {
		if (!content) return 'Text material';
		if (category === 'google-ads') {
			try {
				const parsed = JSON.parse(content);
				const headlines = (parsed.headlines || []).filter(Boolean);
				if (headlines.length > 0) return headlines.join(' | ');
				const businessName = (parsed.businessName || []).filter(Boolean);
				if (businessName.length > 0) return businessName[0];
			} catch { /* fallback */ }
		}
		return content;
	}

	let downloading = $state(false);
	let videoUrl = $state<string | null>(null);
	let videoLoading = $state(false);
	let videoPlaying = $state(false);
	let attachedImgUrl = $state<string | null>(null);
	let attachedImgLoading = $state(false);
	let docPreviewUrl = $state<string | null>(null);
	let docPreviewLoading = $state(false);

	// Reset URLs when material changes
	$effect(() => {
		const _id = material.id;
		attachedImgUrl = null;
		attachedImgLoading = false;
		docPreviewUrl = null;
		docPreviewLoading = false;
	});

	// Load first attached image as thumbnail for document materials
	$effect(() => {
		if (attachedImageCount > 0 && !attachedImgUrl && !attachedImgLoading) {
			attachedImgLoading = true;
			getMaterialAttachedImageUrl({ materialId: material.id, imageIndex: 0 })
				.then((r) => { attachedImgUrl = r.url; })
				.catch(() => {})
				.finally(() => { attachedImgLoading = false; });
		}
	});

	const isDocx = $derived(
		material.mimeType === 'application/msword' ||
		material.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
	);

	// Load presigned URL for document thumbnail preview (PDF direct, DOCX via Office viewer)
	$effect(() => {
		if (material.type === 'document' && (material.mimeType === 'application/pdf' || isDocx) && material.filePath && attachedImageCount === 0 && !docPreviewUrl && !docPreviewLoading) {
			docPreviewLoading = true;
			getMaterialPreviewUrl(material.id)
				.then((r) => {
					docPreviewUrl = isDocx
						? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(r.url)}`
						: r.url;
				})
				.catch(() => {})
				.finally(() => { docPreviewLoading = false; });
		}
	});

	async function handlePlayVideo() {
		if (videoUrl) {
			videoPlaying = true;
			return;
		}
		// Reuse thumbnailUrl if available (already a presigned URL to the same file)
		if (thumbnailUrl) {
			videoUrl = thumbnailUrl;
			videoPlaying = true;
			return;
		}
		if (!material.filePath) return;
		videoLoading = true;
		try {
			const result = await getMaterialDownloadUrl(material.id);
			videoUrl = result.url;
			videoPlaying = true;
		} catch {
			toast.error('Eroare la încărcarea videoclipului');
		} finally {
			videoLoading = false;
		}
	}

	async function handleDownload() {
		if (!material.filePath) return;
		downloading = true;
		try {
			const result = await getMaterialDownloadUrl(material.id);
			window.open(result.url, '_blank', 'noopener,noreferrer');
		} catch {
			toast.error('Eroare la descărcarea fișierului');
		} finally {
			downloading = false;
		}
	}
</script>

<Card class="group overflow-hidden transition-all hover:shadow-md border-l-4 {colors.border}">
	<!-- Thumbnail area -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class="relative aspect-video bg-muted flex items-center justify-center overflow-hidden {onPreview && material.type !== 'video' ? 'cursor-pointer' : ''}"
		role={onPreview && material.type !== 'video' ? 'button' : undefined}
		tabindex={onPreview && material.type !== 'video' ? 0 : undefined}
		aria-label={onPreview && material.type !== 'video' ? `Previzualizare: ${material.title}` : undefined}
		onclick={() => { if (onPreview && material.type !== 'video') onPreview(material); }}
		onkeydown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && onPreview && material.type !== 'video') { e.preventDefault(); onPreview(material); } }}
	>
		{#if material.type === 'video' && videoPlaying && videoUrl}
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				src={videoUrl}
				controls
				autoplay
				class="w-full h-full object-contain bg-black"
				onended={() => { videoPlaying = false; }}
			></video>
		{:else if material.type === 'video' && thumbnailUrl}
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				src={thumbnailUrl + '#t=0.5'}
				preload="metadata"
				muted
				class="w-full h-full object-cover"
			></video>
		{:else if material.type === 'image' && thumbnailUrl}
			<img src={thumbnailUrl} alt={material.title} class="w-full h-full object-cover" />
		{:else if material.type === 'text'}
			<div class="p-3 text-[11px] text-muted-foreground line-clamp-4 font-mono leading-relaxed">
				{getTextPreview(material.textContent, (material as any).category)}
			</div>
		{:else if material.type === 'url' && socialSets.length > 0}
			<div class="p-3 w-full space-y-1 overflow-hidden">
				{#each socialSets.slice(0, 3) as set}
					<div>
						{#if set.title}
							<p class="text-[10px] font-semibold text-foreground/70 truncate">{set.title}</p>
						{/if}
						{#each set.urls.slice(0, 2) as url}
							<div class="flex items-center gap-1 text-[10px] text-blue-600 dark:text-blue-400 truncate pl-1">
								<ExternalLinkIcon class="h-2.5 w-2.5 shrink-0 opacity-60" />
								<span class="truncate">{url}</span>
							</div>
						{/each}
						{#if set.urls.length > 2}
							<p class="text-[9px] text-muted-foreground pl-1">+{set.urls.length - 2} URL-uri</p>
						{/if}
					</div>
				{/each}
				{#if socialSets.length > 3}
					<p class="text-[9px] text-muted-foreground">+{socialSets.length - 3} seturi</p>
				{/if}
			</div>
		{:else if material.type === 'document' && attachedImgUrl}
			<img src={attachedImgUrl} alt={material.title} class="w-full h-full object-cover" />
		{:else if material.type === 'document' && docPreviewUrl}
			<div class="w-full h-full overflow-hidden">
				<iframe
					src={docPreviewUrl}
					title={material.title}
					class="pointer-events-none border-0 origin-top-left"
					style="width: 200%; height: 200%; transform: scale(0.5); transform-origin: top left;"
					loading="lazy"
					sandbox="allow-same-origin"
				></iframe>
			</div>
		{:else}
			<div class="flex items-center justify-center h-10 w-10 rounded-xl {colors.bg}">
				<TypeIconComponent class="h-5 w-5 {colors.text}" />
			</div>
		{/if}

		<!-- Video play button overlay -->
		{#if material.type === 'video' && material.filePath && !videoPlaying}
			<button
				class="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors cursor-pointer"
				onclick={handlePlayVideo}
			>
				{#if videoLoading}
					<div class="h-10 w-10 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center">
						<LoaderIcon class="h-5 w-5 text-white animate-spin" />
					</div>
				{:else}
					<div class="h-10 w-10 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center hover:bg-black/80 transition-colors">
						<PlayIcon class="h-5 w-5 text-white ml-0.5" />
					</div>
				{/if}
			</button>
		{/if}

		<!-- Dimensions badge -->
		{#if material.dimensions && !videoPlaying}
			<div class="absolute bottom-1.5 left-1.5">
				<span class="text-[10px] text-white bg-black/50 backdrop-blur-sm px-1.5 py-0.5 rounded">{material.dimensions}</span>
			</div>
		{/if}

		<!-- Attached images badge -->
		{#if attachedImageCount > 0 && !videoPlaying}
			<div class="absolute bottom-1.5 {material.dimensions ? 'left-24' : 'left-1.5'}">
				<span class="text-[10px] text-white bg-black/50 backdrop-blur-sm px-1.5 py-0.5 rounded flex items-center gap-0.5">
					<ImageIcon class="h-2.5 w-2.5" />
					{attachedImageCount} img
				</span>
			</div>
		{/if}

		<!-- URL count badge -->
		{#if material.type === 'url' && totalUrls > 0}
			<div class="absolute bottom-1.5 left-1.5">
				<span class="text-[10px] text-white bg-black/50 backdrop-blur-sm px-1.5 py-0.5 rounded">{socialSets.length} set{socialSets.length !== 1 ? 'uri' : ''} · {totalUrls} URL-uri</span>
			</div>
		{/if}

		<!-- Action buttons -->
		<div class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
			<MaterialActionButtons
				{material}
				{canModify}
				{onPreview}
				{onEdit}
				{onDelete}
				onDownload={handleDownload}
				onOpenUrl={() => window.open(material.externalUrl!, '_blank', 'noopener,noreferrer')}
				variant="overlay"
			/>
		</div>
	</div>

	<!-- Info area -->
	<div class="px-3 py-2 space-y-1">
		<!-- Title with type icon -->
		<div class="flex items-center gap-1.5">
			<div class="flex items-center justify-center h-5 w-5 rounded shrink-0 {colors.bg}">
				<TypeIconComponent class="h-3 w-3 {colors.text}" />
			</div>
			<h4 class="text-xs font-semibold truncate flex-1" title={material.title}>{material.title}</h4>
		</div>

		{#if material.description}
			<p class="text-[11px] text-muted-foreground line-clamp-1 pl-6.5">{material.description}</p>
		{/if}

		<!-- Tags -->
		{#if material.tags}
			<div class="pl-6.5">
				<MaterialColorTags tags={material.tags} />
			</div>
		{/if}

		{#if material.seoLinkKeyword}
			<p class="text-[11px] text-blue-600 dark:text-blue-400 truncate pl-6.5">SEO: {material.seoLinkKeyword}</p>
		{/if}

		<!-- Task -->
		{#if (material as any).linkedTasks?.length > 0 || (onLinkTask && !readonly && !currentClientUserId)}
			<div class="pl-6.5">
				<MaterialTaskPicker
					materialId={material.id}
					linkedTasks={(material as any).linkedTasks || []}
					{activeTasks}
					readonly={readonly || !!currentClientUserId}
					onLink={onLinkTask}
					onUnlink={onUnlinkTask}
				/>
			</div>
		{/if}

		<!-- Footer -->
		<div class="flex items-center justify-between pt-1 border-t border-border/50">
			<div class="flex items-center gap-1.5">
				<span class="h-1.5 w-1.5 rounded-full {statusDots[material.status] || 'bg-gray-400'}"></span>
				<span class="text-[10px] text-muted-foreground">{statusLabels[material.status] || material.status}</span>
				{#if material.campaignType}
					<span class="text-[9px] px-1 py-0 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
						{CAMPAIGN_TYPE_LABELS[material.campaignType as GoogleAdsCampaignType] ?? material.campaignType}
					</span>
				{/if}
				{#if material.fileSize}
					<span class="text-[10px] text-muted-foreground">{formatFileSize(material.fileSize)}</span>
				{/if}
			</div>
			<span class="text-[10px] text-muted-foreground">{formatDate(material.createdAt)}</span>
		</div>
	</div>
</Card>
