import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { payments, subscriptionPayments, subscriptions } from '../db/schema';
import { db } from '../db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import mercadopago from 'mercadopago';

const router = Router();

// Configurar MercadoPago
mercadopago.configure({
  access_token: process.env.MERCADOPAGO_ACCESS_TOKEN || '',
});

// Schema de validación
const createPaymentSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().default('ARS'),
  description: z.string(),
  metadata: z.record(z.any()).optional()
});

// Crear preference de pago (MercadoPago)
router.post('/create-preference', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const data = createPaymentSchema.parse(req.body);
    
    // Verificar que tenemos la información del usuario
    if (!req.user || req.user.userType !== 'user') {
      return res.status(403).json({ error: 'Only gym users can make payments' });
    }

    const userId = req.user.userId!;
    const gymId = req.user.gymId!;

    // Crear registro de pago pendiente
    const newPayment = await db.insert(payments).values({
      userId,
      gymId,
      amount: data.amount,
      currency: data.currency,
      status: 'pending',
      paymentMethod: 'mercadopago',
      description: data.description,
      metadata: JSON.stringify(data.metadata || {})
    }).returning();

    try {
      // Crear preference en MercadoPago
      const preference = {
        items: [{
          title: data.description,
          quantity: 1,
          currency_id: data.currency,
          unit_price: data.amount
        }],
        external_reference: newPayment[0].id.toString(),
        notification_url: `${process.env.API_URL}/api/payments/webhook`,
        back_urls: {
          success: `${process.env.FRONTEND_URL}/payment/success`,
          failure: `${process.env.FRONTEND_URL}/payment/failure`,
          pending: `${process.env.FRONTEND_URL}/payment/pending`
        },
        auto_return: 'approved'
      };

      const mpResponse = await mercadopago.preferences.create(preference);

      res.status(201).json({
        payment: newPayment[0],
        preference_id: mpResponse.id,
        init_point: mpResponse.init_point,
        sandbox_init_point: mpResponse.sandbox_init_point
      });

    } catch (mpError) {
      console.error('MercadoPago error:', mpError);
      
      // Si MercadoPago falla, devolver respuesta simulada para desarrollo
      res.status(201).json({
        payment: newPayment[0],
        preference_id: 'MP_PREFERENCE_DEMO_' + newPayment[0].id,
        init_point: 'https://www.mercadopago.com.ar/checkout/demo',
        error: 'MercadoPago integration demo mode'
      });
    }

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Create payment error:', error);
    res.status(500).json({ error: 'Failed to create payment' });
  }
});

