import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../../config.js';
import { SCHEMA_SQL } from './schema.js';

// Гарантируем наличие директории для файла базы данных
const resolvedDbPath = path.resolve(config.dbPath);
const dbDir = path.dirname(resolvedDbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Создаем подключение к SQLite
export const db = new Database(resolvedDbPath);

// Настройки производительности и целостности
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

// Применяем схему при запуске
db.exec(SCHEMA_SQL);
