import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { gyms } from '../db/schema';
import { db } from '../db';
import { authenticateToken, requireGymOwner, AuthRequest } from '../middleware/auth';

const router = Router();

// Schema de validación
const updateGymSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  planType: z.enum(['basic', 'pro', 'premium']).optional(),
  maxClients: z.number().positive().optional()
});

// Obtener información del gimnasio
router.get('/:gymId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const gymId = parseInt(req.params.gymId);
    
    // Verificar acceso al gimnasio
    if (req.user?.role !== 'admin' && req.user?.gymId !== gymId) {
      return res.status(403).json({ error: 'Access denied to this gym' });
    }

    const gym = await db.select().from(gyms).where(eq(gyms.id, gymId)).limit(1);
    
    if (!gym.length) {
      return res.status(404).json({ error: 'Gym not found' });
    }

    res.json({ gym: gym[0] });
  } catch (error) {
    console.error('Get gym error:', error);
    res.status(500).json({ error: 'Failed to get gym' });
  }
});

// Actualizar gimnasio (solo owners y admins)
router.put('/:gymId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const gymId = parseInt(req.params.gymId);
    const data = updateGymSchema.parse(req.body);

    // Verificar permisos
    const gym = await db.select().from(gyms).where(eq(gyms.id, gymId)).limit(1);
    if (!gym.length) {
      return res.status(404).json({ error: 'Gym not found' });
    }

    const isOwner = gym[0].ownerId === req.user?.id;
    const isAdmin = req.user?.role === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Only gym owner or admin can update gym' });
    }

    // Actualizar
    const updatedGym = await db.update(gyms)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(gyms.id, gymId))
      .returning();

    res.json({ gym: updatedGym[0] });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Update gym error:', error);
    res.status(500).json({ error: 'Failed to update gym' });
  }
});

// Listar todos los gimnasios (solo gym owners)
router.get('/', authenticateToken, requireGymOwner, async (req: AuthRequest, res) => {
  try {
    const gymsList = await db.select().from(gyms);
    res.json({ gyms: gymsList });
  } catch (error) {
    console.error('List gyms error:', error);
    res.status(500).json({ error: 'Failed to list gyms' });
  }
});

// Activar/desactivar gimnasio (solo admins)
router.patch('/:gymId/status', authenticateToken, requireGymOwner, async (req: AuthRequest, res) => {
  try {
    const gymId = parseInt(req.params.gymId);
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' });
    }

    const updatedGym = await db.update(gyms)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(gyms.id, gymId))
      .returning();

    if (!updatedGym.length) {
      return res.status(404).json({ error: 'Gym not found' });
    }

    res.json({ gym: updatedGym[0] });
  } catch (error) {
    console.error('Update gym status error:', error);
    res.status(500).json({ error: 'Failed to update gym status' });
  }
});

export default router;