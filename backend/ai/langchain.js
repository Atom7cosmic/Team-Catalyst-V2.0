const { ChatGroq } = require('@langchain/groq');
const { ChatPromptTemplate } = require('@langchain/core/prompts');
const { StringOutputParser, JsonOutputParser } = require('@langchain/core/output_parsers');
const { RunnableSequence } = require('@langchain/core/runnables');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()]
});

// Initialize Groq LLM
const llm = new ChatGroq({
  apiKey: process.env.GROQ_API_KEY,
  model: 'llama-3.3-70b-versatile',
  temperature: 0.2,
  maxTokens: 4096
});

// Meeting Analysis Chain
const meetingAnalysisChain = async (transcript, domain, attendees, promptTemplate) => {
  try {
    // Build messages directly — bypass ChatPromptTemplate entirely
    // so transcript content with { } never causes template parsing errors
    const safeTranscript = transcript.substring(0, 15000);
    const attendeeNames = attendees
      .map(a => typeof a === 'string' ? a : `${a.firstName || ''} ${a.lastName || ''}`.trim())
      .join(', ');

    const userMessage = promptTemplate.userPromptTemplate
      .replace('{transcript}', safeTranscript)
      .replace('{attendees}', attendeeNames)
      .replace('{domain}', domain)
      .replace('{date}', new Date().toISOString());

    // Call LLM directly without template parsing
    const response = await llm.invoke([
      ['system', promptTemplate.systemPrompt],
      ['human', userMessage]
    ]);

    const content = response.content;

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    // If no JSON found return safe fallback
    return {
      summary: content.substring(0, 500),
      conclusions: [],
      decisions: [],
      actionItems: [],
      followUpTopics: [],
      attendeeContributions: []
    };
  } catch (error) {
    logger.error(`Error in meeting analysis chain: ${error.message}`);
    return {
      summary: 'Meeting analysis could not be completed automatically.',
      conclusions: [],
      decisions: [],
      actionItems: [],
      followUpTopics: [],
      attendeeContributions: []
    };
  }
};

// RAG Chain for meeting Q&A
const createRAGChain = async () => {
  const prompt = ChatPromptTemplate.fromMessages([
    ['system', `You are a meeting assistant. Answer questions about the meeting using only the context provided.

Rules:
1. Always cite specific parts of the transcript that support your answer
2. If the answer is not in the context, say "I cannot find this information in the meeting transcript"
3. Be concise and direct
4. Use bullet points for multiple items
5. Format speaker names as bold`],
    ['human', `Context from meeting transcript:
{context}

Question: {question}`]
  ]);

  return prompt.pipe(llm).pipe(new StringOutputParser());
};

// Recommendation Reasoning Chain
const recommendationReasoningChain = async (performanceData, category, riskScore) => {
  try {
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', `You are an HR analytics AI. Write a clear, professional explanation for why an employee has been categorized as "${category}".

Guidelines:
- Be objective and data-driven
- Mention specific metrics (score, trend, risk factors)
- If at-risk, explain what factors contributed to the risk assessment
- If promote-worthy, highlight their achievements and trajectory
- Keep it to 2-3 sentences
- Use professional but accessible language`],
      ['human', `Employee Data:
- Current Performance Score: ${performanceData.currentScore}/100
- Performance Trend: ${performanceData.trend}
- Resignation Risk Score: ${riskScore !== null ? (riskScore * 100).toFixed(1) + '%' : 'N/A'}
- Task Completion Rate: ${(performanceData.taskStats?.completionRate || 0) * 100}%
- Consecutive Declining/Neutral Days: ${performanceData.consecutiveNeutralOrDecliningDays || 0}
- Meeting Contribution Average: ${(performanceData.meetingStats?.avgContributionScore || 0).toFixed(1)}/10
- Attendance Rate: ${(performanceData.attendanceStats?.attendanceRate || 0) * 100}%

Please write the reasoning for this categorization.`]
    ]);

    const chain = prompt.pipe(llm).pipe(new StringOutputParser());

    return await chain.invoke({});
  } catch (error) {
    logger.error(`Error in recommendation reasoning chain: ${error.message}`);
    return `Employee has been categorized as "${category}" based on performance metrics and trend analysis.`;
  }
};

// Transcript Summarization Chain
const summarizeTranscriptChain = async (transcript, maxLength = 1500) => {
  try {
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', `Summarize the following meeting transcript in ${maxLength} words or less.

Include:
1. Main topics discussed
2. Key decisions made
3. Action items (who does what)
4. Any blockers or concerns raised

Be concise and professional.`],
      ['human', '{transcript}']
    ]);

    const chain = prompt.pipe(llm).pipe(new StringOutputParser());

    return await chain.invoke({
      transcript: transcript
        .substring(0, 10000)
        .replace(/\{/g, '{{')
        .replace(/\}/g, '}}')
    });
  } catch (error) {
    logger.error(`Error in transcript summarization: ${error.message}`);
    return 'Unable to generate summary.';
  }
};

// Attendee Contribution Scoring Chain
const scoreAttendeeChain = async (attendeeName, transcript, domain) => {
  try {
    const safeTranscript = transcript.substring(0, 8000);

    const userMessage = `Meeting Domain: ${domain}

Attendee: ${attendeeName}

Transcript:
${safeTranscript}`;

    const response = await llm.invoke([
      ['system', `Score the attendee's participation in this meeting on a scale of 0-10 using this exact rubric:

0-2: Attendee was present but said nothing of substance. No questions, no contributions, no decisions influenced.
3-4: Minimal participation. Responded when directly addressed but did not proactively contribute.
5-6: Moderate participation. Asked relevant questions or provided input on at least 2 topics. Did not drive any decisions.
7-8: Active participation. Contributed meaningfully to 3+ topics, raised important points, influenced at least 1 decision or action item assignment.
9-10: Led the meeting or was central to its outcome. Drove decisions, synthesized others' input, assigned action items, resolved conflicts or ambiguity.

Rules:
- Weight speaking time at 30% and content quality at 70%
- Do not reward talking for the sake of talking
- Content quality is assessed by: questions asked, insights provided, decisions influenced, action items owned voluntarily, blockers identified

Return ONLY a JSON object with these fields: score (number 0-10), keyPoints (array of strings), reasoning (string).`],
      ['human', userMessage]
    ]);

    const content = response.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    return { score: 5, keyPoints: [], reasoning: 'Unable to analyze contribution.' };
  } catch (error) {
    logger.error(`Error in attendee scoring: ${error.message}`);
    return { score: 5, keyPoints: [], reasoning: 'Unable to analyze contribution.' };
  }
};

// Chunking function for long transcripts
function chunkTranscript(text, maxTokens = 300) {
  const maxChars = maxTokens * 4;
  const chunks = [];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

  let currentChunk = '';
  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > maxChars) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        chunks.push(sentence.substring(0, maxChars));
        currentChunk = sentence.substring(maxChars);
      }
    } else {
      currentChunk += sentence;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

module.exports = {
  llm,
  meetingAnalysisChain,
  createRAGChain,
  recommendationReasoningChain,
  summarizeTranscriptChain,
  scoreAttendeeChain,
  chunkTranscript
};