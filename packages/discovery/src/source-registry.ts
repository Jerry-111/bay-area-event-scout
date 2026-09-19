import { normalizeMatchText, type ProfileSource, type ScoutProfile } from "@event-scout/shared";
import type { SourceType } from "./types.js";

export type RegistrySourceKind =
  | "luma_calendar"
  | "rss_feed"
  | "event_digest"
  | "organizer_site"
  | "indexed_source"
  | "x_account";

export type RegistrySourcePriority = "must_scan" | "high" | "medium" | "paused";

export interface RegistrySource {
  id: string;
  name: string;
  kind: RegistrySourceKind;
  priority: RegistrySourcePriority;
  url?: string;
  feedUrl?: string;
  handle?: string;
  queryText?: string;
  includeDomains?: string[];
  sourceScore?: number;
  maxCandidateLinks?: number;
  tags: string[];
  notes?: string;
}

export const FREE_PUBLIC_SOURCES: RegistrySource[] = [
  {
    id: "luma-discover-sf-ai",
    name: "Luma SF AI Discover",
    kind: "luma_calendar",
    priority: "high",
    url: "https://luma.com/discover/sf/ai",
    queryText: 'site:luma.com/discover/sf/ai ("AI" OR "founder" OR "builders") -hackathon -buildathon -"hack night"',
    includeDomains: ["luma.com"],
    tags: ["luma", "ai", "sf", "discover"],
    notes: "Public Luma AI discovery surface for San Francisco."
  },
  {
    id: "luma-sf",
    name: "Luma San Francisco",
    kind: "luma_calendar",
    priority: "must_scan",
    url: "https://lu.ma/sf",
    queryText: 'site:lu.ma/sf ("AI" OR "founder" OR "builder" OR "startup")',
    includeDomains: ["lu.ma"],
    tags: ["luma", "sf", "discover"]
  },
  {
    id: "luma-ai",
    name: "Luma AI",
    kind: "luma_calendar",
    priority: "medium",
    url: "https://lu.ma/ai",
    queryText: 'site:lu.ma/ai ("San Francisco" OR "SF" OR "Bay Area") -hackathon -buildathon -"hack night"',
    includeDomains: ["lu.ma"],
    tags: ["luma", "ai", "discover"]
  },
  {
    id: "luma-bay-area-ai",
    name: "Bay Area AI",
    kind: "luma_calendar",
    priority: "high",
    url: "https://luma.com/_ai",
    queryText: 'site:luma.com/_ai ("AI" OR "LLM" OR "agents" OR "founder" OR "builders") ("San Francisco" OR "SF" OR "Bay Area") -hackathon -buildathon -"hack night"',
    includeDomains: ["luma.com"],
    tags: ["luma", "ai", "bay_area", "aggregator"],
    notes: "Starter Guide AI events bookmark; broader Bay Area AI Luma calendar for recall beyond SF-only surfaces."
  },
  {
    id: "luma-founders-inc",
    name: "Founders, Inc. Events",
    kind: "luma_calendar",
    priority: "must_scan",
    url: "https://luma.com/fdotinc",
    queryText: 'site:luma.com/fdotinc ("Founders Inc" OR "Open Campus" OR "demo" OR "mixer" OR "dinner")',
    includeDomains: ["luma.com"],
    tags: ["luma", "founder_house", "ai_builders", "sf"],
    notes: "Strong recurring builder/founder campus events."
  },
  {
    id: "luma-cerebral-valley",
    name: "Cerebral Valley",
    kind: "luma_calendar",
    priority: "high",
    url: "https://luma.com/cerebralvalley_",
    queryText: 'site:luma.com/cerebralvalley_ ("AI" OR "founder" OR "builder")',
    includeDomains: ["luma.com"],
    tags: ["luma", "ai", "community", "sf"]
  },
  {
    id: "luma-bond-ai",
    name: "Sahar Mor / Bond AI",
    kind: "luma_calendar",
    priority: "must_scan",
    url: "https://luma.com/genai-sf",
    queryText: 'site:luma.com/genai-sf ("Bond AI" OR "Sahar Mor" OR "AI founders" OR "builders")',
    includeDomains: ["luma.com"],
    tags: ["luma", "ai", "founders", "operator"],
    notes: "Large public Bond AI SF/Bay Area calendar; stronger than the host-profile fallback."
  },
  {
    id: "luma-bond-ai-host",
    name: "Sahar Mor / Bond AI Host",
    kind: "luma_calendar",
    priority: "high",
    url: "https://luma.com/user/saharmor",
    queryText: 'site:luma.com ("Sahar Mor" OR "Bond AI") ("San Francisco" OR "Bay Area" OR "AI")',
    includeDomains: ["luma.com"],
    tags: ["luma", "ai", "founders", "operator"],
    notes: "Host profile fallback for co-hosted AI founder/operator events."
  },
  {
    id: "luma-bay-area-founders-club",
    name: "Bay Area Founders Club",
    kind: "luma_calendar",
    priority: "must_scan",
    url: "https://luma.com/bfc",
    queryText: 'site:luma.com ("Bay Area Founders Club" OR "BFC" OR "Dr. Paul Fang") ("AI" OR "founder" OR "startup")',
    includeDomains: ["luma.com"],
    tags: ["luma", "founders", "vc", "newsletter"]
  },
  {
    id: "luma-yc-startup-school",
    name: "YC Startup School Calendar",
    kind: "luma_calendar",
    priority: "paused",
    url: "https://luma.com/ycss",
    queryText: 'site:luma.com ("YC Startup School" OR "Startup School") ("founder" OR "AI" OR "afterparty")',
    includeDomains: ["luma.com"],
    tags: ["luma", "yc", "founders", "sf"]
  },
  {
    id: "luma-startx",
    name: "StartX & Friends",
    kind: "luma_calendar",
    priority: "high",
    url: "https://luma.com/StartX",
    queryText: 'site:luma.com ("StartX" OR "Stanford") ("founder" OR "AI" OR "startup" OR "breakfast")',
    includeDomains: ["luma.com"],
    tags: ["luma", "stanford", "founders", "palo_alto"]
  },
  {
    id: "luma-ai-events-sf",
    name: "AI Events - San Francisco",
    kind: "luma_calendar",
    priority: "must_scan",
    url: "https://luma.com/ai-sf",
    queryText: 'site:luma.com/ai-sf ("AI" OR "LLM" OR "agents" OR "founder" OR "builder")',
    includeDomains: ["luma.com"],
    tags: ["luma", "ai", "sf", "aggregator"],
    notes: "Superscout AI events calendar with broad SF AI coverage."
  },
  {
    id: "luma-ai-tinkerers-sf",
    name: "AI Tinkerers San Francisco",
    kind: "luma_calendar",
    priority: "must_scan",
    url: "https://luma.com/calendar/cal-nMqbWGTGmLVubAx",
    queryText: 'site:luma.com ("AI Tinkerers San Francisco" OR "AI Tinkerers SF") ("demo" OR "builders" OR "agents" OR "LLM")',
    includeDomains: ["luma.com"],
    tags: ["luma", "ai", "builders", "technical", "sf"],
    notes: "High-signal technical builder community; many small demo/tinkering events."
  },
  {
    id: "luma-ai-engineers-sf",
    name: "AI Engineers - SF",
    kind: "luma_calendar",
    priority: "high",
    url: "https://luma.com/sfaiengineers",
    queryText: 'site:luma.com/sfaiengineers ("AI engineers" OR "AI builders" OR "agents" OR "LLM")',
    includeDomains: ["luma.com"],
    tags: ["luma", "ai", "engineers", "sf"]
  },
  {
    id: "luma-ml-sf",
    name: "Machine Learning - San Francisco and Bay Area",
    kind: "luma_calendar",
    priority: "high",
    url: "https://luma.com/ML-SF",
    queryText: 'site:luma.com/ML-SF ("founders" OR "devs" OR "researchers" OR "VCs" OR "fine tuning" OR "internal data")',
    includeDomains: ["luma.com"],
    tags: ["luma", "ml", "ai", "founders", "bay_area"]
  },
  {
    id: "luma-south-park-commons",
    name: "South Park Commons",
    kind: "luma_calendar",
    priority: "must_scan",
    url: "https://luma.com/southparkcommons-events",
    queryText: 'site:luma.com/southparkcommons-events ("South Park Commons" OR "SPC") ("AI" OR "founder" OR "demo" OR "mixer" OR "open house")',
    includeDomains: ["luma.com"],
    tags: ["luma", "spc", "founders", "builders", "sf"],
    notes: "SPC public calendar; very strong for -1 to 0 founder and technical rooms."
  },
  {
    id: "luma-inception-studio",
    name: "Inception Studio Events",
    kind: "luma_calendar",
    priority: "must_scan",
    url: "https://luma.com/inception-studio",
    queryText: 'site:luma.com/inception-studio ("Inception Studio" OR "Demo Day" OR "Co-Founder Matching" OR "Startup Showcase")',
    includeDomains: ["luma.com"],
    tags: ["luma", "accelerator", "demo_day", "founders", "sf"],
    notes: "Demo days, startup showcases, and co-founder matching in SF/Palo Alto."
  },
  {
    id: "luma-foundersbay",
    name: "Founders Bay",
    kind: "luma_calendar",
    priority: "must_scan",
    url: "https://luma.com/foundersbay",
    queryText: 'site:luma.com/foundersbay ("Founders Bay" OR "AI Happy Hour" OR "founder" OR "investor")',
    includeDomains: ["luma.com"],
    tags: ["luma", "founders", "vc", "ai", "sf"]
  },
  {
    id: "luma-bfc-palo-alto",
    name: "Bay Area Founders Club Palo Alto",
    kind: "luma_calendar",
    priority: "high",
    url: "https://luma.com/bfcpaloalto",
    queryText: 'site:luma.com/bfcpaloalto ("Bay Area Founders Club" OR "BFC") ("AI" OR "VC" OR "founder" OR "startup")',
    includeDomains: ["luma.com"],
    tags: ["luma", "founders", "vc", "palo_alto"],
    notes: "Alternate BFC calendar that often exposes Peninsula/Silicon Valley events."
  },
  {
    id: "luma-founders-cafe",
    name: "Founders Cafe",
    kind: "luma_calendar",
    priority: "high",
    url: "https://luma.com/founderscafe",
    queryText: 'site:luma.com/founderscafe ("Founders Cafe" OR "AngelList") ("networking" OR "founder" OR "investor" OR "demo" OR "breakfast")',
    includeDomains: ["luma.com"],
    tags: ["luma", "founders", "investors", "networking", "sf"],
    notes: "AngelList Founders Cafe calendar; strong small-room founder/investor networking signal."
  },
  {
    id: "founders-cafe-official",
    name: "Founders Cafe Official Events",
    kind: "organizer_site",
    priority: "must_scan",
    url: "https://90.gold/events",
    queryText: 'site:90.gold/events ("Founder" OR "AngelList" OR "GP" OR "investor" OR "demo day" OR "AI")',
    includeDomains: ["90.gold"],
    tags: ["founders_cafe", "angellist", "venue", "founders", "investors", "sf"],
    notes: "Official 90 Gold / Founders Cafe event page; exposes curated founder, GP, demo, and Luma RSVP links."
  },
  {
    id: "luma-aws-builder-loft",
    name: "AWS Builder Loft Events - San Francisco",
    kind: "luma_calendar",
    priority: "high",
    url: "https://luma.com/aws-builder-loft-events",
    queryText: 'site:luma.com/aws-builder-loft-events ("AWS Builder Loft" OR "agentic AI" OR "pitch" OR "demo" OR "founder" OR "networking")',
    includeDomains: ["luma.com"],
    tags: ["luma", "aws", "builders", "ai", "sf"],
    notes: "Public Luma mirror for AWS Builder Loft; registrations often resolve to the AWS page."
  },
  {
    id: "luma-frontier-tower",
    name: "Frontier Tower",
    kind: "luma_calendar",
    priority: "high",
    url: "https://luma.com/frontiertower",
    queryText: 'site:luma.com/frontiertower ("Frontier Tower" OR "AI" OR "frontier" OR "founder" OR "VC")',
    includeDomains: ["luma.com"],
    tags: ["luma", "frontier", "ai", "founders", "sf"]
  },
  {
    id: "luma-frontier-syndicate",
    name: "The Frontier Syndicate",
    kind: "luma_calendar",
    priority: "high",
    url: "https://luma.com/frontiersyndicate",
    queryText: 'site:luma.com/frontiersyndicate ("Frontier Syndicate" OR "frontier research" OR "paper discussion" OR "AI")',
    includeDomains: ["luma.com"],
    tags: ["luma", "frontier", "research", "ai", "sf"],
    notes: "Frontier tech researchers/builders/executives/investors; good for paper dinners and technical salons."
  },
  {
    id: "luma-pebblebed-events",
    name: "Pebblebed Events",
    kind: "luma_calendar",
    priority: "high",
    url: "https://luma.com/calendar/cal-mdEwCbO9zZBtrtm",
    queryText: 'site:luma.com ("Pebblebed Events" OR "Pebblebed") ("builders" OR "AI" OR "founder" OR "research")',
    includeDomains: ["luma.com"],
    tags: ["luma", "vc", "builders", "ai", "sf"]
  },
  {
    id: "luma-agi-house",
    name: "Ascension by AGI House SF",
    kind: "luma_calendar",
    priority: "high",
    url: "https://luma.com/agi-house",
    queryText: 'site:luma.com/agi-house ("AGI House" OR "Ascension" OR "AI" OR "founder" OR "salon")',
    includeDomains: ["luma.com"],
    tags: ["luma", "agi_house", "ai", "founders", "sf"]
  },
  {
    id: "luma-aicamp",
    name: "AICamp",
    kind: "luma_calendar",
    priority: "high",
    url: "https://luma.com/aicamp",
    queryText: 'site:luma.com/aicamp ("AICamp" OR "AI Camp" OR "developer" OR "agentic" OR "LLM")',
    includeDomains: ["luma.com"],
    tags: ["luma", "ai", "developers", "community"]
  },
  {
    id: "luma-llama-lounge",
    name: "Llama Lounge",
    kind: "luma_calendar",
    priority: "high",
    url: "https://luma.com/llamalounge",
    queryText: 'site:luma.com/llamalounge ("Llama Lounge" OR "AI Startup" OR "founders" OR "funders" OR "demo")',
    includeDomains: ["luma.com"],
    tags: ["luma", "ai", "startups", "vc", "sf"]
  },
  {
    id: "luma-openstages",
    name: "OpenStages Calendar",
    kind: "luma_calendar",
    priority: "high",
    url: "https://luma.com/openstages",
    queryText: 'site:luma.com/openstages ("OpenStages" OR "AI x SaaS" OR "GTM" OR "VC" OR "founders")',
    includeDomains: ["luma.com"],
    tags: ["luma", "gtm", "ai", "saas", "vc", "sf"]
  },
  {
    id: "luma-founder-social-club",
    name: "Founder Social Club",
    kind: "luma_calendar",
    priority: "high",
    url: "https://luma.com/foundersocialclub",
    queryText: 'site:luma.com/foundersocialclub ("Founder Social Club" OR "founder" OR "mixer" OR "GP" OR "LP" OR "rooftop")',
    includeDomains: ["luma.com"],
    tags: ["luma", "founders", "networking", "vc", "sf"],
    notes: "Networking-heavy founder community with in-person mixers and GP/LP/founder rooms."
  },
  {
    id: "luma-brderless",
    name: "Brderless",
    kind: "luma_calendar",
    priority: "high",
    url: "https://luma.com/brderless",
    queryText: 'site:luma.com/brderless ("Brderless" OR "Founder Dinner" OR "Founder Breakfast" OR "Product & Engineering Leaders")',
    includeDomains: ["luma.com"],
    tags: ["luma", "founders", "networking", "dinner", "sf"],
    notes: "Curated founder dinners and breakfasts; strong networking signal."
  },
  {
    id: "luma-rhoevents",
    name: "Rho Community Calendar",
    kind: "luma_calendar",
    priority: "high",
    url: "https://luma.com/rhoevents",
    queryText: 'site:luma.com/rhoevents ("Rho" OR "Founder Dinner" OR "Founder BBQ" OR "founder" OR "AI" OR "SF")',
    includeDomains: ["luma.com"],
    tags: ["luma", "founders", "networking", "finance", "sf"],
    notes: "Startup finance community calendar with founder dinners and SF founder gatherings."
  },
  {
    id: "luma-step-events",
    name: "Step Events",
    kind: "luma_calendar",
    priority: "high",
    url: "https://luma.com/StepEvents",
    queryText: 'site:luma.com/StepEvents ("Step SF" OR "founder" OR "VC" OR "pitch" OR "mixer" OR "AI")',
    includeDomains: ["luma.com"],
    tags: ["luma", "founders", "vc", "pitch", "networking", "sf"],
    notes: "Strong around Step SF and satellite networking events; seasonality can spike."
  },
  {
    id: "luma-b4sf",
    name: "Builders for San Francisco",
    kind: "luma_calendar",
    priority: "high",
    url: "https://luma.com/b4sf",
    queryText: 'site:luma.com/b4sf ("Builders for San Francisco" OR "Startup Pitch Night" OR "founders" OR "investors" OR "networking")',
    includeDomains: ["luma.com"],
    tags: ["luma", "founders", "builders", "pitch", "networking", "sf"],
    notes: "Local founder/builder/investor community with pitch nights and curated networking."
  },
  {
    id: "luma-scalekit-agents",
    name: "Scalekit Agents in Production",
    kind: "luma_calendar",
    priority: "high",
    url: "https://luma.com/scalekitinc",
    queryText: 'site:luma.com/scalekitinc ("Agents in Production" OR "agent builders" OR "demo night" OR "bagels")',
    includeDomains: ["luma.com"],
    tags: ["luma", "agents", "developers", "ai", "sf"]
  },
  {
    id: "luma-genai-collective",
    name: "The AI Collective",
    kind: "luma_calendar",
    priority: "medium",
    url: "https://luma.com/genai-collective",
    queryText: 'site:luma.com/genai-collective ("AI Collective" OR "demo night" OR "founders" OR "operators" OR "investors")',
    includeDomains: ["luma.com"],
    tags: ["luma", "ai", "community", "demo_night"],
    notes: "Global community calendar; useful but can be broader/noisier than SF-only sources."
  },
  {
    id: "luma-founders-creative",
    name: "Founders Creative",
    kind: "luma_calendar",
    priority: "medium",
    url: "https://luma.com/founderscreative",
    queryText: 'site:luma.com/founderscreative ("Founders Creative" OR "AI founders" OR "investors" OR "operators" OR "Bay Area")',
    includeDomains: ["luma.com"],
    tags: ["luma", "ai", "founders", "investors", "bay_area"],
    notes: "AI founders/investors/operators network; keep medium because it includes non-Bay-Area and paid executive events."
  },
  {
    id: "luma-pitch-collections",
    name: "SF Pitch and Demo Events Collection",
    kind: "luma_calendar",
    priority: "medium",
    url: "https://luma.com/pitch_collections",
    queryText: 'site:luma.com/pitch_collections ("pitch" OR "demo" OR "startup" OR "founder" OR "investor")',
    includeDomains: ["luma.com"],
    tags: ["luma", "aggregator", "pitch", "demo", "sf"],
    notes: "Broad Luma collection for pitch/demo events; useful for recall, not precision."
  },
  {
    id: "luma-sf-tech-scene",
    name: "The San Francisco Tech Scene",
    kind: "luma_calendar",
    priority: "medium",
    url: "https://luma.com/thesanfranciscotechscene",
    queryText: 'site:luma.com/thesanfranciscotechscene ("founder" OR "tech mixer" OR "startup" OR "AI" OR "VC" OR "San Francisco")',
    includeDomains: ["luma.com"],
    tags: ["luma", "aggregator", "networking", "sf", "startup"],
    notes: "Broad SF tech scene aggregator; good recall for networking, but noisier."
  },
  {
    id: "luma-startup-founders",
    name: "Startup Founders Networking and Fun",
    kind: "luma_calendar",
    priority: "medium",
    url: "https://luma.com/startupfounders",
    queryText: 'site:luma.com/startupfounders ("Startup Founders" OR "founder drinks" OR "networking" OR "San Francisco")',
    includeDomains: ["luma.com"],
    tags: ["luma", "founders", "networking", "sf"],
    notes: "Founder networking calendar; can be lighter-weight, so keep as medium."
  },
  {
    id: "luma-eastbay-founders",
    name: "Silicon Valley East Bay Founders Meetups",
    kind: "luma_calendar",
    priority: "medium",
    url: "https://luma.com/eastbayfounders",
    queryText: 'site:luma.com/eastbayfounders ("East Bay Founders" OR "founders" OR "AI" OR "funding" OR "GTM")',
    includeDomains: ["luma.com"],
    tags: ["luma", "founders", "networking", "east_bay"],
    notes: "Founder networking outside SF core; useful when the event is AI/funding/GTM-heavy."
  },
  {
    id: "luma-x26",
    name: "X26",
    kind: "luma_calendar",
    priority: "medium",
    url: "https://luma.com/x26-whats-happening",
    queryText: 'site:luma.com/x26-whats-happening ("X26" OR "Founder Dinner" OR "startup operators" OR "investors" OR "San Francisco")',
    includeDomains: ["luma.com"],
    tags: ["luma", "founders", "operators", "networking", "sf"],
    notes: "xMcKinsey founder/operator network; narrower audience but high networking value."
  },
  {
    id: "luma-ai-user-group",
    name: "AI User Group",
    kind: "luma_calendar",
    priority: "medium",
    url: "https://luma.com/aiusergroup",
    queryText: 'site:luma.com/aiusergroup ("AI User Group" OR "AI" OR "LLM" OR "developers" OR "San Francisco")',
    includeDomains: ["luma.com"],
    tags: ["luma", "ai", "developers", "community"]
  },
  {
    id: "luma-homebrewclub",
    name: "Homebrew Club",
    kind: "luma_calendar",
    priority: "medium",
    url: "https://luma.com/homebrewclub",
    queryText: 'site:luma.com/homebrewclub ("Homebrew Club" OR "founders" OR "tinkerers" OR "builders")',
    includeDomains: ["luma.com"],
    tags: ["luma", "builders", "founders", "tinkerers"]
  },
  {
    id: "luma-tokensand",
    name: "tokens&",
    kind: "luma_calendar",
    priority: "medium",
    url: "https://luma.com/tokensand",
    queryText: 'site:luma.com/tokensand ("tokens&" OR "AI" OR "founders" OR "future of intelligence" OR "networking")',
    includeDomains: ["luma.com"],
    tags: ["luma", "ai", "community"]
  },
  {
    id: "luma-the-commons",
    name: "The SF Commons",
    kind: "luma_calendar",
    priority: "medium",
    url: "https://luma.com/thecommons",
    queryText: 'site:luma.com/thecommons ("The SF Commons" OR "Builders Night" OR "AI Research" OR "public")',
    includeDomains: ["luma.com"],
    tags: ["luma", "commons", "builders", "sf"],
    notes: "High local density but broader than startups/AI; downstream scoring should filter social/non-tech events."
  },
  {
    id: "luma-accountable-ai-sf",
    name: "Accountable AI - SF Chapter",
    kind: "luma_calendar",
    priority: "medium",
    url: "https://luma.com/accountable-ai-sf",
    queryText: 'site:luma.com/accountable-ai-sf ("Accountable AI" OR "autonomous agents" OR "governance" OR "production")',
    includeDomains: ["luma.com"],
    tags: ["luma", "ai", "governance", "agents", "sf"]
  },
  {
    id: "luma-echai-sf",
    name: "eChai SF Events",
    kind: "luma_calendar",
    priority: "medium",
    url: "https://luma.com/eChaiSF",
    queryText: 'site:luma.com/eChaiSF ("AI Founders" OR "founders" OR "investors" OR "operators" OR "GTM" OR "networking")',
    includeDomains: ["luma.com"],
    tags: ["luma", "founders", "networking", "gtm", "sf"],
    notes: "Free/open founder network with Bay Area AI/founder/operator events; medium due broader global footprint."
  },
  {
    id: "luma-brex-startup-community",
    name: "Brex Startup Community",
    kind: "luma_calendar",
    priority: "high",
    url: "https://lu.ma/brexevents",
    queryText: 'site:lu.ma/brexevents ("Brex Startup Community" OR "founder" OR "startup" OR "supper club" OR "AI" OR "investor")',
    includeDomains: ["lu.ma"],
    tags: ["luma", "founders", "startup", "operators", "sf"],
    notes: "Starter Guide source; Brex runs recurring founder clubs and dinners with high founder density."
  },
  {
    id: "luma-pitch-and-run",
    name: "Pitch & Run",
    kind: "luma_calendar",
    priority: "high",
    url: "https://luma.com/pnr",
    queryText: 'site:luma.com/pnr ("Pitch & Run" OR "founders" OR "angels" OR "VCs" OR "startup employees" OR "San Francisco")',
    includeDomains: ["luma.com"],
    tags: ["luma", "founders", "vc", "networking", "sf"],
    notes: "Starter Guide source; recurring founder/angel/VC running meetup with lower-pressure networking."
  },
  {
    id: "luma-founders-common",
    name: "Founders Common",
    kind: "luma_calendar",
    priority: "high",
    url: "https://lu.ma/founderscommon",
    queryText: 'site:lu.ma/founderscommon ("Founders Common" OR "founder" OR "builder" OR "coworking" OR "dinner" OR "AI")',
    includeDomains: ["lu.ma"],
    tags: ["luma", "founders", "builders", "community", "sf"],
    notes: "Asocial early-stage founder/builder community from the Starter Guide; good for third-space founder rooms."
  },
  {
    id: "luma-ai-hustle",
    name: "AI Hustle",
    kind: "luma_calendar",
    priority: "high",
    url: "https://lu.ma/user/usr-HGhLx5Y8wzhj0Oh",
    queryText: 'site:lu.ma ("AI Hustle" OR "Louisa Lu") ("AI founders" OR "VCs" OR "happy hour" OR "San Francisco")',
    includeDomains: ["lu.ma"],
    tags: ["luma", "ai", "founders", "vc", "networking", "sf"],
    notes: "Starter Guide source; recurring AI founder and VC happy hour series."
  },
  {
    id: "luma-sf-ai-agent-meetup",
    name: "SF AI Agent Meetup",
    kind: "luma_calendar",
    priority: "high",
    url: "https://lu.ma/cspedjbp",
    queryText: 'site:lu.ma/cspedjbp ("AI Agent" OR "agent developers" OR "engineers" OR "UX" OR "Ops" OR "San Francisco")',
    includeDomains: ["lu.ma"],
    tags: ["luma", "ai", "agents", "developers", "operators", "sf"],
    notes: "Starter Guide source; focused AI agent community for developers, engineers, UX, and operators."
  },
  {
    id: "luma-ai-after-hours-encord",
    name: "AI After Hours with Encord",
    kind: "luma_calendar",
    priority: "medium",
    url: "https://lu.ma/artificially-intelligent",
    queryText: 'site:lu.ma/artificially-intelligent ("AI After Hours" OR "Encord" OR "Maya Nayyar" OR "AI enthusiasts" OR "San Francisco")',
    includeDomains: ["lu.ma"],
    tags: ["luma", "ai", "networking", "sf"],
    notes: "Starter Guide source; AI networking meetup, useful when it has founder/operator density."
  },
  {
    id: "luma-ai-salon",
    name: "AI Salon",
    kind: "luma_calendar",
    priority: "medium",
    url: "https://lu.ma/ai-salon",
    queryText: 'site:lu.ma/ai-salon ("AI Salon" OR "AI" OR "founders" OR "operators" OR "San Francisco")',
    includeDomains: ["lu.ma"],
    tags: ["luma", "ai", "salon", "community", "sf"],
    notes: "Starter Guide source; conversation-focused AI community. Score higher only for local founder/operator rooms."
  },
  {
    id: "luma-sundays-in-sf",
    name: "Sundays in SF",
    kind: "luma_calendar",
    priority: "medium",
    url: "https://lu.ma/sundaysinsf",
    queryText: 'site:lu.ma/sundaysinsf ("Sundays in SF" OR "side projects" OR "builders" OR "coworking" OR "San Francisco")',
    includeDomains: ["lu.ma"],
    tags: ["luma", "builders", "coworking", "creative", "sf"],
    notes: "Weekly side-project coworking club; medium because it is broader than AI/founders but can surface builder relationships."
  },
  {
    id: "luma-sf-tech-poker",
    name: "SF Tech Poker",
    kind: "luma_calendar",
    priority: "medium",
    url: "https://lu.ma/sfpoker",
    queryText: 'site:lu.ma/sfpoker ("SF Tech Poker" OR "Tony" OR "poker night" OR "founders" OR "operators")',
    includeDomains: ["lu.ma"],
    tags: ["luma", "founders", "social", "networking", "sf"],
    notes: "Starter Guide source; social founder/operator room. Keep medium and let scoring require strong attendee evidence."
  },
  {
    id: "rss-founders-bay",
    name: "Founders Bay Newsletter",
    kind: "rss_feed",
    priority: "must_scan",
    url: "https://newsletter.foundersbay.com/",
    feedUrl: "https://newsletter.foundersbay.com/feed",
    queryText: 'site:newsletter.foundersbay.com ("Founders Bay" OR "This Week in AI" OR "Events Roundup" OR "Founder" OR "VC")',
    includeDomains: ["newsletter.foundersbay.com"],
    tags: ["newsletter", "sf", "ai", "founders", "events_roundup"]
  },
  {
    id: "rss-bay-area-founders-club",
    name: "Bay Area Founders Club Substack",
    kind: "rss_feed",
    priority: "must_scan",
    url: "https://bayareafoundersclub.substack.com/",
    feedUrl: "https://bayareafoundersclub.substack.com/feed",
    queryText: 'site:bayareafoundersclub.substack.com ("Bay Area Events" OR "AI" OR "founder" OR "startup")',
    includeDomains: ["bayareafoundersclub.substack.com"],
    tags: ["newsletter", "bfc", "founders", "ai"]
  },
  {
    id: "rss-brex-startup-community",
    name: "Brex Startup Community Newsletter",
    kind: "rss_feed",
    priority: "medium",
    url: "https://brex.beehiiv.com/",
    feedUrl: "https://brex.beehiiv.com/feed",
    queryText: 'site:brex.beehiiv.com ("Brex Startup Community" OR "events" OR "founders" OR "supper club" OR "San Francisco")',
    includeDomains: ["brex.beehiiv.com"],
    tags: ["newsletter", "brex", "founders", "startup"],
    notes: "Starter Guide source; newsletter companion to Brex Startup Community event calendar."
  },
  {
    id: "rss-kyosuke",
    name: "Kyosuke's Newsletter",
    kind: "rss_feed",
    priority: "high",
    url: "https://kyosuketogami.substack.com/",
    feedUrl: "https://kyosuketogami.substack.com/feed",
    queryText: 'site:kyosuketogami.substack.com ("Tech Events in SF Bay Area" OR "SF Tech Events") ("AI" OR "startup" OR "founder")',
    includeDomains: ["kyosuketogami.substack.com"],
    tags: ["newsletter", "sf", "founders", "meetup"]
  },
  {
    id: "rss-climate-tech-bay-area",
    name: "Climate Tech Bay Area",
    kind: "rss_feed",
    priority: "medium",
    url: "https://sfbayclimatetech.substack.com/",
    feedUrl: "https://sfbayclimatetech.substack.com/feed",
    queryText: 'site:sfbayclimatetech.substack.com ("Climate Tech Bay Area" OR "events" OR "founders" OR "startup" OR "AI")',
    includeDomains: ["sfbayclimatetech.substack.com"],
    tags: ["newsletter", "climate", "founders", "bay_area"],
    notes: "Starter Guide source; climate-tech event roundup, medium because it is adjacent unless AI/founder overlap is clear."
  },
  {
    id: "rss-eddies-list",
    name: "Eddie's List",
    kind: "rss_feed",
    priority: "medium",
    url: "https://eddieh.substack.com/",
    feedUrl: "https://eddieh.substack.com/feed",
    queryText: 'site:eddieh.substack.com ("SF" OR "San Francisco") ("events" OR "founder" OR "startup" OR "AI" OR "tech")',
    includeDomains: ["eddieh.substack.com"],
    tags: ["newsletter", "sf", "events", "community"],
    notes: "Starter Guide source for broader SF events; useful as a secondary discovery surface but noisier than tech-only calendars."
  },
  {
    id: "digest-times-of-sf",
    name: "Times of SF Events Digest",
    kind: "event_digest",
    priority: "high",
    url: "https://www.timesofsf.com/",
    feedUrl: "https://www.timesofsf.com/rss",
    queryText: 'site:timesofsf.com ("Bay Area builder" OR "VC events" OR "AI builders" OR "Luma")',
    includeDomains: ["timesofsf.com"],
    tags: ["event_digest", "sf", "vc", "builders"]
  },
  {
    id: "digest-foundercal-sf",
    name: "FounderCal SF",
    kind: "event_digest",
    priority: "paused",
    url: "https://foundercal.com/cities/sf",
    queryText: 'site:foundercal.com/cities/sf ("AI" OR "founder" OR "startup" OR "VC" OR "Luma")',
    includeDomains: ["foundercal.com"],
    tags: ["event_digest", "founders", "startup", "sf"],
    notes: "Paused from daily scans after repeated all-past result sets; use for manual backfill or source discovery only."
  },
  {
    id: "digest-tldr-events",
    name: "TLDR EVENTS",
    kind: "event_digest",
    priority: "high",
    url: "https://www.tldrevents.com/",
    queryText: 'site:tldrevents.com ("San Francisco" OR "Bay Area" OR "AI" OR "founder" OR "startup" OR "Luma")',
    includeDomains: ["tldrevents.com"],
    tags: ["event_digest", "sf", "ai", "startup"],
    notes: "Curated/ranked Bay Area tech event feed; useful for discovering repeat organizers."
  },
  {
    id: "digest-garys-guide-sf",
    name: "Gary's Guide SF",
    kind: "event_digest",
    priority: "high",
    url: "https://www.garysguide.com/events?region=sf",
    queryText: 'site:garysguide.com/events ("San Francisco" OR "SF") ("AI" OR "founder" OR "startup" OR "VC" OR "demo")',
    includeDomains: ["garysguide.com"],
    sourceScore: 88,
    maxCandidateLinks: 50,
    tags: ["event_digest", "sf", "tech", "startup", "aggregator"],
    notes: "Starter Guide source; long-running tech event aggregator. Keep high for recall, with downstream scoring filtering online/generic events."
  },
  {
    id: "digest-cerebral-valley-official",
    name: "Cerebral Valley Official Events",
    kind: "event_digest",
    priority: "high",
    url: "https://cerebralvalley.ai/events",
    queryText: 'site:cerebralvalley.ai/events ("Cerebral Valley" OR "AI" OR "founder" OR "builder" OR "San Francisco")',
    includeDomains: ["cerebralvalley.ai"],
    sourceScore: 90,
    maxCandidateLinks: 40,
    tags: ["event_digest", "ai", "founders", "sf", "cerebral_valley"],
    notes: "Starter Guide AI bookmark now redirects here; useful official event surface alongside indexed Luma searches."
  },
  {
    id: "digest-just-move-to-sf-events",
    name: "Just Move to SF Events",
    kind: "event_digest",
    priority: "high",
    url: "https://justmovetosf.com/events",
    queryText: 'site:justmovetosf.com/events ("AI" OR "founder dinner" OR "demo day" OR "investor mixer" OR "startup")',
    includeDomains: ["justmovetosf.com"],
    tags: ["event_digest", "founders", "sf", "calendar", "startup"],
    notes: "Founder-focused SF events calendar that reports public startup calendar syncs; useful as a meta-source for gaps."
  },
  {
    id: "digest-loomus-events",
    name: "LOOMUS Founders Bay Area Calendar",
    kind: "event_digest",
    priority: "high",
    url: "https://loomus.ai/events",
    queryText: 'site:loomus.ai/events ("AI Events" OR "founders" OR "rooms" OR "Luma" OR "San Francisco")',
    includeDomains: ["loomus.ai"],
    tags: ["event_digest", "ai", "founders", "sf"],
    notes: "Curated map of high-signal AI rooms; good source-discovery surface even when individual events are few."
  },
  {
    id: "digest-sam-events-tech",
    name: "Sam's Guide Tech & Startup",
    kind: "event_digest",
    priority: "must_scan",
    url: "https://sam.events/tech",
    queryText: 'site:sam.events/tech ("AI" OR "founder" OR "startup" OR "VC" OR "agent" OR "approval required")',
    includeDomains: ["sam.events"],
    sourceScore: 96,
    maxCandidateLinks: 80,
    tags: ["event_digest", "sf", "ai", "startup", "aggregator"],
    notes: "Community-built curated SF tech/startup index with hundreds of direct Luma and organizer links; treat as a top-tier recall source for AI/founder rooms."
  },
  {
    id: "digest-sam-events-this-week",
    name: "Sam's Guide This Week",
    kind: "event_digest",
    priority: "must_scan",
    url: "https://sam.events/this-week",
    queryText: 'site:sam.events/this-week ("AI" OR "founder" OR "startup" OR "VC" OR "agent" OR "approval required")',
    includeDomains: ["sam.events"],
    sourceScore: 96,
    maxCandidateLinks: 80,
    tags: ["event_digest", "sf", "ai", "startup", "weekly"],
    notes: "Seven-day SF/Bay Area tech event index; top-tier coverage source for near-term candidate discovery."
  },
  {
    id: "digest-sam-events-plan-ahead",
    name: "Sam's Guide Plan Ahead",
    kind: "event_digest",
    priority: "must_scan",
    url: "https://sam.events/plan-ahead",
    queryText: 'site:sam.events/plan-ahead ("AI" OR "founder" OR "startup" OR "VC" OR "dinner" OR "demo")',
    includeDomains: ["sam.events"],
    sourceScore: 94,
    maxCandidateLinks: 60,
    tags: ["event_digest", "sf", "ai", "startup", "plan_ahead"],
    notes: "Forward-looking SF tech event index for high-demand events and registration deadlines; important for catching events before they sell out."
  },
  {
    id: "digest-sam-events-free",
    name: "Sam's Guide Free",
    kind: "event_digest",
    priority: "high",
    url: "https://sam.events/free",
    queryText: 'site:sam.events/free ("AI" OR "founder" OR "startup" OR "VC" OR "agent" OR "approval required")',
    includeDomains: ["sam.events"],
    sourceScore: 90,
    maxCandidateLinks: 60,
    tags: ["event_digest", "sf", "ai", "startup", "free"],
    notes: "Free/pay-what-you-wish SF tech event index with clear conditions; high-recall source when budget or registration friction matters."
  },
  {
    id: "digest-sam-events-women",
    name: "Sam's Guide Women",
    kind: "event_digest",
    priority: "high",
    url: "https://sam.events/women",
    queryText: 'site:sam.events/women ("founder" OR "founders" OR "AI" OR "startup" OR "community rooms")',
    includeDomains: ["sam.events"],
    sourceScore: 88,
    maxCandidateLinks: 40,
    tags: ["event_digest", "sf", "founders", "women", "community"],
    notes: "Women-focused and women-led Bay Area event index; useful for founder dinners, meetups, and community rooms."
  },
  {
    id: "digest-sam-events-home",
    name: "Sam's Guide SF Events",
    kind: "event_digest",
    priority: "high",
    url: "https://sam.events/",
    queryText: 'site:sam.events ("SF Events" OR "Sam\'s guide") ("AI" OR "founder" OR "startup" OR "Luma" OR "Plan Ahead")',
    includeDomains: ["sam.events"],
    sourceScore: 90,
    maxCandidateLinks: 40,
    tags: ["event_digest", "sf", "ai", "startup", "aggregator"],
    notes: "Main curated SF events surface; use as a high-priority overview because it links to today's, weekly, free, women, and plan-ahead event clusters."
  },
  {
    id: "digest-techweek-dev",
    name: "TechWeek Calendar",
    kind: "event_digest",
    priority: "medium",
    url: "https://www.techweek.dev/",
    queryText: 'site:techweek.dev ("San Francisco" OR "Bay Area" OR "AI" OR "startup" OR "developer" OR "Luma")',
    includeDomains: ["techweek.dev"],
    tags: ["event_digest", "techweek", "sf", "startup"],
    notes: "Useful during Tech Week clusters; keep medium because seasonality can dominate."
  },
  {
    id: "digest-startup-school-after-hours",
    name: "Startup School After Hours",
    kind: "event_digest",
    priority: "paused",
    url: "https://startup-school-after-hours.timetoogo.chatgpt.site/",
    queryText: 'site:startup-school-after-hours.timetoogo.chatgpt.site ("founders" OR "AI" OR "investors" OR "RSVP")',
    includeDomains: ["startup-school-after-hours.timetoogo.chatgpt.site"],
    tags: ["event_digest", "yc", "afterparty", "sf"],
    notes: "Paused outside Startup School season; recent daily scans returned stale side-event links."
  },
  {
    id: "foundersbay-events-site",
    name: "Founders Bay Events",
    kind: "organizer_site",
    priority: "high",
    url: "https://foundersbay.com/events",
    queryText: 'site:foundersbay.com/events ("AI" OR "founder" OR "investor" OR "startup" OR "San Francisco")',
    includeDomains: ["foundersbay.com"],
    tags: ["founders", "ai", "vc", "sf"]
  },
  {
    id: "malaika-commons-events",
    name: "Malaika Commons Events",
    kind: "organizer_site",
    priority: "high",
    url: "https://malaikacommons.com/events",
    queryText: 'site:malaikacommons.com/events ("founder dinners" OR "investor events" OR "Founder Showcase" OR "AI" OR "GTM")',
    includeDomains: ["malaikacommons.com"],
    tags: ["founders", "investors", "gtm", "venue", "sf"],
    notes: "Founder-dense SF event and venue/community surface with dinners, investor events, workshops, and showcase formats."
  },
  {
    id: "founders-you-should-know",
    name: "Founders You Should Know",
    kind: "organizer_site",
    priority: "high",
    url: "https://foundersysk.com/",
    queryText: 'site:foundersysk.com ("Founders You Should Know" OR "showcase" OR "founders" OR "seed" OR "growth" OR "San Francisco")',
    includeDomains: ["foundersysk.com"],
    tags: ["founders", "showcase", "networking", "sf"],
    notes: "Starter Guide source; recurring showcase series for meeting strong seed-through-growth founders."
  },
  {
    id: "founders-brew",
    name: "Founders Brew",
    kind: "organizer_site",
    priority: "medium",
    url: "https://foundersbrew.org/",
    queryText: 'site:foundersbrew.org ("Founders Brew" OR "founders" OR "ambitious" OR "San Francisco" OR "SF")',
    includeDomains: ["foundersbrew.org"],
    tags: ["founders", "community", "networking", "sf"],
    notes: "Starter Guide source; founder community with intentionally informal gatherings. Medium because event evidence may be sparse."
  },
  {
    id: "building-humane-tech",
    name: "Building Humane Tech",
    kind: "organizer_site",
    priority: "medium",
    url: "https://www.buildinghumanetech.com/",
    queryText: 'site:buildinghumanetech.com ("Building Humane Tech" OR "events" OR "builders" OR "AI" OR "San Francisco")',
    includeDomains: ["buildinghumanetech.com"],
    tags: ["builders", "community", "ai", "responsible_ai", "sf"],
    notes: "Starter Guide source; useful for builders working on humane/responsible tech, but less founder-specific."
  },
  {
    id: "sapienne-ai",
    name: "Sapienne",
    kind: "organizer_site",
    priority: "medium",
    url: "https://www.sapienne.ai/",
    queryText: 'site:sapienne.ai ("Sapienne" OR "women building in AI" OR "founders" OR "cap tables" OR "San Francisco")',
    includeDomains: ["sapienne.ai"],
    tags: ["ai", "founders", "women", "investors", "sf"],
    notes: "Starter Guide source; women-in-AI founder/investor community, useful when events are public or have RSVP pages."
  },
  {
    id: "bootstrappers-breakfast-eventbrite",
    name: "Bootstrappers Breakfast",
    kind: "organizer_site",
    priority: "medium",
    url: "https://www.eventbrite.com/o/bootstrappers-breakfast-10771471165",
    queryText: 'site:eventbrite.com/o/bootstrappers-breakfast-10771471165 ("San Francisco" OR "Bay Area" OR "founders" OR "startup" OR "breakfast")',
    includeDomains: ["eventbrite.com"],
    tags: ["eventbrite", "founders", "breakfast", "bootstrapped", "bay_area"],
    notes: "Starter Guide source; recurring founder breakfast format, most relevant when local and active-founder focused."
  },
  {
    id: "work-on-climate",
    name: "Work on Climate",
    kind: "organizer_site",
    priority: "medium",
    url: "https://workonclimate.org/",
    queryText: 'site:workonclimate.org ("events" OR "community") ("San Francisco" OR "Bay Area" OR "founders" OR "startup")',
    includeDomains: ["workonclimate.org"],
    tags: ["climate", "community", "founders", "bay_area"],
    notes: "Starter Guide source; climate network, useful only when event is Bay Area and founder/operator-heavy."
  },
  {
    id: "this-week-in-fintech",
    name: "This Week in Fintech",
    kind: "organizer_site",
    priority: "medium",
    url: "https://www.thisweekinfintech.com/",
    queryText: 'site:thisweekinfintech.com ("San Francisco" OR "SF" OR "Bay Area") ("events" OR "happy hour" OR "founders" OR "fintech")',
    includeDomains: ["thisweekinfintech.com"],
    tags: ["fintech", "founders", "networking", "sf"],
    notes: "Starter Guide source; adjacent vertical, useful when founder/networking signals are explicit."
  },
  {
    id: "gp-dinners",
    name: "GP Dinners",
    kind: "organizer_site",
    priority: "medium",
    url: "https://www.gpdinners.com/",
    queryText: 'site:gpdinners.com ("GP Dinners" OR "founders" OR "investors" OR "dinner" OR "San Francisco" OR "SF")',
    includeDomains: ["gpdinners.com"],
    tags: ["investors", "founders", "dinner", "networking", "sf"],
    notes: "Starter Guide-linked investor dinner surface; keep medium because audience/access may skew investor-only."
  },
  {
    id: "aws-builder-loft-official",
    name: "AWS Builder Loft Official Calendar",
    kind: "organizer_site",
    priority: "high",
    url: "https://builder.aws.com/connect/events/builder-loft",
    queryText: 'site:builder.aws.com/connect/events/builder-loft ("AWS Builder Loft" OR "AI" OR "pitch" OR "founder" OR "networking" OR "San Francisco")',
    includeDomains: ["builder.aws.com"],
    tags: ["aws", "builders", "ai", "sf"],
    notes: "Official registration surface for AWS Builder Loft events."
  },
  {
    id: "shack15-official",
    name: "SHACK15",
    kind: "organizer_site",
    priority: "high",
    url: "https://www.shack15.com/",
    queryText: 'site:shack15.com ("events" OR "experience" OR "speaker" OR "AI" OR "founder" OR "startup")',
    includeDomains: ["shack15.com"],
    tags: ["venue", "founders", "startup", "sf", "ferry_building"],
    notes: "Founder and innovation hub at the Ferry Building; strong venue/co-host signal when paired with Luma or organizer pages."
  },
  {
    id: "startuphq-official",
    name: "StartupHQ",
    kind: "organizer_site",
    priority: "high",
    url: "https://www.startuphq.com/",
    queryText: 'site:startuphq.com ("events" OR "founder" OR "YC" OR "startup" OR "156 2nd")',
    includeDomains: ["startuphq.com"],
    tags: ["venue", "startup_hq", "founders", "sf", "soma"],
    notes: "Founder-owned office and community space; many events appear on Luma or LinkedIn rather than an official events feed."
  },
  {
    id: "entrepreneur-first-sf",
    name: "Entrepreneurs First San Francisco",
    kind: "organizer_site",
    priority: "medium",
    url: "https://www.joinef.com/",
    queryText: 'site:joinef.com ("San Francisco" OR "SF") ("Demo Day" OR "Happy Hours" OR "founders" OR "residency" OR "investors")',
    includeDomains: ["joinef.com"],
    tags: ["accelerator", "founders", "demo_day", "sf", "residency"],
    notes: "EF SF hub and residency source; scan for demo days, happy hours, and cohort/investor events."
  },
  {
    id: "berkeley-rdi-events",
    name: "Berkeley RDI Events",
    kind: "organizer_site",
    priority: "medium",
    url: "https://rdi.berkeley.edu/events",
    queryText: 'site:rdi.berkeley.edu/events ("AI" OR "Agentic AI" OR "summit" OR "workshop" OR "seminar")',
    includeDomains: ["rdi.berkeley.edu"],
    tags: ["berkeley", "ai", "research", "agents"]
  },
  {
    id: "stanford-hai-events",
    name: "Stanford HAI Events",
    kind: "organizer_site",
    priority: "medium",
    url: "https://hai.stanford.edu/events",
    queryText: 'site:hai.stanford.edu/events ("AI" OR "conference" OR "seminar" OR "workshop" OR "Stanford")',
    includeDomains: ["hai.stanford.edu"],
    tags: ["stanford", "ai", "research", "policy"],
    notes: "Mature official AI events page; lower startup density but high authority."
  },
  {
    id: "stanford-hai-calendar",
    name: "Stanford HAI Localist Calendar",
    kind: "organizer_site",
    priority: "medium",
    url: "https://events.stanford.edu/department/hai/calendar",
    queryText: 'site:events.stanford.edu/department/hai/calendar ("Stanford HAI" OR "AI" OR "upcoming")',
    includeDomains: ["events.stanford.edu"],
    tags: ["stanford", "ai", "research", "calendar"],
    notes: "Stanford central event calendar supports RSS/calendar feeds and widgets."
  },
  {
    id: "bay-ai-circle-events",
    name: "Bay AI Circle Events",
    kind: "organizer_site",
    priority: "paused",
    url: "https://bayaicircle.com/events",
    queryText: 'site:bayaicircle.com/events ("Bay AI Circle" OR "Converge" OR "AI" OR "founders" OR "investors")',
    includeDomains: ["bayaicircle.com"],
    tags: ["ai", "founders", "investors", "sf"]
  },
  {
    id: "yc-startup-school",
    name: "Y Combinator Startup School",
    kind: "organizer_site",
    priority: "medium",
    url: "https://www.ycstartupschools.com/",
    queryText: 'site:ycstartupschools.com ("Startup School" OR "founders") ("San Francisco" OR "SF")',
    includeDomains: ["ycstartupschools.com"],
    tags: ["yc", "founders", "sf"]
  },
  {
    id: "berkeley-skydeck",
    name: "Berkeley SkyDeck",
    kind: "organizer_site",
    priority: "medium",
    url: "https://skydeck.berkeley.edu/events/",
    queryText: '("Berkeley SkyDeck" OR "UC Berkeley SkyDeck") ("Luma" OR "events" OR "demo day" OR "founders")',
    tags: ["berkeley", "accelerator", "founders"]
  },
  {
    id: "fogcity-events",
    name: "Fog City Events",
    kind: "event_digest",
    priority: "medium",
    url: "https://fogcity.events/",
    queryText: 'site:fogcity.events ("Luma Event Link" OR "RSVP") ("AI" OR "founder" OR "startup" OR "agents")',
    includeDomains: ["fogcity.events"],
    tags: ["aggregator", "sf", "events"]
  },
  {
    id: "indexed-pear-vc-events",
    name: "Pear Events Calendar",
    kind: "indexed_source",
    priority: "high",
    queryText: 'site:luma.com ("Pear Events Calendar" OR "Pear VC") ("San Francisco" OR "Palo Alto" OR "AI" OR "founders")',
    includeDomains: ["luma.com"],
    tags: ["indexed", "vc", "founders", "ai", "sf"],
    notes: "No stable public calendar URL verified; use indexed Luma event pages only."
  },
  {
    id: "indexed-signalfire-events",
    name: "SignalFire Events",
    kind: "indexed_source",
    priority: "high",
    queryText: 'site:luma.com ("SignalFire Events" OR "SignalFire AI Lab" OR "SignalFire") ("San Francisco" OR "SF") ("AI founders" OR "builders" OR "networking" OR "happy hour")',
    includeDomains: ["luma.com"],
    tags: ["indexed", "vc", "ai", "founders", "sf"],
    notes: "SignalFire frequently appears as a Luma presenter/co-host for AI founder, builder, and investor rooms."
  },
  {
    id: "indexed-shack15-venue-events",
    name: "SHACK15 Venue Events",
    kind: "indexed_source",
    priority: "high",
    queryText: 'site:luma.com ("SHACK15" OR "Shack15" OR "Ferry Building") ("AI" OR "founder" OR "builders" OR "demo night" OR "networking")',
    includeDomains: ["luma.com"],
    tags: ["indexed", "venue", "ai", "founders", "sf"],
    notes: "Venue-based Luma search for SHACK15, a common SF founder/AI gathering place."
  },
  {
    id: "indexed-startuphq-venue-events",
    name: "StartupHQ Venue Events",
    kind: "indexed_source",
    priority: "high",
    queryText: 'site:luma.com ("StartupHQ" OR "Startup HQ" OR "156 2nd") ("AI" OR "founder" OR "YC founders" OR "builders" OR "investors")',
    includeDomains: ["luma.com"],
    tags: ["indexed", "venue", "founders", "ai", "sf"],
    notes: "Venue-based Luma search for StartupHQ rooms, including AI founder mixers and YC-founder meetups."
  },
  {
    id: "indexed-entrepreneur-first-sf-events",
    name: "Entrepreneurs First SF Luma Events",
    kind: "indexed_source",
    priority: "medium",
    queryText: 'site:luma.com ("Entrepreneurs First" OR "Entrepreneur First" OR "EF") ("San Francisco" OR "SF") ("founders" OR "Demo Day" OR "residency" OR "investors")',
    includeDomains: ["luma.com"],
    tags: ["indexed", "accelerator", "founders", "sf"],
    notes: "Indexed Luma search for EF-hosted or EF-venue events; downstream scoring should still filter hackathons/deeptech mismatches."
  },
  {
    id: "indexed-founders-on-tap-events",
    name: "Founders on Tap",
    kind: "indexed_source",
    priority: "medium",
    queryText: '("Founders on Tap" OR "thefoundersontap.com") ("San Francisco" OR "SF") ("founders" OR "operators" OR "builders" OR "Luma")',
    tags: ["indexed", "founders", "operators", "community", "sf"],
    notes: "Small founder/operator workshop format; useful for community-led tactical sessions."
  },
  {
    id: "indexed-latent-space-events",
    name: "Latent.Space Events",
    kind: "indexed_source",
    priority: "high",
    queryText: 'site:luma.com ("Latent.Space" OR "swyx" OR "AI Engineering") ("San Francisco" OR "SF" OR "Paper Club" OR "AI Engineer")',
    includeDomains: ["luma.com"],
    tags: ["indexed", "ai", "engineering", "sf"]
  },
  {
    id: "indexed-mlops-sf-events",
    name: "San Francisco MLOps Community",
    kind: "indexed_source",
    priority: "medium",
    queryText: 'site:luma.com ("San Francisco MLOps Community" OR "MLOps Community") ("San Francisco" OR "Mountain View" OR "AI" OR "agents")',
    includeDomains: ["luma.com"],
    tags: ["indexed", "mlops", "ai", "developers", "sf"],
    notes: "Calendar exists but often empty; indexed event pages are more reliable."
  },
  {
    id: "indexed-ollama-events",
    name: "Ollama Local AI Events",
    kind: "indexed_source",
    priority: "medium",
    queryText: 'site:luma.com ("Ollama" OR "local AI" OR "open-source AI") ("San Francisco" OR "SF" OR "developers")',
    includeDomains: ["luma.com"],
    tags: ["indexed", "ai", "open_source", "developers", "sf"]
  },
  {
    id: "indexed-langchain-sf-events",
    name: "LangChain SF Events",
    kind: "indexed_source",
    priority: "medium",
    queryText: 'site:luma.com ("LangChain" OR "LangSmith") ("San Francisco" OR "SF" OR "agents" OR "AI builders")',
    includeDomains: ["luma.com"],
    tags: ["indexed", "ai", "agents", "developers", "sf"]
  },
  {
    id: "indexed-fusion-fund-events",
    name: "Fusion Fund Events",
    kind: "indexed_source",
    priority: "medium",
    queryText: 'site:luma.com ("Fusion Fund Events Calendar" OR "Fusion Fund") ("San Francisco" OR "AI infrastructure" OR "founders" OR "investors")',
    includeDomains: ["luma.com"],
    tags: ["indexed", "vc", "ai", "infrastructure", "sf"]
  },
  {
    id: "indexed-forerunner-vc-events",
    name: "Forerunner VC Events",
    kind: "indexed_source",
    priority: "medium",
    queryText: 'site:luma.com ("Forerunner" OR "Forerunner Ventures") ("San Francisco" OR "AI" OR "founders" OR "operators")',
    includeDomains: ["luma.com"],
    tags: ["indexed", "vc", "founders", "sf"]
  },
  {
    id: "x-theaievangelist",
    name: "Sahar Mor / Bond AI",
    kind: "x_account",
    priority: "must_scan",
    handle: "theaievangelist",
    queryText: 'from:theaievangelist (url:lu.ma OR url:luma.com OR "RSVP" OR "apply" OR "AI event" OR "founder" OR "builders") -is:retweet -hackathon -buildathon',
    tags: ["x", "ai", "founders"]
  },
  {
    id: "x-kyosukesf",
    name: "Kyosuke",
    kind: "x_account",
    priority: "high",
    handle: "kyosukesf",
    queryText: 'from:kyosukesf ("Tech Events" OR "SFTech" OR "AIEvents" OR url:airtable.com OR url:lu.ma) -is:retweet',
    tags: ["x", "newsletter", "sf"]
  },
  {
    id: "x-michelleefang",
    name: "Michelle Fang",
    kind: "x_account",
    priority: "high",
    handle: "michelleefang",
    queryText: 'from:michelleefang ("events" OR "weekly thread" OR "SF" OR "San Francisco" OR url:lu.ma OR url:luma.com OR "founder" OR "startup") -is:retweet',
    tags: ["x", "sf", "events", "founders"],
    notes: "Starter Guide author; weekly SF event threads and guide updates."
  },
  {
    id: "x-thechangj",
    name: "Jonathan Chang",
    kind: "x_account",
    priority: "high",
    handle: "thechangj",
    queryText: 'from:thechangj ("SF IRL" OR "events" OR "San Francisco" OR "founder" OR "startup" OR url:lu.ma OR url:luma.com) -is:retweet',
    tags: ["x", "sf_irl", "events", "founders"],
    notes: "Starter Guide source for SF IRL and founder/community event discovery."
  },
  {
    id: "x-joshconstine",
    name: "Josh Constine",
    kind: "x_account",
    priority: "medium",
    handle: "JoshConstine",
    queryText: 'from:JoshConstine ("Outgoers" OR "event" OR "party" OR "founder" OR "tech" OR "SF" OR url:lu.ma OR url:luma.com) -is:retweet',
    tags: ["x", "outgoers", "events", "sf"],
    notes: "Starter Guide source for under-the-radar social events; medium because many events are not startup-specific."
  },
  {
    id: "x-suffiyanmalik",
    name: "Suffiyan Malik",
    kind: "x_account",
    priority: "medium",
    handle: "suffiyanmalikk",
    queryText: 'from:suffiyanmalikk ("event" OR "founder" OR "startup" OR "SF" OR "San Francisco" OR url:lu.ma OR url:luma.com) -is:retweet',
    tags: ["x", "superconnector", "founders", "sf"],
    notes: "Starter Guide superconnector; scan lightly for event links and founder rooms."
  },
  {
    id: "x-paigefinnn",
    name: "Paige Finn Doherty",
    kind: "x_account",
    priority: "medium",
    handle: "paigefinnn",
    queryText: 'from:paigefinnn ("event" OR "founder" OR "startup" OR "SF" OR "San Francisco" OR url:lu.ma OR url:luma.com) -is:retweet',
    tags: ["x", "superconnector", "vc", "founders", "sf"],
    notes: "Starter Guide superconnector and investor; scan lightly for founder/event announcements."
  },
  {
    id: "x-swyx",
    name: "swyx",
    kind: "x_account",
    priority: "medium",
    handle: "swyx",
    queryText: 'from:swyx ("AI Engineer" OR "Latent Space" OR "event" OR "SF" OR "San Francisco" OR url:lu.ma OR url:luma.com) -is:retweet',
    tags: ["x", "ai", "engineering", "events", "sf"],
    notes: "Starter Guide superconnector; useful for AI Engineer / Latent Space event radar."
  },
  {
    id: "x-fdotinc",
    name: "Founders Inc",
    kind: "x_account",
    priority: "high",
    handle: "fdotinc",
    queryText: 'from:fdotinc (url:lu.ma OR url:luma.com OR url:f.inc OR "RSVP" OR "invite" OR "demo" OR "festival" OR "mixer" OR "founder" OR "Open Campus") -is:retweet -hackathon -buildathon -"hack day"',
    tags: ["x", "founders", "builders", "sf"],
    notes: "Strong SF founder campus signal; query excludes hackathon-style time sinks."
  },
  {
    id: "x-southpkcommons",
    name: "South Park Commons",
    kind: "x_account",
    priority: "high",
    handle: "southpkcommons",
    queryText: 'from:southpkcommons ("SPC" OR "Demo Faire" OR "event" OR "apply" OR "Founder Fellowship" OR url:lu.ma OR url:luma.com) -is:retweet -hackathon -buildathon -"hack day"',
    tags: ["x", "spc", "founders", "builders", "sf"]
  },
  {
    id: "x-marianebekker",
    name: "Mariane Bekker / Founders Bay",
    kind: "x_account",
    priority: "high",
    handle: "marianebekker",
    queryText: 'from:marianebekker (url:lu.ma OR url:luma.com OR "Founders Bay" OR "RSVP" OR "AI Happy Hour" OR "founder" OR "VC" OR "breakfast") -is:retweet -hackathon -buildathon',
    tags: ["x", "founders_bay", "ai", "founders", "vc"]
  },
  {
    id: "x-founders-cafe",
    name: "Founders Cafe",
    kind: "x_account",
    priority: "high",
    handle: "founders_cafe",
    queryText: 'from:founders_cafe (url:lu.ma OR url:luma.com OR "Founders Cafe" OR "networking" OR "founder" OR "investor" OR "demo" OR "AngelList" OR "90 Gold") -is:retweet -hackathon -buildathon -"make-a-thon"',
    tags: ["x", "founders_cafe", "angellist", "networking", "sf"]
  },
  {
    id: "x-irinson",
    name: "Irin Son / Founders Cafe",
    kind: "x_account",
    priority: "medium",
    handle: "IrinSon",
    queryText: 'from:IrinSon (url:lu.ma OR url:luma.com OR "Founders Cafe" OR "AngelList" OR "founder" OR "investor" OR "networking" OR "90 Gold") -is:retweet -hackathon -buildathon -"make-a-thon"',
    tags: ["x", "founders_cafe", "angellist", "networking", "sf"],
    notes: "Personal organizer handle from Founders Cafe; keep medium because personal posts can be noisy."
  },
  {
    id: "x-frontiertower",
    name: "Frontier Tower",
    kind: "x_account",
    priority: "medium",
    handle: "frontiertower",
    queryText: 'from:frontiertower (url:lu.ma OR url:luma.com OR "RSVP" OR "Frontier Tower" OR "founder" OR "AI" OR "networking" OR "salon") -is:retweet -hackathon -buildathon',
    tags: ["x", "frontier_tower", "ai", "founders", "sf"]
  },
  {
    id: "x-pear-vc",
    name: "Pear VC",
    kind: "x_account",
    priority: "medium",
    handle: "pear_vc",
    queryText: 'from:pear_vc ("event" OR "Speaker Series" OR "founder" OR "happy hour" OR "Pear Studio SF" OR url:lu.ma OR url:luma.com) ("SF" OR "San Francisco" OR "Palo Alto" OR "Menlo Park") -is:retweet -hackathon -buildathon',
    tags: ["x", "vc", "founders", "sf", "palo_alto"]
  },
  {
    id: "x-cerebral-valley",
    name: "Cerebral Valley",
    kind: "x_account",
    priority: "medium",
    handle: "cerebral_valley",
    queryText: 'from:cerebral_valley (url:lu.ma OR url:luma.com OR "RSVP" OR "AI events" OR "Cerebral Valley" OR "SF" OR "San Francisco") -is:retweet -hackathon -buildathon',
    tags: ["x", "ai", "events", "sf"],
    notes: "Good AI event radar, but query excludes hackathons and broad event-production noise."
  },
  {
    id: "x-bay-area-luma-event-links",
    name: "Bay Area Luma Links on X",
    kind: "x_account",
    priority: "must_scan",
    queryText: '(url:lu.ma OR url:luma.com OR url:partiful.com) ("SF" OR "San Francisco" OR "Bay Area" OR "Palo Alto" OR "Menlo Park" OR "Mountain View") ("AI" OR "founder" OR "builder" OR "startup" OR "RSVP" OR "apply" OR "dinner" OR "salon" OR "demo") -is:retweet -hackathon -buildathon -webinar',
    tags: ["x", "luma", "sf", "event_links"],
    notes: "Broad recent-search catch-all for event links posted by anyone, not just known organizers."
  },
  {
    id: "x-bay-area-event-intent",
    name: "Bay Area Event Intent on X",
    kind: "x_account",
    priority: "high",
    queryText: '("join us" OR "RSVP" OR "apply to attend" OR "hosting") ("AI founders" OR "agent builders" OR "founder dinner" OR "builder meetup") ("SF" OR "San Francisco" OR "Bay Area" OR "Palo Alto") -is:retweet -hackathon -buildathon -webinar',
    tags: ["x", "sf", "events", "founders"],
    notes: "Catches announcement posts that mention an event but do not expose a URL entity."
  },
  {
    id: "x-aitinkerers",
    name: "AI Tinkerers",
    kind: "x_account",
    priority: "medium",
    handle: "AITinkerers",
    queryText: 'from:AITinkerers ("San Francisco" OR "SF" OR "Bay Area" OR url:lu.ma OR url:luma.com OR "AI Tinkerers SF") ("RSVP" OR "demo" OR "meetup" OR "builders") -is:retweet -hackathon -buildathon',
    tags: ["x", "ai", "builders", "technical", "sf"],
    notes: "Global account; useful only when posts mention SF/Bay Area or Luma event links."
  },
  {
    id: "x-aicampai",
    name: "AICamp",
    kind: "x_account",
    priority: "medium",
    handle: "aicampai",
    queryText: 'from:aicampai ("San Francisco" OR "SF" OR "Bay Area") ("AI Meetup" OR "networking" OR "RSVP" OR url:lu.ma OR url:luma.com) -is:retweet -hackathon -buildathon -webinar -virtual',
    tags: ["x", "ai", "developers", "sf"],
    notes: "Broad/global developer source; only local in-person/networking posts should survive."
  },
  {
    id: "x-ycombinator",
    name: "Y Combinator",
    kind: "x_account",
    priority: "medium",
    handle: "ycombinator",
    queryText: 'from:ycombinator ("Startup School" OR "San Francisco" OR "founders" OR "AI") -is:retweet',
    tags: ["x", "yc", "founders"]
  }
];

