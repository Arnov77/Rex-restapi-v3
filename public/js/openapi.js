/**
 * useOpenApi() — load and shape the backend's OpenAPI spec.
 *
 * Fastify-Swagger generates `/docs/json` from the Zod schemas attached to
 * each route. We fetch it once, group operations by tag (matching the
 * sidebar nav), and resolve every $ref so consumers don't have to walk
 * the spec manually.
 *
 * "Resolve refs" here means: any `{ $ref: "#/components/schemas/Foo" }`
 * is replaced inline with the looked-up object. We only follow component
 * schemas (the only kind our spec uses); a circular ref would loop, but
 * the spec we generate doesn't have any.
 */

import { reactive, computed } from 'vue';

const state = reactive({
  spec: null,
  loading: false,
  error: null,
});

async function load() {
  state.loading = true;
  state.error = null;
  try {
    const res = await fetch('/docs/json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.spec = await res.json();
  } catch (err) {
    state.error = err.message;
  } finally {
    state.loading = false;
  }
}

/**
 * Walk an arbitrary JSON value and replace local `$ref` strings with the
 * resolved subtree. Operates on a deep clone so the original spec is
 * never mutated. Refs we don't recognize are left untouched.
 *
 * Why depth-limit: zod-derived schemas in our backend are flat (no
 * recursive types), but a future regression could add one. A 32-deep
 * cap is plenty for the real shapes and prevents pathological loops.
 */
function deref(value, root, depth = 0) {
  if (depth > 32) return value;
  if (Array.isArray(value)) return value.map((v) => deref(v, root, depth + 1));
  if (value && typeof value === 'object') {
    if (typeof value.$ref === 'string' && value.$ref.startsWith('#/')) {
      const path = value.$ref.slice(2).split('/');
      let cur = root;
      for (const seg of path) cur = cur?.[seg];
      return cur ? deref(structuredClone(cur), root, depth + 1) : value;
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = deref(v, root, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Flatten `paths` into an array of operations ({ method, path, ...op }),
 * then group by their first tag.
 *
 * Tags come from each route's own `tags: [...]` schema field; the
 * authoritative list of tags (with descriptions) lives in
 * src/plugins/swagger.ts. Not duplicated here — grepping route files or
 * hitting /docs/json is the source of truth if it's ever unclear.
 *
 * The backend hides auth/me/api-keys from /docs/json with `hide: true`,
 * so we don't filter them here — anything that shows up is intended to
 * be in the playground. Operations without a tag fall into a synthetic
 * "other" bucket; today nothing should land there.
 */
const groups = computed(() => {
  if (!state.spec) return [];
  const root = state.spec;
  const buckets = new Map(); // tag -> Operation[]

  for (const [path, methods] of Object.entries(root.paths ?? {})) {
    for (const [method, opRaw] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) continue;

      const op = deref(opRaw, root);
      const tag = (op.tags && op.tags[0]) || 'other';

      if (!buckets.has(tag)) buckets.set(tag, []);

      buckets.get(tag).push({
        method: method.toUpperCase(),
        path,
        operationId: op.operationId,
        summary: op.summary || '',
        description: op.description || '',
        parameters: op.parameters || [],
        requestBody: op.requestBody || null,
        security: op.security || [],
        responses: op.responses || {},
      });
    }
  }

  return [...buckets.entries()]
    .sort(([tagA], [tagB]) =>
      tagA.localeCompare(tagB, undefined, { sensitivity: 'base' }),
    )
    .map(([tag, ops]) => ({
      tag,
      ops: ops.sort((a, b) =>
        a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }) ||
        a.method.localeCompare(b.method, undefined, { sensitivity: 'base' }),
      ),
    }));
});

const securitySchemes = computed(() => state.spec?.components?.securitySchemes ?? {});

const totalEndpoints = computed(() =>
  groups.value.reduce((sum, g) => sum + g.ops.length, 0),
);

export function useOpenApi() {
  return { state, groups, securitySchemes, totalEndpoints, load };
}
