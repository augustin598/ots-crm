/**
 * Acces cu parolă pentru paginile publice (deocamdată doar catalogul de servicii
 * de la `/servicii`).
 *
 * Model: pagina e servită oricui de pe internet, dar conținutul apare doar după
 * introducerea unei parole comune, setată din CRM (`/ots/services` → tab „Pagina
 * publică"). Nu există conturi, nu există sesiuni în DB — deblocarea se
 * materializează într-un cookie semnat HMAC.
 *
 * Cookie: `v1.<expiresAtMs>.<hmacHex>`, unde
 *   hmac = HMAC-SHA256(cookieSecret, `${pageKey}|${expiresAtMs}`)
 * `cookieSecret` stă doar pe server și se rotește la fiecare schimbare de parolă,
 * deci schimbarea (sau ștergerea) parolei invalidează instant toate cookie-urile
 * emise anterior. Nu se scrie nimic în DB la deblocare → zero cost pe vizitator.
 *
 * Ce NU e: un mecanism de autentificare pentru date sensibile. E un zid pentru
 * conținut comercial (prețuri), nu pentru date personale. Datele clienților nu
 * ajung niciodată pe pagina publică.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { hash, verify } from '@node-rs/argon2';
import { and, eq } from 'drizzle-orm';
import { encodeBase32LowerCase, encodeBase64url } from '@oslojs/encoding';
import { env } from '$env/dynamic/private';
import { db } from './db';
import * as table from './db/schema';

export type PublicPageKey = 'services';

export const PUBLIC_SERVICES_PAGE_KEY: PublicPageKey = 'services';

/** Durata de valabilitate a cookie-ului de deblocare. */
export const GATE_COOKIE_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 zile

/** Aceiași parametri ca la login (`/login`) — vezi routes/login/+page.server.ts. */
const ARGON2_OPTS = {
	memoryCost: 19456,
	timeCost: 2,
	outputLen: 32,
	parallelism: 1
} as const;

/**
 * Hash argon2 valid pentru o valoare pe care nu o știe nimeni. Verificăm față de
 * el când pagina nu are parolă setată, ca timpul de răspuns să fie identic cu al
 * unei verificări reale (fără oracol de tip „pagina asta n-are parolă").
 */
const DUMMY_PASSWORD_HASH =
	'$argon2id$v=19$m=19456,t=2,p=1$T58y5z0wtbga9hRhorKsLQ$XOlhfsj/xPXFFHYggvSYg8KMHaAKiWKdCLITm3RJzjw';

export type PublicPageAccessRow = typeof table.publicPageAccess.$inferSelect;

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

function generateCookieSecret(): string {
	return encodeBase64url(crypto.getRandomValues(new Uint8Array(32)));
}

// ============================ Tenant public ============================

/**
 * Tenantul „proprietar" al site-ului public. Paginile publice nu au prefix de
 * tenant în URL, deci îl rezolvăm din env (default 'ots'), la fel ca
 * `/pachete-hosting`. Cache 5 minute — un rename de slug nu trebuie să țină
 * pagina publică jos până la următorul restart.
 */
const PUBLIC_TENANT_SLUG = env.PUBLIC_SITE_TENANT_SLUG ?? env.PUBLIC_HOSTING_TENANT_SLUG ?? 'ots';
const TENANT_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedTenantId: string | null = null;
let cachedTenantAt = 0;

export async function resolvePublicTenantId(): Promise<string> {
	const now = Date.now();
	if (cachedTenantId && now - cachedTenantAt < TENANT_CACHE_TTL_MS) return cachedTenantId;

	const [row] = await db
		.select({ id: table.tenant.id })
		.from(table.tenant)
		.where(eq(table.tenant.slug, PUBLIC_TENANT_SLUG))
		.limit(1);

	if (!row) {
		throw new Error(`Tenant public „${PUBLIC_TENANT_SLUG}" nu există`);
	}

	cachedTenantId = row.id;
	cachedTenantAt = now;
	return row.id;
}

// ============================ Citire / scriere ============================

