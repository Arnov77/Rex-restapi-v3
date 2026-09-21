/**
 * EndpointBrowser — tree + detail, replacing the card grid and modal.
 *
 * Keeps the selected operation here so the tree and the detail pane stay
 * in sync, and auto-picks the first endpoint so the pane is never blank
 * on arrival.
 */

import { h, ref, watch } from 'vue';
import EndpointTree from './EndpointTree.js';
import EndpointDetail from './EndpointDetail.js';

export default {
  name: 'EndpointBrowser',
  props: {
    groups: { type: Array, required: true },
    activeTag: { type: String, default: '' },
    securitySchemes: { type: Object, required: true },
    apiClient: { type: Object, required: true },
  },
  emits: ['result'],
  setup(props, { emit }) {
    const selected = ref(null);
    const mobileView = ref('tree'); // 'tree' | 'detail'

    function visibleGroups() {
      return props.activeTag
        ? props.groups.filter((g) => g.tag === props.activeTag)
        : props.groups;
    }

    // Land on something useful: first op of the first visible folder.
    function pickDefault() {
      const g = visibleGroups()[0];
      const first = g && g.ops[0];
      if (!first) { selected.value = null; return; }
      const stillThere = selected.value
        && visibleGroups().some((grp) => grp.ops.some(
          (o) => o.method === selected.value.method && o.path === selected.value.path));
      if (!stillThere) selected.value = first;
    }
    watch(() => [props.activeTag, props.groups.length], pickDefault, { immediate: true });

    function onSelect(op) {
      selected.value = op;
      mobileView.value = 'detail';
    }

    return () =>
      h('div', { class: 'browser' + (mobileView.value === 'detail' ? ' show-detail' : '') }, [
        h('div', { class: 'browser-tree' }, [
          h(EndpointTree, {
            groups: props.groups,
            activeTag: props.activeTag,
            selected: selected.value,
            onSelect,
          }),
        ]),

        h('div', { class: 'browser-detail' }, [
          h('button', {
            type: 'button',
            class: 'browser-back',
            onClick: () => (mobileView.value = 'tree'),
          }, '← Daftar endpoint'),

          selected.value
            ? h(EndpointDetail, {
                key: selected.value.method + ' ' + selected.value.path,
                op: selected.value,
                securitySchemes: props.securitySchemes,
                apiClient: props.apiClient,
                onResult: (entry) => emit('result', entry),
              })
            : h('div', { class: 'empty' }, 'Pilih endpoint di sebelah kiri.'),
        ]),
      ]);
  },
};
