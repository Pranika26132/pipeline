// Shared by the Find panel (client) and lib/find.ts (server).
export const FIND_MAX_SEARCHES = 10;
export const FIND_MAX_RESULTS = 12;
export const FIND_REQUEST_MAX = 300;
// $10 per 1,000 searches, plus the model reading the results.
export const FIND_COST_NOTE = "about 10 to 20 cents";

// A company Find proposes and confirmed on its own website.
export type FoundCompany = {
  name: string;
  url: string;
  domain: string;
  // From the company's own home page.
  description: string;
  why: string;
  // The search result the company was found in.
  source_url: string;
  // Matches with your school, hometown or region, each with the exact
  // sentence and the page it's on. Only these are shown as connections.
  connections: FindConnection[];
};

// A founder's school or hometown (`person` set), or an office/HQ location.
export type FindConnection = {
  kind: "school" | "hometown" | "office";
  value: string;
  person: string | null;
  quote: string;
  source_url: string;
};
