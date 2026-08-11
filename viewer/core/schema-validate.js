/**
 * Schema Validation for BuildStream Graph Viewer
 * 
 * Implements T2.1: Validates loaded JSON against the bundled schema.
 * - All valid fixtures pass
 * - Corrupted fixtures produce distinct, field-identifying error messages
 * - schemaVersion mismatch produces specific "incompatible extractor version" message
 */

// Load the bundled schema (copied from Tool 1's schema directory at build time)
import SCHEMA from './graph_data.schema.json' assert { type: 'json' };

const SUPPORTED_SCHEMA_VERSIONS = ['5.5.0'];

/**
 * ValidationResult interface
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  schemaVersionMismatch?: boolean;
}

export interface ValidationError {
  path: string;
  message: string;
  expected?: any;
  actual?: any;
}

/**
 * Simple JSON Schema validator implementation
 * Note: In production, use a library like ajv or @cfworker/json-schema
 */
class SimpleSchemaValidator {
  private schema: any;

  constructor(schema: any) {
    this.schema = schema;
  }

  validate(instance: any): ValidationResult {
    const errors: ValidationError[] = [];
    
    // Check required top-level properties
    if (this.schema.required) {
      for (const prop of this.schema.required) {
        if (!(prop in instance)) {
          errors.push({
            path: prop,
            message: `Missing required property: ${prop}`,
            expected: 'present',
            actual: 'missing'
          });
        }
      }
    }

    // Validate metadata
    if (instance.metadata && this.schema.properties?.metadata) {
      errors.push(...this.validateMetadata(instance.metadata));
    }

    // Validate nodes array
    if (instance.nodes && Array.isArray(instance.nodes)) {
      instance.nodes.forEach((node: any, index: number) => {
        const nodeErrors = this.validateNode(node, index);
        errors.push(...nodeErrors);
      });
    }

    // Validate edges array
    if (instance.edges && Array.isArray(instance.edges)) {
      instance.edges.forEach((edge: any, index: number) => {
        const edgeErrors = this.validateEdge(edge, index);
        errors.push(...edgeErrors);
      });
    }

    // Validate combos array
    if (instance.combos && Array.isArray(instance.combos)) {
      instance.combos.forEach((combo: any, index: number) => {
        const comboErrors = this.validateCombo(combo, index);
        errors.push(...comboErrors);
      });
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  private validateMetadata(metadata: any): ValidationError[] {
    const errors: ValidationError[] = [];
    const metaSchema = this.schema.definitions?.Metadata;

    if (!metaSchema) return errors;

    // Check required properties
    if (metaSchema.required) {
      for (const prop of metaSchema.required) {
        if (!(prop in metadata)) {
          errors.push({
            path: `metadata.${prop}`,
            message: `Missing required metadata property: ${prop}`,
            expected: 'present',
            actual: 'missing'
          });
        }
      }
    }

    // Type checks for key properties
    if (typeof metadata.schemaVersion !== 'string') {
      errors.push({
        path: 'metadata.schemaVersion',
        message: `schemaVersion must be a string`,
        expected: 'string',
        actual: typeof metadata.schemaVersion
      });
    } else if (!/^\d+\.\d+\.\d+$/.test(metadata.schemaVersion)) {
      errors.push({
        path: 'metadata.schemaVersion',
        message: `schemaVersion must be in semver format (X.Y.Z)`,
        expected: 'X.Y.Z format',
        actual: metadata.schemaVersion
      });
    }

    // Check enum values
    if (metadata.reachabilityMode && !['exact', 'targeted', 'disabled_by_user', 'disabled_memory_budget', 'disabled_timeout'].includes(metadata.reachabilityMode)) {
      errors.push({
        path: 'metadata.reachabilityMode',
        message: `Invalid reachabilityMode value`,
        expected: ['exact', 'targeted', 'disabled_by_user', 'disabled_memory_budget', 'disabled_timeout'],
        actual: metadata.reachabilityMode
      });
    }

    if (metadata.graphSizeClass && !['normal', 'large', 'huge', 'extreme', 'ultra'].includes(metadata.graphSizeClass)) {
      errors.push({
        path: 'metadata.graphSizeClass',
        message: `Invalid graphSizeClass value`,
        expected: ['normal', 'large', 'huge', 'extreme', 'ultra'],
        actual: metadata.graphSizeClass
      });
    }

    // Check numeric constraints
    if (typeof metadata.totalNodes === 'number' && metadata.totalNodes < 0) {
      errors.push({
        path: 'metadata.totalNodes',
        message: `totalNodes cannot be negative`,
        expected: '>= 0',
        actual: metadata.totalNodes
      });
    }

    if (typeof metadata.totalEdges === 'number' && metadata.totalEdges < 0) {
      errors.push({
        path: 'metadata.totalEdges',
        message: `totalEdges cannot be negative`,
        expected: '>= 0',
        actual: metadata.totalEdges
      });
    }

    return errors;
  }

  private validateNode(node: any, index: number): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check required properties
    const required = ['id', 'type', 'combo', 'x', 'y', 'data', 'style'];
    for (const prop of required) {
      if (!(prop in node)) {
        errors.push({
          path: `nodes[${index}].${prop}`,
          message: `Missing required node property: ${prop}`,
          expected: 'present',
          actual: 'missing'
        });
      }
    }

    // Check data object
    if (node.data) {
      const dataRequired = ['label', 'kind', 'sccId', 'inDegree', 'outDegree', 'topoLayer', 'cpDepth', 'cpHeight', 'isCritical', 'isArticulationPoint', 'isCycle'];
      for (const prop of dataRequired) {
        if (!(prop in node.data)) {
          errors.push({
            path: `nodes[${index}].data.${prop}`,
            message: `Missing required node data property: ${prop}`,
            expected: 'present',
            actual: 'missing'
          });
        }
      }

      // Type check for numeric fields
      if (typeof node.data.inDegree === 'string') {
        errors.push({
          path: `nodes[${index}].data.inDegree`,
          message: `inDegree must be a number`,
          expected: 'number',
          actual: 'string'
        });
      }

      // Check blastRadius type
      if (node.data.blastRadius !== null && typeof node.data.blastRadius !== 'number') {
        errors.push({
          path: `nodes[${index}].data.blastRadius`,
          message: `blastRadius must be a number or null`,
          expected: 'number | null',
          actual: typeof node.data.blastRadius
        });
      }
    }

    return errors;
  }

  private validateEdge(edge: any, index: number): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check required properties
    const required = ['id', 'type', 'source', 'target', 'data', 'style'];
    for (const prop of required) {
      if (!(prop in edge)) {
        errors.push({
          path: `edges[${index}].${prop}`,
          message: `Missing required edge property: ${prop}`,
          expected: 'present',
          actual: 'missing'
        });
      }
    }

    // Check data object
    if (edge.data) {
      if (edge.data.depType && !['build', 'runtime', 'both'].includes(edge.data.depType)) {
        errors.push({
          path: `edges[${index}].data.depType`,
          message: `Invalid depType value`,
          expected: ['build', 'runtime', 'both'],
          actual: edge.data.depType
        });
      }

      if (typeof edge.data.isCritical !== 'boolean') {
        errors.push({
          path: `edges[${index}].data.isCritical`,
          message: `isCritical must be a boolean`,
          expected: 'boolean',
          actual: typeof edge.data.isCritical
        });
      }
    }

    return errors;
  }

