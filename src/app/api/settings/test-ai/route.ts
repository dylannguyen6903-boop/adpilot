import { NextResponse } from 'next/server';
import { validateAIKey } from '@/lib/ai';

/**
 * POST /api/settings/test-ai
 * Validate an AI API key by making a minimal test request.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { provider, apiKey } = body;

    if (!provider || !apiKey) {
      return NextResponse.json(
        { valid: false, error: 'Provider and API key are required.' },
        { status: 400 }
      );
    }

    const result = await validateAIKey(provider, apiKey);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { valid: false, error: `Test failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}

