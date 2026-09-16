import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const visited = new Set(), sections = [];
async function visit(name) {
  if (visited.has(name)) return; visited.add(name);
  const root = path.join('node_modules', name), pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  let license;
  for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md']) {
    try { license = await readFile(path.join(root, file), 'utf8'); break; } catch { /* Try the package's naming convention. */ }
  }
  if (!license) throw new Error(`Missing license text for ${name}`);
  sections.push(`## ${name} ${pkg.version}\n\n${license.trim()}`);
  for (const dependency of Object.keys(pkg.dependencies || {})) await visit(dependency);
}
await visit('@supabase/supabase-js');
await writeFile('vendor/THIRD-PARTY-NOTICES.md', `# Third-party notices\n\nThe local browser SDK bundle is built from the following packages.\n\n${sections.join('\n\n---\n\n')}\n`);
