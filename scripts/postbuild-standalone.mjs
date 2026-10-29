import { cp, access } from 'node:fs/promises'
import { constants } from 'node:fs'

// Next.js standalone output omits static assets and public by design. Copy them
// for Render/Docker's standalone Node server. Vercel can ignore this extra copy.
const standalone = '.next/standalone'
await access(`${standalone}/server.js`, constants.R_OK)
await cp('.next/static', `${standalone}/.next/static`, { recursive: true, force: true })
try {
  await access('public', constants.R_OK)
  await cp('public', `${standalone}/public`, { recursive: true, force: true })
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}
console.log('Standalone production output prepared.')
