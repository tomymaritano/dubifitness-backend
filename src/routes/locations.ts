import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { gymLocations, gyms } from '../db/schema';
import { db } from '../db';
import { authenticateToken, AuthRequest, requireGymOwner } from '../middleware/auth';

const router = Router();

// Schema de validación para crear/actualizar ubicación
const createLocationSchema = z.object({
  gymId: z.number(),
  name: z.string().min(1, 'Name is required'),
  address: z.string().min(1, 'Address is required'),
  city: z.string().min(1, 'City is required'),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().default('Argentina'),
  phone: z.string().optional(),
  email: z.string().email().optional()
});

const updateLocationSchema = createLocationSchema.partial().omit({ gymId: true });

// Obtener todas las ubicaciones del gym owner
router.get('/', authenticateToken, requireGymOwner, async (req: AuthRequest, res) => {
  try {
    const ownerId = req.user!.ownerId!;
    
    // Obtener todas las ubicaciones de los gimnasios del owner
    const locations = await db.select({
      location: gymLocations,
      gym: gyms
    })
    .from(gymLocations)
    .leftJoin(gyms, eq(gymLocations.gymId, gyms.id))
    .where(eq(gyms.ownerId, ownerId))
    .orderBy(gymLocations.createdAt);

    res.json({ 
      locations: locations.map(item => ({
        ...item.location,
        gym: item.gym
      }))
    });

  } catch (error) {
    console.error('Get locations error:', error);
    res.status(500).json({ error: 'Failed to get locations' });
  }
});

// Obtener ubicaciones por gimnasio específico
router.get('/gym/:gymId', authenticateToken, requireGymOwner, async (req: AuthRequest, res) => {
  try {
    const ownerId = req.user!.ownerId!;
    const gymId = parseInt(req.params.gymId);

    // Verificar que el gimnasio pertenece al owner
    const gym = await db.select()
      .from(gyms)
      .where(
        and(
          eq(gyms.id, gymId),
          eq(gyms.ownerId, ownerId)
        )
      )
      .limit(1);

    if (!gym.length) {
      return res.status(403).json({ error: 'Access denied to this gym' });
    }

    // Obtener ubicaciones del gimnasio
    const locations = await db.select()
      .from(gymLocations)
      .where(eq(gymLocations.gymId, gymId))
      .orderBy(gymLocations.createdAt);

    res.json({ 
      gym: gym[0],
      locations 
    });

  } catch (error) {
    console.error('Get gym locations error:', error);
    res.status(500).json({ error: 'Failed to get gym locations' });
  }
});

// Obtener una ubicación específica
router.get('/:locationId', authenticateToken, requireGymOwner, async (req: AuthRequest, res) => {
  try {
    const ownerId = req.user!.ownerId!;
    const locationId = parseInt(req.params.locationId);

    // Obtener la ubicación con verificación de ownership
    const location = await db.select({
      location: gymLocations,
      gym: gyms
    })
    .from(gymLocations)
    .leftJoin(gyms, eq(gymLocations.gymId, gyms.id))
    .where(
      and(
        eq(gymLocations.id, locationId),
        eq(gyms.ownerId, ownerId)
      )
    )
    .limit(1);

    if (!location.length) {
      return res.status(404).json({ error: 'Location not found' });
    }

    res.json({ 
      location: {
        ...location[0].location,
        gym: location[0].gym
      }
    });

  } catch (error) {
    console.error('Get location error:', error);
    res.status(500).json({ error: 'Failed to get location' });
  }
});

