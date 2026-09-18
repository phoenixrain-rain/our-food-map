# 自动质量检查

整理日期：2026-09-18。产品当前版本为 2.7.0；本次仅增加维护工具，不升级客户端资源或数据库。

## 检查范围

`.github/workflows/check.yml` 在 `main` 推送、Pull Request 和手动运行时执行：

1. 使用锁文件安装依赖；固定 Node 24.15.0。
2. `npm test`：36 项模型、筛选、草稿、版本判断与复访统计测试。
3. `npm run check:release`：前端版本号、模块引用、离线缓存清单、唯一元素 ID、表单标签、保留用户缩放。
4. 在 Ubuntu 24.04 的 Chromium 中执行 51 项移动端浏览器回归，包括照片、离线、模态框、草稿、真实 Service Worker 更新和复访小结。

Windows 本机仍优先使用已安装的 Edge。CI 不复用已有本地预览服务、不容许遗漏的 `test.only`、不自动重试掩盖偶发失败；连续提交会取消同分支旧检查，单次最多 15 分钟。

## 权限与边界

- 工作流只读仓库内容，不提交文件、不部署、不删除数据，不调用 `test:cloud`。
- 浏览器仅使用生成的模拟本机档案，不需要生产 Supabase 管理密钥、邮箱密码或用户登录会话。
- 不上传截图、追踪文件或私人数据为公开附件。不保留 checkout 凭据。
- 第三方步骤只有 GitHub 官方 checkout 和 setup-node，固定已核验的完整提交 SHA；升级时核对官方来源并重新运行。
- 这是自动回归提示，不是完整安全审计，也不是实体安卓/iOS 设备测试。
- 现有 GitHub Pages 发布仍独立运行。没有擅自改变发布方式或分支保护；检查失败本身不会阻止现有 Pages 自动发布。

官方步骤来源：[checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1)、[setup-node v7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0)。首次实际运行结果见 `PROJECT_LOG.md`。
