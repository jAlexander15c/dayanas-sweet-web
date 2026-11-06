import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const read=path=>readFileSync(path,'utf8');
const manifest=JSON.parse(read('tests/font-subsets.json'));
const css=read('assets/ds-redesign.css'),layout=read('layout/theme.liquid');

test('all five font variants are genuine compressed WOFF2 with content-addressed assets',()=>{
 assert.equal(manifest.fonts.length,5);
 for(const font of manifest.fonts){
  const bytes=readFileSync('assets/'+font.file);
  assert.equal(bytes.toString('ascii',0,4),'wOF2');
  assert.equal(bytes.readUInt32BE(8),bytes.length);
  assert.equal(bytes.length,font.afterBytes);
  assert.equal(font.file,`ds-r-font-${createHash('sha256').update(bytes).digest('hex').slice(0,12)}.woff2`);
  assert.ok(bytes.length<font.beforeBytes*.45);
  assert.ok(css.includes(`url(${font.file}) format('woff2')`));
 }
});

test('font optimization preserves every family, style, weight and swap policy',()=>{
 const before=execFileSync('git',['show',`${manifest.base}:assets/ds-redesign.css`],{encoding:'utf8'});
 const normalize=text=>text.replace(/ds-r-font-[a-f0-9]+\.woff2/g,'FONT').replaceAll("format('truetype')","format('woff2')").replaceAll('\r\n','\n');
 assert.equal(normalize(css),normalize(before));
 assert.equal((css.match(/font-display: swap/g)||[]).length,5);
});

test('only two shared visible fonts are preloaded with URLs matching the stylesheet',()=>{
 const preloads=layout.split('\n').filter(line=>line.includes('as="font"'));
 assert.equal(preloads.length,2);
 for(const line of preloads){
  assert.match(line,/split: '\?' \| first/);
  assert.match(line,/type="font\/woff2" crossorigin/);
  const name=line.match(/ds-r-font-[a-f0-9]+\.woff2/)[0];
  assert.ok(css.includes(`url(${name})`));
  const font=manifest.fonts.find(f=>f.file===name);
  assert.equal(font.weight,400);assert.equal(font.italic,false);
 }
 assert.ok(preloads.every(line=>!line.includes('settings.type_')));
});
