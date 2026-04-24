'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Clock,
  CheckCircle,
  XCircle,
  User,
  BarChart2,
  Calendar,
  Shield,
  Activity
} from 'lucide-react';
import api from '@/lib/axios';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

const categoryConfig = {
  promote: {
    icon: TrendingUp,
    color: 'bg-green-500/20 text-green-400 border-green-500/30',
    badgeColor: 'bg-green-500/20 text-green-400',
    label: 'Promote',
    description: 'This employee is performing exceptionally well and is ready for promotion.'
  },
  monitor: {
    icon: TrendingDown,
    color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    badgeColor: 'bg-yellow-500/20 text-yellow-400',
    label: 'Monitor',
    description: 'This employee requires closer monitoring to ensure continued performance.'
  },
  at_risk: {
    icon: AlertTriangle,
    color: 'bg-red-500/20 text-red-400 border-red-500/30',
    badgeColor: 'bg-red-500/20 text-red-400',
    label: 'At Risk',
    description: 'This employee shows signs of disengagement or resignation risk.'
  }
};

export default function RecommendationDetailPage({ params }) {
  const router = useRouter();
  const { user } = useAuth();
  const [recommendation, setRecommendation] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isActioning, setIsActioning] = useState(false);

  useEffect(() => {
    fetchRecommendation();
  }, [params?.id]);

  const fetchRecommendation = async () => {
    if (!params?.id) return;
    try {
      const response = await api.get(`/recommendations/${params.id}`);
      setRecommendation(response.data.recommendation);
    } catch (error) {
      console.error('Failed to fetch recommendation:', error);
      toast.error('Failed to fetch recommendation details');
      router.push('/recommendations');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAcknowledge = async () => {
    setIsActioning(true);
    try {
      await api.post(`/recommendations/${params.id}/acknowledge`);
      toast.success('Recommendation acknowledged');
      fetchRecommendation();
    } catch (error) {
      toast.error('Failed to acknowledge');
    } finally {
      setIsActioning(false);
    }
  };

  const handleDismiss = async () => {
    setIsActioning(true);
    try {
      await api.post(`/recommendations/${params.id}/dismiss`, {
        reason: 'Dismissed by manager'
      });
      toast.success('Recommendation dismissed');
      fetchRecommendation();
    } catch (error) {
      toast.error('Failed to dismiss');
    } finally {
      setIsActioning(false);
    }
  };

  if (isLoading) {
    return (
      <>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      </>
    );
  }

  if (!recommendation) {
    return (
      <>
        <div className="text-center py-12">
          <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-slate-500" />
          <p className="text-muted-foreground">Recommendation not found</p>
          <Button className="mt-4" onClick={() => router.push('/recommendations')}>
            Back to Recommendations
          </Button>
        </div>
      </>
    );
  }

  const config = categoryConfig[recommendation.category] || categoryConfig.monitor;
  const Icon = config.icon;
  const riskPercentage = Math.round((recommendation.resignationRiskScore || 0) * 100);
  const emp = recommendation.user;

  return (
    <>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push('/recommendations')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Recommendation Detail</h1>
            <p className="text-muted-foreground">AI-generated insight for {emp?.firstName} {emp?.lastName}</p>
          </div>
        </div>

        {/* Employee Card */}
        <Card className={`border ${config.color}`}>
          <CardContent className="py-6">
            <div className="flex items-start gap-6">
              <Avatar className="h-16 w-16">
                <AvatarFallback className="bg-slate-700 text-foreground text-xl">
                  {emp?.firstName?.[0]}{emp?.lastName?.[0]}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="text-xl font-bold text-slate-100">
                    {emp?.firstName} {emp?.lastName}
                  </h2>
                  <Badge className={config.badgeColor}>
                    <Icon className="h-3 w-3 mr-1" />
                    {config.label}
                  </Badge>
                  <Badge className={
                    recommendation.status === 'pending' ? 'bg-amber-500/20 text-amber-400' :
                    recommendation.status === 'acknowledged' ? 'bg-green-500/20 text-green-400' :
                    'bg-slate-500/20 text-muted-foreground'
                  }>
                    {recommendation.status}
                  </Badge>
                </div>
                <p className="text-muted-foreground mt-1">{emp?.role} · {emp?.email}</p>
                <p className="text-slate-300 mt-3 text-sm">{config.description}</p>
              </div>

              {/* Actions */}
              {recommendation.status === 'pending' && (
                <div className="flex gap-2 shrink-0">
                  <Button
                    onClick={handleAcknowledge}
                    disabled={isActioning}
                    className="bg-green-600 hover:bg-green-700"
                    size="sm"
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Acknowledge
                  </Button>
                  <Button
                    onClick={handleDismiss}
                    disabled={isActioning}
                    variant="outline"
                    size="sm"
                    className="border-slate-600"
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Dismiss
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Score Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-card border-muted">
            <CardContent className="flex items-center gap-3 py-4">
              <div className="p-2 rounded-lg bg-blue-500/20">
                <BarChart2 className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{recommendation.score}</p>
                <p className="text-sm text-muted-foreground">Performance Score</p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-muted">
            <CardContent className="flex items-center gap-3 py-4">
              <div className="p-2 rounded-lg bg-red-500/20">
                <Shield className="h-5 w-5 text-red-400" />
              </div>
              <div>
                <p className={`text-2xl font-bold ${
                  riskPercentage > 60 ? 'text-red-400' :
                  riskPercentage > 40 ? 'text-yellow-400' : 'text-green-400'
                }`}>{riskPercentage}%</p>
                <p className="text-sm text-muted-foreground">Resignation Risk</p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-muted">
            <CardContent className="flex items-center gap-3 py-4">
              <div className="p-2 rounded-lg bg-purple-500/20">
                <Activity className="h-5 w-5 text-purple-400" />
              </div>
              <div>
                <p className={`text-2xl font-bold capitalize ${
                  recommendation.trend === 'improving' ? 'text-green-400' :
                  recommendation.trend === 'declining' ? 'text-red-400' : 'text-muted-foreground'
                }`}>{recommendation.trend || 'neutral'}</p>
                <p className="text-sm text-muted-foreground">Performance Trend</p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-muted">
            <CardContent className="flex items-center gap-3 py-4">
              <div className="p-2 rounded-lg bg-slate-500/20">
                <Calendar className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">
                  {recommendation.createdAt
                    ? format(new Date(recommendation.createdAt), 'MMM d, yyyy')
                    : 'N/A'}
                </p>
                <p className="text-sm text-muted-foreground">Generated On</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* AI Reasoning */}
          <Card className="bg-card border-muted">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Icon className="h-5 w-5" />
                AI Reasoning
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-slate-300 leading-relaxed">
                {recommendation.reasoning || 'No reasoning available.'}
              </p>
            </CardContent>
          </Card>

          {/* Risk Breakdown */}
          <Card className="bg-card border-muted">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Risk Score Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {recommendation.riskComponents ? (
                Object.entries(recommendation.riskComponents).map(([key, value]) => (
                  <div key={key}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-muted-foreground capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                      <span className="text-foreground">{Math.round(value * 100)}%</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full">
                      <div
                        className={`h-2 rounded-full ${value > 0.6 ? 'bg-red-500' : value > 0.4 ? 'bg-yellow-500' : 'bg-green-500'}`}
                        style={{ width: `${Math.round(value * 100)}%` }}
                      />
                    </div>
                  </div>
                ))
              ) : (
                <>
                  {[
                    { label: 'Overall Risk', value: riskPercentage },
                    { label: 'Performance Score', value: recommendation.score },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="text-foreground">{value}</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full">
                        <div
                          className={`h-2 rounded-full ${value > 60 ? 'bg-red-500' : value > 40 ? 'bg-yellow-500' : 'bg-green-500'}`}
                          style={{ width: `${Math.min(value, 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Employee Profile Link */}
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="border-slate-700"
            onClick={() => router.push(`/team/${emp?._id}`)}
          >
            <User className="h-4 w-4 mr-2" />
            View Full Employee Profile
          </Button>
          <Button
            variant="outline"
            className="border-slate-700"
            onClick={() => router.push('/recommendations')}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Recommendations
          </Button>
        </div>

      </div>
    </>
  );
}