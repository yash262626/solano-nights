// Minimal static file server for the game (no dependencies). Usage: node server.js [port]
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;

// Friendly start-up check: the game loads Three.js from node_modules via an import map.
if (!fs.existsSync(path.join(root, 'node_modules', 'three', 'build', 'three.module.js'))) {
  console.error('\nThree.js is not installed yet. Run "npm install" once in this folder, then start the server again.\n');
  process.exit(1);
}
const port = Number(process.argv.find((a) => /^\d+$/.test(a)) || process.env.PORT || 8080);
// Dev-only features (the /__shot capture endpoint used by the test kit) require an explicit flag.
const DEV = process.argv.includes('--dev') || process.env.SOLANO_DEV === '1';
const HOST = process.env.HOST || '127.0.0.1'; // local machine only by default
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  // dev helper used by the automated test kit: saves a PNG capture of the game canvas
  if (req.method === 'POST' && p === '/__shot') {
    if (!DEV) { res.writeHead(404); return res.end('Not found'); }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const name = (new URL(req.url, 'http://x').searchParams.get('name') || 'shot').replace(/[^\w-]/g, '');
      const b64 = Buffer.concat(chunks).toString().replace(/^data:image\/\w+;base64,/, '');
      fs.mkdirSync(path.join(root, 'shots'), { recursive: true });
      fs.writeFileSync(path.join(root, 'shots', name + '.jpg'), Buffer.from(b64, 'base64'));
      res.writeHead(200); res.end('ok');
    });
    return;
  }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`\nPort ${port} is already in use. Close the other program or pick another port, e.g. "node server.js 3000".\n`);
  else console.error(err);
  process.exit(1);
}).listen(port, HOST, () => console.log(`Solano Nights running at http://localhost:${port}${DEV ? ' (dev mode)' : ''}`));
