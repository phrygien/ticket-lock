/** Routes HTTP : /health et /locks/:id (appelée par Laravel côté serveur, protégée par x-api-key) */
export function createHttpHandler({ secret, store }) {
    return (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        res.setHeader('Content-Type', 'application/json');

        if (url.pathname === '/health') {
            res.end(JSON.stringify({ ok: true, locks: store.size }));
            return;
        }

        const match = url.pathname.match(/^\/locks\/(\d+)$/);
        if (match) {
            if (req.headers['x-api-key'] !== secret) {
                res.statusCode = 401;
                res.end(JSON.stringify({ error: 'unauthorized' }));
                return;
            }

            res.end(JSON.stringify({ lock: store.getPublic(match[1]) }));
            return;
        }

        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'not found' }));
    };
}
