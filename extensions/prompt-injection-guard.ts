/**
 * Prompt Injection Guard Extension
 *
 * Evaluates all external input (user messages, tool results, attached content)
 * for common prompt injection patterns before they reach the LLM.
 *
 * Detected injection attempts are logged, flagged, and optionally blocked.
 *
 * Configuration via before_agent_start - read ~/.pi/agent/settings.json
 * or set defaults below.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ──────────────────────────────────────────────
// Injection pattern definitions
// ──────────────────────────────────────────────

interface InjectionPattern {
  name: string;
  description: string;
  pattern: RegExp;
  severity: "low" | "medium" | "high" | "critical";
}

const INJECTION_PATTERNS: InjectionPattern[] = [
  // ── Direct instruction overrides ──
  {
    name: "ignore-instructions",
    description: "Attempt to ignore previous instructions",
    pattern: /\b(ignore|disregard|forget|discard|override|bypass)\s+(all\s+)?(previous\s+)?(instructions|commands|prompts|rules|constraints|guidelines|directions|system\s*prompt)\b/i,
    severity: "high",
  },
  {
    name: "new-identity",
    description: "Attempt to assume a new identity or role",
    pattern: /\b(you\s+are\s+now|from\s+now\s+on|you\s+should\s+act\s+as|pretend\s+you\s+are|imagine\s+you\s+are|roleplay\s+as|act\s+like)\b/i,
    severity: "medium",
  },
  {
    name: "role-reassignment",
    description: "Forced role/persona change",
    pattern: /\b(new\s+role|new\s+identity|new\s+persona|new\s+character|change\s+(your\s+)?(role|identity|persona|character))\b/i,
    severity: "medium",
  },

  // ── Output suppression ──
  {
    name: "suppress-output",
    description: "Attempt to suppress or limit output",
    pattern: /\b(do\s+not|don't|never|must\s+not|cannot|should\s+not)\s+(respond|reply|answer|output|generate|write|show|display|print|tell|say|explain|describe|discuss|mention)\b/i,
    severity: "medium",
  },
  {
    name: "silence-mode",
    description: "Attempt to force silent/no-response mode",
    pattern: /\b(silent\s+mode|no\s+response|no\s+reply|no\s+output|do\s+nothing|stay\s+quiet|keep\s+quiet|shut\s+down|shut\s+up)\b/i,
    severity: "high",
  },

  // ── System prompt extraction ──
  {
    name: "system-prompt-extraction",
    description: "Attempt to extract or reveal system prompt",
    pattern: /\b(show|reveal|display|print|output|repeat|echo|copy|paste|return|return\s+to\s+me|tell\s+me|what\s+is\s+your|your\s+system|your\s+instructions|your\s+prompt|your\s+rules|your\s+guidelines|your\s+configuration)\b.*\b(system\s*prompt|system\s*message|initial\s*instructions|core\s*instructions|base\s*prompt)\b/i,
    severity: "critical",
  },
  {
    name: "system-prompt-direct",
    description: "Direct system prompt extraction attempt",
    pattern: /\b(return|show|reveal|print|output|repeat|echo|display|copy|paste|what\s*is)\s+(the\s+)?(system\s*prompt|system\s*instructions|system\s*message|initial\s*prompt|base\s*instructions|core\s*prompt|original\s*prompt)\b/i,
    severity: "critical",
  },

  // ── Format/data exfiltration ──
  {
    name: "base64-encoding",
    description: "Encoding data in base64 to bypass filters",
    pattern: /\b(base64)\s*[:=]\s*[A-Za-z0-9+/=]{20,}/i,
    severity: "medium",
  },
  {
    name: "hex-encoding",
    description: "Encoding data in hex to bypass filters",
    pattern: /\b(hex)\s*[:=]\s*[0-9a-fA-F]{20,}/i,
    severity: "medium",
  },
  {
    name: "url-encoding",
    description: "URL-encoded content that may hide injection",
    pattern: /%(?:[0-9a-fA-F]{2}){3,}/i,
    severity: "low",
  },

  // ── Context manipulation ──
  {
    name: "context-deletion",
    description: "Attempt to delete or clear conversation context",
    pattern: /\b(clear|delete|remove|erase|wipe|reset|flush)\s+(the\s+)?(conversation|chat|context|history|messages|previous\s*messages|all\s*messages)\b/i,
    severity: "high",
  },
  {
    name: "context-reset",
    description: "Attempt to reset conversation to a clean state",
    pattern: /\b(start\s+over|reset\s+(the\s+)?(conversation|chat|context|session)|new\s+(conversation|chat|session|topic))\b/i,
    severity: "low",
  },

  // ── Instruction injection via code ──
  {
    name: "code-instruction",
    description: "Instructions embedded in code blocks",
    pattern: /```(?:\w+)?\n.*?\b(ignore|disregard|forget|override)\s+(all\s+)?(instructions|rules|prompts)\b.*?```/is,
    severity: "high",
  },
  {
    name: "xml-injection",
    description: "Instructions embedded in XML/HTML-like tags",
    pattern: /<\w+>\s*(ignore|disregard|forget|override|new\s+rule|new\s+instruction)\b/i,
    severity: "medium",
  },

  // ── Language-based attacks ──
  {
    name: "multi-language-injection",
    description: "Instructions in non-English languages",
    pattern: /\b(无视|忽略|忘记|忽略所有|忽略一切|从此刻起|你现在是|扮演|假设|想象|不要回答|不要回复|不要输出|不要生成|不要显示|不要打印|不要告诉|不要说|不要解释|不要描述|不要讨论|不要提及|不要回应|不要回复|不要输出|不要生成|不要显示|不要打印|不要告诉|不要说|不要解释|不要描述|不要讨论|不要提及|무시|모든|지시|규칙|명령|새로운|역할|페르소나|system\s*prompt)\b/i,
    severity: "medium",
  },

  // ── Conditional bypass ──
  {
    name: "conditional-bypass",
    description: "Conditional instruction bypass attempts",
    pattern: /\b(if|when|unless|provided\s+that|assuming\s+that|in\s+case|in\s+the\s+event)\s+(that\s+)?(you\s+are|i\s+am|we\s+are)\s+(told|asked|requested|instructed|commanded|ordered|requested|prompted|told\s+to|asked\s+to)\s+(to\s+)?(ignore|disregard|forget|override|bypass)\b/i,
    severity: "high",
  },

  // ── Authority override ──
  {
    name: "authority-override",
    description: "Attempt to claim higher authority",
    pattern: /\b(i\s+am\s+your|you\s+must|you\s+have\s+been|you\s+are\s+ordered|you\s+are\s+commanded|you\s+are\s+required|you\s+are\s+forced|you\s+are\s+obligated|you\s+are\s+compelled|i\s+am\s+the\s+admin|i\s+am\s+the\s+owner|i\s+am\s+the\s+developer|i\s+am\s+the\s+creator|system\s+administrator|superuser|root\s+user)\b/i,
    severity: "high",
  },

  // ── Hypothetical framing ──
  {
    name: "hypothetical-framing",
    description: "Hypothetical scenario to bypass restrictions",
    pattern: /\b(imagine|suppose|pretend|let's\s+say|in\s+a\s+hypothetical|what\s+if|consider\s+the|assume\s+that|roleplay|fictional|story)\s+(that\s+)?(you\s+can|you\s+may|you\s+should|you\s+must|ignore|disregard|reveal|show|output|print|display|tell)\b/i,
    severity: "medium",
  },

  // ── Reward/punishment manipulation ──
  {
    name: "reward-manipulation",
    description: "Attempt to manipulate via rewards or punishments",
    pattern: /\b(if\s+you\s+(do|don't|follow|obey)|you'll\s+be\s+(rewarded|punished|recompensed)|reward|punishment|bonus|penalty|consequence|carrot|stick)\b/i,
    severity: "low",
  },

  // ── Debug/test mode ──
  {
    name: "debug-mode",
    description: "Attempt to enter debug or test mode",
    pattern: /\b(debug|test|development|sandbox|safe|playground|training|eval|evaluation|benchmark)\s*(mode|session|environment|environment|context|mode)\b/i,
    severity: "medium",
  },
  {
    name: "developer-mode",
    description: "Attempt to activate developer mode",
    pattern: /\b(developer\s*mode|dev\s*mode|admin\s*mode|root\s*mode|god\s*mode|master\s*mode|unrestricted|unfiltered|uncensored|open\s*source|open\s*source\s*mode)\b/i,
    severity: "high",
  },
];

// ──────────────────────────────────────────────
// Detection result
// ──────────────────────────────────────────────

interface DetectionResult {
  matchedPatterns: InjectionPattern[];
  score: number;
  severity: "low" | "medium" | "high" | "critical";
  recommendations: string[];
}

// Severity weights for scoring
const SEVERITY_WEIGHTS: Record<string, number> = {
  low: 1,
  medium: 3,
  high: 7,
  critical: 10,
};

function detectInjection(text: string): DetectionResult {
  if (!text || text.trim().length === 0) {
    return { matchedPatterns: [], score: 0, severity: "low", recommendations: [] };
  }

  const decodedVariants = decodeObfuscations(text);
  const textVariants = [text, ...decodedVariants];

  const matchedPatterns: InjectionPattern[] = [];
  let totalScore = 0;

  for (const variant of textVariants) {
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.pattern.test(variant)) {
        if (!matchedPatterns.includes(pattern)) {
          matchedPatterns.push(pattern);
          totalScore += SEVERITY_WEIGHTS[pattern.severity];
        }
      }
    }
  }

  // Determine overall severity based on score
  let overallSeverity: "low" | "medium" | "high" | "critical" = "low";
  if (totalScore >= 20) overallSeverity = "critical";
  else if (totalScore >= 10) overallSeverity = "high";
  else if (totalScore >= 4) overallSeverity = "medium";

  // Generate recommendations
  const recommendations: string[] = [];
  if (matchedPatterns.some((p) => p.severity === "critical")) {
    recommendations.push("⛔ BLOCK: Critical injection pattern detected. This input should be rejected.");
  }
  if (matchedPatterns.some((p) => p.severity === "high")) {
    recommendations.push("⚠️  HIGH RISK: High-severity injection pattern detected. Consider blocking or flagging.");
  }
  if (matchedPatterns.some((p) => p.severity === "medium")) {
    recommendations.push("⚡ MEDIUM RISK: Moderate injection indicators found. Monitor closely.");
  }
  if (matchedPatterns.length > 0 && recommendations.length === 0) {
    recommendations.push("ℹ️  LOW RISK: Minor suspicious patterns. Generally safe but worth noting.");
  }
  if (matchedPatterns.length === 0) {
    recommendations.push("✅ No injection patterns detected. Input appears clean.");
  }

  return { matchedPatterns, score: totalScore, severity: overallSeverity, recommendations };
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Decode common obfuscation layers and return variants for scanning.
 * Guard against untrusted input by limiting decoded size.
 */
