'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Users,
  TrendingUp,
  AlertTriangle,
  ArrowRight,
  Activity,
  CheckCircle,
  Clock
} from 'lucide-react';
import { format } from 'date-fns';
import api from '@/lib/axios';
import { CardSkeleton, ListSkeleton } from '@/components/shared/Skeleton';
import OrgChart from '@/components/shared/OrgChart';
import RecommendationCard from '@/components/shared/RecommendationCard';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';

export default function SuperiorDashboard() {
  const router = useRouter();
  const [dashboardData, setDashboardData] = useState(null);
  const [teamOverview, setTeamOverview] = useState(null);
  const [orgChartData, setOrgChartData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchDashboard();
    fetchTeamOverview();
    fetchOrgChart();
  }, []);

  const fetchDashboard = async () => {
    try {
      const response = await api.get('/dashboard');
      setDashboardData(response.data.dashboard);
    } catch (error) {
      console.error('Failed to fetch dashboard:', error);
    }
  };

  const fetchTeamOverview = async () => {
    try {
      const response = await api.get('/dashboard/team-overview');
      setTeamOverview(response.data.overview);
    } catch (error) {
      console.error('Failed to fetch team overview:', error);
    }
  };

  const fetchOrgChart = async () => {
    try {
      const response = await api.get('/users/org-chart');
      setOrgChartData(response.data.orgChart || []);
    } finally {
      setIsLoading(false);
    }
  };

  // Mock performance trend data
  const performanceTrend = [
    { month: 'Jan', score: 72 },
    { month: 'Feb', score: 75 },
    { month: 'Mar', score: 74 },
    { month: 'Apr', score: 78 },
    { month: 'May', score: 80 },
    { month: 'Jun', score: 82 },
  ];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  }

  const team = dashboardData?.team;

  return (
    <div className="space-y-6">
      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="bg-card border-muted">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Team Members</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-100">{team?.members?.length || 0}</div>
            <p className="text-sm text-muted-foreground">Active in your org</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-muted">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">At Risk</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">{team?.atRiskEmployees?.length || 0}</div>
            <p className="text-sm text-muted-foreground">Require attention</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-muted">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Promote Ready</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">{team?.promotionCandidates?.length || 0}</div>
            <p className="text-sm text-muted-foreground">Pending review</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-muted">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-100">78%</div>
            <p className="text-sm text-muted-foreground">Team average</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Performance Trends */}
        <Card className="bg-card border-muted">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Performance Trends
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={performanceTrend}>
                  <defs>
                    <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="month" stroke="#64748b" />
                  <YAxis stroke="#64748b" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }}
                    labelStyle={{ color: '#94a3b8' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="score"
                    stroke="#3b82f6"
                    fillOpacity={1}
                    fill="url(#colorScore)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Recommendations Summary */}
        <Card className="bg-card border-muted">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(team?.atRiskEmployees?.slice(0, 2) || []).map((rec) => (
                <RecommendationCard
                  key={rec._id}
                  recommendation={rec}
                  showActions={false}
                />
              ))}
              {(team?.promotionCandidates?.slice(0, 2) || []).map((rec) => (
                <RecommendationCard
                  key={rec._id}
                  recommendation={rec}
                  showActions={false}
                />
              ))}
              {(team?.atRiskEmployees?.length === 0 && team?.promotionCandidates?.length === 0) && (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No pending recommendations</p>
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              className="w-full mt-4 text-muted-foreground hover:text-foreground"
              onClick={() => router.push('/recommendations')}
            >
              View All Recommendations
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Org Chart */}
      <Card className="bg-card border-muted">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Organization Chart
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[400px]">
            <OrgChart data={orgChartData} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
