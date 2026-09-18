# WeSportH 私教预约

一个低成本、可公开测试的私教预约系统：

- `docs/`：用户端、教练端、管理员端，部署到 GitHub Pages。
- `worker/`：登录、权限、排期和预约 API，部署到 Cloudflare Workers。
- Cloudflare D1：保存共享账号、排期、预约和会话数据。

## 1. 创建 Cloudflare D1

需要 Node.js 20+ 和 Cloudflare 账号。

```bash
cd worker
npm install
npx wrangler login
npx wrangler d1 create wesporth-db
```

复制 `worker/wrangler.example.jsonc` 为 `worker/wrangler.jsonc`，把命令返回的数据库 ID 填入 `database_id`。
`ALLOWED_ORIGINS` 已包含当前可能使用的两个 Pages origin：`https://patrickyan.github.io` 和 `https://patrickyanz.github.io`。Origin 只包含协议和域名，不要添加 `/WeSportH/` 路径。如果 Pages 地址有变化，请相应更新这里。

```bash
npm run db:local
npm run db:remote
npx wrangler secret put SETUP_TOKEN
npm run deploy
```

`SETUP_TOKEN` 是首次创建管理员时使用的一次性部署密钥。请设置为至少 24 位随机字符串，不要提交到 GitHub。它不是日常登录的二次验证。

部署完成后记录 Worker URL，例如：

```text
https://wesporth-api.<subdomain>.workers.dev
https://wesporth-api.wesporth-api.workers.dev
```

## 2. 配置 GitHub Actions

在 GitHub 仓库的 `Settings → Secrets and variables → Actions` 中设置：

### Secrets

- `CLOUDFLARE_API_TOKEN`：具备 Workers Scripts 编辑和 D1 编辑权限的 Cloudflare API Token。
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare Account ID。
- `CLOUDFLARE_D1_DATABASE_ID`：刚创建的 D1 Database ID。

### Variables

- `WESPORT_API_BASE`：完整 Worker URL，不要以 `/` 结尾。

本项目是静态网页，不使用 Vite。Pages 工作流会读取 `vars.WESPORT_API_BASE` 并在部署时生成 `docs/config.js`，无需设置 `VITE_API_BASE_URL`。

然后在 `Settings → Pages → Build and deployment` 中选择 `GitHub Actions`。推送到 `main` 后，两个工作流会分别发布 Worker 和网页。

## 3. 首次使用

打开 GitHub Pages 地址：

1. 选择“管理员”。
2. 点击“首次部署？初始化管理员”。
3. 设置第一个管理员账号和密码。这个操作只能成功一次。页面要求的“部署初始化密钥”就是前面保存到 Cloudflare 的 `SETUP_TOKEN`。
4. 管理员登录后创建教练账号；普通用户可自行注册。

## 本地开发

后端：

```bash
cd worker
npm install
npm run db:local
npm run dev
```

复制 `.dev.vars.example` 为 `.dev.vars` 并设置本地初始化密钥。将 `docs/config.js` 的 `API_BASE` 临时设置为 `http://localhost:8787`，再启动任意静态服务器预览 `docs/`。

## 安全说明

- 密码使用 PBKDF2-SHA-256 和随机盐保存，不存储明文密码；哈希成本随账号记录，便于以后平滑升级。当前成本按 Workers 免费版 10ms CPU 限额设置。
- 登录令牌只以哈希形式保存在 D1；客户端令牌保存在当前标签页的 `sessionStorage`。
- 所有角色权限均由 Worker 检查；管理员可以修改会员和教练账号的密码，修改后该账号的现有会话会立即失效。
- 管理员可以修改教练和会员的显示姓名；教练排期与会员课程表均展示未来 14 天。
- 不要把 Cloudflare API Token、Account ID 或其他密钥写入前端文件。
