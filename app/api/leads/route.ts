import { NextRequest, NextResponse } from 'next/server';
import { getPublicSupabaseClient } from '@/lib/supabase';
import { leadSchema, safeParseSchema, type LeadInsert } from '@/lib/validation';

// ---------------------------------------------------------------------------
// Rate limiting configuration
// In production, replace this in-memory store with an upstash/redis solution.
// ---------------------------------------------------------------------------
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 5; // max 5 lead submissions per IP per minute

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

function getRateLimitHeaders(
  remaining: number,
  resetAt: number,
  limit: number
): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(Math.max(0, remaining)),
    'X-RateLimit-Reset': String(Math.floor(resetAt / 1000)),
    'X-RateLimit-Policy': `${limit};w=60`,
  };
}

function checkRateLimit(ip: string): {
  allowed: boolean;
  remaining: number;
  resetAt: number;
} {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || now > entry.resetAt) {
    const resetAt = now + RATE_LIMIT_WINDOW_MS;
    rateLimitStore.set(ip, { count: 1, resetAt });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, resetAt };
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  rateLimitStore.set(ip, entry);
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - entry.count,
    resetAt: entry.resetAt,
  };
}

// Clean up stale entries every 10 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetAt) rateLimitStore.delete(key);
  }
}, 10 * 60 * 1000);

// ---------------------------------------------------------------------------
// POST /api/leads
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  // 1. Extract client IP for rate limiting
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    request.headers.get('x-real-ip') ??
    'anonymous';

  const { allowed, remaining, resetAt } = checkRateLimit(ip);
  const rateLimitHeaders = getRateLimitHeaders(
    remaining,
    resetAt,
    RATE_LIMIT_MAX_REQUESTS
  );

  if (!allowed) {
    return NextResponse.json(
      {
        success: false,
        error: 'יותר מדי בקשות — אנא נסה שנית בעוד דקה.',
        code: 'RATE_LIMITED',
      },
      { status: 429, headers: { ...rateLimitHeaders, 'Retry-After': '60' } }
    );
  }

  // 2. Parse request body
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: 'גוף הבקשה אינו JSON תקין.',
        code: 'INVALID_JSON',
      },
      { status: 400, headers: rateLimitHeaders }
    );
  }

  // 3. Validate with Zod
  const parsed = safeParseSchema(leadSchema, rawBody);

  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'נתונים שגויים — אנא בדוק את הטופס.',
        code: 'VALIDATION_ERROR',
        fields: parsed.errors,
      },
      { status: 422, headers: rateLimitHeaders }
    );
  }

  // 4. Honeypot check (bot detection)
  if (parsed.data.website && parsed.data.website.length > 0) {
    // Silently accept but do not insert — do not reveal bot detection to attacker
    return NextResponse.json(
      { success: true, message: 'הפנייה נשלחה בהצלחה.' },
      { status: 200, headers: rateLimitHeaders }
    );
  }

  // 5. Build the insert payload (strip honeypot + consent fields)
  const { website: _honeypot, consent: _consent, ...cleanData } = parsed.data;

  const leadInsert: LeadInsert = {
    ...cleanData,
    source_url:
      request.headers.get('referer') ??
      request.headers.get('origin') ??
      undefined,
    ip_address: process.env.NODE_ENV === 'production' ? ip : undefined,
    user_agent: request.headers.get('user-agent') ?? undefined,
    created_at: new Date().toISOString(),
  };

  // 6. Insert into Supabase via parameterized client call (RLS applies)
  const supabase = getPublicSupabaseClient();

  const { data, error } = await supabase
    .from('leads')
    .insert([
      {
        full_name: leadInsert.full_name,
        phone: leadInsert.phone,
        email: leadInsert.email,
        matter_type: leadInsert.matter_type,
        message: leadInsert.message,
        preferred_contact: leadInsert.preferred_contact,
        source_url: leadInsert.source_url ?? null,
        ip_address: leadInsert.ip_address ?? null,
        user_agent: leadInsert.user_agent ?? null,
        created_at: leadInsert.created_at,
      },
    ])
    .select('id, created_at')
    .single();

  if (error) {
    // Log server-side for observability
    console.error('[POST /api/leads] Supabase insert error:', {
      code: error.code,
      message: error.message,
      details: error.details,
    });

    return NextResponse.json(
      {
        success: false,
        error: 'שגיאה בשמירת הפנייה — אנא נסה שנית או פנה אלינו ישירות.',
        code: 'DB_INSERT_ERROR',
      },
      { status: 500, headers: rateLimitHeaders }
    );
  }

  // 7. Success response
  return NextResponse.json(
    {
      success: true,
      message: 'הפנייה נשלחה בהצלחה. ניצור איתך קשר בהקדם.',
      lead_id: data?.id,
      submitted_at: data?.created_at,
    },
    { status: 201, headers: rateLimitHeaders }
  );
}

// ---------------------------------------------------------------------------
// Method not allowed handler
// ---------------------------------------------------------------------------
export async function GET() {
  return NextResponse.json(
    { error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED' },
    {
      status: 405,
      headers: {
        Allow: 'POST',
        'X-RateLimit-Limit': String(RATE_LIMIT_MAX_REQUESTS),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000)),
      },
    }
  );
}
