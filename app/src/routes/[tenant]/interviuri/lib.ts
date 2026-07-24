// Interviuri — tipuri + helper-e client (mirror al logicii din prototipul Claude Design).

export const IV_MONTHS = [
	'Ianuarie',
	'Februarie',
	'Martie',
	'Aprilie',
	'Mai',
	'Iunie',
	'Iulie',
	'August',
	'Septembrie',
	'Octombrie',
	'Noiembrie',
	'Decembrie'
];

export type StatusSlug = 'admisa' | 'respinsa' | 'in_evaluare';

export const STATUS_LABEL: Record<StatusSlug, string> = {
	admisa: 'Admisă',
	respinsa: 'Respinsă',
	in_evaluare: 'În evaluare'
};

export const STATUS_COLOR: Record<StatusSlug, string> = {
	admisa: '#10b981',
	respinsa: '#ef4444',
	in_evaluare: '#f59e0b'
};

export interface ChannelMeta {
	id: string;
	name: string;
	color: string;
	icon: string;
	isSystem: boolean;
	sortOrder: number;
}

/** Rândul brut întors de getInterviews (canal denormalizat). */
export interface RawInterview {
	id: string;
	nume: string;
	dataInterviu: string; // ISO 'YYYY-MM-DD'
	dataInceput: string | null;
	dataSfarsit: string | null;
	studio: string;
	sursa: string | null;
	status: string;
	observatii: string | null;
	channelId: string;
	channelName: string | null;
	channelColor: string | null;
	channelIcon: string | null;
}

/** Rând îmbogățit cu an/lună derivate + status validat. */
export interface IvRow extends RawInterview {
	status: StatusSlug;
	year: number;
	monthNum: number; // 1-12
	month: string; // nume lună RO
	channel: string; // channelName sau 'Nespecificat'
}

export function enrich(r: RawInterview): IvRow {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(r.dataInterviu);
	const year = m ? +m[1] : 0;
	const monthNum = m ? +m[2] : 1;
	const status = (['admisa', 'respinsa', 'in_evaluare'].includes(r.status)
		? r.status
		: 'in_evaluare') as StatusSlug;
	return {
		...r,
		status,
		year,
		monthNum,
		month: IV_MONTHS[monthNum - 1] ?? '',
		channel: r.channelName ?? 'Nespecificat'
	};
}

/** ISO 'YYYY-MM-DD' → 'dd.mm.yyyy' pentru afișare. */
export function isoToRo(iso: string | null | undefined): string {
	if (!iso) return '';
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
	return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** ISO → yyyymmdd număr pentru comparații/sortare. */
export function dnum(iso: string | null | undefined): number {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
	return m ? +m[1] * 10000 + +m[2] * 100 + +m[3] : 0;
}

/** Zile între două date ISO (null dacă lipsesc). */
export function daysBetween(from: string | null, to: string | null): number | null {
	const a = dnum(from),
		b = dnum(to);
	if (!a || !b) return null;
	const pa = new Date(Math.floor(a / 10000), (Math.floor(a / 100) % 100) - 1, a % 100);
	const pb = new Date(Math.floor(b / 10000), (Math.floor(b / 100) % 100) - 1, b % 100);
	return Math.round((pb.getTime() - pa.getTime()) / 86400000);
}

export function dash(v: string | null | undefined): string {
	return v && v.trim() ? v : '—';
}
