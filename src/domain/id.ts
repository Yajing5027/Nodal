import { v4 as uuidv4 } from 'uuid';
import type { ID } from '../domain/types';

/**
 * Generate a stable, unique ID for any domain entity.
 * Uses uuid v4. These IDs are permanent and travel with export/import.
 */
export function newId(): ID {
  return uuidv4();
}

export function now(): number {
  return Date.now();
}
