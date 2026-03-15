'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Calendar, Users, ChevronRight, Loader2, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { format, isValid } from 'date-fns';
import api from '@/lib/axios';

export default function SimilarMeetingsPanel({ meetingId }) {
  const router = useRouter();
  const [similarMeetings, setSimilarMeetings] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchSimilarMeetings();
  }, [meetingId]);

  const fetchSimilarMeetings = async () => {
    try {
      setIsLoading(true);
      const response = await api.get(`/meetings/${meetingId}/similar`);
      setSimilarMeetings(response.data.similarMeetings || []);
    } catch (error) {
      console.error('Failed to fetch similar meetings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getDomainColor = (domain) => {
    const colors = {
      'Sprint Planning': 'bg-blue-500/20 text-blue-400',
      'Performance Review': 'bg-green-500/20 text-green-400',
      'Architecture Discussion': 'bg-purple-500/20 text-purple-400',
      '1:1': 'bg-yellow-500/20 text-yellow-400',
      'All-Hands': 'bg-red-500/20 text-red-400',
      'Custom': 'bg-slate-500/20 text-muted-foreground'
    };
    return colors[domain] || colors['Custom'];
  };

  // Safely format a date from either scheduledDate or date field
  const safeFormatDate = (meeting) => {
    const raw = meeting.scheduledDate || meeting.date;
    if (!raw) return 'Unknown date';
    const d = new Date(raw);
    return isValid(d) ? format(d, 'MMM d, yyyy') : 'Unknown date';
  };

  // Get meeting ID from either _id or meetingId field
  const getMeetingId = (meeting) => {
    return meeting._id || meeting.id || meeting.meetingId;
  };

  // Get meeting name — ChromaDB results only have meetingId, not name
  const getMeetingName = (meeting) => {
    return meeting.name || meeting.meetingId || 'Similar Meeting';
  };

  if (isLoading) {
    return (
      <Card className="bg-card border-muted">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-400" />
            Similar Meetings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (similarMeetings.length === 0) {
    return (
      <Card className="bg-card border-muted">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-400" />
            Similar Meetings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <AlertCircle className="h-10 w-10 text-slate-600 mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">No similar meetings found</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-muted">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-blue-400" />
          Similar Meetings
          <Badge variant="secondary" className="ml-auto bg-muted text-muted-foreground">
            {similarMeetings.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {similarMeetings.map((meeting, idx) => {
            const id = getMeetingId(meeting);
            return (
              <div
                key={id || idx}
                className="p-3 rounded-lg bg-muted/50 hover:bg-muted cursor-pointer transition-colors group"
                onClick={() => id && router.push(`/meetings/${id}`)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-100 truncate group-hover:text-blue-400 transition-colors">
                      {getMeetingName(meeting)}
                    </p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {safeFormatDate(meeting)}
                      </span>
                      {meeting.attendeeCount && (
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {meeting.attendeeCount}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-600 group-hover:text-muted-foreground shrink-0 mt-1" />
                </div>
                <div className="flex items-center gap-2 mt-2">
                  {meeting.domain && (
                    <Badge className={getDomainColor(meeting.domain)}>
                      {meeting.domain}
                    </Badge>
                  )}
                  {meeting.similarity && (
                    <Badge variant="outline" className="text-xs border-slate-700 text-muted-foreground">
                      {Math.round(parseFloat(meeting.similarity) * 100)}% match
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}