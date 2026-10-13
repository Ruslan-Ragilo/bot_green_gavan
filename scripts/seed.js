import process from 'node:process';
import { db } from '../src/db/index.js';

console.log('🌱 Заполнение базы данных тестовыми заведениями и меню пилота...');

const seedData = [
  {
    name: 'Пиццерия «Гавань»',
    slug: 'pizzeria',
    description: 'Римская пицца из дровяной печи и домашние напитки',
    pickup_point: 'ул. Центральная, 4 (отдельный вход, зона выдачи)',
    group_chat_id: process.env.PIZZERIA_CHAT_ID ? Number(process.env.PIZZERIA_CHAT_ID) : null,
    items: [
      { name: 'Пицца Пепперони 30 см', description: 'Острая салями, моцарелла, томатный соус', price: 650, category: 'Пицца' },
      { name: 'Пицца Маргарита 30 см', description: 'Свежий базилик, томаты, двойная моцарелла', price: 520, category: 'Пицца' },
      { name: 'Пицца Четыре сыра 30 см', description: 'Горгонзола, моцарелла, пармезан, чеддер', price: 690, category: 'Пицца' },
      { name: 'Морс клюквенный 0.5 л', description: 'Натуральный домашний морс', price: 180, category: 'Напитки' },
    ],
  },
  {
    name: 'Кофейня «Varka»',
    slug: 'varka',
    description: 'Свежеобжаренный спешелти кофе и завтраки целый день',
    pickup_point: 'Зелёный бульвар, 2 (центральный вход, барная стойка)',
    group_chat_id: process.env.VARKA_CHAT_ID ? Number(process.env.VARKA_CHAT_ID) : null,
    items: [
      { name: 'Капучино 300 мл', description: 'Эспрессо на зерне 100% арабика, взбитое молоко', price: 240, category: 'Кофе' },
      { name: 'Латте 400 мл', description: 'Нежный кофейный напиток с мягкой пенкой', price: 270, category: 'Кофе' },
      { name: 'Флэт Уайт 250 мл', description: 'Двойной шот эспрессо с тонким слоем микропены', price: 260, category: 'Кофе' },
      { name: 'Сырники из фермерского творога', description: '3 шт. со сметаной и ягодным джемом', price: 340, category: 'Завтраки' },
      { name: 'Круассан миндальный', description: 'Слоеная выпечка с миндальным кремом и лепестками', price: 220, category: 'Выпечка' },
    ],
  },
  {
    name: 'Пекарня «Булочки»',
    slug: 'bulochki',
    description: 'Ремесленный хлеб на закваске и свежая сдоба каждое утро',
    pickup_point: 'ул. Парковая, 7 (пекарня у фонтана, окно предзаказа)',
    group_chat_id: process.env.BULOCHKI_CHAT_ID ? Number(process.env.BULOCHKI_CHAT_ID) : null,
    items: [
      { name: 'Синнабон с корицей', description: 'Фирменная булочка с корицей и крем-чизом', price: 210, category: 'Сдоба' },
      { name: 'Улитка со шпинатом и брынзой', description: 'Сытная слоеная выпечка', price: 190, category: 'Выпечка' },
      { name: 'Тартин ремесленный 500 г', description: 'Свежий пшенично-ржаной хлеб на живой закваске', price: 260, category: 'Хлеб' },
      { name: 'Эклер ванильный', description: 'Заварное тесто с кремом из мадагаскарской ванили', price: 180, category: 'Десерты' },
    ],
  },
];

const insertPlace = db.prepare(`
  INSERT INTO places (name, slug, description, pickup_point, group_chat_id, is_active)
  VALUES (@name, @slug, @description, @pickup_point, @group_chat_id, 1)
  ON CONFLICT(slug) DO UPDATE SET
    name = excluded.name,
    description = excluded.description,
    pickup_point = excluded.pickup_point,
    group_chat_id = COALESCE(excluded.group_chat_id, places.group_chat_id)
`);

const insertItem = db.prepare(`
  INSERT INTO items (place_id, name, description, price, category, is_available)
  VALUES (?, ?, ?, ?, ?, 1)
`);

const insertStaff = db.prepare(`
  INSERT INTO place_staff (place_id, user_id, name, role)
  VALUES (?, ?, ?, 'staff')
  ON CONFLICT(place_id, user_id) DO NOTHING
`);

const testStaffId = process.env.STAFF_TELEGRAM_ID ? Number(process.env.STAFF_TELEGRAM_ID) : null;

const transaction = db.transaction(() => {
  for (const placeData of seedData) {
    insertPlace.run({
      name: placeData.name,
      slug: placeData.slug,
      description: placeData.description,
      pickup_point: placeData.pickup_point,
      group_chat_id: placeData.group_chat_id,
    });

    const placeRow = db.prepare('SELECT id FROM places WHERE slug = ?').get(placeData.slug);
    const placeId = placeRow.id;

    // Очищаем старые тестовые позиции заведения перед обновлением сида
    db.prepare('DELETE FROM items WHERE place_id = ?').run(placeId);

    for (const item of placeData.items) {
      insertItem.run(placeId, item.name, item.description, item.price, item.category);
    }

    // Если передан STAFF_TELEGRAM_ID в .env, автоматически назначаем его сотрудником
    if (testStaffId) {
      insertStaff.run(placeId, testStaffId, 'Тестовый сотрудник');
    }
  }
});

transaction();

console.log('✅ База данных успешно наполнена пилотными заведениями и меню!');
if (testStaffId) {
  console.log(`👤 Пользователь Telegram ID ${testStaffId} назначен сотрудником всех заведений.`);
}
