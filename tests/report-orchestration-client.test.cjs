const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'report-orchestration-client.js'), 'utf8');
const complete = (id, round = 0, extra = {}) => ({
  id, runId: `run-${id}`, status: 'completed', text: `完整候选 ${id}`,
  quality: { status: 'blocked', issues: [{ code: 'section-budget', repairable: true }] },
  repair: { round, canRetry: round < 2, rootId: 'root' }, ...extra,
});
const protocolCandidate = (id, round = 0, extra = {}) => complete(id, round, {
  rawText: `原始JSON ${id}`, structuredText: `结构化候选 ${id}`,
  quality: {
    status: 'blocked', factsVerified: false,
    issues: [{ code: 'structured-heading', severity: 'error', repairable: true }],
    failure: { categories: ['structure'], protocolRepairEligible: true },
  },
  repair: { round, maxRounds: 2, rootId: round ? 'root' : null, canRetry: round < 2, canProtocolRetry: round < 2 },
  ...extra,
});
const automatic = extra => ({ autoRepair: true, beforeRepair: async () => true, ...extra });
const structureInput={sectionKey:'市场分析 / 需求分析',qualityContract:{planId:'bound-plan'}};
const structureCandidate=(id,round=0)=>protocolCandidate(id,round,{
  quality:{status:'blocked',factsVerified:false,issues:[{code:'heading-structure-missing',severity:'error',repairable:true},{code:'missing-table',severity:'error',repairable:false,message:'缺少职责必要表：需求与产品匹配分析表；缺证据不得造数'}],failure:{categories:['structure','evidence'],protocolRepairEligible:false},targetedRepair:{version:'missing-structure-patch-v1',sectionKey:structureInput.sectionKey,planId:'bound-plan',headingCount:1,tableTitles:['需求与产品匹配分析表'],targetIds:['heading-1','table-0']}},
  repair:{round,maxRounds:2,canRetry:round<2,canProtocolRetry:false,canTargetedRetry:round<2},
});

// Run the actual browser client with deterministic HTTP responses and a virtual clock.
// Only timer scheduling is simulated; no server, AI provider, or project is modified.
function harness(steps) {
  let now = 0, sequence = 0;
  const timers = new Map(), requests = [], received = [], timerDelays = [];
  const context = {
    URLSearchParams, AbortController, TypeError, Error,
    Date: { now: () => now },
    authHeaders: () => ({ Authorization: 'test-only' }),
    setTimeout(callback, delay) {
      const id = ++sequence;
      timerDelays.push(delay);
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    async fetch(url, options) {
      const step = steps[requests.length];
      requests.push({ url, ...options, payload: options.body ? JSON.parse(options.body) : undefined });
      assert.ok(step, `unexpected HTTP request ${options.method} ${url}`);
      now += step.advance || 0;
      if (step.hang) return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
      });
      if (step.throw) throw step.throw;
      return {
        ok: step.httpOk !== false,
        async json() {
          if (step.invalidJson) throw new SyntaxError('invalid JSON');
          if (step.jsonError) throw step.jsonError;
          return step.body || { ok: true, task: step.task };
        },
      };
    },
  };
  vm.runInNewContext(source, context, { filename: 'report-orchestration-client.js' });
  return {
    requests, received, timerDelays, timers,
    async run(input = { sectionKey: '4.1', prompt: '原始提示', qualityContract: { version: 'test-v1' } }, options) {
      let settled = false, result, error;
      context.ReportOrchestrationClient.generateSection(input, task => received.push(task), options)
        .then(value => { result = value; settled = true; }, value => { error = value; settled = true; });
      for (let iteration = 0; !settled && iteration < 1000; iteration++) {
        for (let microtask = 0; microtask < 40; microtask++) await Promise.resolve();
        if (!settled && timers.size) {
          const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
          timers.delete(id);
          now = Math.max(now, timer.at);
          timer.callback();
        }
      }
      assert.equal(settled, true, 'client did not settle within the bounded virtual schedule');
      assert.equal(timers.size, 0, 'request timers must be cleaned up');
      if (error) throw error;
      return result;
    },
  };
}

