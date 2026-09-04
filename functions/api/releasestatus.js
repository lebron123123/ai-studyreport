import manifest from "./_release-manifest.js";
import {verifyAuth,json} from "./_auth.js";

export function buildReleaseStatus(env={}){
  const configured=name=>Boolean(env[name]);
  const deploymentRevision=String(env.CF_PAGES_COMMIT_SHA||env.GITHUB_SHA||env.RELEASE_COMMIT||"").slice(0,64);
  return {manifest,runtime:{
    deploymentRevision:deploymentRevision||null,
    database:{configured:configured("DB")||configured("DATABASE_URL")},
    objectStorage:{configured:Boolean(env.RAG_OBJECTS&&typeof env.RAG_OBJECTS.put==="function")},
    oa:{configured:configured("OA_BASE_URL")},
    defaultAiProvider:{configured:configured("AI_API_KEY")||configured("OPENAI_API_KEY")||configured("DEEPSEEK_API_KEY")},
    highAvailability:{configured:configured("HA_DEPLOYMENT_ID")}
  }};
}

export async function onRequestGet(context){
  const user=await verifyAuth(context.request,context.env);
  if(!user)return json({ok:false,error:"未登录或登录已过期"},401);
  return json({ok:true,...buildReleaseStatus(context.env)});
}
