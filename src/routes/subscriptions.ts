import { Router } from 'express';
import { eq, and, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { 
  subscriptionPlans, 
  subscriptions, 
  subscriptionPayments,
  gymOwners 
} from '../db/schema';
import { db } from '../db';
import { authenticateToken, AuthRequest, requireGymOwner } from '../middleware/auth';
import mercadopago from 'mercadopago';

const router = Router();

// Configurar MercadoPago
mercadopago.configure({
  access_token: process.env.MERCADOPAGO_ACCESS_TOKEN || '',
});

// Schema de validación para crear suscripción
const createSubscriptionSchema = z.object({
  planId: z.number(),
  billingCycle: z.enum(['monthly', 'annual']),
  startDate: z.string().optional() // ISO string, por defecto hoy
});

// Obtener todos los planes disponibles
router.get('/plans', async (req, res) => {
  try {
    const plans = await db.select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.isActive, true));
    
    res.json({ plans });
  } catch (error) {
    console.error('Get subscription plans error:', error);
    res.status(500).json({ error: 'Failed to get subscription plans' });
  }
});

// Obtener suscripción actual del gym owner
router.get('/current', authenticateToken, requireGymOwner, async (req: AuthRequest, res) => {
  try {
    const ownerId = req.user!.ownerId!;
    
    const currentSubscription = await db.select({
      subscription: subscriptions,
      plan: subscriptionPlans
    })
    .from(subscriptions)
    .leftJoin(subscriptionPlans, eq(subscriptions.planId, subscriptionPlans.id))
    .where(
      and(
        eq(subscriptions.ownerId, ownerId),
        eq(subscriptions.status, 'active')
      )
    )
    .limit(1);

    if (!currentSubscription.length) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    const subscription = currentSubscription[0];
    const now = new Date();
    const expiresAt = new Date(subscription.subscription.expiresAt * 1000);
    
    // Verificar si la suscripción está vencida
    if (expiresAt < now) {
      // Actualizar estado a expired
      await db.update(subscriptions)
        .set({ 
          status: 'expired',
          updatedAt: new Date()
        })
        .where(eq(subscriptions.id, subscription.subscription.id));
      
      return res.status(404).json({ error: 'Subscription has expired' });
    }

    res.json({ 
      subscription: subscription.subscription,
      plan: subscription.plan,
      daysUntilExpiry: Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    });
    
  } catch (error) {
    console.error('Get current subscription error:', error);
    res.status(500).json({ error: 'Failed to get current subscription' });
  }
});

// Crear nueva suscripción
router.post('/create', authenticateToken, requireGymOwner, async (req: AuthRequest, res) => {
  try {
    const data = createSubscriptionSchema.parse(req.body);
    const ownerId = req.user!.ownerId!;

    // Verificar que el plan existe
    const plan = await db.select()
      .from(subscriptionPlans)
      .where(
        and(
          eq(subscriptionPlans.id, data.planId),
          eq(subscriptionPlans.isActive, true)
        )
      )
      .limit(1);

    if (!plan.length) {
      return res.status(404).json({ error: 'Subscription plan not found' });
    }

    // Verificar que no hay una suscripción activa
    const existingSubscription = await db.select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.ownerId, ownerId),
          eq(subscriptions.status, 'active')
        )
      )
      .limit(1);

    if (existingSubscription.length) {
      return res.status(400).json({ error: 'You already have an active subscription' });
    }

    const selectedPlan = plan[0];
    const amount = data.billingCycle === 'annual' ? selectedPlan.annualPrice : selectedPlan.monthlyPrice;
    
    // Calcular fechas
    const startDate = data.startDate ? new Date(data.startDate) : new Date();
    const expiresAt = new Date(startDate);
    
    if (data.billingCycle === 'annual') {
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    } else {
      expiresAt.setMonth(expiresAt.getMonth() + 1);
    }

    // Crear suscripción en estado pending_payment
    const newSubscription = await db.insert(subscriptions).values({
      ownerId,
      planId: data.planId,
      status: 'pending_payment',
      billingCycle: data.billingCycle,
      amount,
      currency: 'ARS',
      startsAt: Math.floor(startDate.getTime() / 1000),
      expiresAt: Math.floor(expiresAt.getTime() / 1000),
      metadata: JSON.stringify({
        plan_name: selectedPlan.name,
        plan_code: selectedPlan.code,
        created_via: 'api'
      })
    }).returning();

    // Crear primer pago de suscripción
    const billingPeriodEnd = new Date(expiresAt);
    
    const subscriptionPayment = await db.insert(subscriptionPayments).values({
      subscriptionId: newSubscription[0].id,
      ownerId,
      amount,
      currency: 'ARS',
      status: 'pending',
      paymentMethod: 'mercadopago',
      billingPeriodStart: Math.floor(startDate.getTime() / 1000),
      billingPeriodEnd: Math.floor(billingPeriodEnd.getTime() / 1000),
      description: `${selectedPlan.name} Plan - ${data.billingCycle} subscription`,
      metadata: JSON.stringify({
        subscription_id: newSubscription[0].id,
        plan_id: data.planId,
        billing_cycle: data.billingCycle
      })
    }).returning();

    try {
      // Crear preference en MercadoPago
      const preference = {
        items: [{
          title: `DubiFitness ${selectedPlan.name} Plan - ${data.billingCycle}`,
          quantity: 1,
          currency_id: 'ARS',
          unit_price: amount
        }],
        external_reference: subscriptionPayment[0].id.toString(),
        notification_url: `${process.env.API_URL}/api/payments/webhook`,
        back_urls: {
          success: `${process.env.FRONTEND_URL}/subscription/success`,
          failure: `${process.env.FRONTEND_URL}/subscription/failure`,
          pending: `${process.env.FRONTEND_URL}/subscription/pending`
        },
        auto_return: 'approved',
        payer: {
          email: req.user!.email
        }
      };

      const mpResponse = await mercadopago.preferences.create(preference);

      res.status(201).json({
        subscription: newSubscription[0],
        payment: subscriptionPayment[0],
        plan: selectedPlan,
        mercadopago: {
          preference_id: mpResponse.id,
          init_point: mpResponse.init_point,
          sandbox_init_point: mpResponse.sandbox_init_point
        }
      });

    } catch (mpError) {
      console.error('MercadoPago subscription error:', mpError);
      
      // Si MercadoPago falla, devolver respuesta simulada para desarrollo
      res.status(201).json({
        subscription: newSubscription[0],
        payment: subscriptionPayment[0],
        plan: selectedPlan,
        mercadopago: {
          preference_id: 'MP_SUBSCRIPTION_DEMO_' + newSubscription[0].id,
          init_point: 'https://www.mercadopago.com.ar/checkout/demo',
          error: 'MercadoPago integration demo mode'
        }
      });
    }

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Create subscription error:', error);
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

