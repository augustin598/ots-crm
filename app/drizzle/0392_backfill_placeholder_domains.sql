-- BACKFILL: înlocuim domeniile placeholder `*.hosting-temp.ots` cu domeniul real
-- din `hosting_inquiry.requested_domain` (sau, ca fallback, din primul
-- `hosting_inquiry_item.domain_name` non-null).
--
-- Context: înainte de fix-ul din provision-da.ts (mai 2026), provisioning-ul
-- ignora `requested_domain` și seta `hosting_account.domain` la
-- `{username}.hosting-temp.ots`. UI-ul (pagina Provisioning + drawer + tabel
-- Comenzi) afișează acest domeniu wrong pe conturi vechi. Backfill-ul aliniază
-- DB-ul cu intenția clientului.
--
-- Strategie: doar pentru conturi cu `domain LIKE '%.hosting-temp.ots'` AND
-- un inquiry legat care are `requested_domain` setat. Conturile fără inquiry
-- linked rămân cu placeholder (nu avem ce să le punem).

UPDATE hosting_account
SET domain = (
	SELECT lower(trim(hi.requested_domain))
	FROM hosting_inquiry hi
	WHERE hi.hosting_account_id = hosting_account.id
		AND hi.tenant_id = hosting_account.tenant_id
		AND hi.requested_domain IS NOT NULL
		AND trim(hi.requested_domain) != ''
	ORDER BY hi.created_at DESC
	LIMIT 1
),
updated_at = CURRENT_TIMESTAMP
WHERE domain LIKE '%.hosting-temp.ots'
	AND EXISTS (
		SELECT 1 FROM hosting_inquiry hi
		WHERE hi.hosting_account_id = hosting_account.id
			AND hi.tenant_id = hosting_account.tenant_id
			AND hi.requested_domain IS NOT NULL
			AND trim(hi.requested_domain) != ''
	);
--> statement-breakpoint

-- Fallback secund: dacă `requested_domain` e gol, încearcă primul
-- `hosting_inquiry_item.domain_name` non-null pentru același inquiry.
UPDATE hosting_account
SET domain = (
	SELECT lower(trim(item.domain_name))
	FROM hosting_inquiry hi
	JOIN hosting_inquiry_item item ON item.inquiry_id = hi.id
	WHERE hi.hosting_account_id = hosting_account.id
		AND hi.tenant_id = hosting_account.tenant_id
		AND item.domain_name IS NOT NULL
		AND trim(item.domain_name) != ''
	ORDER BY hi.created_at DESC, item.created_at ASC
	LIMIT 1
),
updated_at = CURRENT_TIMESTAMP
WHERE domain LIKE '%.hosting-temp.ots'
	AND EXISTS (
		SELECT 1 FROM hosting_inquiry hi
		JOIN hosting_inquiry_item item ON item.inquiry_id = hi.id
		WHERE hi.hosting_account_id = hosting_account.id
			AND hi.tenant_id = hosting_account.tenant_id
			AND item.domain_name IS NOT NULL
			AND trim(item.domain_name) != ''
	);
