/**
 * FormField — render a single OpenAPI parameter (or body property).
 *
 * Decides which input control to show based on schema shape:
 *   - enum                 → <select>
 *   - boolean              → <input type=checkbox>
 *   - integer / number     → <input type=number>
 *   - string with format=  → <input> with appropriate type
 *   - everything else      → <input type=text>
 *
 * Complex types (object/array/oneOf/anyOf) are NOT rendered here — the
 * parent (TryItModal) detects them and falls back to a JSON textarea.
 *
 * Props:
 *   schema   — the parameter `schema` object from the spec
 *   name     — field name shown in the label
 *   required — boolean
 *   description — optional helper text
 *   modelValue — current value (v-model contract)
 */

import { h, computed } from 'vue';

export default {
  name: 'FormField',
  props: {
    schema: { type: Object, required: true },
    name: { type: String, required: true },
    required: { type: Boolean, default: false },
    description: { type: String, default: '' },
    modelValue: { default: undefined },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const typeLabel = computed(() => {
      const s = props.schema || {};
      if (Array.isArray(s.enum)) return 'enum';
      if (s.type === 'integer') return 'int';
      return s.type || 'any';
    });

    function inputType() {
      const s = props.schema || {};
      if (s.format === 'email') return 'email';
      if (s.format === 'uri' || s.format === 'url') return 'url';
      if (s.format === 'password') return 'password';
      return 'text';
    }

    function set(v) { emit('update:modelValue', v); }

    function renderControl() {
      const s = props.schema || {};

      if (Array.isArray(s.enum)) {
        return h('select', {
          class: 'select',
          value: props.modelValue ?? '',
          onChange: (e) => set(e.target.value),
        }, [
          // Allow "no selection" so we don't force a value when optional.
          !props.required && h('option', { value: '' }, '— optional —'),
          ...s.enum.map((v) => h('option', { value: v }, String(v))),
        ]);
      }

      if (s.type === 'boolean') {
        return h('label', { class: 'checkbox' }, [
          h('input', {
            type: 'checkbox',
            checked: !!props.modelValue,
            onChange: (e) => set(e.target.checked),
          }),
          h('span', { style: 'font-size:12px;color:var(--fg-mu)' },
            props.modelValue ? 'true' : 'false',
          ),
        ]);
      }

      if (s.type === 'number' || s.type === 'integer') {
        const attrs = {
          class: 'input',
          type: 'number',
          value: props.modelValue ?? '',
          placeholder: s.default !== undefined ? `default: ${s.default}` : '',
          onInput: (e) => {
            const raw = e.target.value;
            if (raw === '') return set(undefined);
            const n = s.type === 'integer' ? parseInt(raw, 10) : parseFloat(raw);
            set(Number.isNaN(n) ? undefined : n);
          },
        };
        if (s.minimum !== undefined) attrs.min = s.minimum;
        if (s.maximum !== undefined) attrs.max = s.maximum;
        if (s.type === 'integer') attrs.step = 1;
        return h('input', attrs);
      }

      // Default: text input
      return h('input', {
        class: 'input',
        type: inputType(),
        value: props.modelValue ?? '',
        placeholder: placeholder(s),
        onInput: (e) => set(e.target.value),
      });
    }

    function placeholder(s) {
      if (s.example !== undefined) return String(s.example);
      if (s.default !== undefined) return `default: ${s.default}`;
      if (s.format) return s.format;
      return '';
    }

    return () =>
      h('div', { class: 'field' }, [
        h('div', { class: 'field-label' }, [
          h('span', { class: 'name' }, props.name),
          h('span', { class: 'type' }, typeLabel.value),
          props.required && h('span', { class: 'req' }, '*'),
        ]),
        renderControl(),
        props.description && h('div', { class: 'field-help' }, props.description),
      ]);
  },
};
