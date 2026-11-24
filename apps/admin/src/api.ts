const TOKEN_KEY = 'innoorder_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Không thể kết nối máy chủ');
  }

  if (res.status === 401 && opts.auth !== false) {
    setToken(null);
    if (!window.location.pathname.startsWith('/login')) window.location.href = '/login';
    throw new ApiError(401, 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại');
  }

  if (!res.ok) {
    let message = `Lỗi ${res.status}`;
    let detail: unknown;
    try {
      const body = await res.json();
      if (typeof body.message === 'string') message = body.message;
      else if (Array.isArray(body.message)) message = body.message.join(', ');
      detail = body;
    } catch {
      // body không phải JSON
    }
    // 429: số giây chờ lấy từ header Retry-After (hoặc retryAfter trong body)
    if (res.status === 429) {
      const body = (detail && typeof detail === 'object' ? detail : {}) as { retryAfter?: number };
      const ra = Number(res.headers.get('Retry-After')) || Number(body.retryAfter) || 0;
      const wait = ra >= 90 ? `${Math.ceil(ra / 60)} phút` : `${Math.ceil(ra)} giây`;
      if (ra > 0) {
        message = path.startsWith('/auth/login')
          ? `Bạn đã nhập sai quá nhiều lần, thử lại sau ${wait}.`
          : `Bạn thao tác quá nhanh, thử lại sau ${wait}.`;
        detail = { ...body, retryAfter: ra };
      }
    }
    throw new ApiError(res.status, message, detail);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Upload file (multipart/form-data) — dung rieng vi api() luon gui JSON */
export async function apiUpload<T = unknown>(path: string, file: File): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const form = new FormData();
  form.append('file', file);

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { method: 'POST', headers, body: form });
  } catch {
    throw new ApiError(0, 'Không thể kết nối máy chủ');
  }

  if (res.status === 401) {
    setToken(null);
    if (!window.location.pathname.startsWith('/login')) window.location.href = '/login';
    throw new ApiError(401, 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại');
  }

  if (!res.ok) {
    let message = `Lỗi ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body.message === 'string') message = body.message;
      else if (Array.isArray(body.message)) message = body.message.join(', ');
    } catch {
      // body không phải JSON
    }
    throw new ApiError(res.status, message);
  }

  return (await res.json()) as T;
}

export function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Đã có lỗi xảy ra';
}
