'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Clock, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
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
  pending:      { icon: Clock,        color: 'text-amber-500',  label: 'Pending' },
  acknowledged: { icon: CheckCircle,  color: 'text-green-500',  label: 'Acknowledged' },
  dismissed:    { icon: XCircle,      color: 'text-slate-500',  label: 'Dismissed' },
  actioned:     { icon: CheckCircle,  color: 'text-blue-500',   label: 'Actioned' }
};

// ── Inline Dialog ─────────────────────────────────────────────────────────────
function ReasonDialog({ type, employeeName, onConfirm, onCancel, isLoading }) {
  const [reason, setReason] = useState('');

  const isAcknowledge = type === 'acknowledge';
  const title = isAcknowledge ? 'Acknowledge Recommendation' : 'Dismiss Recommendation';
  const placeholder = isAcknowledge
    ? `e.g. Reviewed Leo's performance. Will schedule a 1:1 to discuss improvement plan...`
    : `e.g. Henry was promoted last month, recommendation no longer applicable...`;
  const confirmLabel = isAcknowledge ? 'Acknowledge' : 'Dismiss';
  const confirmClass = isAcknowledge
    ? 'bg-green-600 hover:bg-green-700 text-white'
    : 'bg-red-600 hover:bg-red-700 text-white';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-md bg-card border border-muted rounded-xl shadow-2xl p-6 space-y-4">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className={cn(
            'p-2 rounded-lg',
            isAcknowledge ? 'bg-green-500/20' : 'bg-red-500/20'
          )}>
            {isAcknowledge
              ? <CheckCircle className="h-5 w-5 text-green-400" />
              : <XCircle className="h-5 w-5 text-red-400" />
            }
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            <p className="text-sm text-muted-foreground">
              {isAcknowledge ? 'Acknowledging' : 'Dismissing'} recommendation for{' '}
              <span className="text-foreground font-medium">{employeeName}</span>
            </p>
          </div>
        </div>

        {/* Reason input */}
        <div className="space-y-2">
          <Label className="text-sm text-muted-foreground">
            Reason <span className="text-red-400">*</span>
          </Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={placeholder}
            className="bg-muted border-slate-700 min-h-[100px] text-sm resize-none"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            This reason will be logged in the audit trail.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-1">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
            className="border-slate-700"
          >
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(reason)}
            disabled={isLoading || !reason.trim()}
            className={confirmClass}
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {isAcknowledge ? 'Acknowledging...' : 'Dismissing...'}
              </span>
            ) : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main Card ─────────────────────────────────────────────────────────────────
export default function RecommendationCard({ recommendation, showActions = true, onUpdate }) {
  const router = useRouter();
  const { isSuperior } = useAuth();
  const config = categoryConfig[recommendation.category] || categoryConfig.monitor;
  const statusConfigItem = statusConfig[recommendation.status] || statusConfig.pending;
  const Icon = config.icon;
  const StatusIcon = statusConfigItem.icon;

  const [dialog, setDialog] = useState(null); // 'acknowledge' | 'dismiss' | null
  const [isActioning, setIsActioning] = useState(false);

  const user = recommendation.user;
  const employeeName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();
  const riskPercentage = Math.round((recommendation.resignationRiskScore || 0) * 100);

  const handleConfirm = async (reason) => {
    setIsActioning(true);
    try {
      if (dialog === 'acknowledge') {
        await api.post(`/recommendations/${recommendation._id}/acknowledge`, { reason });
        toast.success('Recommendation acknowledged');
      } else {
        await api.post(`/recommendations/${recommendation._id}/dismiss`, { reason });
        toast.success('Recommendation dismissed');
      }
      setDialog(null);
      onUpdate?.();
    } catch (error) {
      toast.error(error.response?.data?.message || `Failed to ${dialog}`);
    } finally {
      setIsActioning(false);
    }
  };

  return (
    <>
      {/* ── Dialog overlay ── */}
      {dialog && (
        <ReasonDialog
          type={dialog}
          employeeName={employeeName}
          onConfirm={handleConfirm}
          onCancel={() => setDialog(null)}
          isLoading={isActioning}
        />
      )}

      {/* ── Card ── */}
      <div className={cn('rounded-lg border p-4 transition-all hover:shadow-md', config.color)}>
        <div className="flex items-start gap-4">
          <Icon className="h-5 w-5 shrink-0 mt-1" />
          <div className="flex-1 min-w-0">

            {/* Header row */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-slate-700 text-slate-300 text-xs">
                    {user?.firstName?.[0]}{user?.lastName?.[0]}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium text-slate-100">{employeeName}</p>
                  <p className="text-xs text-muted-foreground">{user?.role}</p>
                </div>
              </div>
              <Badge className={config.badgeColor}>{config.label}</Badge>
              <div className={cn('flex items-center gap-1', statusConfigItem.color)}>
                <StatusIcon className="h-4 w-4" />
                <span className="text-xs">{statusConfigItem.label}</span>
              </div>
            </div>

            {/* Stats */}
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

            {/* Reasoning */}
            {recommendation.reasoning && (
              <p className="mt-3 text-sm text-slate-300 line-clamp-2">
                {recommendation.reasoning}
              </p>
            )}

            {/* Acknowledged banner */}
            {recommendation.status === 'acknowledged' && recommendation.acknowledgedBy && (
              <div className="mt-3 p-2 bg-green-500/10 border border-green-500/20 rounded-lg">
                <div className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs text-green-400">
                      Acknowledged by {recommendation.acknowledgedBy?.firstName} {recommendation.acknowledgedBy?.lastName}
                      {recommendation.acknowledgedAt && (
                        <span className="text-slate-500 ml-1">
                          · {new Date(recommendation.acknowledgedAt).toLocaleDateString()}
                        </span>
                      )}
                    </p>
                    {recommendation.acknowledgeReason && (
                      <p className="text-xs text-slate-400 mt-1 italic">
                        &quot;{recommendation.acknowledgeReason}&quot;
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Dismissed banner */}
            {recommendation.status === 'dismissed' && (
              <div className="mt-3 p-2 bg-slate-500/10 border border-slate-500/20 rounded-lg">
                <div className="flex items-start gap-2">
                  <XCircle className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs text-slate-400">
                      Dismissed
                      {recommendation.dismissedAt && (
                        <span className="text-slate-500 ml-1">
                          · {new Date(recommendation.dismissedAt).toLocaleDateString()}
                        </span>
                      )}
                    </p>
                    {recommendation.dismissedReason && (
                      <p className="text-xs text-slate-400 mt-1 italic">
                        &quot;{recommendation.dismissedReason}&quot;
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Action buttons */}
            {showActions && isSuperior && (
              <div className="mt-4 flex gap-2 flex-wrap">
                {recommendation.status === 'pending' && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDialog('acknowledge')}
                      className="border-green-500/50 text-green-400 hover:bg-green-500/10"
                    >
                      <CheckCircle className="h-3.5 w-3.5 mr-1" />
                      Acknowledge
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDialog('dismiss')}
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
    </>
  );
}