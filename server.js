/**
 * Gmail Pub/Sub → OpenClaw /hooks/gmail 转发服务
 * 使用 Gmail history.list API 只获取本次 historyId 之后的新邮件
 */

const http = require('http');
const path = require('path');
const { google } = require('/root/.openclaw/workspace/skills/google-workspace-byok/node_modules/googleapis');
const { getAuthClient } = require('/root/.openclaw/workspace/skills/google-workspace-byok/scripts/shared.js');

const PORT = 3000;
const OPENCLAW_URL = 'http://127.0.0.1:18789';
const OPENCLAW_HOOK_TOKEN = 'gmail-hook-secret-2026';

// 记录上次处理的 historyId，避免重复
let lastHistoryId = null;
const processedHistoryIds = new Set();

async function getNewMessages(historyId) {
  try {
    const auth = await getAuthClient('main');
    const gmail = google.gmail({ version: 'v1', auth });

    // 用 history.list 只获取新增消息
    const histRes = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: historyId,
      historyTypes: ['messageAdded'],
      labelId: 'INBOX'
    });

    const histories = histRes.data.history || [];
    const newMsgIds = new Set();

    for (const h of histories) {
      for (const added of (h.messagesAdded || [])) {
        newMsgIds.add(added.message.id);
      }
    }

    if (!newMsgIds.size) {
      console.log('[Gmail] No new messages in history');
      return [];
    }

    console.log(`[Gmail] ${newMsgIds.size} new message(s) found`);

    // 获取每封邮件详情
    const messages = [];
    for (const msgId of newMsgIds) {
      try {
        const msgRes = await gmail.users.messages.get({
          userId: 'me',
          id: msgId,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date']
        });
        const headers = msgRes.data.payload.headers;
        const get = (name) => (headers.find(h => h.name === name) || {}).value || '';
        messages.push({
          id: msgId,
          from: get('From'),
          to: get('To'),
          subject: get('Subject'),
          date: get('Date'),
          snippet: msgRes.data.snippet || ''
        });
      } catch (e) {
        console.error(`[Gmail] Failed to get message ${msgId}:`, e.message);
      }
    }
    return messages;
  } catch (e) {
    console.error('[Gmail] history.list error:', e.message);
    return [];
  }
}

const https = require('https');

const TELEGRAM_BOT_TOKEN = 'TELEGRAM_BOT_TOKEN';
const TELEGRAM_CHAT_ID = 'TELEGRAM_CHAT_ID';

function sendTelegram(text) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        console.log(`[Telegram] sendMessage → ${res.statusCode}: ${body.slice(0, 120)}`);
        resolve(res.statusCode);
      });
    });
    req.on('error', e => { console.error('[Telegram] error:', e.message); reject(e); });
    req.write(payload);
    req.end();
  });
}

function forwardToOpenClaw(messages) {
  const payload = JSON.stringify({ source: 'gmail', messages });
  return new Promise((resolve, reject) => {
    const req = http.request(`${OPENCLAW_URL}/hooks/gmail`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENCLAW_HOOK_TOKEN}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        console.log(`[OpenClaw] /hooks/gmail → ${res.statusCode}: ${body.slice(0, 120)}`);
        resolve(res.statusCode);
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Gmail Pub/Sub webhook OK');
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end();
    return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    // 立即返回 200，避免 Google 重试
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');

    try {
      const parsed = JSON.parse(body);
      const msg = parsed.message;
      if (!msg || !msg.data) return;

      const decoded = JSON.parse(Buffer.from(msg.data, 'base64').toString('utf8'));
      const historyId = String(decoded.historyId);

      console.log(`[Pub/Sub] Push — email=${decoded.emailAddress}, historyId=${historyId}`);

      if (processedHistoryIds.has(historyId)) {
        console.log(`[Pub/Sub] Duplicate historyId=${historyId}, skip`);
        return;
      }
      processedHistoryIds.add(historyId);
      if (processedHistoryIds.size > 500) {
        processedHistoryIds.delete(processedHistoryIds.values().next().value);
      }

      // 用上次的 historyId 作为起点查询新增消息
      const sinceId = lastHistoryId || String(BigInt(historyId) - 1n);
      lastHistoryId = historyId;

      const messages = await getNewMessages(sinceId);
      if (!messages.length) {
        console.log('[Gmail] No new messages to forward');
        return;
      }

      console.log(`[Gmail] Forwarding ${messages.length} new message(s)...`);
      const esc = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      for (const msg of messages) {
        const text = `📬 <b>新邮件</b>\n<b>发件人</b>：${esc(msg.from)}\n<b>主题</b>：${esc(msg.subject)}\n<b>时间</b>：${esc(msg.date)}\n<b>内容</b>：${esc(msg.snippet)}`;
        await sendTelegram(text);
      }

    } catch (e) {
      console.error('[Error]', e.message, e.stack);
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`✅ Gmail Pub/Sub relay v2 listening on http://127.0.0.1:${PORT}`);
  console.log(`   → forwarding to: ${OPENCLAW_URL}/hooks/gmail`);
});

process.on('uncaughtException', e => console.error('[Uncaught]', e.message));
process.on('unhandledRejection', e => console.error('[Unhandled]', e));
