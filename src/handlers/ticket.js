const room = (id) => `ticket:${id}`;
const isTicketId = (id) => /^\d+$/.test(String(id ?? ''));
const log = (...args) => console.log(new Date().toISOString(), '[lock]', ...args);

/**
 * Branche les évènements Socket.IO sur le lockStore.
 * Renvoie { broadcast } pour que index.js puisse notifier les verrous expirés.
 */
export function registerTicketHandlers(io, store) {
    const broadcast = (ticketId) => {
        io.to(room(ticketId)).emit('lock:state', {
            ticketId: String(ticketId),
            lock: store.getPublic(ticketId),
        });
    };

    io.on('connection', (socket) => {
        const user = socket.data.user;
        log('connexion', user.id, socket.id);

        // Rejoint la room du ticket pour recevoir les changements d'état du verrou
        socket.on('ticket:join', ({ ticketId } = {}, ack) => {
            if (!isTicketId(ticketId)) return ack?.({ ok: false });

            const id = String(ticketId);
            socket.join(room(id));
            ack?.({ ok: true, lock: store.getPublic(id) });
        });

        socket.on('ticket:leave', ({ ticketId } = {}) => {
            if (!isTicketId(ticketId)) return;

            const id = String(ticketId);
            socket.leave(room(id));

            if (store.releaseBySocket(id, socket.id)) {
                socket.data.held.delete(id);
                log('libéré (leave)', id, user.id);
                broadcast(id);
            }
        });

        // Prend le verrou : refusé si un AUTRE utilisateur l'a déjà
        socket.on('lock:acquire', ({ ticketId } = {}, ack) => {
            if (!isTicketId(ticketId)) return ack?.({ ok: false });

            const id = String(ticketId);
            const result = store.acquire(id, user, socket.id);

            if (result.ok) {
                socket.data.held.add(id);
                socket.join(room(id));
                log('pris', id, user.id);
                broadcast(id);
            } else {
                log('refusé', id, user.id, 'détenu par', result.lock?.userId);
            }

            ack?.(result);
        });

        socket.on('lock:release', ({ ticketId } = {}) => {
            if (!isTicketId(ticketId)) return;

            const id = String(ticketId);
            if (store.release(id, user.id)) {
                socket.data.held.delete(id);
                log('libéré (release)', id, user.id);
                broadcast(id);
            }
        });

        // Maintient le verrou en vie tant que l'onglet est ouvert
        socket.on('lock:heartbeat', ({ ticketId } = {}) => {
            if (isTicketId(ticketId)) store.heartbeat(String(ticketId), socket.id);
        });

        // Onglet fermé / coupure réseau : on libère les verrous détenus par CETTE socket
        socket.on('disconnect', (reason) => {
            log('déconnexion', user.id, socket.id, reason);

            for (const id of socket.data.held) {
                if (store.releaseBySocket(id, socket.id)) {
                    log('libéré (déconnexion)', id, user.id);
                    broadcast(id);
                }
            }
        });
    });

    return { broadcast };
}
