import { h, ref, computed, watch } from 'vue';
import FormField from './FormField.js';
import ResultPane from './ResultPane.js';
import { useAuth } from '../auth.js';

const PRIMITIVE_TYPES = new Set(['string', 'integer', 'number', 'boolean']);

function isPrimitiveSchema(s) {
  if (!s || typeof s !== 'object') return false;
  if (Array.isArray(s.enum)) return true;
  return PRIMITIVE_TYPES.has(s.type);
}

function sampleFromProperties(props) {
  const out = {};
  for (const [name, sch] of Object.entries(props ?? {})) {
    if (sch.example !== undefined) out[name] = sch.example;
    else if (sch.default !== undefined) out[name] = sch.default;
    else if (sch.type === 'string') out[name] = '';
    else if (sch.type === 'number' || sch.type === 'integer') out[name] = 0;
    else if (sch.type === 'boolean') out[name] = false;
    else out[name] = null;
  }
  return out;
}

function jsonBodySchema(requestBody) {
  if (!requestBody) return null;
  const json = requestBody.content?.['application/json'];
  if (!json?.schema) return null;
  return { schema: json.schema, required: !!requestBody.required };
}

function inferAccept(description) {
  const match = description && description.match(/\(([^)]+)\)/);
  if (!match) return undefined;
  const exts = match[1]
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z0-9]{2,5}$/.test(s));
  return exts.length ? exts.map((e) => `.${e}`).join(',') : undefined;
}

function multipartBodySchema(requestBody) {
  if (!requestBody) return null;
  const m = requestBody.content?.['multipart/form-data'];
  if (!m?.schema) return null;
  return { schema: m.schema, required: !!requestBody.required };
}

