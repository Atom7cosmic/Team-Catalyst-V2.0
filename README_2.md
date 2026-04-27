# OrgOS (OrgYX) - Team Catalyst V2.0 🚀

An AI-powered enterprise workforce management platform with real-time meeting transcription, WebRTC video conferencing, performance analytics, and intelligent HR recommendations. **V2.0 introduces advanced Conversational RAG pipelines and highly-optimized vector search capabilities.**

---

## 🌟 What's New in V2.0

### 1. Conversational RAG Intelligence
We have completely overhauled the Q/A pipeline. The meeting AI is no longer just a static document searcher; it is a conversational assistant that understands context and intent:
- **Greeting Awareness**: Say "Hello", and the AI responds naturally ("Hello! What's your question about the meeting?").
- **Off-Topic Detection**: If a user asks a question completely unrelated to the meeting context, the AI gracefully acknowledges that it does not have that information, preventing LLM hallucinations.
- **Strict Guardrails**: The LangChain prompts have been explicitly instructed to prevent raw transcript dumps and enforce concise, synthesized, and readable answers.

### 2. Advanced ChromaDB HNSW Indexing
Vector searches are now exponentially faster and more accurate thanks to explicit **Hierarchical Navigable Small World (HNSW)** property configurations in our ChromaDB setup:
- `"hnsw:space": "cosine"` for superior semantic similarity matching.
- Explicit configurations for `hnsw:construction_ef` and `hnsw:search_ef` to perfectly balance index build time and query speed.

### 3. Hybrid RAG Architecture (Ready)
The architecture now natively supports both:
- **Local Context Q/A**: Filtering vector searches strictly by `meetingId` for highly accurate, meeting-specific answers.
- **Global Context Q/A (Company Brain)**: The foundation is set to search across *all* meetings a user has attended, synthesizing historical knowledge across the entire lifecycle of a project.

---

## 🛠️ Tech Stack

### Frontend
- **Next.js 14** (App Router, React 18)
- **Tailwind CSS** + Radix UI
- **Zustand** (State management)
- **Socket.io Client** (WebRTC signaling)
- **Simple-Peer** (WebRTC P2P connections)

### Backend
- **Node.js / Express.js**
- **MongoDB / Mongoose** (Data storage and Prompt Templates)
- **Redis & BullMQ** (Job queuing for heavy AI processing)
- **AWS S3** (Audio storage)

### AI / ML Architecture
- **Groq API** (Llama3-70B for inference, Whisper for transcription)
- **LangChain.js** (RAG Orchestration & Prompt chaining)
- **ChromaDB** (Vector Database with HNSW indexing)
- **@xenova/transformers** (Local embeddings - all-MiniLM-L6-v2)
- **Pyannote.audio** (Speaker diarization via Python FastAPI service)

---

## 🧠 How The AI Pipeline Works

1. **Meeting Recording**: WebRTC captures participant audio and sends it to the server in 10-second chunks.
2. **Transcription & Diarization**: Groq's Whisper API creates highly accurate text (even supporting Hinglish). Pyannote maps the text to specific speakers.
3. **Template Retrieval**: The worker queries MongoDB (`PromptTemplate`) to find the specific system prompt for the meeting's domain (e.g., "Sprint Planning", "Architecture Discussion").
4. **LLM Analysis**: LangChain injects the transcript into the retrieved template and asks LLaMa3 to generate Summaries, Action Items, and Contribution Scores.
5. **Vector Indexing**: The transcript is chunked, embedded, and stored in ChromaDB for future Q/A querying.

---

## 🚀 Running Locally

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- Groq API Key

### Start Services (Recommended)
```bash
# Clone the repository
git clone <repo>
cd orgos

# Start Frontend, Backend, Redis, and ChromaDB
docker-compose up -d

# Seed the database
cd backend
npm install
npm run seed

# Start the background AI worker
npm run worker
```

### Environment Variables (.env)
```env
MONGODB_URI=mongodb://localhost:27017/orgos
JWT_SECRET=your-secure-secret
GROQ_API_KEY=gsk_yourkey
REDIS_URL=redis://localhost:6379
CHROMA_HOST=localhost
CHROMA_PORT=8000
```

---

## 🛡️ Security & Privacy
- **Strict Data Isolation**: RAG Q/A endpoints strictly enforce authorization. A user can only query vectors for meetings they were invited to.
- **Robust Role Hierarchy**: Granular access control based on organizational charts (CEO → CTO → VP → EM).
- **Graceful Degradation**: If ChromaDB or the AI endpoints fail, the system falls back gracefully without crashing the core WebRTC video capabilities.
