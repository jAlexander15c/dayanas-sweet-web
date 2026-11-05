import { readFileSync } from 'node:fs';

// Shopify's theme editor prefixes generated JSON with a block comment.
export const parseShopifyJson = source => JSON.parse(source.replace(/^\s*\/\*[\s\S]*?\*\//, ''));
export const readShopifyJson = path => parseShopifyJson(readFileSync(path, 'utf8'));
