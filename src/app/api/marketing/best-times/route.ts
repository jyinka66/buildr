// GET /api/marketing/best-times — AI-suggested best posting times per platform.
// ------------------------------------------------------------------
// Returns mock data (since we don't have real analytics yet) with the
// recommended posting windows for each supported social platform.
//
// Response shape:
//   {
//     times: {
//       meta:      ['09:00', '13:00', '19:00'],
//       x:         ['08:00', '12:00', '17:00'],
//       linkedin:  ['08:30', '12:00', '17:30'],
//       instagram: ['11:00', '14:00', '19:00'],
//       tiktok:    ['10:00', '15:00', '20:00'],
//     },
//     meta: { <platform>: { times: string[]; note: string } },
//   }

import { NextResponse } from 'next/server'
import { requireSessionUser } from '@/lib/session'

const BEST_TIMES: Record<string, string[]> = {
  meta: ['09:00', '13:00', '19:00'],
  x: ['08:00', '12:00', '17:00'],
  linkedin: ['08:30', '12:00', '17:30'],
  instagram: ['11:00', '14:00', '19:00'],
  tiktok: ['10:00', '15:00', '20:00'],
}

const NOTES: Record<string, string> = {
  meta: 'Facebook & Instagram — mid-morning and evening scrolls convert best.',
  x: 'X / Twitter — catch the morning commute and lunch break.',
  linkedin: 'LinkedIn — pre-work, lunch, and post-workday windows.',
  instagram: 'Instagram — late morning and after-dinner browsing peaks.',
  tiktok: 'TikTok — late morning, mid-afternoon, and prime evening.',
}

export async function GET() {
  try {
    await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }

  const meta: Record<string, { times: string[]; note: string }> = {}
  for (const [platform, times] of Object.entries(BEST_TIMES)) {
    meta[platform] = { times: [...times], note: NOTES[platform] }
  }

  return NextResponse.json({
    times: BEST_TIMES,
    meta,
  })
}
