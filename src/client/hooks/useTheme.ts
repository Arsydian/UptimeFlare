import { useEffect, useState } from 'react';
import { ThemePreference } from '../types';

const STORAGE_KEY = 'uptimeflare_theme_preference';

export function computeTimeBasedTheme(date = new Date()): 'light' | 'dark' {
  const hour = date.getHours();
  // 06:00 AM to 06:59 PM (18:59) local user time -> Light Mode; 07:00 PM to 05:59 AM -> Dark Mode
  return hour >= 6 && hour < 19 ? 'light' : 'dark';
}

export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as ThemePreference | null;
      if (saved === 'auto' || saved === 'light' || saved === 'dark') {
        return saved;
      }
    } catch {
      // ignore storage errors
    }
    return 'auto';
  });

  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() =>
    preference === 'auto' ? computeTimeBasedTheme() : preference
  );

  const setPreference = (next: ThemePreference) => {
    setPreferenceState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const updateResolved = () => {
      const target = preference === 'auto' ? computeTimeBasedTheme() : preference;
      setResolvedTheme(target);
      document.documentElement.setAttribute('data-theme', target);
    };

    updateResolved();

    if (preference === 'auto') {
      const timer = setInterval(updateResolved, 30000);
      return () => clearInterval(timer);
    }
  }, [preference]);

  return {
    preference,
    resolvedTheme,
    setPreference,
  };
}
