import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { config } from './config.js';
import { createLockStore } from './lockStore.js';
import { createHttpHandler } from './http.js';
import { authMiddleware } from './auth.js';
import { registerTicketHandlers } from './handlers/ticket.js';

const store = createLockStore({ ttlMs: config.lockTtlMs });

const httpServer = createServer(createHttpHandler({ secret: config.secret, store }));

const io = new Server(httpServer, {
    cors: { origin: config.origins.length ? config.origins : false },
});

io.use(authMiddleware(config.secret));

const { broadcast } = registerTicketHandlers(io, store);

// Filet de sécurité : verrous orphelins (heartbeat perdu)
setInterval(() => {
    store.sweep().forEach((id) => {
        console.log(new Date().toISOString(), '[lock] expiré', id);
        broadcast(id);
    });
}, config.sweepEveryMs);

httpServer.listen(config.port, () => {
    console.log(`ticket-lock en écoute sur :${config.port}`);
});
