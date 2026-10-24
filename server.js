/**
 * Server website film — jalankan: node server.js
 * Taruh sefile dengan moviezone.js dan index.html
 * Syarat: Node 18+ (fetch bawaan)
 *
 * PENTING: tambahkan `getStreamServers,` ke module.exports di moviezone.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const mz = require('./moviezone.js');

const PORT = process.env.PORT || 3000;

const routes = {
    '/api/trending': () => mz.trending(),
    '/api/popular': (q) => mz.popular(q.page || 1, q.type || 'all'),
    '/api/latest': (q) => mz.latest(q.type || 'all'),
    '/api/upcoming': () => mz.upcoming(),
    '/api/toprated': (q) => mz.toprated(q.type || 'movie'),
    '/api/search': (q) => mz.search(q.q || '', q.page || 1),
    '/api/detail': (q) => mz.detail(q.slug || ''),
    '/api/episodes': async (q) => ({
        status: true,
        episodes: await mz.getEpisodes(q.slug || '', q.season || 1)
    }),
    '/api/servers': (q) => ({
        status: true,
        servers: mz.getStreamServers(q.id, q.type || 'movie', q.season, q.episode, q.imdb || '')
    })
};

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const q = Object.fromEntries(url.searchParams);

    if (routes[url.pathname]) {
        try {
            const data = await routes[url.pathname](q);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(data));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ status: false, error: err.message }));
        }
        return;
    }

    fs.readFile(path.join(__dirname, 'index.html'), (err, html) => {
        if (err) { res.writeHead(500); return res.end('index.html tidak ditemukan'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
    });
});

server.listen(PORT, () => console.log(`Website jalan di http://localhost:${PORT}`));
