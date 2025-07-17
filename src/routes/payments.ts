import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { payments } from '../db/schema';
import { db } from '../db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import MercadoPago, { MercadoPagoConfig } from 'mercadopago';

const router = Router();

// Configurar MercadoPago
const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || '',
  options: {
    timeout: 5000,
    idempotencyKey: 'abc'
  }
});

const mercadopago = new MercadoPago(client);

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

      const mpResponse = await mercadopago.preferences.create({ body: preference });

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
    const { type, data } = req.body;
    console.log('Webhook received:', { type, data });

    if (type === 'payment') {
      const paymentId = data.id;
      
      try {
        // Verificar el pago con MercadoPago API
        const mpPayment = await mercadopago.payment.get({ id: paymentId });
        
        if (mpPayment && mpPayment.external_reference) {
          // Actualizar estado en nuestra base de datos
          const externalReference = mpPayment.external_reference;
          const status = mapMercadoPagoStatus(mpPayment.status || 'pending');
          
          await db.update(payments)
            .set({ 
              status,
              mercadopagoId: paymentId.toString(),
              updatedAt: new Date()
            })
            .where(eq(payments.id, parseInt(externalReference)));

          console.log(`Payment ${externalReference} updated to status: ${status}`);
        }

      } catch (mpError) {
        console.error('Error fetching payment from MercadoPago:', mpError);
        // Continuar procesando otros webhooks aunque este falle
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

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