import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (path) => readFileSync(path, 'utf8');
const snippet = read('snippets/ds-topping-picker.liquid');
const main = read('sections/main-product.liquid');
const schema = JSON.parse(main.match(/{% schema %}([\s\S]*?){% endschema %}/)[1]);
const template = JSON.parse(read('templates/product.json')).sections.main;

test('block matches only the configured product ID and precedes buy buttons without removing variants', () => {
  assert.match(snippet, /elsif block.settings.product != blank and block.settings.product.id == product.id/);
  assert.match(main, /when 'ds_topping'[\s\S]*?render 'ds-topping-picker', product: product, block: block, product_form_id: product_form_id/);
  const block = schema.blocks.find((block) => block.type === 'ds_topping');
  assert.equal(block.name, 'Opción obligatoria');
  assert.deepEqual(block.settings.map((setting) => [setting.id, setting.type]), [
    ['product', 'product'], ['label', 'text'], ['property_name', 'text'],
    ['options', 'textarea'], ['error_text', 'text'], ['hide_dynamic_checkout', 'checkbox'],
  ]);
  const defaults = Object.fromEntries(block.settings.map((setting) => [setting.id, setting.default]));
  assert.equal(defaults.label, 'Elige tu topping');
  assert.equal(defaults.property_name, 'Topping');
  assert.equal(defaults.options, 'Chocolate\nCaramelo\nDulce de leche');
  assert.equal(defaults.error_text, 'Elige un topping para continuar.');
  assert.equal(defaults.hide_dynamic_checkout, true);
  assert.equal(template.blocks.ds_topping.settings.product, 'brownie-box-almendras-chocolate');
  assert.equal(template.blocks.ds_topping.settings.property_name, 'Topping');
  assert.equal(template.block_order.indexOf('ds_topping') + 1, template.block_order.indexOf('buy_buttons'));
  assert.equal(template.blocks.variant_picker.type, 'variant_picker');
});

test('radios are required, external form controls with no default selection and escaped properties[Topping]', () => {
  assert.match(snippet, /<fieldset[^>]*aria-describedby=/);
  assert.match(snippet, /<legend/);
  assert.match(snippet, /assign property_name = block.settings.property_name \| default: 'Topping'/);
  const input = snippet.match(/<input[\s\S]*?>/)[0];
  assert.match(input, /type="radio"/);
  assert.match(input, /name="properties\[{{ property_name \| escape }}\]"/);
  assert.match(input, /form="{{ product_form_id }}"/);
  assert.match(input, /value="{{ topping \| escape }}"/);
  assert.match(input, /\brequired\b/);
  assert.doesNotMatch(input, /\bchecked\b/);
  assert.match(snippet, /newline_to_br \| split: '<br \/>'/);
  assert.match(snippet, /topping != blank/);
  assert.match(snippet, /role="alert" hidden/);
  assert.doesNotMatch(snippet, /aria-live=/);
});

test('matching picker enables native required validation independently of dynamic checkout setting', () => {
  const buttons = read('snippets/buy-buttons.liquid');
  assert.match(buttons, /assign form_novalidate = 'novalidate'/);
  assert.match(buttons, /for topping_block in section.blocks\s+if topping_block.type == 'ds_topping' and topping_block.settings.product != blank and topping_block.settings.product.id == product.id\s+assign has_topping_picker = true\s+assign form_novalidate = nil\s+if topping_block.settings.hide_dynamic_checkout\s+assign show_dynamic_checkout = false/);
  assert.match(buttons, /form 'product',[\s\S]*?novalidate: form_novalidate,/);
  assert.match(buttons, /if show_dynamic_checkout -%}\s*{{ form \| payment_button }}/);
  assert.equal(template.blocks.ds_topping.settings.hide_dynamic_checkout, true);
});

test('both card types use one tag/handle policy and replace standard/bulk quick add before the form', () => {
  assert.match(snippet, /if mode == 'requires'/);
  assert.match(snippet, /product.tags contains 'requiere-opcion' or product.handle == 'brownie-box-almendras-chocolate'/);
  for (const path of ['snippets/ds-product-card.liquid', 'snippets/card-product.liquid']) {
    const card = read(path);
    assert.match(card, /render 'ds-topping-picker', product: (?:card_product|product), mode: 'requires'/);
    assert.doesNotMatch(card, /brownie-box-almendras-chocolate/);
    const choiceBranch = card.indexOf("elsif requires_topping == '1'");
    const form = card.indexOf('<product-form');
    assert.ok(choiceBranch > 0 && choiceBranch < form, path);
    assert.match(card.slice(choiceBranch, form), /href="{{ (?:card_product|product).url }}"[\s\S]*?'products.product.choose_topping' \| t/);
  }
  assert.match(read('snippets/card-product.liquid'), /requires_topping == '1' and card_product.available and quick_add == 'standard' or requires_topping == '1' and card_product.available and quick_add == 'bulk'/);
  assert.equal(JSON.parse(read('locales/es.default.json')).products.product.choose_topping, 'Elegir topping');
});

