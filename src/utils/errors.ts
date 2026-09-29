// ============================================================
// Error Handling — user-understandable errors, no silent failures
// ============================================================

export class KnowledgeBaseError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, code: string, details?: unknown) {
    super(message);
    this.name = 'KnowledgeBaseError';
    this.code = code;
    this.details = details;
  }
}

export const ErrorCodes = {
  DB_WRITE_FAILED: 'DB_WRITE_FAILED',
  DB_READ_FAILED: 'DB_READ_FAILED',
  ASSET_STORAGE_FAILED: 'ASSET_STORAGE_FAILED',
  IMPORT_FILE_CORRUPT: 'IMPORT_FILE_CORRUPT',
  IMPORT_SCHEMA_UNSUPPORTED: 'IMPORT_SCHEMA_UNSUPPORTED',
  IMPORT_JSON_PARSE: 'IMPORT_JSON_PARSE',
  ZIP_EXPORT_FAILED: 'ZIP_EXPORT_FAILED',
  NODE_DELETE_REFERENCED: 'NODE_DELETE_REFERENCED',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION: 'VALIDATION',
} as const;

export function handleError(error: unknown, context: string): string {
  console.error(`[${context}]`, error);
  if (error instanceof KnowledgeBaseError) {
    return error.message;
  }
  if (error instanceof Error) {
    return `${context}: ${error.message}`;
  }
  return `${context}: An unknown error occurred.`;
}

/**
 * Wrap an async operation with error handling.
 * Returns the result or throws a KnowledgeBaseError.
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  context: string,
  code: string
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const message = handleError(error, context);
    throw new KnowledgeBaseError(message, code, error);
  }
}
