import { Router } from 'express';
import { eq, and, count } from 'drizzle-orm';
import { z } from 'zod';
import { bookings, classes } from '../db';
import { db } from '../index';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

// Schema de validación
const createBookingSchema = z.object({
  classId: z.number(),
  notes: z.string().optional()
});

// Crear reserva
router.post('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const data = createBookingSchema.parse(req.body);
    const userId = req.user!.id;

    // Verificar que la clase existe
    const classData = await db.select().from(classes).where(eq(classes.id, data.classId)).limit(1);
    if (!classData.length || !classData[0].isActive) {
      return res.status(404).json({ error: 'Class not found or inactive' });
    }

    // Verificar que el usuario no tenga ya una reserva para esta clase
    const existingBooking = await db.select().from(bookings).where(
      and(
        eq(bookings.userId, userId),
        eq(bookings.classId, data.classId),
        eq(bookings.status, 'confirmed')
      )
    ).limit(1);

    if (existingBooking.length > 0) {
      return res.status(400).json({ error: 'You already have a booking for this class' });
    }

    // Verificar capacidad disponible
    const bookingCount = await db.select({ count: count() }).from(bookings).where(
      and(
        eq(bookings.classId, data.classId),
        eq(bookings.status, 'confirmed')
      )
    );

    const currentBookings = bookingCount[0]?.count || 0;
    let status: 'confirmed' | 'waitlist' = 'confirmed';

    if (currentBookings >= classData[0].capacity) {
      status = 'waitlist';
    }

    // Crear la reserva
    const newBooking = await db.insert(bookings).values({
      userId,
      classId: data.classId,
      status,
      notes: data.notes
    }).returning();

    res.status(201).json({ 
      booking: newBooking[0],
      message: status === 'waitlist' ? 'Added to waitlist' : 'Booking confirmed'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Create booking error:', error);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// Listar reservas del usuario
router.get('/my-bookings', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { status } = req.query;

    let query = db.select({
      booking: bookings,
      class: classes
    }).from(bookings)
      .innerJoin(classes, eq(bookings.classId, classes.id))
      .where(eq(bookings.userId, userId));

    if (status && typeof status === 'string') {
      query = db.select({
        booking: bookings,
        class: classes
      }).from(bookings)
        .innerJoin(classes, eq(bookings.classId, classes.id))
        .where(and(
          eq(bookings.userId, userId),
          eq(bookings.status, status as any)
        ));
    }

    const userBookings = await query;
    res.json({ bookings: userBookings });
  } catch (error) {
    console.error('Get user bookings error:', error);
    res.status(500).json({ error: 'Failed to get bookings' });
  }
});

// Listar reservas de una clase (para admins/instructores)
router.get('/class/:classId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const classId = parseInt(req.params.classId);

    // Verificar que la clase existe y acceso
    const classData = await db.select().from(classes).where(eq(classes.id, classId)).limit(1);
    if (!classData.length) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // Verificar permisos
    if (req.user?.role !== 'admin' && req.user?.gymId !== classData[0].gymId) {
      return res.status(403).json({ error: 'Access denied to this class' });
    }

    const classBookings = await db.select({
      booking: bookings,
      user: {
        id: bookings.userId,
        firstName: bookings.userId,
        lastName: bookings.userId,
        email: bookings.userId
      }
    }).from(bookings).where(eq(bookings.classId, classId));

    res.json({ bookings: classBookings });
  } catch (error) {
    console.error('Get class bookings error:', error);
    res.status(500).json({ error: 'Failed to get class bookings' });
  }
});

// Cancelar reserva
router.patch('/:bookingId/cancel', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId);
    const userId = req.user!.id;

    // Verificar que la reserva existe y pertenece al usuario
    const booking = await db.select().from(bookings).where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.userId, userId)
      )
    ).limit(1);

    if (!booking.length) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (booking[0].status === 'cancelled') {
      return res.status(400).json({ error: 'Booking already cancelled' });
    }

    // Cancelar reserva
    const updatedBooking = await db.update(bookings)
      .set({ 
        status: 'cancelled', 
        cancelledAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(bookings.id, bookingId))
      .returning();

    // Si había lista de espera, promover el siguiente
    if (booking[0].status === 'confirmed') {
      const waitlistBooking = await db.select().from(bookings).where(
        and(
          eq(bookings.classId, booking[0].classId),
          eq(bookings.status, 'waitlist')
        )
      ).limit(1);

      if (waitlistBooking.length > 0) {
        await db.update(bookings)
          .set({ status: 'confirmed', updatedAt: new Date() })
          .where(eq(bookings.id, waitlistBooking[0].id));
      }
    }

    res.json({ booking: updatedBooking[0] });
  } catch (error) {
    console.error('Cancel booking error:', error);
    res.status(500).json({ error: 'Failed to cancel booking' });
  }
});

export default router;