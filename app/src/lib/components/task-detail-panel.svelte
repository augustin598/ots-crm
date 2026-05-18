<script lang="ts">
	import {
		getTaskComments,
		createTaskComment,
		updateTaskComment,
		deleteTaskComment,
		getAttachmentUrl
	} from '$lib/remotes/task-comments.remote';
	import {
		getTaskMaterials,
		getAvailableMaterialsForTask,
		linkMaterialToTask,
		unlinkMaterialFromTask
	} from '$lib/remotes/task-materials.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getTenantUsers, getClientUsers } from '$lib/remotes/users.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import {
		approveTask,
		rejectTask,
		reopenTask,
		getTasks,
		getTask,
		getCompletedTasks,
		updateTask,
		toggleSubtask,
		addSubtask,
		deleteSubtask,
		addAssignee,
		removeAssignee,
		addTag,
		removeTag,
		scheduleMeet
	} from '$lib/remotes/tasks.remote';
	import { getTaskActivities } from '$lib/remotes/task-activities.remote';
	import { getTaskFilters } from '$lib/components/task-filters-context';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import * as Sheet from '$lib/components/ui/sheet';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Separator } from '$lib/components/ui/separator';
	import RichEditor from '$lib/components/RichEditor/RichEditor.svelte';
	import * as Popover from '$lib/components/ui/popover';
	import InlineEditableText from '$lib/components/inline-editable-text.svelte';
	import { Calendar as CalendarPicker } from '$lib/components/ui/calendar';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import { CalendarDate, type DateValue } from '@internationalized/date';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import ImageLightbox from '$lib/components/image-lightbox.svelte';
	import {
		formatStatus,
		getStatusBadgeVariant,
		formatDate,
		getPriorityColor,
		getPriorityDotColor,
		getStatusDotColor,
		formatPriority,
		getActivityValueColor
	} from '$lib/components/task-kanban-utils';
	import {
		Calendar,
		User,
		Building,
		MessageSquare,
		Check,
		X,
		Pencil,
		Trash2,
		History,
		Plus,
		ArrowRight,
		UserCheck,
		RefreshCw,
		Link,
		Unlink,
		Image,
		Video,
		FileText,
		Type,
		ExternalLink,
		Reply,
		Repeat,
		ChevronLeft,
		Users,
		Clock,
		CheckSquare2,
		Square
	} from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import type { Task } from '$lib/server/db/schema';

	interface Props {
		taskId: string | null;
		onClose: () => void;
		tenantSlug?: string;
		currentUserId?: string;
		additionalQueriesToUpdate?: any[];
	}

	let {
		taskId,
		onClose,
		tenantSlug = '',
		currentUserId,
		additionalQueriesToUpdate = []
	}: Props = $props();

	const filterParams = getTaskFilters();

	const taskQuery = $derived(taskId ? getTask(taskId) : null);
	const task = $derived(taskQuery?.current ?? null);

	// Mobile redirect
	$effect(() => {
		if (taskId && typeof window !== 'undefined' && window.innerWidth < 768) {
			const tenant = tenantSlug || page.params.tenant;
			onClose();
			goto(`/${tenant}/tasks/${taskId}`);
		}
	});

	// Optimistic local overrides for base task fields
	let localOverrides = $state<Partial<Task>>({});
	let lastTaskId = $state<string | null>(null);
	$effect(() => {
		if (task && task.id !== lastTaskId) {
			localOverrides = {};
			lastTaskId = task.id;
		}
	});
	const currentTask = $derived(task ? ({ ...task, ...localOverrides } as Task) : null);

	// Mobile accordion state (matchMedia driven)
	let isMobile = $state(false);
	let progressOpen = $state(true);
	let teamOpen = $state(true);
	let materialsOpen = $state(true);
	let activityOpen = $state(false);

	$effect(() => {
		if (typeof window === 'undefined') return;
		const mql = window.matchMedia('(max-width: 767px)');
		const update = (matches: boolean) => {
			isMobile = matches;
			progressOpen = !matches;
			teamOpen = !matches;
			materialsOpen = !matches;
			activityOpen = false;
		};
		update(mql.matches);
		const handler = (e: MediaQueryListEvent) => update(e.matches);
		mql.addEventListener('change', handler);
		return () => mql.removeEventListener('change', handler);
	});

	// Due date
	let dueDateOpen = $state(false);
	const dueDateValue = $derived.by<DateValue | undefined>(() => {
		const d = currentTask?.dueDate;
		if (!d) return undefined;
		const dt = new Date(d);
		return new CalendarDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
	});

	// Comment state
	let commentLoading = $state(false);
	let approvalLoading = $state(false);
	let editingCommentId = $state<string | null>(null);
	let editingContent = $state('');
	let editLoading = $state(false);
	let newCommentEditor: RichEditor | null = $state(null);
	let editCommentEditor: RichEditor | null = $state(null);
	let replyingToId = $state<string | null>(null);
	let replyEditor: RichEditor | null = $state(null);
	let replyLoading = $state(false);

	let pendingAttachments = $state<
		{ path: string; mimeType: string; fileName: string; size: number; previewUrl: string }[]
	>([]);
	let uploadingImage = $state(false);
	let lightboxSrc = $state('');
	let lightboxOpen = $state(false);
	let attachmentUrls = $state<Record<string, string>>({});

	// Subtask state
	let newSubtaskTitle = $state('');
	let subtaskLoading = $state<Record<string, boolean>>({});

	// Team state
	let addAssigneeOpen = $state(false);

	// Tag state
	let newTagInput = $state('');
	let tagInputOpen = $state(false);

	// Materials
	let materialsTab = $state<'all' | 'img' | 'vid' | 'doc'>('all');
	let materialPickerOpen = $state(false);
	let materialSearchTerm = $state('');
	let linkingMaterialId = $state<string | null>(null);

	// Meet modal
	let showMeetModal = $state(false);
	let meetTitle = $state('');
	let meetDate = $state('');
	let meetTime = $state('');
	let meetDuration = $state('30');
	let meetLink = $state('');
	let meetSaving = $state(false);

	$effect(() => {
		if (showMeetModal && task) {
			meetTitle = task.title;
			meetDate = new Date().toISOString().split('T')[0];
			meetTime = (task as any).meetTime ?? '10:00';
			meetDuration = String((task as any).meetDurationMinutes ?? 30);
			meetLink = '';
		}
	});

	// Queries
	const commentsQuery = $derived(task ? getTaskComments(task.id) : null);
	const comments = $derived(commentsQuery?.current || []);

	const activitiesQuery = $derived(task ? getTaskActivities(task.id) : null);
	const activities = $derived(activitiesQuery?.current || []);

	const materialsQuery = $derived(task ? getTaskMaterials(task.id) : null);
	const taskMaterials = $derived(materialsQuery?.current || []);

	const availableMaterialsQuery = $derived(
		task && materialPickerOpen ? getAvailableMaterialsForTask(task.id) : null
	);
	const availableMaterials = $derived(availableMaterialsQuery?.current || []);
	const filteredAvailableMaterials = $derived(
		materialSearchTerm.trim()
			? availableMaterials.filter((m: any) =>
					m.title.toLowerCase().includes(materialSearchTerm.toLowerCase())
				)
			: availableMaterials
	);

	const MATERIAL_TYPE_ICONS: Record<string, typeof Image> = {
		image: Image,
		video: Video,
		document: FileText,
		text: Type,
		url: ExternalLink
	};

	const filteredMaterials = $derived(
		taskMaterials.filter((m: any) => {
			if (materialsTab === 'all') return true;
			if (materialsTab === 'img') return m.materialType === 'image';
			if (materialsTab === 'vid') return m.materialType === 'video';
			if (materialsTab === 'doc')
				return m.materialType === 'document' || m.materialType === 'text' || m.materialType === 'url';
			return true;
		})
	);

	const usersQuery = getTenantUsers();
	const users = $derived(usersQuery.current || []);
	const userMap = $derived(
		new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim() || u.email]))
	);

	const clientUsersQuery = $derived(task?.clientId ? getClientUsers(task.clientId) : null);
	const mentionUsers = $derived(clientUsersQuery?.current || users);

	const topLevelComments = $derived(comments.filter((c: any) => !c.parentCommentId));
	const repliesMap = $derived(
		comments.reduce((map: Map<string, any[]>, c: any) => {
			if (c.parentCommentId) {
				const existing = map.get(c.parentCommentId) || [];
				existing.push(c);
				map.set(c.parentCommentId, existing);
			}
			return map;
		}, new Map<string, any[]>())
	);

	const projectsQuery = getProjects(undefined);
	const projects = $derived(projectsQuery.current || []);
	const projectMap = $derived(new Map(projects.map((p) => [p.id, p.name])));

	const clientsQuery = getClients();
	const clientsList = $derived(clientsQuery.current || []);
	const clientMap = $derived(new Map(clientsList.map((c: any) => [c.id, c.name])));

	const clientOptions = $derived([
		{ value: '', label: '—' },
		...(clientsList as { id: string; name: string }[]).map((c) => ({
			value: c.id,
			label: c.name
		}))
	]);

	// Derived from task query result
	const subtasks = $derived((task as any)?.subtasks ?? []);
	const tags = $derived((task as any)?.tags ?? []);
	const assignees = $derived((task as any)?.assignees ?? []);
	const subDone = $derived(subtasks.filter((s: any) => s.done).length);
	const subTotal = $derived(subtasks.length);
	const subPct = $derived(subTotal > 0 ? Math.round((subDone / subTotal) * 100) : 0);

	const assigneeOptions = $derived(
		users
			.filter((u) => !assignees.some((a: any) => a.userId === u.id))
			.map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}`.trim() || u.email }))
	);

	const isOverdue = $derived(
		!!(
			currentTask?.dueDate &&
			currentTask.status !== 'done' &&
			currentTask.status !== 'cancelled' &&
			new Date(currentTask.dueDate) < new Date()
		)
	);

	const TYPE_COLORS: Record<string, string> = {
		design: 'bg-purple-100 text-purple-700',
		video: 'bg-pink-100 text-pink-700',
		ads: 'bg-blue-100 text-blue-700',
		dev: 'bg-cyan-100 text-cyan-700',
		content: 'bg-lime-100 text-lime-700',
		meeting: 'bg-amber-100 text-amber-700',
		other: 'bg-gray-100 text-gray-600'
	};

	async function saveField<K extends keyof Task>(field: K, value: Task[K]) {
		if (!task) return;
		if (field === 'title' && !String(value ?? '').trim()) {
			toast.error('Titlul nu poate fi gol');
			return;
		}
		const previous = currentTask?.[field];
		localOverrides = { ...localOverrides, [field]: value };
		try {
			const payload: any = { taskId: task.id, title: currentTask?.title ?? task.title };
			if (field === 'title') {
				payload.title = value;
			} else {
				const v = value === '' || value === null ? undefined : value;
				if (v !== undefined) payload[field] = v;
			}
			await updateTask(payload).updates(
				getTasks({ ...((filterParams as any) || {}), excludeCompleted: true }),
				getTask(task.id),
				getCompletedTasks({ ...((filterParams as any) || {}), page: 1, pageSize: 20 }),
				...additionalQueriesToUpdate
			);
		} catch (e) {
			localOverrides = { ...localOverrides, [field]: previous };
			toast.error(`Nu s-a putut salva: ${e instanceof Error ? e.message : 'eroare'}`);
		}
	}

	function handleDueDateSelect(value: DateValue | undefined) {
		dueDateOpen = false;
		if (!value) return;
		const iso = `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
		saveField('dueDate', iso as any);
	}

	const fieldLabels: Record<string, string> = {
		title: 'titlul', description: 'descrierea', status: 'statusul', priority: 'prioritatea',
		assignedToUserId: 'responsabilul', dueDate: 'termenul limită', clientId: 'clientul',
		projectId: 'proiectul', milestoneId: 'milestone-ul', isRecurring: 'recurența',
		recurringType: 'frecvența', recurringInterval: 'intervalul', recurringEndDate: 'sfârșitul recurenței'
	};

	function formatRecurrenceLabel(t: {
		isRecurring?: boolean | null;
		recurringType?: string | null;
		recurringInterval?: number | null;
	}): string {
		if (!t.isRecurring || !t.recurringType) return 'Recurent';
		const interval = t.recurringInterval || 1;
		const typeLabels: Record<string, [string, string]> = {
			daily: ['zi', 'zile'], weekly: ['săptămână', 'săptămâni'],
			monthly: ['lună', 'luni'], yearly: ['an', 'ani']
		};
		const [singular, plural] = typeLabels[t.recurringType] || ['', ''];
		if (interval === 1) return `Recurent · în fiecare ${singular}`;
		return `Recurent · la ${interval} ${plural}`;
	}

	function getActivityVerb(activity: { action: string; field?: string | null }): string {
		switch (activity.action) {
			case 'created': return 'a creat acest task';
			case 'commented': return 'a adăugat un comentariu';
			case 'approved': return 'a aprobat task-ul';
			case 'rejected': return 'a respins task-ul';
			case 'status_changed': return 'a schimbat statusul';
			case 'assigned': return 'a schimbat responsabilul';
			case 'updated':
				return activity.field
					? `a actualizat ${fieldLabels[activity.field] || activity.field}`
					: 'a actualizat task-ul';
			default: return activity.action;
		}
	}

	function resolveActivityValue(field: string | null | undefined, value: string | null | undefined): string {
		if (!value) return '';
		if (!field) return value;
		switch (field) {
			case 'clientId': return clientMap.get(value) || value;
			case 'assignedToUserId': return userMap.get(value) || value;
			case 'projectId': return projectMap.get(value) || value;
			default: return value;
		}
	}

	function getActivityIconColor(action: string): string {
		switch (action) {
			case 'created': return 'bg-green-100 text-green-600';
			case 'commented': return 'bg-blue-100 text-blue-600';
			case 'approved': return 'bg-emerald-100 text-emerald-600';
			case 'rejected': return 'bg-red-100 text-red-600';
			case 'status_changed': return 'bg-purple-100 text-purple-600';
			case 'assigned': return 'bg-amber-100 text-amber-600';
			default: return 'bg-gray-100 text-gray-600';
		}
	}

	function timeAgo(date: Date | string): string {
		const now = new Date();
		const d = new Date(date);
		const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
		if (diff < 60) return 'acum';
		if (diff < 3600) return `${Math.floor(diff / 60)}m`;
		if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
		if (diff < 604800) return `${Math.floor(diff / 86400)}z`;
		return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
	}

	function getInitials(name: string): string {
		return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
	}

	async function uploadImage(file: File) {
		if (!task) return;
		if (file.size > 10 * 1024 * 1024) { toast.error('Imaginea trebuie să fie sub 10MB'); return; }
		uploadingImage = true;
		try {
			const formData = new FormData();
			formData.append('file', file);
			formData.append('taskId', task.id);
			const response = await fetch(`/${tenantSlug}/task-comments/upload`, { method: 'POST', body: formData });
			if (!response.ok) {
				const err = await response.json().catch(() => ({ message: 'Upload failed' }));
				throw new Error(err.message || `HTTP ${response.status}`);
			}
			const result = await response.json();
			pendingAttachments = [...pendingAttachments, { ...result, previewUrl: URL.createObjectURL(file) }];
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la upload');
		} finally {
			uploadingImage = false;
		}
	}

	function removePendingAttachment(index: number) {
		URL.revokeObjectURL(pendingAttachments[index].previewUrl);
		pendingAttachments = pendingAttachments.filter((_, i) => i !== index);
	}

	function removeAllPendingAttachments() {
		for (const a of pendingAttachments) URL.revokeObjectURL(a.previewUrl);
		pendingAttachments = [];
	}

	async function loadAttachmentUrl(attachmentId: string) {
		if (attachmentUrls[attachmentId]) return;
		try {
			const result = await getAttachmentUrl(attachmentId).current;
			if (result?.url) attachmentUrls = { ...attachmentUrls, [attachmentId]: result.url };
		} catch { /* silent */ }
	}

	function openLightbox(src: string) { lightboxSrc = src; lightboxOpen = true; }

	async function handleAddComment() {
		const html = newCommentEditor?.getHTML() ?? '';
		const editorEmpty = newCommentEditor?.isEmpty() ?? true;
		if ((editorEmpty && pendingAttachments.length === 0) || !task) return;
		commentLoading = true;
		try {
			await createTaskComment({
				taskId: task.id,
				content: editorEmpty ? '' : html,
				attachments: pendingAttachments.map((a) => ({ path: a.path, mimeType: a.mimeType, fileName: a.fileName, fileSize: a.size }))
			}).updates(getTaskComments(task.id), getTaskActivities(task.id));
			newCommentEditor?.clear();
			removeAllPendingAttachments();
			toast.success('Comentariu adăugat');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la comentariu');
		} finally {
			commentLoading = false;
		}
	}

	async function handleEditComment(commentId: string) {
		const html = editCommentEditor?.getHTML() ?? '';
		const isEmpty = editCommentEditor?.isEmpty() ?? true;
		if (isEmpty || !task) return;
		editLoading = true;
		try {
			await updateTaskComment({ commentId, content: html }).updates(getTaskComments(task.id), getTaskActivities(task.id));
			editingCommentId = null;
			editingContent = '';
			toast.success('Comentariu actualizat');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			editLoading = false;
		}
	}

	async function handleReply(parentCommentId: string) {
		const html = replyEditor?.getHTML() ?? '';
		const isEmpty = replyEditor?.isEmpty() ?? true;
		if (isEmpty || !task) return;
		replyLoading = true;
		try {
			await createTaskComment({ taskId: task.id, content: html, parentCommentId }).updates(getTaskComments(task.id), getTaskActivities(task.id));
			replyEditor?.clear();
			replyingToId = null;
			toast.success('Răspuns adăugat');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			replyLoading = false;
		}
	}

	async function handleDeleteComment(commentId: string) {
		if (!task || !confirm('Ștergi comentariul?')) return;
		try {
			await deleteTaskComment(commentId).updates(getTaskComments(task.id), getTaskActivities(task.id));
			toast.success('Comentariu șters');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		}
	}

	async function handleApprove() {
		if (!task) return;
		approvalLoading = true;
		try {
			await approveTask({ taskId: task.id }).updates(
				getTasks({ ...((filterParams as any) || {}), excludeCompleted: true }),
				getTask(task.id),
				getCompletedTasks({ ...((filterParams as any) || {}), page: 1, pageSize: 20 }),
				...additionalQueriesToUpdate
			);
			toast.success('Task aprobat');
			onClose();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			approvalLoading = false;
		}
	}

	async function handleReject() {
		if (!task || !confirm('Respingi acest task?')) return;
		approvalLoading = true;
		try {
			await rejectTask(task.id).updates(
				getTasks({ ...((filterParams as any) || {}), excludeCompleted: true }),
				getTask(task.id),
				getCompletedTasks({ ...((filterParams as any) || {}), page: 1, pageSize: 20 }),
				...additionalQueriesToUpdate
			);
			toast.success('Task respins');
			onClose();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			approvalLoading = false;
		}
	}

	async function handleReopen() {
		if (!task) return;
		approvalLoading = true;
		try {
			await reopenTask({ taskId: task.id }).updates(
				getTasks({ ...((filterParams as any) || {}), excludeCompleted: true }),
				getTask(task.id),
				getCompletedTasks({ ...((filterParams as any) || {}), page: 1, pageSize: 20 }),
				...additionalQueriesToUpdate
			);
			toast.success('Task redeschis');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			approvalLoading = false;
		}
	}

	async function handleLinkMaterial(materialId: string) {
		if (!task) return;
		linkingMaterialId = materialId;
		try {
			await linkMaterialToTask({ taskId: task.id, materialId }).updates(getTaskMaterials(task.id), getAvailableMaterialsForTask(task.id));
			toast.success('Material adăugat');
		} catch (e: any) {
			toast.error(e?.message || 'Eroare la adăugare material');
		} finally {
			linkingMaterialId = null;
		}
	}

	async function handleUnlinkMaterial(materialId: string) {
		if (!task || !confirm('Elimini legătura cu acest material?')) return;
		try {
			await unlinkMaterialFromTask({ taskId: task.id, materialId }).updates(getTaskMaterials(task.id), getAvailableMaterialsForTask(task.id));
			toast.success('Material eliminat');
		} catch (e: any) {
			toast.error(e?.message || 'Eroare');
		}
	}

	async function handleToggleSubtask(subtaskId: string, done: boolean) {
		if (!task) return;
		subtaskLoading = { ...subtaskLoading, [subtaskId]: true };
		try {
			await toggleSubtask({ subtaskId, done }).updates(getTask(task.id));
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			subtaskLoading = { ...subtaskLoading, [subtaskId]: false };
		}
	}

	async function handleAddSubtask() {
		if (!task || !newSubtaskTitle.trim()) return;
		try {
			await addSubtask({ taskId: task.id, title: newSubtaskTitle.trim() }).updates(getTask(task.id));
			newSubtaskTitle = '';
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la adăugare subtask');
		}
	}

	async function handleDeleteSubtask(subtaskId: string) {
		if (!task) return;
		try {
			await deleteSubtask(subtaskId).updates(getTask(task.id));
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		}
	}

	async function handleAddAssignee(userId: string) {
		if (!task) return;
		addAssigneeOpen = false;
		try {
			await addAssignee({ taskId: task.id, userId }).updates(getTask(task.id));
			toast.success('Membru adăugat');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		}
	}

	async function handleRemoveAssignee(userId: string) {
		if (!task) return;
		try {
			await removeAssignee({ taskId: task.id, userId }).updates(
				getTask(task.id),
				getTasks({ ...((filterParams as any) || {}), excludeCompleted: true })
			);
			toast.success('Membru eliminat');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		}
	}

	async function handleAddTag() {
		if (!task || !newTagInput.trim()) return;
		try {
			await addTag({ taskId: task.id, tagName: newTagInput.trim() }).updates(getTask(task.id));
			newTagInput = '';
			tagInputOpen = false;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la adăugare tag');
		}
	}

	async function handleRemoveTag(tagId: string) {
		if (!task) return;
		try {
			await removeTag({ taskId: task.id, tagId }).updates(getTask(task.id));
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		}
	}

	async function handleSaveMeet() {
		if (!task) return;
		meetSaving = true;
		try {
			await scheduleMeet({
				taskId: task.id,
				meetLink: meetLink || undefined,
				meetTime: meetTime || undefined,
				meetDurationMinutes: meetDuration ? parseInt(meetDuration) : undefined
			}).updates(getTask(task.id));
			showMeetModal = false;
			toast.success('Meeting programat');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvare');
		} finally {
			meetSaving = false;
		}
	}
