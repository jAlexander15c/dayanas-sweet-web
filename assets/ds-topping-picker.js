if (!customElements.get('ds-topping-picker')) {
  customElements.define(
    'ds-topping-picker',
    class DSToppingPicker extends HTMLElement {
      connectedCallback() {
        this.options = Array.from(this.querySelectorAll('[data-ds-topping-option]'));
        this.fieldset = this.querySelector('fieldset');
        this.error = this.querySelector('[role="alert"]');
        this.form = this.options[0]?.form;
        this.onSubmit = (event) => {
          if (this.validate()) return;
          event.preventDefault();
          event.stopImmediatePropagation();
        };
        this.onChange = () => {
          if (this.options.some((option) => option.checked)) this.setError(false);
        };
        this.onInvalid = (event) => {
          event.preventDefault();
          this.validate();
        };
        this.form?.addEventListener('submit', this.onSubmit, true);
        this.addEventListener('change', this.onChange);
        this.addEventListener('invalid', this.onInvalid, true);
      }

      disconnectedCallback() {
        this.form?.removeEventListener('submit', this.onSubmit, true);
        this.removeEventListener('change', this.onChange);
        this.removeEventListener('invalid', this.onInvalid, true);
      }

      setError(invalid) {
        this.error.hidden = !invalid;
        this.fieldset.setAttribute('aria-invalid', String(invalid));
      }

      validate() {
        const valid = this.options.some((option) => option.checked);
        this.setError(!valid);
        if (!valid) this.options[0]?.focus();
        return valid;
      }
    }
  );
}
