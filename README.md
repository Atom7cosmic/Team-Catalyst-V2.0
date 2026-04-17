# OrgOS (OrgYX) - AI-Powered Organization Operating System

An AI-powered enterprise workforce management platform with real-time meeting transcription, WebRTC video conferencing, performance analytics, and intelligent HR recommendations.

---

## Tech Stack

### Frontend
- **Next.js 14** (App Router, React 18)
- **Tailwind CSS** + Radix UI components
- **Zustand** (state management)
- **Socket.io Client** (WebRTC signaling)
- **Simple-Peer** (WebRTC peer connections)
- **Recharts** (data visualization)
- **React Flow** (org chart visualization)

### Backend
- **Node.js / Express.js**
- **MongoDB** with Mongoose
- **Redis** (BullMQ queues, Socket.io adapter)
- **Socket.io** (WebRTC signaling, real-time chat)
- **JWT** authentication (access + refresh tokens)
- **AWS S3** (audio storage)
- **Winston** (logging)

### AI / ML Stack
- **Groq API** (Whisper-large-v3 transcription, Llama3-70B inference)
- **LangChain.js** (LLM orchestration)
- **LangGraph.js** (multi-step recommendation workflows)
- **ChromaDB** (vector database for RAG)
- **@xenova/transformers** (local embeddings - all-MiniLM-L6-v2)
- **Pyannote.audio** (speaker diarization via separate Python service)
- **FFmpeg** (audio processing)

### Infrastructure
- **Docker / Docker Compose** (local development)
- **Railway / Render** (deployment targets)
- **Python FastAPI** (diarization microservice)

---

## ASCII Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │   Browser    │    │   Browser    │    │   Browser    │                  │
│  │  (Next.js)   │    │  (Next.js)   │    │  (Next.js)   │                  │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘                  │
│         │                   │                   │                           │
│         │ WebRTC (P2P)      │ WebRTC (P2P)      │                           │
│         └───────────────────┼───────────────────┘                           │
│                             │                                               │
│  WebSocket: Socket.io       │ HTTP: REST API                                │
│  Signaling for WebRTC       │ JSON requests                                 │
└─────────────────────────────┼───────────────────────────────────────────────┘
                              │
