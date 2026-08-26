/**
 * CodeExamples — generates curl / Node.js / Python snippets
 * from the current form state in TryItModal.
 */
import { h, ref, computed, watch } from 'vue';

// Load highlight.js sekali saja
let hljs = null;
async function getHljs() {
  if (hljs) return hljs;
  // esm.sh: import full build langsung, tidak perlu register manual
  const mod = await import('https://esm.sh/highlight.js@11.10.0');
  hljs = mod.default;
  return hljs;
}

const LANGS = ['cURL', 'Node.js', 'Python'];

// Generate placeholder value yang informatif dari schema parameter
function placeholderFromSchema(name, schema) {
  if (!schema) return `<${name}>`;

  // Prioritas: example > enum[0] > default > format-based > type-based
  if (schema.example !== undefined) return String(schema.example);
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return String(schema.enum[0]);
  if (schema.default !== undefined) return String(schema.default);

  // Format hints
  if (schema.format === 'uri') return `https://example.com`;
  if (schema.format === 'binary') return `<file>`;

  // Name hints
  const n = name.toLowerCase();
  if (n === 'url')   return 'https://example.com';
  if (n === 'text')  return 'Hello world';
  if (n === 'query' || n === 'q') return 'your search query';
  if (n === 'name')  return 'John Doe';
  if (n === 'prompt') return 'a beautiful sunset over the ocean';
  if (n === 'session') return 'my-session-id';
  if (n === 'ip')    return '8.8.8.8';
  if (n === 'to')    return 'en';
  if (n === 'from' || n === 'lang' || n === 'language') return 'id';

  // Type fallback
  if (schema.type === 'integer' || schema.type === 'number') {
    if (schema.minimum !== undefined) return String(schema.minimum);
    return '1';
  }
  if (schema.type === 'boolean') return 'false';
  if (schema.type === 'string') return `<${name}>`;

  return `<${name}>`;
}

function buildUrl(baseUrl, path, query, op) {
  // Kalau query kosong, isi dari schema parameter sebagai placeholder
  const params = (op.parameters || []).filter(p => p.in === 'query');
  const filled = {};

  for (const p of params) {
    const val = query[p.name];
    if (val !== '' && val !== null && val !== undefined) {
      filled[p.name] = val;
    } else if (p.required) {
      // Required tapi kosong — pakai placeholder dari schema
      filled[p.name] = placeholderFromSchema(p.name, p.schema);
    }
    // Optional dan kosong — skip (tidak ditampilkan)
  }

  const qs = Object.entries(filled)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  return baseUrl + path + (qs ? '?' + qs : '');
}

function buildHeaders(apiKey, hasJson) {
  const headers = {};
  headers['x-api-key'] = apiKey || 'YOUR_API_KEY';
  if (hasJson) headers['Content-Type'] = 'application/json';
  return headers;
}

function enrichBody(body, op) {
  // Kalau body kosong, isi dari schema sebagai placeholder
  if (body?.jsonBody && Object.keys(body.jsonBody).length > 0) return body;

  const jsonSchema = op.requestBody?.content?.['application/json']?.schema;
  if (!jsonSchema?.properties) return body;

  const placeholder = {};
  for (const [name, sch] of Object.entries(jsonSchema.properties)) {
    placeholder[name] = placeholderFromSchema(name, sch);
  }
  return { jsonBody: placeholder };
}

function genCurl(method, url, headers, body) {
  const lines = [`curl -X ${method.toUpperCase()} '${url}'`];
  for (const [k, v] of Object.entries(headers)) {
    lines.push(`  -H '${k}: ${v}'`);
  }
  if (body?.jsonBody !== undefined && Object.keys(body.jsonBody).length > 0) {
    lines.push(`  -d '${JSON.stringify(body.jsonBody)}'`);
  }
  return lines.join(' \\\n');
}

function genNode(method, url, headers, body) {
  const lines = [];
  lines.push(`const res = await fetch('${url}', {`);
  lines.push(`  method: '${method.toUpperCase()}',`);
  lines.push(`  headers: ${JSON.stringify(headers, null, 2).replace(/\n/g, '\n  ')},`);
  if (body?.jsonBody !== undefined && Object.keys(body.jsonBody).length > 0) {
    lines.push(`  body: JSON.stringify(${JSON.stringify(body.jsonBody, null, 2).replace(/\n/g, '\n  ')}),`);
  }
  lines.push(`});`);
  lines.push(``);
  lines.push(`const data = await res.json();`);
  lines.push(`console.log(data);`);
  return lines.join('\n');
}