test('服务端绑定的缺失主题/定性表追加走原项目权限复核且最多两轮，不改质量或重启完整生成',async()=>{
  let guards=0;
  const root=structureCandidate('root'),one=structureCandidate('one',1),two=structureCandidate('two',2),h=harness([{task:root},{task:one},{task:two}]);
  const result=await h.run(structureInput,automatic({beforeRepair:async()=>{guards++;return true;}}));
  assert.equal(guards,2);assert.equal(result.id,'two');assert.equal(result.quality.status,'blocked');assert.equal(result.quality.factsVerified,false);
  assert.deepEqual(h.requests.map(r=>r.payload),[structureInput,{action:'repair',id:'root'},{action:'repair',id:'one'}]);
  assert.equal(result.repairHistory.length,3);
});

test('定性补写不接受客户端未绑定身份、数值表、事实或未知错误，原稿完整返回',async()=>{
  for(const mutate of [
    task=>{delete task.repair.canTargetedRetry;},task=>{task.quality.targetedRepair.planId='other';},task=>{task.quality.targetedRepair.sectionKey='other';},
    task=>{task.quality.targetedRepair.tableTitles=['资金筹措表'];task.quality.issues[1].message='缺少职责必要表：资金筹措表；';},
    task=>{task.quality.issues.push({code:'missing-fact',severity:'error',repairable:true});},
    task=>{task.quality.issues.push({code:'gap-reference-count',severity:'error',repairable:true});},
    task=>{task.quality.issues.push({code:'unknown',severity:'error',repairable:true});},
    task=>{task.quality.targetedRepair.targetIds=['heading-1','heading-1'];},task=>{task.rulesChanged=true;},task=>{task.quality.issues[1].requiresPlanReview=true;},
  ]){
    const candidate=structureCandidate('root');mutate(candidate);const h=harness([{task:candidate}]);
    assert.equal(await h.run(structureInput,automatic()),candidate);assert.equal(h.requests.length,1);
  }
  const candidate=structureCandidate('root'),h=harness([{task:candidate}]);assert.equal(await h.run(structureInput),candidate);assert.equal(h.requests.length,1);
  const denied=harness([{task:structureCandidate('root')}]);await assert.rejects(denied.run(structureInput,automatic({beforeRepair:async()=>false})),/未通过复核/);assert.equal(denied.requests.length,1);
});

test('completed blocked candidate is returned intact without implicitly starting a repair', async () => {
  const root = complete('root');
  const h = harness([
    { task: { id: 'root', status: 'queued' } }, { task: root },
  ]);
  assert.equal(await h.run(), root);
  assert.deepEqual(h.requests.map(request => request.method), ['POST', 'GET']);
  assert.equal(h.requests.filter(request => request.payload?.action === 'repair').length, 0);
  assert.equal(h.requests.filter(request => request.payload?.prompt).length, 1);
  assert.ok(h.requests.filter(request => request.method === 'GET').every(request => request.body === undefined));
  assert.ok(h.requests.every(request => request.headers.Authorization === 'test-only'));
  assert.equal(h.received.length, 2);
  assert.equal(root.quality.status, 'blocked', 'showing a candidate must not turn content into a pass');
});

test('刷新恢复只GET原付费任务，精确绑定后台轮次和输入；blocked不触发返修POST',async()=>{
  const recovery={taskId:'saved',backendRunId:'run-saved',inputHash:'sha-original'},bind=task=>({...task,runId:'run-saved',graph:[{key:'context_snapshot',hash:'sha-original'}]});
  const completed=bind(protocolCandidate('saved')),h=harness([{task:bind({id:'saved',status:'running'})},{task:completed}]);
  assert.equal(await h.run(undefined,{recovery,...automatic()}),completed);
  assert.deepEqual(h.requests.map(r=>r.method),['GET','GET']);
  assert.ok(h.requests.every(r=>r.url.endsWith('?id=saved')&&r.body===undefined));
  assert.equal(h.received.length,2);
});

