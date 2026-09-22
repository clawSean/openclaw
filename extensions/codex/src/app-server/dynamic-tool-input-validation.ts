import { getPluginToolMeta, type AnyAgentTool } from "openclaw/plugin-sdk/agent-harness-runtime";
import {
  type JsonSchemaObject,
  validateJsonSchemaValue,
} from "openclaw/plugin-sdk/json-schema-runtime";

const INTERNAL_TOOL_EXECUTION_VALIDATION = Symbol.for("openclaw.internalToolExecutionValidation");
const MAX_VALIDATION_ERRORS = 4;
const MAX_VALIDATION_ERROR_CHARS = 160;
const VALIDATION_TRUNCATED_SUFFIX = " [detail truncated]";

export function shouldValidateCodexDynamicToolInput(tool: AnyAgentTool): boolean {
  return getPluginToolMeta(tool)?.mcp?.operation !== "tool";
}

export function assertCodexDynamicToolInputMatchesSchema(params: {
  toolName: string;
  schema: JsonSchemaObject;
  value: unknown;
}): void {
  const validation = validateJsonSchemaValue({
    schema: params.schema,
    cacheKey: `codex-dynamic-tool-input:${params.toolName}:${JSON.stringify(params.schema)}`,
    value: params.value,
  });
  if (validation.ok) {
    return;
  }
  const visibleErrors = validation.errors.slice(0, MAX_VALIDATION_ERRORS);
  const details = visibleErrors
    .map((error) => {
      if (error.text.length <= MAX_VALIDATION_ERROR_CHARS) {
        return error.text;
      }
      return `${error.text.slice(
        0,
        MAX_VALIDATION_ERROR_CHARS - VALIDATION_TRUNCATED_SUFFIX.length,
      )}${VALIDATION_TRUNCATED_SUFFIX}`;
    })
    .join("; ");
  const omitted = validation.errors.length - visibleErrors.length;
  const omittedSuffix = omitted > 0 ? `; ${omitted} more violation(s) omitted` : "";
  throw new Error(`Invalid arguments for tool "${params.toolName}": ${details}${omittedSuffix}.`);
}

export function createCodexDynamicToolValidationControl(params: {
  toolCallId: string;
  validate: (value: unknown) => void;
}): Record<PropertyKey, unknown> {
  return {
    [INTERNAL_TOOL_EXECUTION_VALIDATION]: true,
    toolCallId: params.toolCallId,
    validate: params.validate,
  };
}
