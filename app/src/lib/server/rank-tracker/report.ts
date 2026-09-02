// Agregarea datelor pentru raportul săptămânal + trimiterea alertelor unei rulări.
// Datele sunt serializabile JSON (replay din registry). Comparația „acum vs acum 7
// zile" folosește cel mai recent snapshot desktop și snapshot-ul din urmă cu ~7 zile.
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import {
	visibility,
	distribution,
	positionDelta,
	snapshotAtLookback,
	bucketForPosition,
	isoWeekLabel,
	isoWeekInterval,
	rankDayKey,
	type RankBucket
} from '$lib/logic/rank-tracker';

export {
	renderRankReportBodyHtml,
	renderRankReportText,
	renderRankAlertBodyHtml,
	renderRankAlertText,
	type RankReportData,
	type RankReportRow,
	type RankReportMover,
	type RankAlertEmailData
} from './report-html';
import type { RankReportData, RankReportRow, RankReportMover, RankAlertEmailData } from './report-html';

interface SnapshotLite {
	keywordId: string;
	device: 'desktop' | 'mobile';
	dayKey: string;
	position: number | null;
	aiOverview: 'absent' | 'present' | 'cited';
}
interface ProjectLite {
	id: string;
	domain: string;
	clientName: string | null;
	clientEmail: string | null;
	/** Dispozitivele urmărite; raportul folosește dispozitivul PRINCIPAL al proiectului. */
	devices?: ('desktop' | 'mobile')[];
}
interface KeywordLite {
	id: string;
	projectId: string;
	keyword: string;
}

export interface RankReportDeps {
	loadProjects?: (tenantId: string) => Promise<ProjectLite[]>;
	loadKeywords?: (projectIds: string[]) => Promise<KeywordLite[]>;
	loadSnapshots?: (keywordIds: string[]) => Promise<SnapshotLite[]>;
	loadAlertCounts?: (runProjectIds: string[]) => Promise<Record<string, number>>;
	now?: () => Date;
}

async function defaultLoadProjects(tenantId: string): Promise<ProjectLite[]> {
	return db
		.select({
			id: table.rankProject.id,
			domain: table.rankProject.domain,
			clientName: table.client.name,
			clientEmail: table.client.email,
			devices: table.rankProject.devices
		})
		.from(table.rankProject)
		.leftJoin(
			table.client,
			and(eq(table.rankProject.clientId, table.client.id), eq(table.client.tenantId, tenantId))
		)
		.where(and(eq(table.rankProject.tenantId, tenantId), eq(table.rankProject.active, true)))
		.orderBy(table.rankProject.domain) as Promise<ProjectLite[]>;
}

async function defaultLoadKeywords(projectIds: string[]): Promise<KeywordLite[]> {
	if (!projectIds.length) return [];
	return db
		.select({
			id: table.rankKeyword.id,
			projectId: table.rankKeyword.projectId,
			keyword: table.rankKeyword.keyword
		})
		.from(table.rankKeyword)
		.where(and(inArray(table.rankKeyword.projectId, projectIds), eq(table.rankKeyword.active, true)));
}

async function defaultLoadSnapshots(keywordIds: string[]): Promise<SnapshotLite[]> {
	if (!keywordIds.length) return [];
	return db
		.select({
			keywordId: table.rankSnapshot.keywordId,
			device: table.rankSnapshot.device,
			dayKey: table.rankSnapshot.dayKey,
			position: table.rankSnapshot.position,
			aiOverview: table.rankSnapshot.aiOverview
		})
		.from(table.rankSnapshot)
		.where(inArray(table.rankSnapshot.keywordId, keywordIds))
		.orderBy(desc(table.rankSnapshot.dayKey))
		.limit(keywordIds.length * 45);
}

const avgOrNull = (xs: (number | null)[]): number | null => {
	const nums = xs.filter((x): x is number => x != null);
	return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null;
};

/**
 * Construiește datele raportului săptămânal (desktop ca serie principală).
 * „acum" = cel mai recent snapshot ≤ ziua curentă; „atunci" = ~7 zile în urmă.
 */
