import 'dotenv/config';

export const config = {
    port: Number(process.env.PORT || 3001),
    secret: process.env.TICKET_LOCK_SECRET,                      // même valeur que côté Laravel
    origins: (process.env.CORS_ORIGIN || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    // Filet de sécurité uniquement : la vraie libération se fait à la déconnexion de la socket.
    // Large, car les navigateurs ralentissent fortement les timers des onglets en arrière-plan.
    lockTtlMs: 10 * 60_000,
    sweepEveryMs: 30_000,
};

if (!config.secret) {
    console.error('TICKET_LOCK_SECRET manquant');
    process.exit(1);
}
