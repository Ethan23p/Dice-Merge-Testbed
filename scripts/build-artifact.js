// Inlines index.html's local stylesheet and scripts into one file for
// publishing as the Claude artifact: dist/dice-merge.html.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

let html = read('index.html');

html = html.replace(/<link rel="stylesheet" href="(?!https?:)([^"]+)" \/>/g, (_, href) => `<style>\n${read(href)}</style>`);

const scripts = [];
html = html.replace(/\n?<script src="([^"]+)"><\/script>/g, (_, src) => {
  scripts.push(read(src));
  return '';
});
const bundle = scripts.join('\n');
if (bundle.includes('</script')) throw new Error('a script contains "</script", which would end the inline block');
html = html.replace('</body>', `<script>\n${bundle}</script>\n</body>`);

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'dice-merge.html'), html);
console.log(`dist/dice-merge.html (${(html.length / 1024).toFixed(1)} KB, ${scripts.length} scripts)`);
