// O tsc só emite .js. Assets referenciados pelo webview (CSS) precisam ser
// copiados para out/ à mão, senão o chat carrega sem estilo nenhum.
const fs = require('fs');
const path = require('path');

const assets = [['src/chat/chat.css', 'out/chat/chat.css']];

for (const [from, to] of assets) {
  const dest = path.resolve(__dirname, '..', to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.resolve(__dirname, '..', from), dest);
  console.log(`copiado: ${from} -> ${to}`);
}
