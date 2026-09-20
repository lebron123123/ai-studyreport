export function testDatabaseUrl(env=process.env){
  const target=env.AGENT_TEST_DATABASE_URL;
  if(!target){if(env.REQUIRE_DATABASE_TESTS==='1'||env.CI==='true')throw new Error('数据库行为测试不可跳过：请通过 scripts/run-postgres-tests.mjs 运行');return undefined;}
  const url=new URL(target);
  if(!/^\/studyreport_restore_\d+$/.test(url.pathname)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('数据库行为测试仅允许本机隔离库');
  return target;
}
