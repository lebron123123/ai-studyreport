(function(root){
  'use strict';
  const copy=v=>JSON.parse(JSON.stringify(v));
  const ordinal=s=>{if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(s))throw Error('年月须为 YYYY-MM');return Number(s.slice(0,4))*12+Number(s.slice(5))-1;};
  const month=n=>Math.floor(n/12)+'-'+String(n%12+1).padStart(2,'0');
  function policy(key){return ['decoRatio','decoInt','discount','rampIntervalMonths'].includes(key)?'fixed':['firstDecoLoanPct','loanRate'].includes(key)?'assumed':'actual';}
  function inventory(params,ranges={}){
    return root.ProjectSensitivity.inventory(params).map(r=>{
      r={...r};
      if(r.kind==='mode')r.reason='文字类别固定为当前项目值，不参与敏感性排名';
      if(r.key==='rampStartMonth')r.reason='联动覆盖：随运营开始年月移动，不重复计为独立因素';
      if(r.key==='stableStartMonth')r.reason='联动覆盖：始终为爬坡结束的次月，不重复计为独立因素';
      if(r.kind==='month')r.reason='项目时间边界：保持原日期，不参与普通波动排名；延期须另做明确期限约束的情景';
      r.bounds=ranges[r.key]||(!r.reason?root.ProjectSensitivity.defaults(r):[]);
      if(!ranges[r.key]&&!r.reason&&!['month','integer'].includes(r.kind)){
        const step=Math.abs(r.value)*.20,lo=['rentRate','costRate'].includes(r.key)?-99.99:0,hi=r.kind==='ratio'?1:r.kind==='percent'?100:Infinity;
        r.bounds=[Math.max(lo,r.value-step),Math.min(hi,r.value+step)].map(v=>Number(v.toFixed(8)));
      }
      if(!r.reason&&r.bounds[0]===r.bounds[1])r.reason='固定值：请设置非零波动范围后再分析；不能据此判定无影响';
      return r;
    });
  }
  function sample(row,u){
    if(row.kind==='mode')return u<.5?row.bounds[0]:row.bounds[1];
    const bounds=row.kind==='month'?row.bounds.map(ordinal):row.bounds.map(Number),[lo,hi]=bounds;
    if(!Number.isFinite(lo)||!Number.isFinite(hi)||hi<lo)throw Error(row.label+'：范围无效');
    const discrete=['integer','month'].includes(row.kind),v=discrete?lo+Math.min(hi-lo,Math.floor(u*(hi-lo+1))):lo+u*(hi-lo);
    if(discrete&&(!Number.isInteger(lo)||!Number.isInteger(hi)))throw Error(row.label+'：范围必须为整数');
    return row.kind==='month'?month(v):v;
  }
  function compose(params,rows,unit){
    let p=copy(params);
    // Stage values first; then rebin the schedule, finally move the whole ramp together.
    const order=k=>k.startsWith('rampRates.')?0:k==='rampIntervalMonths'?2:k==='rampEndMonth'?3:k==='operateStartMonth'?4:1;
    rows.map((r,i)=>({r,i})).sort((a,b)=>order(a.r.key)-order(b.r.key)).forEach(({r,i})=>{p=root.ProjectSensitivity.change(p,r.key,sample(r,unit[i]));});
    return p;
  }
  function ranks(values){
    const out=[],order=values.map((v,i)=>({v:Math.abs(v),i})).sort((a,b)=>b.v-a.v);
    for(let i=0;i<order.length;){let j=i+1;while(j<order.length&&order[j].v===order[i].v)j++;for(let k=i;k<j;k++)out[order[k].i]=(i+1+j)/2;i=j;}return out;
  }
  async function impacts(params,config,rows,baseline,options={}){
    const output=[];
    for(const row of rows){
      const discrete=['integer','month'].includes(row.kind),size=discrete?(row.kind==='month'?ordinal(row.bounds[1])-ordinal(row.bounds[0]):row.bounds[1]-row.bounds[0])+1:9;
      const count=row.kind==='mode'?2:Math.max(2,Math.min(25,size));
      const values=[...new Set([row.value,...Array.from({length:count},(_,i)=>sample(row,i/(count-1)))])];
      const points=[];
      for(const value of values){
        if(options.cancelled?.())throw Error('分析已取消，未应用任何配置');
        const p=root.ProjectSensitivity.change(copy(params),row.key,value);
        const r=root.ProjectSensitivity.evaluate(p,config);
        if(!Number.isFinite(r.irr)||!Number.isFinite(r.npv))throw Error(row.label+' 单因素测试无有效IRR或NPV，请核对范围');
        points.push({value,irr:r.irr,npv:r.npv});
      }
      const metric=k=>({min:Math.min(...points.map(p=>p[k])),max:Math.max(...points.map(p=>p[k])),maxDeviation:Math.max(...points.map(p=>Math.abs(p[k]-baseline[k])))});
      output.push({key:row.key,baseValue:row.value,unit:row.unit,points,irrImpact:metric('irr'),npvImpact:metric('npv')});
      options.progress?.(output.length,rows.length,'单因素多点测试');
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    return output;
  }
  function recommend(row,criteria){
    if(row.policy==='fixed')return false;
    if(criteria.weighted!==undefined)return (criteria.irr!==null&&row.irrImpact.maxDeviation>criteria.irr)||(criteria.npv!==null&&row.npvRelative!==null&&row.npvRelative>criteria.npv)||(criteria.weighted!==null&&row.weightedScore>criteria.weighted);
    return (criteria.irr!==null&&row.irrImpact.maxDeviation>=criteria.irr)||(criteria.npv!==null&&row.npvImpact.maxDeviation>=criteria.npv);
  }
  function scoreImpacts(table,baselineNpv){
    const maxIrr=Math.max(0,...table.map(r=>r.irrImpact.maxDeviation)),maxNpv=Math.max(0,...table.map(r=>r.npvImpact.maxDeviation));
    // Divide by the largest tested impact, with a zero-impact dimension contributing zero.
    return table.map(r=>({...r,npvRelative:Math.abs(baselineNpv)<1?null:r.npvImpact.maxDeviation/Math.abs(baselineNpv),weightedScore:.5*(maxIrr?r.irrImpact.maxDeviation/maxIrr:0)+.5*(maxNpv?r.npvImpact.maxDeviation/maxNpv:0)}));
  }
  // Independent A/B uniforms and pick-freeze hybrids. No failed samples are discarded.
  async function estimate(dimensions,evaluate,options={}){
    const N=options.N||300;if(!Number.isInteger(N)||N<16||N>5000||!dimensions)throw Error('样本数须为16—5000，且至少一个可变参数');
    if(N<=dimensions+1)throw Error('样本数不足以支持全部变量的回归交叉分析，请增加样本数');
    const S=root.SensitivityCore,rng=S.mulberry32(options.seed??20260921),A=Array.from({length:N},()=>Array.from({length:dimensions},rng)),B=Array.from({length:N},()=>Array.from({length:dimensions},rng));
    let completed=0,lastYield=Date.now();const total=N*(dimensions+2);
    const run=async x=>{if(options.cancelled?.())throw Error('分析已取消，未应用任何配置');let y;try{y=evaluate(x);}catch(e){throw Error('第'+(completed+1)+'次抽样无效：'+e.message+'。请收窄或修正范围后重跑，未剔除失败样本。');}if(!Number.isFinite(y))throw Error('抽样出现无有效XIRR，不能用零代替；请核对范围');completed++;if(Date.now()-lastYield>60){options.progress?.(completed,total);await new Promise(r=>setTimeout(r,0));lastYield=Date.now();}return y;};
    const ya=[],yb=[];for(let n=0;n<N;n++){ya.push(await run(A[n]));yb.push(await run(B[n]));}
    const mean=[...ya,...yb].reduce((s,v)=>s+v,0)/(2*N),variance=[...ya,...yb].reduce((s,v)=>s+(v-mean)**2,0)/(2*N);
    if(variance<1e-20)throw Error('所选范围内结果没有可辨识波动，无法形成可靠排名');
    const actual=options.encode?A.map(options.encode):A,cols=Array.from({length:dimensions},(_,i)=>actual.map(x=>x[i])),src=S.stdRegressionCoeffs(actual,ya);
    const table=[];
    for(let i=0;i<dimensions;i++){
      const diff=[],first=[];
      for(let n=0;n<N;n++){const x=A[n].slice();x[i]=B[n][i];const y=await run(x);diff.push(.5*(ya[n]-y)**2);first.push((yb[n]-mean)*(y-ya[n]));}
      const STi=diff.reduce((s,v)=>s+v,0)/N/variance,Si=first.reduce((s,v)=>s+v,0)/N/variance;
      // Paired bootstrap retains the A/B denominator and hybrid numerator association.
      const boot=[];for(let b=0;b<100;b++){let sum=0,sumSq=0,num=0;for(let n=0;n<N;n++){const j=Math.floor(rng()*N);sum+=ya[j]+yb[j];sumSq+=ya[j]**2+yb[j]**2;num+=diff[j];}const v=sumSq/(2*N)-(sum/(2*N))**2;if(v>1e-20)boot.push(num/N/v);}boot.sort((a,b)=>a-b);
      table.push({STi,Si,STiLow:boot[Math.floor(boot.length*.025)]??STi,STiHigh:boot[Math.min(boot.length-1,Math.floor(boot.length*.975))]??STi,spearmanRho:S.spearman(cols[i],ya),src:Array.isArray(src)?src[i]:0});
    }
    const rankings=['STi','spearmanRho','src'].map(k=>ranks(table.map(r=>r[k]||0)));
    table.forEach((r,i)=>{r.combinedRank=rankings.reduce((s,a)=>s+a[i],0)/3;r.sobolRank=rankings[0][i];r.spearmanRank=rankings[1][i];r.srcRank=rankings[2][i];});
    options.progress?.(total,total);return {N,total,variance,table};
  }
  async function analyze(params,cfg,options={}){
    const snapshot=copy(params),config=copy(cfg),baseline=root.ProjectSensitivity.evaluate(snapshot,config),coverage=inventory(snapshot,options.ranges),rows=coverage.filter(r=>!r.reason);
    rows.forEach(r=>{sample(r,0);sample(r,1);});
    const result=await estimate(rows.length,u=>root.ProjectSensitivity.evaluate(compose(snapshot,rows,u),config).irr,{...options,encode:u=>rows.map((r,i)=>{const v=sample(r,u[i]);return r.kind==='month'?ordinal(v):r.kind==='mode'?(v==='share'?1:0):v;})});
    const effects=await impacts(snapshot,config,rows,baseline,options);
    result.table=result.table.map((r,i)=>({...r,...effects[i]}));
    result.globalTotal=result.total;
    result.total+=effects.reduce((n,r)=>n+r.points.length,0);
    return {...result,version:'anju-global-v2',createdAt:new Date().toISOString(),seed:options.seed??20260921,project:copy(options.project||{}),coverage,baseline:{irr:baseline.irr,npv:baseline.npv},table:result.table.map((r,i)=>({...r,key:rows[i].key,label:rows[i].label,kind:rows[i].kind,bounds:rows[i].bounds})).sort((a,b)=>a.combinedRank-b.combinedRank||b.STi-a.STi)};
  }
  root.ProjectSensitivityGlobal={inventory,sample,compose,estimate,analyze,impacts,recommend,scoreImpacts,policy};
})(typeof window==='undefined'?globalThis:window);
