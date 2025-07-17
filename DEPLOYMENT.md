# DubiFitness Backend - Deployment Guide

## 🚀 Production Deployment

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Turso database (recommended) or SQLite file
- MercadoPago account with API credentials

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Required for production
NODE_ENV=production
PORT=3000
API_URL=https://your-domain.com
FRONTEND_URL=https://your-frontend-domain.com
FRONTEND_URLS=https://your-frontend-domain.com,https://admin.your-domain.com

# Database (Turso recommended for production)
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=your-turso-auth-token

# Security (Generate strong keys!)
JWT_SECRET=your-super-secure-jwt-secret-256-bits-minimum

# MercadoPago
MERCADOPAGO_ACCESS_TOKEN=your-production-mercadopago-token
MERCADOPAGO_PUBLIC_KEY=your-production-mercadopago-public-key
```

### Database Setup

1. **For Turso (Recommended)**:
   ```bash
   # Install Turso CLI
   curl -sSfL https://get.tur.so/install.sh | bash
   
   # Create database
   turso db create dubifitness-prod
   
   # Get connection details
   turso db show dubifitness-prod
   turso db tokens create dubifitness-prod
   ```

2. **Apply migrations**:
   ```bash
   npm run db:generate
   npm run db:push
   ```

3. **Seed subscription plans**:
   ```bash
   npm run seed:plans
   ```

### Build and Deploy

1. **Install dependencies**:
   ```bash
   npm ci --only=production
   ```

2. **Build the application**:
   ```bash
   npm run build
   ```

3. **Start production server**:
   ```bash
   npm start
   ```

### Docker Deployment (Optional)

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
```

### Reverse Proxy (Nginx)

```nginx
server {
    listen 80;
    server_name api.dubifitness.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Process Manager (PM2)

```bash
# Install PM2
npm install -g pm2

# Start application
pm2 start npm --name "dubifitness-api" -- start

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

### Health Checks

- Health endpoint: `GET /health`
- Expected response: `{"status":"ok","timestamp":"..."}`

### Monitoring & Logs

```bash
# View logs with PM2
pm2 logs dubifitness-api

# Monitor application
pm2 monit
```

## 🔧 Configuration

### Security

- JWT tokens expire in 24h in production (vs 7d in development)
- BCrypt rounds: 12 in production (vs 10 in development)
- CORS properly configured for production domains
- Helmet security headers enabled
- Swagger documentation disabled in production

### Database

- Uses Turso (libsql) for production scalability
- Automatic connection pooling
- Prepared statements for security

### MercadoPago

- Production environment automatically detected
- Real payment processing enabled
- Webhook verification implemented

## 📊 API Endpoints

### Authentication
- `POST /api/auth/register-gym-owner` - Register gym owner
- `POST /api/auth/register-user` - Register gym user  
- `POST /api/auth/login` - Login

### Gym Management
- `GET /api/gyms` - List gyms
- `POST /api/gyms` - Create gym
- `PUT /api/gyms/:id` - Update gym

### Locations
- `GET /api/locations` - List locations
- `POST /api/locations` - Create location
- `PUT /api/locations/:id` - Update location

### Classes & Bookings
- `GET /api/classes` - List classes
- `POST /api/bookings` - Create booking

### Payments & Subscriptions
- `POST /api/payments/create-preference` - Create payment
- `POST /api/payments/webhook` - MercadoPago webhook
- `GET /api/subscriptions/plans` - List plans
- `POST /api/subscriptions/create` - Create subscription

### Analytics
- `GET /api/analytics/dashboard` - Owner dashboard
- `GET /api/analytics/revenue` - Revenue metrics
- `GET /api/analytics/users` - User metrics

## 🐛 Troubleshooting

### Common Issues

1. **Database connection fails**:
   - Check TURSO_DATABASE_URL and TURSO_AUTH_TOKEN
   - Verify network connectivity to Turso

2. **MercadoPago webhook fails**:
   - Ensure webhook URL is publicly accessible
   - Check MERCADOPAGO_ACCESS_TOKEN is valid

3. **CORS errors**:
   - Verify FRONTEND_URLS includes your domain
   - Check protocol (http vs https)

### Environment Validation

The application validates required environment variables on startup and will exit with clear error messages if configuration is invalid.

## 📝 Production Checklist

- [ ] Environment variables configured
- [ ] Database created and migrated
- [ ] Subscription plans seeded
- [ ] MercadoPago webhooks configured
- [ ] SSL certificate installed
- [ ] Reverse proxy configured
- [ ] Process manager setup
- [ ] Monitoring configured
- [ ] Backup strategy implemented
- [ ] Log rotation configured