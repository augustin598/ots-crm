# OTS Connector — WordPress plugin

Permite [OTS CRM](https://clients.onetopsolution.ro) să administreze site-ul WordPress prin API REST semnat HMAC-SHA256.

## Instalare

1. Zipează directorul `ots-wp-connector` (`zip -r ots-wp-connector.zip ots-wp-connector`).
2. În WordPress admin: **Plugins → Add New → Upload Plugin**, alege ZIP-ul și activează.
3. Accesează **Settings → OTS Connector**. La prima vizită, pluginul afișează un secret HMAC de 64 caractere hex — copiază-l.
4. În CRM: **WordPress → Adaugă site**, lipește URL-ul site-ului și secretul.

## Endpoint-uri (Faza 1)

Toate necesită semnătură HMAC în header-e:

- `X-OTS-Timestamp`: Unix timestamp (secunde)
- `X-OTS-Signature`: `HMAC-SHA256(secret, "${ts}\n${METHOD}\n${path}\n${body}")` în hex

| Rută | Descriere |
|---|---|
| `GET /wp-json/ots-connector/v1/health` | Versiune WP/PHP, SSL expiry, versiune plugin |

## Roadmap

- **Faza 2**: `/updates` (list core/plugin/theme updates), `/updates/apply`, `/backup`
- **Faza 3**: `/posts` CRUD, `/media` upload, featured image

## Securitate

- Secretul e stocat cu `update_option(..., false)` (nu autoloaded) și nu e niciodată logat.
- Fereastra de timestamp: ±60 secunde (anti-replay).
- Comparație signature cu `hash_equals` (constant-time).
- SSL probe: best-effort, timeout 3s, nu blochează niciodată `/health`.
