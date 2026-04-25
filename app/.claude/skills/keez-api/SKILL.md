---
name: keez-api
description: Comprehensive skill for interacting with the Keez Cloud API. Use this to manage invoices, partners, and items directly via the Keez Public API.
---

# Keez Cloud API Skill

This skill provides specialized knowledge and workflows for the Keez Public API (v1.0).

## Core API Workflows

### 1. Authentication & Tokens
- **Method**: OAuth2 Client Credentials.
- **Scope**: `public-api`.
- **Endpoint**: `https://app.keez.ro/idp/connect/token`.
- **Logic**: Tokens should be cached and only refreshed when close to expiration (typically 3600s).

### 2. Invoice Management
- **Drafts**: New invoices are created as `Draft` (proforma).
- **Validation**: `POST /{clientEid}/invoices/valid` converts a Draft into a Fiscal Invoice. Once validated, it cannot be deleted, only cancelled.
- **Cancellation**: Use `POST /{clientEid}/invoices/canceled`.
- **E-Factura**: Validated invoices can be sent to the Romanian RO e-Factura system via `POST /{clientEid}/invoices/efactura/submitted`.

### 3. Data Mapping Requirements
- **Dates**: Must be `YYYYMMDD` as an integer.
- **County Codes**: Romanian counties use ISO codes (e.g., `RO-B`, `RO-SV`).
- **Currencies**: If the invoice is in a foreign currency (EUR/USD), Keez requires both the original currency values and the RON equivalents (using BNR exchange rate).

## Resources & Reference

### scripts/
- Use scripts for batch operations or complex calculations (e.g., BNR rate fetching, batch invoice validation).

### references/
- **[api_docs.md](references/api_docs.md)**: Full endpoint list and technical specs.
- **[mappers.md](references/mappers.md)**: Specific mapping tables for counties, units of measure, and tax codes.

### assets/
- Templates for CSV imports or common payload structures.

## Integration in this Project
While this skill covers the general Keez Cloud API, this workspace uses a local implementation:
- **Client**: `src/lib/server/plugins/keez/client.ts`
- **Mappers**: `src/lib/server/plugins/keez/mapper.ts`
- **Sync Logic**: `src/lib/server/plugins/keez/sync.ts`
