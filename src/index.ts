import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import { createDatabase } from './db';
import { specs } from './config/swagger';

// Routers
import authRouter from './routes/auth';
import gymsRouter from './routes/gyms';
import classesRouter from './routes/classes';
import bookingsRouter from './routes/bookings';
import paymentsRouter from './routes/payments';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
export const db = createDatabase(
  process.env.TURSO_DATABASE_URL || 'file:./dev.db',
  process.env.TURSO_AUTH_TOKEN
);

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URLS?.split(',') || ['http://localhost:3001', 'http://localhost:19006'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Swagger documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs, {
  customSiteTitle: 'DubiFitness API',
  customfavIcon: '/favicon.ico',
  customCss: '.swagger-ui .topbar { display: none }',
  swaggerOptions: {
    persistAuthorization: true,
  }
}));

// Routes
app.use('/api/auth', authRouter);
app.use('/api/gyms', gymsRouter);
app.use('/api/classes', classesRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/payments', paymentsRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`🚀 DubiFitness API running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📚 API Documentation: http://localhost:${PORT}/api-docs`);
});