export async function getPublicPageAccess(
	tenantId: string,
	pageKey: PublicPageKey
): Promise<PublicPageAccessRow | null> {
	const [row] = await db
		.select()
		.from(table.publicPageAccess)
		.where(
			and(eq(table.publicPageAccess.tenantId, tenantId), eq(table.publicPageAccess.pageKey, pageKey))
		)
		.limit(1);
	return row ?? null;
}

/**
 * Setează (sau schimbă) parola paginii. Rotește `cookieSecret` → toate
 * cookie-urile emise cu parola veche devin invalide.
 */
export async function setPublicPagePassword(opts: {
	tenantId: string;
	pageKey: PublicPageKey;
	password: string;
	userId: string | null;
	/** Activează pagina odată cu setarea parolei (default: da). */
	enable?: boolean;
}): Promise<void> {
	const passwordHash = await hash(opts.password, ARGON2_OPTS);
	const cookieSecret = generateCookieSecret();
	const now = new Date();
	const enabled = opts.enable ?? true;

	const existing = await getPublicPageAccess(opts.tenantId, opts.pageKey);

	if (existing) {
		await db
			.update(table.publicPageAccess)
			.set({
				passwordHash,
				cookieSecret,
				passwordUpdatedAt: now,
				enabled,
				updatedByUserId: opts.userId,
				updatedAt: now
			})
			.where(
				and(
					eq(table.publicPageAccess.id, existing.id),
					eq(table.publicPageAccess.tenantId, opts.tenantId)
				)
			);
		return;
	}

	await db.insert(table.publicPageAccess).values({
		id: generateId(),
		tenantId: opts.tenantId,
		pageKey: opts.pageKey,
		enabled,
		passwordHash,
		cookieSecret,
		passwordUpdatedAt: now,
		updatedByUserId: opts.userId,
		createdAt: now,
		updatedAt: now
	});
}

/** Pornește/oprește pagina publică fără a atinge parola. */
export async function setPublicPageEnabled(opts: {
	tenantId: string;
	pageKey: PublicPageKey;
	enabled: boolean;
	userId: string | null;
}): Promise<{ ok: boolean; reason?: 'no-password' }> {
	const existing = await getPublicPageAccess(opts.tenantId, opts.pageKey);

	// Fără parolă setată nu se poate activa — altfel pagina ar rămâne deschisă
	// oricui, ceea ce e exact opusul a ce s-a cerut.
	if (opts.enabled && !existing?.passwordHash) {
		return { ok: false, reason: 'no-password' };
	}

	const now = new Date();

	if (!existing) {
		await db.insert(table.publicPageAccess).values({
			id: generateId(),
			tenantId: opts.tenantId,
			pageKey: opts.pageKey,
			enabled: opts.enabled,
			updatedByUserId: opts.userId,
			createdAt: now,
			updatedAt: now
		});
		return { ok: true };
	}

	await db
		.update(table.publicPageAccess)
		.set({ enabled: opts.enabled, updatedByUserId: opts.userId, updatedAt: now })
		.where(
			and(
				eq(table.publicPageAccess.id, existing.id),
				eq(table.publicPageAccess.tenantId, opts.tenantId)
			)
		);
	return { ok: true };
}

/**
 * Șterge parola și dezactivează pagina. Rotește secretul, deci sesiunile
 * publice deschise mor imediat.
 */
export async function clearPublicPagePassword(opts: {
	tenantId: string;
	pageKey: PublicPageKey;
	userId: string | null;
}): Promise<void> {
	const existing = await getPublicPageAccess(opts.tenantId, opts.pageKey);
	if (!existing) return;

	const now = new Date();
	await db
		.update(table.publicPageAccess)
		.set({
			passwordHash: null,
			cookieSecret: null,
			passwordUpdatedAt: null,
			enabled: false,
			updatedByUserId: opts.userId,
			updatedAt: now
		})
		.where(
			and(
				eq(table.publicPageAccess.id, existing.id),
				eq(table.publicPageAccess.tenantId, opts.tenantId)
			)
		);
}

