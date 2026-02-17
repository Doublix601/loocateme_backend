import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';

let io = null;
const userSockets = new Map(); // userId -> Set of socketIds

export function initSocket(server) {
    io = new Server(server, {
        cors: {
            origin: process.env.CORS_ORIGIN || '*',
            methods: ['GET', 'POST'],
            credentials: true,
        },
        transports: ['websocket'],
    });

    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth?.token;
            if (!token) return next(new Error('Authentication error: Token missing'));

            const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
            const userId = payload.sub;

            const user = await User.findById(userId).select('_id moderation').lean();
            if (!user) return next(new Error('Authentication error: User not found'));

            // Check for bans
            const mod = user.moderation || {};
            const now = new Date();
            if (mod.bannedPermanent || (mod.bannedUntil && new Date(mod.bannedUntil) > now)) {
                return next(new Error('Authentication error: User banned'));
            }

            socket.userId = String(user._id);
            next();
        } catch (err) {
            next(new Error('Authentication error: Invalid token'));
        }
    });

    io.on('connection', (socket) => {
        const userId = socket.userId;
        console.log(`[Socket] User connected: ${userId} (${socket.id})`);

        // Register socket
        if (!userSockets.has(userId)) {
            userSockets.set(userId, new Set());
        }
        userSockets.get(userId).add(socket.id);

        // Join a private room for this user
        socket.join(`user:${userId}`);

        socket.on('typing', ({ recipientId, conversationId, isTyping }) => {
            io.to(`user:${recipientId}`).emit('typing', {
                userId,
                conversationId,
                isTyping,
            });
        });

        socket.on('read_receipt', ({ recipientId, conversationId, messageId }) => {
            io.to(`user:${recipientId}`).emit('read_receipt', {
                userId,
                conversationId,
                messageId,
                at: new Date().toISOString(),
            });
        });

        socket.on('disconnect', () => {
            console.log(`[Socket] User disconnected: ${userId} (${socket.id})`);
            const sockets = userSockets.get(userId);
            if (sockets) {
                sockets.delete(socket.id);
                if (sockets.size === 0) {
                    userSockets.delete(userId);
                }
            }
        });
    });

    return io;
}

export function emitToUser(userId, event, data) {
    if (!io) return false;
    io.to(`user:${userId}`).emit(event, data);
    return true;
}

export function isUserOnline(userId) {
    return userSockets.has(String(userId));
}