test('恢复缺任务身份、返回串任务或明确失败均不新提交，不接收串任务',async()=>{
  const recovery={taskId:'saved',backendRunId:'run-saved',inputHash:'sha-original'};
  for(const bad of [null,{}, {...recovery,taskId:''},{...recovery,inputHash:''},{...recovery,backendRunId:''}]){
    const h=harness([]);await assert.rejects(h.run(undefined,{recovery:bad}),/记录不完整/);assert.equal(h.requests.length,0);
  }
  for(const task of [
    {...complete('other'),graph:[{key:'context_snapshot',hash:'sha-original'}]},
    {...complete('saved'),runId:'other-run',graph:[{key:'context_snapshot',hash:'sha-original'}]},
    {...complete('saved'),graph:[{key:'context_snapshot',hash:'other-hash'}]},
  ]){
    const h=harness([{task}]);await assert.rejects(h.run(undefined,{recovery}),/不一致/);
    assert.deepEqual(h.requests.map(r=>r.method),['GET']);assert.equal(h.received.length,0);
  }
  const task={id:'saved',runId:'run-saved',status:'failed',error:'上游暂不可用',graph:[{key:'context_snapshot',hash:'sha-original'}]},h=harness([{task}]);
  await assert.rejects(h.run(undefined,{recovery}),error=>error.requestDefinitelyFailed===true&&error.taskId==='saved');
  assert.deepEqual(h.requests.map(r=>r.method),['GET']);
});

test('an explicitly requested repair submits once and returns even if it is still blocked', async () => {
  const candidate = complete('repair-1', 1);
  const h = harness([{ task: { id: 'repair-1', status: 'queued' } }, { task: candidate }]);
  assert.equal(await h.run({ action: 'repair', id: 'root' }), candidate);
  assert.equal(h.requests.filter(request => request.method === 'POST').length, 1);
  assert.deepEqual(h.requests[0].payload, { action: 'repair', id: 'root' });
  assert.equal(h.requests.filter(request => request.payload?.prompt).length, 0);
});

test('a complete start response is shown immediately without polling or repair', async () => {
  const candidate = complete('root');
  const h = harness([{ task: candidate }]);
  assert.equal(await h.run(), candidate);
  assert.equal(h.requests.length, 1);
});

test('真实简短POST回执先保留，GET同一任务完整信息后才通知正文接收器', async () => {
  const receipt={id:'root',reused:false,runId:'run-root'},final=complete('root',0,{graph:[{key:'context_snapshot',hash:'source-hash'}]});
  const h=harness([{task:receipt},{task:final}]);
  assert.equal(await h.run(),final);
  assert.deepEqual(h.requests.map(r=>r.method),['POST','GET']);
  assert.equal(h.requests[1].url,'/api/reportexecution?id=root');
  assert.deepEqual(h.received,[final]);
});

test('简短启动回执后GET断线仍保留原编号和轮次，不把回执冒充完整任务或重发', async () => {
  const receipt={id:'root',reused:true,runId:'run-root'},failure={throw:new TypeError('network disconnected')};
  const h=harness([{task:receipt},failure,failure,failure]);
  await assert.rejects(h.run(),error=>error.code==='REPORT_TASK_CONNECTION'&&error.task===receipt&&error.taskId==='root');
  assert.deepEqual(h.requests.map(r=>r.method),['POST','GET','GET','GET']);
  assert.deepEqual(h.received,[]);
});

test('异常启动回执没有后台轮次时保留已知编号并停止，不能重新POST', async () => {
  const receipt={id:'root',reused:false},h=harness([{task:receipt}]);
  await assert.rejects(h.run(),error=>/缺少任务轮次/.test(error.message)&&error.taskId==='root'&&error.task===receipt);
  assert.equal(h.requests.length,1);assert.deepEqual(h.received,[]);
});

test('GET与启动轮次或已知输入不一致时停住，不接收新结果或重复付费', async () => {
  const receipt={id:'root',reused:false,runId:'run-root'},queued={id:'root',runId:'run-root',status:'running',graph:[{key:'context_snapshot',hash:'source-hash'}]};
  for(const steps of [
    [{task:receipt},{task:complete('root',0,{runId:'different-run'})}],
    [{task:queued},{task:complete('root',0,{graph:[{key:'context_snapshot',hash:'different-input'}]})}],
    [{task:queued},{task:complete('root')}],
  ]){
    const h=harness(steps);await assert.rejects(h.run(),/不一致/);
    assert.deepEqual(h.requests.map(r=>r.method),['POST','GET']);
    assert.equal(h.received.length,steps[0].task===receipt?0:1);
  }
});

