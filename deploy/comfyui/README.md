# ComfyUI / Stable Diffusion 部署资产

本目录用于未来GPU服务器部署。ComfyUI不得直接暴露到公网；业务服务器通过内网或本机 `127.0.0.1:8188` 调用。

## 推荐目录

```text
/opt/ComfyUI
├─ models/checkpoints/
├─ output/
├─ custom_nodes/
└─ venv/
```

## 启动原则

- 使用官方 ComfyUI 仓库安装；
- 优先使用Core节点，避免未经审查的第三方自定义节点；
- 启动参数增加 `--disable-api-nodes`，避免意外调用外部付费模型；
- 绑定 `127.0.0.1` 或GPU服务器内网IP，不开放公网8188端口；
- 一块GPU默认只并发执行一个PPT生图任务。

## 接入步骤

1. 安装显卡驱动、Python和与显卡匹配的PyTorch。
2. 克隆官方 ComfyUI 并创建独立虚拟环境。
3. 把批准使用的模型放入 `models/checkpoints/`。
4. 将 `comfyui.service.example` 中路径和用户改成服务器实际值，安装为systemd服务。
5. 在业务服务器 `local-server/.env` 配置 `COMFYUI_*`。
6. 执行 `node scripts/check-comfyui.mjs` 检查服务和必需Core节点。
7. 在PPT页面选择“ComfyUI / Stable Diffusion（本地）”，生成候选并人工采用。

默认工作流位于 `local-server/comfy-workflows/ppt-image-hero.json`，只依赖Core节点。更换模型时通常只需修改 `COMFYUI_CHECKPOINT`。
