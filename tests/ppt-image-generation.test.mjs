import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateNanoBanana,
  generateComfyUi,
  imageProviderStatus,
  createLimiter,
} from "../local-server/ppt-image-generation.js";

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("Nano Banana只通过服务端密钥调用并返回可审核候选",async()=>{
  let requestBody;
  const fakeFetch=async(url,options)=>{
    assert.match(url,/generativelanguage\.googleapis\.com\/v1beta\/interactions$/);
    assert.equal(options.headers["x-goog-api-key"],"server-secret");
    requestBody=JSON.parse(options.body);
    return new Response(JSON.stringify({output_image:{data:Buffer.from("png-bytes").toString("base64"),mime_type:"image/png"}}),{status:200});
  };
  const image=await generateNanoBanana({prompt:"深圳保障性住房建筑主视觉",aspectRatio:"16:9",mode:"standard"},{
    NANO_BANANA_ENABLED:"true",GEMINI_API_KEY:"server-secret"
  },fakeFetch);
  assert.equal(requestBody.model,"gemini-3.1-flash-image");
  assert.equal(requestBody.response_format.aspect_ratio,"16:9");
  assert.match(image.dataUrl,/^data:image\/png;base64,/);
  assert.equal(image.provider,"nano-banana");
  assert.equal(JSON.stringify(image).includes("server-secret"),false);
});

test("未显式启用时云端和本地生图Provider都保持关闭",()=>{
  const status=imageProviderStatus({GEMINI_API_KEY:"present",COMFYUI_BASE_URL:"http://127.0.0.1:8188"});
  assert.deepEqual(status.providers.map(x=>x.available),[false,false]);
});

test("ComfyUI工作流替换提示词、模型、尺寸并取回图片",async()=>{
  let submitted;
  const fakeFetch=async(url,options={})=>{
    if(url.endsWith("/prompt")){
      submitted=JSON.parse(options.body).prompt;
      return new Response(JSON.stringify({prompt_id:"job-1"}),{status:200});
    }
    if(url.endsWith("/history/job-1"))return new Response(JSON.stringify({"job-1":{outputs:{"7":{images:[{filename:"result.png",subfolder:"ppt",type:"output"}]}}}}),{status:200});
    if(url.includes("/view?"))return new Response(Buffer.from("local-image"),{status:200,headers:{"content-type":"image/png"}});
    throw new Error("unexpected URL "+url);
  };
  const image=await generateComfyUi({prompt:"现代保障房建筑群",aspectRatio:"16:9",seed:123},{
    COMFYUI_ENABLED:"true",COMFYUI_BASE_URL:"http://127.0.0.1:8188",COMFYUI_CHECKPOINT:"housing.safetensors",COMFYUI_TIMEOUT_MS:"1000"
  },fakeFetch,{workflowDir:path.join(root,"local-server","comfy-workflows"),pollMs:0});
  assert.equal(submitted["1"].inputs.ckpt_name,"housing.safetensors");
  assert.equal(submitted["2"].inputs.text,"现代保障房建筑群");
  assert.equal(submitted["4"].inputs.width,1344);
  assert.equal(submitted["4"].inputs.height,768);
  assert.equal(submitted["5"].inputs.seed,123);
  assert.match(image.dataUrl,/^data:image\/png;base64,/);
  assert.equal(image.provider,"comfyui");
});

test("图片任务限制器按配置限制并发",async()=>{
  const limit=createLimiter(1);let active=0,maxActive=0;
  const job=()=>limit(async()=>{active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,5));active--;});
  await Promise.all([job(),job(),job()]);
  assert.equal(maxActive,1);
});

test("API易Nano Banana使用OpenAI兼容端点并解析Base64图片",async()=>{
  const calls=[];
  const fakeFetch=async(url,options)=>{
    calls.push({url,options,body:JSON.parse(options.body)});
    return new Response(JSON.stringify({choices:[{message:{content:"data:image/png;base64,aGVsbG8="}}]}),{status:200,headers:{"content-type":"application/json"}});
  };
  const image=await generateNanoBanana({prompt:"住房建筑",aspectRatio:"16:9"},{
    NANO_BANANA_ENABLED:"true",
    NANO_BANANA_PROVIDER:"apiyi",
    NANO_BANANA_API_URL:"https://api.apiyi.test/v1/chat/completions",
    GEMINI_API_KEY:"server-only-key",
    NANO_BANANA_MODEL:"gemini-image-test"
  },fakeFetch);
  assert.equal(calls[0].url,"https://api.apiyi.test/v1/chat/completions");
  assert.equal(calls[0].options.headers.Authorization,"Bearer server-only-key");
  assert.equal(calls[0].body.model,"gemini-image-test");
  assert.match(calls[0].body.messages[0].content[0].text,/16:9/);
  assert.equal(image.dataUrl,"data:image/png;base64,aGVsbG8=");
  assert.equal(image.sourceRef,"API易 Nano Banana · gemini-image-test");
});
