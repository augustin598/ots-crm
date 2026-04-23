<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { Card } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import EditIcon from '@lucide/svelte/icons/edit';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import SearchIcon from '@lucide/svelte/icons/search';
	import NewspaperIcon from '@lucide/svelte/icons/newspaper';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';

	type WpPost = {
		id: number;
		title: string;
		slug: string;
		status: string;
		excerpt: string;
		featuredMediaUrl: string | null;
		link: string;
		publishedAt: string | null;
		updatedAt: string;
	};

	const tenantSlug = $derived(page.params.tenant);
	const siteId = $derived(page.params.siteId);
	const apiBase = $derived(`/${tenantSlug}/api/wordpress/sites/${siteId}/posts`);

	let posts = $state<WpPost[]>([]);
	let loading = $state(true);
	let total = $state(0);
	let statusFilter = $state<string>('any');
	let searchQuery = $state('');
	let searchTriggered = $state(''); // Only hits the API when we fire a search

	const STATUS_LABELS: Record<string, string> = {
		publish: 'Publicat',
		draft: 'Ciornă',
		pending: 'În așteptare',
		private: 'Privat',
		future: 'Programat',
		trash: 'Șters'
	};

	function statusVariant(
		status: string
	): 'default' | 'secondary' | 'destructive' | 'outline' {
		if (status === 'publish') return 'default';
		if (status === 'trash') return 'destructive';
		return 'secondary';
	}

	async function loadPosts() {
		loading = true;
		try {
			const qs = new URLSearchParams();
			if (statusFilter !== 'any') qs.set('status', statusFilter);
			if (searchTriggered) qs.set('search', searchTriggered);
			qs.set('perPage', '50');
			const res = await fetch(`${apiBase}?${qs.toString()}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as { items: WpPost[]; total: number };
			posts = data.items;
			total = data.total;
		} catch (err) {
			toast.error('Nu s-au putut încărca postările');
			console.error(err);
		} finally {
			loading = false;
		}
	}

	onMount(loadPosts);

	$effect(() => {
		// Re-fetch when status filter changes. Search only on explicit submit.
		statusFilter;
		searchTriggered;
		loadPosts();
	});

	async function deletePost(post: WpPost) {
		if (!confirm(`Trimiți la coș postarea „${post.title || post.slug}"?`)) return;
		try {
			const res = await fetch(`${apiBase}/${post.id}`, { method: 'DELETE' });
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				toast.error(body.error || 'Ștergerea a eșuat');
				return;
			}
			toast.success('Trimis la coș');
			posts = posts.filter((p) => p.id !== post.id);
		} catch (err) {
			toast.error('Eroare de rețea');
			console.error(err);
		}
	}

	function submitSearch() {
		searchTriggered = searchQuery.trim();
	}

	function formatDate(iso: string | null): string {
		if (!iso) return '—';
		try {
			return new Date(iso).toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' });
		} catch {
			return iso;
		}
	}
</script>

<svelte:head>
	<title>Postări WordPress — OTS CRM</title>
</svelte:head>

<div class="flex h-full flex-col gap-4 p-6">
	<div class="flex items-center gap-2">
		<a href="/{tenantSlug}/wordpress">
			<Button variant="ghost" size="sm">
				<ArrowLeftIcon class="mr-2 size-4" />
				Înapoi la site-uri
			</Button>
		</a>
	</div>

	<div class="flex items-center justify-between gap-2">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Postări</h1>
			<p class="text-sm text-muted-foreground">
				{total} postări în total{searchTriggered ? ` pentru „${searchTriggered}"` : ''}
			</p>
		</div>
		<a href="/{tenantSlug}/wordpress/{siteId}/posts/new">
			<Button>
				<PlusIcon class="mr-2 size-4" />
				Postare nouă
			</Button>
		</a>
	</div>

	<div class="flex items-center gap-2">
		<form
			class="relative flex-1 max-w-md"
			onsubmit={(e: Event) => {
				e.preventDefault();
				submitSearch();
			}}
		>
			<SearchIcon class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				type="search"
				placeholder="Caută după titlu sau conținut…"
				bind:value={searchQuery}
				class="pl-9"
			/>
		</form>
		<Select type="single" bind:value={statusFilter}>
			<SelectTrigger class="w-[180px]">
				{statusFilter === 'any' ? 'Toate statusurile' : STATUS_LABELS[statusFilter] ?? statusFilter}
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="any">Toate</SelectItem>
				<SelectItem value="publish">Publicate</SelectItem>
				<SelectItem value="draft">Ciorne</SelectItem>
				<SelectItem value="future">Programate</SelectItem>
				<SelectItem value="pending">În așteptare</SelectItem>
				<SelectItem value="private">Private</SelectItem>
			</SelectContent>
		</Select>
		<Button variant="outline" size="icon" onclick={loadPosts} disabled={loading} title="Refresh">
			<RefreshCwIcon class="size-4 {loading ? 'animate-spin' : ''}" />
		</Button>
	</div>

	{#if loading && posts.length === 0}
		<div class="py-8 text-center text-sm text-muted-foreground">Se încarcă…</div>
	{:else if posts.length === 0}
		<Card class="flex flex-col items-center justify-center gap-3 p-12 text-center">
			<NewspaperIcon class="size-12 text-muted-foreground" />
			<div>
				<h3 class="text-lg font-medium">Nicio postare găsită</h3>
				<p class="text-sm text-muted-foreground">
					{searchTriggered || statusFilter !== 'any'
						? 'Schimbă filtrele sau creează o postare nouă.'
						: 'Începe prin a crea o postare nouă.'}
				</p>
			</div>
			<a href="/{tenantSlug}/wordpress/{siteId}/posts/new">
				<Button>
					<PlusIcon class="mr-2 size-4" />
					Postare nouă
				</Button>
			</a>
		</Card>
	{:else}
		<div class="space-y-3">
			{#each posts as post (post.id)}
				<Card class="group relative overflow-hidden border-2 transition-all duration-300 hover:shadow-md hover:border-primary/20">
					<div class="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary via-primary/80 to-primary/60"></div>
					<div class="flex items-start gap-4 p-4 pt-5">
						{#if post.featuredMediaUrl}
							<img
								src={post.featuredMediaUrl}
								alt=""
								class="h-20 w-20 shrink-0 rounded-lg object-cover"
								loading="lazy"
							/>
						{:else}
							<div class="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-muted">
								<NewspaperIcon class="size-6 text-muted-foreground" />
							</div>
						{/if}
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2 flex-wrap">
								<h3 class="text-lg font-bold tracking-tight text-foreground truncate">
									{post.title || '(fără titlu)'}
								</h3>
								<Badge variant={statusVariant(post.status)} class="text-xs">
									{STATUS_LABELS[post.status] ?? post.status}
								</Badge>
							</div>
							<p class="mt-1 text-xs text-muted-foreground">
								Actualizat: {formatDate(post.updatedAt)}
								{#if post.slug}
									· <code class="rounded bg-muted px-1 py-0.5 text-[11px]">/{post.slug}</code>
								{/if}
							</p>
							{#if post.excerpt}
								<p class="mt-2 line-clamp-2 text-sm text-muted-foreground">{post.excerpt}</p>
							{/if}
						</div>
						<div class="flex shrink-0 items-center gap-1.5">
							{#if post.link && post.status === 'publish'}
								<a href={post.link} target="_blank" rel="noopener noreferrer" title="Vezi pe site">
									<Button variant="outline" size="icon" class="h-8 w-8 border-2">
										<ExternalLinkIcon class="size-3.5" />
									</Button>
								</a>
							{/if}
							<a href="/{tenantSlug}/wordpress/{siteId}/posts/{post.id}" title="Editează">
								<Button variant="outline" size="icon" class="h-8 w-8 border-2">
									<EditIcon class="size-3.5" />
								</Button>
							</a>
							<Button
								variant="outline"
								size="icon"
								class="h-8 w-8 border-2"
								onclick={() => deletePost(post)}
								title="Trimite la coș"
							>
								<Trash2Icon class="size-3.5 text-destructive" />
							</Button>
						</div>
					</div>
				</Card>
			{/each}
		</div>
	{/if}
</div>
