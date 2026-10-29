// Buildr Collaboration Service — real-time WebSocket server on port 3004.
// ------------------------------------------------------------------
// Enables multiple users to edit a project simultaneously. Features:
//   - Presence: see who's online and where their cursor is
//   - File edits: broadcast file changes to all connected editors
//   - Cursor positions: show other users' cursors in the code editor
//   - Chat: in-editor chat between collaborators
//
// This is a standalone Bun + Socket.IO service. The Next.js frontend
// connects via io("/?XTransformPort=3004") (through the gateway).
//
// Rooms are keyed by projectId. Authentication is via the NextAuth JWT
// session token, verified against NEXTAUTH_SECRET. In dev mode
// (NODE_ENV !== production), connections are accepted without token
// verification for local testing.
//
// SECURITY:
//   - CORS is restricted to the configured ALLOWED_ORIGINS (or the
//     gateway origin in production) — never '*'.
//   - JWT is verified with jose (if available) or jsonwebtoken.
//   - The userId is extracted from the JWT, not the query string.

import { Server } from 'socket.io'
import { jwtVerify } from 'jose'

const PORT = 3004

// ---- Security config -----------------------------------------------------
const isProduction = process.env.NODE_ENV === 'production'
const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || ''

// SECURITY: in production, the secret MUST be set.
if (isProduction && NEXTAUTH_SECRET.length < 32) {
  console.error('[Collab] FATAL: NEXTAUTH_SECRET must be at least 32 characters in production.')
  process.exit(1)
}

// CORS: restrict to the app origin(s). Default to the gateway in dev.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
// In dev, allow localhost:3000 if no origins configured.
const corsOrigins = ALLOWED_ORIGINS.length > 0
  ? ALLOWED_ORIGINS
  : isProduction
    ? [] // production REQUIRES explicit config
    : ['http://localhost:3000']

if (isProduction && ALLOWED_ORIGINS.length === 0) {
  console.error('[Collab] FATAL: ALLOWED_ORIGINS must be set in production.')
  process.exit(1)
}

// ---- JWT verification ----------------------------------------------------
const secretKey = new TextEncoder().encode(NEXTAUTH_SECRET || 'buildr-dev-secret-change-in-production')

async function verifyToken(token: string): Promise<{ userId?: string; email?: string } | null> {
  if (!NEXTAUTH_SECRET) return null
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ['HS256'],
    })
    return {
      userId: (payload as Record<string, unknown>).id as string | undefined,
      email: (payload as Record<string, unknown>).email as string | undefined,
    }
  } catch {
    return null
  }
}

// ---- Supabase client (for project membership checks) --------------------
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null

if (isProduction && !supabase) {
  console.error('[Collab] FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production.')
  process.exit(1)
}

// Resolve project role using a server-side credential. Missing DB configuration
// or lookup failures deny access; a client-supplied userId is never trusted.
async function getProjectRole(userId: string, projectId: string): Promise<'owner' | 'editor' | 'viewer' | null> {
  if (!supabase) return null
  try {
    const { data: project, error: projectError } = await supabase
      .from('projects').select('owner_id').eq('id', projectId).maybeSingle()
    if (projectError || !project) return null
    if (project.owner_id === userId) return 'owner'

    const { data: membership, error: membershipError } = await supabase
      .from('project_members').select('role').eq('project_id', projectId).eq('user_id', userId).maybeSingle()
    if (membershipError || !membership) return null
    if (membership.role === 'editor' || membership.role === 'admin') return 'editor'
    if (membership.role === 'viewer') return 'viewer'
    return null
  } catch {
    return null
  }
}

interface User {
  id: string
  email: string
  name: string | null
  color: string // cursor color
}

interface CursorPosition {
  fileId: string
  path: string
  line: number
  column: number
}

interface FileEdit {
  path: string
  content: string
  userId: string
  timestamp: number
}

interface ChatMessage {
  userId: string
  userName: string
  text: string
  timestamp: number
}

// Colors for user cursors (emerald/teal palette to match the brand).
const CURSOR_COLORS = [
  '#059669', '#0d9488', '#0891b2', '#0284c7',
  '#7c3aed', '#c026d3', '#db2777', '#dc2626',
  '#ea580c', '#ca8a04', '#65a30d', '#16a34a',
]
let colorIndex = 0

// In-memory state (per server instance).
const rooms = new Map<string, {
  users: Map<string, User>
  cursors: Map<string, CursorPosition>
  edits: FileEdit[]
  chat: ChatMessage[]
}>()

function getRoom(projectId: string) {
  if (!rooms.has(projectId)) {
    rooms.set(projectId, {
      users: new Map(),
      cursors: new Map(),
      edits: [],
      chat: [],
    })
  }
  return rooms.get(projectId)!
}

