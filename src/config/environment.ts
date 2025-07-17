import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

export interface EnvironmentConfig {
  NODE_ENV: string;
  PORT: number;
  API_URL: string;
  FRONTEND_URL: string;
  FRONTEND_URLS: string[];
  
  // Database
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN?: string;
  
  // Authentication
  JWT_SECRET: string;
  
  // MercadoPago
  MERCADOPAGO_ACCESS_TOKEN: string;
  MERCADOPAGO_PUBLIC_KEY?: string;
  
  // Email (opcional)
  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  
  // Monitoring
  SENTRY_DSN?: string;
  LOG_LEVEL: string;
}

const requiredEnvVars = [
  'JWT_SECRET',
  'MERCADOPAGO_ACCESS_TOKEN'
];

function validateEnvironment(): EnvironmentConfig {
  const config: EnvironmentConfig = {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: parseInt(process.env.PORT || '3000'),
    API_URL: process.env.API_URL || 'http://localhost:3000',
    FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3001',
    FRONTEND_URLS: process.env.FRONTEND_URLS?.split(',') || ['http://localhost:3001', 'http://localhost:19006'],
    
    // Database
    TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL || 'file:./dev.db',
    TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
    
    // Authentication
    JWT_SECRET: process.env.JWT_SECRET || '',
    
    // MercadoPago
    MERCADOPAGO_ACCESS_TOKEN: process.env.MERCADOPAGO_ACCESS_TOKEN || '',
    MERCADOPAGO_PUBLIC_KEY: process.env.MERCADOPAGO_PUBLIC_KEY,
    
    // Email
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : undefined,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
    
    // Monitoring
    SENTRY_DSN: process.env.SENTRY_DSN,
    LOG_LEVEL: process.env.LOG_LEVEL || 'info'
  };

  // Validar variables requeridas en producción
  if (config.NODE_ENV === 'production') {
    const missingVars = requiredEnvVars.filter(varName => {
      const value = (config as any)[varName];
      return !value || value === '';
    });

    if (missingVars.length > 0) {
      console.error('❌ Missing required environment variables for production:');
      missingVars.forEach(varName => {
        console.error(`  - ${varName}`);
      });
      process.exit(1);
    }
  }

  // Advertencias para desarrollo
  if (config.NODE_ENV === 'development') {
    const warnings: string[] = [];
    
    if (!config.JWT_SECRET || config.JWT_SECRET === 'fallback-secret') {
      warnings.push('JWT_SECRET not set - using fallback (insecure for production)');
    }
    
    if (!config.MERCADOPAGO_ACCESS_TOKEN) {
      warnings.push('MERCADOPAGO_ACCESS_TOKEN not set - payment functionality will be limited');
    }

    if (warnings.length > 0) {
      console.warn('⚠️  Development warnings:');
      warnings.forEach(warning => {
        console.warn(`  - ${warning}`);
      });
    }
  }

  return config;
}

// Configuración global de la aplicación
export const config = validateEnvironment();

// Helper functions
export const isDevelopment = () => config.NODE_ENV === 'development';
export const isProduction = () => config.NODE_ENV === 'production';
export const isTesting = () => config.NODE_ENV === 'test';

// Database configuration
export const getDatabaseConfig = () => ({
  url: config.TURSO_DATABASE_URL,
  authToken: config.TURSO_AUTH_TOKEN
});

// CORS configuration
export const getCorsConfig = () => ({
  origin: config.FRONTEND_URLS,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
});

// MercadoPago configuration
export const getMercadoPagoConfig = () => ({
  accessToken: config.MERCADOPAGO_ACCESS_TOKEN,
  publicKey: config.MERCADOPAGO_PUBLIC_KEY,
  environment: isProduction() ? 'production' : 'sandbox'
});

// Logging configuration
export const getLogConfig = () => ({
  level: config.LOG_LEVEL,
  format: isProduction() ? 'json' : 'combined'
});

// Security configuration
export const getSecurityConfig = () => ({
  jwtSecret: config.JWT_SECRET,
  tokenExpiration: isProduction() ? '24h' : '7d',
  bcryptRounds: isProduction() ? 12 : 10
});

console.log(`🚀 DubiFitness API starting in ${config.NODE_ENV} mode`);
console.log(`📡 Server will run on port ${config.PORT}`);
console.log(`🔗 API URL: ${config.API_URL}`);
console.log(`🌐 Frontend URLs: ${config.FRONTEND_URLS.join(', ')}`);

if (isDevelopment()) {
  console.log(`📚 API Documentation: ${config.API_URL}/api-docs`);
}

export default config;