// Webhook de MercadoPago
router.post('/webhook', async (req, res) => {
  try {
    const { type, data, action, date_created, id: webhookId } = req.body;
    
    // Log detallado del webhook recibido
    console.log('MercadoPago Webhook received:', {
      type,
      action,
      data,
      date_created,
      webhookId,
      timestamp: new Date().toISOString()
    });

    // Validar estructura del webhook
    if (!type || !data || !data.id) {
      console.warn('Invalid webhook structure received:', req.body);
      return res.status(400).json({ error: 'Invalid webhook structure' });
    }

    // Procesar diferentes tipos de notificaciones
    switch (type) {
      case 'payment':
        await processPaymentWebhook(data.id, action);
        break;
      
      case 'subscription':
        await processSubscriptionWebhook(data.id, action);
        break;
      
      case 'preapproval':
        await processPreapprovalWebhook(data.id, action);
        break;
      
      default:
        console.log(`Unhandled webhook type: ${type}`);
    }

    res.status(200).json({ received: true, processed: true });
    
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Procesar webhook de pagos
async function processPaymentWebhook(paymentId: string, action: string) {
  try {
    console.log(`Processing payment webhook: ${paymentId}, action: ${action}`);
    
    // Verificar el pago con MercadoPago API
    const mpPayment = await mercadopago.payment.findById(paymentId);
    
    if (!mpPayment || !mpPayment.external_reference) {
      console.warn(`Payment ${paymentId} not found or missing external_reference`);
      return;
    }

    const externalReference = mpPayment.external_reference;
    const newStatus = mapMercadoPagoStatus(mpPayment.status || 'pending');
    
    // Primero verificar si es un pago de suscripción
    const existingSubscriptionPayment = await db.select()
      .from(subscriptionPayments)
      .where(eq(subscriptionPayments.id, parseInt(externalReference)))
      .limit(1);

    if (existingSubscriptionPayment.length) {
      await processSubscriptionPaymentWebhook(existingSubscriptionPayment[0], newStatus, mpPayment, action);
      return;
    }
    
    // Si no es un pago de suscripción, verificar pagos regulares
    const existingPayment = await db.select()
      .from(payments)
      .where(eq(payments.id, parseInt(externalReference)))
      .limit(1);

    if (!existingPayment.length) {
      console.warn(`Payment with external_reference ${externalReference} not found in database`);
      return;
    }

    const currentPayment = existingPayment[0];
    
    // Solo actualizar si el estado ha cambiado
    if (currentPayment.status !== newStatus) {
      await db.update(payments)
        .set({ 
          status: newStatus,
          mercadopagoId: paymentId.toString(),
          paymentDate: mpPayment.date_approved ? new Date(mpPayment.date_approved) : null,
          updatedAt: new Date(),
          metadata: JSON.stringify({
            ...JSON.parse(currentPayment.metadata || '{}'),
            mercadopago_status: mpPayment.status,
            mercadopago_status_detail: mpPayment.status_detail,
            payment_method_id: mpPayment.payment_method_id,
            payment_type_id: mpPayment.payment_type_id,
            last_webhook_action: action,
            last_webhook_date: new Date().toISOString()
          })
        })
        .where(eq(payments.id, parseInt(externalReference)));

      console.log(`Payment ${externalReference} updated from ${currentPayment.status} to ${newStatus}`);
      
      // Si el pago fue aprobado, ejecutar lógica de negocio adicional
      if (newStatus === 'approved' && currentPayment.status !== 'approved') {
        await handlePaymentApproved(currentPayment);
      }
    } else {
      console.log(`Payment ${externalReference} status unchanged: ${newStatus}`);
    }

  } catch (error) {
    console.error(`Error processing payment webhook ${paymentId}:`, error);
    throw error;
  }
}

// Procesar webhook de pagos de suscripción
async function processSubscriptionPaymentWebhook(subscriptionPayment: any, newStatus: string, mpPayment: any, action: string) {
  try {
    console.log(`Processing subscription payment webhook: ${subscriptionPayment.id}, status: ${newStatus}`);
    
    // Solo actualizar si el estado ha cambiado
    if (subscriptionPayment.status !== newStatus) {
      await db.update(subscriptionPayments)
        .set({ 
          status: newStatus,
          mercadopagoId: mpPayment.id.toString(),
          paidAt: mpPayment.date_approved ? Math.floor(new Date(mpPayment.date_approved).getTime() / 1000) : null,
          updatedAt: new Date(),
          metadata: JSON.stringify({
            ...JSON.parse(subscriptionPayment.metadata || '{}'),
            mercadopago_status: mpPayment.status,
            mercadopago_status_detail: mpPayment.status_detail,
            payment_method_id: mpPayment.payment_method_id,
            payment_type_id: mpPayment.payment_type_id,
            last_webhook_action: action,
            last_webhook_date: new Date().toISOString()
          })
        })
        .where(eq(subscriptionPayments.id, subscriptionPayment.id));

      console.log(`Subscription payment ${subscriptionPayment.id} updated from ${subscriptionPayment.status} to ${newStatus}`);
      
      // Si el pago fue aprobado, activar la suscripción
      if (newStatus === 'approved' && subscriptionPayment.status !== 'approved') {
        await handleSubscriptionPaymentApproved(subscriptionPayment);
      }
    } else {
      console.log(`Subscription payment ${subscriptionPayment.id} status unchanged: ${newStatus}`);
    }

  } catch (error) {
    console.error(`Error processing subscription payment webhook:`, error);
    throw error;
  }
}

// Manejar cuando un pago de suscripción es aprobado
async function handleSubscriptionPaymentApproved(subscriptionPayment: any) {
  try {
    console.log(`Activating subscription for payment ${subscriptionPayment.id}`);
    
    // Activar la suscripción correspondiente
    await db.update(subscriptions)
      .set({
        status: 'active',
        updatedAt: new Date()
      })
      .where(eq(subscriptions.id, subscriptionPayment.subscriptionId));

    console.log(`Subscription ${subscriptionPayment.subscriptionId} activated successfully`);
    
    // Aquí puedes agregar lógica adicional:
    // - Enviar email de bienvenida
    // - Configurar próximo cobro automático
    // - Actualizar métricas
    
  } catch (error) {
    console.error('Error activating subscription:', error);
  }
}

// Procesar webhook de suscripciones (para implementar más adelante)
async function processSubscriptionWebhook(subscriptionId: string, action: string) {
  console.log(`Subscription webhook received: ${subscriptionId}, action: ${action}`);
  // TODO: Implementar lógica de suscripciones
}

// Procesar webhook de preaprobaciones (para suscripciones recurrentes)
async function processPreapprovalWebhook(preapprovalId: string, action: string) {
  console.log(`Preapproval webhook received: ${preapprovalId}, action: ${action}`);
  // TODO: Implementar lógica de preaprobaciones
}

// Manejar cuando un pago es aprobado
async function handlePaymentApproved(payment: any) {
  try {
    console.log(`Processing approved payment for user ${payment.userId}, gym ${payment.gymId}`);
    
    // Aquí puedes agregar lógica adicional cuando un pago es aprobado:
    // - Activar membresía del usuario
    // - Enviar email de confirmación
    // - Registrar en analytics
    // - Notificar al gimnasio
    
    // Ejemplo: actualizar estado de membresía del usuario
    // await activateUserMembership(payment.userId, payment.gymId);
    
  } catch (error) {
    console.error('Error handling approved payment:', error);
  }
}

// Obtener historial de pagos del usuario
router.get('/my-payments', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (!req.user || req.user.userType !== 'user') {
      return res.status(403).json({ error: 'Only gym users can view payments' });
    }

    const userId = req.user.userId!;
    const gymId = req.user.gymId!;

    const userPayments = await db.select().from(payments)
      .where(eq(payments.userId, userId))
      .where(eq(payments.gymId, gymId));
    
    res.json({ payments: userPayments });
  } catch (error) {
    console.error('Get user payments error:', error);
    res.status(500).json({ error: 'Failed to get payments' });
  }
});

// Obtener pagos del gimnasio (para dueños)
router.get('/gym-payments', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (!req.user || req.user.userType !== 'gym_owner') {
      return res.status(403).json({ error: 'Only gym owners can view gym payments' });
    }

    const ownerId = req.user.ownerId!;
    
    // Obtener todos los gimnasios del dueño
    const ownerGyms = await db.select().from(require('../db/schema').gyms)
      .where(eq(require('../db/schema').gyms.ownerId, ownerId));
    
    const gymIds = ownerGyms.map(g => g.id);
    
    if (gymIds.length === 0) {
      return res.json({ payments: [] });
    }

    // Obtener pagos de todos los gimnasios del dueño
    const gymPayments = await db.select().from(payments)
      .where(gymIds.length === 1 
        ? eq(payments.gymId, gymIds[0])
        : require('drizzle-orm').sql`${payments.gymId} IN (${gymIds.join(',')})`
      );
    
    res.json({ payments: gymPayments });
  } catch (error) {
    console.error('Get gym payments error:', error);
    res.status(500).json({ error: 'Failed to get gym payments' });
  }
});

