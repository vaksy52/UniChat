import { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma';
import { redis } from '../utils/redis';
import { authMiddleware, adminMiddleware } from '../middleware/auth';

export async function adminRoutes(app: FastifyInstance) {
    app.addHook('preHandler', authMiddleware);
    app.addHook('preHandler', adminMiddleware);

    // ── Get all users ──
    app.get('/users', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
        const { page = '1', limit = '20', search } = request.query as {
            page?: string;
            limit?: string;
            search?: string;
        };

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const take = parseInt(limit);

        const where = search
            ? {
                OR: [
                    { username: { contains: search, mode: 'insensitive' as const } },
                    { displayName: { contains: search, mode: 'insensitive' as const } },
                    { phone: { contains: search } },
                ],
            }
            : {};

        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where,
                select: {
                    id: true,
                    phone: true,
                    username: true,
                    displayName: true,
                    isAdmin: true,
                    isVerified: true,
                    isBlocked: true,
                    createdAt: true,
                    lastSeenAt: true,
                    _count: { select: { messages: true } },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take,
            }),
            prisma.user.count({ where }),
        ]);

        const usersWithPresence = await Promise.all(users.map(async (user) => ({
            ...user,
            isOnline: (await redis.get(`user:online:${user.id}`)) !== null,
        })));

        return reply.send({ users: usersWithPresence, total, page: parseInt(page), limit: take });
    });

    // ── Block/unblock user ──
    app.patch('/users/:id/block', async (request, reply) => {
        const { id } = request.params as { id: string };
        const { blocked } = request.body as { blocked: boolean };

        const user = await prisma.user.update({
            where: { id },
            data: { isBlocked: blocked },
        });

        // If blocking, invalidate sessions
        if (blocked) {
            await prisma.session.deleteMany({ where: { userId: id } });
        }

        return reply.send({ success: true, isBlocked: user.isBlocked });
    });

    app.patch('/users/:id/verify', async (request, reply) => {
        const { id } = request.params as { id: string };
        const { verified } = request.body as { verified: boolean };
        const user = await prisma.user.update({ where: { id }, data: { isVerified: verified } });
        return reply.send({ success: true, isVerified: user.isVerified, userId: user.id });
    });

    app.delete('/users/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        if (id === request.user!.id) return reply.status(400).send({ error: 'Cannot delete your own admin account' });
        const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
        if (!user) return reply.status(404).send({ error: 'User not found' });
        await prisma.user.delete({ where: { id } });
        return reply.send({ success: true });
    });

    app.get('/channels', async () => prisma.chat.findMany({
        where: { type: 'CHANNEL' },
        include: { _count: { select: { members: true, messages: true } } },
        orderBy: { createdAt: 'desc' },
    }));

    app.delete('/channels/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const channel = await prisma.chat.findFirst({ where: { id, type: 'CHANNEL' }, select: { id: true } });
        if (!channel) return reply.status(404).send({ error: 'Channel not found' });
        await prisma.chat.delete({ where: { id } });
        return reply.send({ success: true, channelId: id });
    });

    // ── Get reports ──
    app.get('/reports', async (request, reply) => {
        const { resolved = 'false' } = request.query as { resolved?: string };

        const reports = await prisma.report.findMany({
            where: { resolved: resolved === 'true' },
            include: {
                reporter: {
                    select: { id: true, username: true, displayName: true },
                },
                reported: {
                    select: { id: true, username: true, displayName: true },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        return reply.send(reports);
    });

    // ── Resolve report ──
    app.patch('/reports/:id/resolve', async (request, reply) => {
        const { id } = request.params as { id: string };

        await prisma.report.update({
            where: { id },
            data: { resolved: true },
        });

        return reply.send({ success: true });
    });

    // ── Stats ──
    app.get('/stats', async (request, reply) => {
        const [totalUsers, totalChats, totalMessages, activeReports] = await Promise.all([
            prisma.user.count(),
            prisma.chat.count(),
            prisma.message.count(),
            prisma.report.count({ where: { resolved: false } }),
        ]);

        return reply.send({ totalUsers, totalChats, totalMessages, activeReports });
    });
}
