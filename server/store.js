// Server-side board + auth store.
// Persists board state and users to JSON files so the app survives restarts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const BOARD_FILE = path.join(DATA_DIR, 'board.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BOARD_FILE)) fs.writeFileSync(BOARD_FILE, '[]', 'utf8');
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]', 'utf8');
}

export function loadBoard() {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(BOARD_FILE, 'utf8'));
  } catch {
    return [];
  }
}

export function saveBoard(cards) {
  ensure();
  fs.writeFileSync(BOARD_FILE, JSON.stringify(cards, null, 2), 'utf8');
}

export function loadUsers() {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

export function saveUsers(users) {
  ensure();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}
