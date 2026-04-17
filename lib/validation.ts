import { z } from 'zod';

/**
 * Enum of legal matter types available in the contact/lead form.
 * Labels are in Hebrew to match the UI language.
 */
export const LegalMatterTypeEnum = z.enum([
  'corporate',
  'real_estate',
  'family_law',
  'criminal_defense',
  'labor_employment',
  'intellectual_property',
  'litigation',
  'tax_law',
  'immigration',
  'banking_finance',
  'data_privacy',
  'other',
]);

export type LegalMatterType = z.infer<typeof LegalMatterTypeEnum>;

/**
 * Lead / contact form schema.
 * Validates all fields submitted via POST /api/leads.
 */
export const leadSchema = z.object({
  /** Full name of the prospective client (Hebrew or Latin characters) */
  full_name: z
    .string()
    .trim()
    .min(2, { message: 'שם חייב להכיל לפחות 2 תווים' })
    .max(120, { message: 'שם ארוך מדי — מקסימום 120 תווים' }),

  /** Israeli or international phone number */
  phone: z
    .string()
    .trim()
    .regex(
      /^[\+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{4,10}$/,
      { message: 'מספר טלפון אינו תקין' }
    )
    .max(20, { message: 'מספר טלפון ארוך מדי' }),

  /** Contact email address */
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email({ message: 'כתובת אימייל אינה תקינה' })
    .max(254, { message: 'כתובת אימייל ארוכה מדי' }),

  /** Category of legal matter */
  matter_type: LegalMatterTypeEnum,

  /** Free-text description of the legal matter */
  message: z
    .string()
    .trim()
    .min(10, { message: 'אנא פרט את הפנייה — לפחות 10 תווים' })
    .max(2000, { message: 'הודעה ארוכה מדי — מקסימום 2000 תווים' }),

  /** Optional: preferred contact method */
  preferred_contact: z
    .enum(['phone', 'email', 'whatsapp'])
    .optional()
    .default('email'),

  /** Honeypot field — must be empty to pass bot detection */
  website: z
    .string()
    .max(0, { message: 'Bot detected' })
    .optional()
    .default(''),

  /** GDPR / privacy policy consent */
  consent: z.literal(true, {
    errorMap: () => ({ message: 'יש לאשר את מדיניות הפרטיות להמשך' }),
  }),
});

export type LeadInput = z.infer<typeof leadSchema>;

/**
 * Sanitised lead data after stripping honeypot and consent fields
 * before inserting into the database.
 */
export type LeadInsert = Omit<LeadInput, 'website' | 'consent'> & {
  source_url?: string;
  ip_address?: string;
  user_agent?: string;
  created_at?: string;
};

/**
 * Health check query schema (no body expected, but typed for completeness).
 */
export const healthSchema = z.object({});

/**
 * Utility: safely parse unknown input and return typed result or formatted errors.
 */
export function safeParseSchema<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown
): { success: true; data: z.infer<T> } | { success: false; errors: Record<string, string[]> } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_root';
    if (!errors[key]) errors[key] = [];
    errors[key].push(issue.message);
  }
  return { success: false, errors };
}
