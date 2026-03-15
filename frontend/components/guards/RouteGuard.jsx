'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export function AdminGuard({ children }) {
  const { isAdmin, isLoading, initialized } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (initialized && !isLoading && !isAdmin) {
      router.replace('/dashboard');
    }
  }, [isAdmin, isLoading, initialized]);

  if (isLoading || !initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAdmin) return null;
  return children;
}

export function SuperiorGuard({ children }) {
  const { isSuperior, isLoading, initialized } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (initialized && !isLoading && !isSuperior) {
      router.replace('/dashboard');
    }
  }, [isSuperior, isLoading, initialized]);

  if (isLoading || !initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isSuperior) return null;
  return children;
}

export function AuthGuard({ children }) {
  const { isAuthenticated, isLoading, initialized } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (initialized && !isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, isLoading, initialized]);

  if (isLoading || !initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) return null;
  return children;
}