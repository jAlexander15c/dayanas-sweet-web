// Dependency-free checks. Shopify's full Liquid lint is run separately with Theme Check.
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseShopifyJson, readShopifyJson } from './helpers/shopify-json.mjs';

let scripts = 0, json = 0, schemas = 0;
for (const file of readdirSync('assets').filter(file => file.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', `assets/${file}`], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || `Syntax check failed: ${file}`);
  scripts++;
}
for (const dir of ['config', 'locales', 'sections', 'templates']) {
  for (const file of readdirSync(dir).filter(file => file.endsWith('.json'))) {
    readShopifyJson(`${dir}/${file}`);
    json++;
  }
}
for (const file of readdirSync('sections').filter(file => file.endsWith('.liquid'))) {
  const source = readFileSync(`sections/${file}`, 'utf8');
  const schema = source.match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/);
  if (schema) { parseShopifyJson(schema[1]); schemas++; }
}
console.log(`Valid: ${scripts} JavaScript files, ${json} JSON files, ${schemas} section schemas.`);
