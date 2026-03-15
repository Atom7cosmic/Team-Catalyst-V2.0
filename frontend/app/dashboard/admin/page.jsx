'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { AuthGuard } from '@/components/guards/RouteGuard';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import DashboardLayout from '@/components/layout/DashboardLayout';
import AdminDashboard from '@/components/dashboard/AdminDashboard';
import { AdminGuard } from '@/components/guards/RouteGuard';
import {
  Calendar, CheckCircle, TrendingUp,
  TrendingDown, Minus, AlertTriangle
} from 'lucide-react';
import { format } from 'date-fns';
import api from '@/lib/axios';

function DashboardContent() {
  const router = useRouter();
  const { user } = useAuth();
  const [dashboardData, setDashboardData] = useState(null);
  const [isDataLoading, setIsDataLoading] = useState(true);

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const response = await api.get('/dashboard');
        setDashboardData(response.data.dashboard);
      } catch (error) {
        console.error('Failed to fetch dashboard:', error);
      } finally {
        setIsDataLoading(false);
      }
    };
    fetchDashboard();
  }, []);

  if (isDataLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

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

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Welcome back, {user?.firstName}</h1>
          <p className="text-muted-foreground">
            {user?.role} · {user?.isAdmin ? 'Administrator' : user?.roleLevel <= 5 ? 'Superior' : 'Team Member'}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Performance Score</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold">{performance?.currentScore || 0}/100</div>
                <div className={`flex items-center gap-1 ${getTrendColor()}`}>
                  {getTrendIcon()}
                  <span className="text-sm capitalize">{trend || 'neutral'}</span>
                </div>
              </div>
              <Progress value={performance?.currentScore || 0} className="mt-2" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Upcoming Meetings</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{dashboardData?.upcomingMeetings?.length || 0}</div>
              <p className="text-sm text-muted-foreground">Next 7 days</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Pending Tasks</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{dashboardData?.pendingTasks?.length || 0}</div>
              <p className="text-sm text-muted-foreground">
                {dashboardData?.pendingTasks?.filter(t => t.priority === 'urgent').length || 0} urgent
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Notifications</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{dashboardData?.unreadNotifications || 0}</div>
              <p className="text-sm text-muted-foreground">Unread</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Upcoming Meetings
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!dashboardData?.upcomingMeetings?.length ? (
                <p className="text-muted-foreground text-center py-4">No upcoming meetings</p>
              ) : (
                <div className="space-y-3">
                  {dashboardData.upcomingMeetings.slice(0, 5).map((meeting) => (
                    <div
                      key={meeting._id}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted cursor-pointer transition-colors"
                      onClick={() => router.push(`/meetings/${meeting._id}`)}
                    >
                      <div>
                        <p className="font-medium">{meeting.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(meeting.scheduledDate), 'MMM d, h:mm a')}
                        </p>
                      </div>
                      <Badge variant={meeting.status === 'live' ? 'destructive' : 'default'}>
                        {meeting.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5" />
                Pending Tasks
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!dashboardData?.pendingTasks?.length ? (
                <p className="text-muted-foreground text-center py-4">No pending tasks</p>
              ) : (
                <div className="space-y-3">
                  {dashboardData.pendingTasks.slice(0, 5).map((task) => (
                    <div
                      key={task._id}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted cursor-pointer transition-colors"
                      onClick={() => router.push('/tasks')}
                    >
                      <div>
                        <p className="font-medium">{task.title}</p>
                        <p className="text-sm text-muted-foreground">
                          {task.dueDate ? `Due ${format(new Date(task.dueDate), 'MMM d')}` : 'No due date'}
                        </p>
                      </div>
                      <Badge variant={
                        task.priority === 'urgent' ? 'destructive' :
                        task.priority === 'high' ? 'default' : 'secondary'
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

        {/* Team Section — only for superiors */}
        {dashboardData?.team && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Team Overview</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Team Members</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{dashboardData.team.members?.length || 0}</div>
                  <p className="text-sm text-muted-foreground">Active</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">At Risk</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-red-500">
                    {dashboardData.team.atRiskEmployees?.length || 0}
                  </div>
                  <p className="text-sm text-muted-foreground">Require attention</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Promotion Ready</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-500">
                    {dashboardData.team.promotionCandidates?.length || 0}
                  </div>
                  <p className="text-sm text-muted-foreground">Pending review</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Attendance Today</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {dashboardData.team.attendance?.present || 0}/{dashboardData.team.attendance?.total || 0}
                  </div>
                  <p className="text-sm text-muted-foreground">Present</p>
                </CardContent>
              </Card>
            </div>

            {dashboardData.team.atRiskEmployees?.length > 0 && (
              <Card className="border-red-500/30">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-red-500">
                    <AlertTriangle className="h-5 w-5" />
                    At Risk Employees
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {dashboardData.team.atRiskEmployees.slice(0, 3).map((rec) => (
                      <div
                        key={rec._id}
                        className="flex items-center justify-between p-3 rounded-lg bg-red-500/10 cursor-pointer hover:bg-red-500/20"
                        onClick={() => router.push('/recommendations')}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-slate-200">
                            {rec.user?.firstName?.[0]}
                          </div>
                          <div>
                            <p className="font-medium">{rec.user?.firstName} {rec.user?.lastName}</p>
                            <p className="text-sm text-muted-foreground">{rec.user?.role}</p>
                          </div>
                        </div>
                        <Badge variant="destructive">
                          Risk: {Math.round((rec.resignationRiskScore || 0) * 100)}%
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}




export default function AdminDashboardPage() {
  return (
    <AdminGuard>
      <DashboardLayout>
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold">Admin Dashboard</h1>
            <p className="text-muted-foreground">System overview and management</p>
          </div>
          <AdminDashboard />
        </div>
      </DashboardLayout>
    </AdminGuard>
  );
}

