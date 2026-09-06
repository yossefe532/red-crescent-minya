import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { debugLogger } from './middleware/debug';
import { Env } from './env';
import { success, error } from './utils/response';
import { publicRoutes } from './routes/public';
import { adminRoutes } from './routes/admin';
import { publicRegistrationRoutes } from './routes/registration';

const app = new Hono<{ Bindings: Env }>();

// Enable CORS for development
app.use('*', cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Cookie'],
  credentials: true,
}));

// Debug logging for development
app.use('*', debugLogger);

// Health endpoint
app.get('/health', (c) => {
  return success(c, {
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: c.env.ENVIRONMENT || 'development',
    version: '1.0.0-mvp',
  });
});

// Public routes (mission info, volunteer lookup)
app.route('/api', publicRoutes);
app.route('/api/public', publicRoutes);

// Public registration routes (no auth required)
app.route('/api', publicRegistrationRoutes);

// Admin routes (with authentication)
app.route('/api/admin', adminRoutes);

// 404 handler
app.notFound((c) => {
  return error(c, 'NOT_FOUND', 'Route not found', 404);
});

// Global error handler
app.onError((err, c) => {
  console.error('Global error:', err);
  return error(c, 'INTERNAL_ERROR', 'Internal server error', 500);
});

export default app;