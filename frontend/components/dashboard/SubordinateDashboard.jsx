'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Calendar,
  CheckCircle,
  TrendingUp,
  TrendingDown,
  Minus,
  Clock,
  AlertTriangle,
  ArrowRight,
  Activity,
  Mic
} from 'lucide-react';
import { format } from 'date-fns';
import api from '@/lib/axios';
import { CardSkeleton, ListSkeleton } from '@/components/shared/Skeleton';
import AttendanceHeatmap from '@/components/shared/AttendanceHeatmap';

export default function SubordinateDashboard() {
  const router = useRouter();
  const [dashboardData, setDashboardData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchDashboard();
  }, []);

  const fetchDashboard = async () => {
    try {
      const response = await api.get('/dashboard');
      setDashboardData(response.data.dashboard);
    } catch (error) {
      console.error('Failed to fetch dashboard:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const performance = dashboardData?.performance;
  const trend = performance?.trend;

  const getTrendIcon = () => {
    if (trend === 'improving') return <TrendingUp className="h-4 w-4 text-green-500" />;
    if (trend === 'declining') return <TrendingDown className="h-4 w-4 text-red-500" />;
    return <Minus className="h-4 w-4 text-yellow-500" />;
  };

  const getTrendColor = () => {
    if (trend === 'improving') return 'text-green-500';
    if (trend === 'declining') return 'text-red-500';
    return 'text-yellow-500';
  };

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

  return (
    <div className="space-y-6">
      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Performance Score */}
        <Card className="bg-card border-muted">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Performance Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold text-slate-100">
                {performance?.currentScore || 0}/100
              </div>
              <div className={`flex items-center gap-1 ${getTrendColor()}`}>
                {getTrendIcon()}
                <span className="text-sm capitalize">{trend}</span>
              </div>
            </div>
            <Progress value={performance?.currentScore || 0} className="mt-2" />
          </CardContent>
        </Card>

        {/* Attendance */}
        <Card className="bg-card border-muted">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Attendance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-100">98%</div>
            <p className="text-sm text-muted-foreground">This month</p>
          </CardContent>
        </Card>

        {/* Tasks */}
        <Card className="bg-card border-muted">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-100">
              {dashboardData?.pendingTasks?.length || 0}
            </div>
            <p className="text-sm text-muted-foreground">
              {dashboardData?.pendingTasks?.filter(t => t.priority === 'urgent').length || 0} urgent
            </p>
          </CardContent>
        </Card>

        {/* Meetings */}
        <Card className="bg-card border-muted">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Upcoming</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-100">
              {dashboardData?.upcomingMeetings?.length || 0}
            </div>
            <p className="text-sm text-muted-foreground">Meetings this week</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Attendance Heatmap */}
        <Card className="bg-card border-muted">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Attendance Heatmap
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AttendanceHeatmap />
          </CardContent>
        </Card>

        {/* Tasks */}
        <Card className="bg-card border-muted">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5" />
              Your Tasks
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dashboardData?.pendingTasks?.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No pending tasks</p>
              </div>
            ) : (
              <div className="space-y-3">
                {dashboardData?.pendingTasks?.slice(0, 5).map((task) => (
                  <div
                    key={task._id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted cursor-pointer transition-colors"
                    onClick={() => router.push('/tasks')}
                  >
                    <div className="flex-1">
                      <p className="font-medium text-foreground">{task.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {task.dueDate ? `Due ${format(new Date(task.dueDate), 'MMM d')}` : 'No due date'}
                      </p>
                    </div>
                    <Badge className={
                      task.priority === 'urgent' ? 'bg-red-500/20 text-red-400' :
                      task.priority === 'high' ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-slate-500/20 text-muted-foreground'
                    }>
                      {task.priority}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Upcoming Meetings */}
      <Card className="bg-card border-muted">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Upcoming Meetings
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dashboardData?.upcomingMeetings?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No upcoming meetings</p>
            </div>
          ) : (
            <div className="space-y-3">
              {dashboardData?.upcomingMeetings?.slice(0, 5).map((meeting) => (
                <div
                  key={meeting._id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted cursor-pointer transition-colors"
                  onClick={() => router.push(`/meetings/${meeting._id}`)}
                >
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-lg bg-muted">
                      <Mic className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{meeting.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(meeting.scheduledDate), 'MMM d, h:mm a')}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="h-5 w-5 text-slate-500" />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
