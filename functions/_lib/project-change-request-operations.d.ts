export function buildProjectChangeProposal(input: {baseConfig: Record<string, unknown>; operations: unknown[]}): {config: Record<string, unknown>; projections: unknown[]; operationCount: number};
export function isProjectChangeOperationConflict(error: unknown): boolean;