/**
 * Verifică parola introdusă de vizitator. Rulează argon2 și când pagina nu are
 * parolă (față de un hash fictiv), ca timpii de răspuns să nu difere.
 */
export async function verifyPublicPagePassword(
	row: PublicPageAccessRow | null,
	password: string
): Promise<boolean> {
	const valid = await verify(row?.passwordHash ?? DUMMY_PASSWORD_HASH, password, ARGON2_OPTS);
	return Boolean(row?.passwordHash) && valid;
}

// ============================ Cookie (HMAC) ============================

export function gateCookieName(pageKey: PublicPageKey): string {
	return `ots_pub_${pageKey}`;
}

/** Semnătura pentru un token de deblocare. Exportată pentru teste. */
export function signGateToken(
	cookieSecret: string,
	pageKey: PublicPageKey,
	expiresAtMs: number
): string {
	const sig = createHmac('sha256', cookieSecret)
		.update(`${pageKey}|${expiresAtMs}`)
		.digest('hex');
	return `v1.${expiresAtMs}.${sig}`;
}

/**
 * Validează un token de deblocare. Exportată pentru teste.
 * Returnează `false` pentru: format greșit, versiune necunoscută, expirat,
 * semnătură greșită (comparație în timp constant) sau secret lipsă.
 */
export function verifyGateToken(
	cookieSecret: string | null | undefined,
	pageKey: PublicPageKey,
	token: string | null | undefined,
	now: number = Date.now()
): boolean {
	if (!cookieSecret || !token) return false;

	const parts = token.split('.');
	if (parts.length !== 3) return false;
	const [version, expRaw, sigHex] = parts;
	if (version !== 'v1') return false;

	const expiresAtMs = Number(expRaw);
	if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= now) return false;

	const expected = createHmac('sha256', cookieSecret)
		.update(`${pageKey}|${expiresAtMs}`)
		.digest();
	// `sigHex` vine de la client: dacă nu e hex valid, Buffer.from îl trunchiază,
	// deci verificăm explicit forma înainte de comparație.
	if (!/^[0-9a-f]{64}$/.test(sigHex)) return false;
	const provided = Buffer.from(sigHex, 'hex');
	if (provided.length !== expected.length) return false;

	return timingSafeEqual(provided, expected);
}

/** Emite cookie-ul de deblocare pe răspunsul curent. */
export function issueGateCookie(
	event: RequestEvent,
	pageKey: PublicPageKey,
	cookieSecret: string
): void {
	const expiresAtMs = Date.now() + GATE_COOKIE_MAX_AGE_SEC * 1000;
	event.cookies.set(gateCookieName(pageKey), signGateToken(cookieSecret, pageKey, expiresAtMs), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: GATE_COOKIE_MAX_AGE_SEC
	});
}

export function clearGateCookie(event: RequestEvent, pageKey: PublicPageKey): void {
	event.cookies.delete(gateCookieName(pageKey), { path: '/' });
}

/** True dacă requestul curent are un cookie de deblocare valid pentru pagină. */
export function hasValidGateCookie(
	event: RequestEvent,
	pageKey: PublicPageKey,
	row: PublicPageAccessRow | null
): boolean {
	if (!row?.enabled || !row.passwordHash) return false;
	return verifyGateToken(row.cookieSecret, pageKey, event.cookies.get(gateCookieName(pageKey)));
}

/**
 * Poarta pentru endpoint-urile publice (ex. trimiterea unei cereri de ofertă):
 * rezolvă tenantul, citește configurația paginii și verifică cookie-ul.
 * Returnează `null` dacă pagina e închisă sau vizitatorul n-a deblocat-o.
 */
export async function requireUnlockedPublicPage(
	event: RequestEvent,
	pageKey: PublicPageKey
): Promise<{ tenantId: string; row: PublicPageAccessRow } | null> {
	const tenantId = await resolvePublicTenantId();
	const row = await getPublicPageAccess(tenantId, pageKey);
	if (!row?.enabled || !row.passwordHash) return null;
	if (!hasValidGateCookie(event, pageKey, row)) return null;
	return { tenantId, row };
}
