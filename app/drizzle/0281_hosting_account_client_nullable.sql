-- Make hosting_account.client_id nullable so WHMCS import can store unmatched services
-- and let admin assign client manually via UI dropdown. Already applied via libsql rebuild;
-- this file is the journaled record of that change.
-- Reference: see addendum in plan-directadmin (2026-05-12).
SELECT 1;
