import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load(path,imports={}){const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;const exports={};new Function('exports','require',code)(exports,name=>name.endsWith('.css')?{}:imports[name]??require(name));return exports;}
const overallDomain=load('./member-overall.ts');
const attendanceDomain=load('./attendance.ts');
const domain=load('./mixed-zone.ts',{'./member-overall':overallDomain,'./attendance':attendanceDomain});
const eventId='71000000-0000-4000-8000-000000000001',targetId='71000000-0000-4000-8000-000000000002';
const scores=()=>Object.fromEntries(overallDomain.overallAxes.map(({key})=>[key,4]));
const entry=(revision=1)=>({...scores(),event_id:eventId,member_id:targetId,revision,updated_at:'2026-10-07T00:00:00Z'});
const member=(id,extra={})=>({id,name:'합성 회원 '+id,auth_user_id:id==='actor'?'owner':null,status:'active',is_test_account:false,must_change_password:false,...extra});
function deferred(){let resolve;let reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail});return{promise,resolve,reject};}
async function settle(){for(let n=0;n<6;n++)await Promise.resolve();}
function harness(path) {
  const slots = []; const effects = []; let cursor = 0; let nextEffects = []; let tree;
  const hooks = {
    useId: () => { const index = cursor++; return slots[index] ??= `test-${index}`; },
    useRef: (value) => { const index = cursor++; return slots[index] ??= { current: value }; },
    useState: (initial) => { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useEffect: (callback, dependencies) => { const index = cursor++; const before = effects[index]; if (!before || dependencies.some((value, i) => !Object.is(value, before.dependencies[i]))) nextEffects.push({ index, callback, dependencies }); },
  };
  const componentModule = load(path, { react: hooks, "@/lib/member-overall": overallDomain, "@/lib/mixed-zone": domain });
  const Component = componentModule.default;
  return {
    render(props) { cursor = 0; nextEffects = []; tree = Component(props); return renderToStaticMarkup(tree); },
    commit() { const pending = nextEffects; nextEffects = []; for (const effect of pending) { effects[effect.index]?.cleanup?.(); effects[effect.index] = { dependencies: effect.dependencies, cleanup: effect.callback() }; } },
    unmount() { for (const effect of effects) effect?.cleanup?.(); },
    replayEffects() { for (const effect of effects) effect?.cleanup?.(); effects.length = 0; },
    find(type, predicate = () => true) { const matches = []; const visit = (node) => { if (!node || typeof node !== "object") return; if (Array.isArray(node)) { node.forEach(visit); return; } if (node.type === type && predicate(node.props)) matches.push(node); visit(node.props?.children); }; visit(tree); return matches; },
  };
}

function fixture(extra={}){
  const now=Date.now(),state={current:true},calls=[],actor=member('actor');
  const event={id:eventId,starts_at:new Date(now-4*3600000).toISOString(),ends_at:null,mixed_zone_days:3};
  const access={scope:'owner:1',version:0,isCurrent:()=>state.current,refreshWindow:async()=>{calls.push(['refresh'])},read:async(id,current)=>{calls.push(['read',id,current]);return[]},save:async(id,target,values,revision,current)=>{calls.push(['save',id,target,values,revision,current]);return{...entry(revision+1),...values}},...extra};
  const view=harness('../components/mixed-zone-panel.tsx'),props={event,profiles:[actor,member(targetId)],actor,owner:'owner',attendance:[{event_id:eventId,member_id:'actor',check_in_status:'present'},{event_id:eventId,member_id:targetId,check_in_status:'late'}],access,pending:false,onRetry:()=>{calls.push(['retry'])}};
  return{view,props,access,state,calls,async ready(){view.render(props);view.commit();await settle();return view.render(props)},select(id=targetId){view.find('select')[0].props.onChange({target:{value:id}});view.render(props)},choose(){for(const {key} of overallDomain.overallAxes){view.find('input',p=>p.name.endsWith('-'+key)&&p.value===4)[0].props.onChange();view.render(props)}},async submit(){view.find('form')[0].props.onSubmit({preventDefault(){}});await settle();}};
}
test('mixed zone window uses end or two hours and enforces exact half open boundaries',()=>{
  const starts=Date.parse('2026-10-01T00:00:00Z'),event={starts_at:new Date(starts).toISOString(),ends_at:null,mixed_zone_days:3};
  assert.equal(domain.getMixedZoneWindow(event,starts).state,'waiting');const open=starts+2*3600000,close=open+3*86400000;assert.equal(domain.getMixedZoneWindow(event,open).state,'open');assert.equal(domain.getMixedZoneWindow(event,close-1).state,'open');assert.equal(domain.getMixedZoneWindow(event,close).state,'closed');
  for(const patch of [{mixed_zone_days:0},{mixed_zone_days:31},{mixed_zone_days:1.5},{mixed_zone_days:undefined},{ends_at:'invalid'},{ends_at:undefined},{starts_at:'bad'},{ends_at:event.starts_at}])assert.equal(domain.getMixedZoneWindow({...event,...patch},open).state,'unknown');
});
test('mixed zone entries require six deliberate integer scores and reject mixed event or duplicate rows',()=>{
  assert.ok(domain.isMixedZoneScores(scores()));assert.equal(domain.isMixedZoneScores(domain.emptyMixedZoneInputs()),false);
  for(const value of [0,6,1.5,'3',null])assert.equal(domain.isMixedZoneScores({...scores(),pace:value}),false);
  assert.equal(domain.isMixedZoneScores({...scores(),extra:3}),false);assert.deepEqual(domain.parseMixedZoneRows([entry()],eventId),[entry()]);
  for(const data of [null,[entry(),entry()],[{...entry(),event_id:'other'}],[{...entry(),revision:0}],[{...entry(),physical:0}],[{...entry(),updated_at:'bad'}]])assert.throws(()=>domain.parseMixedZoneRows(data,eventId),domain.MixedZoneError);
});
test('actual participants only can write and closed participants can still read own responses',()=>{
  const f=fixture();assert.deepEqual(domain.mixedZoneEligibility(f.props.actor,'owner',f.props.event,f.props.attendance,Date.now()),{canRead:true,canWrite:true,reason:null});
  for(const patch of [{status:'inactive'},{must_change_password:true},{is_test_account:true},{auth_user_id:'other'}])assert.equal(domain.mixedZoneEligibility({...f.props.actor,...patch},'owner',f.props.event,f.props.attendance,Date.now()).canRead,false);
  for(const status of [null,'absent'])assert.equal(domain.mixedZoneEligibility(f.props.actor,'owner',f.props.event,[{event_id:eventId,member_id:'actor',check_in_status:status}],Date.now()).canRead,false);
  assert.equal(domain.mixedZoneEligibility(f.props.actor,'owner',f.props.event,[{event_id:eventId,member_id:'actor',check_in_status:null,checked_in_at:'2026-10-07T00:00:00Z'}],Date.now()).canWrite,true);
  const deadline=domain.getMixedZoneWindow(f.props.event).closesAt;const closed=domain.mixedZoneEligibility(f.props.actor,'owner',f.props.event,f.props.attendance,deadline);assert.equal(closed.canRead,true);assert.equal(closed.canWrite,false);
  assert.equal(domain.isMixedZoneTarget(f.props.actor,'actor',eventId,f.props.attendance),false);assert.equal(domain.isMixedZoneTarget(member(targetId,{is_test_account:true}),'actor',eventId,f.props.attendance),false);assert.equal(domain.isMixedZoneTarget(member(targetId),'actor','other',f.props.attendance),false);
});
test('real panel starts with voluntary target selection and thirty unselected native radios',async()=>{
  const f=fixture();await f.ready();assert.equal(f.view.find('form').length,0);assert.equal(f.view.find('select')[0].props.value,'');f.select();assert.equal(f.view.find('input').length,30);assert.ok(f.view.find('input').every(node=>node.props.checked===false));assert.equal(f.view.find('button',p=>p.type==='submit')[0].props.disabled,true);assert.equal(f.calls.filter(c=>c[0]==='save').length,0);
  f.choose();assert.equal(f.view.find('button',p=>p.type==='submit')[0].props.disabled,false);const html=f.view.render(f.props);assert.equal((html.match(/<fieldset/g)??[]).length,6);assert.match(html,/aria-label="속도 4점"/);await f.submit();assert.match(f.view.render(f.props),/평가를 저장했습니다/);assert.equal(f.calls.find(c=>c[0]==='save')[4],0);
});
test('panel edits only its saved entry with CAS and rejects duplicate submissions',async()=>{
  const gate=deferred(),f=fixture({read:async()=>[entry(3)],save:async(...args)=>{f.calls.push(['save',...args]);return gate.promise}});await f.ready();f.select();assert.ok(f.view.find('input',p=>p.value===4).every(n=>n.props.checked));const submit=f.view.find('form')[0].props.onSubmit;submit({preventDefault(){}});submit({preventDefault(){}});assert.equal(f.calls.filter(c=>c[0]==='save').length,1);assert.equal(f.calls.find(c=>c[0]==='save')[4],3);gate.resolve(entry(4));await settle();assert.match(f.view.render(f.props),/평가를 저장했습니다/);
});
test('uncertain, conflicted and malformed saves force a fresh read and preserve recovery',async()=>{
  for(const error of [new domain.MixedZoneError('conflict'),new Error('synthetic timeout')]){const f=fixture({save:async()=>{throw error}});await f.ready();f.select();f.choose();await f.submit();f.view.render(f.props);assert.equal(f.view.find('button',p=>p.type==='submit').length,0);assert.match(f.view.render(f.props),/작성 내용 다시 불러오기/);f.view.find('button',p=>p.children==='작성 내용 다시 불러오기')[0].props.onClick();await settle();assert.equal(f.calls.filter(c=>c[0]==='refresh').length,1);assert.equal(f.calls.filter(c=>c[0]==='read').length,2);}
  for(const value of [null,{...entry(),revision:6},{...entry(),pace:3},{...entry(),member_id:'other'}]){const f=fixture({save:async()=>value});await f.ready();f.select();f.choose();await f.submit();assert.match(f.view.render(f.props),/저장 결과를 확인하지 못했습니다/);assert.doesNotMatch(f.view.render(f.props),/평가를 저장했습니다/);}
});
test('actor, event, target and attendance ABA immediately purge drafts and reject late replies',async()=>{
  for(const mutate of [f=>{f.props.owner='another'},f=>{f.props.event={...f.props.event,mixed_zone_days:4}},f=>{f.props.profiles=[f.props.actor,member(targetId,{status:'inactive'})]},f=>{f.props.attendance=f.props.attendance.map(r=>r.member_id===targetId?{...r,check_in_status:'absent'}:r)},f=>{f.state.current=false}]){
    const gate=deferred(),f=fixture({save:()=>gate.promise});await f.ready();f.select();f.choose();f.view.find('form')[0].props.onSubmit({preventDefault(){}});const original={...f.props};mutate(f);assert.doesNotMatch(f.view.render(f.props),/내가 작성한 평가|checked=""/);Object.assign(f.props,original);f.state.current=true;f.view.render(f.props);gate.resolve(entry());await settle();assert.doesNotMatch(f.view.render(f.props),/평가를 저장했습니다/);
  }
});
test('stale target submit cannot write after selection changes and unmount discards late reads',async()=>{
  const f=fixture();await f.ready();f.select();f.choose();const submit=f.view.find('form')[0].props.onSubmit;f.select('');submit({preventDefault(){}});await settle();assert.equal(f.calls.filter(c=>c[0]==='save').length,0);
  const gate=deferred(),late=fixture({read:()=>gate.promise});late.view.render(late.props);late.view.commit();late.view.unmount();gate.resolve([entry()]);await settle();assert.doesNotMatch(late.view.render(late.props),/작성 완료/);
});
test('closed panel reads existing evaluations but disables editing and hides save',async()=>{
  const f=fixture({read:async()=>[entry()]});f.props.event={...f.props.event,starts_at:new Date(Date.now()-8*86400000).toISOString()};await f.ready();f.select();const html=f.view.render(f.props);assert.match(html,/작성이 마감되었습니다/);assert.equal(f.view.find('button',p=>p.type==='submit').length,0);assert.ok(f.view.find('fieldset').every(n=>n.props.disabled));assert.equal(f.view.find('input',p=>p.checked).length,6);
});

test('actual boundary timer and long return focus refresh server event state before re-reading own entries',async()=>{
  const originalNow=Date.now,windowDescriptor=Object.getOwnPropertyDescriptor(globalThis,'window'),documentDescriptor=Object.getOwnPropertyDescriptor(globalThis,'document');
  let now=Date.parse('2026-10-07T00:00:00Z');Date.now=()=>now;const timers=[],listeners=new Map();
  Object.defineProperty(globalThis,'window',{configurable:true,value:{setTimeout:(callback,delay)=>{timers.push({callback,delay});return timers.length},clearTimeout:()=>{},addEventListener:(name,callback)=>listeners.set(name,callback),removeEventListener:name=>listeners.delete(name)}});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{body:{},activeElement:{},visibilityState:'visible',addEventListener:(name,callback)=>listeners.set(name,callback),removeEventListener:name=>listeners.delete(name)}});
  try{
    const f=fixture();f.props.event={...f.props.event,ends_at:new Date(now+50).toISOString()};await f.ready();assert.equal(timers[0].delay,50);now+=50;timers[0].callback();await settle();f.view.render(f.props);assert.equal(f.calls.filter(c=>c[0]==='refresh').length,1);assert.equal(f.calls.filter(c=>c[0]==='read').length,2);
    now+=60001;listeners.get('focus')();await settle();f.view.render(f.props);assert.equal(f.calls.filter(c=>c[0]==='refresh').length,2);assert.equal(f.calls.filter(c=>c[0]==='read').length,3);
    f.view.unmount();assert.equal(listeners.size,0);
  }finally{Date.now=originalNow;if(windowDescriptor)Object.defineProperty(globalThis,'window',windowDescriptor);else delete globalThis.window;if(documentDescriptor)Object.defineProperty(globalThis,'document',documentDescriptor);else delete globalThis.document;}
});
test('target selection ABA cannot reuse a previous form submit or mutate another draft',async()=>{
  const f=fixture();await f.ready();f.select();f.choose();const oldSubmit=f.view.find('form')[0].props.onSubmit,oldChange=f.view.find('input',p=>p.value===1)[0].props.onChange;f.select('');f.select();oldChange();oldSubmit({preventDefault(){}});await settle();f.view.render(f.props);assert.equal(f.calls.filter(c=>c[0]==='save').length,0);assert.ok(f.view.find('input').every(n=>!n.props.checked));
});
test('saved response after local deadline still confirms server result and then becomes read only',async()=>{
  const originalNow=Date.now;let now=Date.parse('2026-10-07T00:00:00Z');Date.now=()=>now;
  try{const gate=deferred(),f=fixture({save:()=>gate.promise});f.props.event={...f.props.event,starts_at:new Date(now-2*3600000-3*86400000+50).toISOString()};await f.ready();f.select();f.choose();f.view.find('form')[0].props.onSubmit({preventDefault(){}});now+=50;gate.resolve(entry());await settle();const html=f.view.render(f.props);assert.match(html,/평가를 저장했습니다/);assert.equal(f.view.find('button',p=>p.type==='submit').length,0);assert.ok(f.view.find('fieldset').every(n=>n.props.disabled));f.view.commit();}finally{Date.now=originalNow;}
});