</script>

<Sheet.Root open={!!taskId} onOpenChange={(v) => { if (!v) onClose(); }}>
	<Sheet.Content side="right" class="w-full overflow-y-auto p-0 sm:max-w-[860px]">
		<Sheet.Header class="sr-only">
			<Sheet.Title>{currentTask?.title ?? 'Task Detail'}</Sheet.Title>
		</Sheet.Header>

		{#if !task && taskId}
			<div class="flex h-full items-center justify-center p-6">
				<p class="text-muted-foreground text-sm">Se încarcă...</p>
			</div>
		{:else if task && currentTask}
			<div class="flex min-h-full flex-col">

				<!-- ══ STICKY HEADER ══ -->
				<div class="sticky top-0 z-20 shrink-0 border-b bg-white px-6 pt-4 pb-3">
					<div class="mb-3 flex items-center justify-between">
						<button
							type="button"
							class="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
							onclick={onClose}
						>
							<ChevronLeft class="h-4 w-4" />
							Înapoi
						</button>
						<button
							type="button"
							class="flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
							onclick={() => (showMeetModal = true)}
						>
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" class="shrink-0" aria-hidden="true">
								<path d="M16 8.5V12.5L20 16V5L16 8.5Z" fill="#a7f3d0"/>
								<path d="M3 6V18C3 18.5523 3.44772 19 4 19H14C14.5523 19 15 18.5523 15 18V14L11 14V6H3Z" fill="white"/>
								<path d="M11 6V14H15V10L11 6Z" fill="#fef08a"/>
								<path d="M15 14L11 10V14H15Z" fill="#fca5a5"/>
								<path d="M11 6L15 10V6H11Z" fill="#bbf7d0"/>
							</svg>
							Programează Google Meet
						</button>
					</div>

					<h1 class="mb-2 text-xl font-bold leading-tight text-gray-900">
						<InlineEditableText
							value={currentTask.title}
							onSave={(v) => saveField('title', v)}
							displayClass="text-xl font-bold leading-tight"
							ariaLabel="Editează titlul task-ului"
						/>
					</h1>

					<div class="flex flex-wrap items-center gap-2">
						<!-- Status pill -->
						<Popover.Root>
							<Popover.Trigger>
								{#snippet child({ props })}
									<button {...props} type="button" class="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
										<Badge variant={getStatusBadgeVariant(currentTask.status)}>
											{formatStatus(currentTask.status || 'todo')}
										</Badge>
									</button>
								{/snippet}
							</Popover.Trigger>
							<Popover.Content class="w-52 p-1">
								{#each [['pending-approval','Pending Approval'],['todo','To Do'],['in-progress','In Progress'],['review','Review'],['done','Done'],['cancelled','Cancelled']] as [val, label] (val)}
									<button type="button" class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent" onclick={() => saveField('status', val as any)}>
										<span class="h-2 w-2 rounded-full {getStatusDotColor(val)}"></span>{label}
									</button>
								{/each}
							</Popover.Content>
						</Popover.Root>

						<!-- Priority pill -->
						<Popover.Root>
							<Popover.Trigger>
								{#snippet child({ props })}
									<button {...props} type="button" class="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
										<Badge class={getPriorityColor(currentTask.priority || 'medium')}>
											{formatPriority(currentTask.priority || 'medium')}
										</Badge>
									</button>
								{/snippet}
							</Popover.Trigger>
							<Popover.Content class="w-48 p-1">
								{#each [['urgent','Urgent'],['high','High'],['medium','Medium'],['low','Low']] as [val, label] (val)}
									<button type="button" class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent" onclick={() => saveField('priority', val as any)}>
										<span class="h-2 w-2 rounded-full {getPriorityDotColor(val)}"></span>{label}
									</button>
								{/each}
							</Popover.Content>
						</Popover.Root>

						{#if isOverdue}
							<span class="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-600">Overdue</span>
						{/if}

						{#if currentTask.type}
							<span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium {TYPE_COLORS[currentTask.type] ?? 'bg-gray-100 text-gray-600'}">{currentTask.type}</span>
						{/if}

						{#each tags as tag (tag.id)}
							<span class="group inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
								{tag.name}
								<button type="button" class="hidden opacity-60 hover:opacity-100 group-hover:inline-flex" onclick={() => handleRemoveTag(tag.id)}>
									<X class="h-3 w-3" />
								</button>
							</span>
						{/each}

						{#if tagInputOpen}
							<form onsubmit={(e) => { e.preventDefault(); handleAddTag(); }} class="flex items-center gap-1">
								<input
									type="text"
									bind:value={newTagInput}
									placeholder="#tag"
									class="h-6 w-24 rounded-full border bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
									autofocus
									onblur={() => { if (!newTagInput) tagInputOpen = false; }}
								/>
								<button type="submit" class="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">OK</button>
							</form>
						{:else}
							<button type="button" class="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 transition-colors hover:bg-slate-200" onclick={() => (tagInputOpen = true)}>
								<Plus class="h-3 w-3" /> Tag
							</button>
						{/if}

						{#if currentTask.recurringParentId}
							<span class="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-800">
								<Repeat class="h-3 w-3" /> Din serie recurentă
							</span>
						{:else if currentTask.isRecurring}
							<span class="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-800">
								<Repeat class="h-3 w-3" /> {formatRecurrenceLabel(currentTask)}
							</span>
						{/if}
					</div>
				</div>

				<!-- ══ BODY ══ -->
				<div class="flex flex-1 flex-wrap md:flex-nowrap">

					<!-- MAIN COLUMN -->
					<div class="w-full min-w-0 p-6 md:flex-1">
						<div class="space-y-6">

							<!-- Metadata row -->
							<div class="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border bg-slate-50/80 px-4 py-3 text-sm">
								<div class="flex items-center gap-2">
									<User class="h-4 w-4 shrink-0 text-muted-foreground" />
									<Select type="single" value={currentTask.assignedToUserId ?? ''} onValueChange={(v) => saveField('assignedToUserId', (v || '') as any)}>
										<SelectTrigger class="h-auto border-0 p-0 text-sm font-medium shadow-none">
											{userMap.get(currentTask.assignedToUserId ?? '') ?? 'Responsabil'}
										</SelectTrigger>
										<SelectContent>
											{#each users as u (u.id)}
												<SelectItem value={u.id}>{`${u.firstName} ${u.lastName}`.trim() || u.email}</SelectItem>
											{/each}
										</SelectContent>
									</Select>
								</div>

								<div class="flex items-center gap-2">
									<CalendarIcon class="h-4 w-4 shrink-0 text-muted-foreground" />
									<Popover.Root bind:open={dueDateOpen}>
										<Popover.Trigger>
											{#snippet child({ props })}
												<button {...props} type="button" class="text-sm font-medium hover:underline focus:outline-none">
													{currentTask.dueDate ? formatDate(currentTask.dueDate) : 'Termen limită'}
												</button>
											{/snippet}
										</Popover.Trigger>
										<Popover.Content class="w-auto p-0" align="start">
											<CalendarPicker type="single" value={dueDateValue} onValueChange={handleDueDateSelect} locale="ro-RO" />
										</Popover.Content>
									</Popover.Root>
								</div>

								<div class="flex items-center gap-2">
									<Building class="h-4 w-4 shrink-0 text-muted-foreground" />
									<Popover.Root>
										<Popover.Trigger>
											{#snippet child({ props })}
												<button {...props} type="button" class="text-sm font-medium hover:underline focus:outline-none">
													{clientMap.get(currentTask.clientId ?? '') ?? 'Client'}
												</button>
											{/snippet}
										</Popover.Trigger>
										<Popover.Content class="w-64 p-2">
											<Combobox value={currentTask.clientId ?? ''} options={clientOptions} placeholder="Alege client" searchPlaceholder="Caută..." onValueChange={(v) => saveField('clientId', ((v as string) || '') as any)} />
										</Popover.Content>
									</Popover.Root>
								</div>

								{#if task.createdAt}
									<div class="flex items-center gap-1 text-muted-foreground">
										<Clock class="h-3.5 w-3.5 shrink-0" />
										<span>{formatDate(task.createdAt as any)}</span>
									</div>
								{/if}
							</div>

							<!-- Description -->
							<div>
								<h4 class="mb-2 text-sm font-semibold text-gray-700">Descriere</h4>
								<InlineEditableText
									value={currentTask.description ?? ''}
									onSave={(v) => saveField('description', (v || null) as any)}
									multiline
									placeholder="Scrie o descriere..."
									emptyPlaceholder="Click pentru a adăuga o descriere"
									displayClass="text-muted-foreground leading-relaxed whitespace-pre-wrap text-sm"
									ariaLabel="Editează descrierea"
								/>
							</div>

							<Separator />

							<!-- Comments -->
							<div>
								<div class="mb-4 flex items-center gap-2">
									<MessageSquare class="h-4 w-4 text-muted-foreground" />
									<h4 class="font-semibold">Comentarii ({comments.length})</h4>
								</div>

								<div class="mb-4 space-y-3">
									{#if comments.length === 0}
										<p class="text-sm text-muted-foreground">Niciun comentariu. Fii primul!</p>
									{:else}
										{#each topLevelComments as comment}
											{@const authorName = comment.authorName || userMap.get(comment.userId) || comment.userId}
											{@const isOwnComment = currentUserId && comment.userId === currentUserId}
											{@const replies = repliesMap.get(comment.id) || []}
											<div class="rounded-xl border bg-white p-4 shadow-sm">
												<div class="mb-2 flex items-start gap-3">
													<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
														{getInitials(authorName)}
													</div>
													<div class="min-w-0 flex-1">
														<div class="flex flex-wrap items-center gap-2">
															<p class="text-sm font-semibold">{authorName}</p>
															<p class="text-xs text-muted-foreground">{timeAgo(comment.createdAt)}</p>
															{#if comment.updatedAt && new Date(comment.updatedAt).getTime() - new Date(comment.createdAt).getTime() > 1000}
																<span class="text-xs italic text-muted-foreground">(editat)</span>
															{/if}
														</div>
													</div>
													<div class="flex shrink-0 items-center gap-1">
														<button type="button" class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onclick={() => { replyingToId = replyingToId === comment.id ? null : comment.id; }} title="Răspunde">
															<Reply class="h-3.5 w-3.5" />
														</button>
														{#if isOwnComment && editingCommentId !== comment.id}
															<button type="button" class="rounded p-1 text-muted-foreground hover:bg-muted" onclick={() => { editingCommentId = comment.id; editingContent = comment.content; }}>
																<Pencil class="h-3.5 w-3.5" />
															</button>
															<button type="button" class="rounded p-1 text-muted-foreground hover:text-destructive" onclick={() => handleDeleteComment(comment.id)}>
																<Trash2 class="h-3.5 w-3.5" />
															</button>
														{/if}
													</div>
												</div>

												{#if editingCommentId === comment.id}
													<div class="space-y-2">
														<RichEditor bind:this={editCommentEditor} content={editingContent} placeholder="Editează comentariul..." minHeight="120px" showFooter={false} users={mentionUsers} />
														<div class="flex gap-2">
															<Button size="sm" onclick={() => handleEditComment(comment.id)} disabled={editLoading}>{editLoading ? 'Se salvează...' : 'Salvează'}</Button>
															<Button size="sm" variant="outline" onclick={() => { editingCommentId = null; editingContent = ''; }}>Anulează</Button>
														</div>
													</div>
												{:else}
													<div class="comment-display text-sm leading-relaxed">{@html comment.content}</div>
												{/if}

												<!-- 180×180 image grid: 2 cols on mobile, 3 on sm+ -->
												{#if comment.attachments?.length}
													<div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
														{#each comment.attachments as att (att.id)}
															{@const url = attachmentUrls[att.id]}
															{#if !url}
																{(loadAttachmentUrl(att.id), '')}
																<div class="h-[180px] w-full animate-pulse rounded-lg bg-muted"></div>
															{:else}
																<button type="button" class="block cursor-pointer overflow-hidden rounded-lg border" onclick={() => openLightbox(url)}>
																	<img src={url} alt={att.fileName || 'Atașament'} class="h-[180px] w-full object-cover transition-opacity hover:opacity-90" />
																</button>
															{/if}
														{/each}
													</div>
												{/if}

												<!-- Reaction stubs — Faza 3 -->
												<div class="mt-2 flex items-center gap-1">
													{#each ['👍', '🔥', '🎉'] as emoji}
														<button type="button" class="flex items-center gap-1 rounded-full border bg-slate-50 px-2 py-0.5 text-xs transition-colors hover:bg-slate-100" onclick={() => toast.info('Reacțiile vin în Faza 3')}>
															{emoji} <span class="text-muted-foreground">0</span>
														</button>
													{/each}
												</div>

												<!-- Replies thread -->
												{#if replies.length > 0}
													<div class="mt-3 ml-6 space-y-2 border-l-2 border-muted pl-3">
														{#each replies as reply}
															{@const replyAuthor = reply.authorName || userMap.get(reply.userId) || reply.userId}
															{@const isOwnReply = currentUserId && reply.userId === currentUserId}
															<div class="py-1.5">
																<div class="mb-1 flex items-center gap-2">
																	<div class="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
																		{getInitials(replyAuthor)}
																	</div>
																	<p class="text-xs font-medium">{replyAuthor}</p>
																	<p class="text-xs text-muted-foreground">{timeAgo(reply.createdAt)}</p>
																	{#if isOwnReply}
																		<button type="button" class="ml-auto rounded p-0.5 text-muted-foreground hover:text-destructive" onclick={() => handleDeleteComment(reply.id)}>
																			<Trash2 class="h-3 w-3" />
																		</button>
																	{/if}
																</div>
																<div class="comment-display ml-8 text-sm">{@html reply.content}</div>
															</div>
														{/each}
													</div>
												{/if}

												{#if replyingToId === comment.id}
													<div class="mt-3 ml-6 border-l-2 border-primary/30 pl-3">
														<RichEditor bind:this={replyEditor} placeholder="Scrie un răspuns..." minHeight="100px" showFooter={false} users={mentionUsers} />
														<div class="mt-2 flex gap-2">
															<Button size="sm" onclick={() => handleReply(comment.id)} disabled={replyLoading}>{replyLoading ? 'Se trimite...' : 'Trimite'}</Button>
															<Button size="sm" variant="outline" onclick={() => { replyingToId = null; }}>Anulează</Button>
														</div>
													</div>
												{/if}
											</div>
										{/each}
									{/if}
								</div>

								<div class="space-y-2">
									<RichEditor bind:this={newCommentEditor} placeholder="Adaugă un comentariu... (paste imagine cu Ctrl+V)" minHeight="120px" showFooter={false} onPasteImage={(file) => uploadImage(file)} users={mentionUsers} />
									{#if uploadingImage}
										<div class="flex items-center gap-2 text-sm text-muted-foreground">
											<div class="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
											Se încarcă imaginea...
										</div>
									{/if}
									{#if pendingAttachments.length > 0}
										<div class="flex flex-wrap gap-2">
											{#each pendingAttachments as attachment, i}
												<div class="relative inline-block">
													<img src={attachment.previewUrl} alt="Preview" class="max-h-32 rounded-lg border" />
													<button type="button" class="text-destructive-foreground absolute -top-2 -right-2 rounded-full bg-destructive p-0.5 hover:bg-destructive/90" onclick={() => removePendingAttachment(i)}>
														<X class="h-4 w-4" />
													</button>
												</div>
											{/each}
										</div>
									{/if}
									<Button size="sm" onclick={handleAddComment} disabled={commentLoading || uploadingImage}>
										{commentLoading ? 'Se trimite...' : 'Trimite comentariu'}
									</Button>
								</div>
							</div>
						</div>
					</div>

					<!-- ══ RIGHT RAIL ══
						 Desktop: 280px fixed sidebar beside main content.
						 Mobile (flex-wrap): drops below as full-width with accordion behavior. -->
					<aside class="w-full border-t bg-slate-50/50 md:w-[280px] md:shrink-0 md:border-t-0 md:border-l">
						<div class="p-4 space-y-3">

							<!-- PROGRES / SUBTASKS card -->
							<details bind:open={progressOpen} class="overflow-hidden rounded-xl border bg-white shadow-sm">
								<summary class="flex cursor-pointer select-none list-none items-center justify-between p-4 text-sm font-semibold">
									<span class="flex items-center gap-2">
										<CheckSquare2 class="h-4 w-4 text-muted-foreground" />
										Progres ({subDone}/{subTotal})
									</span>
									<ChevronLeft class="h-4 w-4 text-muted-foreground transition-transform md:hidden {progressOpen ? '-rotate-90' : 'rotate-180'}" />
								</summary>
								<div class="px-4 pb-4 space-y-3">
									<div>
										<div class="h-2 w-full overflow-hidden rounded-full bg-slate-200">
											<div class="h-full rounded-full bg-emerald-500 transition-all" style="width: {subPct}%"></div>
										</div>
										<div class="mt-1 flex justify-between text-xs text-muted-foreground">
											<span>{subPct}% complet</span>
											<span>{subTotal - subDone} rămase</span>
										</div>
									</div>
									<div class="space-y-1.5">
										{#each subtasks as sub (sub.id)}
											<div class="group flex items-center gap-2">
												<button
													type="button"
													class="shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
													disabled={subtaskLoading[sub.id]}
													onclick={() => handleToggleSubtask(sub.id, !sub.done)}
												>
													{#if sub.done}
														<CheckSquare2 class="h-4 w-4 text-emerald-500" />
													{:else}
														<Square class="h-4 w-4" />
													{/if}
												</button>
												<span class="flex-1 text-sm leading-tight {sub.done ? 'line-through text-muted-foreground' : ''}">{sub.title}</span>
												<button type="button" class="hidden shrink-0 text-muted-foreground hover:text-destructive group-hover:block" onclick={() => handleDeleteSubtask(sub.id)}>
													<X class="h-3.5 w-3.5" />
												</button>
											</div>
										{/each}
									</div>
									<form onsubmit={(e) => { e.preventDefault(); handleAddSubtask(); }} class="flex items-center gap-2">
										<input
											type="text"
											bind:value={newSubtaskTitle}
											placeholder="Adaugă subtask..."
											class="h-8 flex-1 rounded-lg border bg-slate-50 px-3 text-sm focus:bg-white focus:outline-none focus:ring-1 focus:ring-ring"
										/>
										<button type="submit" class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={!newSubtaskTitle.trim()}>
											<Plus class="h-4 w-4" />
										</button>
									</form>
								</div>
							</details>

							<!-- ECHIPĂ card -->
							<details bind:open={teamOpen} class="overflow-hidden rounded-xl border bg-white shadow-sm">
								<summary class="flex cursor-pointer select-none list-none items-center justify-between p-4 text-sm font-semibold">
									<span class="flex items-center gap-2">
										<Users class="h-4 w-4 text-muted-foreground" />
										Echipă ({assignees.length})
									</span>
									<ChevronLeft class="h-4 w-4 text-muted-foreground transition-transform md:hidden {teamOpen ? '-rotate-90' : 'rotate-180'}" />
								</summary>
								<div class="px-4 pb-4 space-y-2">
									{#each assignees as assignee (assignee.userId)}
										{@const fullName = `${assignee.firstName} ${assignee.lastName}`.trim() || assignee.email}
										<div class="group flex items-center gap-3">
											<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
												{getInitials(fullName)}
											</div>
											<div class="min-w-0 flex-1">
												<p class="truncate text-sm font-medium">{fullName}</p>
												{#if assignee.role}
													<p class="text-xs text-muted-foreground">{assignee.role}</p>
												{/if}
											</div>
											<!-- Online dot stub -->
											<span class="h-2 w-2 shrink-0 rounded-full bg-emerald-400" title="Online"></span>
											<button type="button" class="hidden shrink-0 text-muted-foreground hover:text-destructive group-hover:block" onclick={() => handleRemoveAssignee(assignee.userId)}>
												<X class="h-3.5 w-3.5" />
											</button>
										</div>
									{/each}
									{#if assigneeOptions.length > 0}
										<Popover.Root bind:open={addAssigneeOpen}>
											<Popover.Trigger>
												{#snippet child({ props })}
													<button {...props} type="button" class="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/50">
														<Plus class="h-4 w-4" /> Adaugă membru
													</button>
												{/snippet}
											</Popover.Trigger>
											<Popover.Content class="w-64 p-2">
												<div class="max-h-48 overflow-y-auto space-y-0.5">
													{#each assigneeOptions as opt}
														<button type="button" class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent" onclick={() => handleAddAssignee(opt.value)}>
															<div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
																{getInitials(opt.label)}
															</div>
															{opt.label}
														</button>
													{/each}
												</div>
											</Popover.Content>
										</Popover.Root>
									{/if}
								</div>
							</details>

							<!-- MATERIALE card -->
							<details bind:open={materialsOpen} class="overflow-hidden rounded-xl border bg-white shadow-sm">
								<summary class="flex cursor-pointer select-none list-none items-center justify-between p-4 text-sm font-semibold">
									<span class="flex items-center gap-2">
										<Link class="h-4 w-4 text-muted-foreground" />
										Materiale ({taskMaterials.length})
									</span>
									<ChevronLeft class="h-4 w-4 text-muted-foreground transition-transform md:hidden {materialsOpen ? '-rotate-90' : 'rotate-180'}" />
								</summary>
								<div class="px-4 pb-4 space-y-3">
									<div class="flex gap-1 rounded-lg bg-slate-100 p-1">
										{#each [['all','Toate'],['img','Foto'],['vid','Video'],['doc','Docs']] as [tab, label]}
											<button
												type="button"
												class="flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors {materialsTab === tab ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}"
												onclick={() => (materialsTab = tab as any)}
											>{label}</button>
										{/each}
									</div>
									{#if filteredMaterials.length === 0}
										<p class="text-xs text-muted-foreground">Niciun material.</p>
									{:else}
										<div class="space-y-1.5">
											{#each filteredMaterials as mat}
												{@const Icon = MATERIAL_TYPE_ICONS[mat.materialType] || FileText}
												<div class="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
													<Icon class="h-4 w-4 shrink-0 text-muted-foreground" />
													<div class="min-w-0 flex-1">
														{#if mat.materialExternalUrl}
															<a href={mat.materialExternalUrl} target="_blank" rel="noopener noreferrer" class="block truncate text-xs font-medium hover:text-primary">{mat.materialTitle}</a>
														{:else}
															<p class="truncate text-xs font-medium">{mat.materialTitle}</p>
														{/if}
														<p class="text-xs text-muted-foreground capitalize">{mat.materialType}</p>
													</div>
													<button type="button" class="hidden shrink-0 text-muted-foreground hover:text-destructive group-hover:block" onclick={() => handleUnlinkMaterial(mat.materialId)}>
														<Unlink class="h-3.5 w-3.5" />
													</button>
												</div>
											{/each}
										</div>
									{/if}
									<Popover.Root bind:open={materialPickerOpen}>
										<Popover.Trigger>
											{#snippet child({ props })}
												<button {...props} type="button" class="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50">
													<Plus class="h-3.5 w-3.5" /> Atașează material existent
												</button>
											{/snippet}
										</Popover.Trigger>
										<Popover.Content class="w-72 p-0" align="start">
											<div class="border-b p-3">
												<Input type="text" placeholder="Caută materiale..." bind:value={materialSearchTerm} class="h-8 text-sm" />
											</div>
											<div class="max-h-[200px] overflow-y-auto">
												{#if filteredAvailableMaterials.length === 0}
													<p class="p-3 text-sm text-muted-foreground">{materialSearchTerm ? 'Niciun material găsit.' : 'Nu există materiale disponibile.'}</p>
												{:else}
													{#each filteredAvailableMaterials as mat}
														{@const Icon = MATERIAL_TYPE_ICONS[mat.type] || FileText}
														<button class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50" onclick={() => handleLinkMaterial(mat.id)} disabled={linkingMaterialId === mat.id}>
															<Icon class="h-4 w-4 shrink-0 text-muted-foreground" />
															<span class="flex-1 truncate">{mat.title}</span>
															<Badge variant="outline" class="shrink-0 text-xs">{mat.type}</Badge>
														</button>
													{/each}
												{/if}
											</div>
										</Popover.Content>
									</Popover.Root>
								</div>
							</details>

							<!-- ACTIVITATE card -->
							<details bind:open={activityOpen} class="overflow-hidden rounded-xl border bg-white shadow-sm">
								<summary class="flex cursor-pointer select-none list-none items-center justify-between p-4 text-sm font-semibold">
									<span class="flex items-center gap-2">
										<History class="h-4 w-4 text-muted-foreground" />
										Activitate ({activities.length})
									</span>
									<ChevronLeft class="h-4 w-4 text-muted-foreground transition-transform {activityOpen ? '-rotate-90' : 'rotate-180'}" />
								</summary>
								<div class="px-4 pb-4">
									{#if activities.length === 0}
										<p class="text-sm text-muted-foreground">Nicio activitate înregistrată.</p>
									{:else}
										<div class="relative max-h-[300px] overflow-y-auto">
											<div class="absolute top-0 bottom-0 left-[15px] w-px bg-border"></div>
											<div class="space-y-3">
												{#each activities as activity}
													{@const actorName = activity.userName || userMap.get(activity.userId) || activity.userId}
													<div class="relative flex items-start gap-3">
														<div class="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full {getActivityIconColor(activity.action)}">
															{#if activity.action === 'created'}
																<Plus class="h-3 w-3" />
															{:else if activity.action === 'commented'}
																<MessageSquare class="h-3 w-3" />
															{:else if activity.action === 'approved'}
																<Check class="h-3 w-3" />
															{:else if activity.action === 'rejected'}
																<X class="h-3 w-3" />
															{:else if activity.action === 'status_changed'}
																<ArrowRight class="h-3 w-3" />
															{:else if activity.action === 'assigned'}
																<UserCheck class="h-3 w-3" />
															{:else}
																<RefreshCw class="h-3 w-3" />
															{/if}
														</div>
														<div class="min-w-0 flex-1 pt-0.5">
															<p class="text-xs">
																<span class="font-medium">{actorName}</span>
																<span class="text-muted-foreground"> {getActivityVerb(activity)}</span>
															</p>
															{#if activity.oldValue || activity.newValue}
																<div class="mt-0.5 flex flex-wrap items-center gap-1">
																	{#if activity.oldValue}
																		<Badge variant="outline" class="text-xs font-normal {getActivityValueColor(activity.field, activity.oldValue)}">{resolveActivityValue(activity.field, activity.oldValue)}</Badge>
																	{/if}
																	{#if activity.oldValue && activity.newValue}
																		<ArrowRight class="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
																	{/if}
																	{#if activity.newValue}
																		<Badge variant="secondary" class="text-xs font-normal {getActivityValueColor(activity.field, activity.newValue)}">{resolveActivityValue(activity.field, activity.newValue)}</Badge>
																	{/if}
																</div>
															{/if}
															<p class="mt-0.5 text-xs text-muted-foreground">{timeAgo(activity.createdAt)}</p>
														</div>
													</div>
												{/each}
											</div>
										</div>
									{/if}
								</div>
							</details>

						</div>
					</aside>
				</div>

				<!-- ══ STICKY FOOTER ══ -->
				<div class="sticky bottom-0 z-20 shrink-0 border-t bg-white px-6 py-3 flex items-center gap-2">
					{#if currentTask.status === 'done' || currentTask.status === 'cancelled'}
						<Button onclick={handleReopen} disabled={approvalLoading} variant="outline">
							<RefreshCw class="mr-2 h-4 w-4" />
							Redeschide task
						</Button>
					{:else if currentTask.status === 'pending-approval'}
						<Button onclick={handleApprove} disabled={approvalLoading}>
							<Check class="mr-2 h-4 w-4" />
							Aprobă
						</Button>
						<Button variant="destructive" onclick={handleReject} disabled={approvalLoading}>
							<X class="mr-2 h-4 w-4" />
							Respinge
						</Button>
					{:else}
						<Button onclick={() => saveField('status', 'done')} class="bg-emerald-600 hover:bg-emerald-700 text-white">
							<Check class="mr-2 h-4 w-4" />
							Marchează ca terminat
						</Button>
					{/if}
				</div>

			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>

<!-- ══ MEET MODAL STUB ══ -->
{#if showMeetModal}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
		onclick={(e) => { if (e.target === e.currentTarget) showMeetModal = false; }}
		onkeydown={(e) => { if (e.key === 'Escape') showMeetModal = false; }}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="w-full max-w-md rounded-2xl bg-white shadow-2xl" onclick={(e) => e.stopPropagation()} onkeydown={() => {}} role="document">
			<div class="flex items-center justify-between border-b px-6 py-4">
				<div class="flex items-center gap-3">
					<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
							<path d="M16 8.5V12.5L20 16V5L16 8.5Z" fill="#00897B"/>
							<path d="M3 6V18C3 18.5523 3.44772 19 4 19H14C14.5523 19 15 18.5523 15 18V14L11 14V6H3Z" fill="#1E88E5"/>
							<path d="M11 6V14H15V10L11 6Z" fill="#FBC02D"/>
							<path d="M15 14L11 10V14H15Z" fill="#E53935"/>
							<path d="M11 6L15 10V6H11Z" fill="#4CAF50"/>
						</svg>
					</div>
					<div>
						<h2 class="text-base font-bold text-gray-900">Programează Google Meet</h2>
						<p class="text-xs text-muted-foreground">Salvează detaliile întâlnirii la task</p>
					</div>
				</div>
				<button type="button" class="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" onclick={() => (showMeetModal = false)}>
					<X class="h-5 w-5" />
				</button>
			</div>
			<div class="space-y-4 px-6 py-4">
				<div class="space-y-1.5">
					<label class="text-sm font-medium" for="meet-title">Titlu meeting</label>
					<Input id="meet-title" type="text" bind:value={meetTitle} placeholder="Titlu meeting" />
				</div>
				<div class="grid grid-cols-3 gap-3">
					<div class="space-y-1.5">
						<label class="text-sm font-medium" for="meet-date">Dată</label>
						<Input id="meet-date" type="date" bind:value={meetDate} />
					</div>
					<div class="space-y-1.5">
						<label class="text-sm font-medium" for="meet-time">Oră</label>
						<Input id="meet-time" type="time" bind:value={meetTime} />
					</div>
					<div class="space-y-1.5">
						<label class="text-sm font-medium" for="meet-duration">Durată</label>
						<select id="meet-duration" bind:value={meetDuration} class="h-9 w-full rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
							<option value="15">15 min</option>
							<option value="30">30 min</option>
							<option value="45">45 min</option>
							<option value="60">1 oră</option>
							<option value="90">1h 30 min</option>
						</select>
					</div>
				</div>
				<div class="space-y-1.5">
					<label class="text-sm font-medium" for="meet-link">Link Google Meet (opțional)</label>
					<Input id="meet-link" type="url" bind:value={meetLink} placeholder="https://meet.google.com/..." />
					<p class="text-xs text-muted-foreground">Lipește linkul Meet generat manual</p>
				</div>
			</div>
			<div class="flex items-center justify-end gap-2 border-t px-6 py-4">
				<Button variant="outline" onclick={() => (showMeetModal = false)}>Anulează</Button>
				<Button onclick={handleSaveMeet} disabled={meetSaving} class="bg-emerald-600 hover:bg-emerald-700 text-white">
					<Check class="mr-2 h-4 w-4" />
					{meetSaving ? 'Se salvează...' : 'Salvează'}
				</Button>
			</div>
		</div>
	</div>
{/if}

<ImageLightbox src={lightboxSrc} open={lightboxOpen} onClose={() => (lightboxOpen = false)} />

<style>
	.comment-display :global(a) { color: hsl(var(--primary)); text-decoration: underline; }
	.comment-display :global(strong) { font-weight: 700; }
	.comment-display :global(p) { margin-bottom: 0.25rem; }
	.comment-display :global(ul),
	.comment-display :global(ol) { padding-left: 1.25rem; margin-bottom: 0.25rem; }
</style>
