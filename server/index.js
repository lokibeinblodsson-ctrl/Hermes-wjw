import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadBoard, saveBoard, loadUsers, saveUsers } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 4000;
const HERMES_URL = process.env.HERMES_URL || 'http://127.0.0.1:8642';
const HERMES_KEY = process.env.HERMES_KEY || 'wjw-local-dev-key';
const HERMES_MODEL = process.env.HERMES_MODEL || 'Hermes-Agent';
const JWT_SECRET = process.env.JWT_SECRET || 'wjw-dev-jwt-secret-change-me';
const SYSTEM_PROMPT =
  process.env.HERMES_SYSTEM_PROMPT ||
  'You are Hermes, embedded inside the Wild Jazmine Wellness content planner. ' +
  'Help the user and their team plan, draft, and organize content. ' +
  'You can read and act on the board via the provided context. Be concise and practical.';

const app = express();
app.use(express.json({ limit: '25mb' }));

// ---------- Auth ----------
function authUser(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

app.post('/api/auth/signup', (req, res) => {
  const { username, password, displayName } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'username and password required' });
  const users = loadUsers();
  if (users.find((u) => u.username === username))
    return res.status(409).json({ error: 'Username taken' });
  const hash = bcrypt.hashSync(password, 10);
  const isFirst = users.length === 0;
  const user = {
    id: crypto.randomUUID(),
    username,
    displayName: displayName || username,
    hash,
    role: isFirst ? 'admin' : 'member',
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  saveUsers(users);
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, {
    expiresIn: '30d',
  });
  res.json({
    token,
    user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role },
  });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const users = loadUsers();
  const user = users.find((u) => u.username === username);
  if (!user || !bcrypt.compareSync(password || '', user.hash))
    return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, {
    expiresIn: '30d',
  });
  res.json({
    token,
    user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role },
  });
});

app.get('/api/auth/me', authUser, (req, res) => {
  const users = loadUsers();
  const user = users.find((u) => u.id === req.user.id);
  if (!user) return res.status(401).json({ error: 'No user' });
  res.json({
    user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role },
  });
});

// ---------- Board (server-synced) ----------
app.get('/api/board', authUser, (req, res) => {
  res.json(loadBoard());
});

app.post('/api/board', authUser, (req, res) => {
  const cards = Array.isArray(req.body) ? req.body : [];
  saveBoard(cards);
  broadcast({ type: 'board', cards });
  res.json({ ok: true, count: cards.length });
});

// ---------- Hermes streaming proxy (key never leaves server) ----------
app.post('/api/hermes/chat', authUser, async (req, res) => {
  const { messages, stream = true } = req.body || {};
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages[] required' });

  const payload = {
    model: HERMES_MODEL,
    stream,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
  };

  try {
    const upstream = await fetch(`${HERMES_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${HERMES_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!upstream.ok) {
      const txt = await upstream.text();
      return res.status(502).json({ error: 'Hermes upstream error', detail: txt.slice(0, 500) });
    }

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      for await (const chunk of upstream.body) {
        res.write(chunk);
      }
      res.end();
    } else {
      const json = await upstream.json();
      res.json(json);
    }
  } catch (e) {
    res.status(502).json({ error: 'Hermes fetch failed', detail: String(e) });
  }
});

// ---------- Static frontend (production) ----------
const dist = path.join(__dirname, '..', 'dist');
app.use(express.static(dist));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return res.status(404).end();
  res.sendFile(path.join(dist, 'index.html'));
});

// ---------- HTTP + WebSocket server ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const clients = new Set();

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

wss.on('connection', (ws, req) => {
  const token = new URL(req.url, 'http://x').searchParams.get('token');
  try {
    ws.user = jwt.verify(token, JWT_SECRET);
  } catch {
    ws.close(4001, 'unauthorized');
    return;
  }
  clients.add(ws);
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === 'board') {
      saveBoard(msg.cards);
      // relay to everyone else
      for (const other of clients) {
        if (other !== ws && other.readyState === 1)
          other.send(JSON.stringify({ type: 'board', cards: msg.cards, by: ws.user.username }));
      }
    }
  });
  ws.on('close', () => clients.delete(ws));
});

server.listen(PORT, () => {
  console.log(`[wjw] server on http://localhost:${PORT} (hermes: ${HERMES_URL})`);
});