// Obtener estado de un pago específico
router.get('/:paymentId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const paymentId = parseInt(req.params.paymentId);

    const payment = await db.select().from(payments).where(
      eq(payments.id, paymentId)
    ).limit(1);

    if (!payment.length) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    // Verificar acceso según tipo de usuario
    if (req.user?.userType === 'user') {
      // Usuario solo puede ver sus propios pagos
      if (payment[0].userId !== req.user.userId) {
        return res.status(403).json({ error: 'Access denied to this payment' });
      }
    } else if (req.user?.userType === 'gym_owner') {
      // Dueño puede ver pagos de sus gimnasios
      const ownerGyms = await db.select().from(require('../db/schema').gyms)
        .where(eq(require('../db/schema').gyms.ownerId, req.user.ownerId!));
      
      const gymIds = ownerGyms.map(g => g.id);
      if (!gymIds.includes(payment[0].gymId)) {
        return res.status(403).json({ error: 'Access denied to this payment' });
      }
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({ payment: payment[0] });
  } catch (error) {
    console.error('Get payment error:', error);
    res.status(500).json({ error: 'Failed to get payment' });
  }
});

// Función helper para mapear estados de MercadoPago
function mapMercadoPagoStatus(mpStatus: string): 'pending' | 'approved' | 'cancelled' | 'refunded' {
  switch (mpStatus) {
    case 'approved':
      return 'approved';
    case 'cancelled':
    case 'rejected':
      return 'cancelled';
    case 'refunded':
      return 'refunded';
    default:
      return 'pending';
  }
}

export default router;