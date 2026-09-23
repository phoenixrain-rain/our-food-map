import { compressPhoto } from './photos.js?v=2.8.0';

// Decode/orient/resize first. Only a flattened JPEG leaves the device; never the original/EXIF.
export async function loadAvatar(file) {
  const compressed = await compressPhoto(file), url = URL.createObjectURL(compressed);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('头像读取失败，请换一张照片')); image.src = url; });
    return { image, dispose: () => URL.revokeObjectURL(url) };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}
export function drawAvatar(canvas, image, zoom = 1, x = .5, y = .5) {
  const side = Math.min(image.naturalWidth, image.naturalHeight) / Math.max(1, Math.min(3, Number(zoom) || 1));
  const sx = (image.naturalWidth - side) * Math.max(0, Math.min(1, x));
  const sy = (image.naturalHeight - side) * Math.max(0, Math.min(1, y));
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器无法处理图片，请换用系统浏览器');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 512, 512);
  ctx.drawImage(image, sx, sy, side, side, 0, 0, 512, 512);
}
export async function avatarFile(canvas) {
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .86));
  if (!blob?.size || blob.size > 1024 * 1024) throw new Error('头像处理失败，请重新选择');
  return new File([blob], `${crypto.randomUUID()}.jpg`, { type: 'image/jpeg' });
}
