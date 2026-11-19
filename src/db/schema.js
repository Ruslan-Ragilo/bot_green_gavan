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

-- Закреплённые расписания в шапке чата (несколько на пользователя: маршрут + направление + остановка)
CREATE TABLE IF NOT EXISTS user_pins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  route_id TEXT NOT NULL,
  direction_id TEXT NOT NULL,
  stop_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, route_id, direction_id, stop_id)
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
  -- Пульт кухни: пауза приёма (UTC ISO), часы работы (ЧЧ:ММ по Минску), лимит заказов на слот
  paused_until TEXT,
  open_time TEXT,
  close_time TEXT,
  slot_capacity INTEGER,
  last_report_date TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Позиции меню заведений
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price REAL NOT NULL CHECK (price >= 0),
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
-- Статусы строго: sent, accepted, ready, issued, cancelled, expired, no_show
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(telegram_id),
  place_id INTEGER NOT NULL REFERENCES places(id),
  status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent', 'accepted', 'ready', 'issued', 'cancelled', 'expired', 'no_show')),
  fulfillment_type TEXT NOT NULL DEFAULT 'pickup',
  pickup_point TEXT NOT NULL,
  desired_time TEXT NOT NULL,
  comment TEXT,
  total_price REAL NOT NULL CHECK (total_price >= 0),
  group_message_id INTEGER,
  cooking_minutes INTEGER DEFAULT 20,
  ready_at TEXT,
  -- Точный момент, к которому жилец хочет получить заказ (UTC ISO)
  target_at TEXT,
  -- Причина отмены: client, staff, no_ingredients, closing, overloaded, admin
  cancel_reason TEXT,
  -- Отметки отправленных напоминаний (чтобы не дублировать)
  accept_reminded_at TEXT,
  ready_reminded_at TEXT,
  client_pickup_reminded_at TEXT,
  staff_pickup_reminded_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Снимок позиций в оформленном заказе
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id INTEGER,
  item_name TEXT NOT NULL,
  price REAL NOT NULL,
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
-- Индексы по колонкам, добавленным миграциями, создаются в migrations.js (старая база их ещё не имеет)
CREATE INDEX IF NOT EXISTS idx_cart_user_place ON cart_items(user_id, place_id);
CREATE INDEX IF NOT EXISTS idx_staff_user_place ON place_staff(user_id, place_id);

-- «Домашнее и ручное»: мастера (кулинары, рукодельники). Заказы — напрямую в личке мастера.
CREATE TABLE IF NOT EXISTS makers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE NOT NULL,
  name TEXT NOT NULL,
  about TEXT NOT NULL DEFAULT '',
  about_entities TEXT,             -- JSON: форматирование Telegram (жирный, курсив) как прислал мастер
  contact TEXT,                    -- @username для кнопки «Написать» или телефон
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'hidden', 'rejected')),
  cover_photo TEXT,                -- не используется (было фото карточки мастера)
  stock_updated_at TEXT,           -- когда мастер последний раз подтверждал наличие (UTC)
  last_notified_at TEXT,           -- последняя рассылка подписчикам (UTC)
  notified_stock TEXT,             -- JSON: id позиций, которые были в наличии на момент прошлой рассылки
  created_at TEXT DEFAULT (datetime('now'))
);

-- Позиции мастера: пост целиком (текст + форматирование + фото), как мастер его прислал
CREATE TABLE IF NOT EXISTS maker_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  maker_id INTEGER NOT NULL REFERENCES makers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  price_text TEXT,
  category TEXT NOT NULL DEFAULT 'other',
  body TEXT NOT NULL DEFAULT '',
  body_entities TEXT,
  photos TEXT NOT NULL DEFAULT '[]', -- JSON-массив file_id
  variants TEXT,                   -- JSON: [{ name, price, in_stock }] — начинки/варианты внутри одного поста
  in_stock INTEGER NOT NULL DEFAULT 1,
  published INTEGER NOT NULL DEFAULT 1, -- 0 — мастер скрыл позицию (например, сезонную), покупатели её не видят
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_maker_items_maker ON maker_items(maker_id);

-- Тематические подборки («🎄 Новогодняя подборка»): создаёт и показывает/скрывает администратор
CREATE TABLE IF NOT EXISTS maker_collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  description_entities TEXT,
  visible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Какие позиции мастера отметили в подборку
CREATE TABLE IF NOT EXISTS maker_collection_items (
  collection_id INTEGER NOT NULL REFERENCES maker_collections(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES maker_items(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (collection_id, item_id)
);

-- Простые настройки бота (ключ → значение), например обложка раздела «Домашнее и ручное»
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Аналитика мастеров: кто открыл карточку мастера, позицию, нажал «Написать»
CREATE TABLE IF NOT EXISTS maker_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  maker_id INTEGER NOT NULL,
  item_id INTEGER,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,              -- view_maker | view_item | contact
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_maker_events ON maker_events(maker_id, type, created_at);

-- Отчёты об ошибках в лог-бот: когда одинаковая ошибка отправлялась последний раз (защита от спама,
-- переживает перезапуски — иначе цикл падений присылал бы сообщение на каждый старт)
CREATE TABLE IF NOT EXISTS error_reports (
  key TEXT PRIMARY KEY,
  last_sent_at INTEGER NOT NULL,
  suppressed INTEGER NOT NULL DEFAULT 0
);

-- Подписки жильцов на мастеров (уведомления о наличии)
CREATE TABLE IF NOT EXISTS maker_subscriptions (
  user_id INTEGER NOT NULL,
  maker_id INTEGER NOT NULL REFERENCES makers(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, maker_id)
);
`;
