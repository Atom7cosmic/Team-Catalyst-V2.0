# OrgOS — Module Architecture Diagrams

> ASCII architecture diagrams for each core module of OrgOS, an AI-powered enterprise workforce management platform.

---

## 1. Meeting Module

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                         CLIENT LAYER                                                            │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────┐    ┌─────────────────────────────┐                                            │
│  │   MeetingRoom.jsx           │    │   meetings/[id]/page.jsx    │                                            │
│  │   - WebRTC PeerConnection   │    │   - Transcript Viewer       │                                            │
│  │   - MediaRecorder API       │    │   - Analyze Button          │                                            │
│  │   - Socket.io Client        │    │   - Meeting Details         │                                            │
│  └──────────────┬──────────────┘    └──────────────┬──────────────┘                                            │
└─────────────────┼──────────────────────────────────┼───────────────────────────────────────────────────────────┘
                  │                                  │
                  │  Socket.io                       │  REST API
                  │  - join-room                     │  GET /api/meetings
                  │  - audio-chunk                   │  POST /api/meetings
                  │  - flush-my-chunks               │  GET /api/meetings/:id
                  │  - get-transcript-queue          │  POST /api/meetings/:id/analyze
                  │  - start-recording               │  PUT /api/meetings/:id
                  │  - stop-recording                │  DELETE /api/meetings/:id
                  ▼                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                         API LAYER (Express.js + Socket.io)                                      │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                                    server.js (Port 5001)                                                │   │
│  │  ┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────────────────────┐ │   │
│  │  │   Socket.io Handlers    │  │   Meeting Controller    │  │   Middleware                            │ │   │
│  │  │   - join-room           │  │   - createMeeting       │  │   - JWT Authentication                  │ │   │
│  │  │   - audio-chunk         │  │   - getMeetings         │  │   - Rate Limiting                       │ │   │
│  │  │   - flush-my-chunks     │  │   - uploadRecording     │  │   - CORS                                │ │   │
│  │  │   - get-transcript-queue│  │   - analyzeMeeting      │  │   - Helmet Security                     │ │   │
│  │  │   - start-recording     │  │   - endMeeting          │  │                                         │ │   │
│  │  │   - stop-recording      │  │   - deleteMeeting       │  │                                         │ │   │
│  │  └───────────┬─────────────┘  └───────────┬─────────────┘  └─────────────────────────────────────────┘ │   │
│  └──────────────┼────────────────────────────┼────────────────────────────────────────────────────────────┘   │
└─────────────────┼────────────────────────────┼─────────────────────────────────────────────────────────────────┘
                  │                            │
                  │  BullMQ Job                │  MongoDB Operations
                  │  meeting-processing        │
                  ▼                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    WORKER LAYER                                                                 │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                                 meetingProcessor.js                                                     │   │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────────┐   │   │
│  │  │  Transcription   │  │  Speaker         │  │  AI Analysis     │  │  Embeddings                  │   │   │
│  │  │                  │  │  Assignment      │  │                  │  │                              │   │   │
│  │  │  Groq Whisper    │  │  VAD + Silero    │  │  Llama3-70B      │  │  ChromaDB                    │   │   │
│  │  │  large-v3        │  │  Pyannote        │  │  Meeting QA      │  │  meeting_transcripts         │   │   │
│  │  │                  │  │  LLM Fallback    │  │  RAG Pipeline    │  │                              │   │   │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘  └──────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                  │                            │                            │                            │
                  │                            │                            │                            │
     ┌────────────┴────────────┐   ┌──────────┴──────────┐   ┌─────────────┴─────────────┐   ┌───────────┴──────────┐
     ▼                         ▼   ▼                     ▼   ▼                           ▼   ▼                      ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐               ┌─────────────────┐     ┌─────────────────┐
