/**
 * Миграции существующей базы под актуальную схему.
 * Новые базы создаются сразу по SCHEMA_SQL — для них миграции ничего не делают.
 */

const PLACE_COLUMNS = {
  paused_until: 'TEXT',
  open_time: 'TEXT',
  close_time: 'TEXT',
  slot_capacity: 'INTEGER',
  last_report_date: 'TEXT',
};

const ORDER_COLUMNS = {
  target_at: 'TEXT',
  cancel_reason: 'TEXT',
  accept_reminded_at: 'TEXT',
  ready_reminded_at: 'TEXT',
  client_pickup_reminded_at: 'TEXT',
  staff_pickup_reminded_at: 'TEXT',
};

function addMissingColumns(db, table, columns) {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
  for (const [name, type] of Object.entries(columns)) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
      console.log(`[DB] Миграция: добавлена колонка ${table}.${name}`);
    }
  }
}

/**
 * SQLite не умеет менять CHECK — пересобираем таблицу orders, чтобы разрешить статус no_show.
 * Внешние ключи временно отключаются, иначе DROP TABLE каскадно удалит order_items.
 */
function allowNoShowStatus(db) {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'`).get();
  if (!row || row.sql.includes("'no_show'")) return;

  const newSql = row.sql
    .replace(/CREATE TABLE\s+("?)orders\1/i, 'CREATE TABLE orders_new')
    .replace("'expired')", "'expired', 'no_show')");
  if (!newSql.includes("'no_show'")) {
    throw new Error('[DB] Не удалось обновить CHECK статусов в таблице orders');
  }

  const columns = db.prepare('PRAGMA table_info(orders)').all().map(c => `"${c.name}"`).join(', ');

  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(newSql);
      db.exec(`INSERT INTO orders_new (${columns}) SELECT ${columns} FROM orders`);
      db.exec('DROP TABLE orders');
      db.exec('ALTER TABLE orders_new RENAME TO orders');
    })();
    const broken = db.pragma('foreign_key_check');
    if (broken.length > 0) {
      console.warn('[DB] Миграция: нарушения внешних ключей после пересборки orders:', broken.length);
    }
    console.log('[DB] Миграция: таблица orders пересобрана (статус no_show)');
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

/**
 * Раньше у пользователя было одно закреплённое расписание (user_id — первичный ключ).
 * Теперь можно закрепить по одному на каждый маршрут/направление/остановку — переносим старые записи.
 */
function allowMultiplePins(db) {
  const columns = db.prepare('PRAGMA table_info(user_pins)').all().map(c => c.name);
  if (columns.length === 0 || columns.includes('id')) return;

  db.transaction(() => {
    db.exec('ALTER TABLE user_pins RENAME TO user_pins_old');
    db.exec(`
      CREATE TABLE user_pins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        message_id INTEGER NOT NULL,
        route_id TEXT NOT NULL,
        direction_id TEXT NOT NULL,
        stop_id TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, route_id, direction_id, stop_id)
      )
    `);
    db.exec(`
      INSERT INTO user_pins (user_id, message_id, route_id, direction_id, stop_id, created_at)
      SELECT user_id, message_id, route_id, direction_id, stop_id, created_at FROM user_pins_old
    `);
    db.exec('DROP TABLE user_pins_old');
  })();
  console.log('[DB] Миграция: user_pins поддерживает несколько закреплённых расписаний');
}

export function runMigrations(db) {
  allowMultiplePins(db);
  addMissingColumns(db, 'places', PLACE_COLUMNS);
  addMissingColumns(db, 'orders', ORDER_COLUMNS);
  allowNoShowStatus(db);
  // Индекс для лимита заказов на слот — только после того, как колонка target_at точно существует
  db.exec('CREATE INDEX IF NOT EXISTS idx_orders_place_target ON orders(place_id, target_at)');
}
