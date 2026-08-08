/**
 * EndpointList — searchable grid of endpoint cards, grouped by tag.
 *
 * Props:
 *   groups:    [{ tag, ops:[...] }]   — already sorted by useOpenApi
 *   activeTag: string|''              — '' shows all; otherwise filter
 *
 * Emits:
 *   select(op)  — user clicked a card, parent opens the modal
 */

import { ref, computed, h, watch } from 'vue';

// prettyTag() below derives a display name from the tag automatically
// (e.g. 'audit-log' -> 'Audit Log'), which is correct for every tag in
// src/plugins/swagger.ts except ones containing an acronym — title-casing
// "ai" gives "Ai", not "AI". This map exists ONLY for that acronym case,
// so it can't drift the way a full tag-name duplicate would: adding a new
// tag in swagger.ts needs no change here unless the new tag is (or
// contains) an acronym like "ai" or "api-keys".
const TAG_NAME_OVERRIDES = {
  ai: 'AI',
  'api-keys': 'API Keys',
};

function prettyTag(tag) {
  return TAG_NAME_OVERRIDES[tag] || tag.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default {
  name: 'EndpointList',
  props: {
    groups: { type: Array, required: true },
    activeTag: { type: String, default: '' },
  },
  emits: ['select'],
  setup(props, { emit }) {
    const search = ref('');

    // Auto-scroll the main column to top when the user picks a different
    // tag — otherwise on long pages the user might switch categories
    // and not realize the list updated above their viewport.
    watch(() => props.activeTag, () => {
      // Wait for Vue to commit the DOM update before scrolling.
      queueMicrotask(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    const filtered = computed(() => {
      const q = search.value.trim().toLowerCase();
      const groups = props.activeTag
        ? props.groups.filter((g) => g.tag === props.activeTag)
        : props.groups;
      if (!q) return groups;
      return groups
        .map((g) => ({
          tag: g.tag,
          ops: g.ops.filter((op) =>
            op.path.toLowerCase().includes(q) ||
            op.summary.toLowerCase().includes(q) ||
            op.method.toLowerCase().includes(q),
          ),
        }))
        .filter((g) => g.ops.length > 0);
    });

    function summarizeSecurity(op) {
      if (!op.security || op.security.length === 0) return [];
      const tags = new Set();
      for (const req of op.security) {
        for (const scheme of Object.keys(req)) {
          if (scheme === 'apiKey') tags.add('apiKey');
          else if (scheme === 'bearerAuth') tags.add('jwt');
        }
      }
      return [...tags];
    }

    function renderHeader() {
      const isFiltered = !!props.activeTag;
      const totalShown = filtered.value.reduce((n, g) => n + g.ops.length, 0);
      return h('div', { class: 'main-top' }, [
        h('div', { class: 'main-title-row' }, [
          h('h1', { class: 'main-title' },
            isFiltered ? prettyTag(props.activeTag) : 'All endpoints',
          ),
          h('span', { class: 'main-count' },
            totalShown + ' endpoint' + (totalShown === 1 ? '' : 's'),
          ),
        ]),
        h('div', { class: 'search' }, [
          h('span', { class: 'search-icon' }, '⌕'),
          h('input', {
            type: 'text',
            placeholder: 'Search endpoints…',
            value: search.value,
            onInput: (e) => (search.value = e.target.value),
          }),
        ]),
      ]);
    }

    function renderCard(op) {
      return h('button', {
        class: 'ep-card',
        key: op.method + ' ' + op.path,
        onClick: () => emit('select', op),
      }, [
        h('div', { class: 'ep-row' }, [
          h('span', { class: 'method-tag method-' + op.method }, op.method),
          h('span', { class: 'ep-path' }, op.path),
        ]),
        op.summary && h('div', { class: 'ep-summary' }, op.summary),
        h('div', { class: 'ep-secs' }, [
          ...summarizeSecurity(op).map((s) =>
            s === 'apiKey'
              ? h('span', { class: 'ep-sec api' }, 'API KEY')
              : h('span', { class: 'ep-sec jwt' }, 'JWT'),
          ),
          summarizeSecurity(op).length === 0 && h('span', { class: 'ep-sec' }, 'PUBLIC'),
        ]),
      ]);
    }

    return () => {
      const isFiltered = !!props.activeTag && !search.value;
      const showGroupHead = !isFiltered; // hide redundant group title when one category is picked

      return h('div', {}, [
        renderHeader(),

        filtered.value.length === 0
          ? h('div', { class: 'empty' }, search.value
              ? 'No endpoints match your search.'
              : 'No endpoints discovered. Is the OpenAPI spec at /docs/json reachable?',
            )
          : filtered.value.map((g) =>
              h('section', { class: 'group', key: g.tag }, [
                showGroupHead && h('div', { class: 'group-head' }, [
                  h('h2', {}, prettyTag(g.tag)),
                  h('span', { class: 'meta' }, g.ops.length + ' endpoint' + (g.ops.length === 1 ? '' : 's')),
                ]),
                h('div', { class: 'grid' }, g.ops.map(renderCard)),
              ]),
            ),
      ]);
    };
  },
};