test('polling never submits AI work; completed pass and manual-review blocks do not auto repair', async () => {
  for (const final of [
    complete('root', 0, { quality: { status: 'passed' } }),
    complete('root', 0, { repair: { round: 0, canRetry: false } }),
    complete('root', 2),
    complete('root', 0, { repair: { round: -1, canRetry: true } }),
    complete('root', 0, { repair: { round: 0.5, canRetry: true } }),
    complete('root', 0, { repair: { round: 0, canRetry: 'true' } }),
  ]) {
    const h = harness([
      { task: { id: 'root', status: 'queued' } },
      { task: { id: 'root', status: 'running' } },
      { task: { id: 'root', status: 'running' } }, { task: final },
    ]);
    assert.equal(await h.run(), final);
    assert.deepEqual(h.requests.map(request => request.method), ['POST', 'GET', 'GET', 'GET']);
    assert.ok(h.requests.slice(1).every(request => request.url === '/api/reportexecution?id=root' && request.body === undefined));
  }
});

test('server failures and cancellation retain exact task diagnostics without submitting more work', async () => {
  for (const status of ['dead', 'failed', 'cancelled', 'invalidated', 'missing']) {
    const stopped = { id: 'repair-1', status, error: '测试停止原因', graph: { retryCount: 1 }, usage: { outputTokens: 123 } };
    const h = harness([
      { task: { id: 'repair-1', status: 'queued' } }, { task: stopped },
    ]);
    await assert.rejects(h.run({ action: 'repair', id: 'root' }), error => {
      assert.equal(error.message, '测试停止原因');
      assert.equal(error.task, stopped);
      assert.equal(error.taskId, 'repair-1');
      assert.equal(error.lastCompletedTask, null);
      return true;
    });
    assert.equal(h.received.at(-1), stopped);
    assert.equal(h.requests.filter(request => request.method === 'POST').length, 1);
  }
});

test('three consecutive network failures or request timeouts stop polling but retain the existing task', async () => {
  for (const failure of [
    { throw: new TypeError('fetch failed') }, { hang: true },
    { throw: Object.assign(new Error('aborted'), { name: 'AbortError' }) },
  ]) {
    const queued = { id: 'root', status: 'queued' };
    const h = harness([{ task: queued }, failure, failure, failure]);
    await assert.rejects(h.run(), error => {
      assert.equal(error.task, queued);
      assert.equal(error.lastCompletedTask, null);
      assert.equal(error.taskId, 'root');
      assert.equal(error.code, 'REPORT_TASK_CONNECTION');
      assert.equal(error.connectionFailures, 3);
      assert.match(error.message, /连续3次.*已有任务不会丢失.*检查网络/);
      return true;
    });
    assert.deepEqual(h.requests.map(request => request.method), ['POST', 'GET', 'GET', 'GET']);
    assert.ok(h.requests.slice(1).every(request => request.url === '/api/reportexecution?id=root' && request.body === undefined));
  }
});

test('successful polling resets the consecutive network-failure limit without repeating POST or paid repair', async () => {
  const failure = { throw: new TypeError('fetch failed') }, final = complete('root');
  const h = harness([
    { task: { id: 'root', status: 'queued' } }, failure, failure,
    { task: { id: 'root', status: 'running' } }, failure, failure, { task: final },
  ]);
  assert.equal(await h.run(), final);
  assert.equal(h.requests.length, 7);
  assert.equal(h.requests.filter(request => request.method === 'POST').length, 1);
  assert.equal(h.requests.filter(request => request.payload?.action === 'repair').length, 0);
  assert.deepEqual(h.received.map(task => task.status), ['queued', 'running', 'completed']);
});

test('a successful HTTP response interrupted while reading its body can recover by querying the same task', async () => {
  const final = complete('root'), h = harness([
    { task: { id: 'root', status: 'queued' } },
    { jsonError: Object.assign(new Error('aborted body'), { name: 'AbortError' }) },
    { task: final },
  ]);
  assert.equal(await h.run(), final);
  assert.deepEqual(h.requests.map(request => request.method), ['POST', 'GET', 'GET']);
  assert.equal(h.requests[1].url, h.requests[2].url);
});

