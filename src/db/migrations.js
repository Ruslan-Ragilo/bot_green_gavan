/**
 * Миграции существующей базы под актуальную схему.
 * Новые базы создаются сразу по SCHEMA_SQL — для них миграции ничего не делают.
 */

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
}
