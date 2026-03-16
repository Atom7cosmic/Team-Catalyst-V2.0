'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Users, Search, UserPlus, Mail, ArrowUpRight, X } from 'lucide-react';
import api from '@/lib/axios';
import { useAuth } from '@/context/AuthContext';
import OrgChart from '@/components/shared/OrgChart';
import { CardSkeleton } from '@/components/shared/Skeleton';
import toast from 'react-hot-toast';

const ALL_ROLES = [
  { name: 'CEO',                     level: 1 },
  { name: 'CTO',                     level: 2 },
  { name: 'VP Engineering',          level: 3 },
  { name: 'Director of Engineering', level: 4 },
  { name: 'Engineering Manager',     level: 5 },
  { name: 'Tech Lead',               level: 6 },
  { name: 'Senior Engineer',         level: 6 },
  { name: 'Software Engineer',       level: 7 },
  { name: 'QA Engineer',             level: 7 },
  { name: 'DevOps Engineer',         level: 7 },
  { name: 'Junior Engineer',         level: 8 },
  { name: 'Intern',                  level: 9 },
];

export default function TeamPage() {
  const router = useRouter();
  const { user, isSuperior, isAdmin } = useAuth();
  const [teamData, setTeamData] = useState(null);
  const [orgChartData, setOrgChartData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const availableRoles = isAdmin
    ? ALL_ROLES.map(r => r.name)
    : ALL_ROLES.filter(r => r.level > (user?.roleLevel || 0)).map(r => r.name);

  const defaultRole = availableRoles[0] || 'Software Engineer';

  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '',
    password: '', role: defaultRole, superior: '',
  });

  useEffect(() => {
    fetchTeamData();
    fetchOrgChart();
  }, []);

  useEffect(() => {
    if (availableRoles.length > 0) {
      setForm(f => ({ ...f, role: availableRoles[0] }));
    }
  }, [user?.roleLevel]);

  const fetchTeamData = async () => {
    try {
      const response = await api.get('/users/team');
      setTeamData(response.data.team);
    } catch (error) {
      toast.error('Failed to fetch team data');
    }
  };

  const fetchOrgChart = async () => {
    try {
      const response = await api.get('/users/org-chart');
      setOrgChartData(response.data.orgChart || []);
    } catch (error) {
      console.error('Failed to fetch org chart');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddMember = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) { toast.error('Name is required'); return; }
    if (!form.email.trim()) { toast.error('Email is required'); return; }
    if (!form.password || form.password.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    if (!form.role) { toast.error('Role is required'); return; }

    if (!isAdmin) {
      const selectedRole = ALL_ROLES.find(r => r.name === form.role);
      if (selectedRole && selectedRole.level <= (user?.roleLevel || 0)) {
        toast.error('You can only add members with a lower role than yours');
        return;
      }
    }

    setSubmitting(true);
    try {
      await api.post('/admin/users', {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        password: form.password,
        role: form.role,
        superior: form.superior || user?._id,
      });
      toast.success('Team member added successfully');
      setShowModal(false);
      setForm({ firstName: '', lastName: '', email: '', password: '', role: availableRoles[0] || defaultRole, superior: '' });
      fetchTeamData();
      fetchOrgChart();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to add team member');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredReports = teamData?.directReports?.filter(member =>
    member.firstName?.toLowerCase().includes(search.toLowerCase()) ||
    member.lastName?.toLowerCase().includes(search.toLowerCase()) ||
    member.role?.toLowerCase().includes(search.toLowerCase()) ||
    member.email?.toLowerCase().includes(search.toLowerCase())
  ) || [];

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <h1 className="text-3xl font-bold">Team</h1>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2"><CardSkeleton /></div>
            <div><CardSkeleton /></div>
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
            <h1 className="text-3xl font-bold">Team</h1>
            <p className="text-muted-foreground">Manage your team and view organizational structure</p>
          </div>
          {(isSuperior || isAdmin) && (
            <Button onClick={() => setShowModal(true)}>
              <UserPlus className="mr-2 h-4 w-4" />
              Add Team Member
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">

            {/* Your Manager card — static, not clickable for anyone */}
            {teamData?.superior && (
              <Card className="bg-card border-muted">
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground">Your Manager</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/50">
                    <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center text-slate-300 text-lg">
                      {teamData.superior.firstName?.[0]}{teamData.superior.lastName?.[0]}
                    </div>
                    <div>
                      <p className="font-medium text-slate-100">
                        {teamData.superior.firstName} {teamData.superior.lastName}
                      </p>
                      <p className="text-sm text-muted-foreground">{teamData.superior.role}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="bg-card border-muted">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Direct Reports</CardTitle>
                  <div className="relative w-64">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                    <Input
                      placeholder="Search team members..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-10 bg-muted border-slate-700"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {filteredReports.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>{search ? 'No team members found' : 'No direct reports yet'}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredReports.map((member) => {
                      const isActive = member.isActive !== false;
                      return (
                        <div
                          key={member._id}
                          className="flex items-center justify-between p-4 rounded-lg bg-muted/50 hover:bg-muted cursor-pointer transition-colors group"
                          onClick={() => router.push(`/team/${member._id}`)}
                        >
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center text-slate-300 text-lg">
                              {member.firstName?.[0]}{member.lastName?.[0]}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-slate-100">{member.firstName} {member.lastName}</p>
                                <ArrowUpRight className="h-4 w-4 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                              <p className="text-sm text-muted-foreground">{member.role}</p>
                              <p className="text-xs text-slate-500">{member.email}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge className={isActive ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}>
                              {isActive ? 'Active' : 'Inactive'}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => { e.stopPropagation(); window.location.href = `mailto:${member.email}`; }}
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            >
                              <Mail className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="bg-card border-muted">
              <CardHeader><CardTitle>Organization</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[300px] overflow-hidden">
                  {orgChartData.length > 0 ? (
                    <OrgChart data={orgChartData} />
                  ) : (
                    <div className="flex items-center justify-center h-full text-slate-500">
                      No org chart data
                    </div>
                  )}
                </div>
                <Button
                  variant="outline"
                  className="w-full mt-4 border-slate-700"
                  onClick={() => router.push('/team/org-chart')}
                >
                  View Full Org Chart
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-card border-muted">
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">Team Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Total Members</span>
                  <span className="font-medium">{teamData?.directReports?.length || 0}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Active</span>
                  <span className="font-medium text-green-400">
                    {teamData?.directReports?.filter(m => m.isActive !== false).length || 0}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Inactive</span>
                  <span className="font-medium text-slate-500">
                    {teamData?.directReports?.filter(m => m.isActive === false).length || 0}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Add Team Member Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/60" onClick={() => setShowModal(false)} />
          <div className="relative z-50 bg-card border border-slate-700 rounded-xl p-6 w-full max-w-md mx-4 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">Add Team Member</h2>
              <Button variant="ghost" size="icon" onClick={() => setShowModal(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">First Name *</label>
                  <Input
                    placeholder="John"
                    value={form.firstName}
                    onChange={e => setForm({ ...form, firstName: e.target.value })}
                    className="bg-muted border-slate-700"
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Last Name *</label>
                  <Input
                    placeholder="Doe"
                    value={form.lastName}
                    onChange={e => setForm({ ...form, lastName: e.target.value })}
                    className="bg-muted border-slate-700"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Email *</label>
                <Input
                  type="email"
                  placeholder="john@company.com"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  className="bg-muted border-slate-700"
                />
              </div>

              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Password *</label>
                <Input
                  type="password"
                  placeholder="Min 6 characters"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  className="bg-muted border-slate-700"
                />
              </div>

              <div>
                <label className="text-sm text-muted-foreground mb-1 block">
                  Role * {!isAdmin && <span className="text-xs text-slate-500">(roles below your level only)</span>}
                </label>
                <select
                  value={form.role}
                  onChange={e => setForm({ ...form, role: e.target.value })}
                  className="w-full rounded-md bg-muted border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {availableRoles.length > 0 ? (
                    availableRoles.map(r => <option key={r} value={r}>{r}</option>)
                  ) : (
                    <option disabled>No roles available</option>
                  )}
                </select>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1 border-slate-700" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleAddMember}
                disabled={submitting || availableRoles.length === 0}
              >
                {submitting ? 'Adding...' : 'Add Member'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}