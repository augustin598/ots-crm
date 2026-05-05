import { sendTelegramMessage } from './sender';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, ne } from 'drizzle-orm';
import type { TaskAssignedEvent, TaskCompletedEvent } from '$lib/server/plugins/types';

const BASE_URL = 'https://clients.onetopsolution.ro';

const PRIORITY_EMOJI: Record<string, string> = {
	urgent: '🔴',
	high: '🟠',
	medium: '🟡',
	low: '⚪',
};

function buildTaskUrl(tenantSlug: string, taskId: string): string {
	return `${BASE_URL}/${tenantSlug}/tasks/${taskId}`;
}

function formatDate(date: Date | string): string {
	const d = typeof date === 'string' ? new Date(date) : date;
	return d.toISOString().split('T')[0];
}

function escapeMarkdown(text: string): string {
	return text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
}

function stripHtml(html: string): string {
	return html.replace(/<[^>]*>/g, '').trim();
}

export async function notifyTaskAssigned(event: TaskAssignedEvent): Promise<void> {
	if (!event.assignedToUserId || event.assignedToUserId === event.assignedByUserId) return;

	const [taskRow] = await db
		.select({ priority: table.task.priority, dueDate: table.task.dueDate })
		.from(table.task)
		.where(eq(table.task.id, event.taskId))
		.limit(1);

	const priority = taskRow?.priority;
	const dueDate = taskRow?.dueDate;

	const text =
		`📌 *Task atribuit*\n` +
		`"${event.taskTitle}"\n` +
		(priority ? `Prioritate: ${PRIORITY_EMOJI[priority] ?? ''} ${priority}\n` : '') +
		(dueDate ? `Due: ${formatDate(dueDate)}\n` : '') +
		`\n→ ${buildTaskUrl(event.tenantSlug, event.taskId)}`;

	void sendTelegramMessage({
		tenantId: event.tenantId,
		userId: event.assignedToUserId,
		text,
		parseMode: 'Markdown',
	}).catch((err) => console.error('[telegram-task] task.assigned send failed', err));
}

export async function notifyTaskCompleted(event: TaskCompletedEvent): Promise<void> {
	const watchers = await db
		.select({ userId: table.taskWatcher.userId })
		.from(table.taskWatcher)
		.where(
			and(
				eq(table.taskWatcher.taskId, event.taskId),
				eq(table.taskWatcher.tenantId, event.tenantId),
				ne(table.taskWatcher.userId, event.completedByUserId)
			)
		);

	if (watchers.length === 0) return;

	const text =
		`✅ *Task finalizat*\n` +
		`"${event.taskTitle}"\n` +
		`\n→ ${buildTaskUrl(event.tenantSlug, event.taskId)}`;

	for (const watcher of watchers) {
		void sendTelegramMessage({
			tenantId: event.tenantId,
			userId: watcher.userId,
			text,
			parseMode: 'Markdown',
		}).catch((err) =>
			console.error(`[telegram-task] task.completed send failed to ${watcher.userId}`, err)
		);
	}
}

export async function notifyTaskDueSoon(payload: {
	tenantId: string;
	tenantSlug: string;
	taskId: string;
	taskTitle: string;
	assignedToUserId: string | null | undefined;
	dueDate: Date | string | null;
	priority?: string | null;
}): Promise<void> {
	if (!payload.assignedToUserId || !payload.dueDate) return;

	const text =
		`⏰ *Task scadent în <24h*\n` +
		`"${payload.taskTitle}"\n` +
		(payload.priority ? `Prioritate: ${PRIORITY_EMOJI[payload.priority] ?? ''} ${payload.priority}\n` : '') +
		`Due: ${formatDate(payload.dueDate)}\n` +
		`\n→ ${buildTaskUrl(payload.tenantSlug, payload.taskId)}`;

	void sendTelegramMessage({
		tenantId: payload.tenantId,
		userId: payload.assignedToUserId,
		text,
		parseMode: 'Markdown',
	}).catch((err) => console.error('[telegram-task] due_soon send failed', err));
}

export async function notifyTaskMention(payload: {
	tenantId: string;
	tenantSlug: string;
	taskId: string;
	taskTitle: string;
	mentionedUserId: string;
	authorUserId: string;
	authorName: string;
	commentSnippet?: string;
}): Promise<void> {
	if (!payload.mentionedUserId || payload.mentionedUserId === payload.authorUserId) return;

	const snippet = payload.commentSnippet
		? stripHtml(payload.commentSnippet).substring(0, 200)
		: null;

	const text =
		`💬 *${escapeMarkdown(payload.authorName)} te-a menționat*\n` +
		`Task: "${payload.taskTitle}"\n` +
		(snippet ? `\n_${escapeMarkdown(snippet)}_\n` : '') +
		`\n→ ${buildTaskUrl(payload.tenantSlug, payload.taskId)}`;

	void sendTelegramMessage({
		tenantId: payload.tenantId,
		userId: payload.mentionedUserId,
		text,
		parseMode: 'Markdown',
	}).catch((err) => console.error('[telegram-task] mention send failed', err));
}

export async function notifyTaskOverdue(payload: {
	tenantId: string;
	tenantSlug: string;
	adminUserId: string;
	count: number;
	sampleTitles?: string[];
}): Promise<void> {
	const text =
		`🚨 *${payload.count} task${payload.count > 1 ? '-uri' : ''} overdue*\n` +
		(payload.sampleTitles
			? payload.sampleTitles
					.slice(0, 3)
					.map((t) => `• ${t}`)
					.join('\n') + '\n'
			: '') +
		`\n→ ${BASE_URL}/${payload.tenantSlug}/tasks?filter=overdue`;

	void sendTelegramMessage({
		tenantId: payload.tenantId,
		userId: payload.adminUserId,
		text,
		parseMode: 'Markdown',
	}).catch((err) => console.error('[telegram-task] overdue send failed', err));
}
