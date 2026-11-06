import { readFileSync, writeFileSync } from 'node:fs';
// Local workerd cannot start with a service binding to a Worker that is not
// running locally. Tests use the real config minus the CELEBRACIONES binding;
// the gateway itself is covered by forwardToCelebraciones unit tests.
export function testConfig() {
  const source = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const stripped = source.split('\n').filter(line => !line.includes('"binding": "CELEBRACIONES"')).join('\n');
  if (stripped.includes('CELEBRACIONES')) throw Error('No pude quitar el binding CELEBRACIONES de la configuración de prueba.');
  writeFileSync(new URL('../wrangler.test.jsonc', import.meta.url), stripped);
  return 'wrangler.test.jsonc';
}