test('styles provide 44px touch targets, keyboard focus and reduced motion', () => {
  const css = read('assets/ds-topping-picker.css');
  assert.match(css, /min-height: 44px/);
  assert.match(css, /min-width: 44px/);
  assert.match(css, /:focus-visible \+ .ds-topping-picker__pill[\s\S]*?outline: 2px/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?transition: none/);
});

test('buy-buttons routes required products without a local picker to the product page, including featured-product', () => {
  const buttons = read('snippets/buy-buttons.liquid');
  assert.match(buttons, /capture requires_topping\s+render 'ds-topping-picker', product: product, mode: 'requires'/);
  assert.match(buttons, /if requires_topping == '1' and has_topping_picker == false\s+assign link_to_topping = true\s+assign show_dynamic_checkout = false/);
  assert.match(buttons, /if link_to_topping -%}\s*<a[^>]*href="{{ product.url }}"[^>]*>[\s\S]*?'products.product.choose_topping' \| t[\s\S]*?<\/a>\s*{%- else -%}\s*<product-form/);
  const featured = read('sections/featured-product.liquid');
  assert.match(featured, /render 'buy-buttons',[\s\S]*?product: product,[\s\S]*?section_id: section.id/);
  assert.doesNotMatch(featured, /when 'ds_topping'/);
});

test('topping links identify their product for screen readers', () => {
  for (const [path, product] of [
    ['snippets/ds-product-card.liquid', 'product'],
    ['snippets/card-product.liquid', 'card_product'],
    ['snippets/buy-buttons.liquid', 'product'],
  ]) {
    assert.ok(read(path).includes(`aria-label="Elegir topping de {{ ${product}.title | escape }}"`), path);
  }
});

test('property name contract removes brackets and all leading underscores with a nonempty public fallback', () => {
  // Static Liquid contract: actual Shopify rendering remains a preview check.
  assert.match(snippet, /assign property_name = block.settings.property_name \| default: 'Topping' \| remove: '\[' \| remove: '\]' \| strip/);
  assert.match(snippet, /assign property_name_length = property_name.size\s+for index in \(1\.\.property_name_length\)\s+assign first_character = property_name \| slice: 0\s+if first_character != '_'\s+break\s+endif\s+assign property_name = property_name \| remove_first: '_' \| strip\s+endfor\s+assign property_name = property_name \| default: 'Topping'/);
});

// Minimal DOM doubles exercise the actual component and Dawn submit handler.
// They do not replace a browser/Liquid render or Shopify cart integration test.
function harness({ loadPicker = true } = {}) {
  const definitions = new Map();
  const requests = [];
  class Element extends EventTarget {
    // Node's EventTarget removal differs for a boolean capture argument;
    // normalize it to the equivalent DOM options object in this test double.
    addEventListener(type, listener, options) {
      super.addEventListener(type, listener, typeof options === 'boolean' ? { capture: options } : options);
    }
    removeEventListener(type, listener, options) {
      super.removeEventListener(type, listener, typeof options === 'boolean' ? { capture: options } : options);
    }
    attributes = new Map();
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    classList = { add() {}, remove() {} };
  }
  const context = vm.createContext({
    HTMLElement: Element,
    customElements: { get: (name) => definitions.get(name), define: (name, type) => definitions.set(name, type) },
    fetchConfig: () => ({ headers: {} }),
    routes: { cart_add_url: '/cart/add.js' },
    window: { location: { pathname: '/products/brownie' } },
    fetch: (url, config) => { requests.push({ url, config }); return new Promise(() => {}); },
    FormData: class extends Map {
      constructor(form) {
        super(form.elements.filter((input) => !input.type || input.checked).map((input) => [input.name, input.value]));
      }
    },
  });
  if (loadPicker) vm.runInContext(read('assets/ds-topping-picker.js'), context);
  vm.runInContext(read('assets/product-form.js'), context);
  const picker = loadPicker ? new (definitions.get('ds-topping-picker'))() : new Element();
  const form = new Element();
  form.dataset = {};
  const fieldset = new Element();
  const error = { hidden: true };
  const radios = ['Chocolate', 'Caramelo', 'Dulce de leche'].map((value) => {
    const radio = new Element();
    Object.assign(radio, {
      form, type: 'radio', name: 'properties[Topping]', value, required: true, checked: false,
      matches: (selector) => selector === '[data-ds-topping-option]',
      checkValidity: () => {
        const valid = radios.some((option) => option.checked);
        if (!valid) picker.dispatchEvent(new Event('invalid', { cancelable: true }));
        return valid;
      },
      closest: () => picker,
      focus: () => { radio.focused = true; },
    });
    return radio;
  });
  const hidden = (name, value) => ({ name, value, matches: () => false, checkValidity: () => true });
  form.elements = [hidden('id', '68251098317104'), hidden('quantity', '1'), ...radios];
  form.elements.namedItem = (name) => form.elements.find((input) => input.name === name);
  picker.querySelectorAll = () => radios;
  picker.querySelector = (selector) => selector === 'fieldset' ? fieldset : error;
  if (loadPicker) picker.connectedCallback();
  const productForm = Object.create(definitions.get('product-form').prototype);
  Object.assign(productForm, {
    form, submitButton: new Element(), cart: null,
    querySelector: () => new Element(), handleErrorMessage() {}, createCartLinesUpdateEvent: () => null,
  });
  return { picker, form, fieldset, error, radios, productForm, requests };
}

