/**
 * Начальные данные тестовых заведений и меню для пилота
 */
export const DEFAULT_PLACES = [
  {
    name: 'Кофейня «Varka»',
    slug: 'varka',
    description: 'Свежеобжаренный спешелти кофе, выпечка и завтраки целый день ☕️',
    pickup_point: 'Зелёный бульвар, 2 (центральный вход, барная стойка)',
    group_chat_id: null,
    is_active: 1,
    items: [
      { name: 'Капучино 300 мл', description: 'Эспрессо на зерне 100% арабика, взбитое молоко', price: 5.5, category: 'Кофе' },
      { name: 'Латте 400 мл', description: 'Нежный кофейный напиток с мягкой молочной пенкой', price: 6.0, category: 'Кофе' },
      { name: 'Флэт Уайт 250 мл', description: 'Двойной шот эспрессо с тонким слоем микропены', price: 6.5, category: 'Кофе' },
      { name: 'Американо 200 мл', description: 'Классический чёрный кофе на двойном эспрессо', price: 4.5, category: 'Кофе' },
      { name: 'Раф Ванильный 350 мл', description: 'Сливочный кофе со взбитыми сливками и ванилью', price: 7.5, category: 'Кофе' },
      { name: 'Матча-латте 350 мл', description: 'Японский чай матча на кокосовом молоке', price: 7.0, category: 'Чай и напитки' },
      { name: 'Чай Облепиховый 400 мл', description: 'Натуральный ягодный согревающий чай с мёдом', price: 6.5, category: 'Чай и напитки' },
      { name: 'Круассан миндальный', description: 'Слоеная выпечка с миндальным кремом и лепестками', price: 6.5, category: 'Выпечка' },
      { name: 'Круассан классический', description: 'Французский сливочный слоеный круассан', price: 4.0, category: 'Выпечка' },
      { name: 'Сырники из фермерского творога', description: '3 шт. со сметаной и ягодным джемом', price: 9.5, category: 'Завтраки' },
      { name: 'Сэндвич с индейкой и песто', description: 'Хрустящая чиабатта, филе индейки, томаты, моцарелла, песто', price: 11.0, category: 'Завтраки' },
      { name: 'Сэндвич с лососем и сливочным сыром', description: 'Слабосоленый лосось, сливочный сыр, свежий огурец, зелень', price: 13.5, category: 'Завтраки' },
    ],
  },
];

export function ensureSeedData(dbInstance) {
  const row = dbInstance.prepare("SELECT count(*) as count FROM places WHERE slug = 'varka'").get();
  if (row && row.count > 0) return;

  const insertPlace = dbInstance.prepare(`
    INSERT INTO places (name, slug, description, pickup_point, group_chat_id, is_active)
    VALUES (@name, @slug, @description, @pickup_point, @group_chat_id, @is_active)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      pickup_point = excluded.pickup_point,
      is_active = excluded.is_active
  `);

  const insertItem = dbInstance.prepare(`
    INSERT INTO items (place_id, name, description, price, category, is_available)
    VALUES (?, ?, ?, ?, ?, 1)
  `);

  const tx = dbInstance.transaction(() => {
    for (const place of DEFAULT_PLACES) {
      insertPlace.run(place);
      const p = dbInstance.prepare('SELECT id FROM places WHERE slug = ?').get(place.slug);
      for (const item of place.items) {
        insertItem.run(p.id, item.name, item.description, item.price, item.category);
      }
    }
  });

  tx();
  console.log('☕️ Кофейня «Varka» успешно инициализирована с актуальным меню и ценами (BYN).');
}
