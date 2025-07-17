import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { createDatabase } from './db';
import { specs } from './config/swagger';
import { config, getCorsConfig, getDatabaseConfig, isDevelopment } from './config/environment';

// Routers
import authRouter from './routes/auth';
import gymsRouter from './routes/gyms';
import classesRouter from './routes/classes';
import bookingsRouter from './routes/bookings';
import paymentsRouter from './routes/payments';
import subscriptionsRouter from './routes/subscriptions';
import analyticsRouter from './routes/analytics';
import locationsRouter from './routes/locations';

const app = express();

// Database connection
export const db = createDatabase(
  getDatabaseConfig().url,
  getDatabaseConfig().authToken
);

// Middleware
app.use(helmet({
  contentSecurityPolicy: isDevelopment() ? false : undefined
}));
app.use(cors(getCorsConfig()));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Swagger documentation (only in development)
if (isDevelopment()) {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs, {
    customSiteTitle: 'DubiFitness API',
    customfavIcon: '/favicon.ico',
    customCss: '.swagger-ui .topbar { display: none }',
    swaggerOptions: {
      persistAuthorization: true,
    }
  }));
}

// Routes
app.use('/api/auth', authRouter);
app.use('/api/gyms', gymsRouter);
app.use('/api/classes', classesRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/locations', locationsRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: config.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.listen(config.PORT, () => {
  console.log(`📊 Environment: ${config.NODE_ENV}`);
  if (isDevelopment()) {
    console.log(`📚 API Documentation: ${config.API_URL}/api-docs`);
  }
});