# Keez API Documentation Reference

## Authentication
Keez uses OAuth2 client credentials flow.
- **Token URL**: `https://app.keez.ro/idp/connect/token` (or `https://sandbox.keez.ro/idp/connect/token`)
- **Body**: `grant_type=client_credentials&scope=public-api&client_id=app{applicationId}&client_secret={secret}`
- **Header**: `Authorization: Bearer <token>`

## Base URL
- **Production**: `https://app.keez.ro/api/v1.0/public-api`
- **Sandbox**: `https://sandbox.keez.ro/api/v1.0/public-api`

## Core Endpoints

### Invoices
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/{clientEid}/invoices` | List invoices |
| GET | `/{clientEid}/invoices/{externalId}` | Get invoice details |
| POST | `/{clientEid}/invoices` | Create invoice |
| PUT | `/{clientEid}/invoices/{externalId}` | Update invoice |
| DELETE | `/{clientEid}/invoices?externalId={id}` | Delete draft/proforma |
| POST | `/{clientEid}/invoices/valid` | Validate (convert Draft -> Fiscal) |
| POST | `/{clientEid}/invoices/canceled` | Cancel validated invoice |
| POST | `/{clientEid}/invoices/efactura/submitted` | Send to eFactura |
| GET | `/{clientEid}/invoices/{externalId}/pdf` | Download PDF |
| POST | `/invoices/delivery` | Send via Email |

### Items (Articles)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/{clientEid}/items` | List items |
| GET | `/{clientEid}/items/{externalId}` | Get item details |
| POST | `/{clientEid}/items` | Create item |
| PUT | `/{clientEid}/items/{externalId}` | Update item |

### Partners
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/{clientEid}/partners` | List partners |
| GET | `/{clientEid}/partners/{externalId}` | Get partner details |
| POST | `/{clientEid}/partners` | Create partner |

## Data Models

### Invoice Header (`KeezInvoice`)
- `externalId`: Unique ID in CRM.
- `series`: Invoice series (string).
- `number`: Numeric part of invoice.
- `issueDate`: Integer YYYYMMDD (e.g., 20260424).
- `currencyCode`: "RON", "EUR", etc.
- `status`: "Draft", "Valid", "Cancelled".
- `invoiceDetails`: Array of `KeezInvoiceDetail`.

### Invoice Detail (`KeezInvoiceDetail`)
- `itemName`: Product name.
- `quantity`: Number.
- `unitPrice`: Price before tax.
- `vatPercent`: e.g., 19.
- `netAmount`: Total net for line.
- `vatAmount`: Total VAT for line.
- `grossAmount`: Total gross for line.

### Partner (`KeezPartner`)
- `partnerName`: Name.
- `identificationNumber`: CIF/CUI (e.g., "40015841").
- `taxAttribute`: e.g., "RO".
- `isLegalPerson`: Boolean.
- `countryCode`: ISO code (e.g., "RO").
- `countyCode`: ISO Romanian county (e.g., "RO-SV").
