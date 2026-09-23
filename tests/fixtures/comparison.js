const meal = (id, name, extra = {}) => ({ id, place_id: id, space_id: 'local-space', name, status: 'eaten', visit_date: '2026-09-15', created_at: '2026-09-15T01:00:00Z', price_per_person: null, city: '沈阳', category: '家常菜', tags: [], ...extra });
export const comparisonFixture = {
  nickname: '我', partnerName: 'TA', photos: [],
  restaurants: [
    meal('a-old', '春日小馆', { place_id: 'a', visit_date: '2026-08-01', created_at: '2026-08-01T01:00:00Z', price_per_person: 60 }),
    meal('a-new', '春日小馆', { place_id: 'a', visit_date: '2026-09-20', price_per_person: 90, address: '春日街 18 号', tags: ['约会'] }),
    meal('a-wish', '春日小馆', { place_id: 'a', status: 'wishlist', visit_date: '2026-10-01', price_per_person: 25 }),
    meal('b', '街角面馆', { price_per_person: 0, category: '面馆粉店', city: '大连', tags: ['免费试吃'] }),
    meal('c', '<img src=x onerror=alert(1)> 想吃的长名字店铺', { status: 'wishlist', price_per_person: 10, visit_date: null }),
    meal('d', '春日小馆', { city: '北京', tags: ['另一家分店'] }),
    meal('removed', '已删的店', { deleted_at: '2026-09-21T00:00:00Z' })
  ],
  reviews: [
    ...['local-me', 'local-partner'].flatMap(user_id => [
      { id: `old-${user_id}`, restaurant_id: 'a-old', user_id, taste: 8, value: 7, vibe: 9 },
      { id: `b-${user_id}`, restaurant_id: 'b', user_id, taste: 8, value: 9, vibe: 6 }
    ]),
    { id: 'pending', restaurant_id: 'a-new', user_id: 'local-me', taste: 10, value: 10, vibe: 10 },
    { id: 'partial', restaurant_id: 'd', user_id: 'local-me', taste: 4 },
    { id: 'wish', restaurant_id: 'c', user_id: 'local-me', taste: 10, value: 10, vibe: 10 }
  ]
};
