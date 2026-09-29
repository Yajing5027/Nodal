// ============================================================
// Migrations — even V0 uses db.version(1) so future migrations are possible
// ============================================================
import type Dexie from 'dexie';
import { schemas } from './schema';

export function applyMigrations(db: Dexie): void {
  // Version 1 — initial schema
  db.version(1).stores(schemas[1]);
  // Version 2 — additive learning layer. Existing knowledge tables and records
  // are untouched; users opt into retrieval targets from their notes.
  db.version(2).stores(schemas[2]);
  // Version 3 — additive plan-assignment layer. Knowledge untouched.
  db.version(3).stores(schemas[3]);
  // Version 4 — additive plan-execution-state layer. Knowledge untouched.
  db.version(4).stores(schemas[4]);
}
