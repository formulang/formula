import type {
  BatchEvaluationCall,
  FormulaError,
  FormulaExecutionContext,
  FormulaNodeOutput,
  FormulaType,
  FormulaValueProvider,
  RuleNode,
} from '@formulang/definitions';
import {
  FormulaErrorCodes,
  FormulaRuntimeError,
  makeError,
  makeFormulaError,
  stripNullability,
} from '@formulang/definitions';
import { isDenylistedPropertyName } from '@formulang/parser';

import type { EvaluateContext, PerNodeMap } from '../evaluate-types';
import { invokeFunctionBatch } from './invoke';
import {
  makeSkippedSubtreeOutput,
  markSkippedSubtree,
  writeNodeError,
  writeNodeValue,
} from './per-node';
import type { RunnerState } from './state';
import { addCostOrThrow, checkWallTime, estimateCallCostUnits } from './state';
import {
  expectedCastForComparison,
  nodeName,
  toExecutionErrorKind,
  toKnownFormulaErrorCode,
  valueKindOf,
} from './value-utils';
import { resolvePropertyValue, resolveRootVariableValueAsync } from './variables';

type ProviderState = {
  node: RuleNode;
  provider: FormulaValueProvider;
  evaluated: boolean;
  cached?: FormulaNodeOutput;
};

function isAllowlistedPropertyAccess(
  targetType: FormulaType | undefined,
  property: string,
): boolean {
  if (!targetType) return false;
  const base = stripNullability(targetType);
  if (base.kind === 'null') return true;
  if (base.kind === 'any' || base.kind === 'template') return false;
  if (base.kind !== 'object') return false;
  return !!base.properties && Object.prototype.hasOwnProperty.call(base.properties, property);
}

function makeProviderForNode(
  node: RuleNode,
  ctx: EvaluateContext,
  state: RunnerState,
  perNode: PerNodeMap,
  errors: FormulaError[],
  expectedCast?: FormulaType,
): ProviderState {
  const ps: ProviderState = {
    node,
    evaluated: false,
    provider: {
      output: async () => {
        if (ps.cached) return ps.cached;
        ps.evaluated = true;
        const out = await evalNodeOutputAsync(node, ctx, state, perNode, errors, expectedCast);
        ps.cached = out;
        return out;
      },
      value: async () => {
        const out = await ps.provider.output();
        return out.value ?? null;
      },
    },
  };
  return ps;
}

