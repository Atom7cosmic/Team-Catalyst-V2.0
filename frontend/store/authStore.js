import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api from '@/lib/axios';

// Set cookies so Next.js middleware can read role server-side
const setAuthCookies = (user) => {
  if (typeof document === 'undefined') return;
  const maxAge = 7 * 24 * 60 * 60;
  document.cookie = `auth_role=${user.role}; path=/; max-age=${maxAge}; SameSite=Lax`;
  document.cookie = `auth_role_level=${user.roleLevel}; path=/; max-age=${maxAge}; SameSite=Lax`;
  document.cookie = `auth_is_admin=${user.isAdmin}; path=/; max-age=${maxAge}; SameSite=Lax`;
  document.cookie = `accessToken=present; path=/; max-age=${maxAge}; SameSite=Lax`;
};

const clearAuthCookies = () => {
  if (typeof document === 'undefined') return;
  ['auth_role', 'auth_role_level', 'auth_is_admin', 'accessToken'].forEach(name => {
    document.cookie = `${name}=; path=/; max-age=0`;
  });
};

const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
          const response = await api.post('/auth/login', { email, password });
          const { accessToken, user } = response.data;

          localStorage.setItem('accessToken', accessToken);
          localStorage.setItem('user', JSON.stringify(user));

          // Set cookies for middleware
          setAuthCookies(user);

          set({ user, isAuthenticated: true, isLoading: false });
          return { success: true };
        } catch (error) {
          set({
            error: error.response?.data?.message || 'Login failed',
            isLoading: false,
          });
          return { success: false, error: error.response?.data?.message };
        }
      },

      logout: async () => {
        try {
          await api.post('/auth/logout');
        } catch (error) {
          console.error('Logout error:', error);
        }
        localStorage.removeItem('accessToken');
        localStorage.removeItem('user');
        clearAuthCookies();
        set({ user: null, isAuthenticated: false, error: null });
      },

      refreshUser: async () => {
        try {
          const response = await api.get('/auth/me');
          const { user } = response.data;
          localStorage.setItem('user', JSON.stringify(user));
          // Always refresh cookies with latest user data
          setAuthCookies(user);
          set({ user, isAuthenticated: true });
          return user;
        } catch (error) {
          console.error('Failed to refresh user:', error);
          clearAuthCookies();
          set({ user: null, isAuthenticated: false });
          return null;
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'auth-storage',
    }
  )
);

export default useAuthStore;