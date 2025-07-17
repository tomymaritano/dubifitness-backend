import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { gymOwners, gyms, gymLocations, users, gymStaff } from '../db/schema';
import { db } from '../db';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Autenticación y gestión de usuarios
 */

// Schemas de validación para dueños de gimnasios
const registerGymOwnerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  companyName: z.string().min(1),
  phone: z.string().optional(),
  gymName: z.string().min(1),
  gymDescription: z.string().optional(),
  // Primera ubicación
  locationName: z.string().min(1),
  address: z.string().min(1),
  city: z.string().min(1),
  locationPhone: z.string().optional()
});

// Schemas para usuarios finales (clientes)
const registerUserSchema = z.object({
  gymId: z.number(),
  email: z.string().email(),
  password: z.string().min(6),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().optional(),
  birthDate: z.string().datetime().optional()
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  userType: z.enum(['gym_owner', 'user']).default('user')
});

/**
 * @swagger
 * /api/auth/register-gym-owner:
 *   post:
 *     summary: Registrar dueño de gimnasio (cliente que paga suscripción)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - firstName
 *               - lastName
 *               - companyName
 *               - gymName
 *               - locationName
 *               - address
 *               - city
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 6
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               companyName:
 *                 type: string
 *               phone:
 *                 type: string
 *               gymName:
 *                 type: string
 *               gymDescription:
 *                 type: string
 *               locationName:
 *                 type: string
 *               address:
 *                 type: string
 *               city:
 *                 type: string
 *               locationPhone:
 *                 type: string
 *     responses:
 *       201:
 *         description: Dueño de gimnasio registrado exitosamente
 *       400:
 *         description: Error de validación o email ya registrado
 */
