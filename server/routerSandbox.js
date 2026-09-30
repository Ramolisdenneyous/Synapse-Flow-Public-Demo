import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten';
import { randomInt, randomUUID } from 'node:crypto';

const EXECUTION_TIMEOUT_MS = 75;
const MEMORY_LIMIT_BYTES = 8 * 1024 * 1024;
const MAX_CODE_LENGTH = 24000;

function jsonLiteral(value) {
  return JSON.stringify(value ?? null).replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
}

function validateCode(code) {
  if (typeof code !== 'string' || !code.trim()) {
    throw new Error('The coding agent returned empty router code.');
  }
  if (code.length > MAX_CODE_LENGTH) {
    throw new Error('Generated router code exceeds the size limit.');
  }
  if (code.includes('```')) {
    throw new Error('Generated router code contains a Markdown fence.');
  }
  if (!/\bfunction\s+route\s*\(/.test(code)) {
    throw new Error('Generated code must define function route(input, context, state).');
  }
  if (/\b(?:import|require|eval|Function)\b/.test(code)) {
    throw new Error('Generated router code uses a forbidden capability.');
  }
}

function normalizeResult(value, input, allowedTargetIds) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('route() must return a plain object.');
  }

  const targetIds = Array.isArray(value.targetIds)
    ? [...new Set(value.targetIds.filter((id) => typeof id === 'string'))]
    : null;
  const invalidTarget = targetIds?.find((id) => !allowedTargetIds.has(id));
  if (invalidTarget) {
    throw new Error(`route() selected unconnected target "${invalidTarget}".`);
  }
  if (value.state !== undefined && (
    !value.state ||
    typeof value.state !== 'object' ||
    Array.isArray(value.state)
  )) {
    throw new Error('Router state must be a plain object.');
  }

  return {
    payload: Object.hasOwn(value, 'payload') ? value.payload : input,
    targetIds: value.broadcast ? null : targetIds,
    drop: value.drop === true,
    state: value.state,
  };
}

export async function executeRouterCode({ code, input, context, state = {} }) {
  validateCode(code);
  const QuickJS = await getQuickJS();
  const source = `(() => {
    "use strict";
    const input = ${jsonLiteral(input)};
    const context = ${jsonLiteral(context)};
    const state = ${jsonLiteral(state)};
    ${code}
    if (typeof route !== "function") {
      throw new Error("Generated code did not define route().");
    }
    const result = route(input, context, state);
    if (result && typeof result.then === "function") {
      throw new Error("route() must be synchronous.");
    }
    return JSON.stringify(result);
  })()`;

  let serialized;
  try {
    serialized = QuickJS.evalCode(source, {
      shouldInterrupt: shouldInterruptAfterDeadline(Date.now() + EXECUTION_TIMEOUT_MS),
      memoryLimitBytes: MEMORY_LIMIT_BYTES,
    });
  } catch (error) {
    const message = error?.message === 'interrupted'
      ? 'Router execution exceeded the time limit.'
      : error?.message || 'Router execution failed.';
    throw new Error(message);
  }

  if (typeof serialized !== 'string') {
    throw new Error('route() returned a value that could not be serialized.');
  }

  let value;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error('route() returned invalid JSON data.');
  }

  const allowedTargetIds = new Set((context?.targets || []).map((target) => target.node?.id));
  return normalizeResult(value, input, allowedTargetIds);
}

export function withRouterRuntime(context, runtime = null) {
  return {
    ...context,
    runtime: runtime || {
      invocationId: randomUUID(),
      randomValue: randomInt(0, 0x100000000) / 0x100000000,
    },
  };
}

function requestsRandomness(prompt = '') {
  return /\b(?:random|randomly|dice|die|roll|chance|shuffle|sample|lottery)\b/i.test(prompt);
}

export async function validateGeneratedRouter(result, topology, prompt = '') {
  if (!result || typeof result !== 'object') {
    throw new Error('The coding agent returned an invalid response.');
  }
  if (!Array.isArray(result.tests) || result.tests.length === 0) {
    throw new Error('The coding agent did not provide router tests.');
  }
  if (
    requestsRandomness(prompt) &&
    !/\bcontext\s*\.\s*runtime\s*\.\s*randomValue\b/.test(result.code)
  ) {
    throw new Error('A random router must use context.runtime.randomValue.');
  }

  for (const test of result.tests) {
    const execution = await executeRouterCode({
      code: result.code,
      input: test.input,
      context: withRouterRuntime(topology, {
        invocationId: `test-${test.name}`,
        randomValue: test.randomValue,
      }),
      state: {},
    });
    const actual = execution.drop ? [] : execution.targetIds
      ?? topology.targets.map((target) => target.node.id);
    const expected = [...new Set(test.expectedTargetIds)].sort();
    if (JSON.stringify([...actual].sort()) !== JSON.stringify(expected)) {
      throw new Error(`Generated router failed its "${test.name}" test.`);
    }
  }
}
