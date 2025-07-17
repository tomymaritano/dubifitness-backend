import { Router } from 'express';
import { eq, and, gte, lte, sql, count, sum } from 'drizzle-orm';
import { z } from 'zod';
import { 
  subscriptions, 
  subscriptionPayments, 
  payments, 
  users, 
  gyms, 
  classes, 
  bookings,
  gymOwners
} from '../db/schema';
import { db } from '../db';
import { authenticateToken, AuthRequest, requireGymOwner } from '../middleware/auth';

const router = Router();

// Schema de validación para filtros de fecha
const dateRangeSchema = z.object({
  startDate: z.string().optional(), // ISO string
  endDate: z.string().optional(),   // ISO string
  period: z.enum(['7d', '30d', '90d', '1y', 'all']).optional().default('30d')
});

// Obtener dashboard de analytics para gym owner
router.get('/dashboard', authenticateToken, requireGymOwner, async (req: AuthRequest, res) => {
  try {
    const ownerId = req.user!.ownerId!;
    const query = dateRangeSchema.parse(req.query);
    
    // Calcular rango de fechas
    const { startTimestamp, endTimestamp } = calculateDateRange(query);

    // Obtener métricas principales en paralelo
    const [
      revenueData,
      subscriptionData,
      gymsData,
      usersData,
      classesData
    ] = await Promise.all([
      getRevenueMetrics(ownerId, startTimestamp, endTimestamp),
      getSubscriptionMetrics(ownerId),
      getGymsMetrics(ownerId),
      getUsersMetrics(ownerId, startTimestamp, endTimestamp),
      getClassesMetrics(ownerId, startTimestamp, endTimestamp)
    ]);

    res.json({
      period: query.period,
      dateRange: {
        start: new Date(startTimestamp * 1000).toISOString(),
        end: new Date(endTimestamp * 1000).toISOString()
      },
      revenue: revenueData,
      subscription: subscriptionData,
      gyms: gymsData,
      users: usersData,
      classes: classesData
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Analytics dashboard error:', error);
    res.status(500).json({ error: 'Failed to get analytics dashboard' });
  }
});

// Obtener métricas detalladas de revenue
router.get('/revenue', authenticateToken, requireGymOwner, async (req: AuthRequest, res) => {
  try {
    const ownerId = req.user!.ownerId!;
    const query = dateRangeSchema.parse(req.query);
    
    const { startTimestamp, endTimestamp } = calculateDateRange(query);
    
    // Revenue de suscripciones
    const subscriptionRevenue = await db.select({
      amount: sql<number>`COALESCE(SUM(${subscriptionPayments.amount}), 0)`,
      count: sql<number>`COUNT(*)`,
      avgAmount: sql<number>`COALESCE(AVG(${subscriptionPayments.amount}), 0)`
    })
    .from(subscriptionPayments)
    .where(
      and(
        eq(subscriptionPayments.ownerId, ownerId),
        eq(subscriptionPayments.status, 'approved'),
        gte(subscriptionPayments.paidAt, startTimestamp),
        lte(subscriptionPayments.paidAt, endTimestamp)
      )
    );

    // Revenue de pagos de usuarios (por gimnasio)
    const ownerGyms = await db.select({ id: gyms.id })
      .from(gyms)
      .where(eq(gyms.ownerId, ownerId));
    
    const gymIds = ownerGyms.map(g => g.id);
    
    let userPaymentsRevenue = [{ amount: 0, count: 0, avgAmount: 0 }];
    
    if (gymIds.length > 0) {
      userPaymentsRevenue = await db.select({
        amount: sql<number>`COALESCE(SUM(${payments.amount}), 0)`,
        count: sql<number>`COUNT(*)`,
        avgAmount: sql<number>`COALESCE(AVG(${payments.amount}), 0)`
      })
      .from(payments)
      .where(
        and(
          sql`${payments.gymId} IN (${gymIds.join(',')})`,
          eq(payments.status, 'approved'),
          gte(payments.paymentDate, startTimestamp),
          lte(payments.paymentDate, endTimestamp)
        )
      );
    }

    // Revenue por día para gráfico
    const dailyRevenue = await getDailyRevenue(ownerId, startTimestamp, endTimestamp);

    res.json({
      summary: {
        total: subscriptionRevenue[0].amount + userPaymentsRevenue[0].amount,
        subscription: subscriptionRevenue[0].amount,
        userPayments: userPaymentsRevenue[0].amount,
        transactionCount: subscriptionRevenue[0].count + userPaymentsRevenue[0].count
      },
      details: {
        subscriptions: subscriptionRevenue[0],
        userPayments: userPaymentsRevenue[0]
      },
      dailyData: dailyRevenue
    });

  } catch (error) {
    console.error('Revenue analytics error:', error);
    res.status(500).json({ error: 'Failed to get revenue analytics' });
  }
});

// Obtener métricas de usuarios
router.get('/users', authenticateToken, requireGymOwner, async (req: AuthRequest, res) => {
  try {
    const ownerId = req.user!.ownerId!;
    const query = dateRangeSchema.parse(req.query);
    
    const { startTimestamp, endTimestamp } = calculateDateRange(query);
    
    // Obtener gimnasios del owner
    const ownerGyms = await db.select()
      .from(gyms)
      .where(eq(gyms.ownerId, ownerId));
    
    const gymIds = ownerGyms.map(g => g.id);
    
    if (gymIds.length === 0) {
      return res.json({
        total: 0,
        newUsers: 0,
        activeUsers: 0,
        gymBreakdown: [],
        dailySignups: []
      });
    }

    // Total usuarios
    const totalUsers = await db.select({ count: count() })
      .from(users)
      .where(sql`${users.gymId} IN (${gymIds.join(',')})`);

    // Nuevos usuarios en el período
    const newUsers = await db.select({ count: count() })
      .from(users)
      .where(
        and(
          sql`${users.gymId} IN (${gymIds.join(',')})`,
          gte(users.createdAt, startTimestamp),
          lte(users.createdAt, endTimestamp)
        )
      );

    // Usuarios activos (que han hecho bookings)
    const activeUsers = await db.select({ count: sql<number>`COUNT(DISTINCT ${users.id})` })
      .from(users)
      .leftJoin(bookings, eq(users.id, bookings.userId))
      .where(
        and(
          sql`${users.gymId} IN (${gymIds.join(',')})`,
          gte(bookings.bookedAt, startTimestamp),
          lte(bookings.bookedAt, endTimestamp)
        )
      );

    // Breakdown por gimnasio
    const gymBreakdown = await Promise.all(
      ownerGyms.map(async (gym) => {
        const gymUsers = await db.select({ count: count() })
          .from(users)
          .where(eq(users.gymId, gym.id));

        return {
          gymId: gym.id,
          gymName: gym.name,
          userCount: gymUsers[0].count
        };
      })
    );

    res.json({
      total: totalUsers[0].count,
      newUsers: newUsers[0].count,
      activeUsers: activeUsers[0].count || 0,
      gymBreakdown,
      dailySignups: [] // TODO: Implementar daily signups
    });

  } catch (error) {
    console.error('Users analytics error:', error);
    res.status(500).json({ error: 'Failed to get users analytics' });
  }
});

// Obtener métricas de clases y bookings
router.get('/classes', authenticateToken, requireGymOwner, async (req: AuthRequest, res) => {
  try {
    const ownerId = req.user!.ownerId!;
    const query = dateRangeSchema.parse(req.query);
    
    const { startTimestamp, endTimestamp } = calculateDateRange(query);
    
    // Obtener gimnasios del owner
    const ownerGyms = await db.select()
      .from(gyms)
      .where(eq(gyms.ownerId, ownerId));
    
    const gymIds = ownerGyms.map(g => g.id);
    
    if (gymIds.length === 0) {
      return res.json({
        totalClasses: 0,
        totalBookings: 0,
        averageAttendance: 0,
        popularClasses: [],
        bookingTrends: []
      });
    }

    // Total clases
    const totalClasses = await db.select({ count: count() })
      .from(classes)
      .where(sql`${classes.gymId} IN (${gymIds.join(',')})`);

    // Total bookings en el período
    const totalBookings = await db.select({ count: count() })
      .from(bookings)
      .leftJoin(classes, eq(bookings.classId, classes.id))
      .where(
        and(
          sql`${classes.gymId} IN (${gymIds.join(',')})`,
          gte(bookings.bookedAt, startTimestamp),
          lte(bookings.bookedAt, endTimestamp)
        )
      );

    // Clases más populares
    const popularClasses = await db.select({
      classId: classes.id,
      className: classes.name,
      instructorName: classes.instructorName,
      bookingCount: sql<number>`COUNT(${bookings.id})`
    })
    .from(classes)
    .leftJoin(bookings, eq(classes.id, bookings.classId))
    .where(
      and(
        sql`${classes.gymId} IN (${gymIds.join(',')})`,
        gte(bookings.bookedAt, startTimestamp),
        lte(bookings.bookedAt, endTimestamp)
      )
    )
    .groupBy(classes.id, classes.name, classes.instructorName)
    .orderBy(sql<number>`COUNT(${bookings.id}) DESC`)
    .limit(10);

    res.json({
      totalClasses: totalClasses[0].count,
      totalBookings: totalBookings[0].count,
      averageAttendance: totalClasses[0].count > 0 ? 
        Math.round((totalBookings[0].count / totalClasses[0].count) * 100) / 100 : 0,
      popularClasses,
      bookingTrends: [] // TODO: Implementar booking trends
    });

  } catch (error) {
    console.error('Classes analytics error:', error);
    res.status(500).json({ error: 'Failed to get classes analytics' });
  }
});

// Funciones helper
function calculateDateRange(query: any): { startTimestamp: number, endTimestamp: number } {
  const now = new Date();
  let startDate: Date;

  if (query.startDate && query.endDate) {
    startDate = new Date(query.startDate);
    const endDate = new Date(query.endDate);
    return {
      startTimestamp: Math.floor(startDate.getTime() / 1000),
      endTimestamp: Math.floor(endDate.getTime() / 1000)
    };
  }

  switch (query.period) {
    case '7d':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case '90d':
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    case '1y':
      startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      break;
    case 'all':
      startDate = new Date('2020-01-01');
      break;
    default:
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  return {
    startTimestamp: Math.floor(startDate.getTime() / 1000),
    endTimestamp: Math.floor(now.getTime() / 1000)
  };
}

async function getRevenueMetrics(ownerId: number, startTimestamp: number, endTimestamp: number) {
  // Revenue de suscripciones
  const subscriptionRevenue = await db.select({
    amount: sql<number>`COALESCE(SUM(${subscriptionPayments.amount}), 0)`
  })
  .from(subscriptionPayments)
  .where(
    and(
      eq(subscriptionPayments.ownerId, ownerId),
      eq(subscriptionPayments.status, 'approved'),
      gte(subscriptionPayments.paidAt, startTimestamp),
      lte(subscriptionPayments.paidAt, endTimestamp)
    )
  );

  return {
    total: subscriptionRevenue[0].amount,
    subscription: subscriptionRevenue[0].amount,
    growth: 0 // TODO: Calcular growth vs período anterior
  };
}

async function getSubscriptionMetrics(ownerId: number) {
  const currentSubscription = await db.select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.ownerId, ownerId),
        eq(subscriptions.status, 'active')
      )
    )
    .limit(1);

  return {
    isActive: currentSubscription.length > 0,
    subscription: currentSubscription[0] || null
  };
}