export async function buildRankReportData(
	tenantId: string,
	weekKey: string,
	deps: RankReportDeps = {}
): Promise<RankReportData> {
	const loadProjects = deps.loadProjects ?? defaultLoadProjects;
	const loadKeywords = deps.loadKeywords ?? defaultLoadKeywords;
	const loadSnapshots = deps.loadSnapshots ?? defaultLoadSnapshots;
	const now = deps.now ?? (() => new Date());
	const todayKey = rankDayKey(now());

	const projects = await loadProjects(tenantId);
	const keywords = await loadKeywords(projects.map((p) => p.id));
	const snapshots = await loadSnapshots(keywords.map((k) => k.id));

	// Serii per keyword pe DISPOZITIVUL PRINCIPAL al proiectului (desktop dacă e urmărit,
	// altfel mobil). Înainte era hard-codat „desktop": un proiect doar-mobil primea serii
	// goale, deci raportul trimis clientului arăta vizibilitate 0 și totul „100+", deși
	// UI-ul afișa corect pozițiile (`projects-data.ts` avea deja acest fix).
	const primaryDeviceByProject = new Map<string, 'desktop' | 'mobile'>();
	for (const p of projects) {
		const tracked = (p.devices ?? ['desktop']) as ('desktop' | 'mobile')[];
		primaryDeviceByProject.set(p.id, tracked.includes('desktop') ? 'desktop' : 'mobile');
	}
	const projectByKeyword = new Map<string, string>();
	for (const k of keywords) projectByKeyword.set(k.id, k.projectId);

	const seriesByKeyword = new Map<string, SnapshotLite[]>();
	for (const s of snapshots) {
		const projectId = projectByKeyword.get(s.keywordId);
		const primary = projectId ? (primaryDeviceByProject.get(projectId) ?? 'desktop') : 'desktop';
		if (s.device !== primary) continue;
		const arr = seriesByKeyword.get(s.keywordId) ?? [];
		arr.push(s);
		seriesByKeyword.set(s.keywordId, arr);
	}

	const keywordsByProject = new Map<string, KeywordLite[]>();
	for (const k of keywords) {
		const arr = keywordsByProject.get(k.projectId) ?? [];
		arr.push(k);
		keywordsByProject.set(k.projectId, arr);
	}

	const allNow: (number | null)[] = [];
	const allThen: (number | null)[] = [];
	const dist: Record<RankBucket, number> = { '1-3': 0, '4-10': 0, '11-20': 0, '21-50': 0, '51-100': 0, '100+': 0 };
	const movers: RankReportMover[] = [];
	let aiPresent = 0;
	let aiCited = 0;
	let keywordCount = 0;

	const reportRows: RankReportRow[] = [];

	for (const project of projects) {
		const projKeywords = keywordsByProject.get(project.id) ?? [];
		const projNow: (number | null)[] = [];
		const projThen: (number | null)[] = [];
		let projTop3 = 0;
		let projTop10 = 0;
		let projAiCited = 0;

		for (const kw of projKeywords) {
			keywordCount++;
			const series = (seriesByKeyword.get(kw.id) ?? []).filter((s) => s.dayKey <= todayKey);
			const nowSnap = series[0] ?? null; // cel mai recent (desc)
			const nowPos = nowSnap?.position ?? null;
			const thenSnap = snapshotAtLookback(
				series.map((s) => ({ dayKey: s.dayKey, position: s.position })),
				todayKey,
				7,
				3
			);
			const thenPos = thenSnap?.position ?? null;

			projNow.push(nowPos);
			projThen.push(thenPos);
			allNow.push(nowPos);
			allThen.push(thenPos);
			dist[bucketForPosition(nowPos)]++;
			if (nowPos != null && nowPos <= 3) projTop3++;
			if (nowPos != null && nowPos <= 10) projTop10++;
			if (nowSnap?.aiOverview === 'present' || nowSnap?.aiOverview === 'cited') aiPresent++;
			if (nowSnap?.aiOverview === 'cited') {
				aiCited++;
				projAiCited++;
			}

			const { delta, kind } = positionDelta(thenPos, nowPos);
			if (kind === 'up' || kind === 'down') {
				movers.push({ keyword: kw.keyword, device: 'desktop', from: thenPos, to: nowPos, delta });
			}
		}

		const projVis = visibility(projNow);
		const projThenVis = visibility(projThen);
		reportRows.push({
			projectId: project.id,
			domain: project.domain,
			clientName: project.clientName,
			clientEmail: project.clientEmail,
			keywordCount: projKeywords.length,
			avgPosition: avgOrNull(projNow),
			visibility: projVis,
			deltaVisibility: Math.round((projVis - projThenVis) * 10) / 10,
			top3: projTop3,
			top10: projTop10,
			alerts: 0, // completat mai jos din loadAlertCounts
			aiCited: projAiCited
		});
	}

	// Alerte pe săptămână, per proiect (opțional).
	if (deps.loadAlertCounts) {
		const counts = await deps.loadAlertCounts(projects.map((p) => p.id));
		for (const row of reportRows) row.alerts = counts[row.projectId] ?? 0;
	}

	const topUp = movers
		.filter((m) => (m.delta ?? 0) > 0)
		.sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
		.slice(0, 5);
	const topDown = movers
		.filter((m) => (m.delta ?? 0) < 0)
		.sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0))
		.slice(0, 5);

	const vis = visibility(allNow);
	const thenVis = visibility(allThen);
	const alertCount = reportRows.reduce((a, r) => a + r.alerts, 0);

	return {
		weekKey,
		weekLabel: isoWeekLabel(weekKey),
		interval: isoWeekInterval(weekKey),
		projectCount: projects.length,
		keywordCount,
		avgPosition: avgOrNull(allNow),
		visibility: vis,
		deltaVisibility: Math.round((vis - thenVis) * 10) / 10,
		distribution: dist,
		topUp,
		topDown,
		aiPresent,
		aiCited,
		alertCount,
		rows: reportRows
	};
}