test('HTTP, authentication, malformed JSON and task-structure errors are never connection-retried', async () => {
  for (const failure of [
    { invalidJson: true }, { jsonError: new TypeError('body already used') },
    { body: { ok: false, error: '任务与当前项目不匹配' } },
    { httpOk: false, body: { ok: false, error: '未登录或登录已过期' } },
    { httpOk: false, body: { ok: false, error: '没有项目访问权限' } },
    { httpOk: false, body: { ok: false, error: '共享任务预算已用尽' } },
    { httpOk: false, jsonError: Object.assign(new Error('aborted'), { name: 'AbortError' }) },
    { body: { ok: true, task: {} } },
  ]) {
    const queued = { id: 'root', status: 'queued' };
    const h = harness([{ task: queued }, failure]);
    await assert.rejects(h.run(), error => {
      assert.equal(error.task, queued);
      assert.equal(error.lastCompletedTask, null);
      assert.equal(error.taskId, 'root');
      assert.notEqual(error.code, 'REPORT_TASK_CONNECTION');
      if (failure.httpOk === false && !failure.jsonError) assert.equal(error.message, failure.body.error);
      return true;
    });
    assert.equal(h.requests.length, 2, 'failed polling must not implicitly submit a repair');
  }
});

test('an interrupted initial POST is not repeated because submission may already have reached the server', async () => {
  for (const failure of [{ throw: new TypeError('fetch failed') }, { hang: true }]) {
    const h = harness([failure]);
    await assert.rejects(h.run(), error => {
      assert.equal(error.code, 'REPORT_TASK_CONNECTION');
      assert.equal(error.taskId, null);
      return true;
    });
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].method, 'POST');
  }
});

test('a connection recovery does not hide a later permission error or keep polling it', async () => {
  const running = { id: 'root', status: 'running' }, h = harness([
    { task: running }, { throw: new TypeError('fetch failed') },
    { httpOk: false, body: { ok: false, error: '没有项目访问权限' } },
  ]);
  await assert.rejects(h.run(), error => {
    assert.equal(error.message, '没有项目访问权限');
    assert.equal(error.task, running);
    assert.equal(error.taskId, 'root');
    assert.notEqual(error.code, 'REPORT_TASK_CONNECTION');
    return true;
  });
  assert.deepEqual(h.requests.map(request => request.method), ['POST', 'GET', 'GET']);
});

test('network recovery consumes the original deadline rather than starting another nine-minute wait', async () => {
  const queued = { id: 'root', status: 'queued' };
  const h = harness([
    { task: queued, advance: 530000 }, { hang: true },
  ]);
  await assert.rejects(h.run(), error => {
    assert.match(error.message, /后台仍在处理.*任务已保存/);
    assert.equal(error.task, queued);
    assert.equal(error.taskId, 'root');
    return true;
  });
  assert.deepEqual(h.requests.map(request => request.method), ['POST', 'GET']);
  assert.deepEqual(h.timerDelays, [15000, 10000]);
});

test('the nine-minute wall-clock budget includes the initial POST', async () => {
  const queued = { id: 'root', status: 'queued' };
  const h = harness([{ task: queued, advance: 540001 }]);
  await assert.rejects(h.run(), error => {
    assert.match(error.message, /后台仍在处理/);
    assert.equal(error.task, queued);
    return true;
  });
  assert.equal(h.requests.length, 1);
});

test('explicit repair polling fits the original request deadline without resetting it', async () => {
  const running = { id: 'repair-1', status: 'running', usage: { outputTokens: 123 } };
  const h = harness([
    { task: { id: 'repair-1', status: 'queued' }, advance: 530000 }, { task: running, advance: 9500 },
  ]);
  await assert.rejects(h.run({ action: 'repair', id: 'root' }), error => {
    assert.match(error.message, /后台仍在处理/);
    assert.equal(error.task, running);
    assert.equal(error.lastCompletedTask, null);
    return true;
  });
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.timerDelays, [15000, 10000, 500]);
});

test('missing completed text is not silently accepted or repaired', async () => {
  const candidate = complete('root', 0, { text: '' });
  const h = harness([{ task: { id: 'root', status: 'queued' } }, { task: candidate }]);
  await assert.rejects(h.run(), error => error.task === candidate && /未保留正文/.test(error.message));
  assert.equal(h.requests.length, 2);
});

