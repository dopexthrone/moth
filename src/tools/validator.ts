/**
 * Tool input validation against JSON Schema before execution.
 * Parse, don't validate — transform and verify at the boundary.
 */

import type { Tool } from './types.js';

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate tool input against the tool's declared schema.
 * Checks required fields and basic type constraints.
 */
export function validateToolInput(
  tool: Tool,
  input: Record<string, unknown>,
): ValidationResult {
  const errors: string[] = [];
  const schema = tool.inputSchema;

  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (!(field in input) || input[field] === undefined || input[field] === null) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }

  // Check field types
  for (const [key, value] of Object.entries(input)) {
    const propSchema = schema.properties[key] as { type?: string } | undefined;
    if (!propSchema) continue; // extra fields are tolerated

    if (propSchema.type && value !== undefined && value !== null) {
      const actualType = typeof value;
      const expectedType = propSchema.type;

      if (expectedType === 'string' && actualType !== 'string') {
        errors.push(`Field '${key}' expected string, got ${actualType}`);
      }
      if (expectedType === 'number' && actualType !== 'number') {
        errors.push(`Field '${key}' expected number, got ${actualType}`);
      }
      if (expectedType === 'boolean' && actualType !== 'boolean') {
        errors.push(`Field '${key}' expected boolean, got ${actualType}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
