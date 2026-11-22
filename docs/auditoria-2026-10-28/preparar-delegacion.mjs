import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const source = resolve('C:/Users/Milton/orca/dayanas-sweet-web');
const target = resolve('C:/Users/Milton/orca/workspaces/dayanas-sweet-web/auditoria-bloques-20261028');
if (!target.startsWith(resolve('C:/Users/Milton/orca/workspaces/dayanas-sweet-web') + '\\')) throw new Error('Unexpected target');
const branch = spawnSync('git', ['branch','--show-current'], {cwd:target,encoding:'utf8'});
if(branch.status!==0 || branch.stdout.trim()!=='jAlexander15c/auditoria-bloques-20261028') throw new Error('Unexpected branch');
for (const dir of ['assets','config','layout','locales','sections','snippets','templates','tests']) await cp(join(source,dir),join(target,dir),{recursive:true});
for (const file of ['AGENTS.md','.shopifyignore','docs/orquestacion.md','.claude/agents/implementador.md','.claude/agents/revisor.md','.claude/agents/explorador.md']) {
  await mkdir(resolve(join(target,file),'..'),{recursive:true});
  await cp(join(source,file),join(target,file));
}
await cp(join(source,'docs/auditoria-2026-10-28'),join(target,'docs/auditoria-2026-10-28'),{recursive:true});
await mkdir(join(target,'docs/bloques-2026-10-28/specs'),{recursive:true});
const listed=spawnSync('git',['ls-files','assets','config','layout','locales','sections','snippets','templates'],{cwd:target,encoding:'utf8'});
const files=await Promise.all(listed.stdout.trim().split('\n').filter(Boolean).map(async file=>({file,sha256:createHash('sha256').update(await readFile(join(target,file))).digest('hex')})));
await writeFile(join(target,'docs/bloques-2026-10-28/baseline-theme.json'),JSON.stringify({source,target,createdAt:new Date().toISOString(),files},null,2)+'\n');
await writeFile(join(target,'docs/bloques-2026-10-28/estado-inicial.txt'),spawnSync('git',['status','--short'],{cwd:target,encoding:'utf8'}).stdout);
console.log(JSON.stringify({target,branch:branch.stdout.trim(),themeFiles:files.length,copiedLocalChanges:true}));
