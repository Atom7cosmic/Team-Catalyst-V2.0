'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { AdminGuard } from '@/components/guards/RouteGuard';
import DashboardLayout from '@/components/layout/DashboardLayout';
import AdminDashboard from '@/components/dashboard/AdminDashboard';

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
