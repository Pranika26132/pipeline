// Shared by the form (checked before upload) and the server action.
// Server actions reject bodies over 1 MB, so stay well under that.
export const CSV_MAX_BYTES = 500 * 1024;
export const CSV_MAX_ROWS = 500;
