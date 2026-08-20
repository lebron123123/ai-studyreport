# PPT生图服务部署与切换手册

## 1. 当前完成状态

系统已具备统一图片网关 `/api/ppt-image-generate`，支持两条可切换链路：

- `nano-banana`：现在可用的Google云端图片API；
- `comfyui`：未来GPU服务器上的Stable Diffusion本地推理。

前台不会接触API密钥或ComfyUI地址。两种服务生成的图片都只进入候选区，必须人工点击“采用”后才能写入PPT。

## 2. 现在启用Nano Banana

把 `local-server/.env.image.example` 中Nano Banana配置复制到实际 `.env`，然后自行填写：

```env
NANO_BANANA_ENABLED=true
GEMINI_API_KEY=在服务器本地填写，不发送到聊天，不提交Git
NANO_BANANA_MODE=standard
NANO_BANANA_IMAGE_SIZE=1K
```

重启本地服务器后，PPT素材区选择“Nano Banana（云端API）”。

| 前台选择 | 模型用途 |
|---|---|
| 快速草图 | 低成本构图试验 |
| 标准 | 常规PPT主视觉 |
| 精品 | 封面、关键章节页 |

云端阶段只发送脱敏后的视觉描述，不上传真实项目名称、详细地址、内部金额、人员信息或未公开材料。

## 3. 将来启用ComfyUI

GPU服务器准备好后配置：

```env
COMFYUI_ENABLED=true
COMFYUI_BASE_URL=http://127.0.0.1:8188
COMFYUI_CHECKPOINT=服务器实际模型文件名.safetensors
COMFYUI_WORKFLOW=ppt-image-hero
PPT_IMAGE_MAX_CONCURRENCY=1
```

业务服务器和GPU服务器分离时，`COMFYUI_BASE_URL` 改成GPU服务器内网地址。不要使用公网地址。

运行健康检查：

```powershell
node scripts\check-comfyui.mjs
```

检查通过后，前台选择“ComfyUI / Stable Diffusion（本地）”即可。无需修改PPT工作流、审核逻辑或导出代码。

## 4. 安全与运维

- API密钥仅存在服务器环境变量；
- Provider默认关闭，必须显式启用；
- 图片任务经过服务端队列，默认单并发；
- 提示词最大4000字，图片最大20MB；
- ComfyUI工作流由服务器白名单文件决定，前端不能提交任意工作流；
- 图片记录模型、工作流、提示词版本、种子和生成时间；
- 未采用候选不会进入正式PPT。

## 5. 切换策略

```text
没有GPU：Nano Banana → 人工审核 → PPT
有GPU：ComfyUI → 人工审核 → PPT
ComfyUI故障：切回Nano Banana或本地智能插图
涉密项目：只允许项目素材、部门素材、本地插图和ComfyUI
```
