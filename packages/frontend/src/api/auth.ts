import { api } from '@/api/_api';

export const getSignupsOpen = async (): Promise<{ signupsOpen: boolean }> => api.get('/auth/signups-open');

export const getAuthFeatures = async (): Promise<{ emailEnabled: boolean }> => api.get('/auth/features');