// Crear nueva ubicación
router.post('/', authenticateToken, requireGymOwner, async (req: AuthRequest, res) => {
  try {
    const ownerId = req.user!.ownerId!;
    const data = createLocationSchema.parse(req.body);

    // Verificar que el gimnasio pertenece al owner
    const gym = await db.select()
      .from(gyms)
      .where(
        and(
          eq(gyms.id, data.gymId),
          eq(gyms.ownerId, ownerId)
        )
      )
      .limit(1);

    if (!gym.length) {
      return res.status(403).json({ error: 'Access denied to this gym' });
    }

    // Crear la ubicación
    const newLocation = await db.insert(gymLocations).values({
      gymId: data.gymId,
      name: data.name,
      address: data.address,
      city: data.city,
      state: data.state,
      postalCode: data.postalCode,
      country: data.country,
      phone: data.phone,
      email: data.email
    }).returning();

    res.status(201).json({ 
      location: newLocation[0],
      gym: gym[0]
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Create location error:', error);
    res.status(500).json({ error: 'Failed to create location' });
  }
});

// Actualizar ubicación
router.put('/:locationId', authenticateToken, requireGymOwner, async (req: AuthRequest, res) => {
  try {
    const ownerId = req.user!.ownerId!;
    const locationId = parseInt(req.params.locationId);
    const data = updateLocationSchema.parse(req.body);

    // Verificar que la ubicación pertenece al owner
    const existingLocation = await db.select({
      location: gymLocations,
      gym: gyms
    })
    .from(gymLocations)
    .leftJoin(gyms, eq(gymLocations.gymId, gyms.id))
    .where(
      and(
        eq(gymLocations.id, locationId),
        eq(gyms.ownerId, ownerId)
      )
    )
    .limit(1);

    if (!existingLocation.length) {
      return res.status(404).json({ error: 'Location not found' });
    }

    // Actualizar la ubicación
    const updatedLocation = await db.update(gymLocations)
      .set({
        ...data,
        updatedAt: new Date()
      })
      .where(eq(gymLocations.id, locationId))
      .returning();

    res.json({ 
      location: updatedLocation[0],
      gym: existingLocation[0].gym
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Update location error:', error);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

// Eliminar ubicación
router.delete('/:locationId', authenticateToken, requireGymOwner, async (req: AuthRequest, res) => {
  try {
    const ownerId = req.user!.ownerId!;
    const locationId = parseInt(req.params.locationId);

    // Verificar que la ubicación pertenece al owner
    const existingLocation = await db.select({
      location: gymLocations,
      gym: gyms
    })
    .from(gymLocations)
    .leftJoin(gyms, eq(gymLocations.gymId, gyms.id))
    .where(
      and(
        eq(gymLocations.id, locationId),
        eq(gyms.ownerId, ownerId)
      )
    )
    .limit(1);

    if (!existingLocation.length) {
      return res.status(404).json({ error: 'Location not found' });
    }

    // TODO: Verificar que no hay usuarios, clases o bookings asociados
    // antes de eliminar la ubicación

    // Eliminar la ubicación
    await db.delete(gymLocations)
      .where(eq(gymLocations.id, locationId));

    res.json({ 
      message: 'Location deleted successfully',
      deletedLocation: existingLocation[0].location
    });

  } catch (error) {
    console.error('Delete location error:', error);
    res.status(500).json({ error: 'Failed to delete location' });
  }
});

// Activar/desactivar ubicación
router.patch('/:locationId/status', authenticateToken, requireGymOwner, async (req: AuthRequest, res) => {
  try {
    const ownerId = req.user!.ownerId!;
    const locationId = parseInt(req.params.locationId);
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' });
    }

    // Verificar que la ubicación pertenece al owner
    const existingLocation = await db.select({
      location: gymLocations,
      gym: gyms
    })
    .from(gymLocations)
    .leftJoin(gyms, eq(gymLocations.gymId, gyms.id))
    .where(
      and(
        eq(gymLocations.id, locationId),
        eq(gyms.ownerId, ownerId)
      )
    )
    .limit(1);

    if (!existingLocation.length) {
      return res.status(404).json({ error: 'Location not found' });
    }

    // Actualizar el estado
    const updatedLocation = await db.update(gymLocations)
      .set({
        isActive,
        updatedAt: new Date()
      })
      .where(eq(gymLocations.id, locationId))
      .returning();

    res.json({ 
      location: updatedLocation[0],
      message: `Location ${isActive ? 'activated' : 'deactivated'} successfully`
    });

  } catch (error) {
    console.error('Update location status error:', error);
    res.status(500).json({ error: 'Failed to update location status' });
  }
});

export default router;