async function getGymsMetrics(ownerId: number) {
  const gymsCount = await db.select({ count: count() })
    .from(gyms)
    .where(eq(gyms.ownerId, ownerId));

  return {
    total: gymsCount[0].count
  };
}

async function getUsersMetrics(ownerId: number, startTimestamp: number, endTimestamp: number) {
  const ownerGyms = await db.select({ id: gyms.id })
    .from(gyms)
    .where(eq(gyms.ownerId, ownerId));
  
  const gymIds = ownerGyms.map(g => g.id);
  
  if (gymIds.length === 0) {
    return { total: 0, newUsers: 0 };
  }

  const totalUsers = await db.select({ count: count() })
    .from(users)
    .where(sql`${users.gymId} IN (${gymIds.join(',')})`);

  const newUsers = await db.select({ count: count() })
    .from(users)
    .where(
      and(
        sql`${users.gymId} IN (${gymIds.join(',')})`,
        gte(users.createdAt, startTimestamp),
        lte(users.createdAt, endTimestamp)
      )
    );

  return {
    total: totalUsers[0].count,
    newUsers: newUsers[0].count
  };
}

async function getClassesMetrics(ownerId: number, startTimestamp: number, endTimestamp: number) {
  const ownerGyms = await db.select({ id: gyms.id })
    .from(gyms)
    .where(eq(gyms.ownerId, ownerId));
  
  const gymIds = ownerGyms.map(g => g.id);
  
  if (gymIds.length === 0) {
    return { total: 0, bookings: 0 };
  }

  const totalClasses = await db.select({ count: count() })
    .from(classes)
    .where(sql`${classes.gymId} IN (${gymIds.join(',')})`);

  const totalBookings = await db.select({ count: count() })
    .from(bookings)
    .leftJoin(classes, eq(bookings.classId, classes.id))
    .where(
      and(
        sql`${classes.gymId} IN (${gymIds.join(',')})`,
        gte(bookings.bookedAt, startTimestamp),
        lte(bookings.bookedAt, endTimestamp)
      )
    );

  return {
    total: totalClasses[0].count,
    bookings: totalBookings[0].count
  };
}

async function getDailyRevenue(ownerId: number, startTimestamp: number, endTimestamp: number) {
  // TODO: Implementar revenue diario para gráficos
  return [];
}

export default router;