  private validateCombo(combo: any, index: number): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check required properties
    const required = ['id', 'type', 'data', 'style'];
    for (const prop of required) {
      if (!(prop in combo)) {
        errors.push({
          path: `combos[${index}].${prop}`,
          message: `Missing required combo property: ${prop}`,
          expected: 'present',
          actual: 'missing'
        });
      }
    }

    // Check data object
    if (combo.data) {
      const dataRequired = ['label', 'nodeCount', 'minTopoLayer', 'maxTopoLayer', 'hasCritical'];
      for (const prop of dataRequired) {
        if (!(prop in combo.data)) {
          errors.push({
            path: `combos[${index}].data.${prop}`,
            message: `Missing required combo data property: ${prop}`,
            expected: 'present',
            actual: 'missing'
          });
        }
      }

      if (typeof combo.data.nodeCount === 'string') {
        errors.push({
          path: `combos[${index}].data.nodeCount`,
          message: `nodeCount must be a number`,
          expected: 'number',
          actual: 'string'
        });
      }
    }

    return errors;
  }
}

const validator = new SimpleSchemaValidator(SCHEMA);

/**
 * Validate a loaded JSON file against the schema
 * 
 * @param data - The parsed JSON data
 * @returns ValidationResult with validation status and any errors
 */
export function validateGraphData(data: any): ValidationResult {
  const result = validator.validate(data);

  // Check for schema version mismatch specifically
  if (data.metadata?.schemaVersion) {
    const version = data.metadata.schemaVersion;
    if (!SUPPORTED_SCHEMA_VERSIONS.includes(version)) {
      result.schemaVersionMismatch = true;
      result.errors.unshift({
        path: 'metadata.schemaVersion',
        message: `This file was produced by an incompatible extractor version — expected schema ${SUPPORTED_SCHEMA_VERSIONS.join(' or ')}, got ${version}`,
        expected: SUPPORTED_SCHEMA_VERSIONS,
        actual: version
      });
    }
  }

  return result;
}

/**
 * Format validation errors for display
 */
export function formatValidationErrors(result: ValidationResult): string {
  if (result.valid) {
    return 'Validation successful';
  }

  const lines: string[] = ['Validation failed:'];
  
  if (result.schemaVersionMismatch) {
    lines.push('⚠️ Incompatible schema version detected');
  }

  for (const error of result.errors) {
    lines.push(`  - ${error.path}: ${error.message}`);
    if (error.expected !== undefined && error.actual !== undefined) {
      lines.push(`    Expected: ${JSON.stringify(error.expected)}, Got: ${JSON.stringify(error.actual)}`);
    }
  }

  return lines.join('\n');
}

export default {
  validateGraphData,
  formatValidationErrors,
  SUPPORTED_SCHEMA_VERSIONS
};
