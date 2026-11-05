import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {readShopifyJson} from './helpers/shopify-json.mjs';

const read = path => readFileSync(path, 'utf8');
const active = path => {
  const data = readShopifyJson(path);
  return data.order.filter(id => !data.sections[id].disabled).map(id => data.sections[id].type);
};

test('the approved storefront renders the new home, header and footer instead of the old layout', () => {
  assert.deepEqual(active('templates/index.json'), ['ds-redesign-home']);
  assert.deepEqual(active('sections/header-group.json'), ['ds-redesign-header']);
  assert.deepEqual(active('sections/footer-group.json'), ['ds-redesign-footer']);
});

test('the active layout loads the isolated styles and interactions and all referenced local assets exist', () => {
  const layout = read('layout/theme.liquid');
  assert.match(layout, /'ds-redesign.css'\s*\|\s*asset_url/);
  assert.match(layout, /'ds-redesign.js'\s*\|\s*asset_url/);
  assert.match(layout, /<body class="[^"\n]*ds-redesign/);
  const css = read('assets/ds-redesign.css');
  for (const match of css.matchAll(/url\((?:['"])?([^)'"\s]+)(?:['"])?\)/g)) {
    assert.ok(existsSync(`assets/${match[1]}`), match[1]);
  }
});

test('reduced motion in the redesign leaves the native drawer visibility transition available for its focus trap', () => {
  const css = read('assets/ds-redesign.css');
  // Dawn initializes keyboard focus on transitionend. A page-wide transition:none
  // removes that event; redesign rules must target its own components instead.
  const globalReset = /(?:^|[},])\s*\*(?:::before|::after)?\s*(?:,|\{)[^{}]*transition\s*:\s*none/i;
  assert.equal(globalReset.test(css), false, 'A universal transition reset also disables the native drawer focus lifecycle');
});

test('the active layout preserves Shopifys selectable cart notification mode and its native assets', () => {
  const layout = read('layout/theme.liquid');
  const notificationBlocks = [...layout.matchAll(/{%-?\s*(?:if|elsif) settings\.cart_type == 'notification'\s*-?%}([\s\S]*?){%-?\s*endif\s*-?%}/g)].map(match => match[1]);
  assert.ok(notificationBlocks.some(block => block.includes("render 'cart-notification'")), 'Notification mode must render its native cart component');
  assert.ok(layout.includes("'component-cart-notification.css' | asset_url"), 'Notification CSS must be loaded');
  assert.ok(layout.includes("'cart-notification.js' | asset_url"), 'Notification behavior must be loaded');
});
