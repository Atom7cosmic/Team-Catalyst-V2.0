'use client';

import { useRouter } from 'next/navigation';
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Clock, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import toast from 'react-hot-toast';
import api from '@/lib/axios';

const categoryConfig = {
  promote: {
    icon: TrendingUp,
    color: 'bg-green-500/20 text-green-500 border-green-500/30',
    badgeColor: 'bg-green-500/20 text-green-500',
    label: 'Promote'
  },
  monitor: {
    icon: TrendingDown,
    color: 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30',
    badgeColor: 'bg-yellow-500/20 text-yellow-500',
    label: 'Monitor'
  },
  at_risk: {
    icon: AlertTriangle,
    color: 'bg-red-500/20 text-red-500 border-red-500/30',
    badgeColor: 'bg-red-500/20 text-red-500',
    label: 'At Risk'
  }
};

const statusConfig = {
  pending: { icon: Clock, color: 'text-amber-500', label: 'Pending' },
  acknowledged: { icon: CheckCircle, color: 'text-green-500', label: 'Acknowledged' },
  dismissed: { icon: XCircle, color: 'text-slate-500', label: 'Dismissed' },
  actioned: { icon: CheckCircle, color: 'text-blue-500', label: 'Actioned' }
};

export default function RecommendationCard({ recommendation, showActions = true, onUpdate }) {
  const router = useRouter();
  const { isSuperior } = useAuth();
  const config = categoryConfig[recommendation.category] || categoryConfig.monitor;
  const statusConfigItem = statusConfig[recommendation.status] || statusConfig.pending;
  const Icon = config.icon;
  const StatusIcon = statusConfigItem.icon;

  const user = recommendation.user;
  const riskPercentage = Math.round((recommendation.resignationRiskScore || 0) * 100);

  const handleAcknowledge = async () => {
    try {
      await api.post(`/recommendations/${recommendation._id}/acknowledge`);
      toast.success('Recommendation acknowledged');
      onUpdate?.();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to acknowledge');
    }
  };

  const handleDismiss = async () => {
    try {
      await api.post(`/recommendations/${recommendation._id}/dismiss`, {
        reason: 'Dismissed by superior'
      });
      toast.success('Recommendation dismissed');
      onUpdate?.();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to dismiss');
    }
  };

  return (
    <div className={cn('rounded-lg border p-4 transition-all hover:shadow-md', config.color)}>
      <div className="flex items-start gap-4">
        <Icon className="h-5 w-5 shrink-0 mt-1" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-slate-700 text-slate-300 text-xs">
                  {user?.firstName?.[0]}{user?.lastName?.[0]}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium text-slate-100">
                  {user?.firstName} {user?.lastName}
                </p>
                <p className="text-xs text-muted-foreground">{user?.role}</p>
              </div>
            </div>
            <Badge className={config.badgeColor}>{config.label}</Badge>
            <div className={cn('flex items-center gap-1', statusConfigItem.color)}>
              <StatusIcon className="h-4 w-4" />
              <span className="text-xs">{statusConfigItem.label}</span>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-4 text-sm flex-wrap">
            <div>
              <span className="text-muted-foreground">Score:</span>{' '}
              <span className="font-semibold">{recommendation.score || 0}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Risk:</span>{' '}
              <span className={cn(
                'font-semibold',
                riskPercentage > 60 ? 'text-red-400' :
                riskPercentage > 40 ? 'text-yellow-400' : 'text-green-400'
              )}>
                {riskPercentage}%
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Trend:</span>{' '}
              <span className={cn(
                'capitalize',
                recommendation.trend === 'improving' ? 'text-green-400' :
                recommendation.trend === 'declining' ? 'text-red-400' :
                'text-muted-foreground'
              )}>
                {recommendation.trend || 'neutral'}
              </span>
            </div>
          </div>

          {recommendation.reasoning && (
            <p className="mt-3 text-sm text-slate-300 line-clamp-2">
              {recommendation.reasoning}
            </p>
          )}

          {/* Acknowledgement banner */}
          {recommendation.status === 'acknowledged' && recommendation.acknowledgedBy && (
            <div className="mt-3 p-2 bg-green-500/10 border border-green-500/20 rounded-lg">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <p className="text-xs text-green-400">
                  Acknowledged by {recommendation.acknowledgedBy?.firstName} {recommendation.acknowledgedBy?.lastName}
                  {recommendation.acknowledgedAt && (
                    <span className="text-slate-500 ml-1">
                      · {new Date(recommendation.acknowledgedAt).toLocaleDateString()}
                    </span>
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Dismissed banner */}
          {recommendation.status === 'dismissed' && (
            <div className="mt-3 p-2 bg-slate-500/10 border border-slate-500/20 rounded-lg">
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4 text-slate-500" />
                <p className="text-xs text-slate-400">
                  Dismissed
                  {recommendation.dismissedReason && `: ${recommendation.dismissedReason}`}
                  {recommendation.dismissedAt && (
                    <span className="text-slate-500 ml-1">
                      · {new Date(recommendation.dismissedAt).toLocaleDateString()}
                    </span>
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Action buttons — Acknowledge + Dismiss only for pending; View Profile always */}
          {showActions && isSuperior && (
            <div className="mt-4 flex gap-2 flex-wrap">
              {recommendation.status === 'pending' && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleAcknowledge}
                    className="border-green-500/50 text-green-400 hover:bg-green-500/10"
                  >
                    <CheckCircle className="h-3.5 w-3.5 mr-1" />
                    Acknowledge
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleDismiss}
                    className="border-slate-600 text-muted-foreground hover:bg-slate-700"
                  >
                    <XCircle className="h-3.5 w-3.5 mr-1" />
                    Dismiss
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => router.push(`/team/${user?._id}`)}
                className="text-muted-foreground hover:text-foreground"
              >
                View Profile
              </Button>
            </div>
          )}
        </div>

        <div className="text-right shrink-0">
          <p className="text-2xl font-bold">{recommendation.score || 0}</p>
          <p className="text-xs text-muted-foreground">score</p>
        </div>
      </div>
    </div>
  );
}