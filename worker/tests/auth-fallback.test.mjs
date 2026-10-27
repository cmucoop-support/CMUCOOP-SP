import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as source from '../index.js';
import {D1} from './d1.mjs';

async function checkSessions(module) {
 const DB=new D1();await DB.install(module.SCHEMA);
 for(const username of ['tester.name','ผู้ใช้.ทดสอบ','normal'])DB.db.prepare('INSERT INTO users(username,salt,hash,role,name,perms) VALUES(?,?,?,?,?,?)').run(username,'salt',await module.sha256hex('salt|pass1234'),'viewer',username,'{}');
 const execute=DB.execute.bind(DB);
 DB.execute=q=>{if(/^(?:INSERT|UPDATE|DELETE).*sessions/i.test(q.sql))throw new Error("D1_ERROR: Your account has exceeded D1's free tier daily row write limit.");return execute(q);};
 const C={env:{DB}};
 for(const username of ['tester.name','ผู้ใช้.ทดสอบ','normal']){
  const login=await module.API.login(C,username,'pass1234');
  assert.ok(login.token.startsWith('s1.'));
  assert.equal((await module.API.whoami(C,login.token)).user,username);
  await assert.rejects(module.API.whoami(C,login.token.slice(0,-1)+'x'),/SESSION_EXPIRED/);
  const pieces=login.token.split('.');pieces[pieces.length-2]=String(Date.now()-1000);
  await assert.rejects(module.API.whoami(C,pieces.join('.')),/SESSION_EXPIRED/);
 }
}
test('fallback sessions accept dotted and Thai usernames and reject tampered or expired tokens',()=>checkSessions(source));
test('Dashboard Worker has the same schema and APIs and supports the repaired fallback sessions',async()=>{
 const text=await fs.readFile(new URL('../../Cloudflare-Worker/worker-copy.txt',import.meta.url),'utf8');
 const bundled=await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
 assert.deepEqual(Object.keys(bundled.API).sort(),Object.keys(source.API).sort());
 assert.deepEqual(bundled.SCHEMA,source.SCHEMA);
 await checkSessions(bundled);
});

