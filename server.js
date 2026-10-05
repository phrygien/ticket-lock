import 'dotenv/config';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

const PORT = Number(process.env.PORT || 3001);
const SECRET = process.env.TICKET_LOCK_SECRET;          // même valeur que côté Laravel
const ORIGINS = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
const LOCK_TTL_MS = 45_000;                              // verrou expiré sans heartbeat
const SWEEP_EVERY_MS = 10_000;

if (!SECRET) {
    console.error('TICKET_LOCK_SECRET manquant');
    process.exit(1);
}

/** ticketId (string) -> { ticketId, userId, name, socketId, since, lastBeat } */
const locks = new Map();

const room = (id) => `ticket:${id}`;
const isTicketId = (id) => /^\d+$/.test(String(id ?? ''));
const publicLock = (l) => (l ? { userId: l.userId, name: l.name, since: l.since } : null);

/* ---------------------------------------------------------------------- */
/*  HTTP : santé + lecture d'un verrou (appelée par Laravel côté serveur)  */
/* ---------------------------------------------------------------------- */

const httpServer = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Content-Type', 'application/json');

    if (url.pathname === '/health') {
        res.end(JSON.stringify({ ok: true, locks: locks.size }));
        return;
    }

    const match = url.pathname.match(/^\/locks\/(\d+)$/);
    if (match) {
        if (req.headers['x-api-key'] !== SECRET) {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: 'unauthorized' }));
            return;
        }
        res.end(JSON.stringify({ lock: publicLock(locks.get(match[1])) }));
        return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
});

const io = new Server(httpServer, {
    cors: { origin: ORIGINS.length ? ORIGINS : false },
});

/* ---------------------------------------------------------------------- */
/*  Helpers                                                                */
/* ---------------------------------------------------------------------- */

function broadcast(ticketId) {
    io.to(room(ticketId)).emit('lock:state', {
        ticketId: String(ticketId),
        lock: publicLock(locks.get(ticketId)),
    });
}

function releaseLock(ticketId) {
    if (locks.delete(ticketId)) {
        broadcast(ticketId);
    }
}

/* ---------------------------------------------------------------------- */
/*  Auth : JWT HS256 signé par Laravel                                     */
/* ---------------------------------------------------------------------- */

io.use((socket, next) => {
    try {
        const payload = jwt.verify(socket.handshake.auth?.token, SECRET, { algorithms: ['HS256'] });
        socket.data.user = { id: String(payload.sub), name: String(payload.name || 'Un utilisateur') };
        socket.data.held = new Set();
        next();
    } catch {
        next(new Error('unauthorized'));
    }
});

/* ---------------------------------------------------------------------- */
/*  Évènements                                                             */
/* ---------------------------------------------------------------------- */

io.on('connection', (socket) => {
    const user = socket.data.user;

    // Rejoint la "room" du ticket pour recevoir les changements d'état du verrou
    socket.on('ticket:join', ({ ticketId } = {}, ack) => {
        if (!isTicketId(ticketId)) return ack?.({ ok: false });
        const id = String(ticketId);
        socket.join(room(id));
        ack?.({ ok: true, lock: publicLock(locks.get(id)) });
    });

    socket.on('ticket:leave', ({ ticketId } = {}) => {
        if (!isTicketId(ticketId)) return;
        const id = String(ticketId);
        socket.leave(room(id));
        if (locks.get(id)?.socketId === socket.id) {
            socket.data.held.delete(id);
            releaseLock(id);
        }
    });

    // Prend le verrou : refusé si un AUTRE utilisateur l'a déjà
    socket.on('lock:acquire', ({ ticketId } = {}, ack) => {
        if (!isTicketId(ticketId)) return ack?.({ ok: false });
        const id = String(ticketId);
        const current = locks.get(id);

        if (current && current.userId !== user.id) {
            return ack?.({ ok: false, lock: publicLock(current) });
        }

        locks.set(id, {
            ticketId: id,
            userId: user.id,
            name: user.name,
            socketId: socket.id,
            since: current?.since ?? Date.now(),
            lastBeat: Date.now(),
        });
        socket.data.held.add(id);
        socket.join(room(id));
        broadcast(id);
        ack?.({ ok: true, lock: publicLock(locks.get(id)) });
    });

    socket.on('lock:release', ({ ticketId } = {}) => {
        if (!isTicketId(ticketId)) return;
        const id = String(ticketId);
        if (locks.get(id)?.userId === user.id) {
            socket.data.held.delete(id);
            releaseLock(id);
        }
    });

    // Maintient le verrou en vie tant que l'onglet est ouvert
    socket.on('lock:heartbeat', ({ ticketId } = {}) => {
        const current = locks.get(String(ticketId));
        if (current && current.socketId === socket.id) {
            current.lastBeat = Date.now();
        }
    });

    // Onglet fermé / coupure réseau : on libère les verrous détenus par CETTE socket
    socket.on('disconnect', () => {
        for (const id of socket.data.held) {
            if (locks.get(id)?.socketId === socket.id) {
                releaseLock(id);
            }
        }
    });
});

// Filet de sécurité : verrous orphelins (heartbeat perdu)
setInterval(() => {
    const now = Date.now();
    for (const [id, lock] of locks) {
        if (now - lock.lastBeat > LOCK_TTL_MS) {
            releaseLock(id);
        }
    }
}, SWEEP_EVERY_MS);

httpServer.listen(PORT, () => console.log(`ticket-lock en écoute sur :${PORT}`));