test('native invalid capture cancels browser popup and shows one group error; disconnect releases the listener', () => {
  const { picker, fieldset, error, radios } = harness();
  assert.match(read('assets/ds-topping-picker.js'), /addEventListener\('invalid', this.onInvalid, true\)/);
  for (const radio of radios) {
    const invalid = new Event('invalid', { cancelable: true });
    assert.equal(picker.dispatchEvent(invalid), false);
    assert.equal(invalid.defaultPrevented, true);
    assert.equal(radio.getAttribute('aria-invalid'), null);
  }
  assert.equal(error.hidden, false);
  assert.equal(fieldset.getAttribute('aria-invalid'), 'true');
  assert.equal(radios[0].focused, true);
  picker.disconnectedCallback();
  assert.equal(picker.dispatchEvent(new Event('invalid', { cancelable: true })), true);
});

test('submit capture blocks add without choice, announces error and focuses first radio; choosing clears it', () => {
  const { picker, form, fieldset, error, radios, requests, productForm } = harness();
  let reachedFormHandler = false;
  form.addEventListener('submit', (event) => { reachedFormHandler = true; productForm.onSubmitHandler(event); });
  const event = new Event('submit', { cancelable: true });
  assert.equal(form.dispatchEvent(event), false);
  assert.equal(reachedFormHandler, false);
  assert.equal(requests.length, 0);
  assert.equal(error.hidden, false);
  assert.equal(fieldset.getAttribute('aria-invalid'), 'true');
  assert.ok(radios.every((radio) => radio.getAttribute('aria-invalid') === null));
  assert.equal(radios[0].focused, true);
  radios[1].checked = true;
  picker.dispatchEvent(new Event('change'));
  assert.equal(error.hidden, true);
  assert.equal(fieldset.getAttribute('aria-invalid'), 'false');
  assert.ok(radios.every((radio) => radio.getAttribute('aria-invalid') === null));
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  assert.equal(reachedFormHandler, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].config.body.get('properties[Topping]'), 'Caramelo');
});

test('direct AJAX handler cannot bypass validation, including before the custom element loads', () => {
  for (const loadPicker of [true, false]) {
    const { productForm, requests, radios, error } = harness({ loadPicker });
    const event = new Event('submit', { cancelable: true });
    productForm.onSubmitHandler(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(requests.length, 0);
    assert.equal(radios[0].focused, true);
    if (loadPicker) assert.equal(error.hidden, false);
  }
});

test('simulated variant ID change preserves associated property and quantity (does not execute product-info.js)', () => {
  const { picker, form, productForm, requests, radios } = harness();
  radios[2].checked = true;
  picker.dispatchEvent(new Event('change'));
  form.elements.namedItem('id').value = '68251098349872';
  form.elements.namedItem('quantity').value = '2';
  productForm.onSubmitHandler(new Event('submit', { cancelable: true }));
  const body = requests[0].config.body;
  assert.equal(body.get('id'), '68251098349872');
  assert.equal(body.get('quantity'), '2');
  assert.equal(body.get('properties[Topping]'), 'Dulce de leche');
  assert.equal(radios[2].checked, true);
  const info = read('assets/product-info.js');
  assert.doesNotMatch(info, /ds-topping|ds_topping/);
});

test('component disconnect/reconnect removes old form listeners and restores validation', () => {
  const { picker, form } = harness();
  picker.disconnectedCallback();
  assert.equal(form.dispatchEvent(new Event('submit', { cancelable: true })), true);
  picker.connectedCallback();
  assert.equal(form.dispatchEvent(new Event('submit', { cancelable: true })), false);
});

test('native cart templates print public properties and quantity changes preserve line properties', () => {
  for (const path of ['snippets/cart-drawer.liquid', 'sections/main-cart-items.liquid']) {
    const cart = read(path);
    assert.match(cart, /for property in item.properties/);
    assert.match(cart, /property.last != blank and property_first_char != '_'/);
    assert.match(cart, /<dt>{{ property.first }}:<\/dt>/);
    assert.match(cart, /{{ property.last }}/);
    assert.match(cart, /data-quantity-line-key="{{ item.key }}"/);
  }
  const cartJs = read('assets/cart.js');
  assert.match(cartJs, /JSON.stringify\(\{\s*line,\s*quantity,/);
  assert.match(cartJs, /routes.cart_change_url/);
});
