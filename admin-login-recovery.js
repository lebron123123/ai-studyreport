/* Admin authentication recovery. Uses existing auth/adminpass APIs; never weakens authorization. */
(function(global){
  async function request(url,body,headers){
    const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    const data=await response.json();
    return {status:response.status,data};
  }
  function classify(result){
    if(result.status===200&&result.data.ok)return 'ready';
    if(result.status===401)return 'login';
    if(result.status===403&&result.data.error==='非管理员账号')return 'denied';
    if(result.status===403&&result.data.error==='管理员密码错误')return 'password';
    return 'error';
  }
  async function open(){
    let initial;
    try{initial=await request('/api/adminpass',{pass:sessionStorage.getItem('adminPass')||''},global.authHeaders());}
    catch{initial={status:0,data:{error:'连接失败，请检查本地服务后重试。'}};}
    if(classify(initial)==='ready')return true;
    sessionStorage.removeItem('adminPass');
    return new Promise(resolve=>{
      const overlay=document.createElement('div');
      overlay.id='adminGate';
      overlay.style.cssText='position:fixed;inset:0;background:rgba(20,30,48,.92);z-index:9999;display:flex;align-items:center;justify-content:center';
      overlay.innerHTML='<form style="background:#FDFBF3;padding:28px;max-width:380px;width:90%;box-sizing:border-box" aria-label="后台登录验证"><h2 id="agTitle">后台登录验证</h2><p id="agInfo"></p><label id="agNameLabel">网站账号<input id="agName" autocomplete="username" style="display:block;width:100%;box-sizing:border-box"></label><label id="agPassLabel"><span id="agPassText"></span><input id="agPass" type="password" autocomplete="current-password" style="display:block;width:100%;box-sizing:border-box"></label><p id="agErr" role="alert" style="color:#B33"></p><button id="agGo" class="btn" type="submit"></button><button id="agSwitch" class="btn ghost" type="button">换账号登录</button><button id="agRetry" class="btn ghost" type="button">已在前台登录，重新检查</button></form>';
      document.body.appendChild(overlay);
      const el=id=>overlay.querySelector('#'+id);
      let mode,busy=false,finished=false;
      function show(next,message=''){
        mode=next;el('agPass').value='';
        const login=mode==='login',password=mode==='password';
        el('agTitle').textContent=login?'登录网站管理员账号':password?'后台二次安全验证':mode==='denied'?'当前账号无后台权限':'登录状态检查失败';
        el('agInfo').textContent=login?'前台显示用户名不代表登录仍有效。请在此页面重新登录，无需跳转，不会清除项目草稿。':password?'网站账号已通过验证，请输入后台二次密码（不是网站登录密码）。':mode==='denied'?'请切换有后台权限的账号，重复输入后台密码不会获得权限。':'无法确认登录状态，请重试；不会放行后台。';
        el('agNameLabel').hidden=!login;el('agPassLabel').hidden=!(login||password);
        el('agPassText').textContent=login?'网站登录密码':'后台二次密码';
        el('agGo').hidden=!(login||password);el('agGo').textContent=login?'登录并继续':'进入后台';
        el('agErr').textContent=message;
      }
      function finish(){
        finished=true;global.removeEventListener('storage',changed);overlay.remove();resolve(true);
      }
      async function check(pass=''){
        const result=await request('/api/adminpass',{pass},global.authHeaders());
        if(classify(result)==='ready'){
          if(pass)sessionStorage.setItem('adminPass',pass);
          finish();return;
        }
        sessionStorage.removeItem('adminPass');
        show(classify(result),classify(result)==='password'&&!pass?'':result.data.error||'暂时无法验证，请重试。');
      }
      async function run(action){
        if(busy||finished)return;
        busy=true;overlay.querySelectorAll('button').forEach(b=>b.disabled=true);
        try{await action();}catch{el('agErr').textContent='请求失败或超时，请重试；项目草稿未删除。';}
        finally{busy=false;if(!finished)overlay.querySelectorAll('button').forEach(b=>b.disabled=false);}
      }
      overlay.querySelector('form').onsubmit=e=>{
        e.preventDefault();
        run(async()=>{
          const pass=el('agPass').value;
          if(!pass){el('agErr').textContent='请输入密码。';return;}
          if(mode==='login'){
            const result=await request('/api/auth',{action:'login',username:el('agName').value.trim(),password:pass},{'Content-Type':'application/json'});
            el('agPass').value='';
            if(result.status!==200||!result.data.ok||!result.data.token){el('agErr').textContent=result.data.error||'登录失败，请重试。';return;}
            localStorage.setItem('fs_token',result.data.token);localStorage.setItem('fs_user',result.data.username);
            sessionStorage.removeItem('adminPass');
            await check();
          }else if(mode==='password')await check(pass);
        });
      };
      el('agSwitch').onclick=()=>show('login');
      el('agRetry').onclick=()=>run(()=>check());
      function changed(event){if(event.key==='fs_token')run(()=>check());}
      global.addEventListener('storage',changed);
      show(classify(initial),classify(initial)==='error'?initial.data.error:'');
    });
  }
  global.AdminLoginRecovery={open,classify};
})(globalThis);

