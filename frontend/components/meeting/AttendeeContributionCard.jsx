'use client';

import { useState } from 'react';
import { MessageSquare, ChevronDown, ChevronUp, Award } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

export default function AttendeeContributionCard({ attendee, contributions = [] }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const user = attendee.user || {};

  // ✅ FIX: match using both _id and id (Mongoose exposes both)
  const userId = user._id?.toString() || user.id?.toString() || '';

  const contribution = contributions.find(c => {
    const cId = c.user?._id?.toString() || c.user?.id?.toString() || c.user?.toString() || '';
    return cId === userId;
  }) || {};

  // ✅ FIX: user is always populated from API, use it directly
  const displayName = user.firstName
    ? `${user.firstName} ${user.lastName || ''}`.trim()
    : contribution.name || 'Unknown';

  const score = contribution.score ?? contribution.contributionScore ?? attendee.contributionScore ?? 0;
  const keyPoints = contribution.keyPoints || attendee.keyPoints || [];
  const displayAvatar = user.avatar || '';
  const displayRole = user.role || '';
  const initials = displayName !== 'Unknown'
    ? displayName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  const getScoreColor = (s) => {
    if (s >= 8) return 'text-green-400';
    if (s >= 5) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getScoreLabel = (s) => {
    if (s >= 9) return 'Excellent';
    if (s >= 7) return 'Good';
    if (s >= 5) return 'Average';
    if (s >= 3) return 'Below Average';
    return 'Minimal';
  };

  return (
    <div className="rounded-lg border border-slate-700 bg-muted/50 overflow-hidden">
      <div className="p-4">
        <div className="flex items-center gap-4">
          <Avatar className="h-10 w-10">
            <AvatarImage src={displayAvatar} alt={displayName} />
            <AvatarFallback className="bg-slate-700 text-slate-300">
              {initials}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium text-slate-100 truncate">{displayName}</p>
              {displayRole && (
                <Badge variant="secondary" className="text-xs bg-slate-700 text-slate-300">
                  {displayRole}
                </Badge>
              )}
            </div>
            {user.email && <p className="text-xs text-slate-500">{user.email}</p>}
          </div>

          <div className="text-right">
            <div className={cn('text-2xl font-bold', getScoreColor(score))}>
              {Number(score).toFixed(1)}
            </div>
            <p className="text-xs text-muted-foreground">{getScoreLabel(score)}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-slate-500">Key Points</p>
              <p className="text-sm font-medium text-foreground">{keyPoints.length}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Award className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-slate-500">Contribution</p>
              <p className="text-sm font-medium text-foreground">{(score * 10).toFixed(0)}%</p>
            </div>
          </div>
        </div>

        <div className="mt-3">
          <Progress value={score * 10} className="h-2" />
        </div>

        {keyPoints.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="mt-3 w-full text-muted-foreground hover:text-foreground"
          >
            {isExpanded ? (
              <><ChevronUp className="h-4 w-4 mr-1" />Hide Key Points</>
            ) : (
              <><ChevronDown className="h-4 w-4 mr-1" />Show {keyPoints.length} Key Points</>
            )}
          </Button>
        )}
      </div>

      {isExpanded && keyPoints.length > 0 && (
        <div className="px-4 pb-4 border-t border-slate-700">
          <div className="pt-4 space-y-2">
            <p className="text-sm font-medium text-slate-300">Key Contributions:</p>
            <ul className="space-y-1">
              {keyPoints.map((point, index) => (
                <li key={index} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="text-primary mt-1">•</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}