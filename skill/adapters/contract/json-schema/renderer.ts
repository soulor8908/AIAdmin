// adapters/contract/json-schema/renderer.ts —— JSON Schema 渲染器
// P0-2 产出：把契约元模型 (YAML) 渲染为 JSON Schema (Draft 07)。
//
// 适用：跨语言、契约测、OpenAPI 嵌入。
// 类型映射直接对应 JSON Schema 类型系统。

import { readFileSync, readdirSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ContractSchemaMeta,
  ContractFieldMeta,
  RenderContractInput,
  RenderContractResult,
  WriteOp,
  Confidence,
} from '../../../spi/adapter.js';

interface FieldMetaInternal extends ContractFieldMeta {
  enum_values_ref?: string;
  ref?: string;
}

interface SchemaMetaInternal extends ContractSchemaMeta {
  fields?: FieldMetaInternal[];
}

interface MetaFile {
  schemas: SchemaMetaInternal[];
}

export async function renderContract(input: RenderContractInput): Promise<RenderContractResult> {
  const metaFiles = findMetaFiles(input.out_dir);
  const allSchemas = new Map<string, SchemaMetaInternal>();
  for (const f of metaFiles) {
    const parsed = parseYaml(readFileSync(f, 'utf8')) as MetaFile;
    for (const s of parsed.schemas ?? []) {
      allSchemas.set(s.name, s);
    }
  }
  for (const s of input.schemas as SchemaMetaInternal[]) {
    allSchemas.set(s.name, s);
  }

  const writes: WriteOp[] = [];
  const unsupported: string[] = [];
  let confidence: Confidence = 1;

  // 单文件：所有 schema 聚合为一个 definitions 容器
  const definitions: Record<string, unknown> = {};
  for (const schema of allSchemas.values()) {
    const { schema: rendered, unsupported: schemaUnsupported, confidence: schemaConf } = renderSchema(schema, allSchemas);
    if (schemaUnsupported.length) unsupported.push(...schemaUnsupported);
    confidence = Math.min(confidence, schemaConf);
    definitions[schema.name] = rendered;
  }

  const doc = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://ai-spec.dev/schemas/contracts.json',
    title: 'AI Spec Contracts',
    definitions,
  };

  writes.push({
    path: join(input.out_dir, 'rendered', 'json-schema', 'contracts.json'),
    content: JSON.stringify(doc, null, 2) + '\n',
    is_new: true,
    reason: 'P0-2 JSON Schema 渲染：聚合定义',
  });

  return { writes, confidence, unsupported_types: [...new Set(unsupported)] };
}

function renderSchema(
  schema: SchemaMetaInternal,
  all: Map<string, SchemaMetaInternal>,
): { schema: unknown; unsupported: string[]; confidence: number } {
  const unsupported: string[] = [];
  let confidence = 1;

  if (schema.kind === 'enum') {
    if (!schema.enum_values?.length) {
      return {
        schema: { type: 'string', enum: [], description: 'ERROR: enum 缺少 enum_values' },
        unsupported,
        confidence: 0.3,
      };
    }
    return {
      schema: {
        type: 'string',
        enum: schema.enum_values,
        description: schema.description,
      },
      unsupported,
      confidence,
    };
  }

  if (schema.kind === 'object') {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const field of schema.fields ?? []) {
      const { schema: fieldSchema, unsupported: fieldUnsupported, confidence: fieldConf } = renderField(field, all);
      if (fieldUnsupported) unsupported.push(...fieldUnsupported);
      if (fieldConf < confidence) confidence = fieldConf;
      properties[field.name] = fieldSchema;
      if (!field.optional && field.default == null) required.push(field.name);
    }
    const result: Record<string, unknown> = {
      type: 'object',
      properties,
      required,
      additionalProperties: schema.strict ? false : true,
    };
    if (schema.description) result.description = schema.description;
    if (schema.extends) {
      // extends：用 allOf 引用父 schema
      result.allOf = [{ $ref: `#/definitions/${schema.extends}` }];
    }
    return { schema: result, unsupported, confidence };
  }

  unsupported.push(`${schema.kind}`);
  return { schema: { description: `不支持的 kind: ${schema.kind}` }, unsupported, confidence: 0.5 };
}

function renderField(
  field: FieldMetaInternal,
  all: Map<string, SchemaMetaInternal>,
): { schema: unknown; unsupported?: string[]; confidence: number } {
  const unsupported: string[] = [];
  let confidence = 1;
  let fieldSchema: Record<string, unknown> = {};

  switch (field.type) {
    case 'string':
    case 'email':
      fieldSchema.type = 'string';
      fieldSchema.format = field.type === 'email' ? 'email' : undefined;
      if (field.min != null) fieldSchema.minLength = field.min;
      if (field.max != null) fieldSchema.maxLength = field.max;
      break;
    case 'number':
      fieldSchema.type = /page|size|total|version|count/i.test(field.name) ? 'integer' : 'number';
      if (field.min_value != null) fieldSchema.minimum = field.min_value;
      if (field.max_value != null) fieldSchema.maximum = field.max_value;
      break;
    case 'boolean':
      fieldSchema.type = 'boolean';
      break;
    case 'uuid':
      fieldSchema.type = 'string';
      fieldSchema.format = 'uuid';
      break;
    case 'datetime':
      fieldSchema.type = 'string';
      fieldSchema.format = 'date-time';
      break;
    case 'enum':
      if (field.enum_values && field.enum_values.length) {
        fieldSchema.type = 'string';
        fieldSchema.enum = field.enum_values;
      } else if (field.enum_values_ref) {
        fieldSchema.$ref = `#/definitions/${field.enum_values_ref}`;
      } else {
        fieldSchema.description = 'ERROR: enum 字段缺 enum_values / enum_values_ref';
        confidence = 0.3;
      }
      break;
    case 'array':
      if (field.items) {
        const inner = renderField(field.items as FieldMetaInternal, all);
        if (inner.unsupported) unsupported.push(...inner.unsupported);
        if (inner.confidence < confidence) confidence = inner.confidence;
        fieldSchema.type = 'array';
        fieldSchema.items = inner.schema;
      } else {
        fieldSchema.type = 'array';
        fieldSchema.items = {};
        confidence = 0.6;
      }
      break;
    case 'ref':
      if (field.ref) {
        fieldSchema.$ref = `#/definitions/${field.ref}`;
      } else {
        fieldSchema.description = 'ERROR: ref 字段缺 ref';
        confidence = 0.3;
      }
      break;
    default:
      fieldSchema.description = `不支持的类型: ${field.type}`;
      unsupported.push(field.type);
      confidence = 0.5;
  }

  if (field.nullable) fieldSchema.nullable = true;
  if (field.default != null) fieldSchema.default = field.default;
  if (field.description) fieldSchema.description = (fieldSchema.description ?? '') + ' ' + field.description;

  return { schema: fieldSchema, unsupported, confidence };
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function findMetaFiles(dir: string): string[] {
  const candidates = [
    join(__dirname, '..', 'samples'),
    join(dir, '..', 'samples'),
  ];
  for (const samplesDir of candidates) {
    try {
      return readdirSync(samplesDir)
        .filter((f: string) => f.endsWith('.meta.yaml'))
        .map((f: string) => join(samplesDir, f));
    } catch {
      continue;
    }
  }
  return [];
}
