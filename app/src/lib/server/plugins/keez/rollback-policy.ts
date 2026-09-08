/**
 * Rollback după un hook `invoice.created` eșuat: doar dacă factura NU a ajuns
 * în Keez.
 *
 * Context (OTSH 13, 2026-09-04): hook-ul a creat (și validat) documentul în
 * Keez, apoi a picat înainte să scrie `keezExternalId` în CRM. Emitentul
 * (`generateInvoiceFromRecurringTemplate`) a șters rândul CRM și a readus
 * șablonul la data anterioară. Rezultat: o factură fiscală orfană în Keez, pe
 * care sync-ul nocturn a reimportat-o fără legătura cu contul de hosting și fără
 * serie — „OTSH 13", dublura lui OTSH 12 pentru același ciclu.
 *
 * Regula: odată ce Keez a răspuns cu un externalId, rândul CRM se PĂSTREAZĂ
 * (cu legăturile lui), iar eroarea se semnalează; ștergerea e permisă doar cât
 * documentul există numai în CRM.
 */
export function canRollbackCreatedInvoice(invoice: {
	keezExternalId: string | null | undefined;
}): boolean {
	return !invoice.keezExternalId;
}
