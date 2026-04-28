#!/usr/bin/env bun
/**
 * Trimite răspuns WhatsApp lui Augustin cerând detaliile lipsă
 * pentru campania Facebook Ads solicitată pentru beonemedical.ro.
 *
 * Mesajul original: "Vreau o campanie noua pe Facebook ads pe contul
 * beonemedical.ro .. compania vinde echipamente pentru salon"
 * → lipsă: buget, obiectiv, creative, produs specific
 *
 * Usage: cd app && bun scripts/reply-whatsapp-budget-beone.ts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dir, '..', '.env') });

const CRM_URL = process.env.PUBLIC_APP_URL ?? 'https://clients.onetopsolution.ro';
const TENANT_SLUG = 'ots';
const AUGUSTIN_PHONE = '+40757741036';

// Mesaj trimis lui Augustin cerând info lipsă
const MESSAGE = `Salut! Am primit cererea de campanie nouă pentru beonemedical.ro 📋

Ca să lansez campania, am nevoie de câteva detalii:

1️⃣ *Buget zilnic* (ex: 50 RON/zi, 100 RON/zi)
2️⃣ *Produsul/echipamentul* de promovat (ex: DOUBLO GOLD HIFU, alt echipament?)
3️⃣ *Obiectiv* (lead generation / trafic pe site / vânzări)
4️⃣ *Text anunț* - titlu și descriere (sau las eu propunere?)
5️⃣ *Imagine/video* pentru anunț (sau folosim o imagine existentă?)

⚠️ Notă: Contul principal beonemedical.ro (act_818842774503712) este în perioadă de grație – are o factură Meta neplătită. Campaniile vor rula pe contul BeautyOne Ad Account.

Mulțumesc! 🚀`;

async function main() {
	// Apelăm endpoint-ul intern de send WhatsApp prin autentificare session-based
	// Necesită un session cookie valid – alternativ, rulează manual din UI.
	console.log('[info] Mesaj de trimis lui Augustin Constantin (+40757741036):');
	console.log('---');
	console.log(MESSAGE);
	console.log('---');
	console.log('');
	console.log('[action] Trimite manual mesajul de mai sus din CRM → WhatsApp → conversație cu Augustin Constantin');
	console.log(`[action] Sau accesează: ${CRM_URL}/${TENANT_SLUG}/whatsapp`);
	console.log('');
	console.log('[context]');
	console.log('  client_id:       g4gjn3qe6o734r64xiystdst (BEAUTY ONE MEDICAL EUROPA S.R.L.)');
	console.log('  page_id:         105493187556063 (Beauty One Medical)');
	console.log('  ad_account_biz:  act_818842774503712 (beonemedical.ro) → IN_GRACE_PERIOD');
	console.log('  ad_account_ok:   act_1366414974116931 (BeautyOne Ad Account-Primary) → ACTIVE');
	console.log('  augustin_phone:  +40757741036');
	console.log('  alice_phone:     +40724244401 (Alice Beauty One)');
}

main().catch(console.error);
