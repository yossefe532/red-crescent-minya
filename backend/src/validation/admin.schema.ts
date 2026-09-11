import { z } from 'zod';

export const createMissionSchema = z.object({
  title: z.string().min(3, 'العنوان قصير جداً').max(200, 'العنوان طويل جداً'),
  description: z.string().max(1000).optional(),
  location: z.string().max(200).optional(),
  start_at: z.string().datetime(),
  end_at: z.string().datetime(),
  capacity: z.number().int().positive('السعة يجب أن تكون أكبر من صفر').max(10000),
  waiting_list: z.number().int().min(0, 'قائمة الانتظار لا يمكن أن تكون سالبة').max(1000).optional().default(0),
  telegram_notifications: z.number().int().min(0).max(1).optional().default(1),
  registration_open_at: z.string().datetime().optional(),
  registration_close_at: z.string().datetime().optional(),
});

export const updateMissionSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  description: z.string().max(1000).optional(),
  location: z.string().max(200).optional(),
  start_at: z.string().datetime().optional(),
  end_at: z.string().datetime().optional(),
  capacity: z.number().int().positive().max(10000).optional(),
  waiting_list: z.number().int().min(0).max(1000).optional(),
  telegram_notifications: z.number().int().min(0).max(1).optional(),
  status: z.enum(['DRAFT', 'OPEN', 'CLOSED', 'CANCELLED', 'COMPLETED']).optional(),
  registration_open_at: z.string().datetime().optional(),
  registration_close_at: z.string().datetime().optional(),
});

export const loginSchema = z.object({
  username: z.string().min(1, 'اسم المستخدم مطلوب'),
  password: z.string().min(1, 'كلمة المرور مطلوبة'),
});
