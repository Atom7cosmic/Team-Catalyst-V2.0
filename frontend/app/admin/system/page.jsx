'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Server,
  Database,
  Cpu,
  MemoryStick,
  HardDrive,
  Activity,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Clock,
  AlertTriangle
} from 'lucide-react';
import api from '@/lib/axios';
import { useAuth } from '@/context/AuthContext';
import { CardSkeleton } from '@/components/shared/Skeleton';
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
import toast from 'react-hot-toast';

// Mock system stats data
const mockCpuData = [
  { time: '00:00', usage: 35 },
  { time: '04:00', usage: 28 },
  { time: '08:00', usage: 65 },
  { time: '12:00', usage: 72 },
  { time: '16:00', usage: 58 },
  { time: '20:00', usage: 45 },
];

const mockMemoryData = [
  { time: '00:00', usage: 52 },
  { time: '04:00', usage: 48 },
  { time: '08:00', usage: 68 },
  { time: '12:00', usage: 75 },
  { time: '16:00', usage: 70 },
  { time: '20:00', usage: 62 },
];

export default function AdminSystemPage() {
  const router = useRouter();
  const { isAdmin, isLoading: authLoading } = useAuth();
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.push('/dashboard');
      return;
    }
    fetchSystemStats();
  }, [authLoading, isAdmin, router]);

  const fetchSystemStats = async () => {
    try {
      const response = await api.get('/admin/system-stats');
      setStats(response.data.stats);
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to fetch system stats:', error);
      toast.error('Failed to fetch system stats');
    } finally {
      setIsLoading(false);
    }
  };

  // Mock system health data
  const systemHealth = {
    api: { status: 'healthy', latency: 45 },
    database: { status: 'healthy', connections: 12 },
    queue: { status: 'healthy', pending: 3 },
    ai: { status: 'healthy', models: ['groq', 'whisper'] },
  };

  const services = [
    { name: 'API Server', icon: Server, status: systemHealth.api.status, metric: `${systemHealth.api.latency}ms` },
    { name: 'Database', icon: Database, status: systemHealth.database.status, metric: `${systemHealth.database.connections} conns` },
    { name: 'Queue Worker', icon: Activity, status: systemHealth.queue.status, metric: `${systemHealth.queue.pending} pending` },
    { name: 'AI Services', icon: Cpu, status: systemHealth.ai.status, metric: systemHealth.ai.models.join(', ') },
  ];

  const getStatusIcon = (status) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'error':
        return <AlertCircle className="h-5 w-5 text-red-500" />;
      default:
        return <Clock className="h-5 w-5 text-slate-500" />;
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'healthy':
        return <Badge className="bg-green-500/20 text-green-400">Healthy</Badge>;
      case 'warning':
        return <Badge className="bg-yellow-500/20 text-yellow-400">Warning</Badge>;
      case 'error':
        return <Badge className="bg-red-500/20 text-red-400">Error</Badge>;
      default:
        return <Badge className="bg-slate-500/20 text-muted-foreground">Unknown</Badge>;
    }
  };

  if (authLoading || isLoading) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <h1 className="text-3xl font-bold">System Status</h1>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">System Status</h1>
            <p className="text-muted-foreground">
              Last updated: {lastUpdated.toLocaleTimeString()}
            </p>
          </div>
          <Button variant="outline" onClick={fetchSystemStats} className="border-slate-700">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        {/* Service Status */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {services.map((service) => (
            <Card key={service.name} className="bg-card border-muted">
              <CardContent className="py-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-muted">
                      <service.icon className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{service.name}</p>
                      <p className="text-sm text-slate-500">{service.metric}</p>
                    </div>
                  </div>
                  {getStatusIcon(service.status)}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Resource Usage */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="bg-card border-muted">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="h-5 w-5" />
                CPU Usage
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={mockCpuData}>
                    <defs>
                      <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="time" stroke="#64748b" />
                    <YAxis stroke="#64748b" />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }}
                      labelStyle={{ color: '#94a3b8' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="usage"
                      stroke="#3b82f6"
                      fillOpacity={1}
                      fill="url(#colorCpu)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-muted">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MemoryStick className="h-5 w-5" />
                Memory Usage
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={mockMemoryData}>
                    <defs>
                      <linearGradient id="colorMemory" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="time" stroke="#64748b" />
                    <YAxis stroke="#64748b" />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }}
                      labelStyle={{ color: '#94a3b8' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="usage"
                      stroke="#10b981"
                      fillOpacity={1}
                      fill="url(#colorMemory)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Database Stats */}
        <Card className="bg-card border-muted">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Database Statistics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Total Users</p>
                <p className="text-2xl font-bold">{stats?.users || 0}</p>
                <Progress value={(stats?.activeUsers / stats?.users) * 100 || 0} className="h-2" />
                <p className="text-xs text-slate-500">
                  {stats?.activeUsers || 0} active
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Total Meetings</p>
                <p className="text-2xl font-bold">{stats?.totalMeetings || 0}</p>
                <p className="text-xs text-slate-500">
                  {stats?.processingMeetings || 0} processing
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Total Tasks</p>
                <p className="text-2xl font-bold">{stats?.totalTasks || 0}</p>
                <p className="text-xs text-slate-500">Across all teams</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">New This Month</p>
                <p className="text-2xl font-bold">{stats?.newUsersThisMonth || 0}</p>
                <p className="text-xs text-slate-500">New users</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