export function registrySourcesByKind(kind: RegistrySourceKind): RegistrySource[] {
  return FREE_PUBLIC_SOURCES.filter((source) => source.kind === kind);
}

export function sourceTypeForRegistryKind(kind: RegistrySourceKind): SourceType {
  if (kind === "luma_calendar") return "luma_calendar";
  if (kind === "rss_feed") return "newsletter";
  if (kind === "x_account") return "x_account";
  if (kind === "organizer_site") return "organizer_site";
  return "organizer_site";
}

/**
 * Built-in sources minus the ones the profile disables (by id or tag), plus the profile's own sources.
 */
export function registrySourcesForProfile(profile: ScoutProfile): RegistrySource[] {
  const disabled = new Set(profile.sources.disable.map((value) => value.toLowerCase()));
  const builtIn = FREE_PUBLIC_SOURCES.filter(
    (source) => !disabled.has(source.id.toLowerCase()) && !source.tags.some((tag) => disabled.has(tag.toLowerCase()))
  );
  return [...builtIn, ...profile.sources.add.map((source) => profileSourceToRegistry(source, profile))];
}

function profileSourceToRegistry(source: ProfileSource, profile: ScoutProfile): RegistrySource {
  const slug = normalizeMatchText(source.name).replace(/[^a-z0-9]+/g, "-") || "source";
  const location = source.url ? new URL(source.url) : undefined;
  const sitePath = location ? `${location.hostname.replace(/^www\./, "")}${location.pathname.replace(/\/+$/, "")}` : undefined;
  const phrases = profile.search.phrases.slice(0, 3).map((phrase) => `"${phrase}"`).join(" OR ");
  const queryText =
    source.query ??
    (source.kind === "x_account" && source.handle
      ? `from:${source.handle.replace(/^@/, "")} (url:lu.ma OR url:luma.com OR "RSVP" OR "event") -is:retweet`
      : sitePath
        ? `site:${sitePath} (${phrases} OR "event" OR "RSVP")`
        : undefined);

  return {
    id: `custom-${slug}`,
    name: source.name,
    kind: source.kind,
    priority: source.priority,
    url: source.url,
    feedUrl: source.feed,
    handle: source.handle?.replace(/^@/, ""),
    queryText,
    includeDomains: location ? [location.hostname.replace(/^www\./, "")] : undefined,
    tags: ["custom"],
    notes: "Added in the scout profile."
  };
}
