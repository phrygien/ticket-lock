import jwt from 'jsonwebtoken';

/** Middleware Socket.IO : JWT HS256 signé par Laravel */
export function authMiddleware(secret) {
    return (socket, next) => {
        try {
            const payload = jwt.verify(socket.handshake.auth?.token, secret, { algorithms: ['HS256'] });

            socket.data.user = {
                id: String(payload.sub),
                name: String(payload.name || 'Un utilisateur'),
            };
            socket.data.held = new Set();

            next();
        } catch {
            next(new Error('unauthorized'));
        }
    };
}
