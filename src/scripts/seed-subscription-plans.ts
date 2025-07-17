import { createDatabase } from '../db';
import { subscriptionPlans } from '../db/schema';

const db = createDatabase(
  process.env.TURSO_DATABASE_URL || 'file:./dev.db',
  process.env.TURSO_AUTH_TOKEN
);

async function seedSubscriptionPlans() {
  console.log('🌱 Seeding subscription plans...');

  try {
    // Insertar planes de suscripción
    const plans = [
      {
        name: 'Plan Básico',
        code: 'basic',
        description: 'Perfecto para empezar tu gimnasio',
        monthlyPrice: 15000,
        annualPrice: 150000,
        maxGyms: 1,
        maxUsersPerGym: 50,
        maxClassesPerMonth: 100,
        features: JSON.stringify([
          'Hasta 50 usuarios por gimnasio',
          'Hasta 100 clases por mes',
          'Sistema de reservas básico',
          'Panel de administración',
          'Soporte por email'
        ]),
        isActive: true
      },
      {
        name: 'Plan Pro',
        code: 'pro',
        description: 'Para gimnasios en crecimiento',
        monthlyPrice: 25000,
        annualPrice: 250000,
        maxGyms: 3,
        maxUsersPerGym: 150,
        maxClassesPerMonth: 300,
        features: JSON.stringify([
          'Hasta 3 ubicaciones de gimnasio',
          'Hasta 150 usuarios por gimnasio',
          'Hasta 300 clases por mes',
          'Sistema de reservas avanzado',
          'Reportes y analytics',
          'Integración con pagos',
          'Soporte prioritario'
        ]),
        isActive: true
      },
      {
        name: 'Plan Premium',
        code: 'premium',
        description: 'Para cadenas de gimnasios',
        monthlyPrice: 45000,
        annualPrice: 450000,
        maxGyms: 10,
        maxUsersPerGym: 500,
        maxClassesPerMonth: 1000,
        features: JSON.stringify([
          'Hasta 10 ubicaciones de gimnasio',
          'Hasta 500 usuarios por gimnasio',
          'Clases ilimitadas',
          'Sistema de reservas premium',
          'Analytics avanzados',
          'API personalizada',
          'Integración completa con pagos',
          'Soporte 24/7',
          'Capacitación personalizada'
        ]),
        isActive: true
      }
    ];

    // Limpiar planes existentes (solo en desarrollo)
    if (process.env.NODE_ENV !== 'production') {
      await db.delete(subscriptionPlans);
      console.log('🗑️ Cleared existing subscription plans');
    }

    // Insertar nuevos planes
    const insertedPlans = await db.insert(subscriptionPlans).values(plans).returning();
    
    console.log('✅ Subscription plans seeded successfully:');
    insertedPlans.forEach(plan => {
      console.log(`  - ${plan.name} (${plan.code}): $${plan.monthlyPrice}/mes, $${plan.annualPrice}/año`);
    });

  } catch (error) {
    console.error('❌ Error seeding subscription plans:', error);
    process.exit(1);
  }
}

// Ejecutar si el script es llamado directamente
if (require.main === module) {
  seedSubscriptionPlans()
    .then(() => {
      console.log('🎉 Seeding completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Seeding failed:', error);
      process.exit(1);
    });
}

export { seedSubscriptionPlans };