import { Router } from 'express';
import { eq, and, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { classes } from '../db';
import { db } from '../index';
import { authenticateToken, requireGymAccess, AuthRequest } from '../middleware/auth';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Classes
 *   description: Gestión de clases del gimnasio
 */

// Schemas de validación
const createClassSchema = z.object({
  gymId: z.number(),
  instructorId: z.number().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  capacity: z.number().positive().default(20),
  duration: z.number().positive().default(60),
  price: z.number().nonnegative().default(0),
  datetime: z.string().datetime(),
  isRecurring: z.boolean().default(false),
  recurringPattern: z.string().optional()
});

const updateClassSchema = createClassSchema.partial().omit({ gymId: true });

// Crear clase
router.post('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const data = createClassSchema.parse(req.body);

    // Verificar acceso al gimnasio
    if (req.user?.role !== 'admin' && req.user?.gymId !== data.gymId) {
      return res.status(403).json({ error: 'Access denied to this gym' });
    }

    // Solo admins y owners pueden crear clases
    if (!['admin'].includes(req.user?.role || '')) {
      // Verificar si es owner del gimnasio
      // Esta verificación se puede hacer consultando la tabla gyms
    }

    const newClass = await db.insert(classes).values({
      ...data,
      datetime: new Date(data.datetime)
    }).returning();

    res.status(201).json({ class: newClass[0] });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Create class error:', error);
    res.status(500).json({ error: 'Failed to create class' });
  }
});

/**
 * @swagger
 * /api/classes/gym/{gymId}:
 *   get:
 *     summary: Listar clases de un gimnasio
 *     tags: [Classes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: gymId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID del gimnasio
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Fecha de inicio para filtrar
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Fecha de fin para filtrar
 *     responses:
 *       200:
 *         description: Lista de clases
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 classes:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Class'
 *       403:
 *         description: Acceso denegado al gimnasio
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/gym/:gymId', authenticateToken, requireGymAccess, async (req: AuthRequest, res) => {
  try {
    const gymId = parseInt(req.params.gymId);
    const { startDate, endDate } = req.query;

    let query = db.select().from(classes).where(
      and(
        eq(classes.gymId, gymId),
        eq(classes.isActive, true)
      )
    );

    // Filtrar por rango de fechas si se proporciona
    if (startDate && endDate) {
      const start = new Date(startDate as string);
      const end = new Date(endDate as string);
      
      query = db.select().from(classes).where(
        and(
          eq(classes.gymId, gymId),
          eq(classes.isActive, true),
          gte(classes.datetime, start),
          lte(classes.datetime, end)
        )
      );
    }

    const classesList = await query;
    res.json({ classes: classesList });
  } catch (error) {
    console.error('List classes error:', error);
    res.status(500).json({ error: 'Failed to list classes' });
  }
});

// Obtener clase específica
router.get('/:classId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const classId = parseInt(req.params.classId);

    const classData = await db.select().from(classes).where(eq(classes.id, classId)).limit(1);
    
    if (!classData.length) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // Verificar acceso al gimnasio de la clase
    if (req.user?.role !== 'admin' && req.user?.gymId !== classData[0].gymId) {
      return res.status(403).json({ error: 'Access denied to this class' });
    }

    res.json({ class: classData[0] });
  } catch (error) {
    console.error('Get class error:', error);
    res.status(500).json({ error: 'Failed to get class' });
  }
});

// Actualizar clase
router.put('/:classId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const classId = parseInt(req.params.classId);
    const data = updateClassSchema.parse(req.body);

    // Verificar que la clase existe y permisos
    const existingClass = await db.select().from(classes).where(eq(classes.id, classId)).limit(1);
    if (!existingClass.length) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // Verificar acceso
    if (req.user?.role !== 'admin' && req.user?.gymId !== existingClass[0].gymId) {
      return res.status(403).json({ error: 'Access denied to this class' });
    }

    const updateData: any = { ...data, updatedAt: new Date() };
    if (data.datetime) {
      updateData.datetime = new Date(data.datetime);
    }

    const updatedClass = await db.update(classes)
      .set(updateData)
      .where(eq(classes.id, classId))
      .returning();

    res.json({ class: updatedClass[0] });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Update class error:', error);
    res.status(500).json({ error: 'Failed to update class' });
  }
});

// Eliminar clase (soft delete)
router.delete('/:classId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const classId = parseInt(req.params.classId);

    // Verificar que la clase existe y permisos
    const existingClass = await db.select().from(classes).where(eq(classes.id, classId)).limit(1);
    if (!existingClass.length) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // Verificar acceso
    if (req.user?.role !== 'admin' && req.user?.gymId !== existingClass[0].gymId) {
      return res.status(403).json({ error: 'Access denied to this class' });
    }

    await db.update(classes)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(classes.id, classId));

    res.json({ message: 'Class deleted successfully' });
  } catch (error) {
    console.error('Delete class error:', error);
    res.status(500).json({ error: 'Failed to delete class' });
  }
});

export default router;