router.post('/register-gym-owner', async (req, res) => {
  try {
    const data = registerGymOwnerSchema.parse(req.body);
    
    // Verificar si el email ya existe
    const existingOwner = await db.select().from(gymOwners).where(eq(gymOwners.email, data.email)).limit(1);
    if (existingOwner.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash de la contraseña
    const passwordHash = await bcrypt.hash(data.password, 10);

    // Crear dueño del gimnasio
    const newOwner = await db.insert(gymOwners).values({
      email: data.email,
      passwordHash,
      firstName: data.firstName,
      lastName: data.lastName,
      companyName: data.companyName,
      phone: data.phone
    }).returning();

    // Crear gimnasio
    const newGym = await db.insert(gyms).values({
      ownerId: newOwner[0].id,
      name: data.gymName,
      description: data.gymDescription,
      email: data.email
    }).returning();

    // Crear primera ubicación/sede
    const newLocation = await db.insert(gymLocations).values({
      gymId: newGym[0].id,
      name: data.locationName,
      address: data.address,
      city: data.city,
      phone: data.locationPhone
    }).returning();

    // Generar token
    const token = jwt.sign(
      { 
        ownerId: newOwner[0].id,
        userType: 'gym_owner'
      },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      owner: {
        id: newOwner[0].id,
        email: newOwner[0].email,
        firstName: newOwner[0].firstName,
        lastName: newOwner[0].lastName,
        companyName: newOwner[0].companyName,
        userType: 'gym_owner'
      },
      gym: {
        id: newGym[0].id,
        name: newGym[0].name,
        locations: [newLocation[0]]
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Register gym owner error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

/**
 * @swagger
 * /api/auth/register-user:
 *   post:
 *     summary: Registrar usuario final (cliente del gimnasio)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - gymId
 *               - email
 *               - password
 *               - firstName
 *               - lastName
 *             properties:
 *               gymId:
 *                 type: integer
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 6
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               phone:
 *                 type: string
 *               birthDate:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Usuario registrado exitosamente
 *       400:
 *         description: Error de validación o email ya registrado en ese gimnasio
 */
router.post('/register-user', async (req, res) => {
  try {
    const data = registerUserSchema.parse(req.body);
    
    // Verificar que el gimnasio existe y está activo
    const gym = await db.select().from(gyms).where(eq(gyms.id, data.gymId)).limit(1);
    if (!gym.length || !gym[0].isActive) {
      return res.status(400).json({ error: 'Gym not found or inactive' });
    }

    // Verificar si el email ya existe en este gimnasio
    const existingUser = await db.select().from(users)
      .where(eq(users.email, data.email))
      .where(eq(users.gymId, data.gymId))
      .limit(1);
    
    if (existingUser.length > 0) {
      return res.status(400).json({ error: 'Email already registered in this gym' });
    }

    // Hash de la contraseña
    const passwordHash = await bcrypt.hash(data.password, 10);

    // Crear usuario
    const newUser = await db.insert(users).values({
      gymId: data.gymId,
      email: data.email,
      passwordHash,
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
      birthDate: data.birthDate ? new Date(data.birthDate) : undefined
    }).returning();

    // Generar token
    const token = jwt.sign(
      { 
        userId: newUser[0].id,
        gymId: newUser[0].gymId,
        userType: 'user'
      },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      user: {
        id: newUser[0].id,
        email: newUser[0].email,
        firstName: newUser[0].firstName,
        lastName: newUser[0].lastName,
        gymId: newUser[0].gymId,
        userType: 'user'
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Register user error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Iniciar sesión (dueños y usuarios)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *               userType:
 *                 type: string
 *                 enum: [gym_owner, user]
 *                 default: user
 *     responses:
 *       200:
 *         description: Login exitoso
 *       401:
 *         description: Credenciales inválidas
 */
router.post('/login', async (req, res) => {
  try {
    const data = loginSchema.parse(req.body);

    if (data.userType === 'gym_owner') {
      // Login para dueños de gimnasios
      const owner = await db.select().from(gymOwners).where(eq(gymOwners.email, data.email)).limit(1);
      if (!owner.length) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Verificar que está activo
      if (!owner[0].isActive) {
        return res.status(401).json({ error: 'Account is inactive' });
      }

      // Verificar contraseña
      const isValidPassword = await bcrypt.compare(data.password, owner[0].passwordHash);
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Obtener gimnasios y ubicaciones
      const gymsData = await db.select().from(gyms).where(eq(gyms.ownerId, owner[0].id));
      const gymIds = gymsData.map(g => g.id);
      
      let locations = [];
      if (gymIds.length > 0) {
        locations = await db.select().from(gymLocations).where(
          gymIds.length === 1 
            ? eq(gymLocations.gymId, gymIds[0])
            : // Si hay múltiples gimnasios, usar IN
              sql`${gymLocations.gymId} IN (${gymIds.join(',')})`
        );
      }

      // Generar token
      const token = jwt.sign(
        { 
          ownerId: owner[0].id,
          userType: 'gym_owner'
        },
        process.env.JWT_SECRET || 'fallback-secret',
        { expiresIn: '7d' }
      );

      res.json({
        token,
        owner: {
          id: owner[0].id,
          email: owner[0].email,
          firstName: owner[0].firstName,
          lastName: owner[0].lastName,
          companyName: owner[0].companyName,
          userType: 'gym_owner'
        },
        gyms: gymsData.map(gym => ({
          ...gym,
          locations: locations.filter(loc => loc.gymId === gym.id)
        }))
      });

    } else {
      // Login para usuarios finales
      const user = await db.select().from(users).where(eq(users.email, data.email)).limit(1);
      if (!user.length) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Verificar que está activo
      if (!user[0].isActive) {
        return res.status(401).json({ error: 'Account is inactive' });
      }

      // Verificar contraseña
      const isValidPassword = await bcrypt.compare(data.password, user[0].passwordHash);
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Obtener información del gimnasio
      const gym = await db.select().from(gyms).where(eq(gyms.id, user[0].gymId)).limit(1);

      // Generar token
      const token = jwt.sign(
        { 
          userId: user[0].id,
          gymId: user[0].gymId,
          userType: 'user'
        },
        process.env.JWT_SECRET || 'fallback-secret',
        { expiresIn: '7d' }
      );

      res.json({
        token,
        user: {
          id: user[0].id,
          email: user[0].email,
          firstName: user[0].firstName,
          lastName: user[0].lastName,
          gymId: user[0].gymId,
          userType: 'user'
        },
        gym: gym[0] || null
      });
    }

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Obtener información del usuario autenticado
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Información del usuario
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Token inválido o ausente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/me', authenticateToken, async (req: AuthRequest, res) => {
  res.json({ user: req.user });
});

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Cerrar sesión
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Sesión cerrada exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Logged out successfully"
 */
router.post('/logout', authenticateToken, (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

/**
 * @swagger
 * /api/auth/available-gyms:
 *   get:
 *     summary: Listar gimnasios disponibles para registro de usuarios
 *     tags: [Auth]
 *     parameters:
 *       - in: query
 *         name: city
 *         schema:
 *           type: string
 *         description: Filtrar por ciudad
 *     responses:
 *       200:
 *         description: Lista de gimnasios disponibles
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 gyms:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       name:
 *                         type: string
 *                       description:
 *                         type: string
 *                       locations:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             id:
 *                               type: integer
 *                             name:
 *                               type: string
 *                             address:
 *                               type: string
 *                             city:
 *                               type: string
 */
router.get('/available-gyms', async (req, res) => {
  try {
    const { city } = req.query;

    // Obtener gimnasios activos
    const gymsData = await db.select().from(gyms).where(eq(gyms.isActive, true));
    
    // Obtener ubicaciones
    let locations = await db.select().from(gymLocations).where(eq(gymLocations.isActive, true));
    
    // Filtrar por ciudad si se especifica
    if (city) {
      locations = locations.filter(loc => loc.city.toLowerCase().includes((city as string).toLowerCase()));
    }

    // Combinar gimnasios con sus ubicaciones
    const gymsWithLocations = gymsData.map(gym => ({
      id: gym.id,
      name: gym.name,
      description: gym.description,
      locations: locations.filter(loc => loc.gymId === gym.id)
    })).filter(gym => gym.locations.length > 0); // Solo mostrar gimnasios con ubicaciones activas

    res.json({ gyms: gymsWithLocations });
  } catch (error) {
    console.error('Get available gyms error:', error);
    res.status(500).json({ error: 'Failed to get available gyms' });
  }
});

export default router;