┌─────────────────────────────┼───────────────────────────────────────────────┐
│                         API GATEWAY                                         │
│                    ┌────────┴────────┐                                      │
│                    │   Express.js    │                                      │
│                    │   Server.js     │                                      │
│                    └────────┬────────┘                                      │
└─────────────────────────────┼───────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
┌────────▼────────┐  ┌────────▼────────┐  ┌────────▼────────┐
│   SOCKET.IO     │  │  REST ROUTES    │  │  BULLMQ QUEUES  │
│   Real-time     │  │  /api/*         │  │  (Redis)        │
│                 │  │                 │  │                 │
│ • join-room     │  │ • auth          │  │ • meeting-proc  │
│ • offer/answer  │  │ • meetings      │  │ • performance   │
│ • ice-candidate │  │ • users         │  │ • resignation   │
│ • audio-chunk   │  │ • tasks         │  │ • recommendations│
│ • chat-message  │  │ • sprints       │  │                 │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              │
┌─────────────────────────────┼───────────────────────────────────────────────┐
│                      PROCESSING LAYER                                       │
│  ┌──────────────────────────┴──────────────────────────┐                    │
│  │              Worker Process (Node.js)               │                    │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │                    │
│  │  │   meeting   │ │ performance │ │ resignation │   │                    │
│  │  │  processor  │ │   scorer    │ │  predictor  │   │                    │
│  │  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘   │                    │
│  │         └─────────────────┼─────────────────┘       │                    │
│  │                           │                         │                    │
│  │              ┌────────────┴────────────┐            │                    │
│  │              │   LangGraph Workflow    │            │                    │
│  │              │  (recommendation-engine)│            │                    │
│  │              └────────────┬────────────┘            │                    │
│  └───────────────────────────┼─────────────────────────┘                    │
└──────────────────────────────┼──────────────────────────────────────────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
┌────────▼────────┐   ┌────────▼────────┐   ┌───────▼─────────┐
│    MongoDB      │   │     Redis       │   │    ChromaDB     │
│  (Documents)    │   │    (Queues)     │   │   (Vectors)     │
│                 │   │                 │   │                 │
│ • Users         │   │ • BullMQ        │   │ • Meeting       │
│ • Meetings      │   │   jobs          │   │   transcripts   │
│ • Tasks         │   │ • Socket.io     │   │ • Employee      │
│ • Performance   │   │   sessions      │   │   performance   │
│ • Recommendations│  │                 │   │                 │
└─────────────────┘   └─────────────────┘   └─────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │      AWS S3         │
                    │   (Audio Storage)   │
                    │                     │
                    │ meetings/{id}/      │
                    │   device-{userId}   │
                    │     -chunk{N}.webm  │
                    └─────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │  DIARIZATION SVC    │
                    │  (Python/FastAPI)   │
                    │                     │
                    │  /diarize (pyannote)│
                    │  /health            │
                    └─────────────────────┘
```

---

## Environment Variables

### Backend (.env)

```env
# Database
MONGODB_URI=mongodb+srv://user:pass@host/dbname

# JWT Secrets
JWT_SECRET=your-jwt-secret-min-256-bits
JWT_REFRESH_SECRET=your-refresh-secret-min-256-bits
ACCESS_TOKEN_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=7d

# AWS S3 / Cloudflare R2
AWS_S3_BUCKET=your-bucket-name
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1

# Groq API (LLM + Transcription)
GROQ_API_KEY=gsk_xxxxxxxx

# Redis (BullMQ + Sessions)
REDIS_URL=redis://host:port

# Email (Resend)
RESEND_API_KEY=re_xxxxxxxx

# ChromaDB (Vector DB)
CHROMA_HOST=localhost
CHROMA_PORT=8000

# Diarization Service
DIARIZATION_URL=http://localhost:8001
HF_TOKEN=hf_xxxxxxxx

# App Settings
NODE_ENV=development
PORT=5001
HOST=0.0.0.0
WORKER_SOCKET_TOKEN=worker-internal-secret

# Whisper (optional local fallback)
WHISPER_MODEL_PATH=./models/whisper/ggml-base.bin
```

### Frontend (.env)

```env
NEXT_PUBLIC_API_URL=http://localhost:5001
NEXT_PUBLIC_SOCKET_URL=http://localhost:5001
```

---

## API Endpoints

### Authentication (`/api/auth`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/register` | Create new account |
| POST | `/login` | Login with email/password |
| POST | `/refresh` | Refresh access token |
| POST | `/logout` | Logout (requires auth) |
| POST | `/forgot-password` | Request password reset |
| POST | `/reset-password/:token` | Reset password with token |
| POST | `/change-password` | Change password (requires auth) |
| POST | `/onboarding` | Complete onboarding (requires auth) |
| GET | `/me` | Get current user (requires auth) |

### Users (`/api/users`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List all users |
| GET | `/org-chart` | Get organization hierarchy |
| GET | `/team/:id?` | Get team members |
| GET | `/:id` | Get user by ID (access controlled) |
| PUT | `/:id` | Update user (access controlled) |
| DELETE | `/:id` | Delete user (admin only) |
| PUT | `/settings/me` | Update current user settings |

### Meetings (`/api/meetings`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List meetings (user's meetings) |
| POST | `/` | Create new meeting |
| POST | `/upload` | Manual audio upload |
| GET | `/:id` | Get meeting details |
| PUT | `/:id` | Update meeting |
| DELETE | `/:id` | Delete meeting |
| POST | `/:id/cancel` | Cancel meeting |
| POST | `/:id/join` | Join meeting room |
| POST | `/:id/leave` | Leave meeting room |
| POST | `/:id/end` | End meeting (host only) |
| POST | `/:id/upload-recording` | Upload room recording |
| GET | `/:id/processing-status` | Get AI processing status |
| POST | `/:id/qa` | RAG Q&A on meeting |
| GET | `/:id/similar` | Find similar meetings |
| POST | `/:id/schedule-followup` | Schedule follow-up meeting |
| GET | `/:id/export` | Export to PDF |
| PUT | `/:id/transcript-segments` | Correct speaker labels |

### Tasks (`/api/tasks`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List tasks |
| GET | `/stats` | Get task statistics |
| POST | `/` | Create task |
| GET | `/:id` | Get task details |
| PUT | `/:id` | Update task |
| DELETE | `/:id` | Delete task |
| POST | `/:id/comments` | Add comment |

### Sprints (`/api/sprints`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List sprints |
| POST | `/` | Create sprint |
| GET | `/:id` | Get sprint |
| PUT | `/:id` | Update sprint |
| DELETE | `/:id` | Delete sprint |
| POST | `/:id/complete` | Complete sprint |

### Attendance (`/api/attendance`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Get attendance records |
| GET | `/heatmap` | Get attendance heatmap |
| POST | `/check-in` | Check in |
| POST | `/check-out` | Check out |
| POST | `/record` | Record attendance (superior only) |

### Performance (`/api/performance`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/:userId?` | Get performance (access controlled) |
| GET | `/:userId/trends` | Get performance trends |
| POST | `/pulse` | Submit pulse score |

### Recommendations (`/api/recommendations`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | List recommendations |
| GET | `/stats` | Get recommendation stats (superior only) |
| GET | `/:id` | Get recommendation details |
| POST | `/:id/acknowledge` | Acknowledge recommendation |
| POST | `/:id/dismiss` | Dismiss recommendation |
| POST | `/generate` | Generate new recommendation (admin) |

### Notifications (`/api/notifications`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Get notifications |
| PUT | `/:id/read` | Mark as read |
| PUT | `/read-all` | Mark all as read |
| DELETE | `/:id` | Delete notification |

### Dashboard (`/api/dashboard`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Get dashboard data |
| GET | `/team-overview` | Get team overview (superior only) |

### Admin (`/api/admin`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/users` | List all users |
| POST | `/users` | Create user |
| PUT | `/users/:id/status` | Toggle user status |
| GET | `/prompts` | Get prompt templates |
| PUT | `/prompts/:id` | Update prompt template |
| GET | `/system-stats` | Get system statistics |
| POST | `/impersonate` | Impersonate user |

### Audit (`/api/audit`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Get audit logs (admin only) |
| GET | `/user/:userId` | Get user audit logs |
| GET | `/export` | Export audit logs |

### Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server health check |

---

## Meeting Recording & Transcription Pipeline

### Recording Flow (Per-Device Architecture)

```
1. HOST STARTS RECORDING
   ↓
2. SERVER EMITS 'recording-started' TO ALL PARTICIPANTS
   ↓
3. EACH PARTICIPANT STARTS MediaRecorder (audio only, 10s chunks)
   - Captures audio from local MediaStream
   - Chunks sent via Socket.io every 10 seconds
   ↓
4. SERVER QUEUES CHUNKS IN MEMORY (transcriptQueue Map)
   - Key: meetingId
   - Value: Array of {userId, userName, timestamp, audioBuffer}
   ↓
5. HOST STOPS RECORDING
   ↓
6. SERVER EMITS 'get-transcript-queue' → CLIENT REQUESTS QUEUE
   ↓
7. SERVER UPLOADS EACH CHUNK TO S3
   - Format: meetings/{meetingId}/device-{userId}-chunk{i}-{timestamp}.webm
   - Returns array of {audioKey, timestamp, chunkIndex} per user
   ↓
8. CLIENT UPLOADS MIXED AUDIO + perDeviceAudio METADATA
   ↓
9. BULLMQ JOB CREATED → WORKER PROCESSES
```

### Processing Pipeline (Worker)

```
┌─────────────────┐
│  upload → done  │
└────────┬────────┘
         │
         ▼
┌──────────────────────────┐
│   TRANSCRIPTION (Groq)   │
│  Whisper-large-v3 API    │
│  - Hinglish optimized    │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│   SPEAKER ATTRIBUTION    │
│  Path A: Per-device      │
│    - No diarization      │
│    - 100% accurate       │
│                          │
│  Path B: Mixed audio     │
│    - Pyannote diarization│
│    - LLM fallback        │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│   AI ANALYSIS (Llama3)   │
│  - Summary               │
│  - Action items          │
│  - Decisions             │
│  - Follow-up topics      │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│   ATTENDEE SCORING       │
│  - Contribution 0-10     │
│  - Key points            │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│   EMBEDDINGS (ChromaDB)  │
│  - RAG for Q&A           │
│  - Similar meetings      │
└────────┬─────────────────┘
         │
         ▼
┌─────────────────┐
│  ready → done   │
└─────────────────┘
```

### Timestamp Correction Logic

**Problem**: WebM/Opus chunks lose silence when concatenated. If Bob is silent for 30s while Alice speaks, Whisper assigns Bob's first word to t=0 instead of t=30s.

**Solution**: Each chunk stores its wall-clock send timestamp. Absolute time is computed as:
```
chunkStartSeconds = (chunkTimestamp - CHUNK_DURATION_MS - meetingEpoch) / 1000
absoluteSegmentStart = chunkStartSeconds + whisperRelativeStart
absoluteSegmentEnd = chunkStartSeconds + whisperRelativeEnd
```

---

## WebRTC & TURN Server Configuration

### ICE Servers (frontend/components/meeting/MeetingRoom.jsx:412)

```javascript
{
  iceServers: [
    // Public STUN servers
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    
    // Railway TURN server (primary)
    {
      urls: 'turn:mainline.proxy.rlwy.net:10424',
      username: 'catalyst',
      credential: 'catalyst123'
    },
    {
      urls: 'turn:mainline.proxy.rlwy.net:10424?transport=tcp',
      username: 'catalyst',
      credential: 'catalyst123'
    },
    
    // Open Relay fallback
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
}
```

### WebRTC Signaling Flow

```
┌──────────┐                    ┌──────────┐
│  User A  │                    │  User B  │
└────┬─────┘                    └────┬─────┘
     │                               │
     │ 1. join-room                  │
     │──────────────────────────────>│
     │                               │
     │ 2. existing-users [B]         │
     │<──────────────────────────────│
     │                               │
     │ 3. createPeer(B, initiator=true)
     │    ┌───────────────────────┐  │
     │    │ SimplePeer generates  │  │
     │    │ offer                 │  │
     │    └───────────────────────┘  │
     │                               │
     │ 4. offer → server             │
     │──────────────────────────────>│
     │                               │
     │ 5. relay offer to B           │
     │──────────────────────────────>│
     │                               │
     │                               │ 6. createPeer(A, initiator=false)
     │                               │    signal(offer)
     │                               │
     │                               │ 7. answer generated
     │ 8. answer ← server            │
     │<──────────────────────────────│
     │                               │
     │ 9. signal(answer)             │
     │                               │
     │ 10. ICE candidates exchanged  │
     │<─────────────────────────────>│
     │                               │
     │ 11. on('stream') fires        │
     │    video element populated    │
```

---

## How to Run Locally

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- MongoDB Atlas account or local MongoDB
- AWS S3 bucket or Cloudflare R2
- Groq API key (https://console.groq.com)

### 1. Clone and Setup
```bash
git clone <repo>
cd orgos
```

### 2. Environment Setup
```bash
cp backend/.env.example backend/.env
# Edit backend/.env with your credentials
```

### 3. Docker Compose (Recommended)
```bash
# Start all services
docker-compose up -d

# Services started:
# - Frontend: http://localhost:3000
# - Backend API: http://localhost:5001
# - Redis: localhost:6379
# - ChromaDB: http://localhost:8000
```

### 4. Seed Database
```bash
cd backend
npm install
npm run seed
```

### 5. Start Workers (Separate Terminal)
```bash
cd backend
npm run worker
```

### Manual Development (Without Docker)

**Backend:**
```bash
cd backend
npm install
npm run dev       # API server
npm run worker    # Queue workers (separate terminal)
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

**Redis:**
```bash
docker run -d -p 6379:6379 redis:7-alpine
```

**ChromaDB:**
```bash
docker run -d -p 8000:8000 chromadb/chroma:latest
```

**Diarization Service (Optional):**
```bash
cd diarization
docker build -t diarization .
docker run -d -p 8001:8001 -e HF_TOKEN=hf_xxx diarization
```

---

## Railway Deployment Structure

### Services Configuration

```yaml
# railway.yaml (conceptual)
services:
  backend:
    build: ./backend
    ports:
      - 5001
    env:
      - NODE_ENV=production
      - REDIS_URL=${{Redis.REDIS_URL}}
    healthcheck:
      path: /health
      
  frontend:
    build: ./frontend
    ports:
      - 3000
    env:
      - NEXT_PUBLIC_API_URL=${{backend.url}}
      - NEXT_PUBLIC_SOCKET_URL=${{backend.url}}
      
  redis:
    image: redis:7-alpine
    
  chroma:
    image: chromadb/chroma:latest
    
  diarization:
    build: ./diarization
    ports:
      - 8001
```

### Deployed Endpoints (Current)
- **Production Frontend**: https://orgyx.vercel.app
- **Production Backend**: https://orgyx-backend.onrender.com

### Build Commands

**Backend:**
```dockerfile
FROM node:20
WORKDIR /app
RUN apt-get update && apt-get install -y ffmpeg
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 5001
CMD ["npm", "start"]
```

**Frontend:**
```dockerfile
FROM node:20
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

---

## Known Gotchas & Implementation Notes

### Audio Processing

1. **Per-Device vs Mixed Audio**
   - Per-device audio provides 100% accurate speaker attribution
   - Mixed audio uses Pyannote diarization with LLM fallback
   - Per-device is default when multiple participants are in the room

2. **WebM to WAV Conversion**
   - Pyannote requires 16kHz mono WAV input
   - FFmpeg conversion happens in diarization service before processing
   - Original WebM chunks are preserved for re-processing

3. **Chunk Timeline Accuracy**
   - Each 10s chunk stores wall-clock timestamp when sent
   - Absolute time = (chunkTimestamp - 10000ms) + whisperRelativeTime
   - Prevents overlapping segments from silence compression

### WebRTC

1. **TURN Server Required**
   - Symmetric NAT environments break P2P with STUN only
   - Railway TURN server configured for production
   - Open Relay fallback for development

2. **Peer Reconnection**
   - `peer-restart` event triggers new SimplePeer instance
   - Auto-retry on connection failure with 3s delay
   - Media state syncs after reconnection

3. **Mobile Limitations**
   - Screen sharing disabled on mobile (no getDisplayMedia)
   - Lower video resolution recommended (480p)
   - Audio focus handling varies by browser

### AI/ML

1. **Groq Rate Limits**
   - Whisper: 40 requests/minute
   - Llama3-70B: 30 requests/minute
   - Large files split into 10-minute chunks

2. **ChromaDB Persistence**
   - Collections auto-created on startup
   - Graceful degradation if ChromaDB unavailable
   - Embeddings use Xenova/all-MiniLM-L6-v2 (local, no API call)

3. **Hinglish Transcription**
   - Custom prompt guides Whisper for Hinglish (Hindi + English)
   - Common terms: "sync karo", "bandwidth nahi hai", "stuck hai"
   - Temperature 0 for deterministic output

### Database

1. **Role Hierarchy**
   - CEO (9) → CTO (8) → VP Eng (7) → Director (6) → EM (5)
   - Access control checks superior/subordinate relationships
   - `requireUserAccess` middleware enforces data isolation

2. **Soft Deletes**
   - Users have `isActive` flag, not actually deleted
   - Meetings can be cancelled but records preserved
   - Audit logs immutable once written

3. **MongoDB Indexes**
   - User email: unique
   - Meeting host + attendees: compound for queries
   - Performance user + date: compound for trends

### Security

1. **JWT Strategy**
   - Access token: 15 min expiry, in memory only
   - Refresh token: 7 day expiry, HTTP-only cookie
   - Token refresh happens transparently in axios interceptor

2. **Worker Authentication**
   - Workers use `WORKER_SOCKET_TOKEN` for socket auth
   - Separate from user JWT to prevent privilege escalation
   - Server rejects worker tokens for API routes

3. **CORS Origins**
   - Explicit allowlist in server.js
   - Includes localhost for development
   - Vercel preview deployments must be added manually

### Queue Processing

1. **Meeting Processor Concurrency**
   - Set to 2 to prevent Groq rate limit hits
   - Large meetings can take 5-10 minutes to process
   - Processing status streamed via Socket.io

2. **Requeue Script**
   - `requeue-meeting.js` for manual reprocessing
   - Preserves original audio keys in meeting document
   - Use when AI analysis fails or needs regeneration

3. **Worker Health**
   - Logs every 5 minutes for monitoring
   - Diarization service ping every 10 minutes (keep-alive)
   - SIGTERM handling for graceful shutdown

### Frontend

1. **Next.js App Router**
   - Client components marked with 'use client'
   - API routes proxied via next.config.js rewrites
   - Environment variables prefixed with NEXT_PUBLIC_

2. **Zustand Persistence**
   - Auth store persists to localStorage
   - Notification store is ephemeral
   - Hydration mismatch avoided with mount checks

3. **Build Configuration**
   - ESLint errors ignored during build
   - TypeScript errors ignored during build
   - Images unoptimized for static export compatibility

---

## File Structure

```
orgos/
├── backend/
│   ├── server.js                 # Express + Socket.io entry
│   ├── config/
│   │   ├── db.js                 # MongoDB connection
│   │   ├── redis.js              # Redis client
│   │   ├── s3.js                 # AWS S3 operations
│   │   ├── chroma.js             # Vector DB client
│   │   ├── email.js              # Resend/nodemailer
│   │   └── hierarchy.config.js   # Role definitions
│   ├── routes/
│   │   ├── auth.js               # Authentication routes
│   │   ├── meetings.js           # Meeting CRUD + upload
│   │   ├── users.js              # User management
│   │   └── ...                   # Other routes
│   ├── controllers/              # Route handlers
│   ├── models/                   # Mongoose schemas
│   ├── middleware/
│   │   ├── authMiddleware.js     # JWT verification
│   │   └── roleMiddleware.js     # Access control
│   ├── workers/
│   │   ├── index.js              # Worker entry point
│   │   ├── meetingProcessor.js   # Transcription + AI
│   │   ├── performanceScorer.js  # Weekly performance
│   │   ├── resignationPredictor.js
│   │   └── recommendationEngine.js
│   └── ai/
│       ├── langchain.js          # LLM chains
│       ├── langgraph.js          # Recommendation workflow
│       ├── embeddings.js         # Vector generation
│       └── prompts.js            # RAG utilities
├── frontend/
│   ├── app/                      # Next.js App Router
│   │   ├── meetings/
│   │   │   └── [id]/
│   │   │       └── room/         # WebRTC meeting room
│   │   └── ...                   # Other pages
│   ├── components/
│   │   └── meeting/
│   │       └── MeetingRoom.jsx   # WebRTC implementation
│   ├── lib/
│   │   ├── axios.js              # API client with refresh
│   │   └── socket.js             # Socket.io client
│   └── store/                    # Zustand stores
├── diarization/
│   ├── Dockerfile
│   ├── app.py                    # FastAPI + Pyannote
│   └── requirements.txt
├── docker-compose.yml
└── README.md
```

---

## License

MIT License
