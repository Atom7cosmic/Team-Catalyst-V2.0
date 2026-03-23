'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, MessageSquare, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import api from '@/lib/axios';
import ReactMarkdown from 'react-markdown';
import toast from 'react-hot-toast';

export default function MeetingQAPanel({ meetingId, meetingName }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading || isStreaming) return;

    const question = input.trim();
    setInput('');
    setIsLoading(true);

    // Add user message
    setMessages(prev => [...prev, { type: 'user', content: question }]);

    try {
      setIsStreaming(true);

      // Add placeholder for assistant response
      setMessages(prev => [...prev, { type: 'assistant', content: '', sources: [] }]);

      const response = await api.post(`/meetings/${meetingId}/qa`, { question });

      // Update the last message with the response
      setMessages(prev => {
        const newMessages = [...prev];
        const lastMessage = newMessages[newMessages.length - 1];
        if (lastMessage.type === 'assistant') {
          lastMessage.content = response.data.answer;
          lastMessage.sources = response.data.sources || [];
        }
        return newMessages;
      });
    } catch (error) {
      toast.error('Failed to get answer. Please try again.');
      // Remove the assistant placeholder on error
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
    }
  };

  return (
    <Card className="bg-card border-muted h-full flex flex-col">
      <CardHeader className="border-b border-muted shrink-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="h-5 w-5 text-blue-400" />
          Ask about this meeting
          <Badge variant="secondary" className="ml-auto bg-muted text-muted-foreground">
            RAG Powered
          </Badge>
        </CardTitle>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col p-0 min-h-0">
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <MessageSquare className="h-12 w-12 text-slate-600 mb-4" />
            <p className="text-muted-foreground mb-2">Ask questions about the meeting</p>
            <p className="text-sm text-slate-500">
              Try: "What were the key decisions?" or "What action items were assigned?"
            </p>
          </div>
        ) : (
          <ScrollArea className="flex-1 p-4" ref={scrollRef}>
            <div className="space-y-4">
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={cn(
                    'flex gap-3',
                    message.type === 'user' ? 'flex-row-reverse' : 'flex-row'
                  )}
                >
                  <div
                    className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-medium',
                      message.type === 'user'
                        ? 'bg-blue-500 text-white'
                        : 'bg-purple-500 text-white'
                    )}
                  >
                    {message.type === 'user' ? 'You' : 'AI'}
                  </div>
                  <div
                    className={cn(
                      'max-w-[80%] rounded-lg px-4 py-2',
                      message.type === 'user'
                        ? 'bg-blue-500/20 text-slate-100'
                        : 'bg-muted text-foreground'
                    )}
                  >
                    {message.type === 'assistant' ? (
                      <ReactMarkdown
                        className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-strong:text-white prose-ul:my-1 prose-li:my-0"
                      >
                        {message.content}
                      </ReactMarkdown>
                    ) : (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    )}

                    {message.sources?.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-700/50">
                        <p className="text-xs text-slate-500 mb-2">Sources:</p>
                        <div className="flex flex-wrap gap-2">
                          {message.sources.map((source, i) => {
                            const label = typeof source === 'string'
                              ? source
                              : source?.metadata?.chunkIndex !== undefined
                                ? `Chunk ${source.metadata.chunkIndex + 1}`
                                : `Source ${i + 1}`;
                            const score = source?.relevanceScore
                              ? ` · ${Math.round(source.relevanceScore * 100)}%`
                              : '';
                            return (
                              <Badge key={i} variant="outline" className="text-xs border-slate-700 text-muted-foreground">
                                {label}{score}
                              </Badge>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isStreaming && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-purple-500 flex items-center justify-center shrink-0 text-xs font-medium text-white">
                    AI
                  </div>
                  <div className="bg-muted rounded-lg px-4 py-2">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        )}

        <form onSubmit={handleSubmit} className="p-4 border-t border-muted shrink-0">
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question..."
              disabled={isLoading || isStreaming}
              className="bg-muted border-slate-700"
            />
            <Button
              type="submit"
              disabled={!input.trim() || isLoading || isStreaming}
              size="icon"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-slate-500 mt-2 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            Answers are generated from meeting transcripts using RAG
          </p>
        </form>
      </CardContent>
    </Card>
  );
}