test('authorized first generation repairs only protocol errors on the original task and preserves every candidate', async () => {
  const root = protocolCandidate('root'), final = protocolCandidate('repair-1', 1, {
    quality: { status: 'unverified', factsVerified: false, issues: [{ code: 'pending-evidence', severity: 'warning' }] },
  });
  const before = JSON.stringify(root), guards = [];
  const h = harness([{ task: root }, { task: { id: 'repair-1', status: 'queued' } }, { task: final }]);
  const result = await h.run(undefined, automatic({ beforeRepair: async task => { guards.push(task); return true; } }));
  assert.equal(result.id, final.id);
  assert.equal(result.quality, final.quality);
  assert.equal(result.quality.factsVerified, false);
  assert.deepEqual(Array.from(result.repairHistory, task => task.id), ['root', 'repair-1']);
  assert.equal(result.repairHistory[0], root);
  assert.equal(result.repairHistory[1], final);
  assert.equal(JSON.stringify(root), before, 'candidate and quality receipt must not be mutated');
  assert.deepEqual(guards, [root]);
  assert.deepEqual(h.requests.map(request => request.method), ['POST', 'POST', 'GET']);
  assert.deepEqual(h.requests[1].payload, { action: 'repair', id: 'root' });
  assert.equal(h.requests[2].url, '/api/reportexecution?id=repair-1');
  assert.equal(h.requests.filter(request => request.payload?.prompt).length, 1);
});

test('automatic repair is bounded to two submissions and never marks an exhausted candidate passed', async () => {
  for (const maxRepairRounds of [undefined, 2, 99]) {
    const root = protocolCandidate('root'), first = protocolCandidate('repair-1', 1);
    // Even inconsistent server round metadata cannot cause more than two paid repairs.
    const last = protocolCandidate('repair-2', 0);
    const h = harness([{ task: root }, { task: first }, { task: last }]);
    const result = await h.run(undefined, automatic({ maxRepairRounds }));
    assert.equal(result.id, 'repair-2');
    assert.equal(result.quality.status, 'blocked');
    assert.equal(result.quality.factsVerified, false);
    assert.deepEqual(Array.from(result.repairHistory, task => task.id), ['root', 'repair-1', 'repair-2']);
    assert.equal(h.requests.length, 3);
    assert.deepEqual(h.requests.slice(1).map(request => request.payload.id), ['root', 'repair-1']);
  }
  const root = protocolCandidate('root'), first = protocolCandidate('repair-1', 1);
  const h = harness([{ task: root }, { task: first }]);
  assert.equal((await h.run(undefined, automatic({ maxRepairRounds: 1 }))).id, first.id);
  assert.equal(h.requests.length, 2);
});

test('automatic repair is fail-closed for facts, evidence, length, stale rules and invalid admission receipts', async () => {
  const candidate = protocolCandidate('root');
  const disallowed = [
    { rulesChanged: true },
    { quality: { ...candidate.quality, status: 'passed' } },
    { quality: { ...candidate.quality, status: 'unverified' } },
    ...['length', 'truncation', 'evidence', 'version', 'other'].map(category => ({
      quality: { ...candidate.quality, failure: { protocolRepairEligible: true, categories: ['structure', category] } },
    })),
    { quality: { ...candidate.quality, failure: { protocolRepairEligible: false, categories: ['structure'] } } },
    { quality: { ...candidate.quality, failure: null } },
    { quality: { ...candidate.quality, issues: [] } },
    ...['missing-fact', 'missing-evidence-marker', 'frozen-table-missing', 'bound-reference-missing', 'structured-slot-budget', 'output-format-version', 'new-unknown-gate'].map(code => ({
      quality: { ...candidate.quality, issues: [{ code, severity: 'error', repairable: true }] },
    })),
    { quality: { ...candidate.quality, issues: [{ code: 'structured-heading', severity: 'error', repairable: false }] } },
    { quality: { ...candidate.quality, issues: [{ code: 'structured-heading', severity: 'error', repairable: true, requiresPlanReview: true }] } },
    ...[-1, 0.5, 2, '0'].map(round => ({ repair: { ...candidate.repair, round } })),
    { repair: { ...candidate.repair, canRetry: false } },
    { repair: { ...candidate.repair, canProtocolRetry: false } },
    { repair: { ...candidate.repair, canProtocolRetry: 'true' } },
  ];
  for (const extra of disallowed) {
    const current = { ...candidate, ...extra }, h = harness([{ task: current }]);
    assert.equal(await h.run(undefined, automatic({ beforeRepair: () => { throw new Error('must not repair'); } })), current);
    assert.equal(h.requests.length, 1);
  }
  const h = harness([{ task: candidate }]);
  assert.equal(await h.run(undefined, automatic({ maxRepairRounds: 0 })), candidate);
});