│  AWS S3         │     │  MongoDB        │     │  Groq API       │               │  ChromaDB       │     │  Hugging Face   │
│                 │     │                 │     │                 │               │                 │     │  Space          │
│  - meetings/    │     │  Meeting        │     │  - Whisper      │               │  Collections:   │     │                 │
│    {id}/        │     │  Collection:    │     │    -large-v3    │               │  - meeting_     │     │  - Pyannote     │
│    recording-   │     │  - _id          │     │  - Llama3-70B   │               │    transcripts  │     │    Diarization  │
│    {ts}.webm    │     │  - name         │     │                 │               │                 │     │  - Silero VAD   │
│  - meetings/    │     │  - host         │     │                 │               │                 │     │                 │
│    {id}/        │     │  - attendees    │     │                 │               │                 │     │                 │
│    device-{uid}-│     │  - transcript   │     │                 │               │                 │     │                 │
│    chunk*.webm  │     │    Segments     │     │                 │               │                 │     │                 │
│                 │     │  - summary      │     │                 │               │                 │     │                 │
│                 │     │  - actionItems  │     │                 │               │                 │     │                 │
│                 │     │  - status       │     │                 │               │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘               └─────────────────┘     └─────────────────┘
```

### Data Flow Summary

1. **Meeting Creation**: User creates meeting via `POST /api/meetings` → MeetingController validates attendees → Creates Meeting document → Sends notifications via Notification model
2. **Join Room**: Client emits `join-room` Socket event → Server adds user to room → Broadcasts `user-connected` to other participants → Returns existing participants list
3. **Audio Capture**: MeetingRoom.jsx captures audio via MediaRecorder → Splits into 10s chunks → Emits `audio-chunk` events with WebM buffer + timestamp
4. **Chunk Flush**: On recording stop, client emits `flush-my-chunks` → Server uploads each chunk to AWS S3 as `device-{userId}-chunk{index}.webm` → Runs VAD scoring via Silero (background) → Stores chunk metadata with voiceRatio
5. **Transcript Queue Collection**: Host emits `get-transcript-queue` → Server waits for all participants' chunks → Returns combined per-device audio array with VAD scores
6. **Analysis Trigger**: User clicks "Analyze Meeting" → `POST /api/meetings/:id/analyze` → MeetingController creates BullMQ job → Job data includes meetingId, audioKey, perDeviceAudio
7. **Worker Processing**: meetingProcessor.js picks up job → Downloads mixed audio from S3 → Transcribes via Groq Whisper-large-v3 → Filters hallucinations
8. **Speaker Assignment**: Worker assigns speakers using per-device timeline + VAD scores (primary) or Pyannote diarization (fallback) or LLM inference (final fallback)
9. **AI Analysis**: Llama3-70B analyzes transcript → Extracts summary, conclusions, decisions, action items, follow-up topics → Scores attendee contributions
10. **Embedding Storage**: Transcript chunked into 300-word segments → Embeddings generated → Stored in ChromaDB meeting_transcripts collection with metadata
11. **Performance Update**: Worker updates Performance collection for each attendee with meetingStats (total meetings, avg contribution score)
12. **Notification**: Meeting status set to 'ready' → Notification created → Client receives via Socket.io `processing-update` events

---

## 2. Recommendation Module

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                         CLIENT LAYER                                                            │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────────────────┐                            │
│  │   /recommendations Page                                                         │                            │
│  │   - Recommendation List (cards)                                                 │                            │
│  │   - Acknowledge Button                                                          │                            │
│  │   - Dismiss Button (with reason modal)                                          │                            │
│  │   - Category Filters                                                            │                            │
│  └────────────────────────────────┬────────────────────────────────────────────────┘                            │
└───────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │  REST API
                                    │  GET  /api/recommendations?status=&category=&userId=
                                    │  GET  /api/recommendations/:id
                                    │  POST /api/recommendations/:id/acknowledge
                                    │  POST /api/recommendations/:id/dismiss
                                    │  POST /api/recommendations/generate
                                    │  GET  /api/recommendations/stats
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                         API LAYER (Express.js)                                                  │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                              recommendationController.js                                                │   │
│  │  ┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────────────────────┐ │   │
│  │  │   Read Operations       │  │   Write Operations      │  │   AI Generation                         │ │   │
│  │  │   - getRecommendations  │  │   - acknowledge         │  │   - generateRecommendation              │ │   │
│  │  │   - getRecommendation   │  │   - dismiss             │  │   - getStats                            │ │   │
│  │  │   - Access Control      │  │   - Audit Logging       │  │   - LangGraph Workflow                  │ │   │
│  │  └───────────┬─────────────┘  └───────────┬─────────────┘  └───────────────────┬─────────────────────┘ │   │
│  └──────────────┼────────────────────────────┼─────────────────────────────────────┼──────────────────────┘   │
└─────────────────┼────────────────────────────┼─────────────────────────────────────┼───────────────────────────┘
                  │                            │                                     │
                  │  MongoDB Queries           │  BullMQ Job                         │  LangGraph Workflow
                  │                            │                                     │
                  ▼                            ▼                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    WORKER LAYER                                                                 │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                         recommendationEngine.js (BullMQ Worker)                                         │   │
│  │                                    Queue: recommendation-generation                                     │   │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                   │                                                             │
│                                                   ▼                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                              LangGraph Multi-Step Workflow                                              │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │   │
│  │  │  Performance    │→ │  Resignation    │→ │  Workload       │→ │  Skill Gap      │→ │  Recommend-  │ │   │
│  │  │  Analysis Node  │  │  Risk Node      │  │  Balance Node   │  │  Node           │  │  ation Gen   │ │   │
│  │  │                 │  │                 │  │                 │  │                 │  │  Node        │ │   │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘  └─────────────────┘  └──────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                    │                                     │
                                    │  Read User Data                     │  Groq API Call
                                    ▼                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    DATA LAYER                                                                   │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐                    │
│  │  MongoDB        │     │  MongoDB        │     │  MongoDB        │     │  Groq API       │                    │
│  │  Recommendation │     │  Performance    │     │  User           │     │  (Llama3-70B)   │                    │
│  │  Collection:    │     │  Collection:    │     │  Collection:    │     │                 │                    │
│  │  - _id          │     │  - user         │     │  - _id          │     │  LangGraph      │                    │
│  │  - user         │     │  - currentScore │     │  - firstName    │     │  Reasoning      │                    │
│  │  - category     │     │  - trend        │     │  - lastName     │     │                 │                    │
│  │  - title        │     │  - weeklyScores │     │  - role         │     │                 │                    │
│  │  - description  │     │  - taskStats    │     │  - superior     │     │                 │                    │
│  │  - reasoning    │     │  - attendance   │     │  - Performance  │     │                 │                    │
│  │  - actionItems  │     │    Stats        │     │    (populated)  │     │                 │                    │
│  │  - status       │     │                 │     │                 │     │                 │                    │
│  │  - acknowledged │     │                 │     │                 │     │                 │                    │
│  │  - dismissed    │     │                 │     │                 │     │                 │                    │
│  └─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘                    │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow Summary

1. **Recommendation Request**: Client calls `POST /api/recommendations/generate` with userId → Controller validates access via `canAccessUser` middleware
2. **LangGraph Workflow Trigger**: Controller calls `runRecommendationWorkflow(userId)` → BullMQ job added to `recommendation-generation` queue
3. **Performance Analysis Node**: Workflow fetches user's Performance document → Analyzes currentScore, trend, taskStats, attendanceStats → Identifies performance patterns
4. **Resignation Risk Node**: Analyzes declining trends, consecutive neutral/declining days, pulse score history → Calculates resignation probability
5. **Workload Balance Node**: Fetches recent Tasks → Calculates completion rate, overdue count, deadline adherence → Identifies burnout risk
6. **Skill Gap Node**: Analyzes task types, completion patterns, meeting contributions → Identifies areas for development
7. **Recommendation Generation Node**: Llama3-70B synthesizes all analysis → Generates category (promote/develop/retain/attention), title, description, reasoning, actionItems
8. **Storage**: Recommendation document created in MongoDB → Status set to 'pending' → Associated with user
9. **Notification**: User receives notification about new recommendation
10. **User Action**: User acknowledges (with optional reason) or dismisses (with required reason) → Status updated → AuditLog created
11. **Promotion Pass-Over Tracking**: If dismissed promotion recommendation, increment `promotionPassOverCount` for future analysis

---

## 3. Attendance Module

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                         CLIENT LAYER                                                            │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐                    │
│  │   /attendance Page                                                                      │                    │
│  │   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────────────────┐│                    │
│  │   │  Check-In/Out   │  │  Heatmap        │  │  Team Attendance View                   ││                    │
│  │   │  Button         │  │  Calendar       │  │  - Direct Reports List                  ││                    │
│  │   │  Status Display │  │  (Recharts)     │  │  - Present/Absent/Late Indicators       ││                    │
│  │   └─────────────────┘  └─────────────────┘  └─────────────────────────────────────────┘│                    │
│  └────────────────────────────────────────┬────────────────────────────────────────────────┘                    │
└───────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────┘
                                            │
                                            │  REST API
                                            │  GET  /api/attendance?userId=&startDate=&endDate=
                                            │  POST /api/attendance/checkin
                                            │  POST /api/attendance/checkout
                                            │  POST /api/attendance/record (superiors only)
                                            │  GET  /api/attendance/heatmap?userId=&year=&month=
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                         API LAYER (Express.js)                                                  │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                              attendanceController.js                                                    │   │
│  │  ┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────────────────────┐ │   │
│  │  │   Check-In/Out          │  │  Record (Superior)      │  │  Heatmap Data                           │ │   │
│  │  │   - checkIn()           │  │  - recordAttendance()   │  │  - getHeatmap()                         │ │   │
│  │  │   - checkOut()          │  │  - Access Control       │  │  - Date Range Query                     │ │   │
│  │  │   - Duplicate Check     │  │  - Audit Logging        │  │  - Format for Calendar                  │ │   │
│  │  └───────────┬─────────────┘  └───────────┬─────────────┘  └───────────────────┬─────────────────────┘ │   │
│  └──────────────┼────────────────────────────┼─────────────────────────────────────┼──────────────────────┘   │
└─────────────────┼────────────────────────────┼─────────────────────────────────────┼───────────────────────────┘
                  │                            │                                     │
                  │  MongoDB Operations        │  Calculations                       │
                  ▼                            ▼                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    DATA LAYER                                                                   │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────┐   ┌─────────────────────────────────────────────────────────┐     │
│  │  MongoDB Attendance Collection          │   │  MongoDB User Collection                                │     │
│  │  ┌───────────────────────────────────┐  │   │  ┌─────────────────────────────────────────────────┐    │     │
│  │  │  - _id                            │  │   │  │  - _id                                        │    │     │
│  │  │  - user (ObjectId)                │  │   │  │  - firstName                                  │    │     │
│  │  │  - date (Date)                    │  │   │  │  - lastName                                   │    │     │
│  │  │  - checkIn (Date)                 │  │   │  │  - role                                       │    │     │
│  │  │  - checkOut (Date)                │  │   │  │  - superior                                   │    │     │
│  │  │  - totalHours (Number)            │  │   │  │  - team (Array)                               │    │     │
│  │  │  - status: present|absent|late    │  │   │  │                                               │    │     │
│  │  │  - notes (String)                 │  │   │  └─────────────────────────────────────────────────┘    │     │
│  │  │  - approvedBy (ObjectId)          │  │   │                                                         │     │
│  │  └───────────────────────────────────┘  │   │                                                         │     │
│  └─────────────────────────────────────────┘   └─────────────────────────────────────────────────────────┘     │
│                                                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  Automatic Calculations (on checkOut)                                                                   │   │
│  │  ┌───────────────────────┐  ┌───────────────────────┐  ┌───────────────────────┐  ┌─────────────────┐ │   │
│  │  │  Work Hours           │  │  Overtime             │  │  Late Arrival         │  │  Streak         │ │   │
│  │  │  checkOut - checkIn   │  │  totalHours > 8       │  │  checkIn > 9:00 AM    │  │  Consecutive    │ │   │
│  │  │  Rounded to 0.5h      │  │  Flagged for review   │  │  Status = 'late'      │  │  Present Days   │ │   │
│  │  └───────────────────────┘  └───────────────────────┘  └───────────────────────┘  └─────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow Summary

1. **Check-In**: User clicks check-in → `POST /api/attendance/checkin` → Controller checks if already checked in today → Creates/updates Attendance document with checkIn timestamp
2. **Check-Out**: User clicks check-out → `POST /api/attendance/checkout` → Controller validates check-in exists → Sets checkOut timestamp → Calculates totalHours automatically
3. **Status Determination**: On check-out, status auto-calculated: 'present' if checkIn before 9:00 AM and totalHours >= 8, 'late' if checkIn after 9:00 AM, 'absent' if no record
4. **Superior Records Attendance**: Superior calls `POST /api/attendance/record` for direct report → Access validated via `canAccessUser` → Creates/updates attendance with manual override
5. **Heatmap Data**: Client requests `GET /api/attendance/heatmap?year=2026&month=3` → Queries Attendance collection for date range → Returns array with date, status, totalHours for each day
6. **Team View**: Superior views team attendance → Queries all users with superior = userId → Aggregates present/absent/late counts
7. **Work Hours Calculation**: totalHours = (checkOut - checkIn) / (1000 * 60 * 60), rounded to nearest 0.5
8. **Overtime Detection**: If totalHours > 8, flagged for potential overtime compensation
9. **Late Detection**: If checkIn hour > 9, status set to 'late' instead of 'present'
10. **Streak Tracking**: Consecutive present days calculated from Attendance collection for gamification
11. **Audit Logging**: All manual attendance changes logged in AuditLog with user, action, resourceId, newValue

---

## 4. Performance Module

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                         CLIENT LAYER                                                            │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐                    │
│  │   /performance Page                                                                     │                    │
│  │   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────────────────┐│                    │
│  │   │  Score Cards    │  │  Trend Charts   │  │  Pulse Score Input                      ││                    │
│  │   │  Current Score  │  │  (Recharts)     │  │  - Weekly Score Slider                  ││                    │
│  │   │  Trend Arrow    │  │  - Weekly       │  │  - Notes Text Area                      ││                    │
│  │   │  Breakdown      │  │  - 30 Day       │  │  - Submit Button                        ││                    │
│  │   └─────────────────┘  └─────────────────┘  └─────────────────────────────────────────┘│                    │
│  └────────────────────────────────────────┬────────────────────────────────────────────────┘                    │
└───────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────┘
                                            │
                                            │  REST API
                                            │  GET  /api/performance/:userId
                                            │  POST /api/performance/pulse
                                            │  GET  /api/performance/trends?userId=&days=30
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                         API LAYER (Express.js)                                                  │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                              performanceController.js                                                   │   │
│  │  ┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────────────────────┐ │   │
│  │  │   Read Operations       │  │   Pulse Update          │  │   Trend Analysis                        │ │   │
│  │  │   - getPerformance      │  │   - updatePulse         │  │   - getTrends                           │ │   │
│  │  │   - Access Control      │  │   - Weekly Scores       │  │   - Score History                       │ │   │
│  │  └───────────┬─────────────┘  └───────────┬─────────────┘  └───────────────────┬─────────────────────┘ │   │
│  └──────────────┼────────────────────────────┼─────────────────────────────────────┼──────────────────────┘   │
└─────────────────┼────────────────────────────┼─────────────────────────────────────┼───────────────────────────┘
                  │                            │                                     │
                  │  MongoDB Queries           │  BullMQ Job                         │
                  │                            │                                     │
                  ▼                            ▼                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    WORKER LAYER                                                                 │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                           performanceScorer.js (BullMQ Worker)                                          │   │
│  │                                    Queue: performance-scoring                                           │   │
│  │  ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐   │   │
│  │  │  calculatePerformanceScore(userId)                                                              │   │   │
│  │  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐│   │   │
│  │  │  │  Task Metrics    │  │  Attendance      │  │  Meeting         │  │  Weighted Score          ││   │   │
│  │  │  │                  │  │  Metrics         │  │  Contribution    │  │                        ││   │   │
│  │  │  │  - Completion    │  │  - Avg Hours     │  │  - Avg Score     │  │  40% Task Completion   ││   │   │
│  │  │  │  - Deadline      │  │  - Attendance    │  │  - Participation │  │  30% Deadline Adherence││   │   │
│  │  │  │    Adherence     │  │    Rate          │  │                  │  │  20% Meeting Contrib   ││   │   │
│  │  │  │                  │  │                  │  │                  │  │  10% Working Hours     ││   │   │
│  │  │  └──────────────────┘  └──────────────────┘  └──────────────────┘  │                        ││   │   │
│  │  └───────────────────────────────────────────────────────────────────┼──────────────────────────┘│   │   │
│  │                                                                      │                             │   │
│  │  ┌───────────────────────────────────────────────────────────────────┼──────────────────────────┐ │   │
│  │  │                    Resignation Predictor (AI)                     │                          │ │   │
│  │  │  ┌─────────────────────────────────────────────────────────────┐  │                          │ │   │
│  │  │  │  Groq Llama3-70B Analysis                                   │  │                          │ │   │
│  │  │  │  - Analyzes declining trends                                │  │                          │ │   │
│  │  │  │  - Consecutive neutral/declining days                       │  │                          │ │   │
│  │  │  │  - Pulse score patterns                                     │  │                          │ │   │
│  │  │  │  - Task completion decline                                  │  │                          │ │   │
│  │  │  └─────────────────────────────────────────────────────────────┘  │                          │ │   │
│  │  └───────────────────────────────────────────────────────────────────┴──────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                    │                                     │
                                    │  Read Source Data                   │  External AI
                                    ▼                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    DATA LAYER                                                                   │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌──────────┐ │
│  │  MongoDB        │     │  MongoDB        │     │  MongoDB        │     │  MongoDB        │     │  Groq    │ │
│  │  Performance    │     │  Task           │     │  Attendance     │     │  Meeting        │     │  API     │ │
│  │  Collection:    │     │  Collection:    │     │  Collection:    │     │  Collection:    │     │          │ │
│  │  - user         │     │  - assignee     │     │  - user         │     │  - attendees    │     │  Llama3  │ │
│  │  - currentScore │     │  - status       │     │  - checkIn      │     │  - contribution │     │  -70B    │ │
│  │  - trend        │     │  - dueDate      │     │  - checkOut     │     │    Score        │     │          │ │
│  │  - weeklyScores │     │  - createdAt    │     │  - totalHours   │     │  - status       │     │  AI      │ │
│  │  - taskStats    │     │                 │     │  - status       │     │    = 'ready'    │     │  Insights│ │
│  │  - attendance   │     │                 │     │                 │     │                 │     │          │ │
│  │    Stats        │     │                 │     │                 │     │                 │     │          │ │
│  │  - pulseScores  │     │                 │     │                 │     │                 │     │          │ │
│  │  - lastCalc     │     │                 │     │                 │     │                 │     │          │ │
│  └─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘     └──────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow Summary

1. **Performance Fetch**: Client calls `GET /api/performance/:userId` → Controller validates access → Fetches Performance document → Populates with recent Tasks, Meetings, Attendance (last 30 days)
2. **Pulse Score Submission**: User submits weekly pulse score → `POST /api/performance/pulse` with score, notes, week → Controller adds/updates entry in weeklyScores array → Keeps only last 12 weeks
3. **Trend Analysis**: Client requests `GET /api/performance/trends?days=30` → Returns array of weekly score objects with date, score, taskCompletion, deadlineAdherence, meetingContribution, workingHours
4. **Worker Score Calculation**: BullMQ job triggered → `calculatePerformanceScore(userId)` fetches Tasks (last 7 days) → Calculates completion rate (done/total) and deadline adherence (on-time/total)
5. **Attendance Metrics**: Worker fetches Attendance (last 7 days) → Calculates average hours per day → Normalizes to 0-1 scale (8 hours = 1.0)
6. **Meeting Contribution**: Worker fetches Meetings marked 'ready' → Extracts user's contributionScore from each → Calculates average → Normalizes to 0-1 (score/10)
7. **Weighted Score**: Final score = (taskCompletion × 0.40) + (deadlineAdherence × 0.30) + (meetingContribution × 0.20) + (workingHours × 0.10) × 100
8. **Trend Calculation**: Compare current week score to previous 4 weeks → Set trend: 'improving' (upward slope), 'declining' (downward), 'stable' (flat), 'neutral' (insufficient data)
9. **Resignation Prediction**: AI analyzes score trends, consecutive declining days, pulse score patterns → Returns risk level (low/medium/high) with reasoning
10. **ChromaDB Embedding**: Performance summary generated → Embedding created → Stored in employee_performance collection for similarity queries
11. **Stats Update**: taskStats and attendanceStats updated in Performance document → lastCalculatedAt timestamp set

---

## 5. Sprint Module

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                         CLIENT LAYER                                                            │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐                    │
│  │   /sprints Page                                                                         │                    │
│  │   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────────────────┐│                    │
│  │   │  Sprint Kanban  │  │  Velocity Chart │  │  Retrospective Form                     ││                    │
│  │   │  - Drag & Drop  │  │  (Recharts)     │  │  - What Went Well                       ││                    │
│  │   │  - Task Cards   │  │  - Burndown     │  │  - What to Improve                      ││                    │
│  │   │  - Story Points │  │                 │  │  - Action Items                         ││                    │
│  │   └─────────────────┘  └─────────────────┘  └─────────────────────────────────────────┘│                    │
│  └────────────────────────────────────────┬────────────────────────────────────────────────┘                    │
└───────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────┘
                                            │
                                            │  REST API
                                            │  GET  /api/sprints?status=&team=
                                            │  GET  /api/sprints/:id
                                            │  POST /api/sprints
                                            │  PUT  /api/sprints/:id
                                            │  POST /api/sprints/:id/complete
                                            │  DELETE /api/sprints/:id
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                         API LAYER (Express.js)                                                  │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                              sprintController.js                                                        │   │
│  │  ┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────────────────────┐ │   │
│  │  │   CRUD Operations       │  │   Sprint Completion     │  │   Access Control                        │ │   │
│  │  │   - getSprints          │  │   - completeSprint      │  │   - Team-based filtering                │ │   │
│  │  │   - getSprint           │  │   - Velocity Calc       │  │   - Creator/Admin only update           │ │   │
│  │  │   - createSprint        │  │   - Retro Storage       │  │   - Superior team access                │ │   │
│  │  │   - updateSprint        │  │   - Task Auto-Update    │  │                                         │ │   │
│  │  │   - deleteSprint        │  │   - Audit Logging       │  │                                         │ │   │
│  │  └───────────┬─────────────┘  └───────────┬─────────────┘  └─────────────────────────────────────────┘ │   │
│  └──────────────┼────────────────────────────┼────────────────────────────────────────────────────────────┘   │
└─────────────────┼────────────────────────────┼─────────────────────────────────────────────────────────────────┘
                  │                            │
                  │  MongoDB Operations        │  Task Updates
                  │                            │
                  ▼                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    DATA LAYER                                                                   │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────┐   ┌─────────────────────────────────────────────────────────┐     │
│  │  MongoDB Sprint Collection              │   │  MongoDB Task Collection                                │     │
│  │  ┌───────────────────────────────────┐  │   │  ┌─────────────────────────────────────────────────┐    │     │
│  │  │  - _id                            │  │   │  │  - _id                                        │    │     │
│  │  │  - name                           │  │   │  │  - title                                      │    │     │
│  │  │  - goal                           │  │   │  │  - status: todo|inprogress|review|done        │    │     │
│  │  │  - team (ObjectId)                │  │   │  │  - sprint (ObjectId) → UNSET on delete        │    │     │
│  │  │  - startDate                      │  │   │  │  - assignee                                   │    │     │
│  │  │  - endDate                        │  │   │  │  - priority                                   │    │     │
│  │  │  - status: active|completed       │  │   │  │                                               │    │     │
│  │  │  - totalStoryPoints               │  │   │  └─────────────────────────────────────────────────┘    │     │
│  │  │  - completedStoryPoints           │  │   │                                                         │     │
│  │  │  - velocity                       │  │   │                                                         │     │
│  │  │  - retrospectiveNotes             │  │   │                                                         │     │
│  │  │  - createdBy                      │  │   │                                                         │     │
│  │  └───────────────────────────────────┘  │   │                                                         │     │
│  └─────────────────────────────────────────┘   └─────────────────────────────────────────────────────────┘     │
│                                                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  Sprint Completion Processing                                                                           │   │
│  │  ┌───────────────────────┐  ┌───────────────────────┐  ┌───────────────────────┐  ┌─────────────────┐ │   │
│  │  │  Completed Tasks      │  │  Velocity             │  │  Retrospective        │  │  Task Status    │ │   │
│  │  │  Filter tasks where   │  │  Sum of story points  │  │  Notes stored for     │  │  Auto-transition│ │   │
│  │  │  status = 'done'      │  │  from done tasks      │  │  future reference     │  │  Incomplete     │ │   │
│  │  │                       │  │                       │  │                       │  │  tasks remain   │ │   │
│  │  └───────────────────────┘  └───────────────────────┘  └───────────────────────┘  └─────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow Summary

1. **Sprint Creation**: User creates sprint via `POST /api/sprints` → Controller validates team access → Creates Sprint document with name, goal, startDate, endDate, totalStoryPoints → AuditLog created
2. **Sprint Listing**: Client fetches sprints via `GET /api/sprints?status=active&team=xxx` → Non-admin users see only their managed teams → Results populated with team and createdBy user details
3. **Sprint Details**: `GET /api/sprints/:id` → Fetches sprint → Queries all Tasks in sprint → Calculates completionRate (completedTasks/totalTasks) → Returns with stats
4. **Sprint Update**: Creator or admin calls `PUT /api/sprints/:id` → Validates access → Updates sprint fields → AuditLog with oldValue/newValue
5. **Sprint Completion**: User calls `POST /api/sprints/:id/complete` with retrospectiveNotes → Controller queries all tasks with status='done' → Sums storyPoints → Sets sprint.completedStoryPoints and velocity
6. **Velocity Calculation**: velocity = sum of storyPoints from completed tasks → Used for future sprint planning
7. **Retrospective Storage**: retrospectiveNotes saved to Sprint document → Accessible for future retrospectives
8. **Task Auto-Update**: Incomplete tasks (status != 'done') remain in sprint → Can be moved to next sprint manually
9. **Sprint Deletion**: `DELETE /api/sprints/:id` → Creator/admin only → Unsets sprint reference from all associated tasks → Deletes Sprint document
10. **Access Control**: Non-admin users see sprints for teams they manage (superior relationship) + their own sprints
11. **Burndown Data**: Frontend calculates burndown from task completion dates and story points

---

## 6. Task Module

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                         CLIENT LAYER                                                            │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐                    │
│  │   /tasks Page                                                                           │                    │
│  │   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────────────────┐│                    │
│  │   │  Task List/     │  │  Task Detail    │  │  Task Stats Dashboard                   ││                    │
│  │   │  Board View     │  │  Modal          │  │  - Completion Rate                      ││                    │
│  │   │  - Drag & Drop  │  │  - Comments     │  │  - Overdue Count                        ││                    │
│  │   │  - Priority     │  │  - Time Track   │  │  - Workload Distribution                ││                    │
│  │   │    Indicators   │  │  - Assignee     │  │                                         ││                    │
│  │   └─────────────────┘  └─────────────────┘  └─────────────────────────────────────────┘│                    │
│  └────────────────────────────────────────┬────────────────────────────────────────────────┘                    │
└───────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────┘
                                            │
                                            │  REST API
                                            │  GET  /api/tasks?status=&assignee=&sprint=&priority=&search=
                                            │  GET  /api/tasks/:id
                                            │  POST /api/tasks
                                            │  PUT  /api/tasks/:id
                                            │  DELETE /api/tasks/:id
                                            │  POST /api/tasks/:id/comment
                                            │  GET  /api/tasks/stats?userId=
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                         API LAYER (Express.js)                                                  │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                              taskController.js                                                          │   │
│  │  ┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────────────────────┐ │   │
│  │  │   CRUD Operations       │  │   Comments              │  │   Statistics                            │ │   │
│  │  │   - getTasks            │  │   - addComment          │  │   - getTaskStats                        │ │   │
│  │  │   - getTask             │  │   - Author Populate     │  │   - By Status                           │ │   │
│  │  │   - createTask          │  │                         │  │   - By Priority                         │ │   │
│  │  │   - updateTask          │  │                         │  │                                         │ │   │
│  │  │   - deleteTask          │  │                         │  │                                         │ │   │
│  │  └───────────┬─────────────┘  └───────────┬─────────────┘  └───────────────────┬─────────────────────┘ │   │
│  └──────────────┼────────────────────────────┼─────────────────────────────────────┼──────────────────────┘   │
└─────────────────┼────────────────────────────┼─────────────────────────────────────┼───────────────────────────┘
                  │                            │                                     │
                  │  MongoDB Operations        │  Notifications                      │  Performance Trigger
                  │                            │                                     │
                  ▼                            ▼                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    DATA LAYER                                                                   │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────┐   ┌─────────────────────────────────────────────────────────┐     │
│  │  MongoDB Task Collection                │   │  MongoDB User Collection                                │     │
│  │  ┌───────────────────────────────────┐  │   │  ┌─────────────────────────────────────────────────┐    │     │
│  │  │  - _id                            │  │   │  │  - _id                                        │    │     │
│  │  │  - title                          │  │   │  │  - firstName                                  │    │     │
│  │  │  - description                    │  │   │  │  - lastName                                   │    │     │
│  │  │  - assignee (ObjectId)            │  │   │  │  - email                                      │    │     │
│  │  │  - reporter (ObjectId)            │  │   │  │  - avatar                                     │    │     │
│  │  │  - sprint (ObjectId)              │  │   │  │                                               │    │     │
│  │  │  - status: todo|inprogress|       │  │   │  └─────────────────────────────────────────────────┘    │     │
│  │  │           review|done             │  │   │                                                         │     │
│  │  │  - priority: low|medium|high|     │  │   │                                                         │     │
│  │  │            urgent                 │  │   │                                                         │     │
│  │  │  - type: bug|feature|task|        │  │   │                                                         │     │
│  │  │        epic                       │  │   │                                                         │     │
│  │  │  - estimatedHours                 │  │   │                                                         │     │
│  │  │  - actualHours                    │  │   │                                                         │     │
│  │  │  - dueDate                        │  │   │                                                         │     │
│  │  │  - storyPoints                    │  │   │                                                         │     │
│  │  │  - labels: [String]               │  │   │                                                         │     │
│  │  │  - comments: [{                   │  │   │                                                         │     │
│  │  │      author, text, createdAt      │  │   │                                                         │     │
│  │  │    }]                             │  │   │                                                         │     │
│  │  │  - meetingSource (ObjectId)       │  │   │                                                         │     │
│  │  └───────────────────────────────────┘  │   │                                                         │     │
│  └─────────────────────────────────────────┘   └─────────────────────────────────────────────────────────┘     │
│                                                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  Task Processing & Triggers                                                                             │   │
│  │  ┌───────────────────────┐  ┌───────────────────────┐  ┌───────────────────────┐  ┌─────────────────┐ │   │
│  │  │  Task Completion      │  │  Notification         │  │  Overdue Detection    │  │  Performance    │ │   │
│  │  │  status = 'done'      │  │  Triggered on         │  │  dueDate < now &&     │  │  Recalculation  │ │   │
│  │  │  → Notify reporter    │  │  assignee change      │  │  status != 'done'     │  │  On task        │ │   │
│  │  │                       │  │                       │  │                       │  │  completion     │ │   │
│  │  └───────────────────────┘  └───────────────────────┘  └───────────────────────┘  └─────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                  │
                  │  Meeting Integration
                  ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐                                            │
│  │  MongoDB        │     │  MongoDB        │     │  Processing     │                                            │
│  │  Sprint         │     │  Meeting        │     │  Calculations   │                                            │
│  │  Collection:    │     │  Collection:    │     │                 │                                            │
│  │  - Tasks linked │     │  - actionItems  │     │  - Completion   │                                            │
│  │    via sprint   │     │    → Tasks      │     │    Rate         │                                            │
│  │    field        │     │  - transcript   │     │  - Overdue      │                                            │
│  │                 │     │    Segments     │     │    Count        │                                            │
│  │                 │     │                 │     │  - Workload     │                                            │
│  │                 │     │                 │     │    Distribution │                                            │
│  └─────────────────┘     └─────────────────┘     └─────────────────┘                                            │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow Summary

1. **Task Fetch**: Client calls `GET /api/tasks` with filters → Admin sees all tasks, others see assigned/reported tasks → Populates assignee, reporter, sprint fields
2. **Task Creation**: `POST /api/tasks` with title, description, assignee, sprint, priority → Controller validates assignee access → Creates Task → Notification sent to assignee if different from reporter
3. **Task Update**: Assignee, reporter, or admin calls `PUT /api/tasks/:id` → Updates status, priority, etc. → If status changes to 'done', notification sent to reporter
4. **Task Deletion**: Reporter or admin calls `DELETE /api/tasks/:id` → Removes Task document → AuditLog created
5. **Comment Addition**: `POST /api/tasks/:id/comment` with text → Adds comment object to task.comments array → Author populated with user details
6. **Task Stats**: `GET /api/tasks/stats?userId=xxx` → Aggregates tasks by status (todo/inprogress/review/done) → Aggregates by priority (low/medium/high/urgent)
7. **Overdue Detection**: Tasks where dueDate < now AND status != 'done' flagged as overdue → Count displayed in stats
8. **Completion Rate**: Calculated as doneTasks / totalTasks for assignee → Used in performance scoring
9. **Workload Distribution**: Analysis of tasks per assignee → Identifies imbalanced workload across team
10. **Meeting Integration**: Tasks can originate from meeting actionItems → meetingSource field links to Meeting → Action items converted to tasks during meeting analysis
11. **Performance Trigger**: When task completed (status = 'done'), Performance worker recalculates user's score → Updates taskStats in Performance document
12. **Sprint Association**: Tasks linked to Sprint via sprint field → On sprint deletion, sprint field unset (not deleted)

---

## 7. User Module

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                         CLIENT LAYER                                                            │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐       │
│  │  Profile Page   │  │  Org Chart      │  │  Team View      │  │  Onboarding     │  │  Settings       │       │
│  │  - User Info    │  │  (React Flow)   │  │  - Direct       │  │  Wizard         │  │  - Dark Mode    │       │
│  │  - Performance  │  │  - Hierarchy    │  │    Reports      │  │  - Timezone     │  │  - Language     │       │
│  │    Stats        │  │  - Roles        │  │  - Superior     │  │  - Preferences  │  │  - Notifications│       │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘       │
└───────────┼────────────────────┼────────────────────┼────────────────────┼────────────────────┼─────────────────┘
            │                    │                    │                    │                    │
            │                    │  REST API          │                    │                    │
            │                    │  GET  /api/users   │                    │                    │
            │                    │  GET  /api/users/:id                    │                    │
            │                    │  PUT  /api/users/:id                    │                    │
            │                    │  DELETE /api/users/:id                  │                    │
            │                    │  GET  /api/users/org-chart              │                    │
            │                    │  GET  /api/users/:id/team               │                    │
            │                    │  PUT  /api/users/settings               │                    │
            │                    │                    │                    │                    │
            ▼                    ▼                    ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                         API LAYER (Express.js)                                                  │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                              userController.js                                                          │   │
│  │  ┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────────────────────┐ │   │
│  │  │   User CRUD             │  │   Org Structure         │  │   Settings                              │ │   │
│  │  │   - getUsers            │  │   - getOrgChart         │  │   - updateSettings                      │ │   │
│  │  │   - getUser             │  │   - getTeam             │  │   - Dark Mode                           │ │   │
│  │  │   - updateUser          │  │   - Hierarchy Traversal │  │   - Timezone                            │ │   │
│  │  │   - deleteUser          │  │                         │  │   - Language                            │ │   │
│  │  └───────────┬─────────────┘  └───────────┬─────────────┘  └───────────────────┬─────────────────────┘ │   │
│  └──────────────┼────────────────────────────┼─────────────────────────────────────┼──────────────────────┘   │
└─────────────────┼────────────────────────────┼─────────────────────────────────────┼───────────────────────────┘
                  │                            │                                     │
                  │  Auth Routes               │  Org Hierarchy                      │
                  │  /api/auth                 │                                     │
                  ▼                            ▼                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              AUTH CONTROLLER                                                                    │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌─────────────────────┐  │   │
│  │  │  POST /login  │  │  POST /refresh│  │  POST /logout │  │  POST /forgot │  │  POST /reset/:token │  │   │
│  │  │               │  │               │  │               │  │  -password     │  │                     │  │   │
│  │  │  JWT Access   │  │  Refresh Token│  │  Clear Cookie │  │  - Generate   │  │  - Validate Token   │  │   │
│  │  │  + Refresh    │  │  Rotation     │  │  Blacklist    │  │    Reset Token│  │  - Update Password  │  │   │
│  │  │  Tokens       │  │               │  │               │  │  - Resend API │  │  - Invalidate       │  │   │
│  │  └───────────────┘  └───────────────┘  └───────────────┘  └───────────────┘  │    Sessions           │  │   │
│  │                                                                          └─────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                    │                                     │
                                    │  MongoDB User                       │  External Email
                                    │  Operations                         │
                                    ▼                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    DATA LAYER                                                                   │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  MongoDB User Collection                                                                                │   │
│  │  ┌───────────────────────────────────────────────────────────────────────────────────────────────────┐  │   │
│  │  │  - _id                                                                                            │  │   │
│  │  │  - email (unique, indexed)                                                                        │  │   │
│  │  │  - password (bcrypt hash)                                                                         │  │   │
│  │  │  - firstName, lastName                                                                            │  │   │
│  │  │  - role: intern|junior|mid|senior|lead|manager|director|vp|c_level                                │  │   │
│  │  │  - roleLevel: 1-9                                                                                 │  │   │
│  │  │  - superior (ObjectId → User)                                                                     │  │   │
│  │  │  - team: [ObjectId → User]                                                                        │  │   │
│  │  │  - department: String                                                                             │  │   │
│  │  │  - phone: String                                                                                  │  │   │
│  │  │  - avatar: String (URL)                                                                           │  │   │
│  │  │  - isActive: Boolean                                                                              │  │   │
│  │  │  - isFirstLogin: Boolean                                                                          │  │   │
│  │  │  - darkMode: Boolean                                                                              │  │   │
│  │  │  - timezone: String                                                                               │  │   │
│  │  │  - language: String                                                                               │  │   │
│  │  │  - failedLoginAttempts: Number                                                                    │  │   │
│  │  │  - lastLogin: Date                                                                                │  │   │
│  │  │  - refreshTokenVersion: Number (for session invalidation)                                         │  │   │
│  │  │  - passwordResetToken: UUID                                                                       │  │   │
│  │  │  - passwordResetExpires: Date                                                                     │  │   │
│  │  │  - joinedAt: Date                                                                                 │  │   │
│  │  └───────────────────────────────────────────────────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  Org Hierarchy Processing                                                                               │   │
│  │  ┌───────────────────────┐  ┌───────────────────────┐  ┌───────────────────────┐  ┌─────────────────┐ │   │
│  │  │  getOrgTreeUsers      │  │  canAccessUser        │  │  isValidRoleChange    │  │  Hierarchy      │ │   │
│  │  │  (userId)             │  │  (requester, target)  │  │  (oldRole, newRole)   │  │  Config         │ │   │
│  │  │                       │  │                       │  │                       │  │                 │ │   │
│  │  │  Recursively finds    │  │  Checks if requester  │  │  Validates role       │  │  Role levels    │ │   │
│  │  │  all users in         │  │  can access target    │  │  transitions (e.g.,   │  │  and rules      │ │   │
│  │  │  requester's org      │  │  based on superior    │  │  no skip levels)      │  │                 │ │   │
│  │  │  tree                 │  │  relationship         │  │                       │  │                 │ │   │
│  │  └───────────────────────┘  └───────────────────────┘  └───────────────────────┘  └─────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │  Resend API (Password Reset Emails)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  External Services                                                                                      │   │
│  │  ┌───────────────────────┐                                                                              │   │
│  │  │  Resend API           │                                                                              │   │
│  │  │  - Password Reset     │                                                                              │   │
│  │  │    Emails             │                                                                              │   │
│  │  │  - Welcome Emails     │                                                                              │   │
│  │  └───────────────────────┘                                                                              │   │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow Summary

1. **User Listing**: `GET /api/users?role=&search=` → Admin sees all users, others see only their org tree → Populated with superior and team details
2. **User Details**: `GET /api/users/:id` → Validates access via `canAccessUser` → Returns user with populated superior, team, and Performance stats
3. **User Update**: Self, superior, or admin can update → Role changes require admin → Validates role transitions via `isValidRoleChange` → AuditLog created
4. **User Deletion**: Admin only → Soft delete (sets isActive=false, modifies email) → AuditLog created
5. **Org Chart**: `GET /api/users/org-chart` → Returns flat array formatted for D3.js/React Flow → Each user has id, name, role, level, parentId, avatar
6. **Team Members**: `GET /api/users/:id/team` → Returns direct reports (users with superior = userId) and user's superior
7. **Settings Update**: `PUT /api/users/settings` → Updates darkMode, timezone, language, notifications → Returns updated settings
8. **Login**: `POST /api/auth/login` with email, password → Checks lockout → Verifies password → Generates JWT access + refresh tokens → Sets httpOnly cookie → AuditLog created
9. **Token Refresh**: `POST /api/auth/refresh` → Validates refresh token → Checks token version (for revocation) → Issues new access + refresh tokens
10. **Logout**: `POST /api/auth/logout` → Clears refresh token cookie → Optional blacklist in Redis → AuditLog created
11. **Password Reset**: `POST /api/auth/forgot-password` → Generates UUID reset token → Sets 1-hour expiry → Sends email via Resend API → `POST /api/auth/reset/:token` validates and updates password → Invalidates all sessions via refreshTokenVersion increment
12. **Access Control**: `getOrgTreeUsers(userId)` recursively finds all users in org tree → `canAccessUser(requester, target)` checks if requester can access target based on hierarchy

---

## Module Dependency Map

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              OrgOS MODULE DEPENDENCY MAP                                                        │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                                 │
│                                    ┌─────────────────────────┐                                                  │
│                                    │      USER MODULE        │                                                  │
│                                    │  (Authentication & Org) │                                                  │
│                                    └───────────┬─────────────┘                                                  │
│                                                │                                                                │
│                    ┌───────────────────────────┼───────────────────────────┐                                    │
│                    │                           │                           │                                    │
│                    ▼                           ▼                           ▼                                    │
│         ┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐                             │
│         │  ATTENDANCE      │        │  PERFORMANCE     │        │  TASK            │                             │
│         │  MODULE          │        │  MODULE          │        │  MODULE          │                             │
│         │                  │        │                  │        │                  │                             │
│         │  - Check In/Out  │◄───────┤  - Score Calc    │◄───────┤  - CRUD          │                             │
│         │  - Hours Track   │        │  - Trend Analysis│        │  - Comments      │                             │
│         │  - Heatmap       │        │  - Resignation   │        │  - Stats         │                             │
│         └────────┬─────────┘        └────────┬─────────┘        └────────┬─────────┘                             │
│                  │                           │                           │                                      │
│                  │                           │                           │                                      │
│                  └───────────────────────────┼───────────────────────────┘                                      │
│                                              │                                                                    │
│                                              ▼                                                                    │
│                                    ┌──────────────────┐                                                          │
│                                    │  RECOMMENDATION  │                                                          │
│                                    │  MODULE          │                                                          │
│                                    │                  │                                                          │
│                                    │  - LangGraph     │◄────── Uses data from Performance, Task, Attendance      │
│                                    │  - AI Reasoning  │                                                          │
│                                    │  - Risk Assess   │                                                          │
│                                    └────────┬─────────┘                                                          │
│                                             │                                                                     │
│                                             │                                                                     │
│  ┌──────────────────────────────────────────┼──────────────────────────────────────────┐                         │
│  │                                          │                                          │                         │
│  ▼                                          ▼                                          ▼                         │
│  ┌──────────────────┐            ┌──────────────────┐                       ┌──────────────────┐                 │
│  │  MEETING         │            │  SPRINT          │                       │  Shared Data     │                 │
│  │  MODULE          │            │  MODULE          │                       │  Layer           │                 │
│  │                  │            │                  │                       │                  │                 │
│  │  - WebRTC        │            │  - Sprint Plan   │                       │  ┌────────────┐  │                 │
│  │  - Transcription │            │  - Velocity      │                       │  │  MongoDB   │  │                 │
│  │  - AI Analysis   │◄───────────┤  - Retrospective │                       │  │  ChromaDB  │  │                 │
│  │  - Action Items──┼────────────┤  - Burndown      │                       │  │  Redis     │  │                 │
│  │                  │            │                  │                       │  │  AWS S3    │  │                 │
│  └──────────────────┘            └──────────────────┘                       │  └────────────┘  │                 │
│         │                                    │                               └──────────────────┘                 │
│         │                                    │                                        │                            │
│         └────────────────────────────────────┼────────────────────────────────────────┘                            │
│                                              │                                                                     │
│                                              ▼                                                                     │
│                                    ┌──────────────────┐                                                          │
│                                    │  EXTERNAL APIs   │                                                          │
│                                    │                  │                                                          │
│                                    │  - Groq (AI)     │                                                          │
│                                    │  - ChromaDB      │                                                          │
│                                    │  - AWS S3        │                                                          │
│                                    │  - Resend        │                                                          │
│                                    │  - Pyannote      │                                                          │
│                                    └──────────────────┘                                                          │
│                                                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

DEPENDENCY LEGEND:
══════════════════
► USER MODULE: Foundation - All modules depend on User collection for authentication and access control
► ATTENDANCE → PERFORMANCE: Attendance hours used in performance score calculation (10% weight)
► TASK → PERFORMANCE: Task completion and deadline adherence used in performance score (70% combined)
► MEETING → PERFORMANCE: Meeting contribution scores used in performance score (20% weight)
► PERFORMANCE → RECOMMENDATION: LangGraph workflow analyzes performance data to generate recommendations
► TASK → RECOMMENDATION: Task patterns analyzed for skill gap and workload balance recommendations
► ATTENDANCE → RECOMMENDATION: Attendance patterns used for burnout risk assessment
► MEETING → TASK: Action items from meetings automatically become tasks
► SPRINT → TASK: Sprints contain and organize tasks
► MEETING/SPRINT/TASK → Shared Data Layer: All modules read/write to MongoDB, ChromaDB, Redis, S3
```

---

*Generated for OrgOS — AI-Powered Organization Operating System*

---
