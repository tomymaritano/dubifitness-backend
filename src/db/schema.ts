import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, real } from 'drizzle-orm/sqlite-core';

// Dueños de gimnasios (los que pagan la suscripción)
export const gymOwners = sqliteTable('gym_owners', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  companyName: text('company_name').notNull(),
  phone: text('phone'),
  subscriptionStatus: text('subscription_status', { enum: ['active', 'cancelled', 'expired'] }).notNull().default('active'),
  planType: text('plan_type', { enum: ['basic', 'pro', 'premium'] }).notNull().default('basic'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
});

// Gimnasios/empresas
export const gyms = sqliteTable('gyms', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ownerId: integer('owner_id').notNull().references(() => gymOwners.id),
  name: text('name').notNull(),
  description: text('description'),
  email: text('email'),
  maxClients: integer('max_clients').notNull().default(50),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
});

// Sedes/sucursales de cada gimnasio
export const gymLocations = sqliteTable('gym_locations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  gymId: integer('gym_id').notNull().references(() => gyms.id),
  name: text('name').notNull(), // ej: "FitMax Palermo"
  address: text('address').notNull(),
  city: text('city').notNull(),
  phone: text('phone'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
});

// Usuarios finales de la app (clientes del gimnasio)
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  gymId: integer('gym_id').notNull().references(() => gyms.id),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  phone: text('phone'),
  birthDate: integer('birth_date', { mode: 'timestamp' }),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
});

// Staff del gimnasio (instructores, administradores)
export const gymStaff = sqliteTable('gym_staff', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  gymId: integer('gym_id').notNull().references(() => gyms.id),
  locationId: integer('location_id').references(() => gymLocations.id), // null = todas las sedes
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  role: text('role', { enum: ['admin', 'instructor', 'manager'] }).notNull(),
  phone: text('phone'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
});

// Clases
export const classes = sqliteTable('classes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  gymId: integer('gym_id').notNull().references(() => gyms.id),
  locationId: integer('location_id').notNull().references(() => gymLocations.id),
  instructorId: integer('instructor_id').references(() => gymStaff.id),
  name: text('name').notNull(),
  description: text('description'),
  capacity: integer('capacity').notNull().default(20),
  duration: integer('duration').notNull().default(60), // en minutos
  price: real('price').notNull().default(0),
  datetime: integer('datetime', { mode: 'timestamp' }).notNull(),
  isRecurring: integer('is_recurring', { mode: 'boolean' }).notNull().default(false),
  recurringPattern: text('recurring_pattern'), // 'weekly', 'daily', etc.
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
});

// Reservas
export const bookings = sqliteTable('bookings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  gymId: integer('gym_id').notNull().references(() => gyms.id),
  userId: integer('user_id').notNull().references(() => users.id),
  classId: integer('class_id').notNull().references(() => classes.id),
  status: text('status', { enum: ['confirmed', 'cancelled', 'waitlist', 'attended', 'no_show'] }).notNull().default('confirmed'),
  paymentId: integer('payment_id').references(() => payments.id),
  notes: text('notes'),
  bookedAt: integer('booked_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  cancelledAt: integer('cancelled_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
});

// Pagos
export const payments = sqliteTable('payments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  gymId: integer('gym_id').notNull().references(() => gyms.id),
  userId: integer('user_id').notNull().references(() => users.id),
  amount: real('amount').notNull(),
  currency: text('currency').notNull().default('ARS'),
  status: text('status', { enum: ['pending', 'approved', 'cancelled', 'refunded'] }).notNull().default('pending'),
  paymentMethod: text('payment_method').notNull().default('mercadopago'),
  mercadopagoId: text('mercadopago_id'),
  description: text('description'),
  metadata: text('metadata'), // JSON string para datos adicionales
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
});

// Membresías
export const memberships = sqliteTable('memberships', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  gymId: integer('gym_id').notNull().references(() => gyms.id),
  userId: integer('user_id').notNull().references(() => users.id),
  type: text('type', { enum: ['monthly', 'weekly', 'class_pack', 'unlimited'] }).notNull(),
  credits: integer('credits').default(0), // para packs de clases
  creditsUsed: integer('credits_used').notNull().default(0),
  price: real('price').notNull(),
  startsAt: integer('starts_at', { mode: 'timestamp' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
});

// Configuración del gimnasio
export const gymSettings = sqliteTable('gym_settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  gymId: integer('gym_id').notNull().references(() => gyms.id),
  key: text('key').notNull(),
  value: text('value').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
});