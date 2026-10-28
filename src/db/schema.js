// DDL-схема таблиц базы данных SQLite

export const SCHEMA_SQL = `
-- Пользователи бота (жильцы)
CREATE TABLE IF NOT EXISTS users (
  telegram_id INTEGER PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  username TEXT,
  phone TEXT,
  consent_given_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Активное сообщение экрана жильца (гарантия одного окна и защита от дублей)
CREATE TABLE IF NOT EXISTS user_screens (
  user_id INTEGER PRIMARY KEY,
  message_id INTEGER NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Закрепленное избранное расписание в шапке чата
CREATE TABLE IF NOT EXISTS user_pins (
  user_id INTEGER PRIMARY KEY,
  message_id INTEGER NOT NULL,
  route_id TEXT NOT NULL,
  direction_id TEXT NOT NULL,
  stop_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Заведения ЖК
CREATE TABLE IF NOT EXISTS places (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  pickup_point TEXT NOT NULL,
  group_chat_id INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Позиции меню заведений
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price INTEGER NOT NULL CHECK (price >= 0),
  is_available INTEGER NOT NULL DEFAULT 1,
  category TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Сотрудники заведений (только они могут нажимать кнопки в группе)
CREATE TABLE IF NOT EXISTS place_staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(place_id, user_id)
);

-- Черновик корзины жильца (хранится в БД, без сессий/conversations)
CREATE TABLE IF NOT EXISTS cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, place_id, item_id)
);

-- Заказы
-- Статусы строго: sent, accepted, ready, issued, cancelled, expired
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(telegram_id),
  place_id INTEGER NOT NULL REFERENCES places(id),
  status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent', 'accepted', 'ready', 'issued', 'cancelled', 'expired')),
  fulfillment_type TEXT NOT NULL DEFAULT 'pickup',
  pickup_point TEXT NOT NULL,
  desired_time TEXT NOT NULL,
  comment TEXT,
  total_price INTEGER NOT NULL CHECK (total_price >= 0),
  group_message_id INTEGER,
  cooking_minutes INTEGER DEFAULT 20,
  ready_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Снимок позиций в оформленном заказе
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id INTEGER,
  item_name TEXT NOT NULL,
  price INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0)
);

-- История изменений статусов (для аудита и отчётов)
CREATE TABLE IF NOT EXISTS order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by_user_id INTEGER,
  changed_at TEXT DEFAULT (datetime('now'))
);

-- Индексы для оптимизации поиска и фоновых проверок
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_place_id ON orders(place_id);
CREATE INDEX IF NOT EXISTS idx_cart_user_place ON cart_items(user_id, place_id);
CREATE INDEX IF NOT EXISTS idx_staff_user_place ON place_staff(user_id, place_id);
`;
