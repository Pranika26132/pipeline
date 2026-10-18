// Shared by the resume upload (client) and lib/resume.ts (server).
// Vercel refuses request bodies over 4.5 MB before they reach the route, so
// the limit is 4 MB rather than 5.
export const RESUME_MAX_BYTES = 4 * 1024 * 1024;