export default {
  name: 'TryItModal',
  props: {
    op: { type: Object, required: true },
    securitySchemes: { type: Object, required: true },
    apiClient: { type: Object, required: true },
  },
  emits: ['close', 'result'],
  setup(props, { emit }) {
    const auth = useAuth();

    const queryValues = ref({});
    const pathValues = ref({});
    const bodyMode = ref('fields');
    const bodyFields = ref({});
    const bodyJsonText = ref('');
    
    const multipartFiles = ref({});
    const multipartFields = ref({});

    const result = ref(null);
    const fetchError = ref(null);
    const loading = ref(false);

    function initFromOp() {
      queryValues.value = {};
      pathValues.value = {};
      result.value = null;
      fetchError.value = null;
      bodyMode.value = 'fields';
      bodyFields.value = {};
      bodyJsonText.value = '';
      multipartFiles.value = {};
      multipartFields.value = {};

      for (const p of props.op.parameters || []) {
        const init = p.schema?.default;
        if (p.in === 'query') queryValues.value[p.name] = init ?? '';
        else if (p.in === 'path') pathValues.value[p.name] = init ?? '';
      }

      const json = jsonBodySchema(props.op.requestBody);
      if (json) {
        const s = json.schema;
        if (s.type === 'object' && s.properties && Object.values(s.properties).every(isPrimitiveSchema)) {
          bodyMode.value = 'fields';
          bodyFields.value = sampleFromProperties(s.properties);
        } else {
          bodyMode.value = 'json';
          bodyJsonText.value = JSON.stringify(
            s.properties ? sampleFromProperties(s.properties) : (s.example ?? {}),
            null, 2,
          );
        }
      }
    }
    watch(() => props.op, initFromOp, { immediate: true });

    // Path templates: replace `{name}` with the value the user typed.
    const resolvedPath = computed(() => {
      let p = props.op.path;
      for (const [k, v] of Object.entries(pathValues.value)) {
        p = p.replace('{' + k + '}', encodeURIComponent(v ?? ''));
      }
      return p;
    });

    function buildBody() {
      const json = jsonBodySchema(props.op.requestBody);
      const multipart = multipartBodySchema(props.op.requestBody);
    
      if (multipart && !json) {
        const schema = multipart.schema || {};
        const propsMap = schema.properties || {};
        const required = new Set(schema.required || []);
    
        const formData = new FormData();
    
        for (const [name, sch] of Object.entries(propsMap)) {
          const isFile = sch?.type === 'string' && sch?.format === 'binary';
    
          if (isFile) {
            const file = multipartFiles.value[name];
    
            if (!file && required.has(name)) {
              return { error: `File field "${name}" is required` };
            }
    
            if (file) {
              formData.append(name, file);
            }
    
            continue;
          }
    
          const value = multipartFields.value[name];
    
          if ((value === '' || value === undefined || value === null) && !required.has(name)) {
            continue;
          }
    
          if ((value === '' || value === undefined || value === null) && required.has(name)) {
            return { error: `Field "${name}" is required` };
          }
    
          formData.append(name, value);
        }
    
        return { formData };
      }
    
      if (!json) return { jsonBody: undefined };
    
      if (bodyMode.value === 'fields') {
        const required = new Set(json.schema.required || []);
        const out = {};
    
        for (const [k, v] of Object.entries(bodyFields.value)) {
          if ((v === '' || v === undefined) && !required.has(k)) continue;
          out[k] = v;
        }
    
        return { jsonBody: out };
      }
    
      try {
        return {
          jsonBody: bodyJsonText.value.trim()
            ? JSON.parse(bodyJsonText.value)
            : undefined,
        };
      } catch (err) {
        return { error: 'JSON body is invalid: ' + err.message };
      }
    }

    async function execute() {
      const built = buildBody();
      if (built.error) {
        fetchError.value = new Error(built.error);
        result.value = null;
        return;
      }

      const queryClean = {};
      for (const [k, v] of Object.entries(queryValues.value)) {
        if (v !== '' && v !== undefined && v !== null) queryClean[k] = v;
      }

      loading.value = true;
      fetchError.value = null;
      try {
        result.value = await props.apiClient.execute({
          method: props.op.method,
          path: resolvedPath.value,
          query: queryClean,
          jsonBody: built.jsonBody,
          formData: built.formData,
          security: props.op.security,
          securitySchemes: props.securitySchemes,
        });
        if (auth.isAuthenticated.value) auth.refreshUsage().catch(() => {});
        emit('result', {
          method: props.op.method,
          path: resolvedPath.value,
          status: result.value.status,
          elapsedMs: result.value.elapsedMs,
        });
      } catch (err) {
        fetchError.value = err;
      } finally {
        loading.value = false;
      }
    }

    const authStatus = computed(() => {
      const sec = props.op.security || [];
      if (sec.length === 0) return { ok: true };
      const snap = auth.snapshot();
      for (const req of sec) {
        for (const name of Object.keys(req)) {
          const scheme = props.securitySchemes?.[name];
          if (!scheme) continue;
          if (scheme.type === 'apiKey' && snap.apiKey) return { ok: true };
          if (scheme.type === 'http' && scheme.scheme === 'bearer' && snap.jwt) return { ok: true };
        }
      }
      const needs = sec.flatMap((req) => Object.keys(req));
      return { ok: false, hint: 'Sign in or set an API key — this endpoint requires: ' + needs.join(' or ') };
    });

    function renderQueryParams() {
      const params = (props.op.parameters || []).filter((p) => p.in === 'query');
      if (params.length === 0) return null;
      return h('div', { class: 'form-section' }, [
        h('h4', {}, 'Query parameters'),
        ...params.map((p) =>
          h(FormField, {
            schema: p.schema || {},
            name: p.name,
            required: !!p.required,
            description: p.description || '',
            modelValue: queryValues.value[p.name],
            'onUpdate:modelValue': (v) => (queryValues.value[p.name] = v),
          }),
        ),
      ]);
    }

    function renderPathParams() {
      const params = (props.op.parameters || []).filter((p) => p.in === 'path');
      if (params.length === 0) return null;
      return h('div', { class: 'form-section' }, [
        h('h4', {}, 'Path parameters'),
        ...params.map((p) =>
          h(FormField, {
            schema: p.schema || {},
            name: p.name,
            required: true,
            description: p.description || '',
            modelValue: pathValues.value[p.name],
            'onUpdate:modelValue': (v) => (pathValues.value[p.name] = v),
          }),
        ),
      ]);
    }

    function renderBody() {
      const json = jsonBodySchema(props.op.requestBody);
      const multipart = multipartBodySchema(props.op.requestBody);

      if (!json && !multipart) return null;

      if (multipart && !json) {
        const schema = multipart.schema || {};
        const propsMap = schema.properties || {};
        const required = new Set(schema.required || []);
      
        return h('div', { class: 'form-section' }, [
          h('h4', {}, 'Request body'),
      
          ...Object.entries(propsMap).map(([name, sch]) => {
            const isFile = sch?.type === 'string' && sch?.format === 'binary';
      
            if (isFile) {
              const accept = inferAccept(sch.description);
              const selected = multipartFiles.value[name];
              return h('div', { class: 'field' }, [
                h('span', { class: 'field-label' }, [
                  name,
                  required.has(name) && h('b', { style: 'color:var(--danger);margin-left:4px' }, '*'),
                ]),
                sch.description && h('span', { class: 'field-desc' }, sch.description),
                h('label', { class: 'file-picker' }, [
                  h('input', {
                    type: 'file',
                    class: 'file-picker-input',
                    accept,
                    onChange: (e) => {
                      multipartFiles.value[name] = e.target.files?.[0] ?? null;
                    },
                  }),
                  h('span', { class: 'btn sm file-picker-btn' }, 'Choose file'),
                  h(
                    'span',
                    { class: selected ? 'file-picker-name' : 'file-picker-name empty' },
                    selected ? selected.name : 'No file chosen',
                  ),
                  selected &&
                    h(
                      'button',
                      {
                        type: 'button',
                        class: 'file-picker-clear',
                        title: 'Remove file',
                        onClick: (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          multipartFiles.value[name] = null;
                        },
                      },
                      '×',
                    ),
                ]),
              ]);
            }
      
            return h(FormField, {
              schema: sch || {},
              name,
              required: required.has(name),
              description: sch.description || '',
              modelValue: multipartFields.value[name] ?? '',
              'onUpdate:modelValue': (v) => (multipartFields.value[name] = v),
            });
          }),
        ]);
      }

      const required = new Set(json.schema.required || []);

      return h('div', { class: 'form-section' }, [
        h('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px' }, [
          h('h4', { style: 'margin:0' }, 'Request body'),
          // Mode toggle. Always available so devs can drop into raw JSON
          // when they want to send something the field renderer can't
          // express (nulls, arrays of objects, etc.).
          h('div', { class: 'auth-tabs', style: 'width:auto' }, [
            h('button', {
              class: bodyMode.value === 'fields' ? 'active' : '',
              onClick: () => switchBodyMode('fields'),
              disabled: !canFieldsMode(json.schema),
              title: !canFieldsMode(json.schema) ? 'Schema too complex for fields mode' : '',
            }, 'Fields'),
            h('button', {
              class: bodyMode.value === 'json' ? 'active' : '',
              onClick: () => switchBodyMode('json'),
            }, 'JSON'),
          ]),
        ]),

        bodyMode.value === 'fields'
          ? Object.entries(json.schema.properties || {}).map(([name, sch]) =>
              h(FormField, {
                schema: sch,
                name,
                required: required.has(name),
                description: sch.description || '',
                modelValue: bodyFields.value[name],
                'onUpdate:modelValue': (v) => (bodyFields.value[name] = v),
              }),
            )
          : h('textarea', {
              class: 'textarea',
              value: bodyJsonText.value,
              onInput: (e) => (bodyJsonText.value = e.target.value),
              spellcheck: 'false',
              placeholder: '{ }',
              rows: 8,
            }),
      ]);
    }

    function canFieldsMode(schema) {
      return schema.type === 'object'
        && schema.properties
        && Object.values(schema.properties).every(isPrimitiveSchema);
    }

    function switchBodyMode(mode) {
      if (mode === bodyMode.value) return;
      const json = jsonBodySchema(props.op.requestBody);
      if (mode === 'json') {
        bodyJsonText.value = JSON.stringify(bodyFields.value, null, 2);
        bodyMode.value = 'json';
      } else {
        try {
          const parsed = JSON.parse(bodyJsonText.value || '{}');
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const required = json?.schema.required || [];
            const merged = sampleFromProperties(json?.schema.properties || {});
            for (const k of Object.keys(merged)) merged[k] = parsed[k] ?? merged[k];
            for (const [k, v] of Object.entries(parsed)) if (!(k in merged)) merged[k] = v;
            bodyFields.value = merged;
            void required;
          }
        } catch { /* keep current bodyFields */ }
        bodyMode.value = 'fields';
      }
    }

    function methodTag() {
      return h('span', { class: 'method-tag method-' + props.op.method }, props.op.method);
    }

    return () =>
      h('div', { class: 'overlay', onClick: (e) => { if (e.target.classList.contains('overlay')) emit('close'); } }, [
        h('div', { class: 'modal' }, [
          h('div', { class: 'modal-head' }, [
            h('div', { class: 'title' }, [
              h('h2', {}, props.op.summary || (props.op.method + ' ' + props.op.path)),
              h('div', { class: 'modal-meta' }, [
                methodTag(),
                h('span', { class: 'ep-path', style: 'font-family:var(--font-mono);font-size:13px' }, resolvedPath.value),
              ]),
              props.op.description && h('div', { class: 'desc' }, props.op.description),
            ]),
            h('button', { class: 'modal-close', onClick: () => emit('close'), 'aria-label': 'Close' }, '✕'),
          ]),

          h('div', { class: 'modal-body' }, [
            !authStatus.value.ok && h('div', { class: 'auth-gate' }, [
              h('div', { class: 'auth-gate-row' }, [
                h('span', { class: 'auth-gate-icon' }, '🔒'),
                h('div', { class: 'auth-gate-text' }, [
                  h('strong', {}, 'Sign in to try this endpoint'),
                  h('div', {}, authStatus.value.hint),
                ]),
                h('a', {
                  class: 'btn primary sm',
                  href: (() => {
                    let path = window.location.pathname.replace(/\.html$/i, '');
                    if (path === '/index') path = '/';
                    return (
                      '/login?next=' +
                      encodeURIComponent(
                        path + window.location.search + window.location.hash,
                      )
                    );
                  })(),
                  style: 'flex:0 0 auto',
                }, 'Sign in'),
              ]),
            ]),

            renderPathParams(),
            renderQueryParams(),
            renderBody(),

            (loading.value || result.value || fetchError.value) && h(ResultPane, {
              loading: loading.value,
              error: fetchError.value,
              result: result.value,
              filename: filenameFromOp(props.op),
            }),
          ]),

          h('div', { class: 'modal-foot' }, [
            h('button', { class: 'btn', onClick: () => emit('close') }, 'Close'),
            h('button', {
              class: 'btn primary',
              disabled: loading.value || !authStatus.value.ok,
              title: !authStatus.value.ok ? 'Sign in via the sidebar to enable Execute' : '',
              onClick: execute,
            }, loading.value ? 'Executing…' : 'Execute'),
          ]),
        ]),
      ]);
  },
};

function filenameFromOp(op) {
  const last = op.path.split('/').filter(Boolean).pop() || 'response';
  return last.replace(/[^a-z0-9-_]/gi, '_').toLowerCase();
}
