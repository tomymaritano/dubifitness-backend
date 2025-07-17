import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'DubiFitness API',
      version: '1.0.0',
      description: 'API REST para gestión de gimnasios, clases y reservas',
      contact: {
        name: 'DubiFitness',
        email: 'api@dubifitness.com'
      }
    },
    servers: [
      {
        url: process.env.API_URL || 'http://localhost:3000',
        description: 'Servidor de desarrollo'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            email: { type: 'string', format: 'email' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            phone: { type: 'string' },
            role: { type: 'string', enum: ['admin', 'instructor', 'client'] },
            gymId: { type: 'integer' },
            isActive: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        Gym: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            description: { type: 'string' },
            address: { type: 'string' },
            phone: { type: 'string' },
            email: { type: 'string', format: 'email' },
            ownerId: { type: 'integer' },
            planType: { type: 'string', enum: ['basic', 'pro', 'premium'] },
            maxClients: { type: 'integer' },
            isActive: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        Class: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            gymId: { type: 'integer' },
            instructorId: { type: 'integer' },
            name: { type: 'string' },
            description: { type: 'string' },
            capacity: { type: 'integer' },
            duration: { type: 'integer', description: 'Duración en minutos' },
            price: { type: 'number' },
            datetime: { type: 'string', format: 'date-time' },
            isRecurring: { type: 'boolean' },
            recurringPattern: { type: 'string' },
            isActive: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        Booking: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            userId: { type: 'integer' },
            classId: { type: 'integer' },
            status: { type: 'string', enum: ['confirmed', 'cancelled', 'waitlist', 'attended', 'no_show'] },
            paymentId: { type: 'integer' },
            notes: { type: 'string' },
            bookedAt: { type: 'string', format: 'date-time' },
            cancelledAt: { type: 'string', format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        Payment: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            userId: { type: 'integer' },
            gymId: { type: 'integer' },
            amount: { type: 'number' },
            currency: { type: 'string', default: 'ARS' },
            status: { type: 'string', enum: ['pending', 'approved', 'cancelled', 'refunded'] },
            paymentMethod: { type: 'string' },
            mercadopagoId: { type: 'string' },
            description: { type: 'string' },
            metadata: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        },
        LoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string' }
          }
        },
        RegisterRequest: {
          type: 'object',
          required: ['email', 'password', 'firstName', 'lastName'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 6 },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            phone: { type: 'string' },
            role: { type: 'string', enum: ['admin', 'instructor', 'client'], default: 'client' },
            gymName: { type: 'string', description: 'Nombre del gimnasio (solo para admins)' }
          }
        },
        AuthResponse: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            user: { $ref: '#/components/schemas/User' }
          }
        }
      }
    },
    security: [
      {
        bearerAuth: []
      }
    ]
  },
  apis: ['./src/routes/*.ts'], // paths to files containing OpenAPI definitions
};

export const specs = swaggerJsdoc(options);