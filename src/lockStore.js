/**
 * État des verrous en mémoire (ticketId -> verrou). Aucune dépendance à Socket.IO.
 * Un verrou : { ticketId, userId, name, socketId, since, lastBeat }
 */

const publicLock = (l) => (l ? { userId: l.userId, name: l.name, since: l.since } : null);

export function createLockStore({ ttlMs }) {
    const locks = new Map();

    return {
        get size() {
            return locks.size;
        },

        /** Verrou exposé aux clients (sans socketId), ou null */
        getPublic(ticketId) {
            return publicLock(locks.get(ticketId));
        },

        /** Refusé si un AUTRE utilisateur détient déjà le verrou */
        acquire(ticketId, user, socketId) {
            const current = locks.get(ticketId);

            if (current && current.userId !== user.id) {
                return { ok: false, lock: publicLock(current) };
            }

            locks.set(ticketId, {
                ticketId,
                userId: user.id,
                name: user.name,
                socketId,
                since: current?.since ?? Date.now(),
                lastBeat: Date.now(),
            });

            return { ok: true, lock: publicLock(locks.get(ticketId)) };
        },

        /** Libère si le verrou appartient à cet utilisateur (n'importe quel onglet) */
        release(ticketId, userId) {
            if (locks.get(ticketId)?.userId === userId) {
                locks.delete(ticketId);
                return true;
            }
            return false;
        },

        /** Libère si le verrou est détenu par CETTE socket (déconnexion, leave) */
        releaseBySocket(ticketId, socketId) {
            if (locks.get(ticketId)?.socketId === socketId) {
                locks.delete(ticketId);
                return true;
            }
            return false;
        },

        heartbeat(ticketId, socketId) {
            const current = locks.get(ticketId);
            if (current && current.socketId === socketId) {
                current.lastBeat = Date.now();
            }
        },

        /** Supprime les verrous orphelins et renvoie leurs ids */
        sweep(now = Date.now()) {
            const expired = [];
            for (const [id, lock] of locks) {
                if (now - lock.lastBeat > ttlMs) {
                    locks.delete(id);
                    expired.push(id);
                }
            }
            return expired;
        },
    };
}
