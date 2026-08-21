<script lang="ts">
	import {
		getWhatsappConnectionStatus,
		getWhatsappQr,
		startWhatsappConnection,
		disconnectWhatsapp,
		listWhatsappConversations,
		getWhatsappThread,
		sendWhatsappMessage,
		sendWhatsappMedia,
		markWhatsappConversationRead,
		renameWhatsappContact
	} from '$lib/remotes/whatsapp.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { CheckCircle2, XCircle, AlertTriangle, Loader2, Send, Plus, Search, Pencil, Paperclip, Download, FileText, Users } from '@lucide/svelte';
	import IconWhatsapp from '$lib/components/marketing/icon-whatsapp.svelte';
	import ContactAvatar from '$lib/components/ui/contact-avatar.svelte';
	import WhatsappGroupsDialog from '$lib/components/whatsapp/whatsapp-groups-dialog.svelte';
	import { onDestroy, tick } from 'svelte';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { numarSi } from '$lib/utils/ro-numerale';
	import { focusTrap } from '$lib/actions/focus-trap';

	const tenantSlug = $derived(page.params.tenant as string);

	const statusQuery = getWhatsappConnectionStatus();
	const current = $derived(statusQuery.current?.status ?? null);
	const connected = $derived(current?.status === 'connected');
	const needsReauth = $derived(current?.status === 'needs_reauth');

	const conversationsQuery = $derived(connected ? listWhatsappConversations() : null);
	const conversations = $derived(conversationsQuery?.current?.conversations ?? []);

	// Cheia conversației: telefonul la o persoană, JID-ul la un grup.
	let selectedChat = $state<string | null>(null);
	const threadQuery = $derived(selectedChat ? getWhatsappThread(selectedChat) : null);
	const thread = $derived(threadQuery?.current ?? null);
	const isGroupChat = $derived(!!selectedChat?.endsWith('@g.us'));

	let searchText = $state('');
	let chatFilter = $state<'all' | 'direct' | 'group'>('all');
	let groupsOpen = $state(false);

	type ConversationRow = (typeof conversations)[number];

	function displayLabel(c: ConversationRow): string {
		if (c.chatType === 'group') return c.subject || 'Grup';
		return c.displayName ?? c.clientName ?? c.pushName ?? c.chatKey;
	}

	/** Sub numele conversației: numărul la o persoană, câți membri la un grup. */
	function subLabel(c: ConversationRow): string | null {
		if (c.chatType === 'group') {
			if (c.participantCount == null) return null;
			return numarSi(c.participantCount, 'membru', 'membri');
		}
		return displayLabel(c) === c.chatKey ? null : c.chatKey;
	}

	const groupCount = $derived(conversations.filter((c) => c.chatType === 'group').length);
	// Fără grupuri, bara de filtre dispare. Dacă filtrul ar rămâne pe „Grupuri",
	// lista ar arăta goală și n-ar mai exista butonul care s-o repare.
	const activeFilter = $derived(groupCount === 0 ? 'all' : chatFilter);

	const filteredConversations = $derived.by(() => {
		const byType =
			activeFilter === 'all'
				? conversations
				: conversations.filter((c) => c.chatType === activeFilter);
		const s = searchText.trim().toLowerCase();
		if (!s) return byType;
		return byType.filter(
			(c) =>
				c.chatKey.toLowerCase().includes(s) ||
				(c.subject ?? '').toLowerCase().includes(s) ||
				(c.displayName ?? '').toLowerCase().includes(s) ||
				(c.clientName ?? '').toLowerCase().includes(s) ||
				(c.pushName ?? '').toLowerCase().includes(s) ||
				(c.lastSenderName ?? '').toLowerCase().includes(s) ||
				(c.lastBody ?? '').toLowerCase().includes(s)
		);
	});

	const activeConversation = $derived(
		selectedChat ? (conversations.find((c) => c.chatKey === selectedChat) ?? null) : null
	);

	let renameOpen = $state(false);
	let renameValue = $state('');
	let renameSaving = $state(false);

	function openRename() {
		if (!selectedChat || isGroupChat) return;
		renameValue =
			activeConversation?.displayName ??
			thread?.contact?.displayName ??
			activeConversation?.pushName ??
			thread?.contact?.pushName ??
			'';
		renameOpen = true;
	}

	async function handleRename() {
		if (!selectedChat || isGroupChat) return;
		renameSaving = true;
		try {
			await renameWhatsappContact({ phoneE164: selectedChat, displayName: renameValue });
			renameOpen = false;
			await conversationsQuery?.refresh();
			await threadQuery?.refresh();
			toast.success('Nume actualizat');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Eroare la salvare');
		} finally {
			renameSaving = false;
		}
	}

	let qrDataUrl = $state<string | null>(null);
	let qrError = $state<string | null>(null);
	let connecting = $state(false);
	let disconnecting = $state(false);
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	function stopPolling() {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	}

	async function pollTick() {
		try {
			await statusQuery.refresh();
			const st = statusQuery.current?.status;
			if (st?.status === 'connected') {
				qrDataUrl = null;
				toast.success('WhatsApp conectat');
				stopPolling();
				return;
			}
			if (st?.status === 'needs_reauth' || st?.status === 'disconnected') {
				qrError = st.lastError ?? 'Deconectat';
				qrDataUrl = null;
				stopPolling();
				return;
			}
			const { qr } = await getWhatsappQr();
			if (qr) qrDataUrl = qr;
		} catch (err) {
			console.error('[whatsapp poll]', err);
		}
	}

	function startPolling() {
		stopPolling();
		pollTimer = setInterval(pollTick, 1000);
		void pollTick();
	}

	async function handleConnect() {
		qrError = null;
		qrDataUrl = null;
		connecting = true;
		try {
			await startWhatsappConnection();
			toast.message('Se generează codul QR...');
			startPolling();
		} catch (err) {
			qrError = err instanceof Error ? err.message : String(err);
		} finally {
			connecting = false;
		}
	}

	async function handleDisconnect() {
		if (!confirm('Sigur dezactivezi WhatsApp? Va trebui să rescanezi QR-ul ca să-l reconectezi.')) return;
		disconnecting = true;
		try {
			await disconnectWhatsapp();
			qrDataUrl = null;
			selectedChat = null;
			stopPolling();
			toast.success('Deconectat');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Eroare la deconectare');
		} finally {
			disconnecting = false;
		}
	}

	// Refresh conversations every 3s while connected
	let inboxTimer: ReturnType<typeof setInterval> | null = null;
	$effect(() => {
		if (connected) {
			if (!inboxTimer) {
				inboxTimer = setInterval(() => {
					conversationsQuery?.refresh();
					if (selectedChat) threadQuery?.refresh();
					// Cât stai cu firul deschis, mesajele noi se marchează citite pe loc.
					// Altfel insigna de necitite crește chiar pe conversația pe care o citești.
					const open = selectedChat;
					if (open && (activeConversation?.unread ?? 0) > 0) {
						void markWhatsappConversationRead(open).catch(() => {});
					}
				}, 3000);
			}
		} else {
			if (inboxTimer) {
				clearInterval(inboxTimer);
				inboxTimer = null;
			}
		}
	});

	onDestroy(() => {
		stopPolling();
		if (inboxTimer) clearInterval(inboxTimer);
	});

	async function selectConversation(chatKey: string) {
		if (chatKey !== selectedChat) replyText = ''; // ciorna nu trece la alt destinatar
		selectedChat = chatKey;
		try {
			await markWhatsappConversationRead(chatKey);
		} catch (err) {
			console.warn('mark read failed', err);
		}
	}

	let replyText = $state('');
	let sending = $state(false);
	let fileInput: HTMLInputElement | null = $state(null);

	const MAX_MEDIA_MB = 15;

	async function handleSendReply() {
		const body = replyText.trim();
		if (!body || !selectedChat) return;
		sending = true;
		try {
			await sendWhatsappMessage({ to: selectedChat, text: body });
			replyText = '';
			await threadQuery?.refresh();
			await conversationsQuery?.refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Eroare la trimitere');
		} finally {
			sending = false;
		}
	}

	function detectKind(mime: string): 'image' | 'video' | 'audio' | 'document' {
		if (mime.startsWith('image/')) return 'image';
		if (mime.startsWith('video/')) return 'video';
		if (mime.startsWith('audio/')) return 'audio';
		return 'document';
	}

	async function fileToBase64(file: Blob): Promise<string> {
		const buffer = await file.arrayBuffer();
		const bytes = new Uint8Array(buffer);
		let binary = '';
		const chunk = 0x8000;
		for (let i = 0; i < bytes.length; i += chunk) {
			binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
		}
		return btoa(binary);
	}

	async function sendFile(file: File, caption = '') {
		if (!selectedChat) return;
		if (file.size > MAX_MEDIA_MB * 1024 * 1024) {
			toast.error(`Fișier prea mare (max ${MAX_MEDIA_MB}MB)`);
			return;
		}
		sending = true;
		try {
			const base64 = await fileToBase64(file);
			await sendWhatsappMedia({
				to: selectedChat,
				base64,
				mimeType: file.type || 'application/octet-stream',
				fileName: file.name,
				caption: caption || undefined,
				kind: detectKind(file.type || '')
			});
			replyText = '';
			await threadQuery?.refresh();
			await conversationsQuery?.refresh();
			toast.success('Trimis');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Eroare la trimitere media');
		} finally {
			sending = false;
		}
	}

	async function handleFileChange(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (file) await sendFile(file, replyText.trim());
		if (fileInput) fileInput.value = '';
	}

	async function handlePaste(e: ClipboardEvent) {
		const items = e.clipboardData?.items;
		if (!items) return;
		for (const item of items) {
			if (item.kind === 'file') {
				const file = item.getAsFile();
				if (file) {
					e.preventDefault();
					await sendFile(file, replyText.trim());
					return;
				}
			}
		}
	}

	let messagesEl: HTMLDivElement | null = $state(null);
	let prevThreadKey: string | null = null;
	let autoScroll = true;

	function onMessagesScroll() {
		const el = messagesEl;
		if (!el) return;
		autoScroll = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
	}

	function scrollToBottom() {
		tick().then(() => {
			if (!messagesEl) return;
			messagesEl.scrollTop = messagesEl.scrollHeight;
			// requestAnimationFrame covers cases where images/media inflate scrollHeight after paint
			requestAnimationFrame(() => {
				if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
			});
		});
	}

	$effect(() => {
		const key = selectedChat;
		void (thread?.messages.length ?? 0);
		if (!messagesEl) return;

		if (key !== prevThreadKey) {
			prevThreadKey = key;
			autoScroll = true;
		}

		if (autoScroll) scrollToBottom();
	});

	let lightboxUrl = $state<string | null>(null);

	function openLightbox(url: string) {
		lightboxUrl = url;
	}

	function closeLightbox() {
		lightboxUrl = null;
	}

	function handleLightboxKey(e: KeyboardEvent) {
		if (e.key === 'Escape') closeLightbox();
	}

	/**
	 * Adresa unui fișier din conversație. Numele intră în adresă, ca ultim segment:
	 * browserul îl folosește la descărcare chiar dacă ignoră antetul, iar o adresă
	 * nouă ocolește și răspunsul vechi rămas în cache.
	 */
	function mediaHref(messageId: string, fileName: string | null | undefined): string {
		const base = `/api/whatsapp/media/${messageId}`;
		const name = fileName?.trim();
		return name ? `${base}/${encodeURIComponent(name)}` : base;
	}

	function formatSize(bytes: number | null | undefined): string {
		if (!bytes) return '';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	}

	// New conversation dialog
	let newConvOpen = $state(false);
	let newConvPhone = $state('');
	let newConvText = $state('');
	let newConvSending = $state(false);

	async function handleNewConversation() {
		const phone = newConvPhone.trim();
		const text = newConvText.trim();
		if (!phone || !text) return;
		newConvSending = true;
		try {
			await sendWhatsappMessage({ to: phone, text });
			toast.success('Mesaj trimis');
			newConvOpen = false;
			newConvPhone = '';
			newConvText = '';
			await conversationsQuery?.refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Eroare la trimitere');
		} finally {
			newConvSending = false;
		}
	}

	function formatTime(d: Date | string | null | undefined): string {
		if (!d) return '';
		const date = typeof d === 'string' ? new Date(d) : d;
		const now = new Date();
		const isToday =
			date.getFullYear() === now.getFullYear() &&
			date.getMonth() === now.getMonth() &&
			date.getDate() === now.getDate();
		return isToday
			? date.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })
			: date.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' });
	}

	function formatFull(d: Date | string | null | undefined): string {
		if (!d) return '';
		const date = typeof d === 'string' ? new Date(d) : d;
		return date.toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' });
	}

	// Culoare stabilă pe expeditor, ca într-un grup să deosebești oamenii dintr-o
	// privire. Nuanțele sunt cele închise (700–800), nu paleta de la ContactAvatar:
	// aceea e făcută pentru text alb pe cerc colorat, iar aici scriem pe fundal
	// deschis, unde chihlimbarul și verdeul crud coboară sub pragul de contrast.
	const SENDER_COLORS = [
		'#1d4ed8', // blue-700
		'#047857', // emerald-700
		'#b91c1c', // red-700
		'#b45309', // amber-700
		'#6d28d9', // violet-700
		'#be185d', // pink-700
		'#0e7490', // cyan-700
		'#4d7c0f' // lime-700
	];

	function senderColor(seed: string | null): string {
		if (!seed) return 'var(--muted-foreground)';
		let h = 0;
		for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
		return SENDER_COLORS[Math.abs(h) % SENDER_COLORS.length];
	}

	function statusIcon(status: string): string {
		switch (status) {
			case 'pending':
				return '⏳';
			case 'sent':
				return '✓';
			case 'delivered':
				return '✓✓';
			case 'read':
				return '✓✓';
			case 'failed':
				return '✗';
			default:
				return '';
		}
	}
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-3">
			<IconWhatsapp class="h-8 w-8" />
			<div>
				<h2 class="text-2xl font-bold">WhatsApp</h2>
				<p class="text-sm text-muted-foreground">
					{#if connected && current?.phoneE164}
						Conectat cu <strong>{current.phoneE164}</strong>
					{:else}
						Conectează contul WhatsApp Business pentru a trimite și primi mesaje din CRM.
					{/if}
				</p>
			</div>
		</div>
		<div class="flex items-center gap-2">
			{#if connected}
				<Badge variant="default" class="gap-1 bg-emerald-600 hover:bg-emerald-700">
					<CheckCircle2 class="h-3 w-3" /> Activ
				</Badge>
				<Button variant="ghost" size="sm" onclick={handleDisconnect} disabled={disconnecting}>
					{disconnecting ? '...' : 'Deconectează'}
				</Button>
			{:else if needsReauth}
				<Badge variant="destructive" class="gap-1">
					<AlertTriangle class="h-3 w-3" /> Reautentificare necesară
				</Badge>
			{:else if current?.status === 'connecting' || current?.status === 'qr_pending'}
				<Badge variant="secondary" class="gap-1">
					<Loader2 class="h-3 w-3 animate-spin" /> Se conectează...
				</Badge>
			{:else}
				<Badge variant="outline" class="gap-1">
					<XCircle class="h-3 w-3" /> Neconectat
				</Badge>
			{/if}
		</div>
	</div>

	{#if !connected}
		<Card>
			<CardHeader>
				<CardTitle>Conectează WhatsApp</CardTitle>
				<CardDescription>
					Scanează codul QR cu aplicația WhatsApp de pe telefon (Settings → Linked Devices → Link a Device).
				</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-col items-center gap-4 py-6">
				{#if qrDataUrl}
					<img src={qrDataUrl} alt="QR" class="h-[280px] w-[280px] rounded-lg border bg-white p-3" />
					<p class="text-sm text-muted-foreground">Scanează cu telefonul — codul se reîmprospătează automat.</p>
				{:else if qrError}
					<div class="w-full rounded-md bg-destructive/10 p-3 text-sm text-destructive">{qrError}</div>
					<Button onclick={handleConnect}>Reîncearcă</Button>
				{:else}
					<Button onclick={handleConnect} disabled={connecting}>
						{#if connecting}<Loader2 class="mr-2 h-4 w-4 animate-spin" />{/if}
						{needsReauth ? 'Reconectează' : 'Conectează WhatsApp'}
					</Button>
				{/if}
			</CardContent>
		</Card>

		<Card class="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-900/10">
			<CardContent class="flex items-start gap-2 py-3 text-sm text-amber-900 dark:text-amber-200">
				<AlertTriangle class="h-4 w-4 mt-0.5 shrink-0" />
				<span>Metoda asta violează Termenii Meta. Risc de ban. Folosește pentru discuții normale, fără spam bulk.</span>
			</CardContent>
		</Card>
	{:else}
		<div class="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 h-[calc(100vh-14rem)] min-h-[500px]">
			<!-- Conversations list -->
			<Card class="flex flex-col overflow-hidden">
				<CardHeader class="space-y-2 pb-3">
					<div class="flex items-center justify-between">
						<CardTitle class="text-base">Conversații</CardTitle>
						<div class="flex items-center gap-1">
							<Button
								size="sm"
								variant="outline"
								title="Alege ce grupuri intră în inbox"
								onclick={() => (groupsOpen = true)}
							>
								<Users class="h-4 w-4" />
							</Button>
							<Button size="sm" variant="outline" title="Conversație nouă" onclick={() => (newConvOpen = true)}>
								<Plus class="h-4 w-4" />
							</Button>
						</div>
					</div>
					<div class="relative">
						<Search class="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
						<Input bind:value={searchText} placeholder="Caută..." class="pl-8" />
					</div>
					{#if groupCount > 0}
						<div class="flex items-center gap-1 rounded-md bg-muted p-0.5 text-xs">
							{#each [{ key: 'all', label: 'Toate' }, { key: 'direct', label: 'Directe' }, { key: 'group', label: 'Grupuri' }] as const as tab (tab.key)}
								<button
									type="button"
									class="flex-1 rounded px-2 py-1 font-medium transition-colors {activeFilter === tab.key
										? 'bg-background shadow-sm'
										: 'text-muted-foreground hover:text-foreground'}"
									aria-pressed={activeFilter === tab.key}
									onclick={() => (chatFilter = tab.key)}
								>
									{tab.label}
								</button>
							{/each}
						</div>
					{/if}
				</CardHeader>
				<div class="flex-1 overflow-y-auto">
					{#if filteredConversations.length === 0}
						<div class="p-6 text-center text-sm text-muted-foreground">
							{#if searchText}
								Nimic găsit.
							{:else if activeFilter === 'group'}
								Niciun grup în inbox. Alege-le din butonul cu oameni, de sus.
							{:else}
								Nicio conversație încă. Așteaptă mesaje sau începe una nouă.
							{/if}
						</div>
					{:else}
						<ul class="divide-y">
							{#each filteredConversations as c (c.chatKey)}
								{@const isSelected = selectedChat === c.chatKey}
								{@const label = displayLabel(c)}
								{@const sub = subLabel(c)}
								{@const isGroup = c.chatType === 'group'}
								<li>
									<button
										type="button"
										class="w-full px-4 py-3 text-left transition-colors hover:bg-muted/50 {isSelected ? 'bg-muted' : ''}"
										aria-current={isSelected ? 'true' : undefined}
										onclick={() => selectConversation(c.chatKey)}
									>
										<div class="flex items-center gap-3">
											<div class="relative shrink-0">
												<ContactAvatar
													src={`/${tenantSlug}/api/whatsapp/avatar/${encodeURIComponent(c.chatKey)}`}
													name={label}
													phoneE164={c.chatKey}
													size="md"
												/>
												{#if isGroup}
													<span
														class="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background"
														aria-hidden="true"
													>
														<Users class="h-3 w-3 text-muted-foreground" />
													</span>
												{/if}
											</div>
											<div class="min-w-0 flex-1">
												<div class="flex items-center gap-2">
													<span class="truncate font-medium">{label}</span>
													{#if c.unread > 0}
														<Badge class="h-5 min-w-5 px-1.5 text-xs bg-emerald-600">{c.unread}</Badge>
													{/if}
												</div>
												{#if sub}
													<p class="truncate text-xs text-muted-foreground">{sub}</p>
												{/if}
												<p class="mt-1 truncate text-xs text-muted-foreground">
													{#if !c.lastAt}
														<span class="italic">Niciun mesaj încă</span>
													{:else}
														{#if c.lastDirection === 'outbound'}
															<span>Tu: </span>
														{:else if isGroup && c.lastSenderName}
															<span>{c.lastSenderName}: </span>
														{/if}
														{c.lastBody ?? `[${c.lastMessageType}]`}
													{/if}
												</p>
											</div>
											<span class="text-xs text-muted-foreground">{formatTime(c.lastAt)}</span>
										</div>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</Card>

			<!-- Thread view -->
			<Card class="flex flex-col overflow-hidden">
				{#if !selectedChat}
					<div class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
						<div class="text-center">
							<IconWhatsapp class="mx-auto h-12 w-12 opacity-40" />
							<p class="mt-3">Selectează o conversație sau deschide una nouă.</p>
						</div>
					</div>
				{:else}
					<CardHeader class="border-b pb-3">
						{@const threadLabel = activeConversation
							? displayLabel(activeConversation)
							: (thread?.group?.subject ??
								thread?.contact?.displayName ??
								thread?.client?.name ??
								thread?.contact?.pushName ??
								selectedChat)}
						{@const memberCount = activeConversation?.participantCount ?? thread?.group?.participantCount ?? null}
						<div class="flex items-center gap-3">
							<div class="relative shrink-0">
								<ContactAvatar
									src={`/${tenantSlug}/api/whatsapp/avatar/${encodeURIComponent(selectedChat)}`}
									name={threadLabel}
									phoneE164={selectedChat}
									size="lg"
								/>
								{#if isGroupChat}
									<span
										class="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-background"
										aria-hidden="true"
									>
										<Users class="h-3.5 w-3.5 text-muted-foreground" />
									</span>
								{/if}
							</div>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<CardTitle class="truncate text-base">{threadLabel}</CardTitle>
									{#if !isGroupChat}
										<Button variant="ghost" size="sm" class="h-7 w-7 p-0" title="Redenumește" onclick={openRename}>
											<Pencil class="h-3.5 w-3.5" />
										</Button>
									{/if}
								</div>
								<p class="truncate text-xs text-muted-foreground">
									{#if isGroupChat}
										{memberCount != null ? numarSi(memberCount, 'membru', 'membri') : 'Grup'}
									{:else}
										{selectedChat}
									{/if}
									{#if thread?.client}
										·
										<a href="/{tenantSlug}/clients/{thread.client.id}" class="underline hover:no-underline">
											{isGroupChat ? thread.client.name : 'Vezi fișa clientului'}
										</a>
									{:else if !isGroupChat}
										· Nelegat la client
									{/if}
								</p>
							</div>
							<Button variant="ghost" size="sm" onclick={() => (selectedChat = null)}>Închide</Button>
						</div>
					</CardHeader>
					<div bind:this={messagesEl} onscroll={onMessagesScroll} class="flex-1 overflow-y-auto bg-muted/30 p-4">
						{#if !thread}
							<div class="text-center text-sm text-muted-foreground">Se încarcă...</div>
						{:else if thread.messages.length === 0}
							<div class="text-center text-sm text-muted-foreground">Niciun mesaj încă.</div>
						{:else}
							<ul class="space-y-2">
								{#each thread.messages as m (m.id)}
									{@const outbound = m.direction === 'outbound'}
									{@const hasMedia = !!m.mediaPath}
									{@const isImage = m.messageType === 'image' || m.messageType === 'sticker'}
									{@const isVideo = m.messageType === 'video'}
									{@const isAudio = m.messageType === 'audio'}
									{@const isDocument = m.messageType === 'document'}
									{@const mediaUrl = hasMedia ? mediaHref(m.id, m.mediaFileName) : null}
									<li class="flex {outbound ? 'justify-end' : 'justify-start'}">
										<div
											class="max-w-[70%] rounded-lg px-3 py-2 text-sm shadow-sm {outbound
												? 'bg-emerald-600 text-white'
												: 'bg-background border'}"
										>
											{#if isGroupChat && !outbound}
												<p class="mb-1 text-xs font-semibold" style="color: {senderColor(m.senderPushName ?? m.senderPhoneE164)}">
													{m.senderPushName ?? m.senderPhoneE164 ?? 'Membru necunoscut'}
												</p>
											{/if}
											{#if hasMedia && isImage && mediaUrl}
												<button
													type="button"
													class="block p-0 bg-transparent border-0 cursor-zoom-in"
													aria-label="Mărește imaginea"
													onclick={() => openLightbox(mediaUrl)}
												>
													<img src={mediaUrl} alt="" class="max-h-72 rounded object-contain" loading="lazy" />
												</button>
											{:else if hasMedia && isVideo && mediaUrl}
												<video src={mediaUrl} controls class="max-h-72 rounded">
													<track kind="captions" />
												</video>
											{:else if hasMedia && isAudio && mediaUrl}
												<audio src={mediaUrl} controls class="max-w-full"></audio>
											{:else if hasMedia && isDocument && mediaUrl}
												<a
													href={mediaUrl}
													download={m.mediaFileName ?? ''}
													class="flex items-center gap-2 rounded border border-black/10 bg-black/5 p-2 hover:bg-black/10 {outbound ? 'border-white/20 bg-white/10 hover:bg-white/20' : ''}"
												>
													<FileText class="h-8 w-8 shrink-0" />
													<div class="min-w-0 flex-1">
														<p class="truncate font-medium">{m.mediaFileName ?? 'Document'}</p>
														<p class="text-[10px] opacity-70">{formatSize(m.mediaSizeBytes)} · {m.mediaMimeType}</p>
													</div>
													<Download class="h-4 w-4 shrink-0" />
												</a>
											{:else if hasMedia}
												<p class="italic opacity-80">[{m.messageType}]</p>
											{/if}

											{#if m.body}
												<p class="whitespace-pre-wrap break-words {hasMedia ? 'mt-2' : ''}">
													{#if m.bodyParts}
														{#each m.bodyParts as part, i (i)}
															{#if part.type === 'mention'}
																<span
																	class="rounded px-1 py-0.5 font-medium {outbound
																		? 'bg-white/20 text-white'
																		: 'bg-emerald-600/10 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300'}"
																>{part.value}</span>
															{:else}{part.value}{/if}
														{/each}
													{:else}{m.body}{/if}
												</p>
											{:else if !hasMedia}
												<p class="italic opacity-80">[{m.messageType}]</p>
											{/if}

											<div class="mt-1 flex items-center gap-1 text-[10px] {outbound ? 'text-emerald-50/80' : 'text-muted-foreground'}">
												<span>{formatFull(m.createdAt)}</span>
												{#if outbound}
													<span>· {statusIcon(m.status)}</span>
												{/if}
											</div>
											{#if m.errorMessage}
												<p class="mt-1 text-[10px] text-red-200">{m.errorMessage}</p>
											{/if}
										</div>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
					<div class="border-t p-3">
						<div class="flex items-end gap-2">
							<input
								type="file"
								bind:this={fileInput}
								onchange={handleFileChange}
								class="hidden"
								accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
							/>
							<Button
								variant="ghost"
								size="icon"
								title="Atașează fișier"
								onclick={() => fileInput?.click()}
								disabled={sending}
							>
								<Paperclip class="h-4 w-4" />
							</Button>
							<Textarea
								bind:value={replyText}
								rows={2}
								placeholder="Scrie un mesaj sau lipește o imagine..."
								disabled={sending}
								class="resize-none"
								onkeydown={(e) => {
									if (e.key === 'Enter' && !e.shiftKey) {
										e.preventDefault();
										handleSendReply();
									}
								}}
								onpaste={handlePaste}
							/>
							<Button
								onclick={handleSendReply}
								disabled={!replyText.trim() || sending}
								aria-label="Trimite mesajul"
							>
								{#if sending}<Loader2 class="h-4 w-4 animate-spin" />{:else}<Send class="h-4 w-4" />{/if}
							</Button>
						</div>
						<p class="mt-1 text-xs text-muted-foreground">
							{#if isGroupChat}<span>Mesajul ajunge la toți membrii grupului.</span>{' '}{/if}Enter trimite · Shift+Enter = linie nouă · 📎 atașează · Ctrl+V lipește imagini · delay 3-7s/msg · max {MAX_MEDIA_MB}MB
						</p>
					</div>
				{/if}
			</Card>
		</div>

		{#if renameOpen}
			<div
				class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
				role="dialog"
				aria-modal="true"
				aria-label="Redenumește contact"
				use:focusTrap={{ onEscape: () => (renameOpen = false) }}
			>
				<Card class="w-full max-w-md">
					<CardHeader>
						<CardTitle>Redenumește contact</CardTitle>
						<CardDescription>Numele apare în locul numărului de telefon peste tot în CRM. Lasă gol ca să ștergi numele.</CardDescription>
					</CardHeader>
					<CardContent class="space-y-3">
						<div class="space-y-1">
							<label for="rename-phone" class="text-sm font-medium">Telefon</label>
							<Input id="rename-phone" value={selectedChat ?? ''} readonly class="font-mono" />
						</div>
						<div class="space-y-1">
							<label for="rename-name" class="text-sm font-medium">Nume</label>
							<Input id="rename-name" bind:value={renameValue} placeholder="Ex: Ion Popescu" />
						</div>
						<div class="flex justify-end gap-2">
							<Button variant="outline" onclick={() => (renameOpen = false)} disabled={renameSaving}>Anulează</Button>
							<Button onclick={handleRename} disabled={renameSaving}>
								{#if renameSaving}<Loader2 class="mr-2 h-4 w-4 animate-spin" />{/if}
								Salvează
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		{/if}

		{#if groupsOpen}
			<WhatsappGroupsDialog
				{tenantSlug}
				onclose={() => (groupsOpen = false)}
				onchanged={() => conversationsQuery?.refresh()}
			/>
		{/if}

		{#if newConvOpen}
			<div
				class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
				role="dialog"
				aria-modal="true"
				aria-label="Conversație nouă"
				use:focusTrap={{ onEscape: () => (newConvOpen = false) }}
			>
				<Card class="w-full max-w-md">
					<CardHeader>
						<CardTitle>Conversație nouă</CardTitle>
						<CardDescription>Trimite un prim mesaj unui număr nou.</CardDescription>
					</CardHeader>
					<CardContent class="space-y-3">
						<div class="space-y-1">
							<label for="new-phone" class="text-sm font-medium">Telefon (E.164)</label>
							<Input id="new-phone" bind:value={newConvPhone} placeholder="+40722123456" />
						</div>
						<div class="space-y-1">
							<label for="new-text" class="text-sm font-medium">Mesaj</label>
							<Textarea id="new-text" bind:value={newConvText} rows={4} placeholder="Scrie mesajul..." />
						</div>
						<div class="flex justify-end gap-2">
							<Button variant="outline" onclick={() => (newConvOpen = false)} disabled={newConvSending}>Anulează</Button>
							<Button
								onclick={handleNewConversation}
								disabled={!newConvPhone.trim() || !newConvText.trim() || newConvSending}
							>
								{#if newConvSending}<Loader2 class="mr-2 h-4 w-4 animate-spin" />{/if}
								Trimite
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		{/if}
	{/if}

	{#if lightboxUrl}
		<div
			class="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
			role="dialog"
			aria-modal="true"
			aria-label="Previzualizare imagine"
		>
			<button
				type="button"
				class="absolute inset-0 cursor-zoom-out bg-transparent border-0"
				aria-label="Închide"
				onclick={closeLightbox}
			></button>
			<img
				src={lightboxUrl}
				alt=""
				class="relative max-h-[95vh] max-w-[95vw] rounded object-contain shadow-2xl"
			/>
			<button
				type="button"
				class="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
				aria-label="Închide"
				onclick={closeLightbox}
			>
				<XCircle class="h-6 w-6" />
			</button>
			<a
				href={lightboxUrl}
				target="_blank"
				rel="noopener"
				class="absolute bottom-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
				aria-label="Deschide original"
				title="Deschide original în tab nou"
			>
				<Download class="h-5 w-5" />
			</a>
		</div>
	{/if}
</div>

<svelte:window onkeydown={handleLightboxKey} />
