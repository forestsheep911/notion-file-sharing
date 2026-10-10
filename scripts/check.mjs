import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = path.dirname(fileURLToPath(import.meta.url));
function files(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e => e.isDirectory() ? files(path.join(dir,e.name)) : e.name.endsWith(".mjs") ? [path.join(dir,e.name)] : []); }
for (const file of files(root)) {
  const r=spawnSync(process.execPath,["--check",file],{stdio:"inherit",windowsHide:true});
  if(r.status!==0) process.exit(r.status || 1);
}
const r=spawnSync(process.execPath,["--test",...files(root).filter(f=>f.endsWith(".test.mjs"))],{stdio:"inherit",windowsHide:true});
process.exitCode=r.status || 0;
