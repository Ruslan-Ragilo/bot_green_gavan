import process from 'node:process';
import { db } from '../src/db/index.js';

console.log('🌱 Заполнение базы данных тестовыми заведениями и меню пилота...');

const seedData = [
  {
    name: 'Пиццерия «Kava la Pechi»',
    slug: 'kava_la_pechi',
    description: 'Хрустящая римская пицца из дровяной печи и домашние напитки 🍕🔥',
    pickup_point: 'Зелёная Гавань (зона выдачи пиццы)',
    group_chat_id: process.env.PIZZERIA_CHAT_ID ? Number(process.env.PIZZERIA_CHAT_ID) : null,
    is_active: 1,
    items: [
      { name: 'Пицца Пепперони 30 см', description: 'Пикантная салями пепперони, моцарелла, томатный соус, орегано', price: 21.5, category: 'Пицца' },
      { name: 'Пицца Маргарита 30 см', description: 'Томаты черри, моцарелла фиор ди латте, базилик, оливковое масло', price: 17.5, category: 'Пицца' },
      { name: 'Пицца Четыре сыра 30 см', description: 'Моцарелла, горгонзола, пармезан, чеддер, сливочный соус', price: 23.0, category: 'Пицца' },
      { name: 'Пицца Ветчина и грибы 30 см', description: 'Нежная ветчина, свежие шампиньоны, моцарелла, томатный соус', price: 20.5, category: 'Пицца' },
      { name: 'Пицца Карбонара 30 см', description: 'Хрустящий бекон, сливочный соус, моцарелла, пармезан, свежий перец', price: 22.0, category: 'Пицца' },
      { name: 'Пицца Цыплёнок BBQ 30 см', description: 'Филе цыплёнка, соус барбекю, красный лук, моцарелла, бекон', price: 22.5, category: 'Пицца' },
      { name: 'Пицца Груша и горгонзола 30 см', description: 'Сладкая груша, благородный сыр горгонзола, моцарелла, грецкий орех, мёд', price: 24.0, category: 'Пицца' },
      { name: 'Пицца Дьявола (Острая) 30 см', description: 'Острая колбаса чоризо, халапеньо, моцарелла, чили масло', price: 22.5, category: 'Пицца' },
      { name: 'Пицца Четыре сезона 30 см', description: '4 вкуса в одной: пепперони, ветчина с грибами, сырная и томаты с базиликом', price: 23.5, category: 'Пицца' },
      { name: 'Фокачча с розмарином и солью', description: 'Хрустящая итальянская лепёшка из печи с розмарином и оливковым маслом', price: 6.5, category: 'Выпечка' },
      { name: 'Морс клюквенный домашний 0.5 л', description: 'Свежесваренный натуральный ягодный морс', price: 4.5, category: 'Напитки' },
      { name: 'Лимонад цитрусовый 0.5 л', description: 'Домашний лимонад с апельсином, лимоном и мятой', price: 5.5, category: 'Напитки' },
    ],
  },
  {
    name: 'Кофейня «Varka»',
    slug: 'varka',
    description: 'Свежеобжаренный спешелти кофе, выпечка и завтраки целый день ☕️',
    pickup_point: 'Зелёный бульвар, 2 (центральный вход, барная стойка)',
    group_chat_id: process.env.VARKA_CHAT_ID ? Number(process.env.VARKA_CHAT_ID) : null,
    is_active: 1,
    items: [
      { name: 'Капучино 300 мл', description: 'Эспрессо на зерне 100% арабика, взбитое молоко', price: 5.5, category: 'Кофе' },
      { name: 'Латте 400 мл', description: 'Нежный кофейный напиток с мягкой молочной пенкой', price: 6.0, category: 'Кофе' },
      { name: 'Флэт Уайт 250 мл', description: 'Двойной шот эспрессо с тонким слоем микропены', price: 6.5, category: 'Кофе' },
      { name: 'Американо 200 мл', description: 'Классический чёрный кофе на двойном эспрессо', price: 4.5, category: 'Кофе' },
      { name: 'Раф Ванильный 350 мл', description: 'Сливочный кофе со взбитыми сливками и ванилью', price: 7.5, category: 'Кофе' },
      { name: 'Матча-латте 350 мл', description: 'Японский зелёный чай матча на кокосовом молоке', price: 7.0, category: 'Чай и напитки' },
      { name: 'Чай Облепиховый 400 мл', description: 'Натуральный ягодный согревающий чай с мёдом', price: 6.5, category: 'Чай и напитки' },
      { name: 'Круассан миндальный', description: 'Слоеная выпечка с миндальным кремом и лепестками', price: 6.5, category: 'Выпечка' },
      { name: 'Круассан классический', description: 'Французский сливочный слоеный круассан', price: 4.0, category: 'Выпечка' },
      { name: 'Сырники из фермерского творога', description: '3 шт. со сметаной и ягодным джемом', price: 9.5, category: 'Завтраки' },
      { name: 'Сэндвич с индейкой и песто', description: 'Хрустящая чиабатта, филе индейки, томаты, моцарелла, песто', price: 11.0, category: 'Завтраки' },
      { name: 'Сэндвич с лососем и сливочным сыром', description: 'Слабосоленый лосось, сливочный сыр, свежий огурец, зелень', price: 13.5, category: 'Завтраки' },
    ],
  },
  {
    name: 'Пекарня «Булочки»',
    slug: 'bulochki',
    description: 'Ремесленный хлеб на закваске и свежая сдоба каждое утро',
    pickup_point: 'ул. Парковая, 7 (пекарня у фонтана, окно предзаказа)',
    group_chat_id: process.env.BULOCHKI_CHAT_ID ? Number(process.env.BULOCHKI_CHAT_ID) : null,
    is_active: 0,
    items: [
      { name: 'Синнабон с корицей', description: 'Фирменная булочка с корицей и крем-чизом', price: 6.0, category: 'Сдоба' },
      { name: 'Улитка со шпинатом и брынзой', description: 'Сытная слоеная выпечка', price: 5.5, category: 'Выпечка' },
      { name: 'Тартин ремесленный 500 г', description: 'Свежий пшенично-ржаной хлеб на живой закваске', price: 7.0, category: 'Хлеб' },
      { name: 'Эклер ванильный', description: 'Заварное тесто с кремом из мадагаскарской ванили', price: 4.5, category: 'Десерты' },
    ],
  },
];

const insertPlace = db.prepare(`
  INSERT INTO places (name, slug, description, pickup_point, group_chat_id, is_active)
  VALUES (@name, @slug, @description, @pickup_point, @group_chat_id, @is_active)
  ON CONFLICT(slug) DO UPDATE SET
    name = excluded.name,
    description = excluded.description,
    pickup_point = excluded.pickup_point,
    is_active = excluded.is_active,
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
      is_active: placeData.is_active,
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
