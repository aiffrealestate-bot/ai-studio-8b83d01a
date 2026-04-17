import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'law-firm-landing-api',
      version: process.env.npm_package_version ?? '1.0.0',
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'X-RateLimit-Limit': '60',
        'X-RateLimit-Remaining': '59',
        'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
      },
    }
  );
}
