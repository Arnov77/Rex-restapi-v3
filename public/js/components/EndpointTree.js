/**
 * EndpointTree — folder-style endpoint browser.
 *
 * Renders each OpenAPI tag as a collapsible folder whose children are the
 * operations in that tag. Replaces the flat card grid: selecting a leaf
 * shows the detail pane beside it instead of opening a modal, so jumping
 * between endpoints no longer costs an open/close cycle.
 *
 * Props:
 *   groups    — [{ tag, ops }] from useOpenApi()
 *   activeTag — sidebar tag filter ('' = all)
 *   selected  — currently selected op (or null)
 * Emits:
 *   select(op)
 */

import { h, ref, computed, watch } from 'vue';

function opKey(op) {
  return op.method + ' ' + op.path;
}

/** Strip the shared `/api/<tag>` prefix so the tree reads as a path. */
function leafLabel(op, tag) {
  let p = op.path.replace(/^\/api\//, '');
  const seg = p.split('/').filter(Boolean);
  if (seg.length && seg[0].toLowerCase() === tag.toLowerCase()) seg.shift();
  const rest = seg.join('/');
  return '/' + (rest || '');
}

export default {
  name: 'EndpointTree',
  props: {
    groups: { type: Array, required: true },
    activeTag: { type: String, default: '' },
    selected: { type: Object, default: null },
  },
  emits: ['select'],
  setup(props, { emit }) {
    const open = ref({});
    const query = ref('');

    // Follow the sidebar: picking a tag there expands exactly that folder.
    // With no tag chosen, open the first one so the pane is never empty.
    // The tree is now the only place categories are chosen, so it keeps
    // its own expanded state and no longer collapses everything when the
    // tab changes. First folder opens so the detail pane is never blank.
    function syncOpen() {
      if (Object.keys(open.value).length) return;
      const first = props.groups[0];
      open.value = first ? { [first.tag]: true } : {};
    }
    watch(() => [props.activeTag, props.groups.length], syncOpen, { immediate: true });

    const filtered = computed(() => {
      const q = query.value.trim().toLowerCase();
      const base = props.activeTag
        ? props.groups.filter((g) => g.tag === props.activeTag)
        : props.groups;
      if (!q) return base;
      return base
        .map((g) => ({
          tag: g.tag,
          ops: g.ops.filter(
            (op) =>
              op.path.toLowerCase().includes(q) ||
              (op.summary || '').toLowerCase().includes(q),
          ),
        }))
        .filter((g) => g.ops.length > 0);
    });

    // A search narrows the tree, so every remaining folder opens.
    const isOpen = (tag) => (query.value.trim() ? true : !!open.value[tag]);

    function toggle(tag) {
      open.value = { ...open.value, [tag]: !open.value[tag] };
    }

    function chevron(expanded) {
      return h('svg', {
        width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', 'stroke-width': 2.4,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        class: 'tree-chevron', 'aria-hidden': 'true',
      }, [h('path', { d: expanded ? 'm6 9 6 6 6-6' : 'm9 6 6 6-6 6' })]);
    }

    function folderIcon() {
      return h('svg', {
        width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', 'stroke-width': 1.7,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        class: 'tree-folder-icon', 'aria-hidden': 'true',
      }, [h('path', { d: 'M3 7.5A1.5 1.5 0 0 1 4.5 6h4L11 8.5h8.5A1.5 1.5 0 0 1 21 10v7.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z' })]);
    }

    return () =>
      h('div', { class: 'tree' }, [
        h('div', { class: 'tree-search' }, [
          h('input', {
            type: 'text',
            class: 'tree-search-input',
            placeholder: 'Cari endpoint…',
            value: query.value,
            'aria-label': 'Cari endpoint',
            onInput: (e) => (query.value = e.target.value),
          }),
        ]),

        h('div', { class: 'tree-body' },
          filtered.value.length === 0
            ? [h('div', { class: 'tree-empty' }, 'Tidak ada endpoint yang cocok.')]
            : filtered.value.map((g) => {
                const expanded = isOpen(g.tag);
                return h('div', { class: 'tree-group', key: g.tag }, [
                  h('button', {
                    type: 'button',
                    class: 'tree-folder' + (expanded ? ' open' : ''),
                    'aria-expanded': String(expanded),
                    onClick: () => toggle(g.tag),
                  }, [
                    chevron(expanded),
                    folderIcon(),
                    h('span', { class: 'tree-folder-name' }, g.tag),
                    h('span', { class: 'tree-count' }, String(g.ops.length)),
                  ]),

                  expanded && h('div', { class: 'tree-children' },
                    g.ops.map((op) => {
                      const active = props.selected && opKey(props.selected) === opKey(op);
                      return h('button', {
                        type: 'button',
                        key: opKey(op),
                        class: 'tree-leaf' + (active ? ' active' : ''),
                        title: op.summary || op.path,
                        onClick: () => emit('select', op),
                      }, [
                        h('span', { class: 'tree-method method-' + op.method }, op.method),
                        h('span', { class: 'tree-leaf-path' }, leafLabel(op, g.tag)),
                      ]);
                    }),
                  ),
                ]);
              }),
        ),
      ]);
  },
};
