# OpenClaw Gmail Webhook

> Gmail Pub/Sub 转发到 Telegram - 实时邮件通知服务

## 功能

- 📬 实时接收 Gmail 新邮件通知
- 📱 通过 Telegram Bot 推送邮件摘要
- 🔄 使用 Gmail history API 仅推送新邮件（避免重复）
- ☁️ 支持 Cloudflare Tunnel 公网暴露

## 前置要求

- **Node.js**: 18+
- **Gmail API**: 已配置 OAuth2 凭据
- **Telegram Bot**: 已创建 Bot 并获取 Token
- **Cloudflare Tunnel**（可选）: 用于公网暴露

## 安装

### 1. 克隆项目

```bash
git clone https://github.com/blue0501/openclaw-gmail-webhook.git
cd openclaw-gmail-webhook
```

### 2. 安装依赖

```bash
npm install googleapis
```

### 3. 配置环境

编辑 `server.js`，填入以下配置：

```javascript
const TELEGRAM_BOT_TOKEN = 'YOUR_TELEGRAM_BOT_TOKEN';
const TELEGRAM_CHAT_ID = 'YOUR_CHAT_ID';
```

### 4. 配置 Gmail OAuth

确保已配置 Gmail API 凭据（参考 google-workspace-byok skill）。

### 5. 启动服务

```bash
node server.js
```

或使用 systemd 服务：

```bash
sudo cp gmail-webhook.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable gmail-webhook
sudo systemctl start gmail-webhook
```

## 配置说明

### Telegram Bot

1. @BotFather 创建新 Bot
2. 获取 Bot Token
3. 与 Bot 发起对话（发送 /start）

### Gmail Pub/Sub

1. 在 Google Cloud Console 创建 Pub/Sub Topic
2. 创建订阅并配置推送端点
3. 授权 gmail-api.push-notification 权限

### Cloudflare Tunnel（如需公网暴露）

```bash
# 创建 Tunnel
cloudflared tunnel create gmail-hook

# 配置域名
cloudflared tunnel route dns gmail-hook gmail-hook.yourdomain.com

# 运行
cloudflared tunnel run gmail-hook --url http://localhost:3000
```

## 工作原理

```
Gmail 新邮件 
  → Google Pub/Sub 
    → 本地 server.js (localhost:3000) 
      → Gmail History API 获取详情 
        → Telegram Bot API 推送
```

## 关键配置

| 配置项 | 说明 |
|--------|------|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token |
| `TELEGRAM_CHAT_ID` | 接收通知的用户 ID |
| `OPENCLAW_URL` | OpenClaw Gateway 地址（可选） |
| `OPENCLAW_HOOK_TOKEN` | OpenClaw Hook 验证 Token |

## 文件结构

```
.
├── server.js          # 主程序
├── README.md          # 说明文档
└── gmail-webhook.service  # systemd 服务文件
```

## 故障排除

- **"history.list error"**: Gmail Watch 过期，需重新执行 watch
- **"can't parse entities"**: HTML 转义问题，已修复
- **Pub/Sub 无推送**: 检查 Topic 订阅状态

## 相关项目

- [google-workspace-byok](https://github.com/blue0501/openclaw-skill-minimax-mcp) - Gmail/Google Workspace 集成
- [openclaw-skill-minimax-mcp](https://github.com/blue0501/openclaw-skill-minimax-mcp) - MiniMax MCP 集成
- OpenClaw 文档: https://docs.openclaw.ai

## License

MIT