export interface RankAlertsDeps {
	loadAlerts?: (
		runId: string
	) => Promise<{ keyword: string; device: 'desktop' | 'mobile'; type: 'drop' | 'out_of_top10' | 'lost'; fromPosition: number | null; toPosition: number | null; delta: number | null }[]>;
	loadRecipients?: (tenantId: string, projectId: string) => Promise<{ domain: string; recipients: string[] }>;
	sendEmail?: (tenantId: string, recipient: string, data: RankAlertEmailData) => Promise<void>;
}

async function defaultLoadAlerts(runId: string) {
	return db
		.select({
			keyword: table.rankKeyword.keyword,
			device: table.rankAlert.device,
			type: table.rankAlert.type,
			fromPosition: table.rankAlert.fromPosition,
			toPosition: table.rankAlert.toPosition,
			delta: table.rankAlert.delta
		})
		.from(table.rankAlert)
		.innerJoin(table.rankKeyword, eq(table.rankAlert.keywordId, table.rankKeyword.id))
		.where(eq(table.rankAlert.runId, runId));
}

async function defaultLoadRecipients(tenantId: string, projectId: string) {
	const [project] = await db
		.select({ domain: table.rankProject.domain, clientId: table.rankProject.clientId })
		.from(table.rankProject)
		.where(and(eq(table.rankProject.id, projectId), eq(table.rankProject.tenantId, tenantId)))
		.limit(1);
	const [settings] = await db
		.select({ recipients: table.rankSettings.recipients, sendToClient: table.rankSettings.sendToClient })
		.from(table.rankSettings)
		.where(eq(table.rankSettings.tenantId, tenantId))
		.limit(1);
	const recipients = new Set<string>((settings?.recipients as string[]) ?? []);
	if (settings?.sendToClient && project?.clientId) {
		const [client] = await db
			.select({ email: table.client.email })
			.from(table.client)
			.where(eq(table.client.id, project.clientId))
			.limit(1);
		if (client?.email) recipients.add(client.email);
	}
	return { domain: project?.domain ?? '', recipients: [...recipients] };
}

async function defaultSendEmail(tenantId: string, recipient: string, data: RankAlertEmailData) {
	const { sendRankAlertEmail } = await import('$lib/server/email');
	await sendRankAlertEmail(tenantId, recipient, data);
}

/** Trimite emailul de alerte pentru o rulare (câte un email per destinatar). */
export async function sendRankAlertsForRun(
	tenantId: string,
	projectId: string,
	runId: string,
	deps: RankAlertsDeps = {}
): Promise<{ sent: number }> {
	const loadAlerts = deps.loadAlerts ?? defaultLoadAlerts;
	const loadRecipients = deps.loadRecipients ?? defaultLoadRecipients;
	const sendEmail = deps.sendEmail ?? defaultSendEmail;

	const alerts = await loadAlerts(runId);
	if (alerts.length === 0) return { sent: 0 };

	const { domain, recipients } = await loadRecipients(tenantId, projectId);
	if (recipients.length === 0) return { sent: 0 };

	const data: RankAlertEmailData = {
		projectDomain: domain,
		count: alerts.length,
		rows: alerts.map((a) => ({
			keyword: a.keyword,
			device: a.device,
			type: a.type,
			from: a.fromPosition,
			to: a.toPosition,
			delta: a.delta
		}))
	};

	let sent = 0;
	for (const recipient of recipients) {
		await sendEmail(tenantId, recipient, data);
		sent++;
	}
	return { sent };
}
