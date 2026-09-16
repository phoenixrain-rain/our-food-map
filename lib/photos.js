export const MAX_PHOTOS = 8;
export function blobDataURL(blob) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('照片读取失败，请重新选择')); reader.readAsDataURL(blob); });
}
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* Android/WebKit fallback */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    const done = () => URL.revokeObjectURL(url);
    img.onload = () => { done(); resolve(img); };
    img.onerror = () => { done(); reject(new Error('无法读取这张照片，请转换为 JPG、PNG 或 WebP 后重试')); };
    img.src = url;
  });
}
export async function compressPhoto(file) {
  if (!file || !file.size) throw new Error('照片是空文件');
  if (file.size > 30 * 1024 * 1024) throw new Error('单张照片不能超过 30 MB');
  if (file.type && !file.type.startsWith('image/')) throw new Error('请选择图片文件');
  const image = await decodeImage(file);
  try {
    const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
    if (!width || !height) throw new Error('照片尺寸无法读取');
    const scale = Math.min(1, 1800 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器无法处理图片，请换用系统浏览器');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .82));
    if (!blob || !blob.size) throw new Error('图片压缩失败，请重新选择');
    if (blob.size > 5 * 1024 * 1024) throw new Error('照片仍然过大，请选择尺寸较小的图片');
    return new File([blob], `${crypto.randomUUID()}.jpg`, { type: 'image/jpeg' });
  } finally { image.close?.(); }
}
