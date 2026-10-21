const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../auth.js'), 'utf8');

test('读取当前项目遇到 401 时要求重新登录，不误标为无权访问', async () => {
  const start = source.slice(source.indexOf('async function startApp('), source.indexOf('function checkLogin('));
  let loginRequests = 0;
  const context = vm.createContext({
    window: {}, currentProjectId: 'p1', currentProjectRole: 'OWNER', currentProjectReadOnlyData: null,
    mountUserBar() {}, renderTOC() {}, renderSheet() {},
    fetchOutlines: async () => {}, fetchCalcConfig: async () => {},
    fetch: async () => ({status: 401, json: async () => ({ok:false,error:'未登录或登录已过期'})}),
    authHeaders: () => ({}), requireLoginAgain: () => { loginRequests++; },
  });
  vm.runInContext(start, context);
  await context.startApp();
  assert.equal(loginRequests, 1);
  assert.equal(context.currentProjectRole, 'PENDING');
});

test('打开项目遇到 401 时显示登录入口，不弹出死循环错误', async () => {
  const open = source.slice(source.indexOf('async function openProject('), source.indexOf('async function openAiReportProject('));
  let loginRequests = 0, alerts = 0;
  const context = vm.createContext({
    window: {}, authPreserveCurrentDraft: async () => true,
    fetch: async () => ({status:401,json:async()=>({ok:false,error:'未登录或登录已过期'})}),
    authHeaders: () => ({}), requireLoginAgain: () => { loginRequests++; },
    alert: () => { alerts++; },
  });
  vm.runInContext(open, context);
  assert.equal(await context.openProject('p1'), false);
  assert.equal(loginRequests, 1);
  assert.equal(alerts, 0);
});

test('切换前保存发现登录已失效时也直接打开登录框', async () => {
  const open = source.slice(source.indexOf('async function openProject('), source.indexOf('async function openAiReportProject('));
  let loginRequests = 0, alerts = 0, reads = 0;
  const context = vm.createContext({
    window: {}, authPreserveCurrentDraft: async () => false, getToken: () => null,
    fetch: async () => { reads++; }, requireLoginAgain: () => { loginRequests++; },
    alert: () => { alerts++; },
  });
  vm.runInContext(open, context);
  assert.equal(await context.openProject('p1'), false);
  assert.equal(loginRequests, 1);
  assert.equal(alerts, 0);
  assert.equal(reads, 0);
});