const io = new Server(PORT, {
  cors: {
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  path: '/',
})

// Auth middleware — verify the session token before allowing connection.
// In production, the JWT MUST be verified against NEXTAUTH_SECRET.
// In dev, connections are accepted with a userId + projectId (for testing).
io.use(async (socket, next) => {
  const projectId = socket.handshake.query.projectId as string
  const token = socket.handshake.auth?.token as string || socket.handshake.query.token as string

  if (!projectId || projectId.length > 128 || /[\r\n]/.test(projectId)) {
    return next(new Error('A valid projectId is required'))
  }

  // In production, verify the JWT and extract the userId.
  if (isProduction) {
    if (!token) {
      return next(new Error('Authentication required in production'))
    }
    let claims: { userId?: string; email?: string } | null = null
    try { claims = await verifyToken(token) } catch { claims = null }
    if (!claims || !claims.userId || claims.userId.length > 128) {
      return next(new Error('Invalid or expired token'))
    }
    // SECURITY: verify the user is authorized to access this project
    // (owner or member). Prevents unauthorized users from joining
    // project rooms and injecting events.
    const role = await getProjectRole(claims.userId, projectId)
    if (!role) {
      return next(new Error('Access denied: you are not a member of this project'))
    }
    // Use the verified userId from the JWT, not the query string.
    ;(socket.data as Record<string, unknown>).userId = claims.userId
    ;(socket.data as Record<string, unknown>).email = claims.email || 'unknown@buildr.dev'
    ;(socket.data as Record<string, unknown>).role = role
    return next()
  }

  // Dev mode: accept connections with projectId (token optional).
  const userId = (socket.handshake.query.userId as string) || 'dev-user'
  ;(socket.data as Record<string, unknown>).userId = userId
  ;(socket.data as Record<string, unknown>).role = 'owner'
  next()
})

io.on('connection', (socket) => {
  const projectId = socket.handshake.query.projectId as string
  // Use the verified userId from the JWT (set in the auth middleware),
  // not the query string (which is untrusted in production).
  const userId = (socket.data as Record<string, unknown>).userId as string || 'anonymous'
  const email = ((socket.data as Record<string, unknown>).email as string) || 'anonymous@buildr.dev'
  const requestedName = typeof socket.handshake.query.name === 'string' ? socket.handshake.query.name : ''
  const name = requestedName.slice(0, 100) || null

  if (!projectId) {
    socket.disconnect()
    return
  }

  const color = CURSOR_COLORS[colorIndex++ % CURSOR_COLORS.length]
  const user: User = { id: userId, email, name, color }
  const room = getRoom(projectId)

  // Join the project room.
  socket.join(projectId)
  room.users.set(socket.id, user)

  console.log(`[Collab] ${email} joined project ${projectId} (${room.users.size} users online)`)

  // Send current state to the new user.
  socket.emit('room:state', {
    users: Array.from(room.users.entries()).map(([sid, u]) => ({ socketId: sid, ...u })),
    cursors: Array.from(room.cursors.entries()).map(([sid, c]) => ({ socketId: sid, ...c })),
    recentChat: room.chat.slice(-20),
  })

  // Broadcast user joined.
  socket.to(projectId).emit('user:joined', { socketId: socket.id, ...user })

  // Cursor position update.
  socket.on('cursor:move', (pos: CursorPosition) => {
    if (!pos || typeof pos !== 'object' || typeof pos.path !== 'string' || pos.path.length > 1024 ||
        !Number.isSafeInteger(pos.line) || pos.line < 0 || pos.line > 10_000_000 ||
        !Number.isSafeInteger(pos.column) || pos.column < 0 || pos.column > 1_000_000) return
    const safePosition: CursorPosition = { fileId: typeof pos.fileId === 'string' ? pos.fileId.slice(0, 128) : '', path: pos.path, line: pos.line, column: pos.column }
    room.cursors.set(socket.id, safePosition)
    socket.to(projectId).emit('cursor:move', { socketId: socket.id, user, position: safePosition })
  })

  // File edit broadcast.
  socket.on('file:edit', (edit: FileEdit) => {
    const role = (socket.data as Record<string, unknown>).role
    if (!['owner', 'editor'].includes(String(role))) return
    if (!edit || typeof edit !== 'object' || typeof edit.path !== 'string' || edit.path.length > 1024 ||
        typeof edit.content !== 'string' || Buffer.byteLength(edit.content, 'utf8') > 262_144) return
    const safeEdit: FileEdit = { path: edit.path, content: edit.content, userId, timestamp: Date.now() }
    room.edits.push(safeEdit)
    if (room.edits.length > 100) room.edits = room.edits.slice(-100)
    socket.to(projectId).emit('file:edit', { ...safeEdit, user, socketId: socket.id })
  })

  // File selection (which file the user is viewing).
  socket.on('file:select', (data: { path: string }) => {
    if (!data || typeof data.path !== 'string' || data.path.length > 1024) return
    socket.to(projectId).emit('file:select', { socketId: socket.id, user, path: data.path })
  })

  // Chat message.
  socket.on('chat:message', (data: { text: string }) => {
    if (!data || typeof data.text !== 'string') return
    const text = data.text.trim()
    if (!text || Buffer.byteLength(text, 'utf8') > 4000) return
    const msg: ChatMessage = {
      userId,
      userName: name || email,
      text,
      timestamp: Date.now(),
    }
    room.chat.push(msg)
    if (room.chat.length > 200) room.chat = room.chat.slice(-200)
    io.to(projectId).emit('chat:message', msg)
  })

  // Typing indicator.
  socket.on('chat:typing', () => {
    socket.to(projectId).emit('chat:typing', { socketId: socket.id, user })
  })

  // Disconnect.
  socket.on('disconnect', () => {
    room.users.delete(socket.id)
    room.cursors.delete(socket.id)
    socket.to(projectId).emit('user:left', { socketId: socket.id })
    console.log(`[Collab] ${email} left project ${projectId} (${room.users.size} users online)`)
  })
})

console.log(`Buildr Collaboration Service running on port ${PORT}`)
console.log(`  Connect via: io("/?XTransformPort=3004&projectId=<id>&userId=<id>&email=<email>")`)