// Cancelar suscripción
router.post('/cancel', authenticateToken, requireGymOwner, async (req: AuthRequest, res) => {
  try {
    const ownerId = req.user!.ownerId!;
    
    const activeSubscription = await db.select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.ownerId, ownerId),
          eq(subscriptions.status, 'active')
        )
      )
      .limit(1);

    if (!activeSubscription.length) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    // Actualizar estado a cancelled
    await db.update(subscriptions)
      .set({
        status: 'cancelled',
        updatedAt: new Date()
      })
      .where(eq(subscriptions.id, activeSubscription[0].id));

    res.json({ 
      message: 'Subscription cancelled successfully',
      subscription: activeSubscription[0]
    });

  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// Obtener historial de pagos de suscripción
router.get('/payments', authenticateToken, requireGymOwner, async (req: AuthRequest, res) => {
  try {
    const ownerId = req.user!.ownerId!;
    
    const payments = await db.select({
      payment: subscriptionPayments,
      subscription: subscriptions,
      plan: subscriptionPlans
    })
    .from(subscriptionPayments)
    .leftJoin(subscriptions, eq(subscriptionPayments.subscriptionId, subscriptions.id))
    .leftJoin(subscriptionPlans, eq(subscriptions.planId, subscriptionPlans.id))
    .where(eq(subscriptionPayments.ownerId, ownerId))
    .orderBy(subscriptionPayments.createdAt);

    res.json({ payments });
    
  } catch (error) {
    console.error('Get subscription payments error:', error);
    res.status(500).json({ error: 'Failed to get subscription payments' });
  }
});

// Obtener métricas de suscripción para el owner
router.get('/metrics', authenticateToken, requireGymOwner, async (req: AuthRequest, res) => {
  try {
    const ownerId = req.user!.ownerId!;
    
    // Obtener suscripción actual
    const currentSubscription = await db.select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.ownerId, ownerId),
          eq(subscriptions.status, 'active')
        )
      )
      .limit(1);

    // Obtener total pagado
    const totalPaid = await db.select({
      total: subscriptionPayments.amount
    })
    .from(subscriptionPayments)
    .where(
      and(
        eq(subscriptionPayments.ownerId, ownerId),
        eq(subscriptionPayments.status, 'approved')
      )
    );

    const totalAmount = totalPaid.reduce((sum, payment) => sum + payment.total, 0);

    // Obtener próximo pago
    const nextPayment = await db.select()
      .from(subscriptionPayments)
      .where(
        and(
          eq(subscriptionPayments.ownerId, ownerId),
          eq(subscriptionPayments.status, 'pending')
        )
      )
      .limit(1);

    res.json({
      currentSubscription: currentSubscription[0] || null,
      totalPaid: totalAmount,
      nextPayment: nextPayment[0] || null
    });

  } catch (error) {
    console.error('Get subscription metrics error:', error);
    res.status(500).json({ error: 'Failed to get subscription metrics' });
  }
});

export default router;