/**
 * Re-export pentru a păstra dependency direction: `plugins/stripe/*` folosesc
 * `crypto` din SmartBill care e source-of-truth pentru AES-256-GCM per-tenant.
 *
 * Asta evită duplicarea logicii crypto și asigură că dacă SmartBill schimbă
 * algoritmul (gen rotire key derivation), Stripe e automat aliniat.
 */
export { encrypt, decrypt, encryptVerified, DecryptionError } from '../smartbill/crypto';
