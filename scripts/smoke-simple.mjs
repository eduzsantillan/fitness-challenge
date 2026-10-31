// Explicit local-only smoke for the disposable preview. Never targets Neon/public URLs.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
export async function runSimpleSmoke(apiOrigin, origin) {
assert.equal(new URL(apiOrigin).hostname, '127.0.0.1', 'Smoke must only target a disposable loopback API.');
const base=`${apiOrigin}/api`;
async function request(path,method='GET',body,cookie,raw=false){
 const r=await fetch(base+path,{method,headers:{origin,...(body===undefined||raw?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await r.json(); return {status:r.status,data,cookie:r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ')};
}
async function account(name,email){
 const result=await request('/auth/sign-up/email','POST',{name,email,password:'Only-local-fictitious-2026!'});assert.equal(result.status,200);
 const cookie=result.cookie;assert.ok(cookie);
 const profile=await request('/me','PUT',{displayName:name,timeZone:'America/Toronto'},cookie);assert.equal(profile.status,200);assert.ok(profile.data.userCode);
 return {cookie,profile:profile.data};
}
const stamp=Date.now();
const alice=await account('María',`maria-simple-${stamp}@example.test`), bob=await account('Alex',`alex-simple-${stamp}@example.test`);
const created=await request('/challenges','POST',{title:'Brunch de domingo',durationDays:7,prize:'Un brunch y café para dos',shareConsent:true},alice.cookie);assert.equal(created.status,200);const id=created.data.challenge.id;
const first=await request('/steps','POST',{userCode:alice.profile.userCode,steps:6432},undefined,true);assert.equal(first.status,200);assert.equal(first.data.accepted,1);
const invite=await request(`/challenges/${id}/invites`,'POST',{},alice.cookie);assert.equal(invite.status,200);
const preview=await request(`/invites/${invite.data.token}`,'GET',undefined,bob.cookie);assert.equal(preview.status,200);assert.equal(preview.data.challenge.prize,'Un brunch y café para dos');
assert.equal((await request('/join','POST',{token:invite.data.token,shareConsent:true},bob.cookie)).status,200);
for(let i=0;i<2;i++)assert.equal((await request('/steps','POST',{userCode:bob.profile.userCode,steps:6100},undefined,true)).status,200);
const board=await request(`/challenges/${id}/leaderboard`,'GET',undefined,alice.cookie);assert.equal(board.status,200);assert.equal(board.data.rows.length,2);
assert.equal(board.data.rows.find(r=>r.userId===alice.profile.userId).steps,6432);assert.equal(board.data.rows.find(r=>r.userId===bob.profile.userId).steps,6100);
for(const who of [alice,bob])assert.ok(!JSON.stringify(board.data).includes(who.profile.userCode));
const history=await request('/me/activity','GET',undefined,bob.cookie);assert.equal(history.data.days.length,1);assert.equal(history.data.days[0].steps,6100);
assert.equal((await request(`/challenges/${id}/leaderboard`)).status,401);
console.log('Simple HTTP smoke passed: signup, profile zone/code, auto-enrolment, prize/duration, private invitation/join, headerless JSON step sync, daily deduplication, private history and no code leaks. Local disposable database only.');

}
if (process.argv[1] === fileURLToPath(import.meta.url)) await runSimpleSmoke('http://127.0.0.1:3001','http://127.0.0.1:5173');