export async function evalNodeOutputAsync(
  node: RuleNode,
  ctx: EvaluateContext,
  state: RunnerState,
  perNode: PerNodeMap,
  errors: FormulaError[],
  expectedCast?: FormulaType,
): Promise<FormulaNodeOutput> {
  // Step budget and wall-time checks.
  state.budget.consume(1);
  checkWallTime(state);

  try {
    switch (node.kind) {
      case 'literal': {
        writeNodeValue(node, node.value, ctx.registry, state.limits, perNode);
        return {
          ok: true,
          name: 'literal',
          value: node.value,
          valueKind: valueKindOf(node.value),
          children: [],
          nodeId: node.id,
          span: node.span,
        };
      }

      case 'variable': {
        if (isDenylistedPropertyName(node.name)) {
          const err = makeFormulaError({
            kind: 'security',
            code: FormulaErrorCodes.DENYLISTED_PROPERTY,
            message: `Access denied: ${node.name}`,
            span: node.span,
          });
          errors.push(err);
          writeNodeError(node, err.code, err.message, perNode);
          return makeError('variable', {
            kind: 'security',
            code: err.code,
            message: err.message,
            nodeId: node.id,
            span: node.span,
          });
        }

        const raw = ctx.variables[node.name];
        const value = await resolveRootVariableValueAsync(node.name, raw, ctx, state);
        writeNodeValue(node, value, ctx.registry, state.limits, perNode);
        return {
          ok: true,
          name: node.name,
          value,
          valueKind: valueKindOf(value),
          children: [],
          nodeId: node.id,
          span: node.span,
        };
      }

      case 'property': {
        const objectOut = await evalNodeOutputAsync(node.object, ctx, state, perNode, errors);
        if (isDenylistedPropertyName(node.property)) {
          const err = makeFormulaError({
            kind: 'security',
            code: FormulaErrorCodes.DENYLISTED_PROPERTY,
            message: `Access denied: ${node.property}`,
            span: node.span,
          });
          errors.push(err);
          writeNodeError(node, err.code, err.message, perNode);
          return makeError('property', {
            kind: 'security',
            code: err.code,
            message: err.message,
            nodeId: node.id,
            span: node.span,
            children: [objectOut],
          });
        }

        if (!isAllowlistedPropertyAccess(node.object.type, node.property)) {
          const err = makeFormulaError({
            kind: 'security',
            code: FormulaErrorCodes.PROPERTY_NOT_ALLOWLISTED,
            message: `Access denied: ${node.property}`,
            span: node.span,
          });
          errors.push(err);
          writeNodeError(node, err.code, err.message, perNode);
          return makeError('property', {
            kind: 'security',
            code: err.code,
            message: err.message,
            nodeId: node.id,
            span: node.span,
            children: [objectOut],
          });
        }

        const obj = objectOut.value;
        const value = await resolvePropertyValue(obj, node.property, ctx, state);
        writeNodeValue(node, value, ctx.registry, state.limits, perNode);
        return {
          ok: true,
          name: 'property',
          value,
          valueKind: valueKindOf(value),
          children: [objectOut],
          nodeId: node.id,
          span: node.span,
        };
      }

      case 'wildcard': {
        const objectOut = await evalNodeOutputAsync(node.object, ctx, state, perNode, errors);
        if (isDenylistedPropertyName(node.property)) {
          const err = makeFormulaError({
            kind: 'security',
            code: FormulaErrorCodes.DENYLISTED_PROPERTY,
            message: `Access denied: ${node.property}`,
            span: node.span,
          });
          errors.push(err);
          writeNodeError(node, err.code, err.message, perNode);
          return makeError('wildcard', {
            kind: 'security',
            code: err.code,
            message: err.message,
            nodeId: node.id,
            span: node.span,
            children: [objectOut],
          });
        }

        const obj = objectOut.value;
        if (!Array.isArray(obj)) {
          writeNodeValue(node, null, ctx.registry, state.limits, perNode);
          return {
            ok: true,
            name: 'wildcard',
            value: null,
            valueKind: 'null',
            children: [objectOut],
            nodeId: node.id,
            span: node.span,
          };
        }
        if (obj.length > state.limits.maxListLength) {
          throw new FormulaRuntimeError(
            FormulaErrorCodes.LIST_TOO_LARGE,
            'List is too large',
            'security',
          );
        }

        // Only allow wildcard property access when the element type explicitly allow-lists the property.
        const objType = node.object.type;
        const base = objType ? stripNullability(objType) : undefined;
        const elemType = base && base.kind === 'list' ? stripNullability(base.of) : undefined;
        if (!isAllowlistedPropertyAccess(elemType, node.property)) {
          const err = makeFormulaError({
            kind: 'security',
            code: FormulaErrorCodes.PROPERTY_NOT_ALLOWLISTED,
            message: `Access denied: ${node.property}`,
            span: node.span,
          });
          errors.push(err);
          writeNodeError(node, err.code, err.message, perNode);
          return makeError('wildcard', {
            kind: 'security',
            code: err.code,
            message: err.message,
            nodeId: node.id,
            span: node.span,
            children: [objectOut],
          });
        }

        state.budget.consume(obj.length);
        const mapped = [] as any[];
        for (const item of obj) {
          if (item == null || typeof item !== 'object') {
            mapped.push(null);
            continue;
          }
          mapped.push(await resolvePropertyValue(item, node.property, ctx, state));
        }

        // Flatten one level.
        const flattened: any[] = [];
        for (const v of mapped) {
          if (Array.isArray(v)) {
            if (flattened.length + v.length > state.limits.maxWildcardOutputLength) {
              throw new FormulaRuntimeError(
                FormulaErrorCodes.WILDCARD_OUTPUT_TOO_LARGE,
                'Wildcard expansion is too large',
                'security',
              );
            }
            flattened.push(...v);
          } else {
            if (flattened.length + 1 > state.limits.maxWildcardOutputLength) {
              throw new FormulaRuntimeError(
                FormulaErrorCodes.WILDCARD_OUTPUT_TOO_LARGE,
                'Wildcard expansion is too large',
                'security',
              );
            }
            flattened.push(v);
          }
        }

        writeNodeValue(node, flattened, ctx.registry, state.limits, perNode);
        return {
          ok: true,
          name: 'wildcard',
          value: flattened,
          valueKind: 'list',
          children: [objectOut],
          nodeId: node.id,
          span: node.span,
        };
      }

      case 'call': {
        const signatureId = node.signatureId;
        if (!signatureId) {
          const err = makeFormulaError({
            kind: 'runtime',
            code: FormulaErrorCodes.UNBOUND_FUNCTION,
            message: `Function not bound: ${node.name}`,
            span: node.span,
          });
          errors.push(err);
          writeNodeError(node, err.code, err.message, perNode);
          return makeError(node.name, {
            kind: toExecutionErrorKind(err.kind),
            code: err.code,
            message: err.message,
            signatureId: signatureId,
            nodeId: node.id,
            span: node.span,
          });
        }

        const fn = ctx.registry.getFunction(signatureId);
        if (!fn) {
          const err = makeFormulaError({
            kind: 'runtime',
            code: FormulaErrorCodes.UNKNOWN_FUNCTION,
            message: `Unknown function: ${signatureId}`,
            span: node.span,
          });
          errors.push(err);
          writeNodeError(node, err.code, err.message, perNode);
          return makeError(node.name, {
            kind: toExecutionErrorKind(err.kind),
            code: err.code,
            message: err.message,
            signatureId: signatureId,
            nodeId: node.id,
            span: node.span,
          });
        }

        // Expected-cast propagation hints (used for the node evaluation itself).
        const comparisonExpected = expectedCastForComparison(signatureId);
        const downstreamCast =
          fn.casts && fn.casts.length > 0 && node.args.length === 1 ? fn.returnType : undefined;

        const providerStates: ProviderState[] = [];
        for (let i = 0; i < node.args.length; i++) {
          const paramType = fn.params[i]?.type;
          const argExpected =
            (i === 0 ? downstreamCast : undefined) ?? comparisonExpected ?? paramType;
          providerStates.push(
            makeProviderForNode(node.args[i], ctx, state, perNode, errors, argExpected),
          );
        }

        // For non-control-flow calls, eagerly evaluate args to preserve existing runtime checks.
        if (!fn.controlFlow) {
          for (const ps of providerStates) await ps.provider.output();
        }

        // Enforce nullability for evaluated arguments.
        for (let i = 0; i < providerStates.length; i++) {
          const param = fn.params[i];
          if (!param) continue;
          if (!providerStates[i].evaluated) continue;
          const v = providerStates[i].cached?.value ?? null;
          if (v == null && param.type.nullable !== true && param.type.kind !== 'any') {
            const err = makeFormulaError({
              kind: 'runtime',
              code: FormulaErrorCodes.NULL_NOT_ALLOWED,
              message: `Parameter '${param.name}' does not accept null`,
              span: node.args[i]?.span,
            });
            errors.push(err);
            writeNodeError(node, err.code, err.message, perNode);

            // Mark remaining non-evaluated args as skipped evidence.
            for (const ps of providerStates) {
              if (!ps.evaluated) markSkippedSubtree(ps.node, perNode, new Set<string>());
            }

            return makeError(node.name, {
              kind: toExecutionErrorKind(err.kind),
              code: err.code,
              message: err.message,
              signatureId: signatureId,
              nodeId: node.id,
              span: node.span,
              children: providerStates.map((ps) =>
                ps.evaluated && ps.cached ? ps.cached : makeSkippedSubtreeOutput(ps.node),
              ),
            });
          }
        }

        const execCtx: FormulaExecutionContext = {
          registry: ctx.registry,
          resolver: ctx.resolver,
          variables: ctx.variables,
          limits: state.limits,
          budget: state.budget,
          expectedReturnType: expectedCast,
          cache: state.pureCache,
          pending: state.purePending,
          chargeCall: (calledId, args) =>
            addCostOrThrow(state, estimateCallCostUnits(ctx.resolver, calledId, args)),
        };

        const calls: BatchEvaluationCall[] = [
          {
            args: providerStates.map((ps) => ps.provider),
            expectedCast,
          } as BatchEvaluationCall,
        ];

        const [implOut] = await invokeFunctionBatch(signatureId, fn, calls, execCtx, state);

        // Mark skipped arg subtrees in perNode.
        for (const ps of providerStates) {
          if (!ps.evaluated) markSkippedSubtree(ps.node, perNode, new Set<string>());
        }

        const children = providerStates.map((ps) =>
          ps.evaluated && ps.cached ? ps.cached : makeSkippedSubtreeOutput(ps.node),
        );
        const out: FormulaNodeOutput = {
          ...implOut,
          name: node.name,
          signatureId: signatureId,
          children,
          nodeId: node.id,
          span: node.span,
        };

        const resultValue =
          typeof out.value === 'number' && !Number.isFinite(out.value) ? null : out.value;
        out.value = resultValue;
        if (out.ok) {
          out.valueKind = valueKindOf(out.value);
          writeNodeValue(node, out.value, ctx.registry, state.limits, perNode);
          return out;
        }

        const err = makeFormulaError({
          kind: out.error?.kind ?? 'runtime',
          code: toKnownFormulaErrorCode(out.error?.code),
          message: out.error?.message ?? 'Evaluation error',
          span: node.span,
        });
        errors.push(err);
        writeNodeError(node, err.code, err.message, perNode);
        return out;
      }
    }
  } catch (e) {
    const err = makeFormulaError({
      kind: e instanceof FormulaRuntimeError ? e.kind : 'runtime',
      code: e instanceof FormulaRuntimeError ? e.code : FormulaErrorCodes.EVAL_CRASH,
      message: e instanceof Error ? e.message : 'Evaluation error',
      span: node.span,
    });
    errors.push(err);
    writeNodeError(node, err.code, err.message, perNode);
    return makeError(nodeName(node), {
      kind: toExecutionErrorKind(err.kind),
      code: err.code,
      message: err.message,
      signatureId: node.kind === 'call' ? node.signatureId : undefined,
      nodeId: node.id,
      span: node.span,
      children:
        node.kind === 'call'
          ? node.args.map((a) => makeSkippedSubtreeOutput(a))
          : node.kind === 'property'
            ? [makeSkippedSubtreeOutput(node.object)]
            : node.kind === 'wildcard'
              ? [makeSkippedSubtreeOutput(node.object)]
              : [],
    });
  }
}
