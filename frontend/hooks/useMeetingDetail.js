'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { getSocket, joinRoom, leaveRoom, disconnectSocket } from '@/lib/socket';
import api from '@/lib/axios';

const RECONNECT_FALLBACK_MS = 8000;

export function useMeetingDetail(meetingId) {
  const [meeting, setMeeting] = useState(null);
  const [processingStatus, setProcessingStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const socketRef = useRef(null);
  const mountedRef = useRef(true);
  const joinedRoomRef = useRef(false);
  
  const refreshRef = useRef(null);
  const cleanupRef = useRef(null);

  const fetchMeeting = useCallback(async () => {
    try {
      const res = await api.get(`/meetings/${meetingId}`);
      if (mountedRef.current) setMeeting(res.data.meeting);
    } catch (e) {
      if (mountedRef.current) setError(e?.response?.data?.message || 'Failed to load meeting');
    }
  }, [meetingId]);

  const fetchProcessingStatus = useCallback(async () => {
    try {
      const res = await api.get(`/meetings/${meetingId}/processing-status`);
      if (mountedRef.current) {
        setProcessingStatus(res.data);
        if (res.data.status === 'ready') {
          fetchMeeting(); // Re-fetch meeting when processing completes
        }
      }
    } catch (e) {
      console.warn('processing-status fetch failed:', e.message);
    }
  }, [meetingId, fetchMeeting]);

  const setupSocket = useCallback(() => {
    const socket = getSocket();
    socketRef.current = socket;

    // Get the current user ID to join the room properly
    let userId = null;
    if (typeof window !== 'undefined') {
      try {
        const userStr = localStorage.getItem('user');
        if (userStr) {
          userId = JSON.parse(userStr)._id;
        }
      } catch (e) {}
    }

    if (!joinedRoomRef.current) {
      joinRoom(meetingId, userId);
      joinedRoomRef.current = true;
    }

    const onProcessingUpdate = (data) => {
      if (!mountedRef.current) return;
      setProcessingStatus(prev => ({ ...prev, ...data }));
      if (data.status === 'ready') {
        fetchMeeting();
      }
    };

    socket.on('processing-update', onProcessingUpdate);

    const onAuthError = async (err) => {
      if (err?.status === 401 || err?.message?.includes('unauthorized')) {
        await refreshRef.current?.();
      }
    };
    socket.on('error', onAuthError);

    const onDisconnect = (reason) => {
      joinedRoomRef.current = false;
      if (!mountedRef.current) return;
      if (reason === 'io server disconnect') {
        setTimeout(() => {
          if (mountedRef.current) refreshRef.current?.();
        }, 1000);
      } else {
        setTimeout(() => {
          if (mountedRef.current) fetchProcessingStatus();
        }, RECONNECT_FALLBACK_MS);
      }
    };
    socket.on('disconnect', onDisconnect);

    const onReconnect = () => {
      if (!mountedRef.current) return;
      joinRoom(meetingId, userId);
      joinedRoomRef.current = true;
      fetchProcessingStatus();
    };
    socket.io.on('reconnect', onReconnect);

    return () => {
      socket.off('processing-update', onProcessingUpdate);
      socket.off('error', onAuthError);
      socket.off('disconnect', onDisconnect);
      socket.io.off('reconnect', onReconnect);
    };
  }, [meetingId, fetchProcessingStatus, fetchMeeting]);

  const refreshTokenAndReconnect = useCallback(async () => {
    try {
      await api.post('/auth/refresh');
    } catch (e) {
      console.warn('Token refresh failed — user may need to re-login:', e.message);
      return;
    }

    disconnectSocket();
    joinedRoomRef.current = false;

    await new Promise(r => setTimeout(r, 500));
    
    cleanupRef.current?.();
    cleanupRef.current = setupSocket();
  }, [setupSocket]);

  refreshRef.current = refreshTokenAndReconnect;

  useEffect(() => {
    mountedRef.current = true;

    const init = async () => {
      setIsLoading(true);
      await Promise.all([fetchMeeting(), fetchProcessingStatus()]);
      if (mountedRef.current) setIsLoading(false);
    };

    init();
    cleanupRef.current = setupSocket();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && mountedRef.current) {
        fetchMeeting();
        fetchProcessingStatus();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      cleanupRef.current?.();
      
      let userId = null;
      if (typeof window !== 'undefined') {
        try {
          const userStr = localStorage.getItem('user');
          if (userStr) userId = JSON.parse(userStr)._id;
        } catch (e) {}
      }
      try {
        leaveRoom(meetingId, userId);
        joinedRoomRef.current = false;
      } catch (_) {}
    };
  }, [meetingId, fetchMeeting, fetchProcessingStatus, setupSocket]);

  return { meeting, processingStatus, isLoading, error, refetch: fetchMeeting, setMeeting, setProcessingStatus };
}