test('existing manual repair remains one explicit submission even if automatic options are accidentally supplied', async () => {
  const candidate = protocolCandidate('repair-1', 1), h = harness([{ task: candidate }]);
  assert.equal(await h.run({ action: 'repair', id: 'root' }, automatic({ beforeRepair: () => { throw new Error('not a first generation'); } })), candidate);
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.requests[0].payload, { action: 'repair', id: 'root' });
});

test('auto repair requires an explicit asynchronous identity/permission guard and retains denied candidates', async () => {
  for (const value of [false, undefined, new Error('权限复核后项目已切换')]) {
    const candidate = protocolCandidate('root'), h = harness([{ task: candidate }]);
    await assert.rejects(h.run(undefined, automatic({ beforeRepair: async task => {
      assert.equal(task, candidate); await Promise.resolve();
      if (value instanceof Error) throw value;
      return value;
    } })), error => {
      assert.equal(error.task, candidate);
      assert.equal(error.lastCompletedTask, candidate);
      assert.equal(error.quality, candidate.quality);
      assert.equal(error.rawText, candidate.rawText);
      assert.equal(error.structuredText, candidate.structuredText);
      assert.equal(error.repairAttempts, 0);
      assert.equal(error.repairHistory[0], candidate);
      if (value instanceof Error) assert.equal(error, value);
      else assert.equal(error.code, 'REPORT_TASK_REPAIR_GUARD');
      return true;
    });
    assert.equal(h.requests.length, 1, 'failed guard must not submit any paid repair');
  }
  for (const options of [{ autoRepair: true }, automatic({ maxRepairRounds: -1 }), automatic({ maxRepairRounds: NaN }), automatic({ maxRepairRounds: 0.5 })]) {
    const h = harness([]);
    await assert.rejects(h.run(undefined, options), /自动修复必须提供有效轮数及项目\/权限复核/);
    assert.equal(h.requests.length, 0, 'invalid opt-in must fail before original AI submission');
  }
});

test('temporary GET failures during automatic repair recover only its existing task and never repeat POST', async () => {
  const root = protocolCandidate('root'), final = protocolCandidate('repair-1', 1, { quality: { status: 'passed', factsVerified: false, issues: [] } });
  const failure = { throw: new TypeError('fetch failed') };
  const h = harness([
    { task: root }, { task: { id: 'repair-1', status: 'queued' } }, failure, failure,
    { task: { id: 'repair-1', status: 'running' } }, failure, failure, { task: final },
  ]);
  assert.equal((await h.run(undefined, automatic())).text, final.text);
  assert.equal(h.requests.filter(request => request.method === 'POST').length, 2);
  assert.ok(h.requests.slice(2).every(request => request.method === 'GET' && request.url === '/api/reportexecution?id=repair-1' && request.body === undefined));
});

test('uncertain repair POSTs stop without resend while retaining the exact blocked raw candidate', async () => {
  for (const failure of [
    { throw: new TypeError('fetch failed') }, { hang: true },
    { jsonError: Object.assign(new Error('aborted body'), { name: 'AbortError' }) },
  ]) {
    const candidate = protocolCandidate('root'), h = harness([{ task: candidate }, failure]);
    await assert.rejects(h.run(undefined, automatic()), error => {
      assert.equal(error.code, 'REPORT_TASK_CONNECTION');
      assert.equal(error.task, candidate);
      assert.equal(error.lastCompletedTask, candidate);
      assert.equal(error.quality, candidate.quality);
      assert.equal(error.rawText, candidate.rawText);
      assert.equal(error.repairAttempts, 1);
      assert.equal(error.repairHistory[0], candidate);
      return true;
    });
    assert.equal(h.requests.length, 2);
    assert.deepEqual(h.requests[1].payload, { action: 'repair', id: 'root' });
  }
});

test('server source, material, permission and rule changes are not repaired or connection-retried', async () => {
  for (const message of ['源数据已变更', '资料已变更', '没有项目访问权限', '未登录或登录已过期', '后台规则已变更']) {
    const candidate = protocolCandidate('root'), h = harness([
      { task: candidate }, { httpOk: false, body: { ok: false, error: message } },
    ]);
    await assert.rejects(h.run(undefined, automatic()), error => {
      assert.equal(error.message, message);
      assert.equal(error.task, candidate);
      assert.equal(error.quality.status, 'blocked');
      assert.equal(error.rawText, candidate.rawText);
      assert.notEqual(error.code, 'REPORT_TASK_CONNECTION');
      return true;
    });
    assert.equal(h.requests.length, 2);
  }
});

