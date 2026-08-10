export function json(data: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export function error(message: string, status = 400) {
  return json({ error: message }, status);
}

export function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ").normalize("NFKC");
}