function decodeObfuscations(text: string): string[] {
  const variants: string[] = [];

  // Base64 decode
  const base64Regex = /^[A-Za-z0-9+/=]{20,}$/;
  if (base64Regex.test(text.trim())) {
    try {
      const decoded = Buffer.from(text.trim(), "base64").toString("utf-8");
      if (decoded.length > 0 && decoded.length <= text.length * 3 && /\w/.test(decoded)) {
        variants.push(decoded);
      }
    } catch {
      // Not valid base64
    }
  }

  // URL decode (single and double)
  try {
    const singleDecoded = decodeURIComponent(text);
    if (singleDecoded !== text) {
      variants.push(singleDecoded);
      const doubleDecoded = decodeURIComponent(singleDecoded);
      if (doubleDecoded !== singleDecoded) {
        variants.push(doubleDecoded);
      }
    }
  } catch {
    // Not valid URL encoding
  }

  // HTML entity decode
  const htmlEntityRegex = /&#?[a-zA-Z0-9]+;/;
  if (htmlEntityRegex.test(text)) {
    const htmlDecoded = text
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&#60;/g, "<")
      .replace(/&#62;/g, ">")
      .replace(/&#38;/g, "&");
    if (htmlDecoded !== text) {
      variants.push(htmlDecoded);
    }
  }

  return variants;
}

/**
 * Extract all text content from a session message
 */
function extractTextFromMessage(
  message: {
    role?: string;
    content?: Array<{ type?: string; text?: string; image_url?: { url?: string } }>;
    customType?: string;
  },
): string {
  if (!message.content) return "";

  return message.content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => (c as { text: string }).text)
    .join("\n");
}

// ──────────────────────────────────────────────
// Extension setup
// ──────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // Configuration
  const config = {
    autoBlockCritical: true,
    autoBlockHigh: false,
    verboseLogging: true,
    maxAllowedScore: 3,
  };

  function analyzeAndLog(text: string, source: string): DetectionResult {
    const result = detectInjection(text);

    if (result.matchedPatterns.length > 0 && config.verboseLogging) {
      const flags = result.matchedPatterns.map((p) => p.name).join(", ");
      console.log(
        `\n[🔒 Prompt Injection Guard] ${source}\n` +
        `  Severity: ${result.severity.toUpperCase()} (score: ${result.score})\n` +
        `  Flags: ${flags}\n` +
        `  Recommendation: ${result.recommendations[0]}\n`,
      );
    }

    return result;
  }

  function shouldBlock(result: DetectionResult): boolean {
    if (result.severity === "critical" && config.autoBlockCritical) return true;
    if (result.severity === "high" && config.autoBlockHigh) return true;
    if (result.score > config.maxAllowedScore) return true;
    return false;
  }

  pi.on("input", async (event, ctx) => {
    // Skip extension-injected messages (caught by context event instead)
    if (event.source === "extension") {
      return { action: "continue" };
    }

    // Analyze text input
    if (event.text && event.text.trim().length > 0) {
      const result = analyzeAndLog(event.text, `User input (${event.source})`);

      if (shouldBlock(result)) {
        ctx.ui.notify(
          `🛡️ Prompt Injection Blocked!\n\n` +
          `Severity: ${result.severity.toUpperCase()}\n` +
          `Score: ${result.score}\n` +
          `Patterns: ${result.matchedPatterns.map((p) => p.name).join(", ")}\n\n` +
          result.recommendations.join("\n"),
          "error",
        );
        return { action: "handled" };
      }
    }

    // Log attached images (OCR'd text may contain injection)
    if (event.images && event.images.length > 0) {
      if (config.verboseLogging) {
        console.log(`[🔒 Prompt Injection Guard] User attached ${event.images.length} image(s)`);
      }
    }

    return { action: "continue" };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    // Check the prompt itself
    if (event.prompt && event.prompt.trim().length > 0) {
      const result = analyzeAndLog(event.prompt, `Agent prompt`);

      if (shouldBlock(result)) {
        return {
          message: {
            customType: "injection-blocked",
            content: `🛡️ Your input was blocked by the Prompt Injection Guard.\n\n` +
              `Severity: ${result.severity.toUpperCase()}\n` +
              `Patterns matched: ${result.matchedPatterns.map((p) => p.name).join(", ")}\n\n` +
              result.recommendations.join("\n"),
            display: true,
          },
        };
      }
    }

    // Safety check: system prompt should never contain injection, but if it does (e.g. corrupted), warn
    if (event.systemPrompt && config.verboseLogging) {
      const result = analyzeAndLog(event.systemPrompt, `System prompt (safety check)`);
      if (result.matchedPatterns.length > 0) {
        console.warn(
          `[🔒 Prompt Injection Guard] WARNING: System prompt contains suspicious patterns: ${result.matchedPatterns.map((p) => p.name).join(", ")}`,
        );
      }
    }

    return undefined;
  });

  pi.on("context", async (event, ctx) => {
    const messages = event.messages;
    let anyBlocked = false;

    for (const message of messages) {
      // Skip assistant messages (they've already been vetted)
      if (message.role === "assistant") continue;

      // Extract text content from the message
      const textContent = extractTextFromMessage(message);
      if (!textContent || textContent.trim().length === 0) continue;

      // Determine source context
      let source = "unknown";
      if (message.role === "user") {
        // Could be from skill expansion, template, or direct input
        source = "user message";
        // Check if it looks like a skill/template expansion
        if (message.customType && message.customType !== "user") {
          source = `skill/template expansion (${message.customType})`;
        }
      } else if (message.role === "toolResult") {
        source = "tool result in context";
      } else {
        source = `${message.role} message`;
      }

      const result = analyzeAndLog(textContent, `Context: ${source}`);

      if (result.matchedPatterns.length > 0 && result.severity !== "low") {
        console.warn(
          `\n[🔒 Prompt Injection Guard] ⚠️ Suspicious content in message history\n` +
          `  Source: ${source}\n` +
          `  Severity: ${result.severity.toUpperCase()} (score: ${result.score})\n` +
          `  Flags: ${result.matchedPatterns.map((p) => p.name).join(", ")}\n` +
          `  Preview: ${textContent.slice(0, 200)}...\n`,
        );

        // Block on critical
        if (result.severity === "critical" && config.autoBlockCritical) {
          console.error(
            `\n[🔒 Prompt Injection Guard] ⛔ BLOCKING: Critical injection detected in message history!\n` +
            `  This message will be pruned from the context sent to the LLM.\n`,
          );
          anyBlocked = true;
        }
      }
    }

    // If we blocked critical content, filter it out
    if (anyBlocked) {
      const filtered = messages.filter((m) => {
        const text = extractTextFromMessage(m);
        if (!text) return true;
        const result = detectInjection(text);
        return !(result.severity === "critical" && m.role !== "assistant");
      });
      return { messages: filtered };
    }

    return undefined;
  });

  pi.on("tool_call", async (event, ctx) => {
    // Scan bash commands for injection patterns
    if (event.toolName === "bash") {
      const command = (event.input as { command?: string }).command;
      if (command && command.length > 50) {
        const result = analyzeAndLog(command, `Bash command input`);
        if (result.matchedPatterns.length > 0 && result.severity !== "low") {
          ctx.ui.notify(
            `⚠️ Suspicious bash command detected\n` +
            `Severity: ${result.severity.toUpperCase()}\n` +
            `Patterns: ${result.matchedPatterns.map((p) => p.name).join(", ")}\n` +
            `Command: ${command.slice(0, 200)}...`,
            "warning",
          );
        }
      }
    }

    // Scan write/edit tool paths and content for injection
    if (event.toolName === "write" || event.toolName === "edit") {
      const input = event.input as Record<string, unknown>;

      // Check the path
      const path = input.path as string;
      if (path && path.length > 50) {
        const pathResult = analyzeAndLog(path, `File path (${event.toolName})`);
        if (pathResult.matchedPatterns.length > 0) {
          console.warn(
            `[🔒 Prompt Injection Guard] Suspicious file path: ${path.slice(0, 100)}`,
          );
        }
      }

      // Check the content being written
      const content = (input.content as string) ?? (input.text as string);
      if (content && content.length > 50) {
        const contentResult = analyzeAndLog(content, `Write content (${event.toolName})`);
        if (contentResult.matchedPatterns.length > 0 && contentResult.severity !== "low") {
          ctx.ui.notify(
            `⚠️ Suspicious content in write/edit operation\n` +
            `Severity: ${contentResult.severity.toUpperCase()}\n` +
            `Patterns: ${contentResult.matchedPatterns.map((p) => p.name).join(", ")}`,
            "warning",
          );
        }
      }
    }

    return undefined;
  });

  pi.on("tool_result", async (event, ctx) => {
    const content = event.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("\n");

    if (!content) return undefined;

    // Only analyze if the result is large enough to contain meaningful text
    if (content.length > 50) {
      const result = analyzeAndLog(content, `Tool result: ${event.toolName}`);

      if (shouldBlock(result)) {
        // Don't block tool execution, but flag it
        ctx.ui.notify(
          `⚠️ Suspicious tool output detected (${event.toolName})\n` +
          `Patterns: ${result.matchedPatterns.map((p) => p.name).join(", ")}`,
          "warning",
        );
      }
    }

    return undefined;
  });

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.notify("🛡️ Prompt Injection Guard is active", "info");
    }
  });

  pi.registerTool({
    name: "scan_for_injection",
    label: "Scan for Injection",
    description:
      "Scan a given text for prompt injection patterns. Returns severity score and matched patterns.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The text to scan for injection patterns",
        },
      },
      required: ["text"],
    },
    async execute(_toolCallId, params: { text: string }) {
      const result = detectInjection(params.text);

      const details = result.matchedPatterns.map((p) => ({
        pattern: p.name,
        description: p.description,
        severity: p.severity,
      }));

      return {
        content: [
          {
            type: "text",
            text: `Scan Results:\nSeverity: ${result.severity.toUpperCase()}\nScore: ${result.score}\nPatterns: ${result.matchedPatterns.length} detected\n\n${result.recommendations.join("\n")}`,
          },
        ],
        details: { patterns: details },
      };
    },
  });
}
