// LEGACY compatibility only.
// These IDs identify demo/example records created by removed development seeders.
// There is no active product loader that creates new example sets. They are kept
// so already-persisted (old backups / current browser) fake records can be
// recognized and excluded from personal scheduling, calibration, and the Plan
// timeline until the user deletes them. This is NOT a product feature.
export const EXAMPLE_SET_ID = 'nodal-example-semester-v1';
export const RICH_EXAMPLE_SET_ID = 'nodal-example-documents-v2';
export const EXAMPLE_SET_IDS = [EXAMPLE_SET_ID, RICH_EXAMPLE_SET_ID] as const;

export function exampleSetIdForTags(tagIds: string[]): string | undefined {
  return EXAMPLE_SET_IDS.find(id => tagIds.includes(id));
}

export function isExampleNode(tagIds: string[]): boolean {
  return !!exampleSetIdForTags(tagIds);
}
