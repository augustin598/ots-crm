# OTS Connector — WordPress plugin

Permite [OTS CRM](https://clients.onetopsolution.ro) să administreze site-ul WordPress prin API REST semnat HMAC-SHA256.

## Build

```bash
./ots-wp-connector/build.sh
# → ots-wp-connector-v<version>.zip (versiunea e citită din plugin header)
```

Versiunea e mereu în numele ZIP-ului, ca să știi exact ce urci pe WP. ZIP-urile sunt git-ignored.

## Instalare

1. Rulează `build.sh` și ia ZIP-ul rezultat (ex: `ots-wp-connector-v0.2.0.zip`).
2. În WordPress admin: **Plugins → Add New → Upload Plugin**, alege ZIP-ul și activează. (Dacă există o versiune mai veche, dezactivează-o și șterge-o întâi.)
3. Accesează **Settings → OTS Connector**. La prima vizită, pluginul afișează un secret HMAC de 64 caractere hex — copiază-l.
4. În CRM: **WordPress → Adaugă site**, lipește URL-ul site-ului și secretul. (Sau lasă secretul gol, CRM-ul generează unul pe care îl lipești apoi în WP.)

## Endpoint-uri

Toate necesită semnătură HMAC în header-e:

- `X-OTS-Timestamp`: Unix timestamp (secunde)
- `X-OTS-Signature`: `HMAC-SHA256(secret, "${ts}\n${METHOD}\n${path}\n${body}")` în hex

| Rută | Descriere | Fază |
|---|---|---|
| `GET /wp-json/ots-connector/v1/health` | Versiune WP/PHP, SSL expiry, versiune plugin | 1 |
| `GET /wp-json/ots-connector/v1/updates` | Listă core + plugin + theme updates (force-refresh) | 2 |
| `POST /wp-json/ots-connector/v1/updates/apply` | Aplică update-uri (feedback per-item) | 2 |
| `POST /wp-json/ots-connector/v1/backup` | ZIP wp-content + dump SQL în `uploads/ots-backups/` | 2 |

## Roadmap

- **Faza 3**: `/posts` CRUD, `/media` upload, featured image

## Securitate

- Secretul e stocat cu `update_option(..., false)` (nu autoloaded) și nu e niciodată logat.
- Fereastra de timestamp: ±60 secunde (anti-replay).
- Comparație signature cu `hash_equals` (constant-time).
- SSL probe: best-effort, timeout 3s, nu blochează niciodată `/health`.
