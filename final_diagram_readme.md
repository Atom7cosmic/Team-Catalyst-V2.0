# OrgOS — Final System Architecture Diagrams

> Complete visual reference for all modules and data flows in the OrgOS platform.

---

## 1. Overall Platform Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            CLIENT LAYER                                  │
│                     Next.js 14 (App Router)                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │Meetings  │  │ Tasks /  │  │Attendance│  │Performan-│  │Recommend-│  │
│  │+ WebRTC  │  │ Sprints  │  │ Heatmap  │  │ce Charts │  │ations    │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  │
└───────┼─────────────┼─────────────┼──────────────┼─────────────┼────────┘
        │ WebRTC P2P  │             │              │             │
        │ Socket.io   │  REST API (/api/*)         │             │
        └─────────────┴──────────────┬─────────────┴─────────────┘
                                     │
┌────────────────────────────────────▼─────────────────────────────────────┐
│                          API GATEWAY (Express.js :5001)                  │
│  ┌─────────────────┐   ┌──────────────────┐   ┌────────────────────┐    │
│  │  Socket.io      │   │  REST Controllers│   │  BullMQ Queues     │    │
│  │  - join-room    │   │  - Auth          │   │  - meeting-proc    │    │
│  │  - audio-chunk  │   │  - Meetings      │   │  - perf-scoring    │    │
│  │  - chat-message │   │  - Tasks/Sprints │   │  - recommendation  │    │
│  │  - ice-candidate│   │  - Performance   │   │  (via Redis)       │    │
│  └─────────────────┘   └──────────────────┘   └────────────────────┘    │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼───────────────────────────────────────┐
│                           WORKER LAYER                                   │
│  ┌─────────────────────────────────────────────────────────────────┐     │
│  │  meetingProcessor.js   performanceScorer.js   recommendationEngine│    │
│  │       │                       │                      │           │     │
│  │  Groq Whisper           BullMQ Triggers        LangGraph Workflow│     │
│  │  Pyannote Diarize       Score Calculation      5-Node Reasoning  │     │
│  │  Llama3 Analysis        Trend Detection        Groq Llama3-70B   │     │
│  └─────────────────────────────────────────────────────────────────┘     │
└──────────┬──────────────────────┬──────────────────────┬─────────────────┘
           │                      │                      │
┌──────────▼──────┐  ┌────────────▼──────────┐  ┌───────▼──────────────┐
│   MongoDB       │  │  ChromaDB (HNSW)       │  │  AWS S3              │
│  - Users        │  │  - meeting_transcripts │  │  - Audio Chunks      │
│  - Meetings     │  │  - employee_perf       │  │  meetings/{id}/      │
│  - Tasks        │  │  Cosine Similarity     │  │  device-{uid}-       │
│  - Performance  │  │  Sub-50ms queries      │  │  chunk{N}.webm       │
│  - Sprints      │  └───────────────────────┘  └──────────────────────┘
│  - Attendance   │
│  - Recommend.   │
└─────────────────┘
           │
┌──────────▼──────────────────────────────────────────┐
│          Diarization Microservice (Python FastAPI)   │
│          Pyannote.audio + Silero VAD                 │
│          POST /diarize  |  GET /health               │
└─────────────────────────────────────────────────────┘
```

---

## 2. Meeting Module — Full Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│  CLIENT: MeetingRoom.jsx                                                │
│  MediaRecorder → 10s chunks → Socket.io 'audio-chunk'                  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  server.js Socket Handler│
                    │  - Queues chunks in RAM  │
                    │  - transcriptQueue Map   │
                    └────────────┬────────────┘
                                 │ flush-my-chunks
                    ┌────────────▼────────────┐
                    │       AWS S3             │
                    │  device-{uid}-chunk{N}   │
                    └────────────┬────────────┘
                                 │ BullMQ Job
                    ┌────────────▼────────────┐
                    │   meetingProcessor.js    │
                    │                          │
                    │  1. Groq Whisper Transcr.│
                    │  2. Speaker Attribution  │
                    │     ├─ Per-device (def.) │
                    │     └─ Pyannote fallback │
                    │  3. Llama3 AI Analysis   │
                    │     ├─ Summary           │
                    │     ├─ Action Items      │
                    │     ├─ Decisions         │
                    │     └─ Contribution Score│
                    │  4. ChromaDB Embedding   │
                    │  5. Performance Update   │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  Socket.io Notification  │
                    │  'processing-update'     │
                    │  status: 'ready'         │
                    └─────────────────────────┘
```

---

## 3. Conversational RAG Pipeline

```
User Question
     │
     ▼
┌────────────────────────────────────────┐
│  Greeting Detection                    │
│  → "Hello/Hi" → Natural greeting resp │
└────────────────┬───────────────────────┘
                 │ (not a greeting)
     ┌───────────▼──────────────┐
     │  Xenova Embedding        │
     │  all-MiniLM-L6-v2 (local)│
     └───────────┬──────────────┘
                 │ 384-dim vector
     ┌───────────▼──────────────┐
     │  ChromaDB HNSW Query     │
     │  Filter: meetingId=X     │
     │  Space: cosine           │
     │  Top-K: 5 chunks         │
     └───────────┬──────────────┘
                 │ Retrieved context
     ┌───────────▼──────────────┐
     │  Off-Topic Detection     │
     │  → Low similarity score  │
     │  → "I don't have info.." │
     └───────────┬──────────────┘
                 │ (relevant context found)
     ┌───────────▼──────────────┐
     │  LangChain RAG Chain     │
     │  System Prompt +         │
     │  Meeting Context +       │
     │  Strict Guardrails       │
     │  → No transcript dumps   │
     │  → Synthesised answers   │
     └───────────┬──────────────┘
                 │
     ┌───────────▼──────────────┐
     │  Groq Llama3-70B         │
     │  Structured Response     │
     └──────────────────────────┘
```

---

## 4. LangGraph Recommendation Workflow

```
  POST /api/recommendations/generate
               │
               ▼
    ┌──────────────────────┐
    │  Node 1              │
    │  Performance Analysis│
    │  - currentScore      │
    │  - trend direction   │
    │  - weekly scores     │
    └──────────┬───────────┘
               │
    ┌──────────▼───────────┐
    │  Node 2              │
    │  Resignation Risk    │
    │  - declining trend   │
    │  - consecutive drops │
    │  - pulse patterns    │
    └──────────┬───────────┘
               │
    ┌──────────▼───────────┐
    │  Node 3              │
    │  Workload Balance    │
    │  - task completion   │
    │  - overdue count     │
    │  - deadline adherence│
    └──────────┬───────────┘
               │
    ┌──────────▼───────────┐
    │  Node 4              │
    │  Skill Gap Analysis  │
    │  - task types        │
    │  - meeting contrib.  │
    │  - dev areas         │
    └──────────┬───────────┘
               │
    ┌──────────▼───────────┐
    │  Node 5              │
    │  Recommendation Gen  │
    │  Llama3-70B synthesis│
    │  - Category:         │
    │    promote/develop/  │
    │    retain/attention  │
    │  - Title + Desc      │
    │  - Reasoning         │
    │  - Action Items      │
    └──────────┬───────────┘
               │
    ┌──────────▼───────────┐
    │  MongoDB Store       │
    │  + Notify Employee   │
    └──────────────────────┘
```

---

## 5. Performance Scoring Engine

```
BullMQ Job: performance-scoring
               │
     ┌─────────▼──────────┐
     │  Task Metrics       │
     │  Last 7 days        │
     │  completion rate    │  ──► × 0.40
     │  deadline adherence │  ──► × 0.30
     └─────────┬──────────┘
               │
     ┌─────────▼──────────┐
     │  Attendance Metrics │
     │  avg hours/day      │  ──► × 0.10
     │  (8hrs = 1.0 norm.) │
     └─────────┬──────────┘
               │
     ┌─────────▼──────────┐
     │  Meeting Contrib.   │
     │  avg score / 10     │  ──► × 0.20
     └─────────┬──────────┘
               │
     ┌─────────▼──────────────────────────────┐
     │  Final Score = Σ(weighted components)  │
     │  × 100                                 │
     │                                        │
     │  Trend: improving / stable /           │
     │         declining / neutral            │
     └─────────┬──────────────────────────────┘
               │
     ┌─────────▼──────────┐
     │  Resignation AI     │
     │  Llama3-70B         │
     │  risk: low/med/high │
     └────────────────────┘
```

---

## 6. WebRTC Signaling Flow

```
  User A                  Server               User B
    │                       │                    │
    │──── join-room ────────►│                    │
    │                       │◄─── join-room ──────│
    │                       │                    │
    │◄── existing-users ────│                    │
    │                       │                    │
    │  createPeer(B, init)  │                    │
    │──── offer ────────────►│                    │
    │                       │──── offer ─────────►│
    │                       │                    │ createPeer(A)
    │                       │◄─── answer ─────────│
    │◄── answer ────────────│                    │
    │                       │                    │
    │◄═══ ICE candidates ══►│◄══ ICE candidates ►│
    │                       │                    │
    │◄══════════ P2P Connection Established ═════►│
    │              (audio + video stream)         │
```

---

## 7. Authentication & RBAC Flow

```
POST /api/auth/login
        │
        ▼
  Verify Password (bcrypt)
        │
        ▼
  Check Lockout (failedAttempts)
        │
        ▼
  Generate JWT Access Token (15min)
  Generate Refresh Token (7d, httpOnly cookie)
        │
        ▼
  AuditLog entry created
        │
  ┌─────▼──────────────────────────────────────────┐
  │              RBAC Hierarchy                    │
  │                                                │
  │  Level 9: CEO/C-Level                         │
  │  Level 8: CTO / VP Engineering                │
  │  Level 7: Director                            │
  │  Level 6: Engineering Manager                 │
  │  Level 5: Senior Engineer                     │
  │  Level 4: Mid-level Engineer                  │
  │  Level 3: Junior Engineer                     │
  │  Level 2: Intern                              │
  │                                               │
  │  canAccessUser(requester, target):            │
  │  → True if target is in requester's org tree  │
  └───────────────────────────────────────────────┘
```

---

## 8. Module Dependency Map

```
                    ┌──────────────────┐
                    │   USER MODULE    │
                    │  Auth + Org RBAC │
                    └────────┬─────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
          ▼                  ▼                  ▼
  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
  │  ATTENDANCE   │  │  PERFORMANCE  │  │     TASK      │
  │  Check In/Out │◄─┤  Score Engine │◄─┤  CRUD + Stats │
  │  Heatmap      │  │  Trend/Risk   │  │  Sprint Link  │
  └───────┬───────┘  └───────┬───────┘  └───────┬───────┘
          │                  │                  │
          └──────────────────┼──────────────────┘
                             │
                    ┌────────▼─────────┐
                    │  RECOMMENDATION  │
                    │  LangGraph Engine│
                    │  Promote/Retain  │
                    └────────┬─────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
          ▼                  ▼                  ▼
  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
  │   MEETING     │  │    SPRINT     │  │  NOTIFICATION │
  │  WebRTC + AI  │  │  Kanban + Vel │  │  Socket.io    │
  └───────────────┘  └───────────────┘  └───────────────┘
```

---

## 9. Docker Compose Service Map

```
docker-compose.yml
│
├── frontend        (Next.js)      → :3000
├── backend         (Express.js)   → :5001
├── redis           (Redis 7)      → :6379
├── chroma          (ChromaDB)     → :8000
└── diarization     (FastAPI)      → :8001
        │
        └── Pyannote.audio (HF_TOKEN required)
            Silero VAD (bundled)
```

---

## 10. Data Models Overview

```
User              Meeting           Task
──────────        ─────────────     ──────────────
_id               _id               _id
email             name              title
password (hash)   host → User       description
firstName         attendees[]       assignee → User
lastName          transcript        reporter → User
role (9 levels)   summary           sprint → Sprint
roleLevel         actionItems[]     status
superior → User   decisions[]       priority
team[]            status            type
department        contributionScore dueDate
isActive          scheduledAt       storyPoints
darkMode          createdAt         comments[]
timezone                            meetingSource

Performance       Attendance        Recommendation
───────────────   ──────────────    ──────────────
user → User       user → User       user → User
currentScore      date              category
trend             checkIn           title
weeklyScores[]    checkOut          description
taskStats         totalHours        reasoning
attendanceStats   status            actionItems[]
pulseScores[]     notes             status
lastCalculatedAt  approvedBy        acknowledged
                                    dismissed
```

---

*OrgOS — Module Architecture Reference | Team Catalyst V2.0*
