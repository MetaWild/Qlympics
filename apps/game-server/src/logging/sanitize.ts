const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b0x[a-fA-F0-9]{64}\b/g, '[REDACTED_HEX_KEY]'],
  [/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]'],
  [/\b(x-api-key|api_key|api-key|authorization|token|secret|password)\s*[:=]\s*["']?([^\s"',}]+)/gi, '$1=[REDACTED]'],
  [/\b([a-z][a-z0-9+.-]*):\/\/([^:/\s@]+):([^@\s/]+)@/gi, '$1://$2:[REDACTED]@']
];

export function redactSecrets(raw: string): string {
  let out = String(raw ?? '');
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export function sanitizeError(error: unknown): { name: string; message: string; code?: string; stack?: string } {
  if (!error) {
    return { name: 'Error', message: 'Unknown error' };
  }

  if (error instanceof Error) {
    const anyErr = error as any;
    return {
      name: error.name || 'Error',
      message: redactSecrets(error.message || String(error)),
      code: anyErr?.code ? String(anyErr.code) : undefined,
      stack: anyErr?.stack ? redactSecrets(String(anyErr.stack)) : undefined
    };
  }

  const asAny = error as any;
  if (typeof asAny?.message === 'string') {
    return {
      name: typeof asAny?.name === 'string' ? asAny.name : 'Error',
      message: redactSecrets(asAny.message),
      code: asAny?.code ? String(asAny.code) : undefined
    };
  }

  return {
    name: 'Error',
    message: redactSecrets(String(error))
  };
}
