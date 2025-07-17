import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { users, gymOwners } from '../db/schema';
import { db } from '../db';
import { getSecurityConfig } from '../config/environment';

export interface AuthRequest extends Request {
  user?: {
    // Para usuarios finales
    userId?: number;
    gymId?: number;
    // Para dueños de gimnasios
    ownerId?: number;
    // Común
    email: string;
    userType: 'user' | 'gym_owner';
  };
}

export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, getSecurityConfig().jwtSecret) as any;
    
    if (decoded.userType === 'gym_owner') {
      // Autenticación para dueños de gimnasios
      const owner = await db.select().from(gymOwners).where(eq(gymOwners.id, decoded.ownerId)).limit(1);
      
      if (!owner.length || !owner[0].isActive) {
        return res.status(401).json({ error: 'Invalid or inactive gym owner' });
      }

      req.user = {
        ownerId: owner[0].id,
        email: owner[0].email,
        userType: 'gym_owner'
      };

    } else {
      // Autenticación para usuarios finales
      const user = await db.select().from(users).where(eq(users.id, decoded.userId)).limit(1);
      
      if (!user.length || !user[0].isActive) {
        return res.status(401).json({ error: 'Invalid or inactive user' });
      }

      req.user = {
        userId: user[0].id,
        gymId: user[0].gymId,
        email: user[0].email,
        userType: 'user'
      };
    }

    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid token' });
  }
};

export const requireUserType = (userTypes: Array<'user' | 'gym_owner'>) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!userTypes.includes(req.user.userType)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};

export const requireGymOwner = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user || req.user.userType !== 'gym_owner') {
    return res.status(403).json({ error: 'Gym owner access required' });
  }
  next();
};

export const requireGymUser = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user || req.user.userType !== 'user') {
    return res.status(403).json({ error: 'Gym user access required' });
  }
  next();
};

export const requireGymAccess = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const gymId = parseInt(req.params.gymId || req.body.gymId);
  
  if (req.user.userType === 'gym_owner') {
    // Los dueños pueden acceder a sus propios gimnasios
    // Esto requiere verificar que el gymId pertenece al owner
    // Se podría hacer aquí o en cada ruta específica
    return next();
  }

  if (req.user.userType === 'user') {
    // Los usuarios solo pueden acceder a su propio gimnasio
    if (req.user.gymId !== gymId) {
      return res.status(403).json({ error: 'Access denied to this gym' });
    }
  }

  next();
};