test('stopped repair tasks retain the last completed original candidate as well as current task diagnostics', async () => {
  for (const status of ['dead', 'failed', 'cancelled', 'invalidated', 'missing']) {
    const candidate = protocolCandidate('root'), stopped = { id: 'repair-1', status, error: '原修复任务停止' };
    const h = harness([{ task: candidate }, { task: { id: 'repair-1', status: 'queued' } }, { task: stopped }]);
    await assert.rejects(h.run(undefined, automatic()), error => {
      assert.equal(error.task, stopped);
      assert.equal(error.taskId, stopped.id);
      assert.equal(error.lastCompletedTask, candidate);
      assert.equal(error.rawText, candidate.rawText);
      assert.equal(error.quality, candidate.quality);
      assert.equal(error.repairHistory[0], candidate);
      return true;
    });
    assert.equal(h.requests.filter(request => request.method === 'POST').length, 2);
  }
});

test('automatic repair shares the original nine-minute deadline rather than resetting its budget', async () => {
  const candidate = protocolCandidate('root'), h = harness([
    { task: candidate, advance: 530000 },
    { task: { id: 'repair-1', status: 'queued' }, advance: 9000 }, { hang: true },
  ]);
  await assert.rejects(h.run(undefined, automatic()), error => {
    assert.match(error.message, /后台仍在处理.*任务已保存/);
    assert.equal(error.taskId, 'repair-1');
    assert.equal(error.lastCompletedTask, candidate);
    assert.equal(error.rawText, candidate.rawText);
    return true;
  });
  assert.deepEqual(h.timerDelays, [15000, 10000, 1000]);
  assert.equal(h.requests.length, 3);
});

test('GET task identity mismatches cannot replace or repair the original task', async () => {
  const queued = { id: 'root', status: 'queued' }, wrong = protocolCandidate('other-project');
  const h = harness([{ task: queued }, { task: wrong }]);
  await assert.rejects(h.run(undefined, automatic()), error => {
    assert.match(error.message, /后台任务身份不一致/);
    assert.equal(error.task, queued);
    assert.equal(error.lastCompletedTask, null);
    assert.equal(error.repairAttempts, 0);
    return true;
  });
  assert.equal(h.received.length, 1);
  assert.equal(h.requests.length, 2);
});

test('compact receipt is durably saved before GET, separately from full task callbacks', async () => {
  const receipt={id:'root',runId:'run-root',reused:false},full=complete('root');
  const h=harness([{task:receipt},{task:full}]);let saved=false;
  const result=await h.run(undefined,{onReceipt:async value=>{
    assert.equal(value,receipt);assert.equal(h.requests.length,1);assert.equal(h.received.length,0);
    await Promise.resolve();assert.equal(h.requests.length,1);saved=true;
  }});
  assert.equal(saved,true);assert.equal(result,full);assert.deepEqual(h.received,[full]);
  const failed=harness([{task:receipt}]);
  await assert.rejects(failed.run(undefined,{onReceipt:async()=>{throw new Error('receipt save failed');}}),error=>{
    assert.equal(error.message,'receipt save failed');assert.equal(error.task,receipt);assert.equal(error.taskId,'root');return true;
  });
  assert.equal(failed.requests.length,1);assert.equal(failed.received.length,0);
});

test('malformed structured output with retained raw text can undergo authorized protocol repair', async () => {
  const candidate = protocolCandidate('root', 0, {
    text: '', rawText: '{invalid JSON',
    quality: {
      status: 'blocked', factsVerified: false,
      issues: [{ code: 'structured-json', severity: 'error', repairable: true }],
      failure: { categories: ['format'], protocolRepairEligible: true },
    },
  });
  const final = protocolCandidate('repair-1', 1, { quality: { status: 'passed', factsVerified: false, issues: [] } });
  const h = harness([{ task: candidate }, { task: final }]);
  const result = await h.run(undefined, automatic());
  assert.equal(result.text, final.text);
  assert.equal(result.repairHistory[0].rawText, '{invalid JSON');
  assert.equal(h.requests.length, 2);
});
