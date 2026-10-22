import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const testRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

// Historical outputs are evidence, not executable test discovery roots.
export function selectTestFiles(args=[],{root=testRoot,platform=process.platform}={}){
  const flags=new Set(args.filter(arg=>arg.startsWith('--')));
  for(const flag of flags)if(!['--include-private','--private-only','--windows-only'].includes(flag))throw new Error('Unknown test suite option: '+flag);
  const explicit=args.filter(arg=>!arg.startsWith('--'));
  if(flags.has('--windows-only')&&platform!=='win32')throw new Error('Windows tests require a Windows runner; they cannot be skipped.');
  if(flags.has('--windows-only')&&(flags.has('--private-only')||flags.has('--include-private')))throw new Error('Choose one test suite.');
  if(explicit.length&&flags.size)throw new Error('Explicit files cannot be combined with suite selectors.');
  if(explicit.length)return explicit.map(file=>{
    const full=path.resolve(root,file);
    if(!full.startsWith(root+path.sep)||!fs.statSync(full).isFile()||!/\.test\.(?:js|mjs|cjs)$/.test(full))throw new Error('Invalid test file: '+file);
    return path.relative(root,full);
  }).sort();
  const dirs=flags.has('--windows-only')?['tests-platform/windows']:flags.has('--private-only')?['acceptance/private']:['tests',...(platform==='win32'?['tests-platform/windows']:[]),...(flags.has('--include-private')?['acceptance/private']:[])];
  const files=[];
  for(const dir of dirs){
    const start=files.length;
    const walk=directory=>{for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
      const full=path.join(directory,entry.name);
      if(entry.isDirectory())walk(full);
      else if(entry.isFile()&&/\.test\.(?:js|mjs|cjs)$/.test(entry.name))files.push(path.relative(root,full));
    }};
    walk(path.join(root,dir));
    if(files.length===start)throw new Error('Required test suite is empty: '+dir);
  }
  return files.sort();
}

export function testSummaryPassed(summary){
  return summary.tests>0&&summary.fail===0&&summary.cancelled===0&&summary.skipped===0&&summary.todo===0&&summary.pass===summary.tests;
}

export async function runTestSuite(args=[],{root=testRoot,env=process.env}={}){
  const files=selectTestFiles(args,{root});
  console.log('Running '+files.length+' test files from explicit suites; skips are failures.');
  const child=spawn(process.execPath,['--require',path.join(root,'scripts/windows-browser-lockout-guard.cjs'),'--test','--test-reporter=tap',...files],{cwd:root,env,stdio:['inherit','pipe','inherit'],windowsHide:true});
  let pending='';const summary={};
  const read=line=>{const match=/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$/.exec(line);if(match)summary[match[1]]=Number(match[2]);};
  child.stdout.on('data',chunk=>{process.stdout.write(chunk);pending+=chunk.toString();const lines=pending.split('\n');pending=lines.pop();for(const line of lines)read(line.trimEnd());});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code??1));});
  if(pending)read(pending);
  if(code)return code;
  if(!testSummaryPassed(summary)){console.error('Test gate rejected incomplete, skipped or failing validation: '+JSON.stringify(summary));return 1;}
  return 0;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{process.exitCode=await runTestSuite(process.argv.slice(2));}catch(error){console.error(error.message);process.exitCode=1;}
}
