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
  {
    name: 'Пиццерия «Kava la Pechi»',
    slug: 'kava_la_pechi',
    description: 'Хрустящая римская пицца из дровяной печи и домашние напитки 🍕🔥',
    pickup_point: 'Зелёная Гавань (зона выдачи пиццы)',
    group_chat_id: null,
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
];

export function ensureSeedData(dbInstance) {
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

  const countItems = dbInstance.prepare('SELECT count(*) as count FROM items WHERE place_id = ?');

  const tx = dbInstance.transaction(() => {
    for (const place of DEFAULT_PLACES) {
      insertPlace.run(place);
      const p = dbInstance.prepare('SELECT id FROM places WHERE slug = ?').get(place.slug);
      const existing = countItems.get(p.id);
      if (!existing || existing.count === 0) {
        for (const item of place.items) {
          insertItem.run(p.id, item.name, item.description, item.price, item.category);
        }
      }
    }
  });

  tx();
  console.log('🍕☕️ Заведения («Kava la Pechi» и «Varka») готовы к приёму предзаказов.');
}
