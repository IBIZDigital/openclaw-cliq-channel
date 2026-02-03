/**
 * Timecard parsing and reporting for Zoho Cliq
 * 
 * Reads messages from a channel and extracts sign-in/sign-out patterns
 * to generate timecard reports.
 */

export interface TimeEntry {
  userId: string;
  userName: string;
  action: "in" | "out";
  timestamp: Date;
  rawText: string;
}

export interface EmployeeHours {
  userId: string;
  userName: string;
  entries: TimeEntry[];
  totalMinutes: number;
  firstIn?: Date;
  lastOut?: Date;
  status: "working" | "off" | "unknown";
}

export interface TimecardReport {
  date: string;
  channel: string;
  employees: EmployeeHours[];
  generatedAt: Date;
}

// Patterns to detect sign-in/sign-out
const SIGN_IN_PATTERNS = [
  /sign(ing|ed)?\s*(in|on)/i,
  /clock(ing|ed)?\s*(in|on)/i,
  /check(ing|ed)?\s*(in)/i,
  /^in$/i,
  /start(ing|ed)?(\s+work)?/i,
  /good\s*morning/i,
  /here/i,
  /arrived/i,
];

const SIGN_OUT_PATTERNS = [
  /sign(ing|ed)?\s*(out|off)/i,
  /clock(ing|ed)?\s*(out|off)/i,
  /check(ing|ed)?\s*(out)/i,
  /^out$/i,
  /leav(ing|e)/i,
  /head(ing)?\s*(out|home)/i,
  /done(\s+for\s+the\s+day)?/i,
  /good\s*night/i,
  /bye/i,
  /eod/i,
];

/**
 * Detect if a message is a sign-in or sign-out
 */
export function detectAction(text: string): "in" | "out" | null {
  const trimmed = text.trim().toLowerCase();
  
  for (const pattern of SIGN_IN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return "in";
    }
  }
  
  for (const pattern of SIGN_OUT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return "out";
    }
  }
  
  return null;
}

/**
 * Parse messages from Cliq API response into time entries
 */
export function parseMessages(messages: any[]): TimeEntry[] {
  const entries: TimeEntry[] = [];
  
  for (const msg of messages) {
    const text = msg.content?.text || msg.text || "";
    const action = detectAction(text);
    
    if (action) {
      entries.push({
        userId: msg.sender?.id || "unknown",
        userName: msg.sender?.name || "Unknown",
        action,
        timestamp: new Date(msg.time),
        rawText: text,
      });
    }
  }
  
  // Sort by timestamp
  entries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  
  return entries;
}

/**
 * Calculate hours worked for each employee
 */
export function calculateHours(entries: TimeEntry[]): EmployeeHours[] {
  const byEmployee = new Map<string, TimeEntry[]>();
  
  // Group by employee
  for (const entry of entries) {
    const key = entry.userId;
    if (!byEmployee.has(key)) {
      byEmployee.set(key, []);
    }
    byEmployee.get(key)!.push(entry);
  }
  
  const results: EmployeeHours[] = [];
  
  for (const [userId, empEntries] of byEmployee) {
    const userName = empEntries[0]?.userName || "Unknown";
    let totalMinutes = 0;
    let currentIn: Date | null = null;
    let firstIn: Date | undefined;
    let lastOut: Date | undefined;
    
    for (const entry of empEntries) {
      if (entry.action === "in") {
        if (!firstIn) firstIn = entry.timestamp;
        currentIn = entry.timestamp;
      } else if (entry.action === "out" && currentIn) {
        const minutes = (entry.timestamp.getTime() - currentIn.getTime()) / (1000 * 60);
        totalMinutes += minutes;
        lastOut = entry.timestamp;
        currentIn = null;
      }
    }
    
    // Determine current status
    const lastEntry = empEntries[empEntries.length - 1];
    const status = lastEntry?.action === "in" ? "working" : "off";
    
    results.push({
      userId,
      userName,
      entries: empEntries,
      totalMinutes,
      firstIn,
      lastOut,
      status,
    });
  }
  
  // Sort by name
  results.sort((a, b) => a.userName.localeCompare(b.userName));
  
  return results;
}

/**
 * Format minutes as hours and minutes
 */
export function formatDuration(minutes: number): string {
  if (minutes < 1) return "0m";
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/**
 * Format a time entry for display
 */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true 
  });
}

/**
 * Generate a text report from employee hours
 */
export function generateTextReport(employees: EmployeeHours[], channelName: string): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  let report = `📊 **Timecard Report**\n`;
  report += `📅 ${dateStr}\n`;
  report += `📍 #${channelName}\n\n`;
  
  if (employees.length === 0) {
    report += `_No sign-ins/outs detected today._`;
    return report;
  }
  
  // Currently working
  const working = employees.filter(e => e.status === "working");
  if (working.length > 0) {
    report += `🟢 **Currently Working (${working.length}):**\n`;
    for (const emp of working) {
      const since = emp.firstIn ? formatTime(emp.firstIn) : "?";
      report += `  • ${emp.userName} (since ${since})\n`;
    }
    report += `\n`;
  }
  
  // Signed out
  const off = employees.filter(e => e.status === "off");
  if (off.length > 0) {
    report += `🔴 **Signed Out (${off.length}):**\n`;
    for (const emp of off) {
      const hours = formatDuration(emp.totalMinutes);
      report += `  • ${emp.userName}: ${hours}`;
      if (emp.firstIn && emp.lastOut) {
        report += ` (${formatTime(emp.firstIn)} - ${formatTime(emp.lastOut)})`;
      }
      report += `\n`;
    }
    report += `\n`;
  }
  
  // Summary
  const totalHours = employees.reduce((sum, e) => sum + e.totalMinutes, 0);
  report += `📈 **Total Hours Logged:** ${formatDuration(totalHours)}`;
  
  return report;
}

/**
 * Fetch messages and generate timecard report
 */
export async function generateTimecardReport(options: {
  accessToken: string;
  orgId: string;
  chatId: string;
  channelName: string;
  limit?: number;
}): Promise<string> {
  const { accessToken, orgId, chatId, channelName, limit = 100 } = options;
  
  // Fetch messages from the channel
  const url = `https://cliq.zoho.com/api/v2/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}`;
  
  const response = await fetch(url, {
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      orgId: orgId,
    },
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch messages: ${response.status} - ${error}`);
  }
  
  const data = await response.json() as { data: any[] };
  const messages = data.data || [];
  
  // Filter to today's messages only
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMessages = messages.filter((m: any) => {
    const msgTime = new Date(m.time);
    return msgTime >= today;
  });
  
  // Parse and calculate
  const entries = parseMessages(todayMessages);
  const employees = calculateHours(entries);
  
  // Generate report
  return generateTextReport(employees, channelName);
}
