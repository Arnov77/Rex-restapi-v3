/**
 * PasswordModal — styled confirmation dialog for password-gated actions.
 *
 * Replaces the vanilla window.prompt() used for "Reveal key" and
 * "Regenerate key". Same modal chrome as TryItModal (.overlay / .modal /
 * .modal-head / .modal-body / .modal-foot) so it inherits the dashboard's
 * dark-mode design system with zero new layout CSS.
 *
 * Props:
 *   title        — modal headline (e.g. 'Reveal API key')
 *   hint         — supporting copy under the title
 *   actionLabel  — submit button label (e.g. 'Reveal key' / 'Regenerate')
 *   danger       — true renders the submit button in danger tone
 *                  (regeneration is destructive: old key dies instantly)
 *   loading      — disables submit + shows a spinner in the button
 *   error        — inline error text shown below the password field
 *   confirmLabel — (optional) cancel button label, default 'Cancel'
 *
 * Emits:
 *   confirm(password) — user confirmed; consumer runs the fetch and reports
 *                       back via :loading / :error / @close
 *   cancel            — user dismissed
 *   close             — same as cancel (for backdrop / Esc / ✕)
 *
 * Dismissal: Esc, backdrop click, ✕ button, or Cancel. Confirm button is
 * disabled while loading so double-submits and race conditions are not
 * possible.
 */

import { h as _h, ref, onMounted, onBeforeUnmount, watch } from 'vue';

export default {
  name: 'PasswordModal',
  props: {
    title: { type: String, default: 'Confirm your password' },
    hint: { type: String, default: 'Your account password is required for this action.' },
    actionLabel: { type: String, default: 'Confirm' },
    danger: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
    error: { type: [String, null], default: null },
    confirmLabel: { type: String, default: 'Cancel' },
  },
  emits: ['confirm', 'cancel', 'close'],
  setup(props, { emit }) {
    const password = ref('');
    const showPw = ref(false);

    function close() {
      emit('close');
    }

    function confirm() {
      if (props.loading || !password.value) return;
      emit('confirm', password.value);
      // Do NOT clear the password here — if the consumer reports an error
      // (wrong password) the user should be able to retry without retyping.
      // The modal re-uses the same field until explicitly closed.
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') emit('close');
    }

    onMounted(() => window.addEventListener('keydown', onKeyDown));
    onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown));

    // Focus the password field as soon as the modal mounts, and whenever
    // the error changes (wrong-password retry path) so the user never has
    // to reach for the mouse.
    watch(
      () => props.error,
      () => {
        requestAnimationFrame(() => {
          const input = document.querySelector('.pw-input');
          if (input) input.focus();
        });
      },
    );

    return {
      password,
      showPw,
      close,
      confirm,
    };
  },

  render() {
    // Imported render helper — kept separate from the local name so the
    // Options API render() body can still read `this` props/state without
    // shadowing issues. (Vue 3 attaches `h` to the instance too, but the
    // import is the same convention every sibling component uses.)
    const create = _h;

    // Spinner dots inside the submit button — cheap CSS-free approach
    // that stays aligned with the button's line-height.
    const spinner = create('span', { class: 'pw-spinner', 'aria-hidden': 'true' }, [
      create('i', {}),
      create('i', {}),
      create('i', {}),
    ]);

    const submitClass = this.danger ? 'btn danger' : 'btn primary';

    return create('div', {
      class: 'overlay',
      onClick: (e) => { if (e.target.classList.contains('overlay')) this.close(); },
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': this.title,
    }, [
      create('div', { class: 'modal pw-modal' }, [
        create('div', { class: 'modal-head' }, [
          create('div', { class: 'title' }, [
            create('h2', {}, this.title),
            this.hint && create('div', { class: 'modal-meta' }, this.hint),
          ]),
          create('button', {
            class: 'modal-close',
            onClick: this.close,
            'aria-label': 'Close',
          }, '✕'),
        ]),

        create('div', { class: 'modal-body' }, [
          // Password field — mirrors .input styling from dashboard.css,
          // with a show/hide toggle for convenience.
          create('div', { class: 'pw-field' }, [
            create('label', { class: 'pw-label', for: 'pw-input' }, 'Account password'),
            create('div', { class: ['pw-input-wrap', 'input-wrap'] }, [
              create('input', {
                id: 'pw-input',
                class: 'input pw-input',
                type: this.showPw ? 'text' : 'password',
                placeholder: '••••••••••••',
                autocomplete: 'current-password',
                disabled: this.loading,
                onInput: (e) => { this.password = e.target.value; },
                onKeydown: (e) => { if (e.key === 'Enter') this.confirm(); },
              }),
              create('button', {
                type: 'button',
                class: ['pw-show-toggle', this.showPw ? 'pw-shown' : ''],
                disabled: this.loading,
                onClick: () => { this.showPw = !this.showPw; },
                'aria-label': this.showPw ? 'Hide password' : 'Show password',
              }, h('i', { class: this.showPw ? 'bi bi-eye-slash' : 'bi bi-eye' })),
            ]),
            this.error && create('div', { class: 'pw-error', role: 'alert' }, [
              create('span', { class: 'pw-error-icon' }, '!'),
              create('span', {}, this.error),
            ]),
          ]),
        ]),

        create('div', { class: 'modal-foot' }, [
          create('button', { class: 'btn', onClick: this.close }, this.confirmLabel),
          create('button', {
            class: [submitClass],
            disabled: this.loading || !this.password,
            onClick: this.confirm,
          }, [
            this.loading && spinner,
            create('span', {}, this.loading ? 'Confirming…' : this.actionLabel),
          ]),
        ]),
      ]),
    ]);
  },
};