function genPython(method, url, headers, body) {
  const lines = [];
  lines.push(`import requests`);
  lines.push(``);

  // Format headers sebagai Python dict
  const hLines = JSON.stringify(headers, null, 4)
    .replace(/^{/, '{')
    .replace(/}$/, '}')
    .replace(/"([^"]+)":/g, '"$1":');
  lines.push(`headers = ${hLines}`);
  lines.push(``);

  if (body?.jsonBody !== undefined && Object.keys(body.jsonBody).length > 0) {
    const pLines = JSON.stringify(body.jsonBody, null, 4);
    lines.push(`payload = ${pLines}`);
    lines.push(``);
    lines.push(`res = requests.${method.toLowerCase()}(`);
    lines.push(`    '${url}',`);
    lines.push(`    headers=headers,`);
    lines.push(`    json=payload,`);
    lines.push(`)`);
  } else {
    lines.push(`res = requests.${method.toLowerCase()}(`);
    lines.push(`    '${url}',`);
    lines.push(`    headers=headers,`);
    lines.push(`)`);
  }

  lines.push(``);
  lines.push(`print(res.json())`);
  return lines.join('\n');
}

export default {
  name: 'CodeExamples',
  props: {
    op:           { type: Object, required: true },
    resolvedPath: { type: String, required: true },
    query:        { type: Object, default: () => ({}) },
    body:         { type: Object, default: () => ({}) },
    apiKey:       { type: String, default: null },
    baseUrl:      { type: String, default: '' },
  },
  setup(props) {
    const activeLang = ref('cURL');
    const copied = ref(false);
    const highlighted = ref('');

    const LANG_MAP = { 'cURL': 'bash', 'Node.js': 'javascript', 'Python': 'python' };

    const snippet = computed(() => {
      const enrichedBody = enrichBody(props.body, props.op);
      const url = buildUrl(props.baseUrl, props.resolvedPath, props.query, props.op);
      const hasJson = enrichedBody?.jsonBody !== undefined && Object.keys(enrichedBody.jsonBody).length > 0;
      const headers = buildHeaders(props.apiKey, hasJson);
      const method = props.op.method;

      if (activeLang.value === 'cURL')    return genCurl(method, url, headers, enrichedBody);
      if (activeLang.value === 'Node.js') return genNode(method, url, headers, enrichedBody);
      if (activeLang.value === 'Python')  return genPython(method, url, headers, enrichedBody);
      return '';
    });

    // Re-highlight setiap kali snippet atau lang berubah
    async function highlight() {
      const lib = await getHljs();
      const lang = LANG_MAP[activeLang.value] || 'bash';
      highlighted.value = lib.highlight(snippet.value, { language: lang }).value;
    }

    // Watch snippet changes
    watch([snippet, activeLang], () => highlight(), { immediate: true });

    function copy() {
      navigator.clipboard?.writeText(snippet.value).then(() => {
        copied.value = true;
        setTimeout(() => (copied.value = false), 1800);
      });
    }

    return () =>
      h('div', { class: 'code-examples' }, [
        h('div', { class: 'code-lang-tabs' },
          LANGS.map((lang) =>
            h('button', {
              class: 'code-lang-btn' + (activeLang.value === lang ? ' active' : ''),
              onClick: () => (activeLang.value = lang),
            }, lang),
          ),
        ),
        h('div', { class: 'code-block-wrap' }, [
          h('button', {
            class: 'code-copy-btn',
            onClick: copy,
            title: 'Copy to clipboard',
          }, copied.value ? '✓ Copied' : 'Copy'),
          h('pre', { class: 'code-block' },
            h('code', {
              class: `hljs language-${({'cURL':'bash','Node.js':'javascript','Python':'python'})[activeLang.value]}`,
              innerHTML: highlighted.value || snippet.value,
            }),
          ),
        ]),
      ]);
  },
};
