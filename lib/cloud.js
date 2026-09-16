const BUCKET = 'food-photos';
const CLEANUP_KEY = 'food-map-photo-cleanup-v2';
async function allRows(client, table, space) {
  const rows = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await client.from(table).select('*').eq('space_id', space).order('id').range(from, from + 499);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}
export class CloudRepository {
  constructor(client) { this.client = client; this.urls = new Map(); }
  async signPhotos(photos, force = false) {
    const pending = photos.filter(p => force || !this.urls.has(p.path) || this.urls.get(p.path).until < Date.now());
    for (let i = 0; i < pending.length; i += 100) {
      const group = pending.slice(i, i + 100);
      const { data, error } = await this.client.storage.from(BUCKET).createSignedUrls(group.map(p => p.path), 3600);
      if (error) {
        // A storage outage must not blank the restaurant list. Keep still-valid cached links.
        for (const p of group) if (!this.urls.get(p.path) || this.urls.get(p.path).until < Date.now()) this.urls.delete(p.path);
        continue;
      }
      for (let j = 0; j < group.length; j++) {
        const signed = data?.find(item => item.path === group[j].path) || data?.[j];
        if (signed?.signedUrl && !signed.error) this.urls.set(group[j].path, { url: signed.signedUrl, until: Date.now() + 50 * 60 * 1000 });
        else this.urls.delete(group[j].path);
      }
    }
    return photos.map(p => ({ ...p, url: this.urls.get(p.path)?.url || '', unavailable: !this.urls.has(p.path) }));
  }
  async load(userId) {
    const { data: membership, error } = await this.client.from('space_members').select('space_id,spaces(id,name,invite_code)').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    if (!membership?.spaces) return { space: null, members: [], restaurants: [], reviews: [], photos: [] };
    const space = membership.spaces;
    const [members, restaurants, reviews, photos] = await Promise.all(['space_members', 'restaurants', 'reviews', 'food_photos'].map(table =>
      table === 'space_members' ? this.client.from(table).select('user_id,nickname,role,joined_at').eq('space_id', space.id).order('joined_at').then(result => { if (result.error) throw result.error; return result.data; }) : allRows(this.client, table, space.id)));
    return { space, members, restaurants, reviews, photos: await this.signPhotos(photos.sort((a, b) => a.created_at.localeCompare(b.created_at))) };
  }
  async save({ restaurant, review, added, removed, expected }, userId, progress) {
    for (let index = 0; index < added.length; index++) {
      const photo = added[index];
      photo.path ||= `${restaurant.space_id}/${restaurant.id}/${userId}/${crypto.randomUUID()}.jpg`;
      if (photo.uploaded) continue;
      progress(`正在上传照片 ${index + 1}/${added.length}…`);
      const { error } = await this.client.storage.from(BUCKET).upload(photo.path, photo.file, { contentType: 'image/jpeg', cacheControl: '3600', upsert: false });
      if (error && !/already exists|duplicate/i.test(error.message)) throw error;
      photo.uploaded = true;
    }
    progress('正在保存记录和评价…');
    const { data, error } = await this.client.rpc('save_food_record', {
      p_restaurant: restaurant, p_review: review, p_photo_paths: added.map(p => p.path),
      p_remove_photo_ids: removed, p_expected_updated_at: expected || null
    });
    if (error) throw error;
    this.queueCleanup(data.removed_paths || [], userId);
    return data.restaurant;
  }
  queueCleanup(paths, userId) {
    if (!paths.length) return;
    try {
      const queue = JSON.parse(localStorage.getItem(CLEANUP_KEY) || '[]');
      const known = new Set(queue.map(x => x.path));
      for (const path of paths) if (path && !known.has(path)) { queue.push({ path, userId }); known.add(path); }
      localStorage.setItem(CLEANUP_KEY, JSON.stringify(queue));
    } catch { /* A failed optional cleanup never reverses a successful record save. */ }
  }
  async cleanup(userId) {
    try {
      const queue = JSON.parse(localStorage.getItem(CLEANUP_KEY) || '[]');
      const mine = queue.filter(x => x.userId === userId).slice(0, 100);
      if (!mine.length) return;
      const { data, error } = await this.client.from('food_photos').select('path').in('path', mine.map(x => x.path));
      if (error) return;
      // A lost save response may have committed successfully: never delete a referenced object.
      const referenced = new Set(data.map(x => x.path));
      const paths = mine.filter(x => !referenced.has(x.path)).map(x => x.path);
      if (paths.length) { const result = await this.client.storage.from(BUCKET).remove(paths); if (result.error) return; }
      const handled = new Set(mine.map(x => x.path));
      const latest = JSON.parse(localStorage.getItem(CLEANUP_KEY) || '[]');
      localStorage.setItem(CLEANUP_KEY, JSON.stringify(latest.filter(x => !handled.has(x.path))));
    } catch { /* Retry on the next successful sync. */ }
  }
}
